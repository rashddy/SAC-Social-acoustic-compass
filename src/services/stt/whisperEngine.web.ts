import type { SttEngine } from './types';

export const createWhisperEngine = (): SttEngine => ({
  id: 'WHISPER',
  label: 'Whisper small.en (offline)',
  isAvailable: () => false,
  unavailableReason: () => 'Whisper needs an Android development build with whisper.rn.',
  async load() {
    return false;
  },
  async unload() {},
  pushAudio() {},
  onResult() {},
});
