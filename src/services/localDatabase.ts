import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import { logDev } from '../lib/utils';
import type {
  HealthAssessment,
  HealthAssessmentInsert,
  HealthAssessmentUpdate,
  Household,
  HouseholdInsert,
  HouseholdUpdate,
  Individual,
  IndividualInsert,
  IndividualUpdate,
  InventoryItem,
  InventoryItemInsert,
  InventoryItemUpdate,
  SupplyDisbursement,
  SupplyDisbursementInsert,
  SupplyDisbursementUpdate,
} from '../types/database';

// -----------------------------------------------------------------------------
// Type Definitions for the Sync Code
// -----------------------------------------------------------------------------

export type PaginatedQuery = {
  limit?: number;
  offset?: number;
  searchQuery?: string;
};

// Defines the exact tables that exist in our local SQLite database.
export type LocalTableName =
  | 'households'
  | 'individuals'
  | 'health_assessments'
  | 'inventory_items'
  | 'supply_disbursements';

// Device-local bookkeeping tables. These mirror no Supabase table and are never
// pushed, so they are deliberately kept out of LocalTableName — but they still
// need to be reachable by the column-upgrade machinery.
export type LocalBookkeepingTableName = 'sync_queue' | 'sync_dead_letter';

type MigratableTableName = LocalTableName | LocalBookkeepingTableName;

export type SyncOperationType = 'INSERT' | 'UPDATE';

// Maps each local table to its corresponding "Insert" TypeScript interface.
// Ensures type safety when pushing new records to the sync queue.
export type LocalInsertPayloadByTable = {
  households: HouseholdInsert;
  individuals: IndividualInsert;
  health_assessments: HealthAssessmentInsert;
  inventory_items: InventoryItemInsert;
  supply_disbursements: SupplyDisbursementInsert;
};

// Maps each local table to its corresponding "Update" TypeScript interface.
// Pick<> is used to enforce that an update payload MUST contain the primary key.
export type LocalUpdatePayloadByTable = {
  households: HouseholdUpdate & Pick<Household, 'household_id'>;
  individuals: IndividualUpdate & Pick<Individual, 'resident_id'>;
  health_assessments: HealthAssessmentUpdate & Pick<HealthAssessment, 'assessment_id'>;
  inventory_items: InventoryItemUpdate & Pick<InventoryItem, 'item_id'>;
  supply_disbursements: SupplyDisbursementUpdate & Pick<SupplyDisbursement, 'log_id'>;
};

// A generic type that dynamically determines the correct payload interface 
// based on the Table Name and the Operation Type provided.
export type SyncPayload<TTable extends LocalTableName, TOperation extends SyncOperationType> =
  TOperation extends 'INSERT' ? LocalInsertPayloadByTable[TTable] : LocalUpdatePayloadByTable[TTable];

// Represents a single row in the local `sync_queue` table.
// This is the staging area for data waiting to be pushed to Supabase.
export type SyncQueueEntry<TTable extends LocalTableName = LocalTableName> = {
  queue_id: number;
  operation_type: SyncOperationType;
  target_table: TTable;
  payload: LocalInsertPayloadByTable[TTable] | LocalUpdatePayloadByTable[TTable];
  created_at: string;
  attempts: number; // Tracks retry counts if the network fails
  last_error: string | null;
  // Earliest ISO timestamp at which this entry may be retried. Null means "now".
  // Persisted rather than held in memory because the app is killed constantly in
  // the field — in-memory backoff would reset on every cold start.
  next_attempt_at: string | null;
};

// A queue entry that exhausted its retries and was set aside so the rest of the
// queue can keep draining. Nothing is deleted: the payload is preserved in full
// so a BHW or admin can requeue it once the underlying cause is fixed.
export type DeadLetterEntry<TTable extends LocalTableName = LocalTableName> = {
  dead_letter_id: number;
  original_queue_id: number;
  operation_type: SyncOperationType;
  target_table: TTable;
  payload: LocalInsertPayloadByTable[TTable] | LocalUpdatePayloadByTable[TTable];
  created_at: string;
  attempts: number;
  last_error: string | null;
  failed_at: string;
};

type SqlValue = string | number | null;

// -----------------------------------------------------------------------------
// Database Connection & Initialization
// -----------------------------------------------------------------------------

const sqlite = new SQLiteConnection(CapacitorSQLite);
const isWebPlatform = Capacitor.getPlatform() === 'web';
let localDatabase: SQLiteDBConnection | null = null;
let localDatabaseSetup: Promise<SQLiteDBConnection> | null = null;

// The schema definitions for the local offline database.
const migrations = [
  // Households Table
  // Note: toilet_type, water_source, and food_production are arrays in Supabase,
  // but SQLite doesn't support arrays. We define them as 'text' here to store JSON strings.
  `create table if not exists households (
    household_id text primary key,
    household_number text not null,
    dwelling_type text not null check (dwelling_type in ('concrete', 'wood', 'mixed', 'makeshift')),
    electric_service text not null check (electric_service in ('lamp', 'gas', 'iselco', 'none')),
    fuel_used text not null check (fuel_used in ('wood', 'charcoal', 'lpg', 'electricity')),
    toilet_type text not null,
    water_source text not null,
    food_production text not null,
    health_status_notes text,
    created_at text not null,
    updated_at text not null
  )`,
  
  // Individuals Table
  // Note: SQLite does not have a boolean type. We use integers (0 or 1) and 
  // enforce it with check constraints (e.g., check (is_household_head in (0, 1))).
  `create table if not exists individuals (
    resident_id text primary key,
    household_id text not null,
    first_name text not null,
    middle_name text,
    last_name text not null,
    sex text not null check (sex in ('male', 'female')),
    birthday text not null,
    is_household_head integer not null default 0 check (is_household_head in (0, 1)),
    occupation text,
    educational_attainment text,
    is_out_of_school_youth integer not null default 0 check (is_out_of_school_youth in (0, 1)),
    is_pregnant_nursing_fp integer not null default 0 check (is_pregnant_nursing_fp in (0, 1)),
    philhealth_number text,
    created_at text not null,
    updated_at text not null,
    foreign key (household_id) references households(household_id) on delete cascade
  )`,
  
  // Health Assessments Table
  `create table if not exists health_assessments (
    assessment_id text primary key,
    resident_id text not null,
    assessment_date text not null,
    weight real not null check (weight > 0),
    height real not null check (height > 0),
    bmi real not null check (bmi > 0),
    nutrition_status text not null check (nutrition_status in ('underweight', 'normal', 'overweight', 'obese')),
    created_at text not null,
    updated_at text not null,
    foreign key (resident_id) references individuals(resident_id) on delete cascade
  )`,
  
  // Inventory Items Table
  `create table if not exists inventory_items (
    item_id text primary key,
    item_name text not null,
    type text not null check (type in ('medicine', 'food', 'equipment', 'hygiene', 'other')),
    current_stock integer not null default 0 check (current_stock >= 0),
    created_at text not null,
    updated_at text not null
  )`,
  
  // Supply Disbursements Table (Transaction Log)
  `create table if not exists supply_disbursements (
    log_id text primary key,
    item_id text not null,
    resident_id text not null,
    disbursement_date text not null,
    quantity integer not null check (quantity > 0),
    created_at text not null,
    updated_at text not null,
    foreign key (item_id) references inventory_items(item_id),
    foreign key (resident_id) references individuals(resident_id)
  )`,
  
  // Sync Queue Table
  // Holds stringified JSON payloads waiting to be shipped to Supabase.
  `create table if not exists sync_queue (
    queue_id integer primary key autoincrement,
    operation_type text not null check (operation_type in ('INSERT', 'UPDATE')),
    target_table text not null check (target_table in ('households', 'individuals', 'health_assessments', 'inventory_items', 'supply_disbursements')),
    payload text not null,
    created_at text not null,
    attempts integer not null default 0,
    last_error text,
    next_attempt_at text
  )`,

  // Sync Dead Letter Table
  // Entries that exhausted their retries, moved aside so the main queue keeps
  // draining. Health records are never discarded — only quarantined for review.
  `create table if not exists sync_dead_letter (
    dead_letter_id integer primary key autoincrement,
    original_queue_id integer not null,
    operation_type text not null check (operation_type in ('INSERT', 'UPDATE')),
    target_table text not null check (target_table in ('households', 'individuals', 'health_assessments', 'inventory_items', 'supply_disbursements')),
    payload text not null,
    created_at text not null,
    attempts integer not null default 0,
    last_error text,
    failed_at text not null
  )`,

  // Performance Indices for faster lookups and table joins
  'create index if not exists local_individuals_household_id_idx on individuals(household_id)',
  'create index if not exists local_health_assessments_resident_id_idx on health_assessments(resident_id)',
  'create index if not exists local_inventory_items_type_idx on inventory_items(type)',
  'create index if not exists local_supply_disbursements_item_id_idx on supply_disbursements(item_id)',
  'create index if not exists local_supply_disbursements_resident_id_idx on supply_disbursements(resident_id)',
  'create index if not exists local_sync_queue_created_at_idx on sync_queue(created_at)',
  'create index if not exists local_sync_dead_letter_failed_at_idx on sync_dead_letter(failed_at)',
];

// Columns introduced after the first release. Every migration above is
// `create table if not exists`, so a device that installed earlier keeps its original
// schema forever — each later column has to be added explicitly when it is missing.
const columnUpgrades: { table: MigratableTableName; column: string; definition: string }[] = [
  { table: 'individuals', column: 'middle_name', definition: 'text' },
  // Retry backoff. Devices installed before the resilience work have a sync_queue
  // without this column, and `create table if not exists` will never add it.
  { table: 'sync_queue', column: 'next_attempt_at', definition: 'text' },
];

/**
 * Adds any post-release column that this device's database predates.
 * Idempotent: `pragma table_info` is checked first, so re-running is a no-op.
 */
async function applyColumnUpgrades(database: SQLiteDBConnection): Promise<void> {
  for (const upgrade of columnUpgrades) {
    const info = await database.query(`pragma table_info(${upgrade.table})`);
    const hasColumn = (info.values ?? []).some((row) => row.name === upgrade.column);

    if (!hasColumn) {
      await database.execute(`alter table ${upgrade.table} add column ${upgrade.column} ${upgrade.definition}`);
    }
  }
}

/**
 * Bootstraps the local SQLite connection and runs all migrations.
 * This is called automatically when the app starts.
 */
export async function initializeLocalDatabase(): Promise<SQLiteDBConnection> {
  if (localDatabase) {
    return localDatabase;
  }

  // Cache the in-flight promise, not just the resolved connection. refreshLocalData()
  // fans out several accessors at once and useBackgroundSync initializes in parallel,
  // so without this every concurrent caller clears the check above and opens its own
  // connection to `mabisa_local`, re-running the migrations on each one.
  if (!localDatabaseSetup) {
    localDatabaseSetup = openLocalDatabase().catch((error: unknown) => {
      localDatabaseSetup = null; // allow a later call to retry after a failed open
      throw error;
    });
  }

  return localDatabaseSetup;
}

async function openLocalDatabase(): Promise<SQLiteDBConnection> {
  // 2. THE WEB POLYFILL
  // This block ONLY runs in the browser. It ensures the emulator is injected
  // exactly when needed, preventing Vite HMR race conditions.
  if (isWebPlatform) {
    try {
      let jeepEl = document.querySelector('jeep-sqlite');

      if (!jeepEl) {
        jeepEl = document.createElement('jeep-sqlite');
        document.body.appendChild(jeepEl);
      }

      // Force the app to wait until the browser fully registers the element
      await customElements.whenDefined('jeep-sqlite');

      // Initialize the web store via the sqlite wrapper, not the raw Capacitor instance
      await sqlite.initWebStore();

    } catch (error) {
      // If Vite Hot-Reloads, initWebStore might throw an "already initialized" error.
      // We catch it here so it doesn't crash your React app.
      console.warn('SQLite Web Store warning (safe to ignore during dev):', error);
    }
  }

  // 3. CREATE & OPEN CONNECTION
  const database = await sqlite.createConnection('mabisa_local', false, 'no-encryption', 1, false);
  await database.open();
  await database.execute('pragma foreign_keys = on');

  for (const statement of migrations) {
    await database.execute(statement);
  }

  await applyColumnUpgrades(database);
  await householdUpsert.verify(database);
  await individualUpsert.verify(database);
  await inventoryUpsert.verify(database);

  localDatabase = database;
  return database;
}

/**
 * Helper function to ensure the database is initialized before any query runs.
 */
export async function getLocalDatabase(): Promise<SQLiteDBConnection> {
  return initializeLocalDatabase();
}

/**
 * Flushes the database to durable storage.
 *
 * Web builds hold the whole database in memory and write nothing to IndexedDB until
 * the store is saved explicitly, so without this every record is lost on reload.
 * Native platforms persist on write, where this is a no-op.
 */
export async function persistLocalDatabase(): Promise<void> {
  if (!isWebPlatform) {
    return;
  }

  await sqlite.saveToStore('mabisa_local');
}

// -----------------------------------------------------------------------------
// Sync Queue Management
// -----------------------------------------------------------------------------

/**
 * Takes a valid payload, stringifies it, and drops it into the sync_queue table.
 * This happens immediately after updating a local table (the "Double-Write" pattern).
 */
export async function enqueueSyncOperation<TTable extends LocalTableName, TOperation extends SyncOperationType>(
  targetTable: TTable,
  operationType: TOperation,
  payload: SyncPayload<TTable, TOperation>,
): Promise<void> {
  const database = await getLocalDatabase();
  await database.run(
    `insert into sync_queue (operation_type, target_table, payload, created_at, attempts, last_error)
     values (?, ?, ?, ?, 0, null)`,
    [operationType, targetTable, JSON.stringify(payload), new Date().toISOString()],
  );
}

/**
 * Fetches all pending jobs in chronological order.
 * The syncService loops through this list when the device connects to the internet.
 */
export async function readSyncQueue(): Promise<SyncQueueEntry[]> {
  const database = await getLocalDatabase();
  const result = await database.query(
    `select queue_id, operation_type, target_table, payload, created_at, attempts, last_error, next_attempt_at
     from sync_queue
     order by queue_id asc`,
  );

  return (result.values ?? []).map((row) => ({
    queue_id: Number(row.queue_id),
    operation_type: parseOperationType(String(row.operation_type)),
    target_table: parseLocalTableName(String(row.target_table)),
    payload: JSON.parse(String(row.payload)), // Parse the raw string back into a JS object
    created_at: String(row.created_at),
    attempts: Number(row.attempts),
    last_error: nullableText(row.last_error),
    next_attempt_at: nullableText(row.next_attempt_at),
  }));
}

/**
 * Deletes a job from the queue. Called after a successful Supabase upsert.
 */
export async function removeSyncQueueEntry(queueId: number): Promise<void> {
  const database = await getLocalDatabase();
  await database.run('delete from sync_queue where queue_id = ?', [queueId]);
}

/**
 * Increments the attempt counter, logs the error, and schedules the next retry.
 *
 * `nextAttemptAt` is what stops a failing entry from being hammered on every
 * single network-status change — the sync loop skips entries whose retry time
 * has not arrived yet.
 */
export async function markSyncQueueEntryFailed(
  queueId: number,
  errorMessage: string,
  nextAttemptAt: string | null = null,
): Promise<void> {
  const database = await getLocalDatabase();
  await database.run(
    'update sync_queue set attempts = attempts + 1, last_error = ?, next_attempt_at = ? where queue_id = ?',
    [errorMessage, nextAttemptAt, queueId],
  );
}

/**
 * Moves an entry out of the live queue and into quarantine, preserving its
 * payload verbatim. Called once an entry has exhausted its retries, or when it
 * depends on a record that is itself quarantined.
 *
 * This is the whole point of the dead-letter design: the main queue can always
 * drain, and no health record is ever silently dropped.
 */
export async function moveSyncQueueEntryToDeadLetter(entry: SyncQueueEntry, errorMessage: string): Promise<void> {
  const database = await getLocalDatabase();
  await database.run(
    `insert into sync_dead_letter
     (original_queue_id, operation_type, target_table, payload, created_at, attempts, last_error, failed_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.queue_id,
      entry.operation_type,
      entry.target_table,
      JSON.stringify(entry.payload),
      entry.created_at,
      entry.attempts,
      errorMessage,
      new Date().toISOString(),
    ],
  );
  await database.run('delete from sync_queue where queue_id = ?', [entry.queue_id]);
}

export async function readDeadLetterEntries(): Promise<DeadLetterEntry[]> {
  const database = await getLocalDatabase();
  const result = await database.query(
    `select dead_letter_id, original_queue_id, operation_type, target_table, payload, created_at, attempts, last_error, failed_at
     from sync_dead_letter
     order by original_queue_id asc`,
  );

  return (result.values ?? []).map((row) => ({
    dead_letter_id: Number(row.dead_letter_id),
    original_queue_id: Number(row.original_queue_id),
    operation_type: parseOperationType(String(row.operation_type)),
    target_table: parseLocalTableName(String(row.target_table)),
    payload: JSON.parse(String(row.payload)),
    created_at: String(row.created_at),
    attempts: Number(row.attempts),
    last_error: nullableText(row.last_error),
    failed_at: String(row.failed_at),
  }));
}

export async function countDeadLetterEntries(): Promise<number> {
  const database = await getLocalDatabase();
  const result = await database.query('select count(*) as total from sync_dead_letter');
  return Number(result.values?.[0]?.total ?? 0);
}

/**
 * Puts every quarantined entry back on the live queue with a fresh attempt count.
 *
 * Entries are reinserted in their original queue order so parents are pushed
 * before their children again — requeueing an individual ahead of its household
 * would just recreate the orphan the quarantine existed to prevent.
 */
export async function requeueDeadLetterEntries(): Promise<number> {
  const database = await getLocalDatabase();
  const entries = await readDeadLetterEntries();

  for (const entry of entries) {
    await database.run(
      `insert into sync_queue (operation_type, target_table, payload, created_at, attempts, last_error, next_attempt_at)
       values (?, ?, ?, ?, 0, null, null)`,
      [entry.operation_type, entry.target_table, JSON.stringify(entry.payload), entry.created_at],
    );
    await database.run('delete from sync_dead_letter where dead_letter_id = ?', [entry.dead_letter_id]);
  }

  await persistLocalDatabase();
  return entries.length;
}

// -----------------------------------------------------------------------------
// Column Maps
// -----------------------------------------------------------------------------
// Every parent table is written from two directions — the device's own forms and
// the server pull — and each direction used to carry its own hand-maintained
// column list. They drifted: the `individuals` pull was missing occupation,
// educational_attainment and philhealth_number, so a resident downloaded from
// Supabase arrived with those blank, and because the conflict clause did not
// mention them either, no later pull ever repaired it.
//
// Both statements and the value array are now generated from one list per table,
// so a column added here reaches every path or none of them.
//
// Leaf tables (health_assessments, supply_disbursements) deliberately keep
// `insert or replace`: nothing references them, so REPLACE destroys nothing and a
// column map would prevent no defect.

type ColumnDescriptor<TRow> = {
  name: string;
  value: (row: TRow) => SqlValue;
  /**
   * Refreshed from the server row when a pull lands on a record this device
   * already knows. Identity and first-seen stamps are not: the primary key is the
   * conflict target, and created_at records when this device first saw the row.
   */
  mutableOnConflict: boolean;
};

/**
 * Builds the single upsert used by every write to a table, local or pulled.
 *
 * Deliberately not `insert or replace`: with `pragma foreign_keys = on`, REPLACE
 * deletes the existing row before reinserting it, and the child tables declare
 * `on delete cascade` — so re-saving a household would silently take its members
 * and their health assessments with it, two levels deep. Where a child instead
 * has a plain FK (supply_disbursements), the cascade is *blocked* and the
 * statement throws a constraint error. `on conflict do update` edits in place and
 * leaves children untouched, which is neither.
 */
function buildUpsert<TRow>(
  table: MigratableTableName,
  conflictColumn: string,
  columns: ColumnDescriptor<TRow>[],
) {
  const statement = `insert into ${table} (${columns.map((column) => column.name).join(', ')})
   values (${columns.map(() => '?').join(', ')})
   on conflict(${conflictColumn}) do update set ${columns
     .filter((column) => column.mutableOnConflict)
     .map((column) => `${column.name} = excluded.${column.name}`)
     .join(', ')}`;

  return {
    statement,
    /** Row values in the exact order `statement` binds them. */
    values: (row: TRow): SqlValue[] => columns.map((column) => column.value(row)),
    /**
     * DEV-only check that the map still describes the real table.
     *
     * There is no test suite, so this is what catches a column added to the schema
     * but not to the map, or the reverse — the exact drift that left the individuals
     * pull silently dropping three columns for as long as it did.
     */
    verify: async (database: SQLiteDBConnection): Promise<void> => {
      if (!import.meta.env.DEV) {
        return;
      }

      const info = await database.query(`pragma table_info(${table})`);
      const tableColumns = new Set((info.values ?? []).map((row) => String(row.name)));
      const mappedColumns = new Set(columns.map((column) => column.name));

      const missingFromMap = [...tableColumns].filter((name) => !mappedColumns.has(name));
      const missingFromTable = [...mappedColumns].filter((name) => !tableColumns.has(name));

      if (missingFromMap.length > 0 || missingFromTable.length > 0) {
        logDev(`${table} column map is out of sync with the table`, { missingFromMap, missingFromTable });
      }
    },
  };
}

const individualColumns: ColumnDescriptor<Individual>[] = [
  { name: 'resident_id', value: (individual) => individual.resident_id, mutableOnConflict: false },
  // Mutable on purpose: a resident who transfers household on the server has to
  // be refiled here too, which the previous conflict clause never did.
  { name: 'household_id', value: (individual) => individual.household_id, mutableOnConflict: true },
  { name: 'first_name', value: (individual) => individual.first_name, mutableOnConflict: true },
  { name: 'middle_name', value: (individual) => individual.middle_name ?? null, mutableOnConflict: true },
  { name: 'last_name', value: (individual) => individual.last_name, mutableOnConflict: true },
  { name: 'sex', value: (individual) => individual.sex, mutableOnConflict: true },
  { name: 'birthday', value: (individual) => individual.birthday, mutableOnConflict: true },
  // SQLite has no boolean type; the table stores 0/1 under a check constraint.
  { name: 'is_household_head', value: (individual) => (individual.is_household_head ? 1 : 0), mutableOnConflict: true },
  { name: 'occupation', value: (individual) => individual.occupation ?? null, mutableOnConflict: true },
  {
    name: 'educational_attainment',
    value: (individual) => individual.educational_attainment ?? null,
    mutableOnConflict: true,
  },
  {
    name: 'is_out_of_school_youth',
    value: (individual) => (individual.is_out_of_school_youth ? 1 : 0),
    mutableOnConflict: true,
  },
  {
    name: 'is_pregnant_nursing_fp',
    value: (individual) => (individual.is_pregnant_nursing_fp ? 1 : 0),
    mutableOnConflict: true,
  },
  { name: 'philhealth_number', value: (individual) => individual.philhealth_number ?? null, mutableOnConflict: true },
  { name: 'created_at', value: (individual) => individual.created_at, mutableOnConflict: false },
  { name: 'updated_at', value: (individual) => individual.updated_at, mutableOnConflict: true },
];

const individualUpsert = buildUpsert('individuals', 'resident_id', individualColumns);

// SQLite has no array type, so these three columns hold JSON strings. The `?? []`
// matters: JSON.stringify(undefined) returns undefined rather than a string, and
// every one of these columns is `not null` — a missing array was a runtime
// constraint failure that TypeScript could not see, because JSON.stringify is
// typed as returning string. The pull path already guarded it; the save path did not.
const householdColumns: ColumnDescriptor<Household>[] = [
  { name: 'household_id', value: (household) => household.household_id, mutableOnConflict: false },
  { name: 'household_number', value: (household) => household.household_number, mutableOnConflict: true },
  { name: 'dwelling_type', value: (household) => household.dwelling_type, mutableOnConflict: true },
  { name: 'electric_service', value: (household) => household.electric_service, mutableOnConflict: true },
  { name: 'fuel_used', value: (household) => household.fuel_used, mutableOnConflict: true },
  { name: 'toilet_type', value: (household) => JSON.stringify(household.toilet_type ?? []), mutableOnConflict: true },
  { name: 'water_source', value: (household) => JSON.stringify(household.water_source ?? []), mutableOnConflict: true },
  {
    name: 'food_production',
    value: (household) => JSON.stringify(household.food_production ?? []),
    mutableOnConflict: true,
  },
  { name: 'health_status_notes', value: (household) => household.health_status_notes ?? null, mutableOnConflict: true },
  { name: 'created_at', value: (household) => household.created_at, mutableOnConflict: false },
  { name: 'updated_at', value: (household) => household.updated_at, mutableOnConflict: true },
];

const householdUpsert = buildUpsert('households', 'household_id', householdColumns);

const inventoryColumns: ColumnDescriptor<InventoryItem>[] = [
  { name: 'item_id', value: (item) => item.item_id, mutableOnConflict: false },
  { name: 'item_name', value: (item) => item.item_name, mutableOnConflict: true },
  { name: 'type', value: (item) => item.type, mutableOnConflict: true },
  { name: 'current_stock', value: (item) => item.current_stock, mutableOnConflict: true },
  { name: 'created_at', value: (item) => item.created_at, mutableOnConflict: false },
  { name: 'updated_at', value: (item) => item.updated_at, mutableOnConflict: true },
];

const inventoryUpsert = buildUpsert('inventory_items', 'item_id', inventoryColumns);

// -----------------------------------------------------------------------------
// Write Operations (The "Double-Write" Pattern)
// -----------------------------------------------------------------------------

/**
 * Writes household data to local storage and queues it for the cloud.
 */
export async function saveHouseholdLocally(household: Household, operationType: SyncOperationType = 'INSERT'): Promise<void> {
  const database = await getLocalDatabase();
  await database.run(householdUpsert.statement, householdUpsert.values(household));

  // Note: We queue the raw 'household' object here, NOT the stringified version.
  // This ensures Supabase receives actual arrays when the payload is processed.
  await enqueueSyncOperation('households', operationType, household);
  await persistLocalDatabase();
}

/**
 * Writes individual data to local storage and queues it for the cloud.
 */
export async function saveIndividualLocally(individual: Individual, operationType: SyncOperationType = 'INSERT'): Promise<void> {
  const database = await getLocalDatabase();
  await database.run(individualUpsert.statement, individualUpsert.values(individual));

  // Queue the raw object so Supabase receives actual booleans
  await enqueueSyncOperation('individuals', operationType, individual);
  await persistLocalDatabase();
}

export async function saveHealthAssessmentLocally(
  assessment: HealthAssessment,
  operationType: SyncOperationType = 'INSERT',
): Promise<void> {
  const database = await getLocalDatabase();
  await database.run(
    `insert or replace into health_assessments
     (assessment_id, resident_id, assessment_date, weight, height, bmi, nutrition_status, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      assessment.assessment_id,
      assessment.resident_id,
      assessment.assessment_date,
      assessment.weight,
      assessment.height,
      assessment.bmi,
      assessment.nutrition_status,
      assessment.created_at,
      assessment.updated_at,
    ],
  );
  await enqueueSyncOperation('health_assessments', operationType, assessment);
  await persistLocalDatabase();
}

export async function saveInventoryItemLocally(item: InventoryItem, operationType: SyncOperationType = 'INSERT'): Promise<void> {
  const database = await getLocalDatabase();
  await database.run(inventoryUpsert.statement, inventoryUpsert.values(item));
  await enqueueSyncOperation('inventory_items', operationType, item);
  await persistLocalDatabase();
}

/**
 * Reads one inventory item, or null if this device has never seen it.
 * Separate from readLocalInventoryItems() because the disbursement path needs the
 * authoritative current row, not whatever the UI snapshot last loaded.
 */
export async function readLocalInventoryItem(itemId: string): Promise<InventoryItem | null> {
  const database = await getLocalDatabase();
  const result = await database.query('select * from inventory_items where item_id = ?', [itemId]);
  const row = result.values?.[0];

  return row ? ({ ...row, current_stock: Number(row.current_stock) } as InventoryItem) : null;
}

/**
 * Records a supply release and moves the stock it came out of, as one call.
 *
 * The two used to be separate: this wrote the ledger row and nothing decremented
 * `current_stock`, so the quantity check in the form was reading a figure only the
 * admin surface could ever change.
 *
 * Only the disbursement is queued. The stock move is applied locally — a BHW
 * offline for three days has to see what is actually left — but it is deliberately
 * *not* pushed. Two reasons, and either alone would settle it:
 *
 * - `inventory_items` is admin-only for writes under the purok RLS, so a queued
 *   stock update from a phone would be rejected every pass and quarantine.
 * - An absolute stock number is the wrong thing to send anyway. Two devices
 *   releasing offline from the same base would each push their own total and the
 *   later one would win, silently erasing the other's release.
 *
 * Centrally the decrement rides on the ledger row instead: an `after insert`
 * trigger on `supply_disbursements` (202608200002) subtracts the quantity from
 * the item. That is relative, so concurrent offline releases add up rather than
 * overwrite, and it does not fire on the `on conflict do update` path a replayed
 * queue entry takes — so a retried push cannot decrement twice. The next pull
 * brings the reconciled figure back down to the device.
 */
export async function saveSupplyDisbursementLocally(
  disbursement: SupplyDisbursement,
  operationType: SyncOperationType = 'INSERT',
): Promise<void> {
  const database = await getLocalDatabase();

  // Only a new release moves stock. An edit to an existing log row would have to
  // reverse the original quantity first, and nothing in the app offers that yet.
  const item = operationType === 'INSERT' ? await readLocalInventoryItem(disbursement.item_id) : null;

  if (operationType === 'INSERT') {
    if (!item) {
      throw new Error('That supply item is not on this device yet. Sync before releasing it.');
    }

    // `check (current_stock >= 0)` on both SQLite and Postgres is the real
    // backstop. This is here so the BHW reads a sentence instead of a constraint
    // violation, and so the reason names the number they are short by.
    if (disbursement.quantity > item.current_stock) {
      throw new Error(
        `Only ${item.current_stock} of ${item.item_name} left on this device — ${disbursement.quantity} cannot be released.`,
      );
    }
  }

  await database.run(
    `insert or replace into supply_disbursements
     (log_id, item_id, resident_id, disbursement_date, quantity, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?)`,
    [
      disbursement.log_id,
      disbursement.item_id,
      disbursement.resident_id,
      disbursement.disbursement_date,
      disbursement.quantity,
      disbursement.created_at,
      disbursement.updated_at,
    ],
  );
  await enqueueSyncOperation('supply_disbursements', operationType, disbursement);

  if (item) {
    // Local only, and not enqueued — see the note above. `updated_at` is left on
    // the item's own value rather than stamped forward, so the pull that brings
    // back the server's reconciled figure is not mistaken for stale data.
    const movedStock: InventoryItem = {
      ...item,
      current_stock: item.current_stock - disbursement.quantity,
    };

    await database.run(inventoryUpsert.statement, inventoryUpsert.values(movedStock));
  }

  await persistLocalDatabase();
}


export async function getHouseholdCount(): Promise<number> {
  const db = await initializeLocalDatabase();
  const result = await db.query('SELECT COUNT(*) as total FROM households');
  return result.values?.[0]?.total || 0;
}

export async function getIndividualCount(options?: Pick<PaginatedQuery, 'searchQuery'>): Promise<number> {
  const db = await initializeLocalDatabase();
  const search = buildIndividualSearch(options?.searchQuery);

  // Mirrors the FROM/WHERE of readLocalIndividuals so a filtered count always
  // matches the rows that query would return.
  const result = await db.query(
    `SELECT COUNT(*) as total
     FROM individuals i
     LEFT JOIN households h ON i.household_id = h.household_id${search.clause}`,
    search.params,
  );

  return result.values?.[0]?.total || 0;
}

/**
 * Builds the shared search predicate for individual lookups.
 * Kept in one place so the row query and the count query cannot drift apart —
 * if they do, the pager offers pages the filtered result set does not have.
 */
function buildIndividualSearch(searchQuery?: string): { clause: string; params: SqlValue[] } {
  const term = searchQuery?.trim();

  if (!term) {
    return { clause: '', params: [] };
  }

  // Escape LIKE wildcards so a typed % or _ matches literally instead of
  // silently widening the search.
  const pattern = `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

  return {
    clause: ` WHERE (i.first_name LIKE ? ESCAPE '\\'
                  OR i.middle_name LIKE ? ESCAPE '\\'
                  OR i.last_name LIKE ? ESCAPE '\\'
                  OR h.household_number LIKE ? ESCAPE '\\')`,
    params: [pattern, pattern, pattern, pattern],
  };
}

// -----------------------------------------------------------------------------
// Read Operations (Loading data into the React UI)
// -----------------------------------------------------------------------------

export async function readLocalIndividuals(options?: PaginatedQuery): Promise<Individual[]> {
  const db = await initializeLocalDatabase();

  // Use a LEFT JOIN to pull the readable household_number alongside the individual's data
  const search = buildIndividualSearch(options?.searchQuery);
  let query = `
    SELECT i.*, h.household_number
    FROM individuals i
    LEFT JOIN households h ON i.household_id = h.household_id${search.clause}
  `;
  const params: SqlValue[] = [...search.params];

  query += ' ORDER BY i.last_name ASC, i.first_name ASC';

  // SQLite rejects OFFSET without LIMIT, so an offset-only call needs a limit
  // supplied for it (-1 means "no limit" in SQLite).
  if (options?.limit !== undefined || options?.offset !== undefined) {
    query += ' LIMIT ?';
    params.push(options.limit ?? -1);
  }
  if (options?.offset !== undefined) {
    query += ' OFFSET ?';
    params.push(options.offset);
  }

  const result = await db.query(query, params);
  
  return (result.values || []).map((row) => ({
    ...row,
    is_household_head: row.is_household_head === 1,
    is_out_of_school_youth: row.is_out_of_school_youth === 1,
    is_pregnant_nursing_fp: row.is_pregnant_nursing_fp === 1,
  })) as Individual[];
}

export async function readLocalHouseholds(options?: PaginatedQuery): Promise<Household[]> {
  const db = await initializeLocalDatabase();
  let query = 'SELECT * FROM households';
  const params: SqlValue[] = [];

  if (options?.searchQuery) {
    const searchTerm = `%${options.searchQuery.trim()}%`;
    query += ' WHERE household_number LIKE ?';
    params.push(searchTerm);
  }

  query += ' ORDER BY created_at DESC';

  // As above: SQLite rejects OFFSET without a preceding LIMIT.
  if (options?.limit !== undefined || options?.offset !== undefined) {
    query += ' LIMIT ?';
    params.push(options.limit ?? -1);
  }
  if (options?.offset !== undefined) {
    query += ' OFFSET ?';
    params.push(options.offset);
  }

  const result = await db.query(query, params);

  // Translate SQLite JSON strings back into JavaScript arrays
  return (result.values || []).map((row) => ({
    ...row,
    toilet_type: JSON.parse(row.toilet_type || '[]'),
    water_source: JSON.parse(row.water_source || '[]'),
    food_production: JSON.parse(row.food_production || '[]'),
  })) as Household[];
}

export async function readLocalHealthAssessments(residentId?: string): Promise<HealthAssessment[]> {
  const database = await getLocalDatabase();
  const query = residentId
    ? {
        statement: 'select * from health_assessments where resident_id = ? order by assessment_date desc',
        values: [residentId],
      }
    : {
        statement: 'select * from health_assessments order by assessment_date desc',
        values: [],
      };
  const result = await database.query(query.statement, query.values);
  
  return (result.values ?? []).map((row) => ({
    ...row,
    weight: Number(row.weight),
    height: Number(row.height),
    bmi: Number(row.bmi),
  })) as HealthAssessment[];
}

export async function readLocalInventoryItems(): Promise<InventoryItem[]> {
  const database = await getLocalDatabase();
  const result = await database.query('select * from inventory_items order by item_name asc');
  
  return (result.values ?? []).map((row) => ({
    ...row,
    current_stock: Number(row.current_stock),
  })) as InventoryItem[];
}

export async function readLocalSupplyDisbursements(residentId?: string): Promise<SupplyDisbursement[]> {
  const database = await getLocalDatabase();
  const query = residentId
    ? {
        statement: 'select * from supply_disbursements where resident_id = ? order by disbursement_date desc',
        values: [residentId],
      }
    : {
        statement: 'select * from supply_disbursements order by disbursement_date desc',
        values: [],
      };
  const result = await database.query(query.statement, query.values);
  
  return (result.values ?? []).map((row) => ({
    ...row,
    quantity: Number(row.quantity),
  })) as SupplyDisbursement[];
}

// -----------------------------------------------------------------------------
// Parsers & Type Guards
// -----------------------------------------------------------------------------

/**
 * Normalizes a nullable SQLite text column into `string | null`.
 * A column added by `alter table` reads back as undefined on rows written before
 * the upgrade, so undefined has to collapse to null alongside a real NULL.
 */
function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/**
 * Validates that an untyped string is a legitimate SyncOperationType.
 */
function parseOperationType(value: string): SyncOperationType {
  if (value === 'INSERT' || value === 'UPDATE') {
    return value;
  }

  throw new Error(`Unsupported sync operation: ${value}`);
}

/**
 * Validates that an untyped string matches an actual SQLite table name.
 */
function parseLocalTableName(value: string): LocalTableName {
  if (
    value === 'households' ||
    value === 'individuals' ||
    value === 'health_assessments' ||
    value === 'inventory_items' ||
    value === 'supply_disbursements'
  ) {
    return value;
  }

  throw new Error(`Unsupported sync table: ${value}`);
}

/**
 * Normalizes undefined values to null for safe insertion into SQLite queries.
 */
export function toSqlValue(value: string | number | null | undefined): SqlValue {
  return value ?? null;
}

// -----------------------------------------------------------------------------
//  DATA FETCHING CODE
// -----------------------------------------------------------------------------

export async function pullInventoryFromServer(cloudItems: InventoryItem[]): Promise<void> {
  if (!cloudItems.length) return; // Skip if nothing to pull
  const db = await initializeLocalDatabase();

  // Same statement and same value order as the local write path — see the column
  // maps above for why these are no longer written out twice.
  const values = cloudItems.map((item) => inventoryUpsert.values(item));

  try {
    await db.executeSet([{ statement: inventoryUpsert.statement, values }]);
    await persistLocalDatabase();
  } catch (error) {
    console.error('Failed to pull inventory into SQLite:', error);
    throw error;
  }
}

export async function pullHouseholdsFromServer(cloudHouseholds: Household[]): Promise<void> {
  if (!cloudHouseholds.length) return;
  const db = await initializeLocalDatabase();
  
  // Same statement and same value order as the local write path — see the column
  // maps above for why these are no longer written out twice.
  const values = cloudHouseholds.map((household) => householdUpsert.values(household));

  try {
    await db.executeSet([{ statement: householdUpsert.statement, values }]);
    await persistLocalDatabase();
  } catch (error) {
    console.error('Failed to pull households into SQLite:', error);
    throw error;
  }
}

export async function pullIndividualsFromServer(cloudIndividuals: Individual[]): Promise<void> {
  if (!cloudIndividuals.length) return;
  const db = await initializeLocalDatabase();

  // Same statement and same value order as the local write path — see the column
  // maps above for why these are no longer written out twice.
  const values = cloudIndividuals.map((individual) => individualUpsert.values(individual));

  try {
    await db.executeSet([{ statement: individualUpsert.statement, values }]);
    await persistLocalDatabase();
  } catch (error) {
    console.error('Failed to pull individuals into SQLite:', error);
    throw error;
  }
}