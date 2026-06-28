import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import type {
  HealthAssessment,
  HealthAssessmentInsert,
  HealthAssessmentUpdate,
  InventoryItem,
  InventoryItemInsert,
  InventoryItemUpdate,
  Resident,
  ResidentInsert,
  ResidentUpdate,
  SupplyDisbursement,
  SupplyDisbursementInsert,
  SupplyDisbursementUpdate,
} from '../types/database';

export type LocalTableName = 'residents' | 'health_assessments' | 'inventory_items' | 'supply_disbursements';
export type SyncOperationType = 'INSERT' | 'UPDATE';

export type LocalInsertPayloadByTable = {
  residents: ResidentInsert;
  health_assessments: HealthAssessmentInsert;
  inventory_items: InventoryItemInsert;
  supply_disbursements: SupplyDisbursementInsert;
};

export type LocalUpdatePayloadByTable = {
  residents: ResidentUpdate & Pick<Resident, 'resident_id'>;
  health_assessments: HealthAssessmentUpdate & Pick<HealthAssessment, 'assessment_id'>;
  inventory_items: InventoryItemUpdate & Pick<InventoryItem, 'item_id'>;
  supply_disbursements: SupplyDisbursementUpdate & Pick<SupplyDisbursement, 'log_id'>;
};

export type SyncPayload<TTable extends LocalTableName, TOperation extends SyncOperationType> =
  TOperation extends 'INSERT' ? LocalInsertPayloadByTable[TTable] : LocalUpdatePayloadByTable[TTable];

export type SyncQueueEntry<TTable extends LocalTableName = LocalTableName> = {
  queue_id: number;
  operation_type: SyncOperationType;
  target_table: TTable;
  payload: LocalInsertPayloadByTable[TTable] | LocalUpdatePayloadByTable[TTable];
  created_at: string;
  attempts: number;
  last_error: string | null;
};

type SqlValue = string | number | null;

const sqlite = new SQLiteConnection(CapacitorSQLite);
let localDatabase: SQLiteDBConnection | null = null;

const migrations = [
  `create table if not exists residents (
    resident_id text primary key,
    name text not null,
    birthdate text not null,
    sex text not null check (sex in ('male', 'female')),
    address text not null,
    assigned_bhw text not null,
    created_at text not null,
    updated_at text not null
  )`,
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
    foreign key (resident_id) references residents(resident_id) on delete cascade
  )`,
  `create table if not exists inventory_items (
    item_id text primary key,
    item_name text not null,
    type text not null check (type in ('medicine', 'food', 'equipment', 'hygiene', 'other')),
    current_stock integer not null default 0 check (current_stock >= 0),
    created_at text not null,
    updated_at text not null
  )`,
  `create table if not exists supply_disbursements (
    log_id text primary key,
    item_id text not null,
    resident_id text not null,
    disbursement_date text not null,
    quantity integer not null check (quantity > 0),
    created_at text not null,
    updated_at text not null,
    foreign key (item_id) references inventory_items(item_id),
    foreign key (resident_id) references residents(resident_id)
  )`,
  `create table if not exists sync_queue (
    queue_id integer primary key autoincrement,
    operation_type text not null check (operation_type in ('INSERT', 'UPDATE')),
    target_table text not null check (target_table in ('residents', 'health_assessments', 'inventory_items', 'supply_disbursements')),
    payload text not null,
    created_at text not null,
    attempts integer not null default 0,
    last_error text
  )`,
  'create index if not exists local_residents_assigned_bhw_idx on residents(assigned_bhw)',
  'create index if not exists local_health_assessments_resident_id_idx on health_assessments(resident_id)',
  'create index if not exists local_inventory_items_type_idx on inventory_items(type)',
  'create index if not exists local_supply_disbursements_item_id_idx on supply_disbursements(item_id)',
  'create index if not exists local_supply_disbursements_resident_id_idx on supply_disbursements(resident_id)',
  'create index if not exists local_sync_queue_created_at_idx on sync_queue(created_at)',
];

export async function initializeLocalDatabase(): Promise<SQLiteDBConnection> {
  if (localDatabase) {
    return localDatabase;
  }

  const database = await sqlite.createConnection('mabisa_local', false, 'no-encryption', 1, false);
  await database.open();
  await database.execute('pragma foreign_keys = on');

  for (const statement of migrations) {
    await database.execute(statement);
  }

  localDatabase = database;
  return database;
}

export async function getLocalDatabase(): Promise<SQLiteDBConnection> {
  return initializeLocalDatabase();
}

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
    payload: JSON.parse(String(row.payload)),
    created_at: String(row.created_at),
    attempts: Number(row.attempts),
    last_error: row.last_error === null || row.last_error === undefined ? null : String(row.last_error),
  }));
}

export async function removeSyncQueueEntry(queueId: number): Promise<void> {
  const database = await getLocalDatabase();
  await database.run('delete from sync_queue where queue_id = ?', [queueId]);
}

export async function markSyncQueueEntryFailed(queueId: number, errorMessage: string): Promise<void> {
  const database = await getLocalDatabase();
  await database.run(
    'update sync_queue set attempts = attempts + 1, last_error = ? where queue_id = ?',
    [errorMessage, queueId],
  );
}

export async function saveResidentLocally(resident: Resident, operationType: SyncOperationType = 'INSERT'): Promise<void> {
  const database = await getLocalDatabase();
  await database.run(
    `insert or replace into residents
     (resident_id, name, birthdate, sex, address, assigned_bhw, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      resident.resident_id,
      resident.name,
      resident.birthdate,
      resident.sex,
      resident.address,
      resident.assigned_bhw,
      resident.created_at,
      resident.updated_at,
    ],
  );
  await enqueueSyncOperation('residents', operationType, resident);
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

export async function readLocalResidents(): Promise<Resident[]> {
  const database = await getLocalDatabase();
  const result = await database.query('select * from residents order by name asc');
  return (result.values ?? []).map((row) => row as Resident);
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

function parseOperationType(value: string): SyncOperationType {
  if (value === 'INSERT' || value === 'UPDATE') {
    return value;
  }

  throw new Error(`Unsupported sync operation: ${value}`);
}

function parseLocalTableName(value: string): LocalTableName {
  if (
    value === 'residents' ||
    value === 'health_assessments' ||
    value === 'inventory_items' ||
    value === 'supply_disbursements'
  ) {
    return value;
  }

  throw new Error(`Unsupported sync table: ${value}`);
}

export function toSqlValue(value: string | number | null | undefined): SqlValue {
  return value ?? null;
}
