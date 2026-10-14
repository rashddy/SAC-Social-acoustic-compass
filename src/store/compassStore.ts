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
export type MicZone = 'FRONT' | 'LEFT' | 'RIGHT';
/** Wristband motor cardinals (FRONT→N, RIGHT→E, LEFT→W). */
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

/** A reply the user typed, shown in the chat and held up for the speaker to read. */
export type TypedReply = {
  id: string;
  text: string;
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
  /** Locked-mic fundamental frequency in Hz. 0 when pitch is not available. */
  pitchHz: number;
  confidence: number;
  liveTranscript: string;
  streamingWord: string;
  sessionLog: TranscriptEntry[];
  replies: TypedReply[];
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
  /** Live BLE→STT pipeline status for the transcript strip. */
  blePcmPackets: number;
  sttReady: boolean;
  sttEngineLabel: string;
  sttHint: string;

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
  reviseLastTranscript: (text: string) => void;
  addReply: (text: string) => TypedReply;
  setLiveTranscript: (text: string) => void;
  setStreamingWord: (word: string) => void;
  setSttStatus: (patch: {
    blePcmPackets?: number;
    sttReady?: boolean;
    sttEngineLabel?: string;
    sttHint?: string;
  }) => void;
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

/** Map DOA degrees to the three mic zones (LEFT / FRONT / RIGHT). */
const doaToMicZone = (doa: number): MicZone => {
  let n = ((doa % 360) + 360) % 360;
  if (n > 180) n -= 360;
  if (n >= -45 && n <= 45) return 'FRONT';
  if (n > 45 && n <= 135) return 'RIGHT';
  if (n < -45 && n >= -135) return 'LEFT';
  // Behind the wearer — snap to nearest side mic.
  return n > 0 ? 'RIGHT' : 'LEFT';
};

const doaToDirection = (doa: number): WristbandDirection => {
  const zone = doaToMicZone(doa);
  if (zone === 'FRONT') return 'N';
  if (zone === 'RIGHT') return 'E';
  return 'W';
};

const directionLabel = (doa: number): string => doaToMicZone(doa);

/** Keeps the diagnostics screen bounded; older samples live in SQLite. */
const MAX_PERF_SAMPLES = 120;

let flashTimeout: ReturnType<typeof setTimeout> | null = null;

export const useCompassStore = create<CompassState>((set, get) => ({
  hasCompletedOnboarding: false,
  isDemoMode: false,
  devices: { COMPASS: emptyLink(), NECKLACE: emptyLink(), WRISTBAND: emptyLink() },
  scanStatus: 'IDLE',
  discoveredDevices: [],
  currentDoa: 0,
  speakerDots: [],
  speakerCount: 0,
  audioState: 'SILENCE',
  emotion: 'NEUTRAL',
  emotionConfidence: 0,
  pitchHz: 0,
  confidence: 0,
  liveTranscript: '',
  streamingWord: '',
  sessionLog: [],
  replies: [],
  activeSessionStartedAt: null,
  wristbandDirection: null,
  wristbandFlash: false,
  wristbandIntensity: 'MEDIUM',
  wristbandPattern: 'PULSE',
  laughterMode: false,
  transcriptionPaused: false,
  sttEngine: 'WHISPER',
  compassView: 'RADAR',
  fontScale: 'MEDIUM',
  highContrast: false,
  perfSamples: [],
  micCalibrationFault: false,
  blePcmPackets: 0,
  sttReady: false,
  sttEngineLabel: '',
  sttHint: '',

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
    const isIdle = packet.state === 'SILENCE' || packet.state === 'NOISE';
    const speakerDots: SpeakerDot[] = isIdle
      ? []
      : packet.state === 'OVERLAP' && packet.speakers?.length
        ? packet.speakers.slice(0, MAX_PARTICIPANTS)
        : [{ doa: packet.doa, id: 0 }];

    set((s) => ({
      currentDoa: packet.doa,
      speakerDots,
      speakerCount: isIdle ? 0 : (packet.speakerCount ?? speakerDots.length),
      audioState: packet.state,
      emotion: isIdle ? 'NEUTRAL' : (packet.emotion ?? s.emotion),
      emotionConfidence: isIdle ? 0 : (packet.emotionConfidence ?? s.emotionConfidence),
      pitchHz: isIdle
        ? 0
        : packet.pitchHz != null
          ? packet.pitchHz
          : packet.emotion != null
            ? 0
            : s.pitchHz,
      confidence: packet.confidence,
      wristbandDirection: isIdle ? null : direction,
      micCalibrationFault: packet.micCalibrationFault ?? s.micCalibrationFault,
      activeSessionStartedAt:
        s.activeSessionStartedAt ?? (packet.state === 'SILENCE' ? null : Date.now()),
      devices:
        packet.battery == null && packet.firmware == null
          ? s.devices
          : {
              ...s.devices,
              COMPASS: {
                ...s.devices.COMPASS,
                battery: packet.battery ?? s.devices.COMPASS.battery,
                firmware: packet.firmware ?? s.devices.COMPASS.firmware,
              },
              NECKLACE: {
                ...s.devices.NECKLACE,
                battery: packet.battery ?? s.devices.NECKLACE.battery,
                firmware: packet.firmware ?? s.devices.NECKLACE.firmware,
              },
            },
    }));

    if (direction && direction !== prevDirection && !isIdle) {
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

  reviseLastTranscript: (text) =>
    set((s) => {
      if (s.sessionLog.length === 0) return s;
      const next = s.sessionLog.slice();
      const last = next[next.length - 1]!;
      next[next.length - 1] = { ...last, text };
      return { sessionLog: next };
    }),

  addReply: (text) => {
    const reply: TypedReply = {
      id: `reply-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text: text.trim(),
      timestamp: Date.now(),
    };
    set((s) => ({ replies: [...(s.replies ?? []), reply] }));
    return reply;
  },

  setLiveTranscript: (text) => set({ liveTranscript: text }),
  setStreamingWord: (word) =>
    set((s) => (s.streamingWord === word ? s : { streamingWord: word })),

  setSttStatus: (patch) =>
    set((s) => {
      const next = {
        blePcmPackets: patch.blePcmPackets ?? s.blePcmPackets,
        sttReady: patch.sttReady ?? s.sttReady,
        sttEngineLabel: patch.sttEngineLabel ?? s.sttEngineLabel,
        sttHint: patch.sttHint ?? s.sttHint,
      };
      if (
        next.blePcmPackets === s.blePcmPackets &&
        next.sttReady === s.sttReady &&
        next.sttEngineLabel === s.sttEngineLabel &&
        next.sttHint === s.sttHint
      ) {
        return s;
      }
      return next;
    }),

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
      replies: [],
      liveTranscript: '',
      streamingWord: '',
      activeSessionStartedAt: null,
    }),

  reset: () =>
    set({
      devices: { COMPASS: emptyLink(), NECKLACE: emptyLink(), WRISTBAND: emptyLink() },
      scanStatus: 'IDLE',
      discoveredDevices: [],
      currentDoa: 0,
      speakerDots: [],
      speakerCount: 0,
      audioState: 'SILENCE',
      emotion: 'NEUTRAL',
      emotionConfidence: 0,
      pitchHz: 0,
      confidence: 0,
      liveTranscript: '',
      streamingWord: '',
      sessionLog: [],
      replies: [],
      activeSessionStartedAt: null,
      wristbandDirection: null,
      perfSamples: [],
      micCalibrationFault: false,
      isDemoMode: false,
      blePcmPackets: 0,
      sttReady: false,
      sttEngineLabel: '',
      sttHint: '',
    }),
}));

/** True when the compass (or a legacy wearable) is connected. */
export const selectIsConnected = (s: CompassState): boolean =>
  s.devices.COMPASS.status === 'CONNECTED' ||
  s.devices.NECKLACE.status === 'CONNECTED' ||
  s.devices.WRISTBAND.status === 'CONNECTED';

export const selectConnectedRoles = (s: CompassState): DeviceRole[] =>
  (Object.keys(s.devices) as DeviceRole[]).filter(
    (role) => s.devices[role].status === 'CONNECTED',
  );

export { doaToDirection, doaToMicZone, directionLabel };
