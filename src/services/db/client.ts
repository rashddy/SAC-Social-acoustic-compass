import * as SQLite from 'expo-sqlite';

const DB_NAME = 'sac_compass.db';
const DB_TIMEOUT_MS = 5000;
const SCHEMA_VERSION = 2;

let db: SQLite.SQLiteDatabase | null = null;
let opening: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Schema mirrors section 4.7.3 of the capstone document (Database Fields) so the
 * ERD in Figure 4.7.2.1 and the shipped SQLite tables stay in step.
 */
const SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS tblUser (
    userID INTEGER PRIMARY KEY AUTOINCREMENT,
    username VARCHAR(50) NOT NULL,
    pinCode VARCHAR(100) NOT NULL,
    createdAt DATETIME NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tblDevice (
    deviceID INTEGER PRIMARY KEY AUTOINCREMENT,
    userID INTEGER NOT NULL,
    deviceNAME VARCHAR(100) NOT NULL,
    deviceType VARCHAR(20) NOT NULL,
    macaddress VARCHAR(50) NOT NULL UNIQUE,
    firmwareVersion VARCHAR(20),
    batteryLevel FLOAT,
    lastConnected DATETIME,
    passkeyBonded INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (userID) REFERENCES tblUser(userID) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tblConversationSession (
    sessionID INTEGER PRIMARY KEY AUTOINCREMENT,
    userID INTEGER NOT NULL,
    startTime DATETIME NOT NULL,
    endTime DATETIME NOT NULL,
    locationTag VARCHAR(100),
    totalSpeakers INTEGER DEFAULT 0,
    title VARCHAR(150),
    createdAt DATETIME NOT NULL,
    FOREIGN KEY (userID) REFERENCES tblUser(userID) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tblAcousticEvent (
    eventID INTEGER PRIMARY KEY AUTOINCREMENT,
    sessionID INTEGER NOT NULL,
    transcription TEXT,
    audioState VARCHAR(30) NOT NULL,
    emotion VARCHAR(20) NOT NULL DEFAULT 'NEUTRAL',
    speakerDirection VARCHAR(20) NOT NULL,
    doa FLOAT NOT NULL DEFAULT 0,
    confidenceScore FLOAT NOT NULL,
    speakerCount INTEGER,
    eventTime DATETIME,
    FOREIGN KEY (sessionID) REFERENCES tblConversationSession(sessionID) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tblDeviceSettings (
    settingID INTEGER PRIMARY KEY AUTOINCREMENT,
    userID INTEGER NOT NULL UNIQUE,
    hapticIntensity INTEGER NOT NULL,
    vibrationPattern VARCHAR(20) NOT NULL,
    compassMode VARCHAR(20) NOT NULL,
    speechEngine VARCHAR(20) NOT NULL,
    fontSize VARCHAR(20) NOT NULL,
    highContrast BOOLEAN NOT NULL DEFAULT 0,
    laughterMode BOOLEAN NOT NULL DEFAULT 0,
    FOREIGN KEY (userID) REFERENCES tblUser(userID) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tblPerformanceLog (
    logID INTEGER PRIMARY KEY AUTOINCREMENT,
    sessionID INTEGER,
    tinyMLInferenceTime FLOAT NOT NULL,
    tdoaComputeTime FLOAT NOT NULL,
    bleLatency FLOAT NOT NULL,
    batteryLevel FLOAT NOT NULL,
    recordedAt VARCHAR(40) NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_event_session ON tblAcousticEvent(sessionID);
  CREATE INDEX IF NOT EXISTS idx_perf_session ON tblPerformanceLog(sessionID);

  /* Key/value store for app-level flags such as onboarding completion. */
  CREATE TABLE IF NOT EXISTS appState (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
`;

/**
 * Moves rows from the pre-ERD schema (sessions/utterances/settings) into the
 * normalized tables, then drops the old ones.
 */
const migrateLegacyTables = async (database: SQLite.SQLiteDatabase): Promise<void> => {
  const legacy = await database.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions'",
  );
  if (!legacy) return;

  const userID = await ensureLegacyUser(database);

  const oldSessions = await database.getAllAsync<{
    id: string;
    title: string;
    location_tag: string;
    started_at: number;
    ended_at: number;
    utterance_count: number;
  }>('SELECT * FROM sessions');

  for (const session of oldSessions) {
    const inserted = await database.runAsync(
      `INSERT INTO tblConversationSession
         (userID, startTime, endTime, locationTag, totalSpeakers, title, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userID,
        session.started_at,
        session.ended_at,
        session.location_tag ?? 'General',
        0,
        session.title,
        session.started_at,
      ],
    );

    const utterances = await database.getAllAsync<{
      text: string;
      doa: number;
      direction: string;
      audio_state: string;
      timestamp: number;
    }>('SELECT * FROM utterances WHERE session_id = ?', [session.id]);

    for (const u of utterances) {
      await database.runAsync(
        `INSERT INTO tblAcousticEvent
           (sessionID, transcription, audioState, emotion, speakerDirection, doa,
            confidenceScore, speakerCount, eventTime)
         VALUES (?, ?, ?, 'NEUTRAL', ?, ?, 0, 1, ?)`,
        [
          inserted.lastInsertRowId,
          u.text,
          u.audio_state,
          u.direction,
          u.doa,
          u.timestamp,
        ],
      );
    }
  }

  const oldSettings = await database.getAllAsync<{ key: string; value: string }>(
    "SELECT * FROM settings WHERE key = 'onboarding_complete'",
  );
  for (const row of oldSettings) {
    await database.runAsync('INSERT OR REPLACE INTO appState (key, value) VALUES (?, ?)', [
      row.key,
      row.value,
    ]);
  }

  await database.execAsync(`
    DROP TABLE IF EXISTS utterances;
    DROP TABLE IF EXISTS sessions;
    DROP TABLE IF EXISTS settings;
  `);
};

const ensureLegacyUser = async (database: SQLite.SQLiteDatabase): Promise<number> => {
  const existing = await database.getFirstAsync<{ userID: number }>(
    'SELECT userID FROM tblUser ORDER BY userID LIMIT 1',
  );
  if (existing) return existing.userID;

  const inserted = await database.runAsync(
    'INSERT INTO tblUser (username, pinCode, createdAt) VALUES (?, ?, ?)',
    ['Local User', '', Date.now()],
  );
  return inserted.lastInsertRowId;
};

const initialize = async (): Promise<SQLite.SQLiteDatabase> => {
  const opened = await SQLite.openDatabaseAsync(DB_NAME);
  await opened.execAsync(SCHEMA_SQL);
  await migrateLegacyTables(opened);
  await opened.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return opened;
};

export const openDb = async (): Promise<SQLite.SQLiteDatabase> => {
  if (db) return db;
  if (!opening) {
    opening = initialize()
      .then((opened) => {
        db = opened;
        return opened;
      })
      .catch((error) => {
        // Allow a later call to retry instead of caching a broken handle.
        opening = null;
        throw error;
      });
  }
  return opening;
};

/** Resolves to `fallback` when a query fails or never settles. */
export const guard = async <T>(work: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await Promise.race([
      work(),
      new Promise<T>((resolve) => setTimeout(() => resolve(fallback), DB_TIMEOUT_MS)),
    ]);
  } catch (error) {
    console.warn('[db] query failed', error);
    return fallback;
  }
};

export const resetDatabaseHandle = (): void => {
  db = null;
  opening = null;
};
