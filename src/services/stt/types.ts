import type { AudioStateName } from '@/constants/bleConstants';

export type SttEngineId = 'SIMULATED' | 'VOSK' | 'WHISPER';

export type SttResult = {
  /** Word or phrase decoded from the audio window. */
  text: string;
  /** False while the decoder may still revise the text. */
  isFinal: boolean;
  confidence: number;
};

/**
 * Contract every offline speech-to-text backend implements. It exists so the app
 * can ship today against the simulated engine and switch to a real decoder
 * without touching any screen: only `sttRegistry` changes.
 */
export type SttEngine = {
  readonly id: SttEngineId;
  readonly label: string;
  /** True when the backing native module is present and a model is installed. */
  isAvailable(): boolean;
  /** Human-readable reason shown in Settings when unavailable. */
  unavailableReason(): string;
  load(): Promise<boolean>;
  unload(): Promise<void>;
  /** Feeds one base64 PCM window from the necklace; emits via `onResult`. */
  pushAudio(base64Pcm: string, context: { doa: number; state: AudioStateName }): void;
  onResult(handler: (result: SttResult) => void): void;
};
