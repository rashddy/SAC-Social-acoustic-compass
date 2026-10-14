import type { AudioStateName } from '@/constants/bleConstants';

export type SttEngineId = 'SIMULATED' | 'VOSK' | 'WHISPER';

/** Native decoders that consume compass BLE PCM (not the phone mic). */
export const LIVE_STT_ENGINES: ReadonlySet<SttEngineId> = new Set(['VOSK', 'WHISPER']);

export const isLiveSttEngine = (id: SttEngineId): boolean => LIVE_STT_ENGINES.has(id);

export type SttResult = {
  /** Word or phrase decoded from the audio stream. */
  text: string;
  /** False while the decoder may still revise the text. */
  isFinal: boolean;
  confidence: number;
};

/**
 * Contract every offline speech-to-text backend implements.
 * BLE compass path: continuous PCM push into one loaded recognizer — never
 * restart the model per packet.
 */
export type SttEngine = {
  readonly id: SttEngineId;
  readonly label: string;
  isAvailable(): boolean;
  unavailableReason(): string;
  /** Load model once; keep it warm across packets. */
  load(): Promise<boolean>;
  unload(): Promise<void>;
  /** Append PCM to the open recognizer (base64 int16 LE). */
  pushAudio(
    base64Pcm: string,
    context: { doa: number; state: AudioStateName; sampleRateHz?: number },
  ): void;
  /**
   * Force-end the current utterance (silence commit). Returns final text if any.
   * Optional — engines without endpoint flush may no-op.
   */
  flush?(): SttResult | null;
  onResult(handler: (result: SttResult) => void): void;
};
