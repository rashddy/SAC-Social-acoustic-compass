import { appSession } from '../auth/sessionVault';
import type { TranscriptStore } from '../auth/types';
import { openDb } from './client';

/**
 * Raw transcript column access for the auth controller.
 * Values written here are already ciphertext. This store does not encrypt again
 * and does not decide whether the caller is allowed to read them.
 */
export const sqliteTranscriptStore: TranscriptStore = {
  async writeCiphertext(value: string): Promise<void> {
    const db = await openDb();
    const now = Date.now();
    await db.withTransactionAsync(async () => {
      const userID = appSession.getUserId();
      if (userID == null) throw new Error('encryption key unavailable');
      const inserted = await db.runAsync(
        `INSERT INTO tblConversationSession
           (userID, startTime, endTime, locationTag, totalSpeakers, title, createdAt)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
        [userID, now, now, '', '', now],
      );
      await db.runAsync(
        `INSERT INTO tblAcousticEvent
           (sessionID, transcription, audioState, emotion, speakerDirection, doa,
            confidenceScore, speakerCount, eventTime)
         VALUES (?, ?, 'SINGLE', 'NEUTRAL', 'FRONT', 0, 0, 1, ?)`,
        [inserted.lastInsertRowId, value, now],
      );
    });
  },

  async readStored(): Promise<string[]> {
    const userID = appSession.getUserId();
    if (userID == null) return [];
    const db = await openDb();
    const rows = await db.getAllAsync<{ transcription: string | null }>(
      `SELECT e.transcription
         FROM tblAcousticEvent e
         JOIN tblConversationSession s ON s.sessionID = e.sessionID
        WHERE s.userID = ?
        ORDER BY e.eventID`,
      [userID],
    );
    return rows.map((row) => row.transcription ?? '');
  },

  async clear(): Promise<void> {
    const userID = appSession.getUserId();
    if (userID == null) return;
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
  },
};
