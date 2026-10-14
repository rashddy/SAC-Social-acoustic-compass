import { decodeBase64ToBytes, encodeBytesToBase64 } from '@/utils/base64';

/** Decode base64 int16 little-endian mono PCM into samples. */
export function decodeInt16LePcm(base64: string): Int16Array {
  const bytes = decodeBase64ToBytes(base64);
  const n = Math.floor(bytes.length / 2);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i += 1) {
    const lo = bytes[i * 2] ?? 0;
    const hi = bytes[i * 2 + 1] ?? 0;
    out[i] = ((hi << 8) | lo) << 16 >> 16;
  }
  return out;
}

export function encodeInt16LePcm(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i]!;
    bytes[i * 2] = s & 0xff;
    bytes[i * 2 + 1] = (s >> 8) & 0xff;
  }
  return encodeBytesToBase64(bytes);
}

/** Mean absolute amplitude 0..32767 — near 0 means silence / wrong I2S shift. */
export function pcmMeanAbs(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sum += Math.abs(samples[i]!);
  }
  return sum / samples.length;
}

/**
 * Boost quiet INMP441 levels for Vosk. Soft-clip to int16.
 * targetMean ~1200 keeps speech in a usable range without crushing peaks.
 */
export function applyPcmGain(samples: Int16Array, targetMean = 1800, maxGain = 6): Int16Array {
  const mean = pcmMeanAbs(samples);
  if (mean < 1) return samples;

  let gain = targetMean / mean;
  if (gain < 1) gain = 1;
  if (gain > maxGain) gain = maxGain;

  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    let v = Math.round(samples[i]! * gain);
    if (v > 32767) v = 32767;
    if (v < -32768) v = -32768;
    out[i] = v;
  }
  return out;
}

/**
 * Linear upsample 8 kHz → 16 kHz. BLE stays at 8 kHz; Vosk/Whisper run at 16 kHz.
 * Linear interpolation keeps formants cleaner than repeating each sample.
 */
export function upsample8kTo16k(samples8k: Int16Array): Int16Array {
  if (samples8k.length === 0) return new Int16Array(0);
  const out = new Int16Array(samples8k.length * 2);
  for (let i = 0; i < samples8k.length; i += 1) {
    const a = samples8k[i]!;
    const b = samples8k[i + 1] ?? a;
    out[i * 2] = a;
    out[i * 2 + 1] = (a + b) >> 1;
  }
  return out;
}
