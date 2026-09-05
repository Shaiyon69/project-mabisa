import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalTableName, SyncOperationType, SyncQueueEntry } from './localDatabase';

// The drain loop talks to SQLite and to Supabase. Both are replaced with the
// smallest fakes that still tell the truth about ordering, retries, and what was
// sent, for the three scenarios that matter: an interrupted pass, a replayed
// entry, and a rejected one.

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
    /** Rows the server hands back per table when the pull reads it. */
    cloud: {} as Record<string, Record<string, unknown>[]>,
    /** Primary keys already on the device, keyed by table, for the parent guards. */
    known: {} as Record<string, string[]>,
    /** What each pull writer was actually handed, after the guards ran. */
    pulled: {} as Record<string, Record<string, unknown>[]>,
    /** Every `setRowVersion` the pass made: the server stamp written back to a local row. */
    rowVersions: [] as [string, string, string][],
    /** The `updated_at` the fake server stamps on a write, standing in for the BEFORE UPDATE trigger. */
    updatedAt: null as string | null,
  };
});

vi.mock('@capacitor/network', () => ({
  Network: { getStatus: () => Promise.resolve({ connected: true }) },
}));

// Partial mock: only the client is faked. `readAllPages` is the paging logic the
// pull depends on and stays real.
vi.mock('../lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/supabase')>();

  /** What a write hands back: the row, carrying the server's own `updated_at` when one is set. */
  const stamped = (payload: Record<string, unknown>) =>
    fake.updatedAt ? { ...payload, updated_at: fake.updatedAt } : payload;

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
            fake.rejecting.has(table)
              ? { data: null, error: new Error(`${table} rejected`) }
              : { data: [stamped(payload)], error: null },
            filters,
          );
        },
        update: (payload: Record<string, unknown>) => {
          const filters: [string, string, unknown][] = [];
          fake.sent.push({ table, operation: 'update', payload, filters });
          return resolving(
            fake.rejecting.has(table)
              ? { data: null, error: new Error(`${table} rejected`) }
              : { data: fake.updateMatches ? [stamped(payload)] : [], error: null },
            filters,
          );
        },
        // The pull runs only on a clean pass; `fake.cloud` is what the server holds.
        select: () => resolving({ data: fake.cloud[table] ?? [], error: null }),
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
  pullHouseholdsFromServer: (rows: Record<string, unknown>[]) => {
    fake.pulled.households = rows;
    return Promise.resolve();
  },
  pullIndividualsFromServer: (rows: Record<string, unknown>[]) => {
    fake.pulled.individuals = rows;
    return Promise.resolve();
  },
  pullInventoryFromServer: () => Promise.resolve(),
  setRowVersion: (table: string, id: string, version: string) => {
    fake.rowVersions.push([table, id, version]);
    return Promise.resolve();
  },
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
    base_version: null,
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
  fake.cloud = {};
  fake.known = {};
  fake.pulled = {};
  fake.rowVersions = [];
  fake.updatedAt = null;
});

describe('an interrupted pass', () => {
  it('keeps draining past a failure and holds only what depends on it', async () => {
    fake.rejecting.add('households');
    fake.queue = [
      queued('households', { household_id: 'h1', updated_at: '2026-08-18T01:00:00.000Z' }),
      queued('individuals', { resident_id: 'r1', household_id: 'h1' }),
      queued('inventory_items', { item_id: 'i1' }),
    ];

    // The inventory row shares no foreign key with the household, so a blocked
    // household must not strand it.
    fake.rejecting.delete('inventory_items');
    const result = await syncPendingQueue();

    expect(result.processed).toBe(1);
    expect(result.deferred).toBe(2);
    expect(result.status).toBe('deferred');
    expect(fake.sent.map((call) => call.table)).toEqual(['households', 'inventory_items']);
    // The resident was never sent: its household does not exist centrally yet.
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

  it('narrows each update by the primary key of that table and by the base version', async () => {
    fake.queue = primaryKeys.map(([table, key]) =>
      queued(
        table,
        { [key]: `${key}-1`, updated_at: '2026-08-18T01:00:00.000Z' },
        { operation_type: 'UPDATE', base_version: '2026-08-17T09:00:00.000Z' },
      ),
    );

    await syncPendingQueue();

    for (const [index, [table, key]] of primaryKeys.entries()) {
      const call = fake.sent[index];

      expect(call.table).toBe(table);
      expect(call.operation).toBe('update');
      expect(call.filters).toContainEqual(['eq', key, `${key}-1`]);
      // The version this device last read from the server, not the time it typed
      // the edit: both sides of the comparison are then a server clock.
      expect(call.filters).toContainEqual(['eq', 'updated_at', '2026-08-17T09:00:00.000Z']);
      expect(call.filters).not.toContainEqual(['lte', 'updated_at', '2026-08-18T01:00:00.000Z']);
      // Selected back so a no-op update is distinguishable from a successful one.
      expect(call.filters).toContainEqual(['select', `${key}, updated_at`, undefined]);
    }
  });

  it('falls back to the device edit time for an entry queued before base_version existed', async () => {
    fake.queue = [
      queued(
        'households',
        { household_id: 'h1', updated_at: '2026-08-18T01:00:00.000Z' },
        { operation_type: 'UPDATE', base_version: null },
      ),
    ];

    await syncPendingQueue();

    expect(fake.sent[0].filters).toContainEqual(['lte', 'updated_at', '2026-08-18T01:00:00.000Z']);
  });

  it('bases a second offline edit on what the first push landed, not on the stale version', async () => {
    // The case that used to quarantine a change nobody conflicted with: both
    // edits were queued against v0, and the server moved to v1 when the first
    // one landed. Without the chaining the second matches no row.
    fake.queue = [
      queued(
        'individuals',
        { resident_id: 'r1', updated_at: '2026-08-18T01:00:00.000Z' },
        { operation_type: 'UPDATE', base_version: 'v0' },
      ),
      queued(
        'individuals',
        { resident_id: 'r1', updated_at: '2026-08-18T02:00:00.000Z' },
        { operation_type: 'UPDATE', base_version: 'v0' },
      ),
    ];
    // What the fake server hands back from the first write.
    fake.updatedAt = 'v1';

    const result = await syncPendingQueue();

    expect(result.status).toBe('synced');
    expect(result.processed).toBe(2);
    expect(result.deadLettered).toBe(0);
    expect(fake.sent[0].filters).toContainEqual(['eq', 'updated_at', 'v0']);
    expect(fake.sent[1].filters).toContainEqual(['eq', 'updated_at', 'v1']);
    // And written back, so an edit made after this pass bases on it too.
    expect(fake.rowVersions).toContainEqual(['individuals', 'r1', 'v1']);
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

    // What a crash between the remote write and the queue deletion leaves behind.
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
    // One attempt, not five: every retry compares against a row that moved on further.
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

    // The primary key is stripped from the SET clause; the edit timestamp stays,
    // since the filter is built from it.
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

describe('the pull', () => {
  // A resident can be reached through a household this device does not hold. With
  // local foreign keys on, that row fails the whole page, and the watermark never
  // advances past the throw.
  it('drops an individual whose household is not on this device, and keeps the rest', async () => {
    fake.known.households = ['h1'];
    fake.cloud.individuals = [
      { resident_id: 'r1', household_id: 'h1', updated_at: '2026-08-18T02:00:00.000Z' },
      { resident_id: 'r2', household_id: 'h-elsewhere', updated_at: '2026-08-18T02:00:00.000Z' },
    ];

    const result = await syncPendingQueue();

    expect(result.status).toBe('synced');
    expect(fake.pulled.individuals.map((row) => row.resident_id)).toEqual(['r1']);
  });
});
