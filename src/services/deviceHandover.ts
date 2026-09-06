import { supabase } from '../lib/supabase';
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
 * returning must keep its unsent records. Neither id is a credential, so plain
 * `localStorage` holds them, as `userId` or `userId:purokId`.
 *
 * The purok is half of the key because one worker moved between puroks leaves the
 * same wrong records on the phone as two workers sharing it.
 */
const DEVICE_OWNER_KEY = 'mabisa.device_owner';

/** Claimed, or refused with the number of records that must ship first and who is in the way. */
export type Handover =
  | { claimed: true }
  | { claimed: false; unsent: number; heldBy: 'worker' | 'purok' };

function readOwner(): { userId: string; purokId: string | null } | null {
  let stored: string | null;

  try {
    stored = localStorage.getItem(DEVICE_OWNER_KEY);
  } catch {
    return null;
  }

  if (!stored) {
    return null;
  }

  const [userId, purokId] = stored.split(':');
  return { userId, purokId: purokId ?? null };
}

function writeOwner(userId: string, purokId: string | null): void {
  try {
    localStorage.setItem(DEVICE_OWNER_KEY, purokId ? `${userId}:${purokId}` : userId);
  } catch {
    // Storage unavailable — the next sign-in reads no owner and claims the device again.
  }
}

/** The purok the server would file this worker's records under, or null when it cannot be reached. */
async function readCurrentPurokId(): Promise<string | null> {
  const { data, error } = await supabase.rpc('current_bhw_purok_id');

  if (error) {
    logDev('Purok read failed during the device claim', error.message);
    return null;
  }

  return data ?? null;
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
 * Hands this device to `userId` on their current purok, or refuses.
 *
 * Same worker on the same purok, or a device nobody has claimed: nothing to do. A
 * different worker, or the same worker moved to another purok, with nothing
 * waiting to send: the local records and sync markers are emptied, since what is
 * on the phone is the wrong purok. Anything still waiting: refused, because those
 * are the only copy of somebody's visits, and a household insert that drains after
 * a move is stamped with the new purok rather than the one it was recorded in. The
 * dead letter counts as waiting.
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
  const purokId = await readCurrentPurokId();

  // A null purok on either side is one that could not be read — offline, or a key
  // written before the purok was part of it — so only the account can be matched on.
  const sameWorker = owner?.userId === userId;
  const movedPurok = sameWorker && owner.purokId !== null && purokId !== null && owner.purokId !== purokId;

  if (sameWorker && !movedPurok) {
    // Records the purok the first time it reads, so a later move is seen.
    if (purokId !== null && owner.purokId === null) {
      writeOwner(userId, purokId);
    }

    return { claimed: true };
  }

  if (owner !== null) {
    // A saved draft counts as waiting: it is an unfinished visit that has not
    // reached the queue, and `clearHouseholdDrafts` below deletes it.
    const unsent =
      (await countRows('sync_queue')) + (await countRows('sync_dead_letter')) + draftKeys().length;

    if (unsent > 0) {
      logDev('Device claim refused — records still waiting to send', { owner, userId, purokId, unsent });
      return { claimed: false, unsent, heldBy: movedPurok ? 'purok' : 'worker' };
    }

    await clearLocalRecords();
    forgetDeviceSyncState();
    clearHouseholdDrafts();
    logDev('Device records cleared', { from: owner, to: userId, purokId });
  }

  writeOwner(userId, purokId);
  return { claimed: true };
}
