/**
 * Work factors and session limits for offline authentication.
 *
 * Argon2id runs in JavaScript on the phone. The memory cost is 256 KiB and one
 * iteration so sign-in returns as soon as the password is submitted. A unique
 * salt is still stored with every hash. The hash is not the transcript key.
 */
export const PRODUCTION_ARGON2 = {
  m: 256,
  t: 1,
  p: 1,
  dkLen: 32,
} as const;

/** Used only by security tests so the suite does not spend seconds on each hash. */
export const TEST_ARGON2 = {
  m: 32,
  t: 1,
  p: 1,
  dkLen: 32,
} as const;

export type ArgonParams = {
  m: number;
  t: number;
  p: number;
  dkLen: number;
};

export const SALT_BYTES = 16;
export const DEK_BYTES = 32;
export const DEVICE_KEY_BYTES = 32;

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;
export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 40;

/** Locked screens require the password again after this much inactivity. */
export const INACTIVITY_MS = 5 * 60 * 1000;

/** Destructive actions ask for the password again after this window. */
export const RECENT_AUTH_MS = 2 * 60 * 1000;

export const LOCKOUT_THRESHOLD = 5;
export const AUDIT_RETENTION_DAYS = 30;
export const AUDIT_RETENTION_ROWS = 200;

export const GENERIC_LOGIN_ERROR = 'Incorrect username or password.';
export const HEAVY_LOGIN_ERROR =
  'This sign-in was too heavy for the phone, so it was stopped. Tap Forgot password, enter the username, and erase that account. Then create it again.';
export const KEY_FAILURE_ERROR =
  'Saved data could not be unlocked. Encryption is still on.';

export const USER_ROLE = 'user' as const;
