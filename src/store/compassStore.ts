import { create } from 'zustand';

import type { FontScale } from '@/constants/colors';
import type {
  AudioStateName,
  BlePacket,
  DeviceRole,
  EmotionName,
} from '@/constants/bleConstants';
import { MAX_PARTICIPANTS } from '@/constants/bleConstants';

export type AudioState = AudioStateName;
export type Emotion = EmotionName;
export type WristbandIntensity = 'LOW' | 'MEDIUM' | 'HIGH';
export type WristbandPattern = 'PULSE' | 'TAP' | 'HOLD';
export type SttEngine = 'VOSK' | 'WHISPER';
export type CompassView = 'RADAR' | 'ARROW';
export type WristbandDirection = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | null;

export type TranscriptEntry = {
  id: string;
  text: string;
  doa: number;
  direction: string;
  speakerId: number;
  audioState: AudioState;
  emotion: Emotion;
  confidence: number;
  speakerCount: number;
  timestamp: number;
};

export type SpeakerDot = {
  doa: number;
  id: number;
};

export type ConnectionStatus =
  | 'IDLE'
  | 'SCANNING'
  | 'FOUND'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'DISCONNECTED';

export type DiscoveredDevice = {
  id: string;
  name: string;
  rssi: number;
  role: DeviceRole;
};

/** Live state of one of the two IoT nodes. */
export type DeviceLink = {
  status: ConnectionStatus;
  id: string | null;
  name: string | null;
  rssi: number | null;
  battery: number | null;
  firmware: string | null;
  lastConnected: number | null;
  fault: string | null;
};

export type PerformanceSample = {
  inferenceMs: number;
  tdoaMs: number;
  bleLatencyMs: number;
  battery: number;
  recordedAt: number;
};

const emptyLink = (): DeviceLink => ({
  status: 'IDLE',
  id: null,
  name: null,
  rssi: null,
  battery: null,
  firmware: null,
  lastConnected: null,
  fault: null,
});

type CompassState = {
  hasCompletedOnboarding: boolean;
  isDemoMode: boolean;
  devices: Record<DeviceRole, DeviceLink>;
  scanStatus: ConnectionStatus;
  discoveredDevices: DiscoveredDevice[];
  currentDoa: number;
  speakerDots: SpeakerDot[];
  speakerCount: number;
  audioState: AudioState;
  emotion: Emotion;
  emotionConfidence: number;
  confidence: number;
  liveTranscript: string;
  streamingWord: string;
  sessionLog: TranscriptEntry[];
  activeSessionStartedAt: number | null;
  wristbandDirection: WristbandDirection;
  wristbandFlash: boolean;
  wristbandIntensity: WristbandIntensity;
  wristbandPattern: WristbandPattern;
  laughterMode: boolean;
  transcriptionPaused: boolean;
  sttEngine: SttEngine;
  compassView: CompassView;
  fontScale: FontScale;
  highContrast: boolean;
  perfSamples: PerformanceSample[];
  micCalibrationFault: boolean;

  setHasCompletedOnboarding: (value: boolean) => void;
  setDemoMode: (value: boolean) => void;
  setScanStatus: (status: ConnectionStatus) => void;
  setDeviceStatus: (role: DeviceRole, status: ConnectionStatus) => void;
  setDeviceLink: (role: DeviceRole, patch: Partial<DeviceLink>) => void;
  resetDevice: (role: DeviceRole) => void;
  setDiscoveredDevices: (devices: DiscoveredDevice[]) => void;
  handleBlePacket: (packet: BlePacket) => void;
  addPerformanceSample: (sample: PerformanceSample) => void;
  appendTranscriptWord: (word: string, doa: number, audioState: AudioState) => void;
  finalizeUtterance: () => void;
  addTranscriptEntry: (entry: Omit<TranscriptEntry, 'id'>) => void;
  setLiveTranscript: (text: string) => void;
  setStreamingWord: (word: string) => void;
  setWristbandDirection: (direction: WristbandDirection) => void;
  triggerWristbandFlash: () => void;
  setWristbandIntensity: (intensity: WristbandIntensity) => void;
  setWristbandPattern: (pattern: WristbandPattern) => void;
  setLaughterMode: (enabled: boolean) => void;
  setTranscriptionPaused: (paused: boolean) => void;
  setSttEngine: (engine: SttEngine) => void;
  setCompassView: (view: CompassView) => void;
  setFontScale: (scale: FontScale) => void;
  setHighContrast: (enabled: boolean) => void;
  clearSessionLog: () => void;
  reset: () => void;
};

const doaToDirection = (doa: number): WristbandDirection => {
  const normalized = ((doa % 360) + 360) % 360;
  if (normalized >= 337.5 || normalized < 22.5) return 'N';
  if (normalized < 67.5) return 'NE';
  if (normalized < 112.5) return 'E';
  if (normalized < 157.5) return 'SE';
  if (normalized < 202.5) return 'S';
  if (normalized < 247.5) return 'SW';
  if (normalized < 292.5) return 'W';
  return 'NW';
};

const directionLabel = (doa: number): string => doaToDirection(doa) ?? 'N';

/** Keeps the diagnostics screen bounded; older samples live in SQLite. */
const MAX_PERF_SAMPLES = 120;

let flashTimeout: ReturnType<typeof setTimeout> | null = null;

export const useCompassStore = create<CompassState>((set, get) => ({
  hasCompletedOnboarding: false,
  isDemoMode: false,
  devices: { NECKLACE: emptyLink(), WRISTBAND: emptyLink() },
  scanStatus: 'IDLE',
  discoveredDevices: [],
  currentDoa: 0,
  speakerDots: [{ doa: 0, id: 0 }],
  speakerCount: 0,
  audioState: 'SILENCE',
  emotion: 'NEUTRAL',
  emotionConfidence: 0,
  confidence: 0,
  liveTranscript: '',
  streamingWord: '',
  sessionLog: [],
  activeSessionStartedAt: null,
  wristbandDirection: null,
  wristbandFlash: false,
  wristbandIntensity: 'MEDIUM',
  wristbandPattern: 'PULSE',
  laughterMode: false,
  transcriptionPaused: false,
  sttEngine: 'VOSK',
  compassView: 'RADAR',
  fontScale: 'MEDIUM',
  highContrast: false,
  perfSamples: [],
  micCalibrationFault: false,

  setHasCompletedOnboarding: (value) => set({ hasCompletedOnboarding: value }),

  setDemoMode: (value) => set({ isDemoMode: value }),

  setScanStatus: (status) => set({ scanStatus: status }),

  setDeviceStatus: (role, status) =>
    set((s) => ({
      devices: { ...s.devices, [role]: { ...s.devices[role], status } },
    })),

  setDeviceLink: (role, patch) =>
    set((s) => ({
      devices: { ...s.devices, [role]: { ...s.devices[role], ...patch } },
    })),

  resetDevice: (role) =>
    set((s) => ({ devices: { ...s.devices, [role]: emptyLink() } })),

  setDiscoveredDevices: (devices) => set({ discoveredDevices: devices }),

  handleBlePacket: (packet) => {
    const direction = doaToDirection(packet.doa);
    const prevDirection = get().wristbandDirection;
    const speakerDots: SpeakerDot[] =
      packet.state === 'OVERLAP' && packet.speakers?.length
        ? packet.speakers.slice(0, MAX_PARTICIPANTS)
        : [{ doa: packet.doa, id: 0 }];

    set((s) => ({
      currentDoa: packet.doa,
      speakerDots,
      speakerCount: packet.speakerCount ?? speakerDots.length,
      audioState: packet.state,
      emotion: packet.emotion ?? 'NEUTRAL',
      emotionConfidence: packet.emotionConfidence ?? 0,
      confidence: packet.confidence,
      wristbandDirection: packet.state === 'SILENCE' ? null : direction,
      micCalibrationFault: packet.micCalibrationFault ?? s.micCalibrationFault,
      activeSessionStartedAt:
        s.activeSessionStartedAt ?? (packet.state === 'SILENCE' ? null : Date.now()),
      devices:
        packet.battery == null && packet.firmware == null
          ? s.devices
          : {
              ...s.devices,
              NECKLACE: {
                ...s.devices.NECKLACE,
                battery: packet.battery ?? s.devices.NECKLACE.battery,
                firmware: packet.firmware ?? s.devices.NECKLACE.firmware,
              },
            },
    }));

    if (direction && direction !== prevDirection && packet.state !== 'SILENCE') {
      get().triggerWristbandFlash();
    }
  },

  addPerformanceSample: (sample) =>
    set((s) => ({
      perfSamples: [...s.perfSamples, sample].slice(-MAX_PERF_SAMPLES),
    })),

  appendTranscriptWord: (word) => {
    if (get().transcriptionPaused) return;
    set((s) => ({
      streamingWord: word,
      liveTranscript: s.liveTranscript ? `${s.liveTranscript} ${word}` : word,
      activeSessionStartedAt: s.activeSessionStartedAt ?? Date.now(),
    }));
  },

  finalizeUtterance: () => {
    const {
      liveTranscript,
      currentDoa,
      audioState,
      emotion,
      confidence,
      speakerCount,
      sessionLog,
    } = get();
    if (!liveTranscript.trim()) return;

    const entry: TranscriptEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text: liveTranscript.trim(),
      doa: currentDoa,
      direction: directionLabel(currentDoa),
      speakerId: 0,
      audioState,
      emotion,
      confidence,
      speakerCount,
      timestamp: Date.now(),
    };

    set({
      sessionLog: [...sessionLog, entry],
      liveTranscript: '',
      streamingWord: '',
    });
  },

  addTranscriptEntry: (entry) =>
    set((s) => ({
      sessionLog: [
        ...s.sessionLog,
        { ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` },
      ],
    })),

  setLiveTranscript: (text) => set({ liveTranscript: text }),
  setStreamingWord: (word) => set({ streamingWord: word }),

  setWristbandDirection: (direction) => set({ wristbandDirection: direction }),

  triggerWristbandFlash: () => {
    set({ wristbandFlash: true });
    if (flashTimeout) clearTimeout(flashTimeout);
    flashTimeout = setTimeout(() => set({ wristbandFlash: false }), 300);
  },

  setWristbandIntensity: (intensity) => set({ wristbandIntensity: intensity }),
  setWristbandPattern: (pattern) => set({ wristbandPattern: pattern }),
  setLaughterMode: (enabled) => set({ laughterMode: enabled }),
  setTranscriptionPaused: (paused) => set({ transcriptionPaused: paused }),
  setSttEngine: (engine) => set({ sttEngine: engine }),
  setCompassView: (view) => set({ compassView: view }),
  setFontScale: (scale) => set({ fontScale: scale }),
  setHighContrast: (enabled) => set({ highContrast: enabled }),

  clearSessionLog: () =>
    set({
      sessionLog: [],
      liveTranscript: '',
      streamingWord: '',
      activeSessionStartedAt: null,
    }),

  reset: () =>
    set({
      devices: { NECKLACE: emptyLink(), WRISTBAND: emptyLink() },
      scanStatus: 'IDLE',
      discoveredDevices: [],
      currentDoa: 0,
      speakerDots: [{ doa: 0, id: 0 }],
      speakerCount: 0,
      audioState: 'SILENCE',
      emotion: 'NEUTRAL',
      emotionConfidence: 0,
      confidence: 0,
      liveTranscript: '',
      streamingWord: '',
      sessionLog: [],
      activeSessionStartedAt: null,
      wristbandDirection: null,
      perfSamples: [],
      micCalibrationFault: false,
      isDemoMode: false,
    }),
}));

/** True when at least one wearable is connected. */
export const selectIsConnected = (s: CompassState): boolean =>
  s.devices.NECKLACE.status === 'CONNECTED' || s.devices.WRISTBAND.status === 'CONNECTED';

export const selectConnectedRoles = (s: CompassState): DeviceRole[] =>
  (Object.keys(s.devices) as DeviceRole[]).filter(
    (role) => s.devices[role].status === 'CONNECTED',
  );

export { doaToDirection, directionLabel };
