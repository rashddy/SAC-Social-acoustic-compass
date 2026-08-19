// Validates the SQLite schema and every statement the repositories issue,
// against a real in-memory SQLite database.
//
// This exists because expo-sqlite only runs inside the app, where a broken
// statement is swallowed by the fail-soft `guard()` and shows up as silently
// missing data rather than an error. Run it after any schema change:
//
//   node --experimental-sqlite scripts/verify-schema.mjs
//
// Requires Node 22.5 or newer for the built-in node:sqlite module.

import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const clientSource = readFileSync(join(root, 'src/services/db/client.ts'), 'utf8');

const schemaMatch = clientSource.match(/const SCHEMA_SQL = `([\s\S]*?)`;/);
if (!schemaMatch) {
  console.error('FAIL: could not find SCHEMA_SQL in src/services/db/client.ts');
  process.exit(1);
}

const db = new DatabaseSync(':memory:');
const checks = [];
const record = (name, fn) => {
  try {
    fn();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, error: error.message });
  }
};

record('schema creates all tables', () => {
  // WAL is meaningless in memory and PRAGMA statements are not under test.
  db.exec(schemaMatch[1].replace(/PRAGMA journal_mode = WAL;/, ''));

  const expected = [
    'tblUser',
    'tblDevice',
    'tblConversationSession',
    'tblAcousticEvent',
    'tblDeviceSettings',
    'tblPerformanceLog',
    'appState',
  ];
  const found = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name);

  const missing = expected.filter((table) => !found.includes(table));
  if (missing.length) throw new Error(`missing tables: ${missing.join(', ')}`);
});

let userID;
record('userRepo: create local user', () => {
  const result = db
    .prepare('INSERT INTO tblUser (username, pinCode, createdAt) VALUES (?, ?, ?)')
    .run('Local User', '', Date.now());
  userID = Number(result.lastInsertRowid);
  if (!userID) throw new Error('no userID returned');
});

record('userRepo: store and read a hashed pin', () => {
  db.prepare('UPDATE tblUser SET pinCode = ?, username = ? WHERE userID = ?').run(
    'somesalt:somehash',
    'Local User',
    userID,
  );
  const row = db.prepare('SELECT pinCode FROM tblUser WHERE userID = ?').get(userID);
  if (row.pinCode !== 'somesalt:somehash') throw new Error('pin round-trip failed');
});

record('deviceRepo: upsert is idempotent on macaddress', () => {
  const upsert = (battery) =>
    db
      .prepare(
        `INSERT INTO tblDevice
           (userID, deviceNAME, deviceType, macaddress, firmwareVersion,
            batteryLevel, lastConnected, passkeyBonded)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(macaddress) DO UPDATE SET
           deviceNAME = excluded.deviceNAME,
           deviceType = excluded.deviceType,
           firmwareVersion = COALESCE(excluded.firmwareVersion, tblDevice.firmwareVersion),
           batteryLevel = COALESCE(excluded.batteryLevel, tblDevice.batteryLevel),
           lastConnected = excluded.lastConnected,
           passkeyBonded = MAX(excluded.passkeyBonded, tblDevice.passkeyBonded)`,
      )
      .run(userID, 'SAC-Necklace', 'NECKLACE', 'AA:BB:CC', '1.0.0', battery, Date.now(), 1);

  upsert(90);
  upsert(85);

  const rows = db.prepare('SELECT * FROM tblDevice WHERE macaddress = ?').all('AA:BB:CC');
  if (rows.length !== 1) throw new Error(`expected 1 row, got ${rows.length}`);
  if (rows[0].batteryLevel !== 85) throw new Error('battery was not updated');
  if (rows[0].passkeyBonded !== 1) throw new Error('bond flag was lost');
});

let sessionID;
record('sessionRepo: save a session with events', () => {
  const inserted = db
    .prepare(
      `INSERT INTO tblConversationSession
         (userID, startTime, endTime, locationTag, totalSpeakers, title, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(userID, 1000, 2000, 'General', 3, 'Test Session', Date.now());
  sessionID = Number(inserted.lastInsertRowid);

  const insertEvent = db.prepare(
    `INSERT INTO tblAcousticEvent
       (sessionID, transcription, audioState, emotion, speakerDirection, doa,
        confidenceScore, speakerCount, eventTime)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertEvent.run(sessionID, 'Hello there', 'SINGLE', 'HAPPY', 'NE', 45, 0.9, 1, 1100);
  insertEvent.run(sessionID, 'Two at once', 'OVERLAP', 'URGENT', 'S', 180, 0.7, 3, 1200);
});

record('sessionRepo: list returns an event count', () => {
  const rows = db
    .prepare(
      `SELECT s.*, COUNT(e.eventID) AS eventCount
         FROM tblConversationSession s
         LEFT JOIN tblAcousticEvent e ON e.sessionID = s.sessionID
        GROUP BY s.sessionID
        ORDER BY s.startTime DESC`,
    )
    .all();
  if (rows.length !== 1) throw new Error(`expected 1 session, got ${rows.length}`);
  if (rows[0].eventCount !== 2) throw new Error(`expected 2 events, got ${rows[0].eventCount}`);
});

record('sessionRepo: filter by audio state', () => {
  const query = db.prepare(
    `SELECT s.*, COUNT(e.eventID) AS eventCount
       FROM tblConversationSession s
       JOIN tblAcousticEvent e ON e.sessionID = s.sessionID
      WHERE e.audioState = ?
      GROUP BY s.sessionID
      ORDER BY s.startTime DESC`,
  );
  if (query.all('OVERLAP').length !== 1) throw new Error('OVERLAP filter found nothing');
  if (query.all('LAUGHTER').length !== 0) throw new Error('LAUGHTER filter should be empty');
});

record('settingsRepo: upsert keyed on userID', () => {
  const save = (intensity) =>
    db
      .prepare(
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
      )
      .run(userID, intensity, 'PULSE', 'RADAR', 'VOSK', 'MEDIUM', 0, 0);

  save(2);
  save(3);

  const rows = db.prepare('SELECT * FROM tblDeviceSettings WHERE userID = ?').all(userID);
  if (rows.length !== 1) throw new Error(`expected 1 settings row, got ${rows.length}`);
  if (rows[0].hapticIntensity !== 3) throw new Error('intensity was not updated');
});

record('performanceRepo: insert and summarize', () => {
  const insert = db.prepare(
    `INSERT INTO tblPerformanceLog
       (sessionID, tinyMLInferenceTime, tdoaComputeTime, bleLatency, batteryLevel, recordedAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  insert.run(sessionID, 40, 10, 50, 90, new Date().toISOString());
  insert.run(sessionID, 60, 20, 70, 88, new Date().toISOString());

  const row = db
    .prepare(
      `SELECT COUNT(*) AS sampleCount,
              AVG(tinyMLInferenceTime) AS avgInference,
              MAX(tinyMLInferenceTime) AS maxInference,
              MIN(tinyMLInferenceTime) AS minInference,
              AVG(bleLatency) AS avgLatency
         FROM tblPerformanceLog`,
    )
    .get();

  if (row.sampleCount !== 2) throw new Error('wrong sample count');
  if (row.avgInference !== 50) throw new Error(`avg inference was ${row.avgInference}`);
  if (row.avgLatency !== 60) throw new Error(`avg latency was ${row.avgLatency}`);
});

record('cascade delete removes child events', () => {
  db.exec('PRAGMA foreign_keys = ON');
  db.prepare('DELETE FROM tblConversationSession WHERE sessionID = ?').run(sessionID);
  const remaining = db
    .prepare('SELECT COUNT(*) AS n FROM tblAcousticEvent WHERE sessionID = ?')
    .get(sessionID);
  if (remaining.n !== 0) throw new Error(`${remaining.n} orphaned events remain`);
});

record('appState: key/value round-trip', () => {
  db.prepare('INSERT OR REPLACE INTO appState (key, value) VALUES (?, ?)').run(
    'onboarding_complete',
    'true',
  );
  const row = db.prepare('SELECT value FROM appState WHERE key = ?').get('onboarding_complete');
  if (row.value !== 'true') throw new Error('appState round-trip failed');
});

let failed = 0;
for (const check of checks) {
  if (check.ok) {
    console.log(`  ok   ${check.name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${check.name}\n       ${check.error}`);
  }
}

console.log(
  `\n${checks.length - failed}/${checks.length} schema checks passed.`,
);
process.exit(failed === 0 ? 0 : 1);
