import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalTableName, SyncOperationType, SyncQueueEntry } from './localDatabase';

// The drain loop is the one piece of this app where a bug loses a health record
// rather than misdrawing a screen, and none of it is reachable from a pure
// function: it talks to SQLite and to Supabase. Both are replaced here with the
// smallest fakes that still tell the truth about ordering, retries, and what was
// actually sent — a real DOM or a real network would add nothing to the three
// scenarios that matter (an interrupted pass, a replayed entry, a rejected one).

const fake = vi.hoisted(() => {
  type Sent = {
    table: string;
    operation: 'upsert' | 'update';
    payload: Record<string, unknown>;
    /** The conflict target an upsert named, and the filters an update was narrowed by. */
    onConflict?: string;
    filters: [string, string, unknown][];
  };

  return {
    queue: [] as SyncQueueEntry[],
    deadLetters: [] as { entry: SyncQueueEntry; error: string }[],
    sent: [] as Sent[],
    /** Tables whose writes reject this pass, and the message they reject with. */
    rejecting: new Set<string>(),
    /** false = the update matched no row, which is how a lost conflict looks. */
    updateMatches: true,
  };
});

vi.mock('@capacitor/network', () => ({
  Network: { getStatus: () => Promise.resolve({ connected: true }) },
}));

// Partial mock: only the client is faked. `readAllPages` lives in this module too
// and is pure paging logic the pull genuinely depends on — replacing it would test
// the fake instead of the code.
vi.mock('../lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/supabase')>();

  /** Chainable and awaitable, like a PostgrestFilterBuilder, minus the HTTP. */
  const resolving = (value: unknown, filters: [string, string, unknown][] = []) => {
    const chain: Record<string, unknown> = {
      then: (onFulfilled: (value: unknown) => unknown) => Promise.resolve(value).then(onFulfilled),
    };

    for (const method of ['eq', 'lte', 'gte', 'select', 'order', 'limit', 'range']) {
      chain[method] = (column: string, value: unknown) => {
        filters.push([method, column, value]);
        return chain;
      };
    }

    return chain;
  };

  return {
    ...actual,
    supabase: {
      auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'bhw-1' } } } }) },
      from: (table: string) => ({
        upsert: (payload: Record<string, unknown>, options?: { onConflict?: string }) => {
          const filters: [string, string, unknown][] = [];
          fake.sent.push({ table, operation: 'upsert', payload, onConflict: options?.onConflict, filters });
          return resolving(
            fake.rejecting.has(table) ? { data: null, error: new Error(`${table} rejected`) } : { data: [payload], error: null },
            filters,
          );
        },
        update: (payload: Record<string, unknown>) => {
          const filters: [string, string, unknown][] = [];
          fake.sent.push({ table, operation: 'update', payload, filters });
          return resolving(
            fake.rejecting.has(table)
              ? { data: null, error: new Error(`${table} rejected`) }
              : { data: fake.updateMatches ? [payload] : [], error: null },
            filters,
          );
        },
        // The pull runs only on a clean pass and has nothing to say here.
        select: () => resolving({ data: [], error: null }),
      }),
    },
  };
});

vi.mock('./localDatabase', () => ({
  initializeLocalDatabase: () => Promise.resolve({}),
  persistLocalDatabase: () => Promise.resolve(),
  readSyncQueue: () => Promise.resolve([...fake.queue]),
  removeSyncQueueEntry: (queueId: number) => {
    fake.queue = fake.queue.filter((entry) => entry.queue_id !== queueId);
    return Promise.resolve();
  },
  markSyncQueueEntryFailed: (queueId: number, error: string, nextAttemptAt: string) => {
    const target = fake.queue.find((entry) => entry.queue_id === queueId);

    if (target) {
      target.attempts += 1;
      target.last_error = error;
      target.next_attempt_at = nextAttemptAt;
    }

    return Promise.resolve();
  },
  moveSyncQueueEntryToDeadLetter: (entry: SyncQueueEntry, error: string) => {
    fake.deadLetters.push({ entry, error });
    fake.queue = fake.queue.filter((queued) => queued.queue_id !== entry.queue_id);
    return Promise.resolve();
  },
  readDeadLetterEntries: () => Promise.resolve([]),
  pullHouseholdsFromServer: () => Promise.resolve(),
  pullIndividualsFromServer: () => Promise.resolve(),
  pullInventoryFromServer: () => Promise.resolve(),
  pullHealthAssessmentsFromServer: () => Promise.resolve(),
  pullSupplyDisbursementsFromServer: () => Promise.resolve(),
  readExistingIds: () => Promise.resolve(new Set<string>()),
}));

const { syncPendingQueue } = await import('./syncService');

let nextQueueId = 1;

function queued(
  target_table: LocalTableName,
  payload: Record<string, unknown>,
  overrides: Partial<SyncQueueEntry> = {},
): SyncQueueEntry {
  return {
    queue_id: nextQueueId++,
    operation_type: 'INSERT' as SyncOperationType,
    target_table,
    payload,
    created_at: '2026-08-18T01:00:00.000Z',
    attempts: 0,
    last_error: null,
    next_attempt_at: null,
    ...overrides,
  } as SyncQueueEntry;
}

beforeEach(() => {
  nextQueueId = 1;
  fake.queue = [];
  fake.deadLetters = [];
  fake.sent = [];
  fake.rejecting = new Set();
  fake.updateMatches = true;
});

describe('an interrupted pass', () => {
  it('keeps draining past a failure and holds only what depends on it', async () => {
    fake.rejecting.add('households');
    fake.queue = [
      queued('households', { household_id: 'h1', updated_at: '2026-08-18T01:00:00.000Z' }),
      queued('individuals', { resident_id: 'r1', household_id: 'h1' }),
      queued('inventory_items', { item_id: 'i1' }),
    ];

    // The inventory row shares no foreign key with the household, so a household
    // that cannot be pushed must not strand it on the device.
    fake.rejecting.delete('inventory_items');
    const result = await syncPendingQueue();

    expect(result.processed).toBe(1);
    expect(result.deferred).toBe(2);
    expect(result.status).toBe('deferred');
    expect(fake.sent.map((call) => call.table)).toEqual(['households', 'inventory_items']);
    // The resident was never sent: its household does not exist centrally yet,
    // so pushing it would either fail on the foreign key or orphan the row.
    expect(fake.sent.some((call) => call.table === 'individuals')).toBe(false);
    expect(fake.queue).toHaveLength(2);
  });

  it('quarantines an entry that has exhausted its retries, and its dependants with it', async () => {
    fake.rejecting.add('households');
    fake.queue = [
      queued('households', { household_id: 'h1' }, { attempts: 4 }),
      queued('individuals', { resident_id: 'r1', household_id: 'h1' }),
    ];

    const result = await syncPendingQueue();

    expect(result.deadLettered).toBe(2);
    expect(result.status).toBe('failed');
    expect(fake.deadLetters.map(({ entry }) => entry.target_table)).toEqual(['households', 'individuals']);
    expect(fake.queue).toHaveLength(0);
  });
});

describe('the statement each table is written with', () => {
  const primaryKeys: [LocalTableName, string][] = [
    ['households', 'household_id'],
    ['individuals', 'resident_id'],
    ['health_assessments', 'assessment_id'],
    ['inventory_items', 'item_id'],
    ['supply_disbursements', 'log_id'],
  ];

  it('names the primary key of each table as its upsert conflict target', async () => {
    fake.queue = primaryKeys.map(([table, key]) => queued(table, { [key]: `${key}-1` }));

    await syncPendingQueue();

    expect(fake.sent.map((call) => [call.table, call.onConflict])).toEqual(primaryKeys);
  });

  it('narrows each update by the primary key of that table and by the device edit time', async () => {
    fake.queue = primaryKeys.map(([table, key]) =>
      queued(table, { [key]: `${key}-1`, updated_at: '2026-08-18T01:00:00.000Z' }, { operation_type: 'UPDATE' }),
    );

    await syncPendingQueue();

    for (const [index, [table, key]] of primaryKeys.entries()) {
      const call = fake.sent[index];

      expect(call.table).toBe(table);
      expect(call.operation).toBe('update');
      expect(call.filters).toContainEqual(['eq', key, `${key}-1`]);
      // Without this the update overwrites a row the office edited in the meantime.
      expect(call.filters).toContainEqual(['lte', 'updated_at', '2026-08-18T01:00:00.000Z']);
      // Selected back so a no-op update is distinguishable from a successful one.
      expect(call.filters).toContainEqual(['select', key, undefined]);
    }
  });

  it('lets a payload with no updated_at through rather than quarantining it', async () => {
    fake.queue = [queued('households', { household_id: 'h1' }, { operation_type: 'UPDATE' })];

    const result = await syncPendingQueue();

    expect(result.status).toBe('synced');
    expect(fake.sent[0].filters).toContainEqual(['lte', 'updated_at', '9999-12-31T23:59:59.999Z']);
  });

  it('refuses an update whose payload carries no primary key', async () => {
    fake.queue = [queued('households', { household_number: 'HH-001' }, { operation_type: 'UPDATE' })];

    const result = await syncPendingQueue();

    expect(fake.sent).toHaveLength(0);
    expect(result.deferred).toBe(1);
    expect(fake.queue[0].last_error).toContain('Missing primary key');
  });
});

describe('a replayed entry', () => {
  it('is sent as an upsert, so the second attempt is not a duplicate-key failure', async () => {
    const payload = { household_id: 'h1', household_number: 'HH-001' };
    fake.queue = [queued('households', payload)];

    const first = await syncPendingQueue();

    // What a crash between the remote write and the queue deletion leaves behind:
    // the same entry, still queued, replayed on the next pass.
    fake.queue = [queued('households', payload)];
    const second = await syncPendingQueue();

    expect(first.status).toBe('synced');
    expect(second.status).toBe('synced');
    expect(fake.sent).toHaveLength(2);
    expect(fake.sent.every((call) => call.operation === 'upsert')).toBe(true);
    expect(fake.deadLetters).toHaveLength(0);
  });
});

describe('a rejected write', () => {
  it('sets a lost conflict aside immediately rather than retrying a race it cannot win', async () => {
    fake.updateMatches = false;
    fake.queue = [
      queued(
        'individuals',
        { resident_id: 'r1', household_id: 'h1', updated_at: '2026-08-18T01:00:00.000Z' },
        { operation_type: 'UPDATE' },
      ),
    ];

    const result = await syncPendingQueue();

    expect(result.deadLettered).toBe(1);
    expect(result.deferred).toBe(0);
    expect(fake.deadLetters[0].error).toContain('changed centrally');
    // One attempt, not five: every retry would compare against a row that has
    // moved on further still.
    expect(fake.deadLetters[0].entry.attempts).toBe(1);
  });

  it('filters the update on the timestamp the device edited, not on the primary key alone', async () => {
    fake.queue = [
      queued(
        'individuals',
        { resident_id: 'r1', occupation: 'farmer', updated_at: '2026-08-18T01:00:00.000Z' },
        { operation_type: 'UPDATE' },
      ),
    ];

    await syncPendingQueue();

    // The primary key is stripped from the SET clause; the edit timestamp rides
    // along, because the filter is built from it.
    expect(fake.sent[0].operation).toBe('update');
    expect(fake.sent[0].payload).not.toHaveProperty('resident_id');
    expect(fake.sent[0].payload.updated_at).toBe('2026-08-18T01:00:00.000Z');
  });

  it('defers a transient rejection instead of discarding the record', async () => {
    fake.rejecting.add('health_assessments');
    fake.queue = [queued('health_assessments', { assessment_id: 'a1', resident_id: 'r1' })];

    const result = await syncPendingQueue();

    expect(result.status).toBe('deferred');
    expect(result.deadLettered).toBe(0);
    expect(fake.queue[0].attempts).toBe(1);
    expect(fake.queue[0].next_attempt_at).not.toBeNull();
  });
});
