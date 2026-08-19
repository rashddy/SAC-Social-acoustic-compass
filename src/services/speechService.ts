import type { AudioStateName } from '@/constants/bleConstants';
import { getEngine, resolveEngine, type SttEngine, type SttEngineId } from '@/services/stt';
import { useCompassStore } from '@/store/compassStore';

const DEMO_TICK_MS = 350;

class SpeechService {
  private selectedId: SttEngineId = 'VOSK';
  private engine: SttEngine = resolveEngine('VOSK');
  private demoTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.bind(this.engine);
  }

  /** Routes decoder output into the transcript, finalizing on sentence ends. */
  private bind(engine: SttEngine) {
    engine.onResult((result) => {
      const store = useCompassStore.getState();
      if (store.transcriptionPaused) return;

      store.appendTranscriptWord(result.text, store.currentDoa, store.audioState);
      if (result.isFinal) setTimeout(() => store.finalizeUtterance(), 400);
    });
  }

  setEngine(id: SttEngineId) {
    if (id === this.selectedId) return;

    this.engine.unload();
    this.selectedId = id;
    this.engine = resolveEngine(id);
    this.bind(this.engine);
    this.engine.load();
  }

  getEngineLabel(): string {
    return this.engine.label;
  }

  /** Explains in Settings when the chosen decoder isn't actually running. */
  getEngineNote(): string {
    const requested = getEngine(this.selectedId);
    if (requested.isAvailable()) return `${requested.label} is active.`;
    return `${requested.unavailableReason()} Using ${this.engine.label} until then.`;
  }

  processAudioChunk(base64: string, doa: number, state: AudioStateName) {
    if (state === 'SILENCE' || state === 'NOISE') return;
    this.engine.pushAudio(base64, { doa, state });
  }

  /** Simulated word stream used by demo mode when no audio arrives over BLE. */
  startDemoStream() {
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
