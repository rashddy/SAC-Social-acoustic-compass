/**
 * Phone-sized ggml. The SAC Drive folder is a PEFT LoRA on
 * openai/whisper-small — merge it with `npm run whisper:model` (Python + torch)
 * to produce ggml-sac-whisper.bin. Until then we use English small-q5_1
 * (~85 MB, one Wi-Fi download) so live captions can stay close to what was said.
 */
export const WHISPER_GGML_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin';
export const WHISPER_GGML_FALLBACK_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en-q5_1.bin';
export const WHISPER_TINY_FALLBACK_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q5_1.bin';
export const WHISPER_MODEL_FILENAME = 'ggml-small.en-q5_1.bin';
export const WHISPER_FALLBACK_FILENAME = 'ggml-base.en-q5_1.bin';
export const WHISPER_TINY_FILENAME = 'ggml-tiny.en-q5_1.bin';
export const WHISPER_MERGED_FILENAME = 'ggml-sac-whisper.bin';
export const WHISPER_MODEL_LABEL = 'Whisper small.en (offline)';
export const WHISPER_MIN_BYTES = 25_000_000;

export const labelForWhisperPath = (filePath: string): string => {
  if (filePath.includes(WHISPER_MERGED_FILENAME)) return 'Whisper SAC fine-tune (offline)';
  if (filePath.includes('small.en')) return 'Whisper small.en (offline)';
  if (filePath.includes('base.en')) return 'Whisper base.en (offline)';
  if (filePath.includes('tiny.en')) return 'Whisper tiny.en (offline)';
  return WHISPER_MODEL_LABEL;
};
