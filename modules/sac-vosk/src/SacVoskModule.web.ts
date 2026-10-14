import type { SacVoskPushResult } from './SacVosk.types';

const empty = (): SacVoskPushResult => ({
  text: '',
  isFinal: false,
  confidence: 0,
});

/** Web has no Vosk native binary; callers must fall back to the simulated engine. */
export default {
  DEFAULT_SAMPLE_RATE: 16000,
  DEFAULT_MODEL_ASSET: 'model-en-us',
  isLoaded: () => false,
  loadModel: async () => false,
  pushAudio: () => empty(),
  flush: () => empty(),
  unload: async () => {},
};
