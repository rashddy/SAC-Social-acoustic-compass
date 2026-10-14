import { createVoskEngine } from './nativeEngines';
import { createSimulatedEngine } from './simulatedEngine';
import type { SttEngine, SttEngineId } from './types';
import { createWhisperEngine } from './whisperEngine';

const registry: Record<SttEngineId, SttEngine> = {
  SIMULATED: createSimulatedEngine(),
  VOSK: createVoskEngine(),
  WHISPER: createWhisperEngine(),
};

/** Falls back to the simulated engine when the requested decoder is unlinked. */
export const resolveEngine = (id: SttEngineId): SttEngine => {
  const requested = registry[id];
  return requested?.isAvailable() ? requested : registry.SIMULATED;
};

export const getEngine = (id: SttEngineId): SttEngine => registry[id];

export { isLiveSttEngine } from './types';
export type { SttEngine, SttEngineId, SttResult } from './types';
