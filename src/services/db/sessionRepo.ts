import type { AudioStateName, EmotionName } from '@/constants/bleConstants';

import { guard, openDb } from './client';
import type { AcousticEventRow, SessionRow, SessionWithEvents } from './types';
import { userRepo } from './userRepo';

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

export const sessionRepo = {
  /** Writes a finished conversation and all of its acoustic events atomically. */
  async save(input: SessionInput): Promise<number | null> {
    return guard(async () => {
      const db = await openDb();
      const userID = await userRepo.currentUserId();
      if (userID == null) return null;

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
            input.locationTag,
            input.totalSpeakers,
            input.title,
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
              event.transcription,
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
      const db = await openDb();
      return db.getAllAsync<SessionRow & { eventCount: number }>(
        `SELECT s.*, COUNT(e.eventID) AS eventCount
           FROM tblConversationSession s
           LEFT JOIN tblAcousticEvent e ON e.sessionID = s.sessionID
          GROUP BY s.sessionID
          ORDER BY s.startTime DESC`,
      );
    }, []);
  },

  /** Sessions that contain at least one event of the given acoustic state. */
  async listByAudioState(
    audioState: AudioStateName,
  ): Promise<(SessionRow & { eventCount: number })[]> {
    return guard(async () => {
      const db = await openDb();
      return db.getAllAsync<SessionRow & { eventCount: number }>(
        `SELECT s.*, COUNT(e.eventID) AS eventCount
           FROM tblConversationSession s
           JOIN tblAcousticEvent e ON e.sessionID = s.sessionID
          WHERE e.audioState = ?
          GROUP BY s.sessionID
          ORDER BY s.startTime DESC`,
        [audioState],
      );
    }, []);
  },

  async findById(sessionID: number): Promise<SessionWithEvents | null> {
    return guard(async () => {
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

      return { ...session, events, eventCount: events.length };
    }, null);
  },

  async remove(sessionID: number): Promise<void> {
    await guard(async () => {
      const db = await openDb();
      await db.runAsync('DELETE FROM tblAcousticEvent WHERE sessionID = ?', [sessionID]);
      await db.runAsync('DELETE FROM tblConversationSession WHERE sessionID = ?', [sessionID]);
    }, undefined);
  },

  async clearAll(): Promise<void> {
    await guard(async () => {
      const db = await openDb();
      await db.execAsync(`
        DELETE FROM tblAcousticEvent;
        DELETE FROM tblConversationSession;
        DELETE FROM tblPerformanceLog;
      `);
    }, undefined);
  },
};
