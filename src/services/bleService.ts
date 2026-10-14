import { NativeModules, Platform } from 'react-native';

import {
  BLE_CCCD_UUID,
  BLE_NOTIFY_CHAR_UUID,
  BLE_SERVICE_UUID,
  BLE_WRITE_CHAR_UUID,
  COMPASS_OPCODE,
  DEVICE_LABEL,
  DEVICE_ROLES,
  doaFromLockedZone,
  NECKLACE_COMMANDS,
  roleFromAdvertisement,
  WRISTBAND_COMMANDS,
  type AudioStateName,
  type BlePacket,
  type DeviceRole,
  type EmotionName,
  type WristbandStatusPacket,
} from '@/constants/bleConstants';
import { performanceRepo } from '@/services/db';
import { speechService } from '@/services/speechService';
import { useCompassStore } from '@/store/compassStore';
import { decodeBase64, decodeBase64ToBytes, encodeBase64, encodeBytesToBase64 } from '@/utils/base64';
import { parseRawScanRecord } from '@/utils/bleAdvertisement';
import { intensityForCue, intensityOpcode, patternForCue } from '@/utils/haptics';

type BleManagerType = import('react-native-ble-plx').BleManager;
type DeviceType = import('react-native-ble-plx').Device;
type SubscriptionType = import('react-native-ble-plx').Subscription;

type Connection = {
  role: DeviceRole;
  device: DeviceType;
  notify: SubscriptionType | null;
  disconnectSub: SubscriptionType | null;
  keepAlive: ReturnType<typeof setInterval> | null;
};

/** Keep retrying until the user presses Disconnect. */
const MAX_RECONNECT = Number.POSITIVE_INFINITY;
const SCAN_TIMEOUT_MS = 30000;
const POWERED_ON_WAIT_MS = 8000;
const KEEP_ALIVE_MS = 25000;
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 15000;
const CONNECT_TIMEOUT_MS = 15000;
const CONNECT_SETTLE_MS = 250;
/** One immediate retry after a failed connect (race / drop). */
const CONNECT_RETRY_DELAY_MS = 600;
/** After canceling a ghost GATT link, ESP32 needs time to advertise again. */
const POST_CANCEL_ADVERTISE_MS = 900;
/** CCCD value: notifications enabled (little-endian 0x0001). */
const CCCD_NOTIFY_ON = encodeBytesToBase64(new Uint8Array([0x01, 0x00]));

/** Normalize UUID comparisons across iOS/Android casing. */
const SERVICE_UUID = BLE_SERVICE_UUID.toLowerCase();
const NOTIFY_UUID = BLE_NOTIFY_CHAR_UUID.toLowerCase();
const WRITE_UUID = BLE_WRITE_CHAR_UUID.toLowerCase();
const CCCD_UUID = BLE_CCCD_UUID.toLowerCase();

/** ASCII direction lines from SAC-Compass firmware (≤20 bytes). */
const COMPASS_ASCII_RE = /^SAC\|(LEFT|FRONT|RIGHT)\|(-?\d+)/i;

let manager: BleManagerType | null = null;

/** One live connection per role, so compass / necklace / wristband can coexist. */
const connections = new Map<DeviceRole, Connection>();
const reconnectAttempts = new Map<DeviceRole, number>();
const reconnectTimers = new Map<DeviceRole, ReturnType<typeof setTimeout>>();
const lastKnownId = new Map<DeviceRole, string>();
/** Roles the user (or destroy) asked to leave alone — no auto-reconnect. */
const intentionalDisconnect = new Set<DeviceRole>();

let scanTimeout: ReturnType<typeof setTimeout> | null = null;
let onPacketHook: ((role: DeviceRole, packet: BlePacket) => void) | null = null;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Native BlePlx module is absent in Expo Go and on web. */
const hasNativeBleModule = (): boolean => {
  if (Platform.OS === 'web') return false;
  return NativeModules.BlePlx != null;
};

const createManager = (): BleManagerType | null => {
  if (!hasNativeBleModule()) return null;
  if (manager) return manager;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BleManager } = require('react-native-ble-plx');
    manager = new BleManager();
    return manager;
  } catch {
    return null;
  }
};

/** BleManager often reports Unknown/Resetting briefly after construction. */
const waitForPoweredOn = async (
  mgr: BleManagerType,
  timeoutMs = POWERED_ON_WAIT_MS,
): Promise<boolean> => {
  try {
    if ((await mgr.state()) === 'PoweredOn') return true;
  } catch {
    return false;
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      try {
        subscription.remove();
      } catch {
        /* ignore */
      }
      clearTimeout(timer);
      resolve(value);
    };

    const subscription = mgr.onStateChange((state) => {
      if (state === 'PoweredOn') finish(true);
    }, true);

    const timer = setTimeout(() => finish(false), timeoutMs);
  });
};

const store = () => useCompassStore.getState();

const parseFrame = <T>(value: string | null): T | null => {
  if (!value) return null;
  const attempt = (raw: string): T | null => {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  };
  return attempt(decodeBase64(value)) ?? attempt(value);
};

const isBlePacket = (value: BlePacket | null): value is BlePacket =>
  value != null && typeof value.doa === 'number' && typeof value.state === 'string';

const readInt16LE = (bytes: Uint8Array, offset: number): number => {
  const lo = bytes[offset] ?? 0;
  const hi = bytes[offset + 1] ?? 0;
  return ((hi << 8) | lo) << 16 >> 16;
};

const readU16LE = (bytes: Uint8Array, offset: number): number => {
  const lo = bytes[offset] ?? 0;
  const hi = bytes[offset + 1] ?? 0;
  return (hi << 8) | lo;
};

type PitchCue = 'neutral' | 'happy' | 'urgent' | 'serious' | 'laughter' | 'overlap';

const cueFromByte = (byte: number): PitchCue | null => {
  switch (byte) {
    case 1:
      return 'neutral';
    case 2:
      return 'happy';
    case 3:
      return 'urgent';
    case 4:
      return 'serious';
    case 5:
      return 'laughter';
    case 6:
      return 'overlap';
    default:
      return null;
  }
};

const cueFromName = (name: string): PitchCue | null => {
  switch (name.toLowerCase()) {
    case 'neutral':
    case 'neu':
      return 'neutral';
    case 'happy':
    case 'hap':
      return 'happy';
    case 'urgent':
    case 'angry':
    case 'ang':
      return 'urgent';
    case 'serious':
    case 'sad':
      return 'serious';
    case 'laughter':
    case 'laugh':
      return 'laughter';
    case 'overlap':
    case 'overlapping':
      return 'overlap';
    default:
      return null;
  }
};

const lockedFromSide = (side: string): number => {
  switch (side.toUpperCase()) {
    case 'LEFT':
      return 1;
    case 'FRONT':
      return 2;
    case 'RIGHT':
      return 3;
    default:
      return 0;
  }
};

const emotionFromCue = (cue: PitchCue): EmotionName => {
  switch (cue) {
    case 'happy':
      return 'HAPPY';
    case 'urgent':
      return 'URGENT';
    case 'serious':
      return 'SAD';
    default:
      return 'NEUTRAL';
  }
};

const stateFromCue = (cue: PitchCue, unlocked: boolean): AudioStateName => {
  if (unlocked) return 'SILENCE';
  if (cue === 'laughter') return 'LAUGHTER';
  if (cue === 'overlap') return 'OVERLAP';
  return 'SINGLE';
};

type CompassNotify =
  | { kind: 'direction'; doa: number; label: string; idle?: boolean }
  | {
      kind: 'pcm';
      audio_chunk_b64: string;
      sampleCount: number;
      sampleRateHz: number;
      locked: number;
    }
  | {
      kind: 'emotion';
      locked: number;
      cue: PitchCue;
      score: number;
      pitchHz: number;
    };

/**
 * Parse SAC-Compass TX payloads after Notify is enabled.
 * Branch on the first byte — never UTF-8-decode binary frames.
 *   ASCII  SAC|LEFT|-90\\n / SAC|FRONT|0\\n / SAC|RIGHT|90\\n
 *   ASCII  EMO|LEFT|happy|214|68\\n  (side, cue, pitch Hz, score)
 *   Binary 0xA0 11-byte direction: [op, locked, deg_i16_le, rmsL, rmsF, rmsR]
 *   Binary 0xA1 PCM: [op, locked, sampleCount, rate_kHz, …int16 LE @ 8 kHz]
 *   Binary 0xA2 pitch cue: [op, locked, cue, score, pitchHz u16 LE]
 * Packet size follows phone MTU — never assume a fixed 20-byte audio frame.
 */
const parseCompassNotify = (value: string | null): CompassNotify | null => {
  if (!value) return null;
  const bytes = decodeBase64ToBytes(value);
  if (bytes.length === 0) return null;

  const opcode = bytes[0]!;

  if (opcode === COMPASS_OPCODE.DIRECTION) {
    if (bytes.length < 11) {
      if (__DEV__) {
        console.warn('[bleService] truncated 0xA0', bytes.length);
      }
      return null;
    }
    if (bytes[1] === 0) return { kind: 'direction', doa: 0, label: 'NONE', idle: true };
    const fromLock = doaFromLockedZone(bytes[1]!);
    const doa = fromLock ?? readInt16LE(bytes, 2);
    return { kind: 'direction', doa, label: 'BIN' };
  }

  if (opcode === COMPASS_OPCODE.EMOTION) {
    if (bytes.length < 6) return null;
    const cue = cueFromByte(bytes[2]!);
    if (!cue) return null;
    return {
      kind: 'emotion',
      locked: bytes[1]!,
      cue,
      score: bytes[3]!,
      pitchHz: readU16LE(bytes, 4),
    };
  }

  if (opcode === COMPASS_OPCODE.PCM) {
    if (bytes.length < 4) {
      if (__DEV__) console.warn('[bleService] truncated 0xA1 header', bytes.length);
      return null;
    }
    const locked = bytes[1]!;
    const sampleCount = bytes[2]!;
    const rateKhz = bytes[3]!;
    const need = 4 + sampleCount * 2;
    if (sampleCount === 0 || bytes.length < need) {
      if (__DEV__) {
        console.warn(
          '[bleService] truncated 0xA1 PCM',
          `len=${bytes.length}`,
          `need=${need}`,
          `samples=${sampleCount}`,
        );
      }
      return null;
    }
    // Header is not audio — slice only the int16 LE samples.
    const pcm = bytes.subarray(4, need);
    return {
      kind: 'pcm',
      audio_chunk_b64: encodeBytesToBase64(pcm),
      sampleCount,
      sampleRateHz: rateKhz * 1000,
      locked,
    };
  }

  // ASCII direction only (starts with SAC|) — do not treat binary as text.
  let text = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const c = bytes[i]!;
    if (c === 0) break;
    text += String.fromCharCode(c);
  }
  text = text.trim();
  if (text.toUpperCase().startsWith('EMO|')) {
    const emo = text.match(/^EMO\|(LEFT|FRONT|RIGHT|none)\|([A-Za-z]+)\|(\d+)\|(\d+)/i);
    if (!emo) return null;
    const cue = cueFromName(emo[2]!);
    if (!cue) return null;
    return {
      kind: 'emotion',
      locked: lockedFromSide(emo[1]!),
      cue,
      pitchHz: Number(emo[3]),
      score: Number(emo[4]),
    };
  }
  if (/^SAC\|none\|/i.test(text)) {
    return { kind: 'direction', doa: 0, label: 'NONE', idle: true };
  }
  if (!text.toUpperCase().startsWith('SAC|')) return null;

  const match = text.match(COMPASS_ASCII_RE);
  if (match) {
    return { kind: 'direction', doa: Number(match[2]), label: match[1]!.toUpperCase() };
  }

  return null;
};

/**
 * Derives transport latency from the firmware clock. Firmware and phone clocks
 * are unsynchronised, so only non-negative, plausible values are reported.
 */
const bleLatencyFrom = (deviceTs?: number): number => {
  if (!deviceTs) return 0;
  const delta = Date.now() - deviceTs;
  return delta >= 0 && delta < 10000 ? delta : 0;
};

/**
 * Relays direction to the wristband when that optional wearable is linked.
 * Compass-only builds never hit this path.
 */
const relayHaptic = (packet: BlePacket) => {
  if (packet.state === 'SILENCE' || !connections.has('WRISTBAND')) return;

  const s = store();
  const emotion = packet.emotion ?? s.emotion;
  const intensity = intensityForCue(s.wristbandIntensity, emotion);
  const pattern = patternForCue(emotion, packet.state, s.wristbandPattern);

  writeCommand('WRISTBAND', {
    cmd: WRISTBAND_COMMANDS.DIRECTION,
    doa: Math.round(packet.doa),
    intensity: intensityOpcode(intensity),
    pattern: WRISTBAND_COMMANDS.PATTERN[pattern],
    laughter: packet.state === 'LAUGHTER' && s.laughterMode,
  });
};

const ingestDirectionPacket = (role: DeviceRole, packet: BlePacket) => {
  store().handleBlePacket(packet);
  if (role === 'NECKLACE' || role === 'COMPASS') {
    relayHaptic(packet);
  }

  const bleLatencyMs = bleLatencyFrom(packet.deviceTs);

  store().addPerformanceSample({
    inferenceMs: packet.inferenceMs ?? 0,
    tdoaMs: packet.tdoaMs ?? 0,
    bleLatencyMs,
    battery: packet.battery ?? 0,
    recordedAt: Date.now(),
  });

  performanceRepo.record({
    tinyMLInferenceTime: packet.inferenceMs ?? 0,
    tdoaComputeTime: packet.tdoaMs ?? 0,
    bleLatency: bleLatencyMs,
    batteryLevel: packet.battery ?? 0,
  });

  onPacketHook?.(role, packet);

  if (packet.audio_chunk_b64) {
    speechService.processAudioChunk(packet.audio_chunk_b64, packet.doa, packet.state);
  }
};

/**
 * Paint the radar from the locked mic as soon as BLE has a zone.
 * 0xA1 already carries that zone every 5 ms — do not wait for the
 * throttled 0xA0/ASCII direction frame. Skip store writes when the
 * zone has not changed so STT packets do not stall the UI.
 */
const paintCompassNow = (doa: number, recordPerf: boolean) => {
  const current = store();
  const idle = current.audioState === 'SILENCE' || current.audioState === 'NOISE';
  const unchanged = !idle && current.currentDoa === doa && current.speakerCount > 0;
  if (unchanged) {
    noteCompassDirection();
    return;
  }

  const preserveCue = current.audioState === 'OVERLAP' || current.audioState === 'LAUGHTER';
  const packet: BlePacket = {
    doa,
    state: preserveCue ? current.audioState : 'SINGLE',
    confidence: 1,
    speakerCount: preserveCue ? Math.max(current.speakerCount, 1) : 1,
    speakers:
      preserveCue && current.speakerDots.length > 0
        ? current.speakerDots.map((dot, index) => ({
            doa: index === 0 ? doa : dot.doa,
            id: dot.id,
          }))
        : [{ doa, id: 0 }],
  };

  if (recordPerf) {
    ingestDirectionPacket('COMPASS', packet);
  } else {
    store().handleBlePacket(packet);
    relayHaptic(packet);
  }
  noteCompassDirection();
};

const applyEmotionCue = (parsed: Extract<CompassNotify, { kind: 'emotion' }>) => {
  const s = store();
  const unlocked = parsed.locked === 0;
  const state = stateFromCue(parsed.cue, unlocked);
  const speaking = state === 'SINGLE' || state === 'LAUGHTER' || state === 'OVERLAP';
  const doa = doaFromLockedZone(parsed.locked) ?? s.currentDoa;
  const packet: BlePacket = {
    doa,
    state,
    confidence: speaking ? (s.confidence > 0 ? s.confidence : 1) : 0,
    emotion: emotionFromCue(parsed.cue),
    emotionConfidence: unlocked ? 0 : Math.max(0, Math.min(1, parsed.score / 100)),
    pitchHz: unlocked ? 0 : parsed.pitchHz,
    speakerCount: !speaking ? 0 : state === 'OVERLAP' ? 2 : 1,
    speakers: !speaking ? [] : [{ doa, id: 0 }],
  };
  store().handleBlePacket(packet);
  relayHaptic(packet);
  if (speaking) noteCompassDirection();
};

const handleCompassNotify = (raw: string | null) => {
  const parsed = parseCompassNotify(raw);
  if (!parsed) return;

  if (parsed.kind === 'emotion') {
    applyEmotionCue(parsed);
    return;
  }

  if (parsed.kind === 'direction' && parsed.idle) {
    if (compassIdleTimer) {
      clearTimeout(compassIdleTimer);
      compassIdleTimer = null;
    }
    markCompassIdle();
    return;
  }

  if (parsed.kind === 'pcm') {
    const fromLock = doaFromLockedZone(parsed.locked);
    const doa = fromLock ?? store().currentDoa;
    if (fromLock != null) paintCompassNow(fromLock, false);
    speechService.processBlePcm(parsed.audio_chunk_b64, doa, parsed.sampleRateHz);
    return;
  }

  paintCompassNow(parsed.doa, true);
  speechService.noteDirectionUpdate();
};

const handleNecklacePacket = (packet: BlePacket) => {
  ingestDirectionPacket('NECKLACE', packet);
};

/** After the last locked packet, drop the radar marker quickly. */
const COMPASS_IDLE_MS = 350;
let compassIdleTimer: ReturnType<typeof setTimeout> | null = null;

const markCompassIdle = () => {
  compassIdleTimer = null;
  const current = store();
  if (current.audioState === 'SILENCE' && current.speakerCount === 0) return;
  ingestDirectionPacket('COMPASS', {
    doa: current.currentDoa,
    state: 'SILENCE',
    confidence: 0,
    speakerCount: 0,
    speakers: [],
  });
};

const noteCompassDirection = () => {
  if (compassIdleTimer) clearTimeout(compassIdleTimer);
  compassIdleTimer = setTimeout(markCompassIdle, COMPASS_IDLE_MS);
};

const handleWristbandStatus = (status: WristbandStatusPacket) => {
  store().setDeviceLink('WRISTBAND', {
    battery: status.battery ?? null,
    firmware: status.firmware ?? null,
    fault: status.motorFault ? 'Vibration motor fault reported' : null,
  });
};

/** True when the monitor callback means the GATT link is actually gone. */
const isLinkLostError = (error: { errorCode?: number; message?: string } | null): boolean => {
  if (!error) return false;
  const code = error.errorCode;
  // BleErrorCode.DeviceDisconnected = 201, OperationCancelled = 2
  if (code === 2) return false;
  if (code === 201) return true;
  const message = (error.message ?? '').toLowerCase();
  if (message.includes('cancelled') || message.includes('canceled')) return false;
  return message.includes('disconnected') || message.includes('connection');
};

const clearKeepAlive = (connection: Connection | undefined) => {
  if (!connection?.keepAlive) return;
  clearInterval(connection.keepAlive);
  connection.keepAlive = null;
};

const startKeepAlive = (role: DeviceRole, device: DeviceType): ReturnType<typeof setInterval> =>
  setInterval(() => {
    const connection = connections.get(role);
    if (!connection || connection.device.id !== device.id) return;

    device.isConnected().then(async (alive) => {
      if (!alive) {
        handleDisconnect(role);
        return;
      }
      // Re-assert CCCD so TX Notify stays on across Android stack glitches.
      if (role === 'COMPASS') {
        try {
          await device.writeDescriptorForService(
            SERVICE_UUID,
            NOTIFY_UUID,
            CCCD_UUID,
            CCCD_NOTIFY_ON,
          );
        } catch {
          /* link may be mid-transfer */
        }
      }
      // Necklace-only status ping — compass firmware does not speak 0x52.
      if (role === 'NECKLACE') {
        void writeCommand(role, { cmd: NECKLACE_COMMANDS.REQUEST_STATUS });
      }
    });
  }, KEEP_ALIVE_MS);

/**
 * Explicitly enable Notify on TX (CCCD 0x2902 = 0x0001), then monitor.
 * STT starts only after CCCD is armed — BLE PCM only, no phone mic.
 */
const enableTxNotifications = async (
  role: DeviceRole,
  device: DeviceType,
): Promise<SubscriptionType> => {
  const writeCccd = async () => {
    await device.writeDescriptorForService(SERVICE_UUID, NOTIFY_UUID, CCCD_UUID, CCCD_NOTIFY_ON);
  };

  try {
    await writeCccd();
    if (__DEV__) console.log('[bleService] CCCD Notify ON', role, NOTIFY_UUID);
  } catch (error) {
    if (__DEV__) {
      console.warn('[bleService] CCCD pre-write failed (monitor will retry)', role, error);
    }
  }

  const notify = device.monitorCharacteristicForService(
    SERVICE_UUID,
    NOTIFY_UUID,
    (error, characteristic) => {
      if (error) {
        if (__DEV__) {
          console.warn('[bleService] notify error', role, error.message ?? error);
        }
        if (isLinkLostError(error)) {
          handleDisconnect(role);
        } else {
          // Try to keep Notify alive after a transient setup fault.
          void writeCccd().catch(() => undefined);
          store().setDeviceLink(role, {
            fault: 'Notify setup issue — re-enabled CCCD. Check ESP32 TX UUID.',
          });
        }
        return;
      }

      const raw = characteristic?.value ?? null;

      if (role === 'COMPASS') {
        handleCompassNotify(raw);
        return;
      }

      if (role === 'NECKLACE') {
        const packet = parseFrame<BlePacket>(raw);
        if (isBlePacket(packet)) handleNecklacePacket(packet);
        return;
      }

      const status = parseFrame<WristbandStatusPacket>(raw);
      if (status) handleWristbandStatus(status);
    },
  );

  // Keep notifications on: re-write CCCD after the monitor subscription arms.
  await delay(120);
  try {
    await writeCccd();
  } catch (error) {
    if (__DEV__) console.warn('[bleService] CCCD post-write failed', role, error);
    store().setDeviceLink(role, {
      fault: 'Could not keep TX Notify on — direction/audio may pause. Reconnect.',
    });
  }

  if (role === 'COMPASS') {
    const sttOk = await speechService.startBleListening();
    if (!sttOk) {
      store().setDeviceLink(role, {
        fault: 'TX Notify on, but STT failed to start — check Vosk model / rebuild.',
      });
    }
  }

  return notify;
};

const teardown = (role: DeviceRole) => {
  const connection = connections.get(role);
  if (!connection) return;
  clearKeepAlive(connection);
  try {
    connection.notify?.remove();
  } catch {
    /* ignore */
  }
  try {
    connection.disconnectSub?.remove();
  } catch {
    /* ignore */
  }
  connections.delete(role);
  if (role === 'COMPASS') {
    speechService.stopBleListening();
  }
};

/** Drop local refs without touching intentional-disconnect / reconnect policy. */
const clearStaleDeviceRefs = (role: DeviceRole, deviceId?: string) => {
  teardown(role);
  if (deviceId && lastKnownId.get(role) === deviceId && intentionalDisconnect.has(role)) {
    lastKnownId.delete(role);
  }
};

const clearReconnectTimers = () => {
  for (const role of DEVICE_ROLES) {
    const timer = reconnectTimers.get(role);
    if (timer) clearTimeout(timer);
    reconnectTimers.delete(role);
  }
};

/**
 * After an app reload the JS maps are empty but Android may still hold a GATT
 * session — the ESP32 then stops advertising and never shows up in scan.
 * Cancel every known / connected NUS link and wait for advertising to resume.
 */
const releaseGhostConnections = async (
  mgr: BleManagerType,
  extraIds: string[] = [],
): Promise<void> => {
  clearReconnectTimers();

  const ids = new Set<string>();
  for (const id of extraIds) {
    if (id) ids.add(id);
  }
  for (const id of lastKnownId.values()) ids.add(id);
  for (const d of store().discoveredDevices) ids.add(d.id);
  for (const role of DEVICE_ROLES) {
    const live = connections.get(role);
    if (live) ids.add(live.device.id);
  }

  try {
    const connected = await mgr.connectedDevices([SERVICE_UUID, BLE_SERVICE_UUID]);
    for (const device of connected) {
      ids.add(device.id);
      try {
        await device.cancelConnection();
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* older stacks */
  }

  for (const id of ids) {
    try {
      await mgr.cancelDeviceConnection(id);
    } catch {
      /* ignore */
    }
  }

  for (const role of DEVICE_ROLES) {
    if (connections.has(role)) {
      teardown(role);
      store().setDeviceLink(role, { status: 'DISCONNECTED' });
    }
  }

  if (ids.size > 0) {
    if (__DEV__) {
      console.log('[bleService] released ghost links', [...ids]);
    }
    await delay(POST_CANCEL_ADVERTISE_MS);
  }
};

const handleDisconnect = (role: DeviceRole) => {
  // Stale notify/cancel callbacks after a fresh connect must not wipe the new link.
  if (!connections.has(role) && store().devices[role].status !== 'CONNECTED') {
    if (!intentionalDisconnect.has(role)) scheduleReconnect(role);
    return;
  }

  teardown(role);

  if (intentionalDisconnect.has(role)) {
    store().resetDevice(role);
    return;
  }

  store().setDeviceLink(role, { status: 'DISCONNECTED' });
  scheduleReconnect(role);
};

const scheduleReconnect = (role: DeviceRole) => {
  if (store().isDemoMode) return;
  if (intentionalDisconnect.has(role)) return;

  const attempts = reconnectAttempts.get(role) ?? 0;
  const deviceId = lastKnownId.get(role);
  if (!deviceId || attempts >= MAX_RECONNECT) return;

  const existing = reconnectTimers.get(role);
  if (existing) clearTimeout(existing);

  reconnectAttempts.set(role, attempts + 1);
  const delayMs = Math.min(RECONNECT_BASE_MS * (attempts + 1), RECONNECT_MAX_MS);
  reconnectTimers.set(
    role,
    setTimeout(() => {
      if (intentionalDisconnect.has(role)) return;
      void bleService.connectToDevice(deviceId, role);
    }, delayMs),
  );
};

const writeCommand = async (
  role: DeviceRole,
  payload: Record<string, unknown>,
): Promise<boolean> => {
  const connection = connections.get(role);
  if (!connection) return false;

  try {
    const alive = await connection.device.isConnected();
    if (!alive) return false;

    await connection.device.writeCharacteristicWithResponseForService(
      SERVICE_UUID,
      WRITE_UUID,
      encodeBase64(JSON.stringify(payload)),
    );
    return true;
  } catch (error) {
    if (__DEV__) {
      console.warn('[bleService] write failed', role, error);
    }
    return false;
  }
};

const ensureConnected = async (device: DeviceType): Promise<boolean> => {
  if (await device.isConnected()) return true;
  await delay(CONNECT_SETTLE_MS);
  return device.isConnected();
};

/**
 * Full GATT bring-up. Must not monitor/write until connect + discover settle.
 * Returns the live Device only after TX Notify (CCCD) is enabled.
 */
const openGattSession = async (
  mgr: BleManagerType,
  deviceId: string,
  role: DeviceRole,
): Promise<DeviceType> => {
  // Cancel a half-open / ghost session so Android does not return a stale Device
  // and so the ESP32 can advertise again after an app reload.
  let hadLiveLink = false;
  try {
    const live = await mgr.connectedDevices([SERVICE_UUID, BLE_SERVICE_UUID]);
    hadLiveLink = live.some((d) => d.id === deviceId);
    for (const d of live) {
      if (d.id === deviceId) {
        try {
          await d.cancelConnection();
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  try {
    await mgr.cancelDeviceConnection(deviceId);
  } catch {
    /* not connected */
  }
  await delay(hadLiveLink ? POST_CANCEL_ADVERTISE_MS : CONNECT_SETTLE_MS);

  const connected = await mgr.connectToDevice(deviceId, {
    autoConnect: false,
    timeout: CONNECT_TIMEOUT_MS,
  });

  if (!(await ensureConnected(connected))) {
    throw new Error(`Device ${deviceId} is not connected`);
  }

  if (Platform.OS === 'android') {
    try {
      await connected.requestMTU(512);
    } catch {
      /* optional */
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ConnectionPriority } = require('react-native-ble-plx');
      await connected.requestConnectionPriority(ConnectionPriority.High);
    } catch {
      /* optional on older stacks */
    }
  }

  if (!(await ensureConnected(connected))) {
    throw new Error(`Device ${deviceId} dropped before service discovery`);
  }

  const device = await connected.discoverAllServicesAndCharacteristics();

  if (!(await ensureConnected(device))) {
    throw new Error(`Device ${deviceId} dropped during service discovery`);
  }

  // Replace any previous slot only after the new GATT session is ready,
  // so cancelled notify callbacks cannot mark us disconnected.
  teardown(role);

  const notify = await enableTxNotifications(role, device);
  const disconnectSub = device.onDisconnected(() => {
    if (intentionalDisconnect.has(role)) {
      teardown(role);
      store().resetDevice(role);
      return;
    }
    handleDisconnect(role);
  });
  const keepAlive = startKeepAlive(role, device);

  connections.set(role, { role, device, notify, disconnectSub, keepAlive });
  return device;
};

export const bleService = {
  /** True only when native BlePlx is linked (development build), not in Expo Go. */
  isSupported: (): boolean => hasNativeBleModule(),

  getUnavailableReason: (): string => {
    if (Platform.OS === 'web') return 'Bluetooth is not available on web.';
    if (!hasNativeBleModule()) {
      return 'Bluetooth needs the installed development build. Expo Go cannot load the Bluetooth module.';
    }
    return 'Bluetooth is unavailable on this device.';
  },

  isRoleConnected: (role: DeviceRole): boolean => connections.has(role),

  /** Lets the session recorder observe every inbound telemetry frame. */
  setPacketListener: (listener: ((role: DeviceRole, packet: BlePacket) => void) | null) => {
    onPacketHook = listener;
  },

  async isPoweredOn(): Promise<boolean> {
    const mgr = createManager();
    if (!mgr) return false;
    return waitForPoweredOn(mgr);
  },

  /**
   * Call before scanning / reconnecting after an app reload.
   * Drops ghost GATT sessions that leave the ESP32 silent (not advertising).
   */
  async prepareForDiscovery(extraDeviceIds: string[] = []): Promise<void> {
    const mgr = createManager();
    if (!mgr) return;
    if (!(await waitForPoweredOn(mgr))) return;
    await releaseGhostConnections(mgr, extraDeviceIds);
  },

  /**
   * Scans for SAC devices. ESP32 often puts the name only in the scan response,
   * so we allow duplicate callbacks and merge until a name / NUS UUID appears.
   */
  async startScan(): Promise<void> {
    const mgr = createManager();
    if (!mgr) {
      store().setScanStatus('IDLE');
      return;
    }

    if (!(await waitForPoweredOn(mgr))) {
      store().setScanStatus('DISCONNECTED');
      return;
    }

    // Reload leaves orphan connections — ESP stops advertising until released.
    await releaseGhostConnections(mgr);

    try {
      mgr.stopDeviceScan();
    } catch {
      /* ignore */
    }

    store().setScanStatus('SCANNING');
    store().setDiscoveredDevices([]);

    const discovered = new Map<string, { name: string; rssi: number; role: DeviceRole }>();

    const scanOptions: {
      allowDuplicates: boolean;
      scanMode?: number;
      legacyScan?: boolean;
    } = {
      // Need later packets: Complete Local Name is often only in the scan response.
      allowDuplicates: true,
      legacyScan: true,
    };

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ScanMode } = require('react-native-ble-plx') as { ScanMode?: { LowLatency?: number } };
      if (ScanMode?.LowLatency != null) {
        scanOptions.scanMode = ScanMode.LowLatency;
      }
    } catch {
      /* optional */
    }

    mgr.startDeviceScan(null, scanOptions, (error, device) => {
      if (error) {
        if (__DEV__) {
          console.warn('[bleService] scan error', error.message ?? error);
        }
        store().setScanStatus('DISCONNECTED');
        return;
      }

      if (!device) return;

      const rawScanRecord =
        typeof (device as { rawScanRecord?: unknown }).rawScanRecord === 'string'
          ? (device as { rawScanRecord: string }).rawScanRecord
          : null;
      const parsed = parseRawScanRecord(rawScanRecord);

      const role = roleFromAdvertisement({
        name: device.name,
        localName: device.localName,
        serviceUUIDs: device.serviceUUIDs,
        parsedNames: [parsed.localName],
        parsedServiceUuids: parsed.serviceUuids,
      });

      if (!role) {
        if (__DEV__) {
          const hint = device.name || device.localName || parsed.localName;
          if (hint) {
            console.log('[bleService] ignoring advertisement', hint);
          }
        }
        return;
      }

      const displayName =
        device.name?.trim() ||
        device.localName?.trim() ||
        parsed.localName?.trim() ||
        discovered.get(device.id)?.name ||
        DEVICE_LABEL[role];

      const prev = discovered.get(device.id);
      // Prefer a real advertised name over a placeholder once scan response arrives.
      const name =
        displayName !== DEVICE_LABEL[role] || !prev ? displayName : prev.name;

      discovered.set(device.id, {
        name,
        rssi: device.rssi ?? prev?.rssi ?? -100,
        role,
      });

      store().setDiscoveredDevices(
        Array.from(discovered.entries()).map(([id, entry]) => ({ id, ...entry })),
      );
      store().setScanStatus('FOUND');
    });

    scanTimeout = setTimeout(() => bleService.stopScan(), SCAN_TIMEOUT_MS);
  },

  stopScan(): void {
    if (scanTimeout) {
      clearTimeout(scanTimeout);
      scanTimeout = null;
    }
    if (!hasNativeBleModule()) return;
    createManager()?.stopDeviceScan();
    if (store().scanStatus === 'SCANNING') store().setScanStatus('IDLE');
  },

  /**
   * Connects one device. Sequence: stop scan → connect → settle → discover NUS
   * → enable Notify on TX → only then mark CONNECTED. Retries once on drop.
   */
  async connectToDevice(deviceId: string, roleHint?: DeviceRole): Promise<boolean> {
    const mgr = createManager();
    if (!mgr) return false;

    const known = store().discoveredDevices.find((d) => d.id === deviceId);
    const role = roleHint ?? known?.role ?? null;
    if (!role) return false;

    intentionalDisconnect.delete(role);
    lastKnownId.set(role, deviceId);

    // Scanning while connecting drops links on many Android stacks.
    bleService.stopScan();

    store().setDeviceStatus(role, 'CONNECTING');

    const tryOnce = async (): Promise<boolean> => {
      try {
        const device = await openGattSession(mgr, deviceId, role);
        reconnectAttempts.set(role, 0);

        store().setDeviceLink(role, {
          status: 'CONNECTED',
          id: deviceId,
          name:
            device.name?.trim() ||
            device.localName?.trim() ||
            known?.name ||
            DEVICE_LABEL[role],
          rssi: known?.rssi ?? null,
          lastConnected: Date.now(),
          fault: null,
        });

        return true;
      } catch (error) {
        if (__DEV__) {
          console.warn('[bleService] connect failed', role, error);
        }
        clearStaleDeviceRefs(role, deviceId);
        try {
          await mgr.cancelDeviceConnection(deviceId);
        } catch {
          /* ignore */
        }
        return false;
      }
    };

    let ok = await tryOnce();
    if (!ok && !intentionalDisconnect.has(role)) {
      await delay(CONNECT_RETRY_DELAY_MS);
      if (!intentionalDisconnect.has(role)) {
        ok = await tryOnce();
      }
    }

    if (!ok) {
      store().setDeviceStatus(role, 'DISCONNECTED');
      if (!intentionalDisconnect.has(role)) scheduleReconnect(role);
      return false;
    }

    return true;
  },

  /**
   * One-time-use passkey handshake required before the necklace will stream
   * conversation data (Functional Requirement A). Not used for SAC-Compass.
   */
  async sendPasskey(role: DeviceRole, passkey: string): Promise<boolean> {
    if (role === 'COMPASS') return false;
    return writeCommand(role, { cmd: NECKLACE_COMMANDS.AUTH_PASSKEY, passkey });
  },

  /** Persists user preferences into the necklace's non-volatile storage. */
  async pushSettings(settings: {
    hapticIntensity: string;
    vibrationPattern: string;
    compassMode: string;
    laughterMode: boolean;
  }): Promise<boolean> {
    if (!connections.has('NECKLACE')) return false;
    return writeCommand('NECKLACE', {
      cmd: NECKLACE_COMMANDS.APPLY_SETTINGS,
      ...settings,
    });
  },

  async requestMicCalibration(): Promise<boolean> {
    if (!connections.has('NECKLACE')) return false;
    return writeCommand('NECKLACE', { cmd: NECKLACE_COMMANDS.CALIBRATE_MICS });
  },

  /** Haptic commands always target the wristband link specifically. */
  async sendWristbandCommand(command: number, value?: number): Promise<boolean> {
    return writeCommand('WRISTBAND', { cmd: command, value: value ?? 0 });
  },

  async disconnectRole(role: DeviceRole): Promise<void> {
    intentionalDisconnect.add(role);

    const timer = reconnectTimers.get(role);
    if (timer) clearTimeout(timer);
    reconnectTimers.delete(role);
    reconnectAttempts.set(role, 0);

    const connection = connections.get(role);
    const deviceId = connection?.device.id ?? lastKnownId.get(role);
    teardown(role);

    if (connection) {
      try {
        await connection.device.cancelConnection();
      } catch {
        // Already gone.
      }
    } else if (deviceId && manager) {
      try {
        await manager.cancelDeviceConnection(deviceId);
      } catch {
        /* ignore */
      }
    }

    lastKnownId.delete(role);
    store().resetDevice(role);
  },

  async disconnectAll(): Promise<void> {
    await Promise.all(
      (['COMPASS', 'NECKLACE', 'WRISTBAND'] as DeviceRole[]).map((role) =>
        bleService.disconnectRole(role),
      ),
    );
  },

  destroy(): void {
    bleService.stopScan();
    void bleService.disconnectAll();
    onPacketHook = null;
    if (manager) {
      try {
        manager.destroy();
      } catch {
        // Already destroyed.
      }
    }
    manager = null;
  },
};
