import * as FileSystem from 'expo-file-system/legacy';
import { NativeModules, Platform } from 'react-native';
import { initWhisper, type WhisperContext } from 'whisper.rn/index';

import type { SttEngine, SttResult } from './types';
import {
  WHISPER_FALLBACK_FILENAME,
  WHISPER_GGML_FALLBACK_URL,
  WHISPER_GGML_URL,
  WHISPER_MERGED_FILENAME,
  WHISPER_MIN_BYTES,
  WHISPER_MODEL_FILENAME,
  WHISPER_MODEL_LABEL,
  WHISPER_TINY_FALLBACK_URL,
  WHISPER_TINY_FILENAME,
  labelForWhisperPath,
} from './whisperModelMeta';
import {
  applyPcmGain,
  decodeInt16LePcm,
  pcmMeanAbs,
  upsample8kTo16k,
} from '@/utils/pcm';

/** One correction after the speaker pauses. Live words come from Vosk. */
const WINDOW_MS = 2200;
const IGNORE_TEXT =
  /^(thank you\.?|thanks for watching\.?|thanks\.?|you\.?|the\.?|a\.?|\.+|uh|um|hmm|subscribe|please subscribe|bye\.?)$/i;

const hasNativeWhisper = (): boolean =>
  Platform.OS !== 'web' && NativeModules.RNWhisper != null;

const formatError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const maybe = error as { message?: unknown };
    if (typeof maybe.message === 'string' && maybe.message) return maybe.message;
    try {
      return JSON.stringify(error);
    } catch {
      /* ignore */
    }
  }
  return String(error);
};

const toFsPath = (uri: string): string =>
  uri.startsWith('file://') ? uri.slice('file://'.length) : uri;

/** Copy int16 PCM into its own ArrayBuffer — whisper.rn realtime path. */
const pcmToInt16Buffer = (samples: Int16Array): ArrayBuffer => {
  const copy = new Int16Array(samples.length);
  copy.set(samples);
  return copy.buffer;
};

const cleanText = (raw: string): string => {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || IGNORE_TEXT.test(text)) return '';
  return text;
};

const isUsableModel = async (uri: string): Promise<boolean> => {
  const info = await FileSystem.getInfoAsync(uri);
  return Boolean(info.exists && (info.size ?? 0) >= WHISPER_MIN_BYTES);
};

async function downloadModel(url: string, dest: string): Promise<void> {
  const result = await FileSystem.downloadAsync(url, dest);
  if (result.status !== 200) {
    throw new Error(`Model download HTTP ${result.status}`);
  }
  if (!(await isUsableModel(dest))) {
    throw new Error('Downloaded Whisper file is too small — check the network and retry');
  }
}

async function resolveModelPath(onStatus: (hint: string) => void): Promise<string> {
  const root = FileSystem.documentDirectory;
  if (!root) throw new Error('No document directory — expo-file-system is not linked');

  const dir = `${root}whisper`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);

  const merged = `${dir}/${WHISPER_MERGED_FILENAME}`;
  const small = `${dir}/${WHISPER_MODEL_FILENAME}`;
  const base = `${dir}/${WHISPER_FALLBACK_FILENAME}`;
  const tiny = `${dir}/${WHISPER_TINY_FILENAME}`;
  const tinyLegacy = `${dir}/ggml-tiny.en.bin`;

  if (await isUsableModel(merged)) return toFsPath(merged);
  if (await isUsableModel(small)) return toFsPath(small);

  onStatus('Downloading accurate Whisper model… keep Wi-Fi on (one-time, ~85 MB)');
  try {
    await downloadModel(WHISPER_GGML_URL, small);
    return toFsPath(small);
  } catch (first) {
    if (__DEV__) console.warn('[whisper] small.en download failed', formatError(first));
    if (await isUsableModel(base)) return toFsPath(base);
    onStatus('Retrying a lighter Whisper model…');
    try {
      await downloadModel(WHISPER_GGML_FALLBACK_URL, base);
      return toFsPath(base);
    } catch (second) {
      if (__DEV__) console.warn('[whisper] base.en download failed', formatError(second));
      if (await isUsableModel(tiny)) return toFsPath(tiny);
      if (await isUsableModel(tinyLegacy)) return toFsPath(tinyLegacy);
      onStatus('Retrying the smallest Whisper model…');
      await downloadModel(WHISPER_TINY_FALLBACK_URL, tiny);
      return toFsPath(tiny);
    }
  }
}

export const createWhisperEngine = (): SttEngine => {
  let handler: ((result: SttResult) => void) | null = null;
  let context: WhisperContext | null = null;
  let chunks: string[] = [];
  let bufferedSamples = 0;
  let inputRate = 8000;
  let loadFailedReason: string | null = null;
  let modelReady = false;
  let busy = false;
  let queuedForce = false;
  let loading = false;
  let modelLabel = WHISPER_MODEL_LABEL;
  let lastPrompt = '';

  const emit = (text: string, isFinal: boolean) => {
    const cleaned = cleanText(text);
    if (!cleaned) return;
    if (isFinal) lastPrompt = cleaned;
    handler?.({ text: cleaned, isFinal, confidence: isFinal ? 0.9 : 0.72 });
  };

  const samplesFor = (ms: number) => Math.max(1, Math.round((inputRate * ms) / 1000));

  const estimatedSamples = (base64: string) => Math.floor((base64.length * 3) / 8);

  const takeWindow = (): Int16Array => {
    const parts = chunks.map((chunk) => decodeInt16LePcm(chunk));
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const merged = new Int16Array(total);
    let offset = 0;
    for (const part of parts) {
      merged.set(part, offset);
      offset += part.length;
    }
    const keep = samplesFor(WINDOW_MS);
    return merged.length > keep ? merged.subarray(merged.length - keep) : merged;
  };

  const decodePending = () => {
    if (!context || !modelReady || chunks.length === 0) return;
    if (busy) {
      queuedForce = true;
      return;
    }

    const chunk = takeWindow();
    chunks = [];
    bufferedSamples = 0;
    if (pcmMeanAbs(chunk) < 8) return;

    const gained = applyPcmGain(chunk, 1800, 6);
    const audio = inputRate >= 12000 ? gained : upsample8kTo16k(gained);
    busy = true;
    queuedForce = false;

    const { promise } = context.transcribeData(pcmToInt16Buffer(audio), {
      language: 'en',
      translate: false,
      maxThreads: 2,
      temperature: 0,
      beamSize: 1,
    });

    void promise
      .then((result) => {
        emit(result.result ?? '', true);
      })
      .catch((error: unknown) => {
        loadFailedReason = formatError(error);
        if (__DEV__) console.warn('[whisper] transcribe failed', loadFailedReason);
      })
      .finally(() => {
        busy = false;
        if (queuedForce && chunks.length > 0) decodePending();
      });
  };

  return {
    id: 'WHISPER',
    get label() {
      return modelLabel;
    },
    isAvailable: hasNativeWhisper,
    unavailableReason: () =>
      hasNativeWhisper()
        ? loadFailedReason ?? ''
        : 'Whisper needs an Android development build with whisper.rn. Run npm run build:dev, then npm run start:dev-client.',

    async load() {
      if (!hasNativeWhisper()) return false;
      if (modelReady && context) return true;
      if (loading) return false;
      loading = true;

      loadFailedReason = 'Loading Whisper…';
      queuedForce = false;
      try {
        const filePath = await resolveModelPath((hint) => {
          loadFailedReason = hint;
        });
        loadFailedReason = 'Starting Whisper…';
        context = await initWhisper({
          filePath,
          useGpu: false,
        });
        modelReady = true;
        loadFailedReason = null;
        modelLabel = labelForWhisperPath(filePath);
        if (__DEV__) console.log('[whisper] loaded', filePath);
        return true;
      } catch (error) {
        modelReady = false;
        context = null;
        loadFailedReason = formatError(error);
        if (__DEV__) console.warn('[whisper] load failed', loadFailedReason);
        return false;
      } finally {
        loading = false;
      }
    },

    async unload() {
      chunks = [];
      bufferedSamples = 0;
      queuedForce = false;
      lastPrompt = '';
      modelReady = false;
      const ctx = context;
      context = null;
      if (!ctx) return;
      try {
        await ctx.release();
      } catch {
        /* ignore */
      }
    },

    pushAudio(base64Pcm, audioContext) {
      if (!base64Pcm) return;
      if (audioContext?.sampleRateHz && audioContext.sampleRateHz >= 8000) {
        inputRate = audioContext.sampleRateHz >= 12000 ? 16000 : 8000;
      }
      chunks.push(base64Pcm);
      bufferedSamples += estimatedSamples(base64Pcm);
      const keep = samplesFor(WINDOW_MS);
      while (bufferedSamples > keep && chunks.length > 1) {
        const removed = chunks.shift();
        if (!removed) break;
        bufferedSamples -= estimatedSamples(removed);
      }
    },

    flush() {
      decodePending();
      return null;
    },

    onResult(next) {
      handler = next;
    },
  };
};
