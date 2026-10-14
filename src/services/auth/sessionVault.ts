import { clean } from '@noble/hashes/utils.js';

import { INACTIVITY_MS, RECENT_AUTH_MS, USER_ROLE } from './config';

export type SessionVault = {
  isUnlocked(): boolean;
  getDek(): Uint8Array | null;
  getUserId(): number | null;
  getUsername(): string | null;
  getRole(): typeof USER_ROLE;
  unlock(input: { userId: number; username: string; dek: Uint8Array; now: number }): void;
  lock(): void;
  touch(now: number): void;
  markAuthenticated(now: number): void;
  noteBackground(now: number): void;
  /** Returns true when foregrounding after the inactivity window locked the session. */
  noteForeground(now: number, inactivityMs?: number): boolean;
  expired(now: number, inactivityMs?: number): boolean;
  recent(now: number, recentMs?: number): boolean;
};

export function createSessionVault(): SessionVault {
  let unlocked = false;
  let userId: number | null = null;
  let username: string | null = null;
  let dek: Uint8Array | null = null;
  let lastActivityAt = 0;
  let lastAuthenticatedAt = 0;
  let backgroundedAt: number | null = null;

  const wipe = () => {
    if (dek) clean(dek);
    dek = null;
    unlocked = false;
    userId = null;
    username = null;
    lastActivityAt = 0;
    lastAuthenticatedAt = 0;
    backgroundedAt = null;
  };

  return {
    isUnlocked: () => unlocked && dek != null,
    getDek: () => (unlocked ? dek : null),
    getUserId: () => (unlocked ? userId : null),
    getUsername: () => (unlocked ? username : null),
    getRole: () => USER_ROLE,
    unlock: ({ userId: nextId, username: nextName, dek: nextDek, now }) => {
      if (dek && dek !== nextDek) clean(dek);
      dek = nextDek;
      userId = nextId;
      username = nextName;
      unlocked = true;
      lastActivityAt = now;
      lastAuthenticatedAt = now;
      backgroundedAt = null;
    },
    lock: () => {
      wipe();
    },
    touch: (now) => {
      if (!unlocked) return;
      lastActivityAt = now;
    },
    markAuthenticated: (now) => {
      if (!unlocked) return;
      lastAuthenticatedAt = now;
      lastActivityAt = now;
    },
    noteBackground: (now) => {
      if (!unlocked) return;
      backgroundedAt = now;
    },
    noteForeground: (now, inactivityMs = INACTIVITY_MS) => {
      if (!unlocked) return false;
      const away = backgroundedAt;
      backgroundedAt = null;
      if (away != null && now - away >= inactivityMs) {
        wipe();
        return true;
      }
      if (now - lastActivityAt >= inactivityMs) {
        wipe();
        return true;
      }
      return false;
    },
    expired: (now, inactivityMs = INACTIVITY_MS) => {
      if (!unlocked) return false;
      return now - lastActivityAt >= inactivityMs;
    },
    recent: (now, recentMs = RECENT_AUTH_MS) => {
      if (!unlocked) return false;
      return now - lastAuthenticatedAt <= recentMs;
    },
  };
}

/** Process-wide session. A cold start constructs this locked; nothing is read from disk. */
export const appSession = createSessionVault();

export function isSensitiveCaptureAllowed(): boolean {
  return appSession.isUnlocked();
}
