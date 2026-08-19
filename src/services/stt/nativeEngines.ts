import { NativeModules, Platform } from 'react-native';

import type { SttEngine, SttEngineId } from './types';

/**
 * Adapters for the two real offline decoders named in the capstone document.
 *
 * Neither ships in this build: both need a native module plus a downloaded
 * acoustic model, which requires a development build and a trained model that
 * does not exist yet. They are kept here so swapping in a real decoder is a
 * change to `attach()` only, with no screen or store changes.
 *
 * To finish the Vosk path:
 *   1. `npx expo install react-native-vosk` and rebuild the dev client.
 *   2. Bundle a model under `assets/models/vosk-model-small-en-us`.
 *   3. Implement `load`/`pushAudio` below against that module's API.
 */
const stub = (
  id: SttEngineId,
  label: string,
  nativeModuleName: string,
  setupNote: string,
): SttEngine => {
  const available = (): boolean =>
    Platform.OS !== 'web' && NativeModules[nativeModuleName] != null;

  return {
    id,
    label,
    isAvailable: available,
    unavailableReason: () =>
      available() ? '' : `${label} needs a development build: ${setupNote}`,

    async load() {
      return false;
    },

    async unload() {},

    pushAudio() {
      // No decoder linked; the service falls back to the simulated engine.
    },

    onResult() {
      // Nothing can emit results until a real decoder is wired up above.
    },
  };
};

export const createVoskEngine = (): SttEngine =>
  stub(
    'VOSK',
    'Vosk (offline)',
    'Vosk',
    'install react-native-vosk and bundle an acoustic model.',
  );

export const createWhisperEngine = (): SttEngine =>
  stub(
    'WHISPER',
    'Whisper.rn (offline)',
    'RNWhisper',
    'install whisper.rn and bundle a ggml model.',
  );
