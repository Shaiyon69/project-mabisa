import { Network } from '@capacitor/network';
import type {
  HealthAssessment,
  Household,
  Individual,
  InventoryItem,
  SupplyDisbursement,
} from '../types/database';
import { logDev } from '../lib/utils';
import { supabase } from '../lib/supabase';
import {
  initializeLocalDatabase,
  markSyncQueueEntryFailed,
  moveSyncQueueEntryToDeadLetter,
  persistLocalDatabase,
  readDeadLetterEntries,
  readSyncQueue,
  removeSyncQueueEntry,
  type LocalTableName,
  type SyncQueueEntry,
  pullInventoryFromServer,
  pullHouseholdsFromServer,
  pullIndividualsFromServer
} from './localDatabase';

/**
 * `deferred` is a normal outcome, not a failure: entries are waiting out a retry
 * backoff, or held back behind one that is. Kept distinct from `failed` so a
 * 30-second wait does not raise the same alarm as a quarantined record.
 */
export type SyncStatus =
  | 'idle'
  | 'offline'
  | 'unauthenticated'
  | 'syncing'
  | 'synced'
  | 'deferred'
  | 'failed';

export type SyncResult = {
  status: SyncStatus;
  processed: number;
  /** Entries left on the queue for a later pass — waiting out a retry backoff, or held back behind one that is. */
  deferred: number;
  /** Entries moved to the dead-letter table during this pass. */
  deadLettered: number;
  failedQueueId: number | null;
  errorMessage: string | null;
};

/** Retries before an entry is quarantined instead of retried forever. */
const MAX_SYNC_ATTEMPTS = 5;

/** First retry waits this long; each further failure doubles it. */
const RETRY_BASE_DELAY_MS = 30_000;

/** Upper bound on the backoff, so a long-failing entry still retries a few times a day. */
const RETRY_MAX_DELAY_MS = 15 * 60_000;

// -----------------------------------------------------------------------------
// Pass bookkeeping
// -----------------------------------------------------------------------------
// Two facts outlive a pass and have to survive the app being closed: when the
// queue last drained, which the BHW is shown, and how far the pull has read,
// which keeps the next pull from re-downloading every table over cellular.

const LAST_SYNC_AT_KEY = 'mabisa.last_sync_at';
const PULLED_THROUGH_KEY = 'mabisa.pulled_through';

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable. The pass still succeeded; the next pull just reads
    // the full tables again instead of the changed rows.
  }
}

/** When the queue last drained, ISO 8601, or null if it never has on this device. */
export function readLastSyncAt(): string | null {
  return readStored(LAST_SYNC_AT_KEY);
}

/**
 * Forgets how far the pull has read, so the next one re-reads every row.
 *
 * Called when quarantined entries are requeued: their server rows were skipped
 * by the pull that quarantined them, and the watermark has since moved past
 * those timestamps, so an incremental pull would never offer them again.
 */
export function resetPullWatermark(): void {
  try {
    localStorage.removeItem(PULLED_THROUGH_KEY);
  } catch {
    // Nothing to forget if storage is unavailable.
  }
}

/**
 * The central row changed after this device based its edit on it.
 *
 * Retrying cannot win that race — the server copy will still be newer next pass
 * — so a conflict skips the retry ladder and goes straight to the dead letter,
 * where `SyncStatusCard` shows it and an admin decides which version is right.
 */
export class SyncConflictError extends Error {
  constructor(table: LocalTableName) {
    super(`This ${table.replace(/_/g, ' ')} record was changed centrally after this device edited it.`);
    this.name = 'SyncConflictError';
  }
}

// -----------------------------------------------------------------------------
// Primary Key Mappings
// -----------------------------------------------------------------------------
// This maps every local table to its exact primary key column name.
// This is critical for the generic `updatePayload` function to know 
// which row it is actually targeting in Supabase.

type PrimaryKeyByTable = {
  households: 'household_id';
  individuals: 'resident_id';
  health_assessments: 'assessment_id';
  inventory_items: 'item_id';
  supply_disbursements: 'log_id';
};

const primaryKeys: PrimaryKeyByTable = {
  households: 'household_id',
  individuals: 'resident_id',
  health_assessments: 'assessment_id',
  inventory_items: 'item_id',
  supply_disbursements: 'log_id',
};

// -----------------------------------------------------------------------------
// Sync Engine State
// -----------------------------------------------------------------------------

// A concurrency lock to prevent the app from accidentally starting 
// two sync loops at the exact same time (e.g., if the user mashes a "Sync" button).
let syncInProgress = false;

export async function isNetworkConnected(): Promise<boolean> {
  const status = await Network.getStatus();
  return status.connected;
}

// -----------------------------------------------------------------------------
// Dependency Tracking
// -----------------------------------------------------------------------------
// The queue is ordered so parents reach Supabase before their children. Once an
// entry is held back, everything referencing it has to be held back too —
// otherwise we push rows whose foreign key does not exist remotely, which is
// either a second failure or a silent orphan.
//
//   households      <- individuals            (household_id)
//   individuals     <- health_assessments     (resident_id)
//   individuals     <- supply_disbursements   (resident_id)
//   inventory_items <- supply_disbursements   (item_id)

/** `table:primary_key` — identifies the record an entry writes or depends on. */
type EntityKey = string;

/**
 * Why a record is being held back. A transient failure defers its dependants to
 * the next pass; a quarantined record takes its dependants into quarantine with
 * it, so they stay together and can be requeued as one consistent set.
 */
type HoldReason = 'deferred' | 'quarantined';

function entityKey(table: LocalTableName, id: string): EntityKey {
  return `${table}:${id}`;
}

/** The record this entry writes, or null if the payload carries no usable primary key. */
export function ownEntityKey(entry: SyncQueueEntry): EntityKey | null {
  const payload = entry.payload as Record<string, unknown>;
  const value = payload[primaryKeys[entry.target_table]];
  return typeof value === 'string' ? entityKey(entry.target_table, value) : null;
}

/** The records this entry's foreign keys point at. */
export function parentEntityKeys(entry: SyncQueueEntry): EntityKey[] {
  const payload = entry.payload as Record<string, unknown>;

  const reference = (column: string, parentTable: LocalTableName): EntityKey[] => {
    const value = payload[column];
    return typeof value === 'string' ? [entityKey(parentTable, value)] : [];
  };

  switch (entry.target_table) {
    case 'households':
    case 'inventory_items':
      return [];
    case 'individuals':
      return reference('household_id', 'households');
    case 'health_assessments':
      return reference('resident_id', 'individuals');
    case 'supply_disbursements':
      return [...reference('resident_id', 'individuals'), ...reference('item_id', 'inventory_items')];
  }
}

/**
 * Exponential backoff from the attempt count already recorded against the entry.
 * 30s, 1m, 2m, 4m, then quarantine at MAX_SYNC_ATTEMPTS.
 */
export function nextAttemptTimestamp(attempts: number): string {
  const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1), RETRY_MAX_DELAY_MS);
  return new Date(Date.now() + delay).toISOString();
}

/**
 * The main background loop that reads the local SQLite queue and pushes 
 * pending operations to the Supabase PostgreSQL database.
 */
export async function syncPendingQueue(): Promise<SyncResult> {
  // 1. Claim the concurrency lock. This has to happen before the first await,
  // not after the checks below: every one of them yields, so a second trigger
  // landing in that window (a network flap alongside the mount pass, or the
  // manual button alongside either) would clear the same check and run a
  // parallel loop. Remote writes survive that — every push is an upsert — but
  // both passes increment `attempts` on the same entries, so they quarantine at
  // roughly half the intended retry budget.
  if (syncInProgress) {
    return idleResult('syncing');
  }

  syncInProgress = true;
  let processed = 0;
  let deferred = 0;
  let deadLettered = 0;
  let firstFailedQueueId: number | null = null;
  let firstErrorMessage: string | null = null;

  try {
    await initializeLocalDatabase();

    // 2. Hardware network check before attempting any API calls
    const connected = await isNetworkConnected();
    if (!connected) {
      return idleResult('offline');
    }

    // 3. Auth check. Row-level security denies every write from an anonymous
    // client, so pushing without a session burns retry attempts on failures that
    // are guaranteed. Defer instead — nothing is lost, the queue is durable.
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      return {
        ...idleResult('unauthenticated'),
        errorMessage: 'Not signed in. Records stay saved on this device until you sign in again.',
      };
    }

    // 4. Fetch all pending jobs in exact chronological order
    const queue = await readSyncQueue();
    const now = Date.now();

    // Records that must not be pushed this pass, and why.
    const heldBack = new Map<EntityKey, HoldReason>();

    const hold = (key: EntityKey | null, reason: HoldReason) => {
      if (key) {
        heldBack.set(key, reason);
      }
    };

    // 5. Process sequentially to maintain relational integrity
    // (e.g., Household must be inserted before its Individuals)
    for (const entry of queue) {
      const own = ownEntityKey(entry);

      // 5a. Held back behind an earlier entry? Either because a parent record is
      // held back, or because an earlier operation on this same record is.
      const blockingKey = [...parentEntityKeys(entry), ...(own ? [own] : [])].find((key) => heldBack.has(key));

      if (blockingKey) {
        if (heldBack.get(blockingKey) === 'quarantined') {
          // Follow the parent into quarantine so the set stays consistent and can
          // be requeued together once the underlying cause is fixed.
          await moveSyncQueueEntryToDeadLetter(
            entry,
            `Quarantined alongside ${blockingKey}, which could not be synced.`,
          );
          deadLettered += 1;
          hold(own, 'quarantined');
        } else {
          deferred += 1;
          hold(own, 'deferred');
        }
        continue;
      }

      // 5b. Still inside its retry backoff window.
      if (entry.next_attempt_at && Date.parse(entry.next_attempt_at) > now) {
        deferred += 1;
        hold(own, 'deferred');
        continue;
      }

      try {
        await pushQueueEntry(entry);

        // If the API call succeeds, safely delete it from the local device
        await removeSyncQueueEntry(entry.queue_id);
        processed += 1;
      } catch (error) {
        // A failure no longer halts the pass. The entry is held back along with
        // anything downstream of it, and the rest of the queue keeps draining.
        const errorMessage = error instanceof Error ? error.message : 'Sync failed';
        const attempts = entry.attempts + 1;

        logDev('Offline sync queue entry failed', {
          queueId: entry.queue_id,
          table: entry.target_table,
          operation: entry.operation_type,
          attempts,
          errorMessage,
        });

        if (firstFailedQueueId === null) {
          firstFailedQueueId = entry.queue_id;
          firstErrorMessage = errorMessage;
        }

        // A conflict is not a transient failure: the server row is already newer
        // than the edit this entry carries, and every retry would compare against
        // a row that is newer still. Quarantine it now rather than five passes
        // from now, so the person who has to choose between the two versions
        // sees it while they still remember the visit.
        if (error instanceof SyncConflictError || attempts >= MAX_SYNC_ATTEMPTS) {
          await moveSyncQueueEntryToDeadLetter({ ...entry, attempts }, errorMessage);
          deadLettered += 1;
          hold(own, 'quarantined');
        } else {
          await markSyncQueueEntryFailed(entry.queue_id, errorMessage, nextAttemptTimestamp(attempts));
          deferred += 1;
          hold(own, 'deferred');
        }
      }
    }

    // Flush the queue deletions once rather than per entry — saving the web store
    // serializes the whole database, so doing it inside the loop would be O(n) rewrites.
    // A crash before this point simply replays the entries, which is safe because
    // every push is an upsert.
    await persistLocalDatabase();

    // 6. Pull only once the queue has actually drained. Entries still waiting on a
    // retry mean the remote copy is behind the device, and overwriting local rows
    // with stale server data would undo edits that have not shipped yet.
    // Quarantined entries do not block this — they are out of the queue by design.
    if (deferred === 0) {
      try {
        await pullRemoteUpdates();
      } catch (pullError) {
        // If the pull fails, we still want to acknowledge the push succeeded,
        // but we warn the user that they might not have the latest inventory.
        const errorMessage = pullError instanceof Error ? pullError.message : 'Pull failed';
        return {
          status: 'failed', // Triggers the red UI state so the BHW knows to try again
          processed,
          deferred,
          deadLettered,
          failedQueueId: null,
          errorMessage: `Push succeeded, but downloading new inventory failed: ${errorMessage}`,
        };
      }
    }

    // Quarantine is the only outcome here that needs a human: those changes have
    // left the queue and will not retry on their own. Entries merely waiting out
    // a backoff report as `deferred`, which the UI treats as a normal state.
    if (deadLettered > 0) {
      return {
        status: 'failed',
        processed,
        deferred,
        deadLettered,
        failedQueueId: firstFailedQueueId,
        errorMessage: describeIncompletePass(deferred, deadLettered, firstErrorMessage),
      };
    }

    if (deferred > 0) {
      return {
        status: 'deferred',
        processed,
        deferred,
        deadLettered,
        failedQueueId: firstFailedQueueId,
        errorMessage: describeIncompletePass(deferred, deadLettered, firstErrorMessage),
      };
    }

    writeStored(LAST_SYNC_AT_KEY, new Date().toISOString());

    return {
      status: 'synced',
      processed,
      deferred,
      deadLettered,
      failedQueueId: null,
      errorMessage: null,
    };
  } finally {
    // 7. Release the concurrency lock regardless of success or failure
    syncInProgress = false;
  }
}

function idleResult(status: SyncStatus): SyncResult {
  return {
    status,
    processed: 0,
    deferred: 0,
    deadLettered: 0,
    failedQueueId: null,
    errorMessage: null,
  };
}

/**
 * Turns the pass counters into something a BHW can act on, rather than a raw
 * Postgres error string.
 */
function describeIncompletePass(deferred: number, deadLettered: number, firstError: string | null): string {
  const parts: string[] = [];

  if (deferred > 0) {
    parts.push(`${deferred} change(s) will retry automatically`);
  }

  if (deadLettered > 0) {
    parts.push(`${deadLettered} change(s) were set aside after repeated failures and need review`);
  }

  const summary = parts.join('; ');
  return firstError ? `${summary}. First error: ${firstError}` : `${summary}.`;
}

// -----------------------------------------------------------------------------
// Supabase Transport Logic
// -----------------------------------------------------------------------------

async function pushQueueEntry(entry: SyncQueueEntry): Promise<void> {
  if (entry.operation_type === 'INSERT') {
    await insertPayload(entry.target_table, entry.payload);
    return;
  }

  await updatePayload(entry.target_table, entry.payload);
}

/**
 * Handles all new record creations.
 * CRITICAL: Uses `.upsert()` instead of `.insert()`. If the network drops right 
 * after sending data, the device will retry later. Upsert prevents fatal 
 * "Duplicate Primary Key" errors by simply overwriting the row.
 */
async function insertPayload(targetTable: LocalTableName, payload: SyncQueueEntry['payload']): Promise<void> {
  switch (targetTable) {
    case 'households': {
      // The payload arrays (toilet_type, etc.) are native JS arrays here, 
      // which Supabase perfectly translates to text[] in Postgres.
      const { error } = await supabase.from('households').upsert(payload as Household, { onConflict: 'household_id' });
      if (error) throw error;
      return;
    }
    case 'individuals': {
      // The payload boolean (is_household_head) is a native JS boolean here,
      // which Supabase perfectly translates to boolean in Postgres.
      const { error } = await supabase.from('individuals').upsert(payload as Individual, { onConflict: 'resident_id' });
      if (error) throw error;
      return;
    }
    case 'health_assessments': {
      const { error } = await supabase.from('health_assessments').upsert(payload as HealthAssessment, { onConflict: 'assessment_id' });
      if (error) throw error;
      return;
    }
    case 'inventory_items': {
      const { error } = await supabase.from('inventory_items').upsert(payload as InventoryItem, { onConflict: 'item_id' });
      if (error) throw error;
      return;
    }
    case 'supply_disbursements': {
      const { error } = await supabase.from('supply_disbursements').upsert(payload as SupplyDisbursement, { onConflict: 'log_id' });
      if (error) throw error;
      return;
    }
  }
}

/**
 * The moment the device last touched this record. Every update is filtered on
 * `updated_at <= this`, which is the conflict rule: a central row someone else
 * changed afterwards is newer than the edit being pushed, matches nothing, and
 * comes back as a conflict instead of silently overwriting their work.
 */
function editedAt(payload: SyncQueueEntry['payload']): string {
  const value = (payload as Record<string, unknown>).updated_at;
  // Every save*Locally helper stamps updated_at. A payload without one was
  // queued before this rule existed, so let it through rather than quarantining
  // a record for a column it never carried.
  return typeof value === 'string' ? value : '9999-12-31T23:59:59.999Z';
}

/** An update that matched no row lost the race — see SyncConflictError. */
function assertApplied(targetTable: LocalTableName, rows: unknown[] | null): void {
  if (!rows?.length) {
    throw new SyncConflictError(targetTable);
  }
}

/**
 * Handles modifying existing records.
 * Extracts the primary key dynamically and strips it from the update payload
 * to prevent accidentally altering IDs in the cloud database.
 *
 * Each statement returns the primary key it wrote, because an update that
 * changed nothing is indistinguishable from a successful one otherwise — and
 * "changed nothing" is exactly what a concurrent central edit looks like.
 */
async function updatePayload(targetTable: LocalTableName, payload: SyncQueueEntry['payload']): Promise<void> {
  const primaryKey = primaryKeys[targetTable];
  const primaryValue = payload[primaryKey as keyof typeof payload];
  const since = editedAt(payload);

  if (typeof primaryValue !== 'string') {
    throw new Error(`Missing primary key for ${targetTable} update`);
  }

  switch (targetTable) {
    case 'households': {
      const update = withoutPrimaryKey(payload as Household, 'household_id');
      const { data, error } = await supabase
        .from('households')
        .update(update)
        .eq('household_id', primaryValue)
        .lte('updated_at', since)
        .select('household_id');
      if (error) throw error;
      assertApplied(targetTable, data);
      return;
    }
    case 'individuals': {
      const update = withoutPrimaryKey(payload as Individual, 'resident_id');
      const { data, error } = await supabase
        .from('individuals')
        .update(update)
        .eq('resident_id', primaryValue)
        .lte('updated_at', since)
        .select('resident_id');
      if (error) throw error;
      assertApplied(targetTable, data);
      return;
    }
    case 'health_assessments': {
      const update = withoutPrimaryKey(payload as HealthAssessment, 'assessment_id');
      const { data, error } = await supabase
        .from('health_assessments')
        .update(update)
        .eq('assessment_id', primaryValue)
        .lte('updated_at', since)
        .select('assessment_id');
      if (error) throw error;
      assertApplied(targetTable, data);
      return;
    }
    case 'inventory_items': {
      const update = withoutPrimaryKey(payload as InventoryItem, 'item_id');
      const { data, error } = await supabase
        .from('inventory_items')
        .update(update)
        .eq('item_id', primaryValue)
        .lte('updated_at', since)
        .select('item_id');
      if (error) throw error;
      assertApplied(targetTable, data);
      return;
    }
    case 'supply_disbursements': {
      const update = withoutPrimaryKey(payload as SupplyDisbursement, 'log_id');
      const { data, error } = await supabase
        .from('supply_disbursements')
        .update(update)
        .eq('log_id', primaryValue)
        .lte('updated_at', since)
        .select('log_id');
      if (error) throw error;
      assertApplied(targetTable, data);
      return;
    }
  }
}

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

/**
 * Safely removes the primary key from an object before sending it to a 
 * Supabase UPDATE function. Modifying primary keys directly is an anti-pattern.
 */
function withoutPrimaryKey<T extends Record<string, unknown>, K extends keyof T>(payload: T, key: K): Omit<T, K> {
  const copy: Partial<T> = { ...payload };
  delete copy[key];
  return copy as Omit<T, K>;
}

// -----------------------------------------------------------------------------
// Pull Remote Updates Logic
// -----------------------------------------------------------------------------

/**
 * Primary keys of the records sitting in the dead letter, grouped by table.
 *
 * The pull only runs once `deferred === 0`, which means the live queue has fully
 * drained — but quarantined entries deliberately do not block it. Those are the
 * only records where the device copy can still be ahead of the server, so they
 * are also the only ones a server row must not overwrite: doing so would discard
 * the very edit the quarantine was holding on to.
 */
async function readQuarantinedKeys(): Promise<Map<LocalTableName, Set<string>>> {
  const quarantined = new Map<LocalTableName, Set<string>>();

  for (const entry of await readDeadLetterEntries()) {
    const payload = entry.payload as Record<string, unknown>;
    const value = payload[primaryKeys[entry.target_table]];

    if (typeof value !== 'string') {
      continue;
    }

    const keys = quarantined.get(entry.target_table) ?? new Set<string>();
    keys.add(value);
    quarantined.set(entry.target_table, keys);
  }

  return quarantined;
}

export async function pullRemoteUpdates(): Promise<void> {
  try {
    // 1. Fetch tables sequentially to respect foreign key constraints.
    //
    // Which rows come back is not decided here. Every select runs under the
    // purok policies in 202608160002, so a BHW's own assignment already bounds
    // the result to their households and everything hanging off them; repeating
    // that as a client filter would be a second copy of the rule to keep in step
    // with the first. What this device does decide is how much of that scope it
    // needs again: rows it has already read are re-read only if they changed.
    //
    // `gte`, not `gt`: a row written in the same millisecond as the watermark
    // would otherwise be skipped forever. Re-reading a handful of boundary rows
    // costs one upsert each.
    const pulledThrough = readStored(PULLED_THROUGH_KEY);
    const changedSince = <TQuery extends { gte(column: string, value: string): TQuery }>(query: TQuery): TQuery =>
      pulledThrough ? query.gte('updated_at', pulledThrough) : query;

    // Fetch Households
    const { data: cloudHouseholds, error: hError } = await changedSince(supabase.from('households').select('*'));
    if (hError) throw new Error(`Household Pull Error: ${hError.message}`);

    // Fetch Individuals
    const { data: cloudIndividuals, error: iError } = await changedSince(supabase.from('individuals').select('*'));
    if (iError) throw new Error(`Individual Pull Error: ${iError.message}`);

    // Fetch Inventory
    const { data: cloudInventory, error: invError } = await changedSince(supabase.from('inventory_items').select('*'));
    if (invError) throw new Error(`Inventory Pull Error: ${invError.message}`);

    // 2. Drop any row whose local copy is quarantined. The server's version of it
    // is stale by definition — the edit that would have updated it is the one that
    // failed to push.
    const quarantined = await readQuarantinedKeys();

    const withoutQuarantined = <TRow>(table: LocalTableName, rows: TRow[] | null): TRow[] => {
      const held = quarantined.get(table);

      if (!rows?.length || !held?.size) {
        return rows ?? [];
      }

      const primaryKey = primaryKeys[table];
      const kept = rows.filter((row) => !held.has(String((row as Record<string, unknown>)[primaryKey])));

      if (kept.length !== rows.length) {
        logDev('Held back server rows with quarantined local edits', {
          table,
          skipped: rows.length - kept.length,
        });
      }

      return kept;
    };

    // 3. Upsert data into local SQLite in the exact order of their dependencies
    await pullHouseholdsFromServer(withoutQuarantined('households', cloudHouseholds));
    await pullIndividualsFromServer(withoutQuarantined('individuals', cloudIndividuals));
    await pullInventoryFromServer(withoutQuarantined('inventory_items', cloudInventory));

    // 4. Advance the watermark to the newest row the server handed over, rather
    // than to this device's clock: a phone whose time is a minute fast would
    // otherwise skip every row written in that minute.
    const pulledRows: { updated_at?: string }[] = [
      ...(cloudHouseholds ?? []),
      ...(cloudIndividuals ?? []),
      ...(cloudInventory ?? []),
    ];

    const newest = pulledRows.reduce<string | null>(
      (latest, row) => (typeof row.updated_at === 'string' && (!latest || row.updated_at > latest) ? row.updated_at : latest),
      pulledThrough,
    );

    if (newest) {
      writeStored(PULLED_THROUGH_KEY, newest);
    }

    logDev('Successfully pulled all updates from the cloud.', { rows: pulledRows.length, through: newest });

  } catch (error) {
    console.error('Failed to pull remote updates:', error);
    throw error;
  }
}
