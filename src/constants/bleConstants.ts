/**
 * BLE contract shared with the ESP32 firmware.
 *
 * Nordic UART-style service (phone ↔ ESP32):
 *   notify characteristic  device -> phone (TX 6E400003 — enable CCCD 0x2902)
 *   write characteristic   phone -> device (RX 6E400002)
 *
 * Primary hardware for this build advertises as SAC-Compass. Necklace and
 * wristband roles remain for Demo Mode / future dual-wearable firmware.
 */
export const BLE_SERVICE_UUID = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';
export const BLE_NOTIFY_CHAR_UUID = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E';
export const BLE_WRITE_CHAR_UUID = '6E400002-B5A3-F393-E0A9-E50E24DCCA9E';
/** Client Characteristic Configuration — write 0x0001 to enable Notify. */
export const BLE_CCCD_UUID = '00002902-0000-1000-8000-00805f9b34fb';

/** IoT nodes the app can track. Compass is the live ESP32 path. */
export type DeviceRole = 'COMPASS' | 'NECKLACE' | 'WRISTBAND';

/** All roles (settings / diagnostics). */
export const DEVICE_ROLES: DeviceRole[] = ['COMPASS', 'NECKLACE', 'WRISTBAND'];

/** Pairing screen only connects the compass ESP32. */
export const PAIR_ROLES: DeviceRole[] = ['COMPASS'];

/** Advertised name prefix used to classify a scan result into a role. */
export const DEVICE_NAME_PREFIX: Record<DeviceRole, string> = {
  COMPASS: 'SAC-Compass',
  NECKLACE: 'SAC-Necklace',
  WRISTBAND: 'SAC-Wristband',
};

export const DEVICE_LABEL: Record<DeviceRole, string> = {
  COMPASS: 'SAC-Compass',
  NECKLACE: 'SAC-Necklace',
  WRISTBAND: 'SAC-Wristband',
};

export const DEVICE_DESCRIPTION: Record<DeviceRole, string> = {
  COMPASS: 'ESP32 · Nordic UART · direction + audio stream',
  NECKLACE: 'ESP32-S3 · 3× INMP441 mic array · TDOA + TinyML',
  WRISTBAND: 'ESP32-C3 · DRV2605L · directional vibration motors',
};

export const TARGET_DEVICE_NAMES = [
  DEVICE_NAME_PREFIX.COMPASS,
  DEVICE_NAME_PREFIX.NECKLACE,
  DEVICE_NAME_PREFIX.WRISTBAND,
] as const;

const COMPASS_NAME_PATTERNS = [
  /sac[-_\s]?compass/i,
  /\bcompass\b/i,
];

const NECKLACE_NAME_PATTERNS = [
  /sac[-_\s]?necklace/i,
  /esp32[-_\s]?s3/i,
  /\bnecklace\b/i,
];

const WRISTBAND_NAME_PATTERNS = [
  /sac[-_\s]?wristband/i,
  /esp32[-_\s]?c3/i,
  /\bwristband\b/i,
];

export const roleFromDeviceName = (name?: string | null): DeviceRole | null => {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();

  // Specific wearables before the broad SAC-* → compass fallback.
  if (
    lower.includes(DEVICE_NAME_PREFIX.NECKLACE.toLowerCase()) ||
    NECKLACE_NAME_PATTERNS.some((re) => re.test(trimmed))
  ) {
    return 'NECKLACE';
  }
  if (
    lower.includes(DEVICE_NAME_PREFIX.WRISTBAND.toLowerCase()) ||
    WRISTBAND_NAME_PATTERNS.some((re) => re.test(trimmed))
  ) {
    return 'WRISTBAND';
  }
  if (
    lower.includes(DEVICE_NAME_PREFIX.COMPASS.toLowerCase()) ||
    COMPASS_NAME_PATTERNS.some((re) => re.test(trimmed))
  ) {
    return 'COMPASS';
  }
  // Any other SAC-* advertisement → compass for this build.
  if (/^sac[-_]/i.test(trimmed)) return 'COMPASS';
  return null;
};

/** Classify a BLE scan hit using name, localName, raw AD, or advertised NUS UUID. */
export const roleFromAdvertisement = (device: {
  name?: string | null;
  localName?: string | null;
  serviceUUIDs?: (string | null)[] | null;
  /** Extra names parsed from Android rawScanRecord / scan response. */
  parsedNames?: (string | null)[] | null;
  parsedServiceUuids?: (string | null)[] | null;
}): DeviceRole | null => {
  const combined = [device.name, device.localName, ...(device.parsedNames ?? [])]
    .filter(Boolean)
    .join(' ');
  const fromName = roleFromDeviceName(combined || null);
  if (fromName) return fromName;

  const target = BLE_SERVICE_UUID.replace(/-/g, '').toLowerCase();
  const allUuids = [...(device.serviceUUIDs ?? []), ...(device.parsedServiceUuids ?? [])];
  const advertisesNus = allUuids.some(
    (uuid) => typeof uuid === 'string' && uuid.replace(/-/g, '').toLowerCase() === target,
  );
  if (!advertisesNus) return null;

  // Named NUS without SAC-* prefix: only map clear wearable keywords.
  if (/wrist/i.test(combined)) return 'WRISTBAND';
  if (/necklace/i.test(combined)) return 'NECKLACE';
  // Unnamed Nordic UART board → treat as the compass ESP32 for this build.
  return 'COMPASS';
};

/** Compass TX opcodes after Notify is enabled. */
export const COMPASS_OPCODE = {
  /** 11-byte direction: [0xA0, locked, deg_i16_le, rmsL, rmsF, rmsR] */
  DIRECTION: 0xa0,
  /** PCM: [0xA1, locked, sampleCount, rate_kHz, …int16 LE samples] @ 8 kHz mono */
  PCM: 0xa1,
  /**
   * Pitch cue: [0xA2, locked, cue, score 0-100, pitchHz uint16 LE].
   * cue: 1 neutral, 2 happy, 3 urgent, 4 serious, 5 laughter, 6 overlap.
   */
  EMOTION: 0xa2,
} as const;

/** Zone codes in binary 0xA0 / 0xA1 `locked` byte. */
export const COMPASS_LOCKED_ZONE = {
  LEFT: 1,
  FRONT: 2,
  RIGHT: 3,
} as const;

/** Degrees for a locked mic zone (matches ASCII SAC|LEFT|-90 etc.). */
export const doaFromLockedZone = (locked: number): number | null => {
  if (locked === COMPASS_LOCKED_ZONE.LEFT) return -90;
  if (locked === COMPASS_LOCKED_ZONE.FRONT) return 0;
  if (locked === COMPASS_LOCKED_ZONE.RIGHT) return 90;
  return null;
};

/** SAC-Compass BLE PCM stream rate (packet byte 3 overrides this). */
export const COMPASS_PCM_SAMPLE_RATE_HZ = 16000;

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

/** Telemetry frame emitted by the necklace / compass on every classified window. */
export type BlePacket = {
  /** Direction of arrival in degrees, 0 = straight ahead. */
  doa: number;
  state: AudioStateName;
  confidence: number;
  emotion?: EmotionName;
  emotionConfidence?: number;
  /** Fundamental frequency from the locked mic, in Hz. 0 means no pitch. */
  pitchHz?: number;
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
  /**
   * Optional PCM window for on-phone Vosk (legacy necklace JSON path).
   * Compass live transcript uses binary TX opcode 0xA1 (8 kHz int16 LE mono)
   * instead of this field.
   * Format: base64 of 16-bit little-endian mono PCM.
   */
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
