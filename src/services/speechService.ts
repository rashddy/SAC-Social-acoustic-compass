import type { AudioStateName } from '@/constants/bleConstants';
import { COMPASS_PCM_SAMPLE_RATE_HZ } from '@/constants/bleConstants';
import {
  getEngine,
  isLiveSttEngine,
  resolveEngine,
  type SttEngine,
  type SttEngineId,
} from '@/services/stt';
import { appSession, isSensitiveCaptureAllowed } from '@/services/auth/sessionVault';
import { directionLabel, useCompassStore } from '@/store/compassStore';
import { decodeInt16LePcm, pcmMeanAbs } from '@/utils/pcm';

const DEMO_TICK_MS = 350;
const STARVATION_LOG_EVERY = 40;
const STATUS_PUBLISH_EVERY = 80;
/** Lock the line shortly after the speaker pauses. Vosk already showed the words. */
const SILENCE_COMMIT_MS = 140;
/** Mean |sample| below this counts as silence (post BLE, pre-gain). */
const SILENCE_MEAN_ABS = 60;

export type BleSttStats = {
  a1Count: number;
  pcmBytes: number;
  bytesPerSec: number;
  lastError: string | null;
  sampleRateHz: number;
  listening: boolean;
};

/**
 * Live captions: Vosk paints words as BLE packets arrive. When Whisper is
 * selected it overwrites that same line with a more accurate hypothesis, then
 * locks the phrase after a short pause.
 */
const pickLiveEngine = (preferred: SttEngineId): SttEngine => {
  const vosk = getEngine('VOSK');
  if (vosk.isAvailable()) return vosk;
  return resolveEngine(preferred);
};

const isPlaceholder = (text: string): boolean => !text.trim() || /^[.…]+$/.test(text.trim());

const wordList = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);

/** Prefer Whisper when it is refining the same utterance; keep Vosk when it has new words. */
const isBetterHypothesis = (next: string, current: string): boolean => {
  const a = next.trim();
  const b = current.trim();
  if (!a || isPlaceholder(a)) return false;
  if (!b || isPlaceholder(b)) return true;
  if (a === b) return false;

  const bw = wordList(b);
  const aw = wordList(a);
  if (aw.length === 0) return false;
  if (bw.length === 0) return true;

  const overlap = bw.filter((w) => aw.includes(w)).length;
  const overlapRatio = overlap / bw.length;
  if (overlapRatio >= 0.4 && a.length >= b.length * 0.65) return true;
  if (a.length > b.length + 6) return true;
  if (Math.abs(a.length - b.length) <= 14 && overlapRatio >= 0.25) return true;
  return false;
};

class SpeechService {
  private selectedId: SttEngineId = 'WHISPER';
  private engine: SttEngine = resolveEngine('WHISPER');
  private liveEngine: SttEngine = pickLiveEngine('WHISPER');
  private demoTimer: ReturnType<typeof setInterval> | null = null;
  private bleListening = false;
  private modelReady = false;
  private a1Count = 0;
  private pcmBytes = 0;
  private streamRateHz = COMPASS_PCM_SAMPLE_RATE_HZ;
  private windowStartedAt = 0;
  private lastError: string | null = null;
  private lastStarvationLogAt = 0;

  /** In-progress hypothesis — shown beside committed liveTranscript. */
  private currentPartial = '';
  private partialSource: 'VOSK' | 'WHISPER' | '' = '';
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCommitted = '';

  constructor() {
    this.bind(this.liveEngine);
    this.bindWhisperUpgrade();
  }

  private whisperSelected(): boolean {
    return this.selectedId === 'WHISPER' && getEngine('WHISPER').isAvailable();
  }

  private publishStatus(hint?: string) {
    useCompassStore.getState().setSttStatus({
      blePcmPackets: this.a1Count,
      sttReady:
        this.bleListening &&
        this.modelReady &&
        isLiveSttEngine(this.liveEngine.id) &&
        !this.lastError,
      sttEngineLabel: this.whisperSelected()
        ? `${this.liveEngine.label} + Whisper`
        : this.liveEngine.label,
      sttHint: hint ?? this.lastError ?? '',
    });
  }

  private clearSilenceTimer() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  /** Move a finished phrase into the session log and clear the live line. */
  private commitFinal(raw: string) {
    if (!isSensitiveCaptureAllowed()) return;
    appSession.touch(Date.now());
    const text = raw.trim();
    if (isPlaceholder(text)) return;
    // Avoid double-commit when Vosk endpoint and silence timer both fire.
    if (text === this.lastCommitted) {
      this.currentPartial = '';
      this.partialSource = '';
      useCompassStore.getState().setStreamingWord('');
      return;
    }

    this.clearSilenceTimer();
    this.lastCommitted = text;
    this.currentPartial = '';
    this.partialSource = '';

    const store = useCompassStore.getState();
    store.addTranscriptEntry({
      text,
      doa: store.currentDoa,
      direction: directionLabel(store.currentDoa),
      speakerId: 0,
      audioState: store.audioState,
      emotion: store.emotion,
      confidence: store.confidence,
      speakerCount: store.speakerCount,
      timestamp: Date.now(),
    });
    store.setLiveTranscript('');
    store.setStreamingWord('');
  }

  private showPartial(text: string, source: 'VOSK' | 'WHISPER') {
    if (!isSensitiveCaptureAllowed()) return;
    appSession.touch(Date.now());
    const partial = text.trim();
    if (isPlaceholder(partial) || partial === this.currentPartial) return;
    this.currentPartial = partial;
    this.partialSource = source;
    useCompassStore.getState().setStreamingWord(partial);
  }

  private applyLiveHypothesis(text: string, source: 'VOSK' | 'WHISPER') {
    if (isPlaceholder(text)) return;

    if (source === 'WHISPER') {
      if (!this.currentPartial || isBetterHypothesis(text, this.currentPartial)) {
        this.showPartial(text, 'WHISPER');
      }
      return;
    }

    // Vosk: paint immediately. Do not clobber a longer Whisper refinement
    // unless Vosk has clearly moved on to new words.
    if (
      this.partialSource === 'WHISPER' &&
      this.currentPartial &&
      text.length + 8 < this.currentPartial.length
    ) {
      return;
    }
    this.showPartial(text, 'VOSK');
  }

  private armSilenceCommit() {
    this.clearSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      if (isPlaceholder(this.currentPartial)) return;

      const flushed = this.liveEngine.flush?.();
      const text = flushed?.text?.trim() || this.currentPartial;
      this.commitFinal(text);
      if (this.whisperSelected()) getEngine('WHISPER').flush?.();
    }, SILENCE_COMMIT_MS);
  }

  private bind(engine: SttEngine) {
    engine.onResult((result) => {
      if (!isSensitiveCaptureAllowed()) return;
      const store = useCompassStore.getState();
      if (store.transcriptionPaused) return;

      const text = result.text?.trim() ?? '';
      if (!text) return;

      if (!isLiveSttEngine(engine.id)) {
        if (result.isFinal) {
          store.appendTranscriptWord(text, store.currentDoa, store.audioState);
          setTimeout(() => store.finalizeUtterance(), 400);
        } else {
          store.appendTranscriptWord(text, store.currentDoa, store.audioState);
        }
        return;
      }

      if (result.isFinal && this.whisperSelected() && engine.id === 'VOSK') {
        this.applyLiveHypothesis(text, 'VOSK');
        this.armSilenceCommit();
        return;
      }

      if (result.isFinal) {
        this.commitFinal(text);
        return;
      }

      this.applyLiveHypothesis(text, engine.id === 'WHISPER' ? 'WHISPER' : 'VOSK');
      this.armSilenceCommit();
    });
  }

  /** Whisper rewrites the live line, then the last finished line if it was early. */
  private bindWhisperUpgrade() {
    getEngine('WHISPER').onResult((result) => {
      if (!isSensitiveCaptureAllowed()) return;
      const text = result.text?.trim();
      if (!text) return;
      const store = useCompassStore.getState();
      if (store.transcriptionPaused) return;

      if (!result.isFinal) {
        this.applyLiveHypothesis(text, 'WHISPER');
        return;
      }

      if (!isPlaceholder(this.currentPartial)) {
        this.applyLiveHypothesis(text, 'WHISPER');
        return;
      }

      const last = store.sessionLog[store.sessionLog.length - 1];
      if (last && Date.now() - last.timestamp < 8000 && isBetterHypothesis(text, last.text)) {
        store.reviseLastTranscript(text);
        this.lastCommitted = text;
        return;
      }

      if (!last || Date.now() - last.timestamp >= 8000) {
        this.commitFinal(text);
      }
    });
  }

  setEngine(id: SttEngineId) {
    const next = resolveEngine(id);
    const live = pickLiveEngine(id);
    if (id !== this.selectedId || live.id !== this.liveEngine.id) {
      this.clearSilenceTimer();
      if (this.engine !== this.liveEngine) void this.engine.unload();
      this.modelReady = false;
      this.selectedId = id;
      this.engine = next;
      this.liveEngine = live;
      this.bind(this.liveEngine);
    }
    if (this.bleListening) {
      void this.ensureModel();
    }
  }

  getEngineLabel(): string {
    return this.whisperSelected() ? `${this.liveEngine.label} + Whisper` : this.liveEngine.label;
  }

  getEngineNote(): string {
    const vosk = getEngine('VOSK');
    if (vosk.isAvailable()) {
      return this.selectedId === 'WHISPER'
        ? 'Words appear the instant the compass hears them. Whisper then corrects the same line toward what was said. Phone mic off.'
        : `${vosk.label} · words appear as the compass hears them. Phone mic off.`;
    }
    const requested = getEngine(this.selectedId);
    if (requested.isAvailable()) {
      return `${requested.label} · BLE ${this.streamRateHz} Hz. Words stream as they are heard. Phone mic off.`;
    }
    return `${requested.unavailableReason()} Using ${this.liveEngine.label} until then.`;
  }

  getBleStats(): BleSttStats {
    const elapsedSec = Math.max((Date.now() - (this.windowStartedAt || Date.now())) / 1000, 0.001);
    return {
      a1Count: this.a1Count,
      pcmBytes: this.pcmBytes,
      bytesPerSec: Math.round(this.pcmBytes / elapsedSec),
      lastError: this.lastError,
      sampleRateHz: this.streamRateHz,
      listening: this.bleListening,
    };
  }

  private async ensureModel(): Promise<boolean> {
    this.liveEngine = pickLiveEngine(this.selectedId);
    this.engine = resolveEngine(this.selectedId);
    this.bind(this.liveEngine);

    if (!this.liveEngine.isAvailable()) {
      this.modelReady = false;
      this.lastError =
        this.liveEngine.unavailableReason() ||
        'Speech decoder missing — rebuild the development client';
      this.publishStatus(this.lastError);
      return false;
    }

    try {
      const ok = await this.liveEngine.load();
      this.modelReady = ok && isLiveSttEngine(this.liveEngine.id);
      if (!ok) {
        this.lastError =
          this.liveEngine.unavailableReason() || `${this.liveEngine.label} failed to load`;
        this.publishStatus(this.lastError);
        return false;
      }
      this.lastError = null;
      if (this.selectedId === 'WHISPER' && getEngine('WHISPER').isAvailable()) {
        void getEngine('WHISPER').load();
      }
      return true;
    } catch (error) {
      this.modelReady = false;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.publishStatus(this.lastError);
      return false;
    }
  }

  /**
   * After TX Notify is on: ensure the decoder is loaded once, then accept a
   * continuous BLE PCM stream. Does not open the phone microphone.
   */
  async startBleListening(): Promise<boolean> {
    this.stopDemoStream();
    this.bleListening = true;
    this.a1Count = 0;
    this.pcmBytes = 0;
    this.windowStartedAt = Date.now();
    this.lastStarvationLogAt = 0;
    this.currentPartial = '';
    this.partialSource = '';
    this.lastCommitted = '';
    this.clearSilenceTimer();
    useCompassStore.getState().setStreamingWord('');

    const ok = await this.ensureModel();
    if (ok) {
      this.publishStatus('Listening to ESP32 mic (BLE only)…');
      if (__DEV__) {
        console.log('[speechService] continuous BLE STT ready', this.getEngineLabel());
      }
    }
    return ok;
  }

  stopBleListening() {
    this.bleListening = false;
    this.clearSilenceTimer();
    this.publishStatus('');
  }

  /**
   * Append one 0xA1 PCM window (base64 int16 LE mono) into the open
   * recognizer. Never restarts Vosk. Never uses the phone mic.
   */
  processBlePcm(base64Pcm: string, doa: number, sampleRateHz = COMPASS_PCM_SAMPLE_RATE_HZ) {
    if (!base64Pcm) return;
    if (sampleRateHz >= 8000) this.streamRateHz = sampleRateHz;

    if (!this.bleListening) {
      void this.startBleListening();
    } else if (!this.modelReady && this.a1Count > 0 && this.a1Count % 80 === 0) {
      void this.ensureModel();
    }

    this.a1Count += 1;
    this.pcmBytes += Math.floor((base64Pcm.length * 3) / 4);

    if (!isLiveSttEngine(this.liveEngine.id) || !this.modelReady) {
      if (this.a1Count === 1 || this.a1Count % STARVATION_LOG_EVERY === 0) {
        this.lastError =
          this.liveEngine.unavailableReason() ||
          this.lastError ||
          `Receiving mic audio — ${this.liveEngine.label} is still loading`;
        this.publishStatus(this.lastError);
      }
      return;
    }

    if (this.a1Count % 4 === 0) {
      try {
        const mean = pcmMeanAbs(decodeInt16LePcm(base64Pcm));
        if (mean >= SILENCE_MEAN_ABS) {
          this.clearSilenceTimer();
        } else if (this.currentPartial && !this.silenceTimer) {
          this.armSilenceCommit();
        }
      } catch {
        /* ignore decode errors */
      }
    }

    try {
      this.liveEngine.pushAudio(base64Pcm, { doa, state: 'SINGLE', sampleRateHz: this.streamRateHz });
      if (this.selectedId === 'WHISPER' && getEngine('WHISPER').isAvailable()) {
        getEngine('WHISPER').pushAudio(base64Pcm, {
          doa,
          state: 'SINGLE',
          sampleRateHz: this.streamRateHz,
        });
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.publishStatus(this.lastError);
      if (__DEV__) console.warn('[speechService] STT push error', this.lastError);
    }

    if (this.a1Count % STATUS_PUBLISH_EVERY === 0) {
      const store = useCompassStore.getState();
      const hint =
        store.liveTranscript || store.streamingWord
          ? ''
          : this.lastError ||
            `Hearing mic (${this.a1Count} pkts) — speak; words appear as they are heard`;
      this.publishStatus(hint);
    }

    this.maybeLogStarvation();
  }

  /** Legacy necklace JSON path only — not used on the compass live screen. */
  processAudioChunk(base64: string, doa: number, state: AudioStateName) {
    if (!this.bleListening) return;
    if (state === 'SILENCE' || state === 'NOISE') return;
    if (!base64 || !isLiveSttEngine(this.liveEngine.id)) return;
    this.liveEngine.pushAudio(base64, { doa, state });
  }

  noteDirectionUpdate() {
    this.maybeLogStarvation(true);
  }

  private maybeLogStarvation(fromDirection = false) {
    const store = useCompassStore.getState();
    if (store.liveTranscript || store.streamingWord) return;
    if (this.a1Count === 0) {
      if (fromDirection) {
        this.publishStatus('Direction locked — waiting for 0xA1 mic PCM…');
      }
      return;
    }
    if (!fromDirection && this.a1Count % STARVATION_LOG_EVERY !== 0) return;

    const now = Date.now();
    if (now - this.lastStarvationLogAt < 2000) return;
    this.lastStarvationLogAt = now;

    const stats = this.getBleStats();
    const hint = `Audio in (${stats.a1Count} pkts) but no words yet — ${
      stats.lastError ?? 'speak clearly / check mic gain'
    }`;
    this.publishStatus(hint);
    console.warn('[speechService] empty transcript', stats);
  }

  /** Demo Mode only — not used while SAC-Compass BLE STT is active. */
  startDemoStream() {
    if (this.bleListening) return;
    this.stopDemoStream();
    this.demoTimer = setInterval(() => {
      const store = useCompassStore.getState();
      if (store.audioState === 'SILENCE' || store.transcriptionPaused) return;
      this.engine.pushAudio('', { doa: store.currentDoa, state: store.audioState });
    }, DEMO_TICK_MS);
  }

  stopDemoStream() {
    if (this.demoTimer) {
      clearInterval(this.demoTimer);
      this.demoTimer = null;
    }
  }
}

export const speechService = new SpeechService();
