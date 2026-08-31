import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  idleResult,
  derivedEntityKeys,
  nextAttemptTimestamp,
  newestUpdatedAt,
  ownEntityKey,
  parentEntityKeys,
  withKnownParents,
} from './syncService';
import { PULL_PAGE_SIZE, readAllPages } from '../lib/supabase';
import type { LocalTableName, SyncQueueEntry } from './localDatabase';

/** Minimal queue entry — only the fields the dependency helpers actually read. */
function entry(target_table: LocalTableName, payload: Record<string, unknown>): SyncQueueEntry {
  return {
    queue_id: 1,
    operation_type: 'INSERT',
    target_table,
    payload,
    created_at: '2026-08-15T00:00:00.000Z',
    attempts: 0,
    last_error: null,
    next_attempt_at: null,
  } as SyncQueueEntry;
}

describe('nextAttemptTimestamp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const secondsFromNow = (iso: string) => (Date.parse(iso) - Date.now()) / 1000;

  it('doubles the wait on each attempt: 30s, 1m, 2m, 4m', () => {
    expect(secondsFromNow(nextAttemptTimestamp(1))).toBe(30);
    expect(secondsFromNow(nextAttemptTimestamp(2))).toBe(60);
    expect(secondsFromNow(nextAttemptTimestamp(3))).toBe(120);
    expect(secondsFromNow(nextAttemptTimestamp(4))).toBe(240);
  });

  it('caps the wait at 15 minutes', () => {
    expect(secondsFromNow(nextAttemptTimestamp(99))).toBe(900);
  });

  it('never returns a timestamp in the past', () => {
    expect(secondsFromNow(nextAttemptTimestamp(0))).toBeGreaterThan(0);
  });
});

describe('ownEntityKey', () => {
  it('reads the primary key column for the entry table', () => {
    expect(ownEntityKey(entry('individuals', { resident_id: 'r1' }))).toBe('individuals:r1');
  });

  it('returns null when the payload carries no usable primary key', () => {
    expect(ownEntityKey(entry('individuals', { household_id: 'h1' }))).toBeNull();
  });
});

describe('parentEntityKeys', () => {
  it('has no parent for the root tables', () => {
    expect(parentEntityKeys(entry('households', { household_id: 'h1' }))).toEqual([]);
    expect(parentEntityKeys(entry('inventory_items', { item_id: 'i1' }))).toEqual([]);
  });

  it('points an individual at its household', () => {
    expect(parentEntityKeys(entry('individuals', { resident_id: 'r1', household_id: 'h1' })))
      .toEqual(['households:h1']);
  });

  it('points a resident saved over a duplicate warning at the record they were warned about', () => {
    expect(
      parentEntityKeys(
        entry('individuals', { resident_id: 'r2', household_id: 'h1', duplicate_override_of: 'r1' }),
      ),
    ).toEqual(['households:h1', 'individuals:r1']);
  });

  it('points an assessment at its resident', () => {
    expect(parentEntityKeys(entry('health_assessments', { assessment_id: 'a1', resident_id: 'r1' })))
      .toEqual(['individuals:r1']);
  });

  it('points a disbursement at both its resident and its inventory item', () => {
    expect(parentEntityKeys(entry('supply_disbursements', { log_id: 'l1', resident_id: 'r1', item_id: 'i1' })))
      .toEqual(['individuals:r1', 'inventory_items:i1']);
  });

  it('drops a foreign key that is missing rather than inventing a parent', () => {
    expect(parentEntityKeys(entry('supply_disbursements', { log_id: 'l1', item_id: 'i1' })))
      .toEqual(['inventory_items:i1']);
  });
});

describe('newestUpdatedAt', () => {
  const watermark = '2026-08-20T00:00:00.000Z';

  it('advances to the newest row the server handed over', () => {
    expect(
      newestUpdatedAt(
        [{ updated_at: '2026-08-21T00:00:00.000Z' }, { updated_at: '2026-08-23T00:00:00.000Z' }, { updated_at: '2026-08-22T00:00:00.000Z' }],
        watermark,
      ),
    ).toBe('2026-08-23T00:00:00.000Z');
  });

  it('holds the previous watermark when nothing came back', () => {
    expect(newestUpdatedAt([], watermark)).toBe(watermark);
  });

  it('never moves backwards, so a re-read of older rows cannot rewind it', () => {
    expect(newestUpdatedAt([{ updated_at: '2026-01-01T00:00:00.000Z' }], watermark)).toBe(watermark);
  });

  it('ignores a row with no timestamp rather than failing the whole pass', () => {
    expect(newestUpdatedAt([{}, { updated_at: '2026-08-24T00:00:00.000Z' }], watermark)).toBe('2026-08-24T00:00:00.000Z');
  });

  // The regression this helper exists for: inventory is pulled unfiltered, so its
  // timestamps must not reach here. Passing them in advances the watermark past
  // households the device has not read, and they are then skipped forever.
  it('would skip unread households if unfiltered rows were included', () => {
    const householdRows = [{ updated_at: '2026-08-21T00:00:00.000Z' }];
    const unfilteredStockRow = { updated_at: '2026-08-30T00:00:00.000Z' };

    expect(newestUpdatedAt(householdRows, watermark)).toBe('2026-08-21T00:00:00.000Z');
    expect(newestUpdatedAt([...householdRows, unfilteredStockRow], watermark)).toBe('2026-08-30T00:00:00.000Z');
  });
});

describe('derivedEntityKeys', () => {
  // The double-spend this guards. A release is subtracted from the device's stock
  // the moment it is logged, but a quarantined one never reaches the server, so
  // `bhw_item_stock` still counts the quantity as held. Pulling that figure hands
  // the BHW back medicine they already gave away.
  it('holds back the stock figure a quarantined release has already spent', () => {
    expect(derivedEntityKeys(entry('supply_disbursements', { log_id: 'l1', item_id: 'i1', resident_id: 'r1' }))).toEqual([
      { table: 'inventory_items', key: 'i1' },
    ]);
  });

  it('does not hold back the resident, whose profile is not derived from a release', () => {
    const derived = derivedEntityKeys(entry('supply_disbursements', { log_id: 'l1', item_id: 'i1', resident_id: 'r1' }));

    expect(derived.some((row) => row.table === 'individuals')).toBe(false);
  });

  it('holds nothing back for the tables whose server value is not computed', () => {
    expect(derivedEntityKeys(entry('households', { household_id: 'h1' }))).toEqual([]);
    expect(derivedEntityKeys(entry('individuals', { resident_id: 'r1', household_id: 'h1' }))).toEqual([]);
    expect(derivedEntityKeys(entry('health_assessments', { assessment_id: 'a1', resident_id: 'r1' }))).toEqual([]);
    expect(derivedEntityKeys(entry('inventory_items', { item_id: 'i1' }))).toEqual([]);
  });

  it('holds nothing back when the release carries no item', () => {
    expect(derivedEntityKeys(entry('supply_disbursements', { log_id: 'l1', resident_id: 'r1' }))).toEqual([]);
  });
});

describe('readAllPages', () => {
  /** A server holding `total` rows, answering each requested range like PostgREST does. */
  function server(total: number) {
    const rows = Array.from({ length: total }, (_, index) => ({ updated_at: `row-${index}` }));
    const ranges: [number, number][] = [];

    return {
      ranges,
      page: (from: number, to: number) => {
        ranges.push([from, to]);
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
      },
    };
  }

  it('reads a table shorter than one page in a single request', async () => {
    const { page, ranges } = server(107);

    await expect(readAllPages('Household', page)).resolves.toHaveLength(107);
    expect(ranges).toEqual([[0, PULL_PAGE_SIZE - 1]]);
  });

  // The data loss this exists for: a single capped read returns PULL_PAGE_SIZE rows
  // and says nothing about the rest, the watermark advances past the newest of them,
  // and every row the cap cut is below it — so the filtered pull never offers them again.
  it('keeps asking past the row cap instead of stopping at the first full page', async () => {
    const { page, ranges } = server(PULL_PAGE_SIZE * 2 + 3);

    const rows = await readAllPages('Individual', page);

    expect(rows).toHaveLength(PULL_PAGE_SIZE * 2 + 3);
    expect(ranges).toEqual([
      [0, PULL_PAGE_SIZE - 1],
      [PULL_PAGE_SIZE, PULL_PAGE_SIZE * 2 - 1],
      [PULL_PAGE_SIZE * 2, PULL_PAGE_SIZE * 3 - 1],
    ]);
  });

  it('asks once more when the last page lands exactly on the cap', async () => {
    const { page, ranges } = server(PULL_PAGE_SIZE);

    await expect(readAllPages('Household', page)).resolves.toHaveLength(PULL_PAGE_SIZE);
    expect(ranges).toHaveLength(2);
  });

  it('fails the pass with the table name rather than returning a partial read', async () => {
    const failing = (from: number) =>
      Promise.resolve(
        from === 0
          ? { data: Array.from({ length: PULL_PAGE_SIZE }, () => ({})), error: null }
          : { data: null, error: { message: 'connection reset' } },
      );

    await expect(readAllPages('Individual', failing)).rejects.toThrow('Individual Pull Error: connection reset');
  });
});

describe('withKnownParents', () => {
  const residents = new Set(['r1', 'r2']);

  it('keeps the rows whose parent is on this device', () => {
    const rows = [{ resident_id: 'r1' }, { resident_id: 'r2' }];

    expect(withKnownParents(rows, 'resident_id', residents)).toEqual(rows);
  });

  // The failure this prevents: local foreign keys are on, so one unknown parent
  // fails the whole insert set and the pull brings back nothing at all.
  it('drops a row naming a parent this device never received', () => {
    const rows = [{ resident_id: 'r1' }, { resident_id: 'somebody-elses' }];

    expect(withKnownParents(rows, 'resident_id', residents)).toEqual([{ resident_id: 'r1' }]);
  });

  it('drops everything rather than half-writing when no parent is held', () => {
    expect(withKnownParents([{ item_id: 'i1' }], 'item_id', new Set<string>())).toEqual([]);
  });
});

describe('idleResult', () => {
  // The shape the hook reports a failure with, so a caller cannot report a
  // failed pass that still claims to have processed something.
  it('carries the status and nothing else', () => {
    expect(idleResult('failed')).toEqual({
      status: 'failed',
      processed: 0,
      deferred: 0,
      deadLettered: 0,
      failedQueueId: null,
      errorMessage: null,
    });

    expect(idleResult('offline').status).toBe('offline');
  });
});
