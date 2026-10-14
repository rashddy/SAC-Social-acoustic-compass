import { getRandomBytes } from 'expo-crypto';

const MAX_CHUNK = 1024;

function fillRandom(array: Uint8Array): Uint8Array {
  let offset = 0;
  while (offset < array.length) {
    const size = Math.min(MAX_CHUNK, array.length - offset);
    array.set(getRandomBytes(size), offset);
    offset += size;
  }
  return array;
}

/**
 * Hermes does not provide `crypto.getRandomValues`. Password salts and AES
 * nonces need it, and `expo-crypto` is already linked in this app.
 */
export function installRandomValues(): void {
  const host = globalThis as { crypto?: { getRandomValues?: (bytes: Uint8Array) => Uint8Array } };
  if (typeof host.crypto?.getRandomValues === 'function') return;

  const cryptoObject = {
    getRandomValues(array: Uint8Array): Uint8Array {
      return fillRandom(array);
    },
  };

  try {
    host.crypto = cryptoObject;
  } catch {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: cryptoObject,
    });
  }
}

installRandomValues();
