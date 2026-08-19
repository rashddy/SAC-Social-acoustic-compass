import * as Crypto from 'expo-crypto';

import { guard, openDb } from './client';
import type { UserRow } from './types';

const DEFAULT_USERNAME = 'Local User';

/**
 * The ERD stores `pinCode` on tblUser. A raw PIN would be readable by anyone
 * with the database file, so a per-user salted SHA-256 digest is stored in that
 * column instead, encoded as `salt:hash`.
 */
const hashPin = async (pin: string, salt: string): Promise<string> => {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${salt}:${pin}`,
  );
  return `${salt}:${digest}`;
};

const newSalt = (): string => Crypto.randomUUID().replace(/-/g, '');

export const userRepo = {
  /** Returns the single local user, creating a PIN-less placeholder if needed. */
  async current(): Promise<UserRow | null> {
    return guard(async () => {
      const db = await openDb();
      const existing = await db.getFirstAsync<UserRow>(
        'SELECT * FROM tblUser ORDER BY userID LIMIT 1',
      );
      if (existing) return existing;

      const inserted = await db.runAsync(
        'INSERT INTO tblUser (username, pinCode, createdAt) VALUES (?, ?, ?)',
        [DEFAULT_USERNAME, '', Date.now()],
      );
      return {
        userID: inserted.lastInsertRowId,
        username: DEFAULT_USERNAME,
        pinCode: '',
        createdAt: Date.now(),
      };
    }, null);
  },

  async currentUserId(): Promise<number | null> {
    const user = await userRepo.current();
    return user?.userID ?? null;
  },

  async hasPin(): Promise<boolean> {
    const user = await userRepo.current();
    return Boolean(user?.pinCode);
  },

  async setPin(pin: string, username?: string): Promise<boolean> {
    return guard(async () => {
      const db = await openDb();
      const user = await userRepo.current();
      if (!user) return false;

      const stored = await hashPin(pin, newSalt());
      await db.runAsync('UPDATE tblUser SET pinCode = ?, username = ? WHERE userID = ?', [
        stored,
        username?.trim() || user.username,
        user.userID,
      ]);
      return true;
    }, false);
  },

  async verifyPin(pin: string): Promise<boolean> {
    return guard(async () => {
      const user = await userRepo.current();
      if (!user?.pinCode) return false;

      const [salt] = user.pinCode.split(':');
      if (!salt) return false;

      return (await hashPin(pin, salt)) === user.pinCode;
    }, false);
  },

  async clearPin(): Promise<boolean> {
    return guard(async () => {
      const db = await openDb();
      const user = await userRepo.current();
      if (!user) return false;
      await db.runAsync('UPDATE tblUser SET pinCode = ? WHERE userID = ?', ['', user.userID]);
      return true;
    }, false);
  },
};
