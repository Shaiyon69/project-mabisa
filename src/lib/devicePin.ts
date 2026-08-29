import { secureStorage } from './secureStorage';

/**
 * The PIN that unlocks this device's copy of the app.
 *
 * Everything here runs offline: a BHW in a purok with no signal has to be able
 * to get into their own records, so nothing in the verify path talks to Supabase.
 *
 * What this protects, and what it does not: the local database is already
 * encrypted with a 32-byte device key held in the Android Keystore, so the PIN
 * is not what keeps a stolen phone's records unreadable — the Keystore is. The
 * PIN protects the signed-in session on a device that is out of its owner's
 * hands for a few minutes, which is the situation that actually happens in the
 * field. Both together, not either alone.
 */

export const PIN_LENGTH = 4;

/**
 * OWASP's current figure for PBKDF2-SHA256. A four-digit PIN is only 10,000
 * possibilities, so the cost of one guess is the entire defence against an
 * attacker who has the stored hash — a plain SHA-256 of it would fall instantly.
 */
const PBKDF2_ITERATIONS = 310_000;

const SALT_BYTES = 16;
const DERIVED_BITS = 256;

/** Keyed per account: two health workers sharing a device must not inherit each other's PIN. */
function pinKey(userId: string): string {
  return `mabisa.device_pin.${userId}`;
}

function attemptsKey(userId: string): string {
  return `mabisa.device_pin_attempts.${userId}`;
}

type StoredPin = {
  salt: string;
  hash: string;
  iterations: number;
};

type AttemptState = {
  failed: number;
  /** Epoch ms until which entry is refused, or null. Persisted, so force-quitting the app does not clear the wait. */
  lockedUntil: number | null;
};

const noAttempts: AttemptState = { failed: 0, lockedUntil: null };

/** Wrong tries allowed before the wait starts — a mistyped digit should not cost a delay. */
const FREE_ATTEMPTS = 4;
const FIRST_DELAY_MS = 30_000;
const MAX_DELAY_MS = 15 * 60_000;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(value: string): Uint8Array {
  return new Uint8Array((value.match(/../g) ?? []).map((pair) => parseInt(pair, 16)));
}

/** Compares without an early return, so the time taken says nothing about how much of the hash matched. */
function equalInConstantTime(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let difference = 0;

  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return difference === 0;
}

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);

  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    material,
    DERIVED_BITS,
  );

  return toHex(new Uint8Array(bits));
}

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const stored = await secureStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Why a PIN is not acceptable, or null when it is. Four digits is 10,000
 * possibilities before this; the handful ruled out here are the ones a person
 * guessing by hand would actually try first.
 */
export function describeWeakPin(pin: string): string | null {
  if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)) {
    return `Enter ${PIN_LENGTH} digits.`;
  }

  if (new Set(pin).size === 1) {
    return 'Pick a PIN that is not the same digit four times.';
  }

  const digits = [...pin].map(Number);
  const ascending = digits.every((digit, index) => index === 0 || digit === digits[index - 1] + 1);
  const descending = digits.every((digit, index) => index === 0 || digit === digits[index - 1] - 1);

  if (ascending || descending) {
    return 'Pick a PIN that is not four digits in a row.';
  }

  return null;
}

export async function isPinSet(userId: string): Promise<boolean> {
  return (await readJson<StoredPin>(pinKey(userId))) !== null;
}

/** Stores the PIN as a salted hash. The PIN itself is never written anywhere. */
export async function setPin(userId: string, pin: string): Promise<void> {
  const weakness = describeWeakPin(pin);

  if (weakness) {
    throw new Error(weakness);
  }

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(pin, salt, PBKDF2_ITERATIONS);

  await secureStorage.setItem(
    pinKey(userId),
    JSON.stringify({ salt: toHex(salt), hash, iterations: PBKDF2_ITERATIONS } satisfies StoredPin),
  );
  await secureStorage.removeItem(attemptsKey(userId));
}

/**
 * Removes the PIN and its attempt count. Called on sign-out: the next person to
 * sign in on this device sets their own, and a forgotten PIN is recoverable by
 * signing in again — which needs the account password, and a connection.
 */
export async function clearPin(userId: string): Promise<void> {
  await secureStorage.removeItem(pinKey(userId));
  await secureStorage.removeItem(attemptsKey(userId));
}

export type PinAttempt =
  | { ok: true }
  | { ok: false; reason: 'no-pin' }
  | { ok: false; reason: 'wrong'; waitMs: number }
  | { ok: false; reason: 'waiting'; waitMs: number };

/**
 * The delay after `failed` wrong entries: nothing for the first few, then 30s
 * doubling to a quarter of an hour. It never becomes a permanent lockout and
 * never wipes anything — this device may be holding the only copy of a day's
 * work, and locking a health worker out of unsent records is a worse outcome
 * than the one this is defending against.
 */
export function delayAfter(failed: number): number {
  if (failed <= FREE_ATTEMPTS) {
    return 0;
  }

  return Math.min(FIRST_DELAY_MS * 2 ** (failed - FREE_ATTEMPTS - 1), MAX_DELAY_MS);
}

export async function verifyPin(userId: string, pin: string, now: number = Date.now()): Promise<PinAttempt> {
  const stored = await readJson<StoredPin>(pinKey(userId));

  if (!stored) {
    return { ok: false, reason: 'no-pin' };
  }

  const attempts = (await readJson<AttemptState>(attemptsKey(userId))) ?? noAttempts;

  if (attempts.lockedUntil && attempts.lockedUntil > now) {
    return { ok: false, reason: 'waiting', waitMs: attempts.lockedUntil - now };
  }

  const candidate = await derive(pin, fromHex(stored.salt), stored.iterations);

  if (equalInConstantTime(candidate, stored.hash)) {
    await secureStorage.removeItem(attemptsKey(userId));
    return { ok: true };
  }

  const failed = attempts.failed + 1;
  const waitMs = delayAfter(failed);

  await secureStorage.setItem(
    attemptsKey(userId),
    JSON.stringify({ failed, lockedUntil: waitMs ? now + waitMs : null } satisfies AttemptState),
  );

  return { ok: false, reason: 'wrong', waitMs };
}

/** How long a wait has left, in the words the lock screen uses. */
export function describeWait(waitMs: number): string {
  const seconds = Math.ceil(waitMs / 1000);

  if (seconds <= 90) {
    return `Wait ${seconds} second(s) before trying again.`;
  }

  return `Wait ${Math.ceil(seconds / 60)} minute(s) before trying again.`;
}
