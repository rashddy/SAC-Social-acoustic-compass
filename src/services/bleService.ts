import { NativeModules, Platform } from 'react-native';

import {
  BLE_NOTIFY_CHAR_UUID,
  BLE_SERVICE_UUID,
  BLE_WRITE_CHAR_UUID,
  DEVICE_LABEL,
  NECKLACE_COMMANDS,
  roleFromDeviceName,
  WRISTBAND_COMMANDS,
  type BlePacket,
  type DeviceRole,
  type WristbandStatusPacket,
} from '@/constants/bleConstants';
import { performanceRepo } from '@/services/db';
import { useCompassStore } from '@/store/compassStore';
import { decodeBase64, encodeBase64 } from '@/utils/base64';
import { intensityForEmotion, intensityOpcode } from '@/utils/haptics';

type BleManagerType = import('react-native-ble-plx').BleManager;
type DeviceType = import('react-native-ble-plx').Device;
type SubscriptionType = import('react-native-ble-plx').Subscription;

type Connection = {
  role: DeviceRole;
  device: DeviceType;
  notify: SubscriptionType | null;
  disconnectSub: SubscriptionType | null;
};

const MAX_RECONNECT = 5;
const SCAN_TIMEOUT_MS = 15000;

let manager: BleManagerType | null = null;

/** One live connection per role, so necklace and wristband coexist. */
const connections = new Map<DeviceRole, Connection>();
const reconnectAttempts = new Map<DeviceRole, number>();
const reconnectTimers = new Map<DeviceRole, ReturnType<typeof setTimeout>>();
const lastKnownId = new Map<DeviceRole, string>();

let scanTimeout: ReturnType<typeof setTimeout> | null = null;
let onPacketHook: ((role: DeviceRole, packet: BlePacket) => void) | null = null;

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
 * Relays the necklace's direction to the wristband, scaling strength by the
 * detected emotion. Sent phone-side so the two wearables never need a direct
 * link between them.
 */
const relayHaptic = (packet: BlePacket) => {
  if (packet.state === 'SILENCE' || !connections.has('WRISTBAND')) return;

  const s = store();
  const intensity = intensityForEmotion(s.wristbandIntensity, packet.emotion ?? 'NEUTRAL');

  writeCommand('WRISTBAND', {
    cmd: WRISTBAND_COMMANDS.DIRECTION,
    doa: Math.round(packet.doa),
    intensity: intensityOpcode(intensity),
    pattern: WRISTBAND_COMMANDS.PATTERN[s.wristbandPattern],
    laughter: packet.state === 'LAUGHTER' && s.laughterMode,
  });
};

const handleNecklacePacket = (packet: BlePacket) => {
  store().handleBlePacket(packet);
  relayHaptic(packet);

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

  onPacketHook?.('NECKLACE', packet);

  if (packet.audio_chunk_b64) {
    import('@/services/speechService').then(({ speechService }) => {
      speechService.processAudioChunk(packet.audio_chunk_b64!, packet.doa, packet.state);
    });
  }
};

const handleWristbandStatus = (status: WristbandStatusPacket) => {
  store().setDeviceLink('WRISTBAND', {
    battery: status.battery ?? null,
    firmware: status.firmware ?? null,
    fault: status.motorFault ? 'Vibration motor fault reported' : null,
  });
};

const subscribeToNotifications = (role: DeviceRole, device: DeviceType): SubscriptionType =>
  device.monitorCharacteristicForService(
    BLE_SERVICE_UUID,
    BLE_NOTIFY_CHAR_UUID,
    (error, characteristic) => {
      if (error) {
        handleDisconnect(role);
        return;
      }

      const raw = characteristic?.value ?? null;

      if (role === 'NECKLACE') {
        const packet = parseFrame<BlePacket>(raw);
        if (isBlePacket(packet)) handleNecklacePacket(packet);
        return;
      }

      const status = parseFrame<WristbandStatusPacket>(raw);
      if (status) handleWristbandStatus(status);
    },
  );

const teardown = (role: DeviceRole) => {
  const connection = connections.get(role);
  if (!connection) return;
  connection.notify?.remove();
  connection.disconnectSub?.remove();
  connections.delete(role);
};

const handleDisconnect = (role: DeviceRole) => {
  teardown(role);
  store().setDeviceLink(role, { status: 'DISCONNECTED' });
  scheduleReconnect(role);
};

const scheduleReconnect = (role: DeviceRole) => {
  if (store().isDemoMode) return;

  const attempts = reconnectAttempts.get(role) ?? 0;
  const deviceId = lastKnownId.get(role);
  if (!deviceId || attempts >= MAX_RECONNECT) return;

  const existing = reconnectTimers.get(role);
  if (existing) clearTimeout(existing);

  reconnectAttempts.set(role, attempts + 1);
  reconnectTimers.set(
    role,
    setTimeout(() => {
      bleService.connectToDevice(deviceId, role);
    }, 3000 * (attempts + 1)),
  );
};

const writeCommand = async (
  role: DeviceRole,
  payload: Record<string, unknown>,
): Promise<boolean> => {
  const connection = connections.get(role);
  if (!connection) return false;

  try {
    await connection.device.writeCharacteristicWithResponseForService(
      BLE_SERVICE_UUID,
      BLE_WRITE_CHAR_UUID,
      encodeBase64(JSON.stringify(payload)),
    );
    return true;
  } catch {
    return false;
  }
};

export const bleService = {
  /** True only when native BlePlx is linked (development build), not in Expo Go. */
  isSupported: (): boolean => hasNativeBleModule(),

  getUnavailableReason: (): string => {
    if (Platform.OS === 'web') return 'Bluetooth is not available on web.';
    if (!hasNativeBleModule()) {
      return 'Bluetooth requires a development build. Expo Go cannot load the BLE native module — use Demo Mode to preview the full system.';
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
    try {
      return (await mgr.state()) === 'PoweredOn';
    } catch {
      return false;
    }
  },

  /**
   * Scans for both wearables at once, tagging each hit with its role so the
   * pairing screen can fill the necklace and wristband slots independently.
   */
  async startScan(): Promise<void> {
    const mgr = createManager();
    if (!mgr) {
      store().setScanStatus('IDLE');
      return;
    }

    store().setScanStatus('SCANNING');
    store().setDiscoveredDevices([]);

    const discovered = new Map<string, { name: string; rssi: number; role: DeviceRole }>();

    mgr.startDeviceScan(null, null, (error, device) => {
      if (error) {
        store().setScanStatus('DISCONNECTED');
        return;
      }

      const role = roleFromDeviceName(device?.name);
      if (!device || !role) return;

      discovered.set(device.id, {
        name: device.name ?? DEVICE_LABEL[role],
        rssi: device.rssi ?? -100,
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
   * Connects one wearable. The role is taken from the advertised name when not
   * supplied, so a reconnect keeps targeting the same slot.
   */
  async connectToDevice(deviceId: string, roleHint?: DeviceRole): Promise<boolean> {
    const mgr = createManager();
    if (!mgr) return false;

    const known = store().discoveredDevices.find((d) => d.id === deviceId);
    const role = roleHint ?? known?.role ?? null;
    if (!role) return false;

    store().setDeviceStatus(role, 'CONNECTING');

    try {
      const device = await mgr.connectToDevice(deviceId, { autoConnect: true });
      await device.discoverAllServicesAndCharacteristics();

      teardown(role);

      const notify = subscribeToNotifications(role, device);
      const disconnectSub = device.onDisconnected(() => handleDisconnect(role));

      connections.set(role, { role, device, notify, disconnectSub });
      lastKnownId.set(role, deviceId);
      reconnectAttempts.set(role, 0);

      store().setDeviceLink(role, {
        status: 'CONNECTED',
        id: deviceId,
        name: device.name ?? DEVICE_LABEL[role],
        rssi: known?.rssi ?? null,
        lastConnected: Date.now(),
        fault: null,
      });

      return true;
    } catch {
      store().setDeviceStatus(role, 'DISCONNECTED');
      return false;
    }
  },

  /**
   * One-time-use passkey handshake required before the necklace will stream
   * conversation data (Functional Requirement A). Link-layer AES-128 encryption
   * comes from BLE bonding enforced by the firmware.
   */
  async sendPasskey(role: DeviceRole, passkey: string): Promise<boolean> {
    return writeCommand(role, { cmd: NECKLACE_COMMANDS.AUTH_PASSKEY, passkey });
  },

  /** Persists user preferences into the necklace's non-volatile storage. */
  async pushSettings(settings: {
    hapticIntensity: string;
    vibrationPattern: string;
    compassMode: string;
    laughterMode: boolean;
  }): Promise<boolean> {
    return writeCommand('NECKLACE', {
      cmd: NECKLACE_COMMANDS.APPLY_SETTINGS,
      ...settings,
    });
  },

  async requestMicCalibration(): Promise<boolean> {
    return writeCommand('NECKLACE', { cmd: NECKLACE_COMMANDS.CALIBRATE_MICS });
  },

  /** Haptic commands always target the wristband link specifically. */
  async sendWristbandCommand(command: number, value?: number): Promise<boolean> {
    return writeCommand('WRISTBAND', { cmd: command, value: value ?? 0 });
  },

  async disconnectRole(role: DeviceRole): Promise<void> {
    const timer = reconnectTimers.get(role);
    if (timer) clearTimeout(timer);
    reconnectAttempts.set(role, MAX_RECONNECT);

    const connection = connections.get(role);
    teardown(role);

    if (connection) {
      try {
        await connection.device.cancelConnection();
      } catch {
        // Already gone.
      }
    }

    lastKnownId.delete(role);
    store().resetDevice(role);
  },

  async disconnectAll(): Promise<void> {
    await Promise.all(
      (['NECKLACE', 'WRISTBAND'] as DeviceRole[]).map((role) =>
        bleService.disconnectRole(role),
      ),
    );
  },

  destroy(): void {
    bleService.stopScan();
    bleService.disconnectAll();
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
