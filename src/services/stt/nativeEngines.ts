import { Platform } from 'react-native';

import type { SttEngine, SttResult } from './types';
import {
  applyPcmGain,
  decodeInt16LePcm,
  encodeInt16LePcm,
  pcmMeanAbs,
  upsample8kTo16k,
} from '@/utils/pcm';

type SacVoskNative = {
  isLoaded: () => boolean;
  loadModel: (assetName?: string | null, sampleRate?: number | null) => Promise<boolean>;
  pushAudio: (base64Pcm: string) => { text: string; isFinal: boolean; confidence: number };
  flush: () => { text: string; isFinal: boolean; confidence: number };
  unload: () => Promise<void>;
};

/** Packaged English model: vosk-model-small-en-us-0.15 (16 kHz). */
const MODEL_ASSET = 'model-en-us';
/** Model sample rate. 16 kHz BLE is pushed as-is; 8 kHz is upsampled once. */
const VOSK_SAMPLE_RATE = 16000;
/** ~25 ms of audio per native push so words show up sooner. */
const ACCUMULATE_MS = 25;

const getSacVosk = (): SacVoskNative | null => {
  if (Platform.OS !== 'android') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } = require('expo-modules-core') as {
      requireOptionalNativeModule: (name: string) => SacVoskNative | null;
    };
    return requireOptionalNativeModule('SacVosk');
  } catch {
    return null;
  }
};

export const createVoskEngine = (): SttEngine => {
  let handler: ((result: SttResult) => void) | null = null;
  let lastPartial = '';
  let loadFailedReason: string | null = null;
  let pending: number[] = [];
  let inputRate = 8000;
  let lastMeanAbs = 0;
  /** True after a successful load — pushAudio must not trigger another load. */
  let modelReady = false;

  const available = (): boolean => getSacVosk() != null;

  const emit = (result: { text: string; isFinal: boolean; confidence: number }) => {
    const text = result.text?.trim() ?? '';
    if (!text) return;

    if (result.isFinal) {
      lastPartial = '';
      handler?.({ text, isFinal: true, confidence: result.confidence || 0.85 });
      return;
    }

    if (text === lastPartial) return;
    lastPartial = text;
    // Full cumulative partial — speechService shows it beside committed text.
    handler?.({ text, isFinal: false, confidence: result.confidence || 0.5 });
  };

  const accumulateCount = () => Math.max(160, Math.round((inputRate * ACCUMULATE_MS) / 1000));

  const flushPending = (native: SacVoskNative, force = false) => {
    const need = accumulateCount();
    while (pending.length >= need || (force && pending.length > 0)) {
      const take = force ? pending.length : Math.min(need, pending.length);
      if (take <= 0) break;

      const chunk = Int16Array.from(pending.splice(0, take));
      lastMeanAbs = pcmMeanAbs(chunk);
      const gained = applyPcmGain(chunk);
      const audio = inputRate >= 12000 ? gained : upsample8kTo16k(gained);

      try {
        emit(native.pushAudio(encodeInt16LePcm(audio)));
      } catch (error) {
        loadFailedReason = error instanceof Error ? error.message : String(error);
        if (__DEV__) console.warn('[vosk] pushAudio failed', loadFailedReason);
        throw error instanceof Error ? error : new Error(String(error));
      }
    }
  };

  return {
    id: 'VOSK',
    label: 'Vosk en-US (offline)',
    isAvailable: available,
    unavailableReason: () =>
      available()
        ? loadFailedReason ?? ''
        : 'Vosk needs an Android development build with sac-vosk + vosk-model-small-en-us-0.15 (npm run vosk:model && npm run build:dev).',

    async load() {
      const native = getSacVosk();
      if (!native) return false;

      // Keep the warm recognizer — continuous stream must not restart mid-session.
      if (modelReady && native.isLoaded()) {
        return true;
      }

      lastPartial = '';
      pending = [];
      loadFailedReason = null;
      try {
        const ok = await native.loadModel(MODEL_ASSET, VOSK_SAMPLE_RATE);
        modelReady = ok;
        if (!ok) loadFailedReason = `Vosk loadModel returned false @ ${VOSK_SAMPLE_RATE} Hz`;
        return ok;
      } catch (error) {
        modelReady = false;
        loadFailedReason = error instanceof Error ? error.message : String(error);
        if (__DEV__) console.warn('[vosk]', loadFailedReason);
        return false;
      }
    },

    async unload() {
      lastPartial = '';
      modelReady = false;
      const native = getSacVosk();
      if (native && pending.length > 0) {
        try {
          flushPending(native, true);
        } catch {
          /* ignore */
        }
      }
      pending = [];
      if (!native) return;
      try {
        const flushed = native.flush();
        if (flushed.text?.trim()) {
          handler?.({
            text: flushed.text.trim(),
            isFinal: true,
            confidence: flushed.confidence || 0.8,
          });
        }
        await native.unload();
      } catch {
        /* ignore */
      }
    },

    pushAudio(base64Pcm, context) {
      const native = getSacVosk();
      if (!native || !base64Pcm || !modelReady) return;
      if (context?.sampleRateHz && context.sampleRateHz >= 8000) {
        inputRate = context.sampleRateHz >= 12000 ? 16000 : 8000;
      }

      const samples = decodeInt16LePcm(base64Pcm);
      for (let i = 0; i < samples.length; i += 1) {
        pending.push(samples[i]!);
      }
      flushPending(native, false);

      if (lastMeanAbs < 30 && pending.length === 0) {
        loadFailedReason = `Mic level too low (mean=${lastMeanAbs.toFixed(0)}) — check I2S gain/wiring`;
      } else if (lastMeanAbs >= 30) {
        loadFailedReason = null;
      }
    },

    flush() {
      const native = getSacVosk();
      if (!native || !modelReady) return null;
      try {
        flushPending(native, true);
        const flushed = native.flush();
        const text = flushed.text?.trim() ?? '';
        lastPartial = '';
        // Do not emit via handler here — speechService commits once from the return value
        // (avoids double-append when silence timer calls flush).
        if (!text) return null;
        return {
          text,
          isFinal: true as const,
          confidence: flushed.confidence || 0.8,
        };
      } catch (error) {
        loadFailedReason = error instanceof Error ? error.message : String(error);
        return null;
      }
    },

    onResult(next) {
      handler = next;
    },
  };
};
