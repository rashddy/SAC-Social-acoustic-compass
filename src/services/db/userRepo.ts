import { appSession } from '../auth/sessionVault';
import type { AccountDraft, AccountRecord, AccountStore } from '../auth/types';
import { usernamesMatch } from '../auth/password';
import { guard, openDb } from './client';
import type { UserRow } from './types';

const ACCOUNT_SQL = `SELECT userID, username, passwordHash, wrappedDek, failedAttempts,
            lockedUntil, biometricEnabled, biometricCheck, role
       FROM tblUser
      ORDER BY userID`;

const toAccount = (row: UserRow): AccountRecord => ({
  userID: row.userID,
  username: row.username,
  passwordHash: row.passwordHash ?? '',
  wrappedDek: row.wrappedDek ?? '',
  failedAttempts: row.failedAttempts ?? 0,
  lockedUntil: row.lockedUntil ?? 0,
  biometricEnabled: row.biometricEnabled === 1,
  biometricCheck: row.biometricCheck ?? '',
  role: 'user',
});

async function listAccountRows(): Promise<AccountRecord[]> {
  const db = await openDb();
  const rows = await db.getAllAsync<UserRow>(ACCOUNT_SQL);
  return rows.map(toAccount);
}

export const userRepo = {
  /** The signed-in account. A locked phone does not fall back to another person. */
  async current(): Promise<UserRow | null> {
    const userID = appSession.getUserId();
    if (userID == null) return null;
    return guard(async () => {
      const db = await openDb();
      return (
        (await db.getFirstAsync<UserRow>('SELECT * FROM tblUser WHERE userID = ?', [userID])) ??
        null
      );
    }, null);
  },

  async currentUserId(): Promise<number | null> {
    return appSession.getUserId();
  },

  async findAccount(): Promise<AccountRecord | null> {
    return sqliteAccountStore.findAccount();
  },

  async findSignedIn(): Promise<AccountRecord | null> {
    const userID = appSession.getUserId();
    if (userID == null) return null;
    return sqliteAccountStore.findById(userID);
  },
};

export const sqliteAccountStore: AccountStore = {
  async findAccount() {
    return guard(async () => {
      const rows = await listAccountRows();
      return rows.find((row) => row.passwordHash) ?? rows[0] ?? null;
    }, null);
  },

  async findByUsername(username: string) {
    return guard(async () => {
      const rows = await listAccountRows();
      return rows.find((row) => usernamesMatch(row.username, username)) ?? null;
    }, null);
  },

  async findById(userID: number) {
    return guard(async () => {
      const rows = await listAccountRows();
      return rows.find((row) => row.userID === userID) ?? null;
    }, null);
  },

  async findPasswordless() {
    return guard(async () => {
      const rows = await listAccountRows();
      return rows.find((row) => !row.passwordHash) ?? null;
    }, null);
  },

  async insertAccount(draft: AccountDraft): Promise<AccountRecord> {
    const db = await openDb();
    const inserted = await db.runAsync(
      `INSERT INTO tblUser
         (username, pinCode, createdAt, passwordHash, wrappedDek, failedAttempts,
          lockedUntil, biometricEnabled, biometricCheck, role)
       VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, 'user')`,
      [
        draft.username,
        Date.now(),
        draft.passwordHash,
        draft.wrappedDek,
        draft.failedAttempts,
        draft.lockedUntil,
        draft.biometricEnabled ? 1 : 0,
        draft.biometricCheck,
      ],
    );
    return { ...draft, userID: inserted.lastInsertRowId, role: 'user' };
  },

  async updateAccount(userID: number, patch: Partial<AccountDraft>): Promise<void> {
    const db = await openDb();
    const current = await db.getFirstAsync<UserRow>(
      'SELECT * FROM tblUser WHERE userID = ?',
      [userID],
    );
    if (!current) return;
    const next = {
      username: patch.username ?? current.username,
      passwordHash: patch.passwordHash ?? current.passwordHash,
      wrappedDek: patch.wrappedDek ?? current.wrappedDek,
      failedAttempts: patch.failedAttempts ?? current.failedAttempts,
      lockedUntil: patch.lockedUntil ?? current.lockedUntil,
      biometricEnabled:
        patch.biometricEnabled == null ? current.biometricEnabled : patch.biometricEnabled ? 1 : 0,
      biometricCheck: patch.biometricCheck ?? current.biometricCheck,
    };
    await db.runAsync(
      `UPDATE tblUser
          SET username = ?, pinCode = '', passwordHash = ?, wrappedDek = ?,
              failedAttempts = ?, lockedUntil = ?, biometricEnabled = ?,
              biometricCheck = ?, role = 'user'
        WHERE userID = ?`,
      [
        next.username,
        next.passwordHash,
        next.wrappedDek,
        next.failedAttempts,
        next.lockedUntil,
        next.biometricEnabled,
        next.biometricCheck,
        userID,
      ],
    );
  },

  async eraseAccount(userID: number): Promise<void> {
    const db = await openDb();
    await db.runAsync(
      `DELETE FROM tblPerformanceLog
        WHERE sessionID IN (
          SELECT sessionID FROM tblConversationSession WHERE userID = ?
        )`,
      [userID],
    );
    await db.runAsync(
      `DELETE FROM tblAcousticEvent
        WHERE sessionID IN (
          SELECT sessionID FROM tblConversationSession WHERE userID = ?
        )`,
      [userID],
    );
    await db.runAsync('DELETE FROM tblConversationSession WHERE userID = ?', [userID]);
    await db.runAsync('DELETE FROM tblDeviceSettings WHERE userID = ?', [userID]);
    await db.runAsync('DELETE FROM tblDevice WHERE userID = ?', [userID]);
    await db.runAsync('DELETE FROM tblUser WHERE userID = ?', [userID]);
  },
};
