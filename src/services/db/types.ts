import type { AudioStateName, DeviceRole, EmotionName } from '@/constants/bleConstants';

export type UserRow = {
  userID: number;
  username: string;
  pinCode: string;
  createdAt: number;
};

export type DeviceRow = {
  deviceID: number;
  userID: number;
  deviceNAME: string;
  deviceType: DeviceRole;
  macaddress: string;
  firmwareVersion: string | null;
  batteryLevel: number | null;
  lastConnected: number | null;
  passkeyBonded: number;
};

export type SessionRow = {
  sessionID: number;
  userID: number;
  startTime: number;
  endTime: number;
  locationTag: string | null;
  totalSpeakers: number;
  title: string | null;
  createdAt: number;
};

export type AcousticEventRow = {
  eventID: number;
  sessionID: number;
  transcription: string | null;
  audioState: AudioStateName;
  emotion: EmotionName;
  speakerDirection: string;
  doa: number;
  confidenceScore: number;
  speakerCount: number | null;
  eventTime: number | null;
};

export type DeviceSettingsRow = {
  settingID: number;
  userID: number;
  hapticIntensity: number;
  vibrationPattern: string;
  compassMode: string;
  speechEngine: string;
  fontSize: string;
  highContrast: number;
  laughterMode: number;
};

export type PerformanceLogRow = {
  logID: number;
  sessionID: number | null;
  tinyMLInferenceTime: number;
  tdoaComputeTime: number;
  bleLatency: number;
  batteryLevel: number;
  recordedAt: string;
};

/** Session plus its events, as the history and detail screens consume it. */
export type SessionWithEvents = SessionRow & {
  events: AcousticEventRow[];
  eventCount: number;
};
