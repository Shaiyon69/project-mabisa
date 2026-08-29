import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGE_BANDS,
  NUTRITION_ORDER,
  activePreset,
  ageBandOf,
  barangayStats,
  defaultAdminFilters,
  describePeriod,
  describeScope,
  disbursementsByItem,
  emptyAdminSnapshot,
  lowStockItems,
  monthlyTrend,
  presetRange,
  tally,
  type AdminSnapshot,
} from './adminData';
import type { HealthAssessment, InventoryItem, NutritionStatus, SupplyDisbursement } from '../types/database';

const assessment = (
  assessment_id: string,
  resident_id: string,
  assessment_date: string,
  nutrition_status: NutritionStatus,
): HealthAssessment => ({
  assessment_id,
  resident_id,
  assessment_date,
  weight: 50,
  height: 160,
  bmi: 19.5,
  nutrition_status,
  created_at: '',
  updated_at: '',
});

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

const item = (item_id: string, item_name: string, current_stock: number): InventoryItem => ({
  item_id,
  item_name,
  type: 'medicine',
  current_stock,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

describe('lowStockItems', () => {
  it('includes the threshold itself and excludes what sits above it', () => {
    const items = [item('a', 'Paracetamol', 10), item('b', 'Vitamins', 11), item('c', 'Soap', 0)];

    expect(lowStockItems(items).map((row) => row.item_id)).toEqual(['a', 'c']);
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

    expect(defaultAdminFilters()).toEqual({ from: '2026-01-01', to: '2026-08-22', barangayId: null });

    vi.useRealTimers();
  });

  it('describes itself as a range', () => {
    expect(describePeriod({ from: '2026-01-01', to: '2026-08-22', barangayId: null })).toBe(
      '2026-01-01 to 2026-08-22',
    );
  });

  it('recognises a range that came from a preset, and one that did not', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-22T05:00:00.000Z'));

    // The chips are lit from this, so a range arriving in a shared link still
    // highlights the preset it corresponds to instead of reading as custom.
    expect(presetRange('last30')).toEqual({ from: '2026-07-24', to: '2026-08-22' });
    expect(activePreset({ ...presetRange('last30'), barangayId: null })).toBe('last30');
    expect(activePreset({ ...presetRange('ytd'), barangayId: null })).toBe('ytd');
    expect(activePreset({ from: '2026-02-03', to: '2026-04-05', barangayId: null })).toBeNull();

    vi.useRealTimers();
  });
});

describe('barangay scope', () => {
  const barangays = [
    { barangay_id: 'b1', name: 'Cabugao', code: 'CABUGAO', is_active: true, created_at: '', updated_at: '', created_by: null },
  ];

  it('names the scope, and says so when there is none', () => {
    expect(describeScope({ from: 'a', to: 'b', barangayId: null }, barangays)).toBe('All barangays');
    expect(describeScope({ from: 'a', to: 'b', barangayId: 'b1' }, barangays)).toBe('Cabugao');
    // A scope naming a barangay this session cannot read must not silently read
    // as "everything" — that is the caption saying the opposite of the truth.
    expect(describeScope({ from: 'a', to: 'b', barangayId: 'gone' }, barangays)).toBe('Unknown barangay');
  });
});

describe('nutrition order', () => {
  it('matches the statuses an assessment can carry', () => {
    const statuses: HealthAssessment['nutrition_status'][] = ['underweight', 'normal', 'overweight', 'obese'];

    expect([...NUTRITION_ORDER].sort()).toEqual([...statuses].sort());
  });
});

describe('barangayStats', () => {
  const barangay = (barangay_id: string, name: string) => ({
    barangay_id,
    name,
    code: name.toUpperCase(),
    is_active: true,
    created_at: '',
    updated_at: '',
    created_by: null,
  });

  // Two barangays of very different size, plus a household nobody stamped a
  // barangay on. `big` is three times `small` and has the same proportion of
  // underweight readings, which is the case a count-shaded map gets wrong.
  const snapshot: AdminSnapshot = {
    ...emptyAdminSnapshot,
    barangays: [barangay('big', 'Cabugao'), barangay('small', 'Salay'), barangay('empty', 'Pag-asa')],
    households: [
      { household_id: 'h1', purok_id: null, barangay_id: 'big', updated_at: '' },
      { household_id: 'h2', purok_id: null, barangay_id: 'big', updated_at: '' },
      { household_id: 'h3', purok_id: null, barangay_id: 'small', updated_at: '' },
      { household_id: 'h4', purok_id: null, barangay_id: null, updated_at: '' },
    ],
    residents: [
      { resident_id: 'r1', household_id: 'h1', sex: 'female', birthday: '2000-01-01', updated_at: '' },
      { resident_id: 'r2', household_id: 'h1', sex: 'male', birthday: '2000-01-01', updated_at: '' },
      { resident_id: 'r3', household_id: 'h2', sex: 'male', birthday: '2000-01-01', updated_at: '' },
      { resident_id: 'r4', household_id: 'h3', sex: 'female', birthday: '2000-01-01', updated_at: '' },
      { resident_id: 'r5', household_id: 'h4', sex: 'male', birthday: '2000-01-01', updated_at: '' },
    ],
    assessments: [
      assessment('a1', 'r1', '2026-03-04', 'underweight'),
      // r1 twice in the period: one resident covered, two assessments counted.
      assessment('a2', 'r1', '2026-04-04', 'normal'),
      // r2 is never assessed, which is what keeps coverage below 100%.
      assessment('a4', 'r3', '2026-05-05', 'normal'),
      assessment('a5', 'r4', '2026-05-06', 'underweight'),
    ],
  };

  const stats = barangayStats(snapshot);
  const at = (id: string) => stats.find((row) => row.barangayId === id)!;

  it('reaches a barangay through the household, which is the only row that records it', () => {
    expect(at('big').residents).toBe(3);
    expect(at('big').households).toBe(2);
    expect(at('small').residents).toBe(1);
  });

  it('rates the small barangay worse than the large one on the same proportion', () => {
    // 1 of 3 against 1 of 1. Shading by count would call them equal.
    expect(at('big').underweightRate).toBeCloseTo(1 / 3);
    expect(at('small').underweightRate).toBe(1);
  });

  it('counts distinct residents for coverage, not assessments', () => {
    // r1 was assessed twice; two of the three residents were reached.
    expect(at('big').residentsAssessed).toBe(2);
    expect(at('big').coverageRate).toBeCloseTo(2 / 3);
  });

  it('keeps a barangay that holds nothing, with no rate rather than a zero', () => {
    // A missing row reads as an omission; a 0% rate claims everyone was weighed
    // and none was underweight, which is a different and false statement.
    expect(at('empty').residents).toBe(0);
    expect(at('empty').underweightRate).toBeNull();
    expect(at('empty').coverageRate).toBeNull();
  });

  it('counts unstamped households rather than dropping them, and sorts them last', () => {
    expect(at('').name).toBe('Unassigned');
    expect(at('').residents).toBe(1);
    expect(stats[stats.length - 1].barangayId).toBe('');
    // Nothing may go missing between the snapshot and the summary.
    expect(stats.reduce((sum, row) => sum + row.residents, 0)).toBe(snapshot.residents.length);
  });
});

describe('monthlyTrend', () => {
  it('emits every month in the range, including the ones with nothing in them', () => {
    const points = monthlyTrend(
      [assessment('a1', 'r1', '2026-01-15', 'underweight'), assessment('a2', 'r2', '2026-03-02', 'normal')],
      { from: '2026-01-01', to: '2026-03-31', barangayId: null },
    );

    // A trend drawn only from the months that have data hides the month nobody
    // was assessed, which is the gap the chart exists to show.
    expect(points.map((point) => point.month)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(points[1]).toMatchObject({ assessments: 0, underweight: 0, rate: null });
    expect(points[0]).toMatchObject({ assessments: 1, underweight: 1, rate: 1 });
  });
});
