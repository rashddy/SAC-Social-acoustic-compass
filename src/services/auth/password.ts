import { argon2idAsync } from '@noble/hashes/argon2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { clean, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { equalBytes } from '@noble/ciphers/utils.js';

import { decodeBase64ToBytes, encodeBytesToBase64 } from '../../utils/base64';
import {
  MAX_PASSWORD_LENGTH,
  MAX_USERNAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  MIN_USERNAME_LENGTH,
  PRODUCTION_ARGON2,
  SALT_BYTES,
  type ArgonParams,
} from './config';

export type DerivedPassword = {
  /** SHA-256 of the Argon2id output. Safe to store. Not a decryption key. */
  verifier: Uint8Array;
  /** HKDF key used only to wrap the data-encryption key. Never stored. */
  kek: Uint8Array;
};

export type ParsedPasswordHash = {
  params: ArgonParams;
  salt: Uint8Array;
  verifier: Uint8Array;
};

const HASH_PREFIX = 'sac-argon2id';

/** Above this, pure-JS Argon2 freezes or crashes the phone. */
const PHONE_SAFE_M = 1024;
const PHONE_SAFE_T = 2;

export function passwordCheckIsSafe(encoded: string): boolean {
  const parsed = parsePasswordHash(encoded);
  if (!parsed) return true;
  return parsed.params.m <= PHONE_SAFE_M && parsed.params.t <= PHONE_SAFE_T;
}

export function validateUsername(username: string): string | null {
  const trimmed = username.trim();
  if (trimmed.length < MIN_USERNAME_LENGTH || trimmed.length > MAX_USERNAME_LENGTH) {
    return `Use a username between ${MIN_USERNAME_LENGTH} and ${MAX_USERNAME_LENGTH} characters.`;
  }
  if (!/^[\p{L}\p{N} ._-]+$/u.test(trimmed)) {
    return 'Usernames can use letters, numbers, spaces, and . _ -';
  }
  return null;
}

export function validateNewPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

export function normalizeUsername(username: string): string {
  return username.trim();
}

/** Case-folding comparison that does not return early on length. */
export function usernamesMatch(stored: string, typed: string): boolean {
  const left = sha256(utf8ToBytes(normalizeUsername(stored).toLocaleLowerCase()));
  const right = sha256(utf8ToBytes(normalizeUsername(typed).toLocaleLowerCase()));
  return equalBytes(left, right);
}

export async function derivePassword(
  password: string,
  salt: Uint8Array,
  params: ArgonParams = PRODUCTION_ARGON2,
): Promise<DerivedPassword> {
  const raw = await argon2idAsync(utf8ToBytes(password), salt, {
    m: params.m,
    t: params.t,
    p: params.p,
    dkLen: params.dkLen,
  });
  const verifier = sha256(raw);
  const kek = hkdf(sha256, raw, salt, utf8ToBytes('sac-kek-v1'), 32);
  clean(raw);
  return { verifier, kek };
}

export async function createPasswordRecord(
  password: string,
  params: ArgonParams = PRODUCTION_ARGON2,
): Promise<{ encoded: string; kek: Uint8Array }> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await derivePassword(password, salt, params);
  return { encoded: encodePasswordHash(params, salt, derived.verifier), kek: derived.kek };
}

export function encodePasswordHash(
  params: ArgonParams,
  salt: Uint8Array,
  verifier: Uint8Array,
): string {
  return [
    HASH_PREFIX,
    `m=${params.m},t=${params.t},p=${params.p}`,
    encodeBytesToBase64(salt),
    encodeBytesToBase64(verifier),
  ].join('$');
}

export function parsePasswordHash(encoded: string): ParsedPasswordHash | null {
  const parts = encoded.split('$');
  if (parts.length !== 4 || parts[0] !== HASH_PREFIX) return null;
  const match = /^m=(\d+),t=(\d+),p=(\d+)$/.exec(parts[1] ?? '');
  if (!match) return null;
  try {
    const salt = decodeBase64ToBytes(parts[2] ?? '');
    const verifier = decodeBase64ToBytes(parts[3] ?? '');
    if (salt.length < SALT_BYTES || verifier.length !== 32) return null;
    return {
      params: {
        m: Number(match[1]),
        t: Number(match[2]),
        p: Number(match[3]),
        dkLen: 32,
      },
      salt,
      verifier,
    };
  } catch {
    return null;
  }
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<{ ok: true; kek: Uint8Array; tooHeavy?: false } | { ok: false; kek: null; tooHeavy?: boolean }> {
  const parsed = parsePasswordHash(encoded);
  if (!parsed) return { ok: false, kek: null };
  if (!passwordCheckIsSafe(encoded)) return { ok: false, kek: null, tooHeavy: true };
  const derived = await derivePassword(password, parsed.salt, parsed.params);
  const ok = equalBytes(derived.verifier, parsed.verifier);
  if (!ok) {
    clean(derived.kek, derived.verifier);
    return { ok: false, kek: null };
  }
  clean(derived.verifier);
  return { ok: true, kek: derived.kek };
}
