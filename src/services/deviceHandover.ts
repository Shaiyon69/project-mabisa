import { HOUSEHOLD_DRAFT_PREFIX, logDev } from '../lib/utils';
import { clearLocalRecords, countRows } from './localDatabase';
import { forgetDeviceSyncState } from './syncService';

/**
 * Whose records this phone is holding.
 *
 * Local SQLite and the sync queue are not keyed by account, and signing out
 * leaves both in place. The next health worker to sign in would read the previous
 * worker's purok, and the previous worker's queue would drain under her session —
 * the server stamps scope and actor from `auth.uid()`, so those households land
 * in her purok under her name.
 *
 * So ownership is recorded and checked at sign-in, not sign-out: the same account
 * returning must keep its unsent records. The id is not a credential, so plain
 * `localStorage` holds it.
 */
const DEVICE_OWNER_KEY = 'mabisa.device_owner';

/** Claimed, or refused with the number of records that must ship first. */
export type Handover = { claimed: true } | { claimed: false; unsent: number };

function readOwner(): string | null {
  try {
    return localStorage.getItem(DEVICE_OWNER_KEY);
  } catch {
    return null;
  }
}

function writeOwner(userId: string): void {
  try {
    localStorage.setItem(DEVICE_OWNER_KEY, userId);
  } catch {
    // Storage unavailable — the next sign-in reads no owner and claims the device again.
  }
}

/** Every account's saved household draft, which outlives the database wipe unless named. */
function draftKeys(): string[] {
  try {
    return Object.keys(localStorage).filter((key) => key.startsWith(HOUSEHOLD_DRAFT_PREFIX));
  } catch {
    // Storage unavailable — nothing to count and nothing to clear.
    return [];
  }
}

/** Belt and braces: no previous account's draft survives a handover, even if the count above misses a key. */
function clearHouseholdDrafts(): void {
  try {
    for (const key of draftKeys()) {
      localStorage.removeItem(key);
    }
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

/**
 * Hands this device to `userId`, or refuses.
 *
 * Same account, or a device nobody has claimed: nothing to do. A different
 * account with nothing waiting to send: the local records and sync markers are
 * emptied, since what is on the phone is the wrong purok. A different account
 * with records still waiting: refused, because those are the only copy of
 * somebody's visits. The dead letter counts as waiting.
 *
 * ponytail: no override on the refusal. A phone stuck behind a record that can
 * never send needs a person to look at the dead letter, which is what that
 * screen is for; add an escape hatch when the field produces one, not before.
 *
 * An unclaimed device already holding records predates the key, so the signed-in
 * session is the only evidence of whose they are, and it is treated as the owner.
 */
export async function claimDeviceFor(userId: string): Promise<Handover> {
  const owner = readOwner();

  if (owner === userId) {
    return { claimed: true };
  }

  if (owner !== null) {
    // A saved draft counts as waiting: it is an unfinished visit that has not
    // reached the queue, and `clearHouseholdDrafts` below deletes it.
    const unsent =
      (await countRows('sync_queue')) + (await countRows('sync_dead_letter')) + draftKeys().length;

    if (unsent > 0) {
      logDev('Device handover refused — records still waiting to send', { owner, userId, unsent });
      return { claimed: false, unsent };
    }

    await clearLocalRecords();
    forgetDeviceSyncState();
    clearHouseholdDrafts();
    logDev('Device handed over to a new account', { from: owner, to: userId });
  }

  writeOwner(userId);
  return { claimed: true };
}
