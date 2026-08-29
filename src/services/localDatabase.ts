import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import { logDev } from '../lib/utils';
import { generateDatabasePassphrase } from '../lib/secureStorage';
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
  /** Individuals only: reads exactly one resident. */
  residentId?: string;
  /** Individuals only: restricts the read to one household's members. */
  householdId?: string;
  /** Individuals only: includes members who moved out, died or transferred. Off by default. */
  includeFormer?: boolean;
};

// Defines the exact tables that exist in our local SQLite database.
export type LocalTableName =
  | 'households'
  | 'individuals'
  | 'health_assessments'
  | 'inventory_items'
  | 'supply_disbursements';

// Mirror no Supabase table and are never pushed — kept out of LocalTableName but reachable by column upgrades.
export type LocalBookkeepingTableName = 'sync_queue' | 'sync_dead_letter';

type MigratableTableName = LocalTableName | LocalBookkeepingTableName;

export type SyncOperationType = 'INSERT' | 'UPDATE';

/** Insert payload shape per table, for type-safe sync_queue writes. */
export type LocalInsertPayloadByTable = {
  households: HouseholdInsert;
  individuals: IndividualInsert;
  health_assessments: HealthAssessmentInsert;
  inventory_items: InventoryItemInsert;
  supply_disbursements: SupplyDisbursementInsert;
};

/** Update payload per table; Pick<> forces the primary key to be present. */
export type LocalUpdatePayloadByTable = {
  households: HouseholdUpdate & Pick<Household, 'household_id'>;
  individuals: IndividualUpdate & Pick<Individual, 'resident_id'>;
  health_assessments: HealthAssessmentUpdate & Pick<HealthAssessment, 'assessment_id'>;
  inventory_items: InventoryItemUpdate & Pick<InventoryItem, 'item_id'>;
  supply_disbursements: SupplyDisbursementUpdate & Pick<SupplyDisbursement, 'log_id'>;
};

export type SyncPayload<TTable extends LocalTableName, TOperation extends SyncOperationType> =
  TOperation extends 'INSERT' ? LocalInsertPayloadByTable[TTable] : LocalUpdatePayloadByTable[TTable];

/** One row of the local sync_queue — the staging area for pushes to Supabase. */
export type SyncQueueEntry<TTable extends LocalTableName = LocalTableName> = {
  queue_id: number;
  operation_type: SyncOperationType;
  target_table: TTable;
  payload: LocalInsertPayloadByTable[TTable] | LocalUpdatePayloadByTable[TTable];
  created_at: string;
  attempts: number; // Tracks retry counts if the network fails
  last_error: string | null;
  // Earliest retry time, null means "now". Persisted, not in-memory — the app is
  // killed constantly in the field and would reset the backoff on cold start.
  next_attempt_at: string | null;
};

// A queue entry that exhausted its retries. Preserved in full so it can be requeued once the cause is fixed.
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
  // toilet_type/water_source/food_production are arrays in Supabase; stored as JSON text here (SQLite has no array type).
  `create table if not exists households (
    household_id text primary key,
    household_number text not null,
    toilet_type text not null,
    water_source text not null,
    food_production text not null,
    health_status_notes text,
    created_at text not null,
    updated_at text not null
  )`,
  
  // Booleans stored as 0/1 integers — SQLite has no boolean type.
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
    status text not null default 'active' check (status in ('active', 'moved_out', 'deceased', 'transferred')),
    status_changed_on text,
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

  // Sync Dead Letter Table — exhausted retries, moved aside to keep the main queue draining. Quarantined, never discarded.
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

// Columns added after first release — `create table if not exists` never adds them
// to an existing install, so each has to be added explicitly here.
const columnUpgrades: { table: MigratableTableName; column: string; definition: string }[] = [
  { table: 'individuals', column: 'middle_name', definition: 'text' },
  // Retry backoff column — absent on devices installed before it existed.
  { table: 'sync_queue', column: 'next_attempt_at', definition: 'text' },
  // Who last wrote the row (updated_at already carries the when).
  { table: 'individuals', column: 'updated_by', definition: 'text' },
  // Duplicate-override provenance. No foreign key on purpose — the referenced
  // record may not be pulled to this device yet.
  { table: 'individuals', column: 'duplicate_override_of', definition: 'text' },
  { table: 'individuals', column: 'duplicate_override_reason', definition: 'text' },
  { table: 'individuals', column: 'duplicate_override_by', definition: 'text' },
  { table: 'individuals', column: 'duplicate_override_at', definition: 'text' },
  // Relation to household head. Nullable and unconstrained — the central table already enforces the check.
  { table: 'individuals', column: 'relationship_to_head', definition: 'text' },
  // Whether the member is still in the household. Every row that predates the
  // column is active, which the default supplies; SQLite allows `not null` here
  // only because the default is a constant.
  { table: 'individuals', column: 'status', definition: "text not null default 'active'" },
  { table: 'individuals', column: 'status_changed_on', definition: 'text' },
];

/**
 * Columns dropped after release. A device that predates the drop still carries them,
 * and they are `not null` with no default, so an insert that no longer supplies one
 * fails on that device alone — the schema has to actually shrink, not just stop being
 * written to. Idempotent via `pragma table_info`, same as the additions above.
 */
const columnRemovals: { table: MigratableTableName; column: string }[] = [
  // Dwelling, electricity and cooking fuel. Removed on a BHW's reading that none of
  // the three is health data, after the form had been filling them with fixed
  // placeholders to satisfy the `not null` — so nothing recorded here was ever asked.
  { table: 'households', column: 'dwelling_type' },
  { table: 'households', column: 'electric_service' },
  { table: 'households', column: 'fuel_used' },
];

/**
 * Brings this device's tables up to the current column list: adds what it
 * predates, then drops what the schema has since removed. Additions run first,
 * so a column that was added and later removed does not survive on a device that
 * skipped both releases.
 *
 * `pragma table_info` is read once per table rather than once per column — this
 * runs on every app open, on a phone.
 */
async function applyColumnChanges(database: SQLiteDBConnection): Promise<void> {
  const tables = new Set([...columnUpgrades, ...columnRemovals].map((change) => change.table));
  const present = new Map<MigratableTableName, Set<string>>();

  for (const table of tables) {
    const info = await database.query(`pragma table_info(${table})`);
    present.set(table, new Set((info.values ?? []).map((row) => String(row.name))));
  }

  for (const upgrade of columnUpgrades) {
    if (!present.get(upgrade.table)?.has(upgrade.column)) {
      await database.execute(`alter table ${upgrade.table} add column ${upgrade.column} ${upgrade.definition}`);
    }
  }

  for (const removal of columnRemovals) {
    if (present.get(removal.table)?.has(removal.column)) {
      await database.execute(`alter table ${removal.table} drop column ${removal.column}`);
    }
  }
}

/** Bootstraps the local SQLite connection and runs all migrations. */
export async function initializeLocalDatabase(): Promise<SQLiteDBConnection> {
  if (localDatabase) {
    return localDatabase;
  }

  // Cache the in-flight promise, not just the connection — concurrent callers
  // (refreshLocalData, useBackgroundSync) would otherwise each open their own connection.
  if (!localDatabaseSetup) {
    localDatabaseSetup = openLocalDatabase().catch((error: unknown) => {
      localDatabaseSetup = null; // allow a later call to retry after a failed open
      throw error;
    });
  }

  return localDatabaseSetup;
}

/**
 * Which SQLCipher mode to open with, read from stored fact rather than guessed:
 * web has no keystore (`no-encryption`); a native device with no secret yet
 * generates one and encrypts in place (`encryption`, one-time only); otherwise `secret`.
 */
async function prepareEncryption(): Promise<'no-encryption' | 'encryption' | 'secret'> {
  if (isWebPlatform) {
    return 'no-encryption';
  }

  const stored = await sqlite.isSecretStored();

  if (stored.result) {
    return 'secret';
  }

  await sqlite.setEncryptionSecret(generateDatabasePassphrase());
  logDev('Local database encrypted for the first time on this device');
  return 'encryption';
}

async function openLocalDatabase(): Promise<SQLiteDBConnection> {
  // Web only: injects the jeep-sqlite emulator element, timed to avoid Vite HMR races.
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
      // A Vite HMR reload can throw "already initialized" here — safe to ignore.
      console.warn('SQLite Web Store warning (safe to ignore during dev):', error);
    }
  }

  // Create & open connection
  const encryption = await prepareEncryption();
  const database = await sqlite.createConnection(
    'mabisa_local',
    encryption !== 'no-encryption',
    encryption,
    1,
    false,
  );
  await database.open();
  await database.execute('pragma foreign_keys = on');

  for (const statement of migrations) {
    await database.execute(statement);
  }

  // Before verify(), which reports a device still holding a dropped column.
  await applyColumnChanges(database);
  await householdUpsert.verify(database);
  await individualUpsert.verify(database);
  await inventoryUpsert.verify(database);

  localDatabase = database;
  return database;
}

/**
 * Flushes the database to IndexedDB. Web builds hold it in memory otherwise and
 * lose everything on reload; native platforms persist on write, so this is a no-op there.
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

/** Stringifies the payload and queues it — called right after the local write ("double-write"). */
export async function enqueueSyncOperation<TTable extends LocalTableName, TOperation extends SyncOperationType>(
  targetTable: TTable,
  operationType: TOperation,
  payload: SyncPayload<TTable, TOperation>,
): Promise<void> {
  const database = await initializeLocalDatabase();
  await database.run(
    `insert into sync_queue (operation_type, target_table, payload, created_at, attempts, last_error)
     values (?, ?, ?, ?, 0, null)`,
    [operationType, targetTable, JSON.stringify(payload), new Date().toISOString()],
  );
}

/** The columns a queue row and a dead-letter row hold in common — the quarantined copy is the same operation, preserved. */
function parseQueuedOperation(row: Record<string, unknown>) {
  return {
    operation_type: parseOperationType(String(row.operation_type)),
    target_table: parseLocalTableName(String(row.target_table)),
    payload: JSON.parse(String(row.payload)) as SyncQueueEntry['payload'],
    created_at: String(row.created_at),
    attempts: Number(row.attempts),
    last_error: nullableText(row.last_error),
  };
}

/** All pending jobs in chronological order — what the sync loop drains. */
export async function readSyncQueue(): Promise<SyncQueueEntry[]> {
  const database = await initializeLocalDatabase();
  const result = await database.query(
    `select queue_id, operation_type, target_table, payload, created_at, attempts, last_error, next_attempt_at
     from sync_queue
     order by queue_id asc`,
  );

  return (result.values ?? []).map((row) => ({
    ...parseQueuedOperation(row),
    queue_id: Number(row.queue_id),
    next_attempt_at: nullableText(row.next_attempt_at),
  }));
}

/** Deletes a job from the queue after a successful push. */
export async function removeSyncQueueEntry(queueId: number): Promise<void> {
  const database = await initializeLocalDatabase();
  await database.run('delete from sync_queue where queue_id = ?', [queueId]);
}

/**
 * Increments attempts, logs the error, and schedules the next retry —
 * `nextAttemptAt` stops a failing entry being hammered on every network flap.
 */
export async function markSyncQueueEntryFailed(
  queueId: number,
  errorMessage: string,
  nextAttemptAt: string | null = null,
): Promise<void> {
  const database = await initializeLocalDatabase();
  await database.run(
    'update sync_queue set attempts = attempts + 1, last_error = ?, next_attempt_at = ? where queue_id = ?',
    [errorMessage, nextAttemptAt, queueId],
  );
}

/**
 * Moves an entry into quarantine, payload preserved verbatim, so the main queue
 * can keep draining and no health record is ever silently dropped.
 */
export async function moveSyncQueueEntryToDeadLetter(entry: SyncQueueEntry, errorMessage: string): Promise<void> {
  const database = await initializeLocalDatabase();
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
  const database = await initializeLocalDatabase();
  const result = await database.query(
    `select dead_letter_id, original_queue_id, operation_type, target_table, payload, created_at, attempts, last_error, failed_at
     from sync_dead_letter
     order by original_queue_id asc`,
  );

  return (result.values ?? []).map((row) => ({
    ...parseQueuedOperation(row),
    dead_letter_id: Number(row.dead_letter_id),
    original_queue_id: Number(row.original_queue_id),
    failed_at: String(row.failed_at),
  }));
}

/** Puts every quarantined entry back on the queue, in original order so a parent is pushed before its children again. */
export async function requeueDeadLetterEntries(): Promise<number> {
  const database = await initializeLocalDatabase();
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
// Column Maps — one list per table drives both the local write and the server-pull
// upsert, so a column added here reaches every path or none of them. Leaf tables
// (health_assessments, supply_disbursements) skip this and keep `insert or replace`
// since nothing references them.
// -----------------------------------------------------------------------------

type ColumnDescriptor<TRow> = {
  name: string;
  value: (row: TRow) => SqlValue;
  /** Refreshed on conflict — false for the primary key and created_at, which must not change. */
  mutableOnConflict: boolean;
};

/**
 * Builds the upsert used by every write to a table, local or pulled. Not
 * `insert or replace`: with cascading FKs, REPLACE would delete-then-reinsert the
 * row and take its children with it. `on conflict do update` edits in place instead.
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
    /** DEV-only check that this column list still matches the real table schema. */
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
  // Mutable — a resident who transfers household must be refiled here too.
  { name: 'household_id', value: (individual) => individual.household_id, mutableOnConflict: true },
  { name: 'first_name', value: (individual) => individual.first_name, mutableOnConflict: true },
  { name: 'middle_name', value: (individual) => individual.middle_name ?? null, mutableOnConflict: true },
  { name: 'last_name', value: (individual) => individual.last_name, mutableOnConflict: true },
  { name: 'sex', value: (individual) => individual.sex, mutableOnConflict: true },
  { name: 'birthday', value: (individual) => individual.birthday, mutableOnConflict: true },
  // SQLite has no boolean type; the table stores 0/1 under a check constraint.
  { name: 'is_household_head', value: (individual) => (individual.is_household_head ? 1 : 0), mutableOnConflict: true },
  {
    name: 'relationship_to_head',
    value: (individual) => individual.relationship_to_head ?? null,
    mutableOnConflict: true,
  },
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
  { name: 'status', value: (individual) => individual.status ?? 'active', mutableOnConflict: true },
  { name: 'status_changed_on', value: (individual) => individual.status_changed_on ?? null, mutableOnConflict: true },
  { name: 'created_at', value: (individual) => individual.created_at, mutableOnConflict: false },
  { name: 'updated_at', value: (individual) => individual.updated_at, mutableOnConflict: true },
  { name: 'updated_by', value: (individual) => individual.updated_by ?? null, mutableOnConflict: true },
  // Mutable — a pull must be able to bring an override recorded on another device down to this one.
  {
    name: 'duplicate_override_of',
    value: (individual) => individual.duplicate_override_of ?? null,
    mutableOnConflict: true,
  },
  {
    name: 'duplicate_override_reason',
    value: (individual) => individual.duplicate_override_reason ?? null,
    mutableOnConflict: true,
  },
  {
    name: 'duplicate_override_by',
    value: (individual) => individual.duplicate_override_by ?? null,
    mutableOnConflict: true,
  },
  {
    name: 'duplicate_override_at',
    value: (individual) => individual.duplicate_override_at ?? null,
    mutableOnConflict: true,
  },
];

const individualUpsert = buildUpsert('individuals', 'resident_id', individualColumns);

// JSON-string columns (no array type in SQLite). `?? []` matters: these columns
// are `not null`, and `JSON.stringify(undefined)` returns undefined, not a string.
const householdColumns: ColumnDescriptor<Household>[] = [
  { name: 'household_id', value: (household) => household.household_id, mutableOnConflict: false },
  { name: 'household_number', value: (household) => household.household_number, mutableOnConflict: true },
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

/** Writes household data to local storage and queues it for the cloud. */
export async function saveHouseholdLocally(household: Household, operationType: SyncOperationType = 'INSERT'): Promise<void> {
  const database = await initializeLocalDatabase();
  await database.run(householdUpsert.statement, householdUpsert.values(household));

  // Queues the raw object, not the JSON string, so Supabase gets real arrays.
  await enqueueSyncOperation('households', operationType, household);
  await persistLocalDatabase();
}

/** Writes individual data to local storage and queues it for the cloud. */
export async function saveIndividualLocally(individual: Individual, operationType: SyncOperationType = 'INSERT'): Promise<void> {
  const database = await initializeLocalDatabase();
  await database.run(individualUpsert.statement, individualUpsert.values(individual));

  // household_number is joined in on read but lives on `households`, not
  // `individuals` — Supabase rejects the row over the unknown column if it rides along.
  const syncable = { ...individual };
  delete syncable.household_number;

  // Queue the raw object so Supabase receives actual booleans
  await enqueueSyncOperation('individuals', operationType, syncable);
  await persistLocalDatabase();
}

/**
 * The two leaf tables keep `insert or replace` — nothing references them, so REPLACE
 * cascades into nothing. Both the local write and the server pull go through these,
 * so the column list cannot drift between the two the way it can when each has its own.
 */
const assessmentInsert = {
  statement: `insert or replace into health_assessments
     (assessment_id, resident_id, assessment_date, weight, height, bmi, nutrition_status, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  values: (assessment: HealthAssessment): SqlValue[] => [
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
};

const disbursementInsert = {
  statement: `insert or replace into supply_disbursements
     (log_id, item_id, resident_id, disbursement_date, quantity, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?)`,
  values: (disbursement: SupplyDisbursement): SqlValue[] => [
    disbursement.log_id,
    disbursement.item_id,
    disbursement.resident_id,
    disbursement.disbursement_date,
    disbursement.quantity,
    disbursement.created_at,
    disbursement.updated_at,
  ],
};

export async function saveHealthAssessmentLocally(
  assessment: HealthAssessment,
  operationType: SyncOperationType = 'INSERT',
): Promise<void> {
  const database = await initializeLocalDatabase();
  await database.run(assessmentInsert.statement, assessmentInsert.values(assessment));
  await enqueueSyncOperation('health_assessments', operationType, assessment);
  await persistLocalDatabase();
}

/**
 * One inventory item, or null. Separate from readLocalInventoryItems() — the
 * disbursement path needs the current row, not a stale UI snapshot.
 */
export async function readLocalInventoryItem(itemId: string): Promise<InventoryItem | null> {
  const database = await initializeLocalDatabase();
  const result = await database.query('select * from inventory_items where item_id = ?', [itemId]);
  const row = result.values?.[0];

  return row ? ({ ...row, current_stock: Number(row.current_stock) } as InventoryItem) : null;
}

/**
 * Records a supply release and decrements the device's local stock in one call.
 *
 * Only the disbursement is queued; the decrement stays local and is never pushed —
 * `inventory_items` has no BHW write policy, and an absolute total would let two
 * offline devices overwrite each other's release. The server reconciles the real
 * figure live via the `bhw_item_stock` view (allocations minus disbursements),
 * which the next pull brings back down.
 */
export async function saveSupplyDisbursementLocally(
  disbursement: SupplyDisbursement,
  operationType: SyncOperationType = 'INSERT',
): Promise<void> {
  const database = await initializeLocalDatabase();

  // Only a new release moves stock — editing an existing log has no reversal path yet.
  const item = operationType === 'INSERT' ? await readLocalInventoryItem(disbursement.item_id) : null;

  if (operationType === 'INSERT') {
    if (!item) {
      throw new Error('That supply item is not on this device yet. Sync before releasing it.');
    }

    // The real backstop is the DB check constraint — this just gives a readable message first.
    if (disbursement.quantity > item.current_stock) {
      throw new Error(
        `Only ${item.current_stock} of ${item.item_name} left on this device — ${disbursement.quantity} cannot be released.`,
      );
    }
  }

  await database.run(disbursementInsert.statement, disbursementInsert.values(disbursement));
  await enqueueSyncOperation('supply_disbursements', operationType, disbursement);

  if (item) {
    // Local only, not enqueued. `updated_at` stays on the item's own value so the
    // server's reconciled figure isn't mistaken for stale data on the next pull.
    const movedStock: InventoryItem = {
      ...item,
      current_stock: item.current_stock - disbursement.quantity,
    };

    await database.run(inventoryUpsert.statement, inventoryUpsert.values(movedStock));
  }

  await persistLocalDatabase();
}


/**
 * How many rows a table holds. The dashboard and the login screen only ever want
 * the number: reading the rows meant parsing a purok's whole assessment and
 * release history on every refresh, which runs every 30 seconds while any queue
 * entry is waiting out a backoff.
 */
export async function countRows(table: MigratableTableName): Promise<number> {
  const db = await initializeLocalDatabase();
  const result = await db.query(`select count(*) as total from ${table}`);

  return Number(result.values?.[0]?.total ?? 0);
}

export async function getIndividualCount(options?: IndividualFilter): Promise<number> {
  const db = await initializeLocalDatabase();
  const filter = buildIndividualFilter(options);

  // Mirrors the FROM/WHERE of readLocalIndividuals so a filtered count always
  // matches the rows that query would return.
  const result = await db.query(
    `SELECT COUNT(*) as total
     FROM individuals i
     LEFT JOIN households h ON i.household_id = h.household_id${filter.clause}`,
    filter.params,
  );

  return result.values?.[0]?.total || 0;
}

/** Shared search predicate for individual lookups — one place so the row and count queries can't drift apart. */
/** The filters both the individual read and its count apply, built once so the two cannot drift. */
type IndividualFilter = Pick<PaginatedQuery, 'searchQuery' | 'residentId' | 'householdId' | 'includeFormer'>;

function buildIndividualFilter(options?: IndividualFilter): { clause: string; params: SqlValue[] } {
  const conditions: string[] = [];
  const params: SqlValue[] = [];
  const term = options?.searchQuery?.trim();

  if (term) {
    // Escape LIKE wildcards so a typed % or _ matches literally instead of
    // silently widening the search.
    const pattern = `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

    conditions.push(`(i.first_name LIKE ? ESCAPE '\\'
                  OR i.middle_name LIKE ? ESCAPE '\\'
                  OR i.last_name LIKE ? ESCAPE '\\'
                  OR h.household_number LIKE ? ESCAPE '\\')`);
    params.push(pattern, pattern, pattern, pattern);
  }

  if (options?.residentId) {
    conditions.push('i.resident_id = ?');
    params.push(options.residentId);
  }

  if (options?.householdId) {
    conditions.push('i.household_id = ?');
    params.push(options.householdId);
  }

  // A member who moved out, died or transferred is off the lists by default —
  // that is what marking her was for. Her row, and everything hanging off it,
  // is untouched and still opens by id.
  if (!options?.includeFormer) {
    conditions.push("i.status = 'active'");
  }

  return { clause: conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '', params };
}

// -----------------------------------------------------------------------------
// Read Operations (Loading data into the React UI)
// -----------------------------------------------------------------------------

/**
 * The LIMIT/OFFSET tail of a paginated read. SQLite rejects OFFSET without a
 * preceding LIMIT, so an offset-only call gets one supplied for it (-1 is
 * SQLite's "no limit").
 */
/** An optional single-column WHERE — the two leaf histories read either one resident's or everyone's. */
function scopedTo(column: string, value?: string): { clause: string; params: SqlValue[] } {
  return value ? { clause: ` where ${column} = ?`, params: [value] } : { clause: '', params: [] };
}

function pageBounds(options?: Pick<PaginatedQuery, 'limit' | 'offset'>): { clause: string; params: SqlValue[] } {
  if (options?.limit === undefined && options?.offset === undefined) {
    return { clause: '', params: [] };
  }

  const params: SqlValue[] = [options.limit ?? -1];
  let clause = ' LIMIT ?';

  if (options.offset !== undefined) {
    clause += ' OFFSET ?';
    params.push(options.offset);
  }

  return { clause, params };
}

export async function readLocalIndividuals(options?: PaginatedQuery): Promise<Individual[]> {
  const db = await initializeLocalDatabase();

  // Use a LEFT JOIN to pull the readable household_number alongside the individual's data
  const filter = buildIndividualFilter(options);
  let query = `
    SELECT i.*, h.household_number
    FROM individuals i
    LEFT JOIN households h ON i.household_id = h.household_id${filter.clause}
  `;
  const params: SqlValue[] = [...filter.params];

  query += ' ORDER BY i.last_name ASC, i.first_name ASC';

  const page = pageBounds(options);
  const result = await db.query(query + page.clause, [...params, ...page.params]);
  
  return (result.values || []).map((row) => ({
    ...row,
    is_household_head: row.is_household_head === 1,
    is_out_of_school_youth: row.is_out_of_school_youth === 1,
    is_pregnant_nursing_fp: row.is_pregnant_nursing_fp === 1,
  })) as Individual[];
}

/**
 * One resident by id, or null if this device has never seen them. `includeFormer`
 * is on: a member marked moved out by mistake has to stay reachable by id, which
 * is the only way back to her record.
 */
export async function readLocalIndividual(residentId: string): Promise<Individual | null> {
  const [person] = await readLocalIndividuals({ residentId, includeFormer: true, limit: 1 });

  return person ?? null;
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

  const page = pageBounds(options);
  const result = await db.query(query + page.clause, [...params, ...page.params]);

  // Translate SQLite JSON strings back into JavaScript arrays
  return (result.values || []).map((row) => ({
    ...row,
    toilet_type: JSON.parse(row.toilet_type || '[]'),
    water_source: JSON.parse(row.water_source || '[]'),
    food_production: JSON.parse(row.food_production || '[]'),
  })) as Household[];
}

/** `limit` exists for the dashboard, which shows three rows out of a purok's whole history. */
export async function readLocalHealthAssessments(residentId?: string, limit?: number): Promise<HealthAssessment[]> {
  const database = await initializeLocalDatabase();
  const scope = scopedTo('resident_id', residentId);
  const page = pageBounds({ limit });
  const result = await database.query(
    `select * from health_assessments${scope.clause} order by assessment_date desc${page.clause}`,
    [...scope.params, ...page.params],
  );
  
  return (result.values ?? []).map((row) => ({
    ...row,
    weight: Number(row.weight),
    height: Number(row.height),
    bmi: Number(row.bmi),
  })) as HealthAssessment[];
}

export async function readLocalInventoryItems(): Promise<InventoryItem[]> {
  const database = await initializeLocalDatabase();
  const result = await database.query('select * from inventory_items order by item_name asc');
  
  return (result.values ?? []).map((row) => ({
    ...row,
    current_stock: Number(row.current_stock),
  })) as InventoryItem[];
}

export async function readLocalSupplyDisbursements(residentId?: string): Promise<SupplyDisbursement[]> {
  const database = await initializeLocalDatabase();
  const scope = scopedTo('resident_id', residentId);
  const result = await database.query(
    `select * from supply_disbursements${scope.clause} order by disbursement_date desc`,
    scope.params,
  );
  
  return (result.values ?? []).map((row) => ({
    ...row,
    quantity: Number(row.quantity),
  })) as SupplyDisbursement[];
}

// -----------------------------------------------------------------------------
// Parsers & Type Guards
// -----------------------------------------------------------------------------

/** Normalizes a nullable SQLite text column — `alter table` columns read back as undefined on older rows, so that collapses to null too. */
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

// -----------------------------------------------------------------------------
//  DATA FETCHING CODE
// -----------------------------------------------------------------------------

/**
 * Writes a page of pulled rows through the same statement the local write path
 * uses, so the two can't drift. One body for all five tables — they differed only
 * by which upsert they named and which word went in the error log.
 */
async function pullRowsFromServer<TRow>(
  label: string,
  upsert: { statement: string; values: (row: TRow) => SqlValue[] },
  cloudRows: TRow[],
): Promise<void> {
  if (!cloudRows.length) return;
  const db = await initializeLocalDatabase();

  try {
    await db.executeSet([{ statement: upsert.statement, values: cloudRows.map(upsert.values) }]);
    await persistLocalDatabase();
  } catch (error) {
    console.error(`Failed to pull ${label} into SQLite:`, error);
    throw error;
  }
}

export const pullInventoryFromServer = (rows: InventoryItem[]) => pullRowsFromServer('inventory', inventoryUpsert, rows);
export const pullHouseholdsFromServer = (rows: Household[]) => pullRowsFromServer('households', householdUpsert, rows);
export const pullIndividualsFromServer = (rows: Individual[]) => pullRowsFromServer('individuals', individualUpsert, rows);
export const pullHealthAssessmentsFromServer = (rows: HealthAssessment[]) =>
  pullRowsFromServer('health assessments', assessmentInsert, rows);
export const pullSupplyDisbursementsFromServer = (rows: SupplyDisbursement[]) =>
  pullRowsFromServer('supply disbursements', disbursementInsert, rows);

/**
 * Primary keys already in a local table. The pull uses this to drop a row whose
 * parent this device does not hold — a release recorded by another BHW can name an
 * item that was never allocated here, and `pragma foreign_keys = on` makes that a
 * failed statement rather than a skipped row.
 */
export async function readExistingIds(table: LocalTableName, column: string): Promise<Set<string>> {
  const db = await initializeLocalDatabase();
  const result = await db.query(`select ${column} from ${table}`);

  return new Set((result.values ?? []).map((row) => String(row[column])));
}
