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
  readSyncQueue,
  removeSyncQueueEntry,
  type LocalTableName,
  type SyncQueueEntry,
  pullInventoryFromServer,
  pullHouseholdsFromServer,
  pullIndividualsFromServer
} from './localDatabase';

export type SyncStatus = 'idle' | 'offline' | 'unauthenticated' | 'syncing' | 'synced' | 'failed';

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
function ownEntityKey(entry: SyncQueueEntry): EntityKey | null {
  const payload = entry.payload as Record<string, unknown>;
  const value = payload[primaryKeys[entry.target_table]];
  return typeof value === 'string' ? entityKey(entry.target_table, value) : null;
}

/** The records this entry's foreign keys point at. */
function parentEntityKeys(entry: SyncQueueEntry): EntityKey[] {
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
function nextAttemptTimestamp(attempts: number): string {
  const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1), RETRY_MAX_DELAY_MS);
  return new Date(Date.now() + delay).toISOString();
}

/**
 * The main background loop that reads the local SQLite queue and pushes 
 * pending operations to the Supabase PostgreSQL database.
 */
export async function syncPendingQueue(): Promise<SyncResult> {
  // 1. Check for concurrency lock
  if (syncInProgress) {
    return idleResult('syncing');
  }

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

  syncInProgress = true;
  let processed = 0;
  let deferred = 0;
  let deadLettered = 0;
  let firstFailedQueueId: number | null = null;
  let firstErrorMessage: string | null = null;

  try {
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

        if (attempts >= MAX_SYNC_ATTEMPTS) {
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

    if (deadLettered > 0 || deferred > 0) {
      return {
        status: 'failed',
        processed,
        deferred,
        deadLettered,
        failedQueueId: firstFailedQueueId,
        errorMessage: describeIncompletePass(deferred, deadLettered, firstErrorMessage),
      };
    }

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
 * Handles modifying existing records.
 * Extracts the primary key dynamically and strips it from the update payload 
 * to prevent accidentally altering IDs in the cloud database.
 */
async function updatePayload(targetTable: LocalTableName, payload: SyncQueueEntry['payload']): Promise<void> {
  const primaryKey = primaryKeys[targetTable];
  const primaryValue = payload[primaryKey as keyof typeof payload];

  if (typeof primaryValue !== 'string') {
    throw new Error(`Missing primary key for ${targetTable} update`);
  }

  switch (targetTable) {
    case 'households': {
      const update = withoutPrimaryKey(payload as Household, 'household_id');
      const { error } = await supabase.from('households').update(update).eq('household_id', primaryValue);
      if (error) throw error;
      return;
    }
    case 'individuals': {
      const update = withoutPrimaryKey(payload as Individual, 'resident_id');
      const { error } = await supabase.from('individuals').update(update).eq('resident_id', primaryValue);
      if (error) throw error;
      return;
    }
    case 'health_assessments': {
      const update = withoutPrimaryKey(payload as HealthAssessment, 'assessment_id');
      const { error } = await supabase.from('health_assessments').update(update).eq('assessment_id', primaryValue);
      if (error) throw error;
      return;
    }
    case 'inventory_items': {
      const update = withoutPrimaryKey(payload as InventoryItem, 'item_id');
      const { error } = await supabase.from('inventory_items').update(update).eq('item_id', primaryValue);
      if (error) throw error;
      return;
    }
    case 'supply_disbursements': {
      const update = withoutPrimaryKey(payload as SupplyDisbursement, 'log_id');
      const { error } = await supabase.from('supply_disbursements').update(update).eq('log_id', primaryValue);
      if (error) throw error;
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

export async function pullRemoteUpdates(): Promise<void> {
  try {
    // 1. Fetch tables sequentially to respect foreign key constraints
    
    // Fetch Households
    const { data: cloudHouseholds, error: hError } = await supabase.from('households').select('*');
    if (hError) throw new Error(`Household Pull Error: ${hError.message}`);

    // Fetch Individuals
    const { data: cloudIndividuals, error: iError } = await supabase.from('individuals').select('*');
    if (iError) throw new Error(`Individual Pull Error: ${iError.message}`);

    // Fetch Inventory
    const { data: cloudInventory, error: invError } = await supabase.from('inventory_items').select('*');
    if (invError) throw new Error(`Inventory Pull Error: ${invError.message}`);

    // 2. Upsert data into local SQLite in the exact order of their dependencies
    if (cloudHouseholds && cloudHouseholds.length > 0) {
      await pullHouseholdsFromServer(cloudHouseholds);
    }
    
    if (cloudIndividuals && cloudIndividuals.length > 0) {
      await pullIndividualsFromServer(cloudIndividuals);
    }
    
    if (cloudInventory && cloudInventory.length > 0) {
      await pullInventoryFromServer(cloudInventory);
    }

    console.log('Successfully pulled all updates from the cloud.');

  } catch (error) {
    console.error('Failed to pull remote updates:', error);
    throw error;
  }
}
