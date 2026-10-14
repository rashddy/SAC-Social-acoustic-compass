import { LOCKOUT_THRESHOLD } from './config';

export type FailureUpdate = {
  failedAttempts: number;
  lockedUntil: number;
  lockout: boolean;
};

/**
 * Persistent failure schedule. The caller stores `lockedUntil`, so killing the
 * app does not skip the wait.
 *
 * Attempts 1–4 impose a short delay. Attempt 5 and later impose a lockout that
 * starts at 30 seconds and doubles, capped at 15 minutes.
 */
export function nextFailure(previousAttempts: number, now: number): FailureUpdate {
  const failedAttempts = Math.max(0, previousAttempts) + 1;
  if (failedAttempts >= LOCKOUT_THRESHOLD) {
    const extra = failedAttempts - LOCKOUT_THRESHOLD;
    const duration = Math.min(15 * 60 * 1000, 30_000 * 2 ** Math.min(extra, 5));
    return { failedAttempts, lockedUntil: now + duration, lockout: true };
  }
  const delay = Math.min(8_000, 500 * 2 ** (failedAttempts - 1));
  return { failedAttempts, lockedUntil: now + delay, lockout: false };
}

export function lockoutMessage(retryAt: number, now: number): string {
  const seconds = Math.max(1, Math.ceil((retryAt - now) / 1000));
  return `Too many attempts. Try again in ${seconds} seconds.`;
}

export function isLockedOut(lockedUntil: number, now: number): boolean {
  return lockedUntil > now;
}
