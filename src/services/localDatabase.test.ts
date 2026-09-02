import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HealthAssessment, Household, Individual, InventoryItem, SupplyDisbursement } from '../types/database';

// The Capacitor plugin is replaced with a real SQLite (sql.js, already a
// dependency) behind the same connection interface, so a malformed clause or a
// misplaced LIMIT fails here rather than on a phone.

type SqlJsDatabase = {
  run: (statement: string, values?: unknown[]) => void;
  exec: (statement: string) => { columns: string[]; values: unknown[][] }[];
  prepare: (statement: string) => {
    bind: (values: unknown[]) => void;
    step: () => boolean;
    getAsObject: () => Record<string, unknown>;
    free: () => void;
  };
};

const harness = vi.hoisted(() => ({
  database: null as SqlJsDatabase | null,
  /** Every statement the module executed, so a test can assert on the SQL itself. */
  statements: [] as string[],
  /** One entry per executeSet, holding that transaction's statements. */
  sets: [] as string[][],
  savedToStore: 0,
}));

vi.mock('@capacitor/core', () => ({
  // Not 'web': that path injects a jeep-sqlite custom element into a DOM this test has no use for.
  Capacitor: { getPlatform: () => 'android' },
}));

vi.mock('../lib/secureStorage', () => ({
  generateDatabasePassphrase: () => 'test-passphrase',
}));

vi.mock('@capacitor-community/sqlite', () => {
  function rowsOf(statement: string, values: unknown[]): Record<string, unknown>[] {
    const database = harness.database!;
    const prepared = database.prepare(statement);
    const rows: Record<string, unknown>[] = [];

    try {
      if (values.length) {
        prepared.bind(values);
      }

      while (prepared.step()) {
        rows.push(prepared.getAsObject());
      }
    } finally {
      prepared.free();
    }

    return rows;
  }

  const connection = {
    open: () => Promise.resolve(),
    close: () => Promise.resolve(),
    execute: (statement: string) => {
      harness.statements.push(statement);
      harness.database!.exec(statement);
      return Promise.resolve({ changes: { changes: 0 } });
    },
    run: (statement: string, values: unknown[] = []) => {
      harness.statements.push(statement);
      harness.database!.run(statement, values);
      return Promise.resolve({ changes: { changes: 0 } });
    },
    query: (statement: string, values: unknown[] = []) => {
      harness.statements.push(statement);
      return Promise.resolve({ values: rowsOf(statement, values) });
    },
    executeSet: (set: { statement: string; values: unknown[][] }[]) => {
      harness.sets.push(set.map((item) => item.statement));

      for (const item of set) {
        harness.statements.push(item.statement);

        for (const row of item.values) {
          harness.database!.run(item.statement, row);
        }
      }

      return Promise.resolve({ changes: { changes: 0 } });
    },
  };

  return {
    CapacitorSQLite: {},
    SQLiteConnection: class {
      isSecretStored() {
        return Promise.resolve({ result: true });
      }
      setEncryptionSecret() {
        return Promise.resolve();
      }
      initWebStore() {
        return Promise.resolve();
      }
      saveToStore() {
        harness.savedToStore += 1;
        return Promise.resolve();
      }
      createConnection() {
        return Promise.resolve(connection);
      }
    },
  };
});

async function newSqlJsDatabase(): Promise<SqlJsDatabase> {
  // sql.js ships no type declarations and is used only here.
  // @ts-expect-error untyped module; the shape relied on is SqlJsDatabase above.
  const { default: initSqlJs } = await import('sql.js');
  const engine = await initSqlJs();

  return new engine.Database() as unknown as SqlJsDatabase;
}

const AT = '2026-08-01T00:00:00.000Z';

function household(overrides: Partial<Household> = {}): Household {
  return {
    household_id: 'h1',
    household_number: 'HH-001',
    toilet_type: ['water_sealed'],
    water_source: ['deep_well'],
    food_production: ['garden'],
    health_status_notes: null,
    created_at: AT,
    updated_at: AT,
    ...overrides,
  };
}

function individual(overrides: Partial<Individual> & Pick<Individual, 'resident_id'>): Individual {
  return {
    household_id: 'h1',
    first_name: 'Juan',
    last_name: 'Dela Cruz',
    middle_name: undefined,
    sex: 'male',
    birthday: '1990-05-02',
    is_household_head: false,
    relationship_to_head: null,
    occupation: null,
    educational_attainment: null,
    is_out_of_school_youth: false,
    is_pregnant_nursing_fp: false,
    philhealth_number: null,
    status: 'active',
    status_changed_on: null,
    created_at: AT,
    updated_at: AT,
    ...overrides,
  } as Individual;
}

function assessment(overrides: Partial<HealthAssessment> & Pick<HealthAssessment, 'assessment_id'>): HealthAssessment {
  return {
    resident_id: 'r1',
    assessment_date: '2026-08-01',
    weight: 60,
    height: 160,
    bmi: 23.44,
    nutrition_status: 'normal',
    created_at: AT,
    updated_at: AT,
    ...overrides,
  } as HealthAssessment;
}

function item(overrides: Partial<InventoryItem> & Pick<InventoryItem, 'item_id'>): InventoryItem {
  return {
    item_name: 'Paracetamol',
    type: 'medicine',
    current_stock: 20,
    created_at: AT,
    updated_at: AT,
    ...overrides,
  } as InventoryItem;
}

function disbursement(
  overrides: Partial<SupplyDisbursement> & Pick<SupplyDisbursement, 'log_id'>,
): SupplyDisbursement {
  return {
    item_id: 'i1',
    resident_id: 'r1',
    disbursement_date: '2026-08-01',
    quantity: 2,
    created_at: AT,
    updated_at: AT,
    ...overrides,
  } as SupplyDisbursement;
}

type LocalDatabaseModule = typeof import('./localDatabase');

describe('the local store', () => {
  let store: LocalDatabaseModule;

  beforeAll(async () => {
    harness.database = await newSqlJsDatabase();
    store = await import('./localDatabase');
    await store.initializeLocalDatabase();
  });

  beforeEach(() => {
    for (const table of [
      'sync_queue',
      'sync_dead_letter',
      'supply_disbursements',
      'health_assessments',
      'individuals',
      'households',
      'inventory_items',
    ]) {
      harness.database!.run(`delete from ${table}`);
    }

    harness.statements = [];
    harness.sets = [];
  });

  async function seed() {
    await store.pullHouseholdsFromServer([
      household({ household_id: 'h1', household_number: 'HH-001' }),
      household({ household_id: 'h2', household_number: 'HH-002', created_at: '2026-08-02T00:00:00.000Z' }),
    ]);

    await store.pullIndividualsFromServer([
      individual({ resident_id: 'r1', first_name: 'Juan', last_name: 'Dela Cruz', is_household_head: true }),
      individual({ resident_id: 'r2', first_name: 'Maria', last_name: 'Santos', middle_name: 'Reyes' }),
      individual({ resident_id: 'r3', first_name: 'Pedro', last_name: 'Bautista', household_id: 'h2' }),
      individual({ resident_id: 'r4', first_name: 'Ana', last_name: 'Dela Cruz', status: 'moved_out' }),
    ]);

    await store.pullInventoryFromServer([item({ item_id: 'i1' })]);
    harness.statements = [];
    harness.sets = [];
  }

  // ---------------------------------------------------------------------------

  describe('schema', () => {
    it('creates every table the app writes to', () => {
      const names = harness
        .database!.exec("select name from sqlite_master where type = 'table' order by name")
        .flatMap((result) => result.values.map((row) => String(row[0])));

      expect(names).toEqual(
        expect.arrayContaining([
          'health_assessments',
          'households',
          'individuals',
          'inventory_items',
          'supply_disbursements',
          'sync_dead_letter',
          'sync_queue',
        ]),
      );
    });

    it('carries the columns added after first release, and none that were dropped', () => {
      const columns = (table: string) =>
        harness.database!.exec(`pragma table_info(${table})`).flatMap((r) => r.values.map((row) => String(row[1])));

      expect(columns('individuals')).toEqual(
        expect.arrayContaining([
          'middle_name',
          'updated_by',
          'relationship_to_head',
          'status',
          'status_changed_on',
          'duplicate_override_of',
          'duplicate_override_reason',
          'duplicate_override_by',
          'duplicate_override_at',
        ]),
      );
      expect(columns('sync_queue')).toContain('next_attempt_at');
      expect(columns('households')).not.toContain('dwelling_type');
      expect(columns('households')).not.toContain('electric_service');
      expect(columns('households')).not.toContain('fuel_used');
    });
  });

  describe('counting', () => {
    it('counts each table without reading its rows', async () => {
      await seed();

      expect(await store.countRows('households')).toBe(2);
      expect(await store.countRows('individuals')).toBe(4);
      expect(await store.countRows('inventory_items')).toBe(1);
      expect(await store.countRows('health_assessments')).toBe(0);
      expect(await store.countRows('sync_queue')).toBe(0);
      expect(await store.countRows('sync_dead_letter')).toBe(0);

      expect(harness.statements.every((statement) => !statement.includes('select *'))).toBe(true);
    });

    it('counts the same individuals the list query would return', async () => {
      await seed();

      for (const options of [
        undefined,
        { searchQuery: 'dela cruz' },
        { householdId: 'h2' },
        { includeFormer: true },
        { searchQuery: 'HH-002' },
      ]) {
        expect(await store.getIndividualCount(options)).toBe((await store.readLocalIndividuals(options)).length);
      }
    });
  });

  describe('reading individuals', () => {
    it('hides members who left unless they are asked for', async () => {
      await seed();

      const active = await store.readLocalIndividuals();
      const everyone = await store.readLocalIndividuals({ includeFormer: true });

      expect(active.map((person) => person.resident_id).sort()).toEqual(['r1', 'r2', 'r3']);
      expect(everyone).toHaveLength(4);
    });

    it('searches first, middle, last name and household number', async () => {
      await seed();

      const byLast = await store.readLocalIndividuals({ searchQuery: 'Santos' });
      const byMiddle = await store.readLocalIndividuals({ searchQuery: 'Reyes' });
      const byFirst = await store.readLocalIndividuals({ searchQuery: 'Pedro' });
      const byHousehold = await store.readLocalIndividuals({ searchQuery: 'HH-002' });

      expect(byLast.map((p) => p.resident_id)).toEqual(['r2']);
      expect(byMiddle.map((p) => p.resident_id)).toEqual(['r2']);
      expect(byFirst.map((p) => p.resident_id)).toEqual(['r3']);
      expect(byHousehold.map((p) => p.resident_id)).toEqual(['r3']);
    });

    it('treats a typed % or _ as a character, not a wildcard', async () => {
      await seed();

      expect(await store.readLocalIndividuals({ searchQuery: '%' })).toHaveLength(0);
      expect(await store.readLocalIndividuals({ searchQuery: '_' })).toHaveLength(0);
    });

    it('restricts to one household', async () => {
      await seed();

      const members = await store.readLocalIndividuals({ householdId: 'h2' });

      expect(members.map((person) => person.resident_id)).toEqual(['r3']);
    });

    it('orders by name and honours limit, offset, and an offset with no limit', async () => {
      await seed();

      const all = await store.readLocalIndividuals();
      expect(all.map((person) => person.last_name)).toEqual(['Bautista', 'Dela Cruz', 'Santos']);

      expect((await store.readLocalIndividuals({ limit: 2 })).map((p) => p.resident_id)).toEqual(['r3', 'r1']);
      expect((await store.readLocalIndividuals({ limit: 1, offset: 1 })).map((p) => p.resident_id)).toEqual(['r1']);
      // SQLite rejects OFFSET without LIMIT; the reader has to supply one.
      expect((await store.readLocalIndividuals({ offset: 1 })).map((p) => p.resident_id)).toEqual(['r1', 'r2']);
    });

    it('reads booleans back as booleans and joins the household number', async () => {
      await seed();

      const [head] = await store.readLocalIndividuals({ searchQuery: 'Juan' });

      expect(head.is_household_head).toBe(true);
      expect(head.is_out_of_school_youth).toBe(false);
      expect(head.is_pregnant_nursing_fp).toBe(false);
      expect(head.household_number).toBe('HH-001');
    });

    it('opens one resident by id, including one who has left', async () => {
      await seed();

      const head = await store.readLocalIndividual('r1');
      const former = await store.readLocalIndividual('r4');

      expect(head?.first_name).toBe('Juan');
      expect(head?.is_household_head).toBe(true);
      expect(head?.household_number).toBe('HH-001');
      // The only way back to a member marked moved out by mistake.
      expect(former?.status).toBe('moved_out');
      expect(await store.readLocalIndividual('nobody')).toBeNull();
    });
  });

  describe('reading households', () => {
    it('parses the JSON array columns back into arrays', async () => {
      await seed();

      const [first] = await store.readLocalHouseholds({ searchQuery: 'HH-001' });

      expect(first.toilet_type).toEqual(['water_sealed']);
      expect(first.water_source).toEqual(['deep_well']);
      expect(first.food_production).toEqual(['garden']);
    });

    it('searches by number, newest first, and pages', async () => {
      await seed();

      expect((await store.readLocalHouseholds()).map((h) => h.household_id)).toEqual(['h2', 'h1']);
      expect((await store.readLocalHouseholds({ limit: 1 })).map((h) => h.household_id)).toEqual(['h2']);
      expect((await store.readLocalHouseholds({ offset: 1 })).map((h) => h.household_id)).toEqual(['h1']);
      expect(await store.readLocalHouseholds({ searchQuery: 'HH-002' })).toHaveLength(1);
    });

    // The prefilter behind the re-visit lookup: an unescaped `_` matches any
    // character, which pulls back the wrong record or pushes the right one past
    // the row limit.
    it('treats a typed % or _ as a character, not a wildcard', async () => {
      await seed();

      expect(await store.readLocalHouseholds({ searchQuery: '%' })).toHaveLength(0);
      expect(await store.readLocalHouseholds({ searchQuery: 'HH_001' })).toHaveLength(0);
    });
  });

  describe('finding a household by its number', () => {
    // The re-visit lookup. A capped LIKE search returns the newer near-misses
    // (HH-10, HH-100) and cuts the exact match, so the house gets recorded twice.
    it('finds the exact number past a page of rows that merely contain it', async () => {
      await store.pullHouseholdsFromServer([
        household({ household_id: 'target', household_number: 'HH-1', created_at: AT, updated_at: AT }),
        ...Array.from({ length: 60 }, (_, index) =>
          household({
            household_id: `near-${index}`,
            household_number: `HH-1${index}`,
            created_at: `2026-08-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
          }),
        ),
      ]);

      expect((await store.findLocalHouseholdByNumber('HH-1'))?.household_id).toBe('target');
    });

    it('matches the same number written differently', async () => {
      await seed();

      expect((await store.findLocalHouseholdByNumber(' hh-001 '))?.household_id).toBe('h1');
    });

    it('does not match a number that merely contains the other', async () => {
      await seed();

      expect(await store.findLocalHouseholdByNumber('HH-0012')).toBeNull();
      expect(await store.findLocalHouseholdByNumber('HH-00')).toBeNull();
    });

    it('treats a blank number as matching nothing', async () => {
      await seed();

      expect(await store.findLocalHouseholdByNumber('')).toBeNull();
      expect(await store.findLocalHouseholdByNumber('   ')).toBeNull();
      expect(await store.findLocalHouseholdByNumber(null)).toBeNull();
    });

    it('parses the JSON array columns, the same as the list read', async () => {
      await seed();

      expect((await store.findLocalHouseholdByNumber('HH-001'))?.water_source).toEqual(['deep_well']);
    });
  });

  describe('clearing the records for a new health worker', () => {
    it('empties the data tables and leaves both queues alone', async () => {
      await seed();
      await store.enqueueSyncOperation('households', 'INSERT', household());
      await store.pullHealthAssessmentsFromServer([assessment({ assessment_id: 'a1', resident_id: 'r1' })]);
      await store.pullSupplyDisbursementsFromServer([
        disbursement({ log_id: 'd1', item_id: 'i1', resident_id: 'r1' }),
      ]);

      await store.clearLocalRecords();

      for (const table of ['households', 'individuals', 'health_assessments', 'supply_disbursements', 'inventory_items'] as const) {
        expect(await store.countRows(table)).toBe(0);
      }

      // The queue is the only copy of an unsent visit, so this must not empty it.
      expect(await store.countRows('sync_queue')).toBe(1);
    });
  });

  describe('reading the two leaf histories', () => {
    beforeEach(async () => {
      await seed();
      await store.pullHealthAssessmentsFromServer([
        assessment({ assessment_id: 'a1', resident_id: 'r1', assessment_date: '2026-08-01' }),
        assessment({ assessment_id: 'a2', resident_id: 'r1', assessment_date: '2026-08-03' }),
        assessment({ assessment_id: 'a3', resident_id: 'r2', assessment_date: '2026-08-02' }),
      ]);
      await store.pullSupplyDisbursementsFromServer([
        disbursement({ log_id: 'd1', resident_id: 'r1', disbursement_date: '2026-08-01' }),
        disbursement({ log_id: 'd2', resident_id: 'r2', disbursement_date: '2026-08-04' }),
      ]);
    });

    it('reads assessments newest first, for one resident or for everyone', async () => {
      expect((await store.readLocalHealthAssessments()).map((a) => a.assessment_id)).toEqual(['a2', 'a3', 'a1']);
      expect((await store.readLocalHealthAssessments('r1')).map((a) => a.assessment_id)).toEqual(['a2', 'a1']);
    });

    it('applies the dashboard limit, with and without a resident', async () => {
      expect((await store.readLocalHealthAssessments(undefined, 2)).map((a) => a.assessment_id)).toEqual(['a2', 'a3']);
      expect((await store.readLocalHealthAssessments('r1', 1)).map((a) => a.assessment_id)).toEqual(['a2']);
    });

    it('reads the measurements back as numbers', async () => {
      const [newest] = await store.readLocalHealthAssessments('r1');

      expect(newest.weight).toBe(60);
      expect(newest.height).toBe(160);
      expect(newest.bmi).toBeCloseTo(23.44);
    });

    it('reads releases newest first, for one resident or for everyone', async () => {
      expect((await store.readLocalSupplyDisbursements()).map((d) => d.log_id)).toEqual(['d2', 'd1']);
      expect((await store.readLocalSupplyDisbursements('r1')).map((d) => d.log_id)).toEqual(['d1']);
      expect((await store.readLocalSupplyDisbursements('r1'))[0].quantity).toBe(2);
    });
  });

  describe('pulling from the server', () => {
    it('edits a row in place rather than replacing it, so children survive', async () => {
      await seed();
      await store.pullHealthAssessmentsFromServer([assessment({ assessment_id: 'a1', resident_id: 'r1' })]);

      await store.pullIndividualsFromServer([
        individual({
          resident_id: 'r1',
          first_name: 'Juan',
          occupation: 'farmer',
          created_at: '1999-01-01T00:00:00.000Z',
          updated_at: '2026-09-09T00:00:00.000Z',
        }),
      ]);

      const person = await store.readLocalIndividual('r1');

      expect(person?.occupation).toBe('farmer');
      // created_at is not mutable on conflict — the first sighting stamps it.
      expect(person?.created_at).toBe(AT);
      // REPLACE would have deleted the row and cascaded the assessment away with it.
      expect(await store.countRows('health_assessments')).toBe(1);
    });

    it('does nothing, and touches no statement, when the page is empty', async () => {
      harness.statements = [];

      await store.pullHouseholdsFromServer([]);
      await store.pullIndividualsFromServer([]);
      await store.pullInventoryFromServer([]);
      await store.pullHealthAssessmentsFromServer([]);
      await store.pullSupplyDisbursementsFromServer([]);

      expect(harness.statements).toEqual([]);
    });

    it('writes every column the local write path writes', async () => {
      await store.pullHouseholdsFromServer([household({ health_status_notes: 'follow up' })]);
      await store.pullIndividualsFromServer([
        individual({
          resident_id: 'r9',
          middle_name: 'Reyes',
          relationship_to_head: 'child',
          philhealth_number: '123456',
          updated_by: 'bhw-1',
          duplicate_override_of: 'r1',
          duplicate_override_reason: 'different person',
          duplicate_override_by: 'bhw-1',
          duplicate_override_at: AT,
        }),
      ]);

      const person = await store.readLocalIndividual('r9');

      expect(person).toMatchObject({
        middle_name: 'Reyes',
        relationship_to_head: 'child',
        philhealth_number: '123456',
        updated_by: 'bhw-1',
        duplicate_override_of: 'r1',
        duplicate_override_reason: 'different person',
        duplicate_override_by: 'bhw-1',
        duplicate_override_at: AT,
      });
      expect((await store.readLocalHouseholds())[0].health_status_notes).toBe('follow up');
    });
  });

  describe('the sync queue', () => {
    it('queues a household write and reads it back whole', async () => {
      await store.saveHouseholdLocally(household({ household_id: 'h9', household_number: 'HH-009' }));

      const [entry] = await store.readSyncQueue();

      expect(entry.target_table).toBe('households');
      expect(entry.operation_type).toBe('INSERT');
      expect(entry.attempts).toBe(0);
      expect(entry.last_error).toBeNull();
      expect(entry.next_attempt_at).toBeNull();
      // The raw object, not the JSON the column holds — Supabase needs real arrays.
      expect(entry.payload).toMatchObject({ household_id: 'h9', toilet_type: ['water_sealed'] });
      expect(await store.countRows('households')).toBe(1);
    });

    // Separate commits leave a kill in between with the visit saved on the phone
    // and nothing queued to send it.
    it.each([
      ['household', 'households', async () => store.saveHouseholdLocally(household({ household_id: 'h9' }))],
      [
        'resident',
        'individuals',
        async () => {
          await store.saveHouseholdLocally(household());
          harness.sets = [];
          await store.saveIndividualLocally(individual({ resident_id: 'r9' }));
        },
      ],
      [
        'assessment',
        'health_assessments',
        async () => {
          await seed();
          await store.saveHealthAssessmentLocally(assessment({ assessment_id: 'a9' }));
        },
      ],
    ])('writes a %s and its queue entry in one transaction', async (_label, table, save) => {
      await save();

      expect(harness.sets).toHaveLength(1);
      expect(harness.sets[0].some((statement) => statement.includes(`into ${table}`))).toBe(true);
      expect(harness.sets[0].some((statement) => statement.includes('into sync_queue'))).toBe(true);
    });

    // One flush rather than one per member, and a kill cannot leave a household
    // holding only some of them.
    it('writes a household and every member in one transaction', async () => {
      await store.saveHouseholdWithMembersLocally(
        { row: household({ household_id: 'h9' }), operationType: 'INSERT' },
        [
          { row: individual({ resident_id: 'r9', household_id: 'h9' }), operationType: 'INSERT' },
          { row: individual({ resident_id: 'r8', household_id: 'h9' }), operationType: 'UPDATE' },
        ],
      );

      expect(harness.sets).toHaveLength(1);
      // Household first, so its queue entry is pushed before the members pointing at it.
      expect(harness.sets[0].map((statement) => statement.trim().split(/\s+/).slice(0, 3).join(' '))).toEqual([
        'insert into households',
        'insert into sync_queue',
        'insert into individuals',
        'insert into sync_queue',
        'insert into individuals',
        'insert into sync_queue',
      ]);

      const queued = await store.readSyncQueue();

      expect(queued.map((entry) => entry.target_table)).toEqual(['households', 'individuals', 'individuals']);
      expect(queued.map((entry) => entry.operation_type)).toEqual(['INSERT', 'INSERT', 'UPDATE']);
      expect(await store.countRows('individuals')).toBe(2);
    });

    it('strips the joined household_number from a queued resident', async () => {
      await store.saveHouseholdLocally(household());
      await store.saveIndividualLocally({ ...individual({ resident_id: 'r9' }), household_number: 'HH-001' });

      const entry = (await store.readSyncQueue()).find((queued) => queued.target_table === 'individuals');

      expect(entry?.payload).not.toHaveProperty('household_number');
    });

    it('records a failure with its retry time, then quarantines it with the payload intact', async () => {
      await store.saveHouseholdLocally(household({ household_id: 'h9' }));
      const [entry] = await store.readSyncQueue();

      await store.markSyncQueueEntryFailed(entry.queue_id, 'network down', '2026-08-01T00:05:00.000Z');
      const [failed] = await store.readSyncQueue();

      expect(failed.attempts).toBe(1);
      expect(failed.last_error).toBe('network down');
      expect(failed.next_attempt_at).toBe('2026-08-01T00:05:00.000Z');

      await store.moveSyncQueueEntryToDeadLetter(failed, 'gave up');
      const [dead] = await store.readDeadLetterEntries();

      expect(await store.countRows('sync_queue')).toBe(0);
      expect(dead.original_queue_id).toBe(failed.queue_id);
      expect(dead.attempts).toBe(1);
      expect(dead.last_error).toBe('gave up');
      expect(dead.failed_at).toEqual(expect.any(String));
      expect(dead.payload).toMatchObject({ household_id: 'h9' });
    });

    it('requeues quarantined entries in their original order, with the retry count reset', async () => {
      await store.saveHouseholdLocally(household({ household_id: 'h9' }));
      await store.saveHouseholdLocally(household({ household_id: 'h8' }), 'UPDATE');

      for (const entry of await store.readSyncQueue()) {
        await store.moveSyncQueueEntryToDeadLetter({ ...entry, attempts: 5 }, 'gave up');
      }

      expect(await store.requeueDeadLetterEntries()).toBe(2);

      const requeued = await store.readSyncQueue();

      expect(await store.countRows('sync_dead_letter')).toBe(0);
      expect(requeued.map((entry) => (entry.payload as Household).household_id)).toEqual(['h9', 'h8']);
      expect(requeued.map((entry) => entry.operation_type)).toEqual(['INSERT', 'UPDATE']);
      expect(requeued.every((entry) => entry.attempts === 0 && entry.next_attempt_at === null)).toBe(true);
    });
  });

  describe('releasing a supply', () => {
    beforeEach(async () => {
      await seed();
    });

    it('logs the release, decrements this device stock, and queues only the release', async () => {
      await store.saveSupplyDisbursementLocally(disbursement({ log_id: 'd1', quantity: 5 }));

      const [stock] = await store.readLocalInventoryItems();
      const queued = await store.readSyncQueue();

      expect(stock.current_stock).toBe(15);
      expect(await store.countRows('supply_disbursements')).toBe(1);
      // inventory_items has no BHW write policy — an absolute total must never be pushed.
      expect(queued.map((entry) => entry.target_table)).toEqual(['supply_disbursements']);
    });

    // Three statements, so two ways to be left inconsistent: nothing queued, or
    // the stock never moved.
    it('writes the release, the stock move and the queue entry in one transaction', async () => {
      await store.saveSupplyDisbursementLocally(disbursement({ log_id: 'd1', quantity: 5 }));

      expect(harness.sets).toHaveLength(1);
      expect(harness.sets[0].filter((statement) => statement.includes('into supply_disbursements'))).toHaveLength(1);
      expect(harness.sets[0].filter((statement) => statement.includes('into inventory_items'))).toHaveLength(1);
      expect(harness.sets[0].filter((statement) => statement.includes('into sync_queue'))).toHaveLength(1);
    });

    it('refuses to release more than the device holds, and writes nothing', async () => {
      await expect(store.saveSupplyDisbursementLocally(disbursement({ log_id: 'd1', quantity: 21 }))).rejects.toThrow(
        /Only 20 of Paracetamol left/,
      );

      expect(await store.countRows('supply_disbursements')).toBe(0);
      expect(await store.countRows('sync_queue')).toBe(0);
      expect((await store.readLocalInventoryItems())[0].current_stock).toBe(20);
    });

    it('refuses an item this device has never pulled', async () => {
      await expect(
        store.saveSupplyDisbursementLocally(disbursement({ log_id: 'd1', item_id: 'unknown' })),
      ).rejects.toThrow(/not on this device yet/);
    });

    it('leaves stock alone when an existing log is corrected', async () => {
      await store.saveSupplyDisbursementLocally(disbursement({ log_id: 'd1', quantity: 5 }));
      await store.saveSupplyDisbursementLocally(disbursement({ log_id: 'd1', quantity: 6 }), 'UPDATE');

      expect((await store.readLocalInventoryItems())[0].current_stock).toBe(15);
    });
  });
});

// -----------------------------------------------------------------------------
// A device that predates the current column list, opened by the current build.
// -----------------------------------------------------------------------------

describe('a device installed before the current schema', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('gains the columns added since, and loses the ones dropped since', async () => {
    vi.resetModules();
    harness.database = await newSqlJsDatabase();

    // The first-release shape: no middle_name or status, and the three household
    // columns later removed, which are `not null` with no default.
    harness.database.run(`create table households (
      household_id text primary key,
      household_number text not null,
      dwelling_type text not null,
      electric_service text not null,
      fuel_used text not null,
      toilet_type text not null,
      water_source text not null,
      food_production text not null,
      health_status_notes text,
      created_at text not null,
      updated_at text not null
    )`);
    harness.database.run(`create table individuals (
      resident_id text primary key,
      household_id text not null,
      first_name text not null,
      last_name text not null,
      sex text not null,
      birthday text not null,
      is_household_head integer not null default 0,
      occupation text,
      educational_attainment text,
      is_out_of_school_youth integer not null default 0,
      is_pregnant_nursing_fp integer not null default 0,
      philhealth_number text,
      created_at text not null,
      updated_at text not null
    )`);
    harness.database.run(
      `insert into households values ('h1', 'HH-001', 'concrete', 'yes', 'wood', '["water_sealed"]', '["deep_well"]', '["garden"]', null, '${AT}', '${AT}')`,
    );
    harness.database.run(
      `insert into individuals values ('r1', 'h1', 'Juan', 'Dela Cruz', 'male', '1990-05-02', 1, null, null, 0, 0, null, '${AT}', '${AT}')`,
    );

    const store: LocalDatabaseModule = await import('./localDatabase');
    await store.initializeLocalDatabase();

    const columns = (table: string) =>
      harness.database!.exec(`pragma table_info(${table})`).flatMap((r) => r.values.map((row) => String(row[1])));

    expect(columns('individuals')).toEqual(expect.arrayContaining(['middle_name', 'status', 'updated_by']));
    expect(columns('households')).not.toContain('dwelling_type');
    expect(columns('households')).not.toContain('electric_service');
    expect(columns('households')).not.toContain('fuel_used');

    // Existing rows survive the upgrade and take the new column's default.
    const person = await store.readLocalIndividual('r1');
    expect(person?.first_name).toBe('Juan');
    expect(person?.status).toBe('active');
    expect((await store.readLocalHouseholds())[0].household_number).toBe('HH-001');

    // The write that the leftover `not null` columns would have failed.
    await store.saveHouseholdLocally(household({ household_id: 'h2', household_number: 'HH-002' }));
    expect(await store.countRows('households')).toBe(2);
  });
});
