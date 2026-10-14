import type { AudioStateName, EmotionName } from '@/constants/bleConstants';

import { decideDatabaseAccess } from '../auth/authorization';
import { isEncryptedField, openTranscript, sealTranscript } from '../auth/fieldCipher';
import { appSession } from '../auth/sessionVault';
import { guard, openDb } from './client';
import type { AcousticEventRow, SessionRow, SessionWithEvents } from './types';

export type AcousticEventInput = {
  transcription: string;
  audioState: AudioStateName;
  emotion: EmotionName;
  speakerDirection: string;
  doa: number;
  confidenceScore: number;
  speakerCount: number;
  eventTime: number;
};

export type SessionInput = {
  title: string;
  locationTag: string;
  startTime: number;
  endTime: number;
  totalSpeakers: number;
  events: AcousticEventInput[];
};

function can(operation: 'read' | 'write' | 'delete'): boolean {
  return (
    decideDatabaseAccess({
      unlocked: appSession.isUnlocked(),
      recentAuth: appSession.recent(Date.now()),
      operation,
      bleConnected: false,
    }) === 'allow'
  );
}

function reveal(value: string | null, dek: Uint8Array): string | null {
  if (value == null || value === '') return value;
  try {
    return openTranscript(value, dek);
  } catch {
    return null;
  }
}

export const sessionRepo = {
  /** Writes a finished conversation and all of its acoustic events atomically. */
  async save(input: SessionInput): Promise<number | null> {
    return guard(async () => {
      if (!can('write')) return null;
      const dek = appSession.getDek();
      const userID = appSession.getUserId();
      if (!dek || userID == null) return null;

      const db = await openDb();
      let sessionID: number | null = null;

      await db.withTransactionAsync(async () => {
        const inserted = await db.runAsync(
          `INSERT INTO tblConversationSession
             (userID, startTime, endTime, locationTag, totalSpeakers, title, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            userID,
            input.startTime,
            input.endTime,
            sealTranscript(input.locationTag, dek),
            input.totalSpeakers,
            sealTranscript(input.title, dek),
            Date.now(),
          ],
        );
        sessionID = inserted.lastInsertRowId;

        for (const event of input.events) {
          await db.runAsync(
            `INSERT INTO tblAcousticEvent
               (sessionID, transcription, audioState, emotion, speakerDirection, doa,
                confidenceScore, speakerCount, eventTime)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              sessionID,
              sealTranscript(event.transcription, dek),
              event.audioState,
              event.emotion,
              event.speakerDirection,
              event.doa,
              event.confidenceScore,
              event.speakerCount,
              event.eventTime,
            ],
          );
        }
      });

      return sessionID;
    }, null);
  },

  async list(): Promise<(SessionRow & { eventCount: number })[]> {
    return guard(async () => {
      if (!can('read')) return [];
      const dek = appSession.getDek();
      if (!dek) return [];
      const db = await openDb();
      const rows = await db.getAllAsync<SessionRow & { eventCount: number }>(
        `SELECT s.*, COUNT(e.eventID) AS eventCount
           FROM tblConversationSession s
           LEFT JOIN tblAcousticEvent e ON e.sessionID = s.sessionID
          GROUP BY s.sessionID
          ORDER BY s.startTime DESC`,
      );
      return rows.map((row) => ({
        ...row,
        title: reveal(row.title, dek) ?? 'Saved session',
        locationTag: reveal(row.locationTag, dek),
      }));
    }, []);
  },

  /** Sessions that contain at least one event of the given acoustic state. */
  async listByAudioState(
    audioState: AudioStateName,
  ): Promise<(SessionRow & { eventCount: number })[]> {
    return guard(async () => {
      if (!can('read')) return [];
      const dek = appSession.getDek();
      if (!dek) return [];
      const db = await openDb();
      const rows = await db.getAllAsync<SessionRow & { eventCount: number }>(
        `SELECT s.*, COUNT(e.eventID) AS eventCount
           FROM tblConversationSession s
           JOIN tblAcousticEvent e ON e.sessionID = s.sessionID
          WHERE e.audioState = ?
          GROUP BY s.sessionID
          ORDER BY s.startTime DESC`,
        [audioState],
      );
      return rows.map((row) => ({
        ...row,
        title: reveal(row.title, dek) ?? 'Saved session',
        locationTag: reveal(row.locationTag, dek),
      }));
    }, []);
  },

  async findById(sessionID: number): Promise<SessionWithEvents | null> {
    return guard(async () => {
      if (!can('read')) return null;
      const dek = appSession.getDek();
      if (!dek) return null;
      const db = await openDb();
      const session = await db.getFirstAsync<SessionRow>(
        'SELECT * FROM tblConversationSession WHERE sessionID = ?',
        [sessionID],
      );
      if (!session) return null;

      const events = await db.getAllAsync<AcousticEventRow>(
        'SELECT * FROM tblAcousticEvent WHERE sessionID = ? ORDER BY eventTime ASC',
        [sessionID],
      );

      return {
        ...session,
        title: reveal(session.title, dek) ?? 'Saved session',
        locationTag: reveal(session.locationTag, dek),
        events: events.map((event) => ({
          ...event,
          transcription: reveal(event.transcription, dek),
        })),
        eventCount: events.length,
      };
    }, null);
  },

  async remove(sessionID: number): Promise<boolean> {
    return guard(async () => {
      if (!can('delete')) return false;
      const userID = appSession.getUserId();
      if (userID == null) return false;
      const db = await openDb();
      const owned = await db.getFirstAsync<{ sessionID: number }>(
        'SELECT sessionID FROM tblConversationSession WHERE sessionID = ? AND userID = ?',
        [sessionID, userID],
      );
      if (!owned) return false;
      await db.runAsync('DELETE FROM tblAcousticEvent WHERE sessionID = ?', [sessionID]);
      await db.runAsync('DELETE FROM tblPerformanceLog WHERE sessionID = ?', [sessionID]);
      await db.runAsync('DELETE FROM tblConversationSession WHERE sessionID = ? AND userID = ?', [
        sessionID,
        userID,
      ]);
      return true;
    }, false);
  },

  async clearAll(): Promise<boolean> {
    return guard(async () => {
      if (!can('delete')) return false;
      const userID = appSession.getUserId();
      if (userID == null) return false;
      const db = await openDb();
      await db.runAsync(
        `DELETE FROM tblPerformanceLog
          WHERE sessionID IN (SELECT sessionID FROM tblConversationSession WHERE userID = ?)`,
        [userID],
      );
      await db.runAsync(
        `DELETE FROM tblAcousticEvent
          WHERE sessionID IN (SELECT sessionID FROM tblConversationSession WHERE userID = ?)`,
        [userID],
      );
      await db.runAsync('DELETE FROM tblConversationSession WHERE userID = ?', [userID]);
      return true;
    }, false);
  },

  /**
   * Encrypts transcripts saved before password setup. Plaintext is read only
   * inside this migration and is not returned to the UI.
   */
  async encryptLegacyPlaintext(): Promise<void> {
    const dek = appSession.getDek();
    const userID = appSession.getUserId();
    if (!dek || userID == null) throw new Error('encryption key unavailable');
    const db = await openDb();

    const sessions = await db.getAllAsync<{
      sessionID: number;
      title: string | null;
      locationTag: string | null;
    }>('SELECT sessionID, title, locationTag FROM tblConversationSession WHERE userID = ?', [
      userID,
    ]);
    for (const session of sessions) {
      const title =
        session.title && !isEncryptedField(session.title)
          ? sealTranscript(session.title, dek)
          : session.title;
      const locationTag =
        session.locationTag && !isEncryptedField(session.locationTag)
          ? sealTranscript(session.locationTag, dek)
          : session.locationTag;
      if (title !== session.title || locationTag !== session.locationTag) {
        await db.runAsync(
          'UPDATE tblConversationSession SET title = ?, locationTag = ? WHERE sessionID = ?',
          [title, locationTag, session.sessionID],
        );
      }
    }

    const events = await db.getAllAsync<{ eventID: number; transcription: string | null }>(
      `SELECT e.eventID, e.transcription
         FROM tblAcousticEvent e
         JOIN tblConversationSession s ON s.sessionID = e.sessionID
        WHERE s.userID = ?`,
      [userID],
    );
    for (const event of events) {
      if (!event.transcription || isEncryptedField(event.transcription)) continue;
      await db.runAsync('UPDATE tblAcousticEvent SET transcription = ? WHERE eventID = ?', [
        sealTranscript(event.transcription, dek),
        event.eventID,
      ]);
    }
  },
};
