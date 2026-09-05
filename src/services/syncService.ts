import { Network } from '@capacitor/network';
import type { InventoryItem } from '../types/database';
import { logDev } from '../lib/utils';
import { readAllPages, supabase } from '../lib/supabase';
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
  pullIndividualsFromServer,
  pullHealthAssessmentsFromServer,
  pullSupplyDisbursementsFromServer,
  readExistingIds,
  primaryKeys,
  setRowVersion,
} from './localDatabase';

/** `deferred` is a normal outcome (retry backoff), distinct from `failed` (quarantined). */
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
  /** Entries left on the queue for a later pass. */
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
// Pass bookkeeping, persisted: last drain time, and how far the pull has read.
// -----------------------------------------------------------------------------

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
    // Storage unavailable — next pull just re-reads everything.
  }
}

/** When the queue last drained, ISO 8601, or null if it never has on this device. */
export function readLastSyncAt(): string | null {
  return readStored(LAST_SYNC_AT_KEY);
}

/** Forgets how far the pull has read, so a filtered pull re-offers rows the watermark has passed. */
export function resetPullWatermark(): void {
  try {
    localStorage.removeItem(PULLED_THROUGH_KEY);
  } catch {
    // Nothing to forget if storage is unavailable.
  }
}

/**
 * Forgets both pass markers, for a device changing hands. Once the tables are
 * emptied the watermark is no longer true, and the next health worker would pull
 * only what changed since it.
 */
export function forgetDeviceSyncState(): void {
  resetPullWatermark();

  try {
    localStorage.removeItem(LAST_SYNC_AT_KEY);
  } catch {
    // Nothing to forget if storage is unavailable.
  }
}

/** The central row changed after this device's edit, so the entry goes straight to the dead letter. */
class SyncConflictError extends Error {
  constructor(table: LocalTableName) {
    super(`This ${table.replace(/_/g, ' ')} record was changed centrally after this device edited it.`);
    this.name = 'SyncConflictError';
  }
}

// -----------------------------------------------------------------------------
// Sync Engine State
// -----------------------------------------------------------------------------

/** Guards against two sync loops running at once (e.g. a mashed "Sync" button). */
let syncInProgress = false;

async function isNetworkConnected(): Promise<boolean> {
  const status = await Network.getStatus();
  return status.connected;
}

// -----------------------------------------------------------------------------
// Dependency Tracking — a held-back entry holds back everything referencing it,
// so a child is never pushed with a foreign key the server does not have yet.
//
//   households      <- individuals            (household_id)
//   individuals     <- health_assessments     (resident_id)
//   individuals     <- supply_disbursements   (resident_id)
//   inventory_items <- supply_disbursements   (item_id)
// -----------------------------------------------------------------------------

/** `table:primary_key` — identifies the record an entry writes or depends on. */
type EntityKey = string;

/** Why a record is held back: `deferred` retries next pass, `quarantined` takes its dependants with it. */
type HoldReason = 'deferred' | 'quarantined';

function entityKey(table: LocalTableName, id: string): EntityKey {
  return `${table}:${id}`;
}

/** The primary key this entry writes, or null if the payload carries no usable one. */
function ownRowId(entry: SyncQueueEntry): string | null {
  const value = (entry.payload as Record<string, unknown>)[primaryKeys[entry.target_table]];

  return typeof value === 'string' ? value : null;
}

/** The record this entry writes, or null if the payload carries no usable primary key. */
export function ownEntityKey(entry: SyncQueueEntry): EntityKey | null {
  const id = ownRowId(entry);

  return id === null ? null : entityKey(entry.target_table, id);
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
      // duplicate_override_of is a second parent, so an override is not pushed
      // ahead of the record it references.
      return [...reference('household_id', 'households'), ...reference('duplicate_override_of', 'individuals')];
    case 'health_assessments':
      return reference('resident_id', 'individuals');
    case 'supply_disbursements':
      return [...reference('resident_id', 'individuals'), ...reference('item_id', 'inventory_items')];
  }
}

/** Exponential backoff off the recorded attempt count: 30s, 1m, 2m, 4m, then quarantine. */
export function nextAttemptTimestamp(attempts: number): string {
  const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1), RETRY_MAX_DELAY_MS);
  return new Date(Date.now() + delay).toISOString();
}

/** Reads the local sync queue and pushes pending operations to Supabase. */
export async function syncPendingQueue(): Promise<SyncResult> {
  // Claim the lock before the first await, or a second trigger in that window
  // passes the same check.
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

    // Hardware network check before attempting any API calls
    const connected = await isNetworkConnected();
    if (!connected) {
      return idleResult('offline');
    }

    // RLS rejects every write from an anonymous client, so defer rather than
    // burn retry attempts.
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      return {
        ...idleResult('unauthenticated'),
        errorMessage: 'Not signed in. Records stay saved on this device until you sign in again.',
      };
    }

    // Fetch all pending jobs in exact chronological order
    const queue = await readSyncQueue();
    const now = Date.now();

    // Records that must not be pushed this pass, and why.
    const heldBack = new Map<EntityKey, HoldReason>();

    // What the server said a row's `updated_at` is, for rows pushed earlier in
    // this same pass. A second edit made offline was queued against the version
    // before the first one landed, and the server has moved on since — without
    // this it would match nothing and quarantine a change nobody conflicted with.
    const pushedVersions = new Map<EntityKey, string>();

    const hold = (key: EntityKey | null, reason: HoldReason) => {
      if (key) {
        heldBack.set(key, reason);
      }
    };

    // Process sequentially so a household lands before its individuals.
    for (const entry of queue) {
      const own = ownEntityKey(entry);

      // Held back if its parent is, or if an earlier operation on this same record is.
      const blockingKey = [...parentEntityKeys(entry), ...(own ? [own] : [])].find((key) => heldBack.has(key));

      if (blockingKey) {
        if (heldBack.get(blockingKey) === 'quarantined') {
          // Follow the parent into quarantine so the set requeues together later.
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

      // Still inside its retry backoff window.
      if (entry.next_attempt_at && Date.parse(entry.next_attempt_at) > now) {
        deferred += 1;
        hold(own, 'deferred');
        continue;
      }

      try {
        const baseVersion = (own && pushedVersions.get(own)) ?? entry.base_version;
        const newVersion = await pushQueueEntry(entry, baseVersion);

        // Remember the server's stamp, both for the next entry on this row and
        // for the next edit made on this device.
        const rowId = ownRowId(entry);

        if (own && rowId && newVersion) {
          pushedVersions.set(own, newVersion);
          await setRowVersion(entry.target_table, rowId, newVersion);
        }

        // If the API call succeeds, safely delete it from the local device
        await removeSyncQueueEntry(entry.queue_id);
        processed += 1;
      } catch (error) {
        // A failure holds back this entry and its dependants; the rest keeps draining.
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

        // A conflict cannot resolve by retrying, so quarantine immediately.
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

    // Flush once rather than per-entry. A crash before this replays safely,
    // since every push is an upsert.
    await persistLocalDatabase();

    // Pull only once the queue has drained, or local edits that have not shipped
    // get overwritten.
    if (deferred === 0) {
      try {
        await pullRemoteUpdates();
      } catch (pullError) {
        // Push succeeded even though the pull failed — say so, don't hide it as a full failure.
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

    // Only quarantine needs a human — deferred entries just retry automatically.
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
    // Release the concurrency lock regardless of success or failure
    syncInProgress = false;
  }
}

/** A pass that did nothing, in the shape every caller reports. */
export function idleResult(status: SyncStatus): SyncResult {
  return {
    status,
    processed: 0,
    deferred: 0,
    deadLettered: 0,
    failedQueueId: null,
    errorMessage: null,
  };
}

/** Turns the pass counters into something a BHW can act on, rather than a raw Postgres error string. */
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

/** Pushes one entry and hands back the `updated_at` the server ended up holding, when it said. */
async function pushQueueEntry(entry: SyncQueueEntry, baseVersion: string | null): Promise<string | null> {
  if (entry.operation_type === 'INSERT') {
    return insertPayload(entry.target_table, entry.payload);
  }

  return updatePayload(entry.target_table, entry.payload, baseVersion);
}

/**
 * The table being written is a runtime value, so the generated `Database` types
 * cannot narrow the row shape or the column names. One cast, here.
 */
type UntypedRows = {
  upsert(values: Record<string, unknown>, options: { onConflict: string }): UntypedRows;
  update(values: Record<string, unknown>): UntypedRows;
  eq(column: string, value: string): UntypedRows;
  lte(column: string, value: string): UntypedRows;
  select(columns: string): PromiseLike<{ data: unknown[] | null; error: PostgrestError }>;
};

type PostgrestError = { message: string } | null;

function rowsOf(table: LocalTableName): UntypedRows {
  return supabase.from(table) as unknown as UntypedRows;
}

/**
 * Uses `.upsert()`, so a retry after a dropped connection does not fatal on a
 * duplicate key. Selects `updated_at` back, which becomes the base version for
 * the next edit of this row.
 */
async function insertPayload(
  targetTable: LocalTableName,
  payload: SyncQueueEntry['payload'],
): Promise<string | null> {
  const { data, error } = await rowsOf(targetTable)
    .upsert(payload, { onConflict: primaryKeys[targetTable] })
    .select('updated_at');

  if (error) throw error;

  return serverVersion(data);
}

/** The `updated_at` a write handed back, or null if the server returned no row. */
function serverVersion(rows: unknown[] | null): string | null {
  const value = (rows?.[0] as Record<string, unknown> | undefined)?.updated_at;

  return typeof value === 'string' ? value : null;
}

/**
 * The device's edit timestamp, used only by entries queued before `base_version`
 * existed. Cross-clock, which is the reason it was replaced.
 */
function editedAt(payload: SyncQueueEntry['payload']): string {
  const value = (payload as Record<string, unknown>).updated_at;
  // A payload predating this rule has no updated_at — let it through rather than quarantine it.
  return typeof value === 'string' ? value : '9999-12-31T23:59:59.999Z';
}

/** An update that matched no row lost the race — see SyncConflictError. */
function assertApplied(targetTable: LocalTableName, rows: unknown[] | null): void {
  if (!rows?.length) {
    throw new SyncConflictError(targetTable);
  }
}

/**
 * Strips the primary key from the payload before updating, and selects it back:
 * a no-op update is otherwise indistinguishable from success.
 *
 * The guard matches the row against `baseVersion` — the `updated_at` this device
 * last read from the server. Both sides of that comparison are then server
 * clocks, so only a row genuinely changed since fails it. Without one, the entry
 * predates the column and falls back to the old device-clock comparison.
 */
async function updatePayload(
  targetTable: LocalTableName,
  payload: SyncQueueEntry['payload'],
  baseVersion: string | null,
): Promise<string | null> {
  const primaryKey = primaryKeys[targetTable];
  const primaryValue = payload[primaryKey as keyof typeof payload];

  if (typeof primaryValue !== 'string') {
    throw new Error(`Missing primary key for ${targetTable} update`);
  }

  const targeted = rowsOf(targetTable)
    .update(withoutPrimaryKey(payload, primaryKey))
    .eq(primaryKey, primaryValue);

  const { data, error } = await (baseVersion
    ? targeted.eq('updated_at', baseVersion)
    : targeted.lte('updated_at', editedAt(payload))
  ).select(`${primaryKey}, updated_at`);

  if (error) throw error;
  assertApplied(targetTable, data);

  return serverVersion(data);
}

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

/** Removes the primary key before an UPDATE payload is sent. */
function withoutPrimaryKey(payload: object, key: string): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...payload };
  delete copy[key];
  return copy;
}

// -----------------------------------------------------------------------------
// Pull Remote Updates Logic
// -----------------------------------------------------------------------------

/**
 * Primary keys of dead-lettered records, grouped by table — the only rows where
 * the device can be ahead of the server, so a pull must not overwrite them.
 */
async function readQuarantinedKeys(): Promise<Map<LocalTableName, Set<string>>> {
  const quarantined = new Map<LocalTableName, Set<string>>();

  const hold = (table: LocalTableName, key: string) => {
    const keys = quarantined.get(table) ?? new Set<string>();
    keys.add(key);
    quarantined.set(table, keys);
  };

  for (const entry of await readDeadLetterEntries()) {
    const payload = entry.payload as Record<string, unknown>;
    const value = payload[primaryKeys[entry.target_table]];

    if (typeof value === 'string') {
      hold(entry.target_table, value);
    }

    for (const derived of derivedEntityKeys(entry)) {
      hold(derived.table, derived.key);
    }
  }

  return quarantined;
}

/**
 * Rows whose server value is derived from this entry, so pulling one back while it
 * is quarantined would double-release stock. Narrower than `parentEntityKeys`.
 */
export function derivedEntityKeys(entry: {
  target_table: LocalTableName;
  payload: SyncQueueEntry['payload'];
}): { table: LocalTableName; key: string }[] {
  if (entry.target_table !== 'supply_disbursements') {
    return [];
  }

  const itemId = (entry.payload as Record<string, unknown>).item_id;

  return typeof itemId === 'string' ? [{ table: 'inventory_items', key: itemId }] : [];
}

/**
 * Newest `updated_at` the server handed over, for the next watermark. Only rows
 * read through the current watermark belong here; an unfiltered row would drag it
 * past records this device has not seen.
 */
export function newestUpdatedAt(rows: { updated_at?: string }[], fallback: string | null): string | null {
  return rows.reduce<string | null>(
    (latest, row) => (typeof row.updated_at === 'string' && (!latest || row.updated_at > latest) ? row.updated_at : latest),
    fallback,
  );
}

/**
 * Rows whose foreign key names a record this device holds. The leaf tables are
 * scoped by resident, so a row can come back naming an item never allocated here,
 * and local foreign keys are enforced — that row would fail the whole statement.
 *
 * A skipped row still advances the watermark: the parent it names is not coming,
 * and holding the watermark back would re-download every row since on every pass.
 */
export function withKnownParents<TRow>(rows: TRow[], foreignKey: keyof TRow & string, known: Set<string>): TRow[] {
  const kept = rows.filter((row) => known.has(String(row[foreignKey])));

  if (kept.length !== rows.length) {
    logDev('Skipped pulled rows whose parent is not on this device', {
      foreignKey,
      skipped: rows.length - kept.length,
    });
  }

  return kept;
}

async function pullRemoteUpdates(): Promise<void> {
  try {
    // Row scope is enforced by RLS, not repeated here. `gte`, not `gt`, so a row
    // written in the same millisecond as the watermark is not skipped.
    const pulledThrough = readStored(PULLED_THROUGH_KEY);
    const changedSince = <TQuery extends { gte(column: string, value: string): TQuery }>(query: TQuery): TQuery =>
      pulledThrough ? query.gte('updated_at', pulledThrough) : query;

    const cloudHouseholds = await readAllPages('Household', (from, to) =>
      changedSince(supabase.from('households').select('*')).order('updated_at').order('household_id').range(from, to),
    );

    const cloudIndividuals = await readAllPages('Individual', (from, to) =>
      changedSince(supabase.from('individuals').select('*')).order('updated_at').order('resident_id').range(from, to),
    );

    // Pulls `bhw_item_stock` (this BHW's allocations minus releases), not
    // `inventory_items` (the barangay's unallocated total). Unfiltered, since the
    // view is derived and its timestamps do not track the watermark.
    const cloudStock = await readAllPages('Inventory', (from, to) =>
      supabase.from('bhw_item_stock').select('*').order('updated_at').order('item_id').range(from, to),
    );

    // Read back so a reinstalled device recovers its history, and so a resident's
    // record shows what another device recorded.
    const cloudAssessments = await readAllPages('Health assessment', (from, to) =>
      changedSince(supabase.from('health_assessments').select('*')).order('updated_at').order('assessment_id').range(from, to),
    );

    const cloudDisbursements = await readAllPages('Supply disbursement', (from, to) =>
      changedSince(supabase.from('supply_disbursements').select('*')).order('updated_at').order('log_id').range(from, to),
    );

    // `created_at` is not on the view and is not mutable on conflict, so it only
    // stamps a row seen for the first time.
    const cloudInventory: InventoryItem[] = cloudStock.map((stock) => ({
      item_id: stock.item_id,
      item_name: stock.item_name,
      type: stock.type,
      current_stock: stock.current_stock,
      barangay_id: stock.barangay_id,
      created_at: stock.updated_at,
      updated_at: stock.updated_at,
    }));

    // Drop rows whose local copy is quarantined — the server version is stale by definition.
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

    // Upsert data into local SQLite in the exact order of their dependencies
    await pullHouseholdsFromServer(withoutQuarantined('households', cloudHouseholds));

    // Individuals need the same parent guard as the leaf tables below: a resident
    // can be read through a household this device does not hold, and one such row
    // fails the whole statement set on every pass.
    const householdIds = await readExistingIds('households', 'household_id');

    await pullIndividualsFromServer(
      withKnownParents(withoutQuarantined('individuals', cloudIndividuals), 'household_id', householdIds),
    );
    await pullInventoryFromServer(withoutQuarantined('inventory_items', cloudInventory));

    // Parents are read after the writes above, so a row that arrived in this same pass counts as held.
    const [residentIds, itemIds] = await Promise.all([
      readExistingIds('individuals', 'resident_id'),
      readExistingIds('inventory_items', 'item_id'),
    ]);

    await pullHealthAssessmentsFromServer(
      withKnownParents(withoutQuarantined('health_assessments', cloudAssessments), 'resident_id', residentIds),
    );

    await pullSupplyDisbursementsFromServer(
      withKnownParents(
        withKnownParents(withoutQuarantined('supply_disbursements', cloudDisbursements), 'resident_id', residentIds),
        'item_id',
        itemIds,
      ),
    );

    // One flush for the whole pull, since on web each is a full serialization.
    await persistLocalDatabase();

    // Advance the watermark to the server's newest row, not this device's clock,
    // which can drift. Inventory is excluded: it is pulled unfiltered.
    const pulledRows: { updated_at?: string }[] = [
      ...cloudHouseholds,
      ...cloudIndividuals,
      ...cloudAssessments,
      ...cloudDisbursements,
    ];

    const newest = newestUpdatedAt(pulledRows, pulledThrough);

    if (newest) {
      writeStored(PULLED_THROUGH_KEY, newest);
    }

    logDev('Successfully pulled all updates from the cloud.', { rows: pulledRows.length, through: newest });

  } catch (error) {
    console.error('Failed to pull remote updates:', error);
    throw error;
  }
}
