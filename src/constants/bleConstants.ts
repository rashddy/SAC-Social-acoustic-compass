/**
 * BLE contract shared with the ESP32 firmware.
 *
 * Both wearables expose the same Nordic UART-style service so the app can talk
 * to either one through a single code path:
 *   notify characteristic  device -> phone (telemetry JSON)
 *   write characteristic   phone -> device (command JSON)
 */
export const BLE_SERVICE_UUID = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';
export const BLE_NOTIFY_CHAR_UUID = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E';
export const BLE_WRITE_CHAR_UUID = '6E400002-B5A3-F393-E0A9-E50E24DCCA9E';

/** The two IoT nodes of the SAC system. */
export type DeviceRole = 'NECKLACE' | 'WRISTBAND';

export const DEVICE_ROLES: DeviceRole[] = ['NECKLACE', 'WRISTBAND'];

/** Advertised name prefix used to classify a scan result into a role. */
export const DEVICE_NAME_PREFIX: Record<DeviceRole, string> = {
  NECKLACE: 'SAC-Necklace',
  WRISTBAND: 'SAC-Wristband',
};

export const DEVICE_LABEL: Record<DeviceRole, string> = {
  NECKLACE: 'SAC-Necklace',
  WRISTBAND: 'SAC-Wristband',
};

export const DEVICE_DESCRIPTION: Record<DeviceRole, string> = {
  NECKLACE: 'ESP32-S3 · 3× INMP441 mic array · TDOA + TinyML',
  WRISTBAND: 'ESP32-C3 · DRV2605L · directional vibration motors',
};

export const TARGET_DEVICE_NAMES = [
  DEVICE_NAME_PREFIX.NECKLACE,
  DEVICE_NAME_PREFIX.WRISTBAND,
] as const;

export const roleFromDeviceName = (name?: string | null): DeviceRole | null => {
  if (!name) return null;
  if (name.includes(DEVICE_NAME_PREFIX.NECKLACE)) return 'NECKLACE';
  if (name.includes(DEVICE_NAME_PREFIX.WRISTBAND)) return 'WRISTBAND';
  return null;
};

export const WRISTBAND_COMMANDS = {
  INTENSITY: { LOW: 0x01, MEDIUM: 0x02, HIGH: 0x03 },
  PATTERN: { PULSE: 0x10, TAP: 0x11, HOLD: 0x12 },
  TEST: 0x20,
  LAUGHTER_MODE: 0x30,
  DIRECTION: 0x40,
} as const;

/** Command opcodes understood by the necklace node. */
export const NECKLACE_COMMANDS = {
  /** Persist user settings into ESP32 non-volatile storage. */
  APPLY_SETTINGS: 0x50,
  /** One-time-use passkey handshake on first connection. */
  AUTH_PASSKEY: 0x51,
  REQUEST_STATUS: 0x52,
  CALIBRATE_MICS: 0x53,
} as const;

export type AudioStateName = 'SINGLE' | 'OVERLAP' | 'LAUGHTER' | 'SILENCE' | 'NOISE';

/** Prosodic / emotional cue classified by the on-device TinyML model. */
export type EmotionName = 'NEUTRAL' | 'HAPPY' | 'SAD' | 'ANGRY' | 'URGENT';

export const EMOTIONS: EmotionName[] = ['NEUTRAL', 'HAPPY', 'SAD', 'ANGRY', 'URGENT'];

/** Telemetry frame emitted by the necklace on every classified audio window. */
export type BlePacket = {
  /** Direction of arrival in degrees, 0 = straight ahead. */
  doa: number;
  state: AudioStateName;
  confidence: number;
  emotion?: EmotionName;
  emotionConfidence?: number;
  /** Concurrent speakers, capped at 5 participants by the study scope. */
  speakerCount?: number;
  speakers?: { doa: number; id: number }[];
  /** Battery percentage of the reporting device. */
  battery?: number;
  firmware?: string;
  /** Device clock in ms; used to derive BLE transport latency. */
  deviceTs?: number;
  /** TinyML inference duration measured on the ESP32-S3, in ms. */
  inferenceMs?: number;
  /** TDOA localization compute duration on the ESP32-S3, in ms. */
  tdoaMs?: number;
  /** True when the mic array reports a failed or stale calibration. */
  micCalibrationFault?: boolean;
  audio_chunk_b64?: string;
};

/** Status frame emitted by the wristband. */
export type WristbandStatusPacket = {
  ack?: number;
  battery?: number;
  firmware?: string;
  motorFault?: boolean;
};

export const MAX_PARTICIPANTS = 5;
