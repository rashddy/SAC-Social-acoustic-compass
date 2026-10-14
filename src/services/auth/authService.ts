import { router } from 'expo-router';

import { auditRepo } from '../db/auditRepo';
import { sessionRepo } from '../db/sessionRepo';
import { sqliteAccountStore } from '../db/userRepo';
import { sqliteTranscriptStore } from '../db/transcriptStore';
import { clearProtectedMemory } from './clearProtectedMemory';
import { createAuthController, type AuthController } from './controller';
import { secureKeyStore } from './keyStore';
import { appSession } from './sessionVault';
import type { AuthResult } from './types';

async function refreshSettings(): Promise<void> {
  try {
    const { settingsService } = await import('../settingsService');
    await settingsService.hydrate();
  } catch {
    // A settings failure must not keep the phone stuck on the lock screen.
  }
}

const controller: AuthController = createAuthController({
  accounts: sqliteAccountStore,
  transcripts: sqliteTranscriptStore,
  keys: secureKeyStore,
  session: appSession,
  audit: (event) => {
    void auditRepo.append(event);
  },
});

let reauthWait: ((ok: boolean) => void) | null = null;

function finishReauth(ok: boolean) {
  const wait = reauthWait;
  reauthWait = null;
  wait?.(ok);
}

async function afterUnlock(result: AuthResult): Promise<AuthResult> {
  if (!result.ok) return result;
  try {
    await sessionRepo.encryptLegacyPlaintext();
  } catch {
    controller.logout();
    return {
      ok: false,
      message: 'Saved data could not be unlocked. Encryption is still on.',
    };
  }
  await refreshSettings();
  return result;
}

export const authService = {
  isUnlocked: () => controller.isUnlocked(),
  hasAccount: () => controller.hasAccount(),
  username: () => appSession.getUsername(),

  createAccount: async (username: string, password: string) =>
    afterUnlock(await controller.createAccount(username, password)),

  login: async (username: string, password: string) =>
    afterUnlock(await controller.login(username, password)),

  logout() {
    controller.logout();
    clearProtectedMemory();
    void refreshSettings();
  },

  unlockWithBiometric: async (username?: string) =>
    afterUnlock(
      await controller.unlockWithBiometric(
        (userID) => secureKeyStore.readBiometricDek(userID),
        username,
      ),
    ),

  confirmPassword: (password: string) => controller.confirmPassword(password),

  changePassword: (currentPassword: string, nextPassword: string) =>
    controller.changePassword(currentPassword, nextPassword),

  enableBiometrics: () =>
    controller.enableBiometrics((dek) => {
      const userID = appSession.getUserId();
      if (userID == null) return Promise.resolve(false);
      return secureKeyStore.saveBiometricDek(userID, dek);
    }),

  disableBiometrics: () =>
    controller.disableBiometrics(async () => {
      const userID = appSession.getUserId();
      if (userID == null) return;
      await secureKeyStore.clearBiometricDek(userID);
    }),

  eraseDevice: async (username: string) => {
    const result = await controller.eraseDevice(username, async (userID, lastAccount) => {
      await secureKeyStore.clearBiometricDek(userID);
      if (lastAccount) await secureKeyStore.clearDeviceKey();
    });
    clearProtectedMemory();
    return result;
  },

  deleteSavedSessions: () => controller.deleteTranscripts(),

  noteAppState: (state: 'background' | 'active') => {
    const outcome = controller.noteAppState(state);
    if (outcome === 'locked') clearProtectedMemory();
    return outcome;
  },

  touch: () => controller.touch(),

  expireIfIdle: () => {
    const expired = controller.expireIfIdle();
    if (expired) clearProtectedMemory();
    return expired;
  },

  async ensureRecentAuth(): Promise<boolean> {
    if (!controller.isUnlocked()) return false;
    if (appSession.recent(Date.now())) return true;
    if (reauthWait) return false;
    return new Promise<boolean>((resolve) => {
      reauthWait = resolve;
      router.push('/auth?mode=reauth');
    });
  },

  completeReauth(ok: boolean) {
    finishReauth(ok);
  },
};
