import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGE_BANDS,
  NUTRITION_ORDER,
  ageBandOf,
  assessmentsBelowAdultBmiAge,
  defaultAdminFilters,
  describeBarangayScope,
  disbursementsByItem,
  LOW_STOCK_THRESHOLD,
  lowStockItems,
  reorderLevelOf,
  tally,
} from './adminData';
import type { HealthAssessment, InventoryItem, SupplyDisbursement } from '../types/database';

describe('tally', () => {
  const rows = [{ status: 'normal' }, { status: 'normal' }, { status: 'underweight' }, { status: null }];

  it('counts by key and ignores rows with no value', () => {
    expect(tally(rows, (row) => row.status)).toEqual([
      { label: 'normal', count: 2 },
      { label: 'underweight', count: 1 },
    ]);
  });

  it('keeps zero categories when an order is given', () => {
    // A distribution that silently drops `obese` reads as a missing category
    // rather than an empty one, which is the whole reason `order` exists.
    expect(tally(rows, (row) => row.status, NUTRITION_ORDER)).toEqual([
      { label: 'underweight', count: 1 },
      { label: 'normal', count: 2 },
      { label: 'overweight', count: 0 },
      { label: 'obese', count: 0 },
    ]);
  });

  it('totals to the number of rows that had a value', () => {
    const total = tally(rows, (row) => row.status, NUTRITION_ORDER).reduce((sum, row) => sum + row.count, 0);

    expect(total).toBe(3);
  });
});

describe('ageBandOf', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-22T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('places each band boundary in exactly one band', () => {
    expect(ageBandOf('2026-01-01')).toBe('Under 5');
    expect(ageBandOf('2022-08-22')).toBe('Under 5');
    expect(ageBandOf('2021-08-22')).toBe('5 to 9');
    expect(ageBandOf('2016-08-22')).toBe('10 to 19');
    expect(ageBandOf('2006-08-22')).toBe('20 to 59');
    expect(ageBandOf('1966-08-22')).toBe('60 and over');
  });

  it('covers every band the summaries render', () => {
    const bands = new Set(
      ['2026-01-01', '2021-08-22', '2016-08-22', '2006-08-22', '1966-08-22'].map((birthday) => ageBandOf(birthday)),
    );

    expect(bands).toEqual(new Set(AGE_BANDS.map((band) => band.label)));
  });

  it('refuses a birthday in the future rather than banding it', () => {
    expect(ageBandOf('2030-01-01')).toBeNull();
  });
});

const item = (item_id: string, item_name: string, current_stock: number, reorder_level?: number): InventoryItem => ({
  item_id,
  item_name,
  type: 'medicine',
  current_stock,
  reorder_level,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

describe('reorderLevelOf', () => {
  it("takes the item's own level", () => {
    expect(reorderLevelOf(item('a', 'Rice', 40, 5))).toBe(5);
  });

  // Zero is the office switching the warning off, and `??` is what keeps it from
  // collapsing into the shared fallback the way `||` would.
  it('keeps a zero level rather than falling back', () => {
    expect(reorderLevelOf(item('a', 'Leaflets', 0, 0))).toBe(0);
    expect(lowStockItems([item('a', 'Leaflets', 0, 0)])).toEqual([]);
  });

  it("falls back for an item never given a level, like a device's copy", () => {
    expect(reorderLevelOf(item('a', 'Paracetamol', 40))).toBe(LOW_STOCK_THRESHOLD);
  });
});

describe('lowStockItems', () => {
  it('includes the level itself and excludes what sits above it', () => {
    const items = [item('a', 'Paracetamol', 10), item('b', 'Vitamins', 11), item('c', 'Soap', 0)];

    expect(lowStockItems(items).map((row) => row.item_id)).toEqual(['a', 'c']);
  });

  // The reason the level moved onto the item: one number cannot serve both.
  it('warns per item, so sacks and sachets are judged separately', () => {
    const items = [item('rice', 'Rice sack', 4, 10), item('vitamin', 'Vitamins', 4, 2)];

    expect(lowStockItems(items).map((row) => row.item_id)).toEqual(['rice']);
  });
});

const release = (log_id: string, item_id: string, quantity: number): SupplyDisbursement => ({
  log_id,
  item_id,
  resident_id: 'r1',
  disbursement_date: '2026-05-01',
  quantity,
  created_at: '2026-05-01T00:00:00.000Z',
  updated_at: '2026-05-01T00:00:00.000Z',
});

describe('disbursementsByItem', () => {
  const items = [item('a', 'Paracetamol', 40), item('b', 'Vitamins', 5)];

  it('sums quantity per item, largest first', () => {
    const rows = [release('1', 'b', 2), release('2', 'a', 3), release('3', 'a', 4)];

    expect(disbursementsByItem(rows, items)).toEqual([
      { label: 'Paracetamol', count: 7 },
      { label: 'Vitamins', count: 2 },
    ]);
  });

  it('keeps a release whose item has not synced down instead of dropping it', () => {
    // Losing the row would make the report total disagree with the source
    // records, which is exactly the acceptance criterion FR-09 sets.
    expect(disbursementsByItem([release('1', 'missing', 5)], items)).toEqual([{ label: 'Unknown item', count: 5 }]);
  });

  it('totals to the same quantity as the source rows', () => {
    const rows = [release('1', 'b', 2), release('2', 'a', 3), release('3', 'missing', 4)];
    const summed = disbursementsByItem(rows, items).reduce((sum, row) => sum + row.count, 0);

    expect(summed).toBe(rows.reduce((sum, row) => sum + row.quantity, 0));
  });
});

describe('period', () => {
  it('defaults to year to date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-22T05:00:00.000Z'));

    expect(defaultAdminFilters()).toEqual({ from: '2026-01-01', to: '2026-08-22' });

    vi.useRealTimers();
  });
});

describe('nutrition order', () => {
  it('matches the statuses an assessment can carry', () => {
    const statuses: HealthAssessment['nutrition_status'][] = ['underweight', 'normal', 'overweight', 'obese'];

    expect([...NUTRITION_ORDER].sort()).toEqual([...statuses].sort());
  });
});

describe('describeBarangayScope', () => {
  const barangays = [
    { barangay_id: 'a', name: 'Barangay San Isidro' },
    { barangay_id: 'b', name: 'Barangay Poblacion' },
  ];

  it('names the one barangay an administrator is confined to', () => {
    expect(describeBarangayScope('b', barangays)).toBe('Barangay Poblacion');
  });

  // The failure this guards: an RHU export spans every barangay, and captioning
  // it with any single name puts a false heading on a true report.
  it('does not name a single barangay on an unconfined RHU export', () => {
    expect(describeBarangayScope(null, barangays)).toBe('All barangays (2) — Rural Health Unit');
  });

  it('names it anyway when the whole database is one barangay', () => {
    expect(describeBarangayScope(null, barangays.slice(0, 1))).toBe('Barangay San Isidro');
  });

  it('says the name is missing rather than inventing one', () => {
    expect(describeBarangayScope(null, [])).toBe('Barangay name not configured');
    expect(describeBarangayScope('gone', barangays)).toBe('Barangay name not configured');
  });
});

describe('assessmentsBelowAdultBmiAge', () => {
  const on = new Date('2026-08-24T00:00:00.000Z');
  const residents = [
    { resident_id: 'child', birthday: '2023-01-01' },
    { resident_id: 'teen', birthday: '2010-01-01' },
    { resident_id: 'adult', birthday: '1980-01-01' },
    // Turns 20 the day after the report is read — still a child by these cut-points.
    { resident_id: 'almost', birthday: '2006-08-25' },
  ];

  it('counts only the assessments the adult bands do not classify', () => {
    const assessments = [
      { resident_id: 'child' },
      { resident_id: 'teen' },
      { resident_id: 'adult' },
      { resident_id: 'almost' },
    ];

    expect(assessmentsBelowAdultBmiAge(assessments, residents, on)).toBe(3);
  });

  it('says nothing when every assessment is of an adult', () => {
    expect(assessmentsBelowAdultBmiAge([{ resident_id: 'adult' }], residents, on)).toBe(0);
  });

  // A resident the portal did not read back is unknown, not young — counting them
  // would put a caveat on a report that has no children in it.
  it('does not treat an unknown resident as a child', () => {
    expect(assessmentsBelowAdultBmiAge([{ resident_id: 'nobody' }], residents, on)).toBe(0);
  });
});
