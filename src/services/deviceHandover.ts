import { HOUSEHOLD_DRAFT_PREFIX, logDev } from '../lib/utils';
import { clearLocalRecords, countRows } from './localDatabase';
import { forgetDeviceSyncState } from './syncService';

/**
 * Whose records this phone is holding.
 *
 * A device carries one purok's residents in local SQLite, plus whatever has not
 * shipped yet in the sync queue, and neither is keyed by account — signing out
 * clears the session and the PIN and leaves all of it in place. Two things go
 * wrong when the next health worker signs in on the same phone:
 *
 *  - She reads the previous worker's purok. Names, birthdays, PhilHealth numbers.
 *  - Worse, the previous worker's queue drains under *her* session. The server
 *    stamps scope and actor from `auth.uid()` (`households_stamp_scope`,
 *    `households_stamp_actor`), so those households land in her purok with her
 *    name on them. The rows are wrong and nothing says so.
 *
 * So ownership is recorded, and checked at the moment that matters — a sign-in,
 * not a sign-out. Sign-out stays as it was, which is what keeps "sign in again"
 * on the sync card working: that is the same account returning, and its unsent
 * records must survive it.
 *
 * The id is not a credential (the same argument `mabisa.user_role` makes), so
 * plain `localStorage` is where it goes.
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

/** Every account's saved household draft. Plain local storage, so it outlives the database wipe unless it is named. */
function draftKeys(): string[] {
  try {
    return Object.keys(localStorage).filter((key) => key.startsWith(HOUSEHOLD_DRAFT_PREFIX));
  } catch {
    // Storage unavailable — nothing to count and nothing to clear.
    return [];
  }
}

/**
 * Belt and braces. A draft now blocks the handover outright, so by the time this
 * runs there should be none — it stays because the invariant it enforces (no
 * previous account's draft survives a handover) is the one that matters if the
 * count above ever misses a key.
 */
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
 * account with nothing waiting to send: the local records are emptied and the
 * sync markers with them, because what is on the phone is the wrong purok. A
 * different account with records still waiting: refused, because those are the
 * only copy of somebody's visits and this is not the account that can send them.
 *
 * The dead letter counts as waiting. A quarantined record has not reached the
 * server either, and wiping it would be the one way this app loses a household
 * for good.
 *
 * ponytail: no override on the refusal. A phone stuck behind a record that can
 * never send needs a person to look at the dead letter, which is what that
 * screen is for; add an escape hatch when the field produces one, not before.
 *
 * An unclaimed device that already holds records is the one case this cannot
 * answer: it predates the key, so there is no evidence of whose they are. The
 * signed-in session is the only evidence there is, and on an upgrade it belongs
 * to the owner — a handover needs a sign-out and a sign-in, and from this release
 * on that is exactly where the claim gets written.
 */
export async function claimDeviceFor(userId: string): Promise<Handover> {
  const owner = readOwner();

  if (owner === userId) {
    return { claimed: true };
  }

  if (owner !== null) {
    // A saved draft counts as waiting too. It is an unfinished visit that has not
    // reached the queue yet, `clearHouseholdDrafts` below deletes it, and it is
    // the only copy there is.
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
