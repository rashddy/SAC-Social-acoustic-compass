import { randomBytes } from '@noble/hashes/utils.js';

import { decodeBase64ToBytes, encodeBytesToBase64 } from '../../utils/base64';
import { DEVICE_KEY_BYTES } from './config';
import type { DeviceKeyStore } from './types';

const DEVICE_KEY = 'sac.device.kek';
const BIOMETRIC_DEK = 'sac.biometric.dek';

function biometricKey(userID: number): string {
  return `${BIOMETRIC_DEK}.${userID}`;
}

export class KeyStoreUnavailableError extends Error {
  constructor() {
    super('Secure key storage is unavailable. Encryption was not disabled.');
    this.name = 'KeyStoreUnavailableError';
  }
}

async function loadSecureStore() {
  try {
    return await import('expo-secure-store');
  } catch {
    return null;
  }
}

export const secureKeyStore: DeviceKeyStore & {
  saveBiometricDek(userID: number, dek: Uint8Array): Promise<boolean>;
  readBiometricDek(userID: number): Promise<Uint8Array | null>;
  clearBiometricDek(userID: number): Promise<void>;
  clearDeviceKey(): Promise<void>;
  clearAll(): Promise<void>;
} = {
  async getDeviceKey(): Promise<Uint8Array | null> {
    const SecureStore = await loadSecureStore();
    if (!SecureStore) return null;
    let available = false;
    try {
      available = await SecureStore.isAvailableAsync();
    } catch {
      return null;
    }
    if (!available) return null;
    const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
    try {
      const existing = await SecureStore.getItemAsync(DEVICE_KEY, options);
      if (existing) {
        const bytes = decodeBase64ToBytes(existing);
        if (bytes.length !== DEVICE_KEY_BYTES) throw new KeyStoreUnavailableError();
        return bytes;
      }
      const created = randomBytes(DEVICE_KEY_BYTES);
      await SecureStore.setItemAsync(DEVICE_KEY, encodeBytesToBase64(created), options);
      return created;
    } catch (error) {
      if (error instanceof KeyStoreUnavailableError) throw error;
      return null;
    }
  },

  async saveBiometricDek(userID: number, dek: Uint8Array): Promise<boolean> {
    try {
      const SecureStore = await loadSecureStore();
      if (!SecureStore || !(await SecureStore.isAvailableAsync())) return false;
      if (!SecureStore.canUseBiometricAuthentication()) return false;
      await SecureStore.setItemAsync(biometricKey(userID), encodeBytesToBase64(dek), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        requireAuthentication: true,
        authenticationPrompt: 'Confirm biometric unlock for Social Acoustic Compass',
      });
      return true;
    } catch {
      return false;
    }
  },

  async readBiometricDek(userID: number): Promise<Uint8Array | null> {
    try {
      const SecureStore = await loadSecureStore();
      if (!SecureStore) return null;
      const options = {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        requireAuthentication: true,
        authenticationPrompt: 'Unlock Social Acoustic Compass',
      };
      const value =
        (await SecureStore.getItemAsync(biometricKey(userID), options)) ??
        (await SecureStore.getItemAsync(BIOMETRIC_DEK, options));
      if (!value) return null;
      const bytes = decodeBase64ToBytes(value);
      return bytes.length === DEVICE_KEY_BYTES ? bytes : null;
    } catch {
      return null;
    }
  },

  async clearBiometricDek(userID: number): Promise<void> {
    try {
      const SecureStore = await loadSecureStore();
      if (!SecureStore) return;
      const options = {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        requireAuthentication: true,
        authenticationPrompt: 'Turn off biometric unlock',
      };
      await SecureStore.deleteItemAsync(biometricKey(userID), options);
    } catch {
      // The account flag is cleared separately, so a leftover key cannot unlock.
    }
  },

  async clearDeviceKey(): Promise<void> {
    const SecureStore = await loadSecureStore();
    if (!SecureStore) return;
    try {
      await SecureStore.deleteItemAsync(DEVICE_KEY, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      await SecureStore.deleteItemAsync(BIOMETRIC_DEK, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    } catch {
      // An older dev client has no keystore module. The account row is still erased.
    }
  },

  async clearAll(): Promise<void> {
    await this.clearDeviceKey();
  },
};
