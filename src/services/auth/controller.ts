import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, clean, hexToBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { equalBytes } from '@noble/ciphers/utils.js';

import { decideDatabaseAccess } from './authorization';
import {
  DEK_BYTES,
  GENERIC_LOGIN_ERROR,
  HEAVY_LOGIN_ERROR,
  INACTIVITY_MS,
  KEY_FAILURE_ERROR,
  LOCKOUT_THRESHOLD,
  PRODUCTION_ARGON2,
  USER_ROLE,
  type ArgonParams,
} from './config';
import { sealTranscript, openTranscript, unwrapSecret, wrapSecret } from './fieldCipher';
import { lockoutMessage, nextFailure } from './lockoutPolicy';
import {
  createPasswordRecord,
  normalizeUsername,
  parsePasswordHash,
  passwordCheckIsSafe,
  usernamesMatch,
  validateNewPassword,
  validateUsername,
  verifyPassword,
} from './password';
import { createSessionVault, type SessionVault } from './sessionVault';
import type { AccountStore, AuthResult, DeviceKeyStore, TranscriptStore } from './types';

const BIOMETRIC_INFO = utf8ToBytes('sac-biometric-v1');

export type AuthControllerDeps = {
  accounts: AccountStore;
  transcripts: TranscriptStore;
  keys: DeviceKeyStore;
  session?: SessionVault;
  clock?: () => number;
  argon?: ArgonParams;
  audit?: (event: string) => void;
};

export type AuthController = ReturnType<typeof createAuthController>;

function biometricTag(dek: Uint8Array): string {
  return bytesToHex(hmac(sha256, dek, BIOMETRIC_INFO));
}

function tagsMatch(stored: string, dek: Uint8Array): boolean {
  if (!stored) return false;
  try {
    return equalBytes(hexToBytes(stored), hexToBytes(biometricTag(dek)));
  } catch {
    return false;
  }
}

export function createAuthController(deps: AuthControllerDeps) {
  const session = deps.session ?? createSessionVault();
  const clock = deps.clock ?? (() => Date.now());
  const argon = deps.argon ?? PRODUCTION_ARGON2;
  const audit = (event: string) => {
    try {
      deps.audit?.(event);
    } catch {
      // Audit failures must not block authentication or hide a lockout.
    }
  };

  const failLogin = async (
    userID: number,
    attempts: number,
    now: number,
  ): Promise<AuthResult> => {
    const update = nextFailure(attempts, now);
    await deps.accounts.updateAccount(userID, {
      failedAttempts: update.failedAttempts,
      lockedUntil: update.lockedUntil,
    });
    audit(update.lockout ? 'LOCKOUT' : 'LOGIN_FAILED');
    if (update.lockout) {
      return {
        ok: false,
        locked: true,
        retryAt: update.lockedUntil,
        message: lockoutMessage(update.lockedUntil, now),
      };
    }
    return {
      ok: false,
      retryAt: update.lockedUntil,
      message: GENERIC_LOGIN_ERROR,
    };
  };

  const blocked = (
    account: { failedAttempts: number; lockedUntil: number },
    now: number,
  ): AuthResult | null => {
    if (account.lockedUntil <= now) return null;
    if (account.failedAttempts >= LOCKOUT_THRESHOLD) {
      return {
        ok: false,
        locked: true,
        retryAt: account.lockedUntil,
        message: lockoutMessage(account.lockedUntil, now),
      };
    }
    return {
      ok: false,
      retryAt: account.lockedUntil,
      message: GENERIC_LOGIN_ERROR,
    };
  };

  const unlockWithDek = (
    userID: number,
    username: string,
    dek: Uint8Array,
    now: number,
  ) => {
    session.unlock({ userId: userID, username, dek, now });
  };

  return {
    session,

    isUnlocked: () => session.isUnlocked(),

    async hasAccount(): Promise<boolean> {
      const account = await deps.accounts.findAccount();
      return Boolean(account?.passwordHash);
    },

    async createAccount(username: string, password: string): Promise<AuthResult> {
      const usernameError = validateUsername(username);
      if (usernameError) return { ok: false, message: usernameError };
      const passwordError = validateNewPassword(password);
      if (passwordError) return { ok: false, message: passwordError };

      const taken = await deps.accounts.findByUsername(username);
      if (taken?.passwordHash) {
        return { ok: false, message: 'That username is already on this phone.' };
      }
      const existing = taken ?? (await deps.accounts.findPasswordless());

      const created = await createPasswordRecord(password, argon);
      let dek: Uint8Array | null = null;
      try {
        const deviceKey = await deps.keys.getDeviceKey();
        dek = randomBytes(DEK_BYTES);
        const wrappedDek = wrapSecret(dek, created.kek, deviceKey);
        const now = clock();
        const record = existing
          ? existing
          : await deps.accounts.insertAccount({
              username: normalizeUsername(username),
              passwordHash: created.encoded,
              wrappedDek,
              failedAttempts: 0,
              lockedUntil: 0,
              biometricEnabled: false,
              biometricCheck: '',
              role: USER_ROLE,
            });
        if (existing) {
          await deps.accounts.updateAccount(existing.userID, {
            username: normalizeUsername(username),
            passwordHash: created.encoded,
            wrappedDek,
            failedAttempts: 0,
            lockedUntil: 0,
            biometricEnabled: false,
            biometricCheck: '',
            role: USER_ROLE,
          });
        }
        unlockWithDek(record.userID, normalizeUsername(username), dek, now);
        dek = null;
        audit('ACCOUNT_CREATED');
        return { ok: true };
      } catch {
        if (dek) clean(dek);
        session.lock();
        audit('KEY_FAILURE');
        return { ok: false, message: KEY_FAILURE_ERROR };
      } finally {
        clean(created.kek);
      }
    },

    async login(username: string, password: string): Promise<AuthResult> {
      const now = clock();
      const account = await deps.accounts.findByUsername(username);
      if (!account?.passwordHash) {
        const decoy = await deps.accounts.findAccount();
        if (decoy?.passwordHash && passwordCheckIsSafe(decoy.passwordHash)) {
          const wasted = await verifyPassword(password, decoy.passwordHash);
          if (wasted.kek) clean(wasted.kek);
        }
        audit('LOGIN_FAILED');
        return { ok: false, message: GENERIC_LOGIN_ERROR };
      }
      const waiting = blocked(account, now);
      if (waiting) return waiting;

      if (!passwordCheckIsSafe(account.passwordHash)) {
        audit('LOGIN_FAILED');
        return { ok: false, message: HEAVY_LOGIN_ERROR };
      }
      const verified = await verifyPassword(password, account.passwordHash);
      const nameOk = usernamesMatch(account.username, username);
      if (verified.tooHeavy) {
        audit('LOGIN_FAILED');
        return { ok: false, message: HEAVY_LOGIN_ERROR };
      }
      if (!verified.ok || !nameOk) {
        if (verified.kek) clean(verified.kek);
        return failLogin(account.userID, account.failedAttempts, now);
      }

      try {
        const deviceKey = await deps.keys.getDeviceKey();
        const dek = unwrapSecret(account.wrappedDek, verified.kek, deviceKey);
        if (dek.length !== DEK_BYTES) {
          clean(dek);
          throw new Error('encryption key unavailable');
        }
        let passwordHash = account.passwordHash;
        let wrappedDek = account.wrappedDek;
        const stored = parsePasswordHash(account.passwordHash);
        if (
          stored &&
          (stored.params.m !== argon.m || stored.params.t !== argon.t || stored.params.p !== argon.p)
        ) {
          const refreshed = await createPasswordRecord(password, argon);
          try {
            wrappedDek = wrapSecret(dek, refreshed.kek, deviceKey);
            passwordHash = refreshed.encoded;
          } finally {
            clean(refreshed.kek);
          }
        }
        await deps.accounts.updateAccount(account.userID, {
          failedAttempts: 0,
          lockedUntil: 0,
          passwordHash,
          wrappedDek,
        });
        unlockWithDek(account.userID, account.username, dek, now);
        audit('LOGIN_SUCCESS');
        return { ok: true };
      } catch {
        session.lock();
        audit('KEY_FAILURE');
        return { ok: false, message: KEY_FAILURE_ERROR };
      } finally {
        clean(verified.kek);
      }
    },

    logout() {
      session.lock();
      audit('LOGOUT');
    },

    /**
     * Biometric unlock restores a device-held data key. A canceled or failed
     * read returns null and does not open a session. The prompt itself is not
     * treated as account validation: the key must match the tag stored when
     * biometrics were enabled after a password login.
     */
    async unlockWithBiometric(
      readSecret: (userID: number) => Promise<Uint8Array | null>,
      username?: string,
    ): Promise<AuthResult> {
      const account = username?.trim()
        ? await deps.accounts.findByUsername(username)
        : await deps.accounts.findAccount();
      if (!account?.passwordHash || !account.biometricEnabled) {
        audit('BIOMETRIC_FAILED');
        return { ok: false, message: 'Biometric unlock is not available.' };
      }
      const now = clock();
      const waiting = blocked(account, now);
      if (waiting) return waiting;
      let secret: Uint8Array | null = null;
      try {
        secret = await readSecret(account.userID);
      } catch {
        secret = null;
      }
      if (!secret || secret.length !== DEK_BYTES || !tagsMatch(account.biometricCheck, secret)) {
        if (secret) clean(secret);
        audit('BIOMETRIC_FAILED');
        return { ok: false, message: 'Biometric unlock was canceled.' };
      }
      unlockWithDek(account.userID, account.username, secret, now);
      audit('BIOMETRIC_SUCCESS');
      return { ok: true };
    },

    async confirmPassword(password: string): Promise<AuthResult> {
      const now = clock();
      if (!session.isUnlocked()) {
        return { ok: false, message: GENERIC_LOGIN_ERROR };
      }
      const account = await deps.accounts.findById(session.getUserId() ?? -1);
      if (!account) return { ok: false, message: GENERIC_LOGIN_ERROR };
      const waiting = blocked(account, now);
      if (waiting) {
        if (waiting.locked) session.lock();
        return waiting;
      }
      if (!passwordCheckIsSafe(account.passwordHash)) {
        return { ok: false, message: HEAVY_LOGIN_ERROR };
      }
      const verified = await verifyPassword(password, account.passwordHash);
      if (verified.tooHeavy) return { ok: false, message: HEAVY_LOGIN_ERROR };
      if (!verified.ok) {
        const failure = await failLogin(account.userID, account.failedAttempts, now);
        if (failure.locked) session.lock();
        return failure;
      }
      clean(verified.kek);
      await deps.accounts.updateAccount(account.userID, {
        failedAttempts: 0,
        lockedUntil: 0,
      });
      session.markAuthenticated(now);
      return { ok: true };
    },

    async changePassword(currentPassword: string, nextPassword: string): Promise<AuthResult> {
      const passwordError = validateNewPassword(nextPassword);
      if (passwordError) return { ok: false, message: passwordError };
      if (!session.isUnlocked()) return { ok: false, message: GENERIC_LOGIN_ERROR };
      const dek = session.getDek();
      const userId = session.getUserId();
      if (!dek || userId == null) return { ok: false, message: KEY_FAILURE_ERROR };

      const account = await deps.accounts.findById(userId);
      if (!account || account.userID !== userId) {
        return { ok: false, message: GENERIC_LOGIN_ERROR };
      }
      if (!passwordCheckIsSafe(account.passwordHash)) {
        return { ok: false, message: HEAVY_LOGIN_ERROR };
      }
      const verified = await verifyPassword(currentPassword, account.passwordHash);
      if (verified.tooHeavy) return { ok: false, message: HEAVY_LOGIN_ERROR };
      if (!verified.ok) {
        return failLogin(account.userID, account.failedAttempts, clock());
      }
      const created = await createPasswordRecord(nextPassword, argon);
      try {
        const deviceKey = await deps.keys.getDeviceKey();
        const wrappedDek = wrapSecret(dek, created.kek, deviceKey);
        await deps.accounts.updateAccount(account.userID, {
          passwordHash: created.encoded,
          wrappedDek,
          failedAttempts: 0,
          lockedUntil: 0,
        });
        session.markAuthenticated(clock());
        audit('PASSWORD_CHANGED');
        return { ok: true };
      } catch {
        audit('KEY_FAILURE');
        return { ok: false, message: KEY_FAILURE_ERROR };
      } finally {
        clean(verified.kek, created.kek);
      }
    },

    async enableBiometrics(save: (dek: Uint8Array) => Promise<boolean>): Promise<AuthResult> {
      if (!session.isUnlocked() || !session.recent(clock())) {
        return { ok: false, message: 'Enter your password again to continue.' };
      }
      const dek = session.getDek();
      const userId = session.getUserId();
      if (!dek || userId == null) return { ok: false, message: KEY_FAILURE_ERROR };
      const saved = await save(dek);
      if (!saved) {
        audit('BIOMETRIC_FAILED');
        return { ok: false, message: 'Biometric unlock was canceled.' };
      }
      await deps.accounts.updateAccount(userId, {
        biometricEnabled: true,
        biometricCheck: biometricTag(dek),
      });
      audit('BIOMETRIC_ENABLED');
      return { ok: true };
    },

    async disableBiometrics(clear: () => Promise<void>): Promise<AuthResult> {
      if (!session.isUnlocked() || !session.recent(clock())) {
        return { ok: false, message: 'Enter your password again to continue.' };
      }
      const userId = session.getUserId();
      if (userId == null) return { ok: false, message: GENERIC_LOGIN_ERROR };
      await clear();
      await deps.accounts.updateAccount(userId, {
        biometricEnabled: false,
        biometricCheck: '',
      });
      audit('BIOMETRIC_DISABLED');
      return { ok: true };
    },

    async eraseDevice(
      username: string,
      clearKeys: (userID: number, lastAccount: boolean) => Promise<void>,
    ): Promise<AuthResult> {
      const account = await deps.accounts.findByUsername(username);
      if (!account?.passwordHash) {
        return { ok: false, message: 'No account with that username is on this phone.' };
      }
      session.lock();
      await deps.accounts.eraseAccount(account.userID);
      const lastAccount = !(await deps.accounts.findAccount())?.passwordHash;
      try {
        await clearKeys(account.userID, lastAccount);
      } catch {
        audit('KEY_FAILURE');
        return { ok: false, message: KEY_FAILURE_ERROR };
      }
      audit('ACCOUNT_ERASED');
      return { ok: true };
    },

    async saveTranscript(text: string): Promise<'ok' | 'unauthorized' | 'crypto'> {
      const decision = decideDatabaseAccess({
        unlocked: session.isUnlocked(),
        recentAuth: session.recent(clock()),
        operation: 'write',
        bleConnected: false,
      });
      if (decision !== 'allow') return 'unauthorized';
      try {
        const sealed = sealTranscript(text, session.getDek());
        await deps.transcripts.writeCiphertext(sealed);
        return 'ok';
      } catch {
        return 'crypto';
      }
    },

    async readTranscripts(): Promise<string[] | 'unauthorized' | 'crypto'> {
      const decision = decideDatabaseAccess({
        unlocked: session.isUnlocked(),
        recentAuth: true,
        operation: 'read',
        bleConnected: false,
      });
      if (decision !== 'allow') return 'unauthorized';
      try {
        const stored = await deps.transcripts.readStored();
        return stored.map((value) => openTranscript(value, session.getDek()));
      } catch {
        return 'crypto';
      }
    },

    async deleteTranscripts(): Promise<'ok' | 'unauthorized' | 'reauth'> {
      const decision = decideDatabaseAccess({
        unlocked: session.isUnlocked(),
        recentAuth: session.recent(clock()),
        operation: 'delete',
        bleConnected: true,
      });
      if (decision !== 'allow') return decision;
      await deps.transcripts.clear();
      audit('DATA_DELETED');
      return 'ok';
    },

    noteAppState(state: 'background' | 'active'): 'locked' | 'open' {
      const now = clock();
      if (state === 'background') {
        session.noteBackground(now);
        return session.isUnlocked() ? 'open' : 'locked';
      }
      const locked = session.noteForeground(now, INACTIVITY_MS);
      if (locked) audit('BACKGROUND_LOCK');
      return locked ? 'locked' : 'open';
    },

    touch() {
      session.touch(clock());
    },

    expireIfIdle(): boolean {
      const now = clock();
      if (!session.expired(now, INACTIVITY_MS)) return false;
      session.lock();
      audit('SESSION_EXPIRED');
      return true;
    },
  };
}
