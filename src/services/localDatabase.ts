import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
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

// Defines the exact tables that exist in our local SQLite database.
export type LocalTableName =
  | 'households'
  | 'individuals'
  | 'health_assessments'
  | 'inventory_items'
  | 'supply_disbursements';

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
};

type SqlValue = string | number | null;

// -----------------------------------------------------------------------------
// Database Connection & Initialization
// -----------------------------------------------------------------------------

const sqlite = new SQLiteConnection(CapacitorSQLite);
let localDatabase: SQLiteDBConnection | null = null;

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
    first_name text not null,\
    middle_name TEXT,
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
    last_error text
  )`,
  
  // Performance Indices for faster lookups and table joins
  'create index if not exists local_individuals_household_id_idx on individuals(household_id)',
  'create index if not exists local_health_assessments_resident_id_idx on health_assessments(resident_id)',
  'create index if not exists local_inventory_items_type_idx on inventory_items(type)',
  'create index if not exists local_supply_disbursements_item_id_idx on supply_disbursements(item_id)',
  'create index if not exists local_supply_disbursements_resident_id_idx on supply_disbursements(resident_id)',
  'create index if not exists local_sync_queue_created_at_idx on sync_queue(created_at)',
];

/**
 * Bootstraps the local SQLite connection and runs all migrations.
 * This is called automatically when the app starts.
 */
export async function initializeLocalDatabase(): Promise<SQLiteDBConnection> {
  // 1. If connection already exists, return it immediately
  if (localDatabase) {
    return localDatabase;
  }

  // 2. THE WEB POLYFILL
  // This block ONLY runs in the browser. It ensures the emulator is injected
  // exactly when needed, preventing Vite HMR race conditions.
  if (Capacitor.getPlatform() === 'web') {
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
      
    } catch (error: any) {
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

  localDatabase = database;
  return database;
}

/**
 * Helper function to ensure the database is initialized before any query runs.
 */
export async function getLocalDatabase(): Promise<SQLiteDBConnection> {
  return initializeLocalDatabase();
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
    `select queue_id, operation_type, target_table, payload, created_at, attempts, last_error
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
    last_error: row.last_error === null || row.last_error === undefined ? null : String(row.last_error),
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
 * Increments the attempt counter and logs the error. Called when a Supabase upsert fails.
 */
export async function markSyncQueueEntryFailed(queueId: number, errorMessage: string): Promise<void> {
  const database = await getLocalDatabase();
  await database.run(
    'update sync_queue set attempts = attempts + 1, last_error = ? where queue_id = ?',
    [errorMessage, queueId],
  );
}

// -----------------------------------------------------------------------------
// Write Operations (The "Double-Write" Pattern)
// -----------------------------------------------------------------------------

/**
 * Writes household data to local storage and queues it for the cloud.
 */
export async function saveHouseholdLocally(household: Household, operationType: SyncOperationType = 'INSERT'): Promise<void> {
  const database = await getLocalDatabase();
  await database.run(
    `insert or replace into households
     (household_id, household_number, dwelling_type, electric_service, fuel_used, toilet_type, water_source, food_production, health_status_notes, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      household.household_id,
      household.household_number,
      household.dwelling_type,
      household.electric_service,
      household.fuel_used,
      JSON.stringify(household.toilet_type), // Convert array to JSON string for SQLite
      JSON.stringify(household.water_source), // Convert array to JSON string for SQLite
      JSON.stringify(household.food_production), // Convert array to JSON string for SQLite
      household.health_status_notes ?? null,
      household.created_at,
      household.updated_at,
    ],
  );
  
  // Note: We queue the raw 'household' object here, NOT the stringified version.
  // This ensures Supabase receives actual arrays when the payload is processed.
  await enqueueSyncOperation('households', operationType, household);
}

/**
 * Writes individual data to local storage and queues it for the cloud.
 */
export async function saveIndividualLocally(individual: Individual, operationType: SyncOperationType = 'INSERT'): Promise<void> {
  const database = await getLocalDatabase();
  await database.run(
    `insert or replace into individuals
     (resident_id, household_id, first_name, last_name, sex, birthday, is_household_head, occupation, educational_attainment, is_out_of_school_youth, is_pregnant_nursing_fp, philhealth_number, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      individual.resident_id,
      individual.household_id,
      individual.first_name,
      individual.last_name,
      individual.sex,
      individual.birthday,
      individual.is_household_head ? 1 : 0, // Convert boolean to integer for SQLite
      individual.occupation ?? null,
      individual.educational_attainment ?? null,
      individual.is_out_of_school_youth ? 1 : 0, // Convert boolean to integer
      individual.is_pregnant_nursing_fp ? 1 : 0, // Convert boolean to integer
      individual.philhealth_number ?? null,
      individual.created_at,
      individual.updated_at,
    ],
  );
  
  // Queue the raw object so Supabase receives actual booleans
  await enqueueSyncOperation('individuals', operationType, individual);
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
}

export async function saveInventoryItemLocally(item: InventoryItem, operationType: SyncOperationType = 'INSERT'): Promise<void> {
  const database = await getLocalDatabase();
  await database.run(
    `insert or replace into inventory_items
     (item_id, item_name, type, current_stock, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?)`,
    [item.item_id, item.item_name, item.type, item.current_stock, item.created_at, item.updated_at],
  );
  await enqueueSyncOperation('inventory_items', operationType, item);
}

export async function saveSupplyDisbursementLocally(
  disbursement: SupplyDisbursement,
  operationType: SyncOperationType = 'INSERT',
): Promise<void> {
  const database = await getLocalDatabase();
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
}

// -----------------------------------------------------------------------------
// Read Operations (Loading data into the React UI)
// -----------------------------------------------------------------------------

/**
 * Loads all households to populate the global state.
 */
export async function readLocalHouseholds(): Promise<Household[]> {
  const database = await getLocalDatabase();
  const result = await database.query('select * from households order by household_number asc');
  
  return (result.values ?? []).map((row) => ({
    ...row,
    // Restore JSON strings back into standard arrays for the frontend UI
    toilet_type: JSON.parse(String(row.toilet_type)),
    water_source: JSON.parse(String(row.water_source)),
    food_production: JSON.parse(String(row.food_production)),
  })) as Household[];
}

/**
 * Loads individuals. Can optionally filter by householdId.
 */
export async function readLocalIndividuals(householdId?: string): Promise<Individual[]> {
  const database = await getLocalDatabase();
  
  // Conditionally build the query based on provided arguments
  const query = householdId
    ? {
        statement: 'select * from individuals where household_id = ? order by last_name asc, first_name asc',
        values: [householdId],
      }
    : {
        statement: 'select * from individuals order by last_name asc, first_name asc',
        values: [],
      };
      
  const result = await database.query(query.statement, query.values);
  
  return (result.values ?? []).map((row) => ({
    ...row,
    // Restore integers (0/1) back into booleans for the frontend UI
    is_household_head: Number(row.is_household_head) === 1,
    is_out_of_school_youth: Number(row.is_out_of_school_youth) === 1,
    is_pregnant_nursing_fp: Number(row.is_pregnant_nursing_fp) === 1,
  })) as Individual[];
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