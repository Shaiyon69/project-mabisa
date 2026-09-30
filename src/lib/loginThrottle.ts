/**
 * Slows repeated wrong passwords from one device.
 *
 * This is the device's half of the limit only. Anyone scripting the API skips it,
 * so the real ones are server-side: Supabase Auth's per-IP rate limit and the
 * captcha it checks on every sign-in. What this adds is a lock a person at the
 * screen can see, counting down, rather than a sudden "too many requests".
 *
 * Counted per email address, so one mistyped account does not lock another
 * worker out of a shared phone.
 */

const STORAGE_KEY = 'mabisa.login_throttle';

/** Wrong passwords allowed before the first lock. */
export const FREE_ATTEMPTS = 5;
const FIRST_LOCK_MS = 30_000;
const MAX_LOCK_MS = 15 * 60_000;
/** A count this long without a new failure starts over, so last week's typos do not shorten today's allowance. */
const FORGET_AFTER_MS = 24 * 60 * 60_000;

export type ThrottleEntry = {
  failures: number;
  /** Epoch milliseconds, or 0 when not locked. */
  lockedUntil: number;
  /** Epoch milliseconds of the latest wrong password. */
  lastFailureAt: number;
};

export type ThrottleState = Record<string, ThrottleEntry>;

function keyFor(email: string): string {
  return email.trim().toLowerCase();
}

/** When the lock on `email` ends, in epoch milliseconds, or 0 if it was never locked. */
export function lockExpiry(state: ThrottleState, email: string): number {
  return state[keyFor(email)]?.lockedUntil ?? 0;
}

/** Milliseconds left on the lock for `email`, or 0 when it may try now. */
export function lockRemaining(state: ThrottleState, email: string, now: number): number {
  return Math.max(0, lockExpiry(state, email) - now);
}

/**
 * One more wrong password. From the sixth on, each locks for twice as long as the
 * one before — 30 seconds, then 1, 2, 4, 8 minutes — up to 15.
 */
export function recordFailure(state: ThrottleState, email: string, now: number): ThrottleState {
  const key = keyFor(email);
  const previous = state[key];
  const stale = !previous || now - (previous.lastFailureAt ?? 0) > FORGET_AFTER_MS;
  const failures = (stale ? 0 : previous.failures) + 1;
  const overLimit = failures - FREE_ATTEMPTS;
  const lockedUntil = overLimit > 0 ? now + Math.min(FIRST_LOCK_MS * 2 ** (overLimit - 1), MAX_LOCK_MS) : 0;

  return { ...state, [key]: { failures, lockedUntil, lastFailureAt: now } };
}

/** A successful sign-in clears the count for that address. */
export function recordSuccess(state: ThrottleState, email: string): ThrottleState {
  const next = { ...state };

  delete next[keyFor(email)];

  return next;
}

// Plain localStorage: a count of mistakes is not a credential, and clearing it
// only gets the person back to the server-side limit.
export function readThrottle(): ThrottleState {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');

    return parsed && typeof parsed === 'object' ? (parsed as ThrottleState) : {};
  } catch {
    return {};
  }
}

export function writeThrottle(state: ThrottleState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable. The server-side limit still stands.
  }
}

/** "45 seconds" or "3 minutes", rounded up, since a lock that reads "0 minutes" has not ended. */
export function describeWait(ms: number): string {
  const seconds = Math.ceil(ms / 1000);

  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
  }

  const minutes = Math.ceil(seconds / 60);

  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
