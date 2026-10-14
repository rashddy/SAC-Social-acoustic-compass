import { gcm } from '@noble/ciphers/aes.js';
import { bytesToUtf8, utf8ToBytes } from '@noble/ciphers/utils.js';
import { randomBytes } from '@noble/hashes/utils.js';

import { decodeBase64ToBytes, encodeBytesToBase64 } from '../../utils/base64';
import { DEK_BYTES } from './config';

const PREFIX = 'sac1:';
const NONCE_BYTES = 12;

export class FieldCryptoError extends Error {
  constructor(message = 'encryption key unavailable') {
    super(message);
    this.name = 'FieldCryptoError';
  }
}

export function isEncryptedField(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function assertKey(key: Uint8Array | null | undefined): Uint8Array {
  if (!key || key.length !== DEK_BYTES) {
    throw new FieldCryptoError('encryption key unavailable');
  }
  return key;
}

export function encryptBytes(plain: Uint8Array, key: Uint8Array, aad: string): string {
  const secret = assertKey(key);
  const nonce = randomBytes(NONCE_BYTES);
  const sealed = gcm(secret, nonce, utf8ToBytes(aad)).encrypt(plain);
  const packed = new Uint8Array(nonce.length + sealed.length);
  packed.set(nonce, 0);
  packed.set(sealed, nonce.length);
  return PREFIX + encodeBytesToBase64(packed);
}

export function decryptBytes(payload: string, key: Uint8Array, aad: string): Uint8Array {
  const secret = assertKey(key);
  if (!isEncryptedField(payload)) {
    throw new FieldCryptoError('plaintext storage refused');
  }
  let packed: Uint8Array;
  try {
    packed = decodeBase64ToBytes(payload.slice(PREFIX.length));
  } catch {
    throw new FieldCryptoError('ciphertext is unreadable');
  }
  if (packed.length < NONCE_BYTES + 16) {
    throw new FieldCryptoError('ciphertext is unreadable');
  }
  const nonce = packed.subarray(0, NONCE_BYTES);
  const sealed = packed.subarray(NONCE_BYTES);
  try {
    return gcm(secret, nonce, utf8ToBytes(aad)).decrypt(sealed);
  } catch {
    throw new FieldCryptoError('ciphertext is unreadable');
  }
}

export function encryptField(plain: string, key: Uint8Array): string {
  return encryptBytes(utf8ToBytes(plain), key, 'sac-field-v1');
}

export function decryptField(payload: string, key: Uint8Array): string {
  return bytesToUtf8(decryptBytes(payload, key, 'sac-field-v1'));
}

/** Password wrap used when this install has no hardware keystore module. */
const PASSWORD_WRAP = 'pw1:';

export function wrapSecret(
  secret: Uint8Array,
  kek: Uint8Array,
  deviceKey: Uint8Array | null,
): string {
  const inner = encryptBytes(secret, kek, 'sac-dek-inner-v1');
  if (!deviceKey) return PASSWORD_WRAP + inner;
  return encryptBytes(utf8ToBytes(inner), deviceKey, 'sac-dek-outer-v1');
}

export function unwrapSecret(
  payload: string,
  kek: Uint8Array,
  deviceKey: Uint8Array | null,
): Uint8Array {
  if (payload.startsWith(PASSWORD_WRAP)) {
    return decryptBytes(payload.slice(PASSWORD_WRAP.length), kek, 'sac-dek-inner-v1');
  }
  if (!deviceKey) throw new FieldCryptoError('encryption key unavailable');
  const inner = bytesToUtf8(decryptBytes(payload, deviceKey, 'sac-dek-outer-v1'));
  return decryptBytes(inner, kek, 'sac-dek-inner-v1');
}

/**
 * Encrypt a transcript for storage. Refuses to return plaintext when the key
 * is missing or the wrong length.
 */
export function sealTranscript(text: string, key: Uint8Array | null): string {
  return encryptField(text, assertKey(key));
}

/**
 * Decrypt a stored transcript. Plaintext rows are rejected so a missing key
 * cannot silently turn encryption off.
 */
export function openTranscript(payload: string, key: Uint8Array | null): string {
  return decryptField(payload, assertKey(key));
}
