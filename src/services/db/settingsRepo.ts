import { guard, openDb } from './client';
import type { DeviceSettingsRow } from './types';
import { userRepo } from './userRepo';

export type SacSettings = {
  hapticIntensity: 'LOW' | 'MEDIUM' | 'HIGH';
  vibrationPattern: 'PULSE' | 'TAP' | 'HOLD';
  compassMode: 'RADAR' | 'ARROW';
  speechEngine: 'VOSK' | 'WHISPER';
  fontSize: 'SMALL' | 'MEDIUM' | 'LARGE';
  highContrast: boolean;
  laughterMode: boolean;
};

export const DEFAULT_SETTINGS: SacSettings = {
  hapticIntensity: 'MEDIUM',
  vibrationPattern: 'PULSE',
  compassMode: 'RADAR',
  speechEngine: 'VOSK',
  fontSize: 'MEDIUM',
  highContrast: false,
  laughterMode: false,
};

/** tblDeviceSettings.hapticIntensity is numeric in the ERD. */
const INTENSITY_TO_NUMBER: Record<SacSettings['hapticIntensity'], number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

const NUMBER_TO_INTENSITY: Record<number, SacSettings['hapticIntensity']> = {
  1: 'LOW',
  2: 'MEDIUM',
  3: 'HIGH',
};

const rowToSettings = (row: DeviceSettingsRow): SacSettings => ({
  hapticIntensity: NUMBER_TO_INTENSITY[row.hapticIntensity] ?? 'MEDIUM',
  vibrationPattern: (row.vibrationPattern as SacSettings['vibrationPattern']) ?? 'PULSE',
  compassMode: (row.compassMode as SacSettings['compassMode']) ?? 'RADAR',
  speechEngine: (row.speechEngine as SacSettings['speechEngine']) ?? 'VOSK',
  fontSize: (row.fontSize as SacSettings['fontSize']) ?? 'MEDIUM',
  highContrast: row.highContrast === 1,
  laughterMode: row.laughterMode === 1,
});

export const settingsRepo = {
  async load(): Promise<SacSettings> {
    return guard(async () => {
      const db = await openDb();
      const userID = await userRepo.currentUserId();
      if (userID == null) return DEFAULT_SETTINGS;

      const row = await db.getFirstAsync<DeviceSettingsRow>(
        'SELECT * FROM tblDeviceSettings WHERE userID = ?',
        [userID],
      );
      return row ? rowToSettings(row) : DEFAULT_SETTINGS;
    }, DEFAULT_SETTINGS);
  },

  /** Upserts the single settings row for the local user. */
  async save(settings: SacSettings): Promise<boolean> {
    return guard(async () => {
      const db = await openDb();
      const userID = await userRepo.currentUserId();
      if (userID == null) return false;

      await db.runAsync(
        `INSERT INTO tblDeviceSettings
           (userID, hapticIntensity, vibrationPattern, compassMode, speechEngine,
            fontSize, highContrast, laughterMode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(userID) DO UPDATE SET
           hapticIntensity = excluded.hapticIntensity,
           vibrationPattern = excluded.vibrationPattern,
           compassMode = excluded.compassMode,
           speechEngine = excluded.speechEngine,
           fontSize = excluded.fontSize,
           highContrast = excluded.highContrast,
           laughterMode = excluded.laughterMode`,
        [
          userID,
          INTENSITY_TO_NUMBER[settings.hapticIntensity],
          settings.vibrationPattern,
          settings.compassMode,
          settings.speechEngine,
          settings.fontSize,
          settings.highContrast ? 1 : 0,
          settings.laughterMode ? 1 : 0,
        ],
      );
      return true;
    }, false);
  },
};

/** App-level flags that are not part of the ERD (e.g. onboarding completion). */
export const appStateRepo = {
  async get(key: string): Promise<string | null> {
    return guard(async () => {
      const db = await openDb();
      const row = await db.getFirstAsync<{ value: string }>(
        'SELECT value FROM appState WHERE key = ?',
        [key],
      );
      return row?.value ?? null;
    }, null);
  },

  async set(key: string, value: string): Promise<void> {
    await guard(async () => {
      const db = await openDb();
      await db.runAsync('INSERT OR REPLACE INTO appState (key, value) VALUES (?, ?)', [
        key,
        value,
      ]);
    }, undefined);
  },
};
