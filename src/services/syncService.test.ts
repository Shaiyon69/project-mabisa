import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { derivedEntityKeys, nextAttemptTimestamp, newestUpdatedAt, ownEntityKey, parentEntityKeys } from './syncService';
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
