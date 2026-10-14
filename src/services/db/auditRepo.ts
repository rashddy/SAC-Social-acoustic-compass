import { AUDIT_RETENTION_DAYS, AUDIT_RETENTION_ROWS } from '../auth/config';
import { guard, openDb } from './client';

export type AuditEvent = {
  auditID: number;
  eventType: string;
  createdAt: number;
};

const ALLOWED = new Set([
  'ACCOUNT_CREATED',
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'LOCKOUT',
  'LOGOUT',
  'SESSION_EXPIRED',
  'BACKGROUND_LOCK',
  'DATA_DELETED',
  'SESSION_DELETED',
  'BIOMETRIC_ENABLED',
  'BIOMETRIC_DISABLED',
  'BIOMETRIC_FAILED',
  'BIOMETRIC_SUCCESS',
  'PASSWORD_CHANGED',
  'KEY_FAILURE',
  'ACCOUNT_ERASED',
]);

export const auditRepo = {
  async append(eventType: string): Promise<void> {
    if (!ALLOWED.has(eventType)) return;
    await guard(async () => {
      const db = await openDb();
      const now = Date.now();
      await db.runAsync('INSERT INTO tblSecurityAudit (eventType, createdAt) VALUES (?, ?)', [
        eventType,
        now,
      ]);
      const cutoff = now - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      await db.runAsync('DELETE FROM tblSecurityAudit WHERE createdAt < ?', [cutoff]);
      await db.runAsync(
        `DELETE FROM tblSecurityAudit
          WHERE auditID NOT IN (
            SELECT auditID FROM tblSecurityAudit ORDER BY auditID DESC LIMIT ?
          )`,
        [AUDIT_RETENTION_ROWS],
      );
    }, undefined);
  },

  async recent(limit = 8): Promise<AuditEvent[]> {
    return guard(async () => {
      const db = await openDb();
      return db.getAllAsync<AuditEvent>(
        `SELECT auditID, eventType, createdAt
           FROM tblSecurityAudit
          ORDER BY auditID DESC
          LIMIT ?`,
        [limit],
      );
    }, []);
  },
};
