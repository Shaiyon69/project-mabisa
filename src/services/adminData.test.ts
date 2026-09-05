import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGE_BANDS,
  FILTER_PARAMS,
  NUTRITION_ORDER,
  activePreset,
  ageBandOf,
  assessmentsBelowAdultBmiAge,
  barangayStats,
  birthdayRangeFor,
  defaultAdminFilters,
  describeBarangayScope,
  describePeriod,
  describeScope,
  disbursementsByItem,
  emptyAdminSnapshot,
  fetchAdminSnapshot,
  invalidateAdminSnapshot,
  filterAccounts,
  filterInventory,
  LOW_STOCK_THRESHOLD,
  lowStockItems,
  managesAccount,
  monthlyReleases,
  monthlyTrend,
  nutritionByBarangay,
  presetRange,
  readAllResidentPages,
  REPORT_SECTIONS,
  reorderLevelOf,
  showsSection,
  tally,
  type AccountRow,
  type AdminFilters,
  type AdminSnapshot,
} from './adminData';
import { filtersFromParams, paramsFromFilters } from '../hooks/useAdminData';
import type { HealthAssessment, Individual, InventoryItem, NutritionStatus, SupplyDisbursement } from '../types/database';
import { PULL_PAGE_SIZE } from '../lib/supabase';

// `fetchAdminSnapshot` is the one export here that talks to Supabase, so the
// purok-narrowing test below needs a fake client. Only `.from()` and `.rpc()` are
// replaced; `readAllPages` stays real.
const fake = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  // Every `.from()` the snapshot read issues, so the cache below can be tested
  // for what it exists to do: not going back to the network.
  reads: 0,
}));

vi.mock('../lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/supabase')>();

  return {
    ...actual,
    supabase: {
      from: (table: string) => {
        fake.reads += 1;

        let rows = [...(fake.tables[table] ?? [])];

        const builder = {
          select: () => builder,
          order: () => builder,
          eq: (column: string, value: unknown) => {
            rows = rows.filter((row) => row[column] === value);
            return builder;
          },
          gte: (column: string, value: unknown) => {
            rows = rows.filter((row) => (row[column] as string) >= (value as string));
            return builder;
          },
          lte: (column: string, value: unknown) => {
            rows = rows.filter((row) => (row[column] as string) <= (value as string));
            return builder;
          },
          range: () => Promise.resolve({ data: rows, error: null }),
        };

        return builder;
      },
      // Every account here is an RHU read (`current_barangay_id` null).
      rpc: () => Promise.resolve({ data: null, error: null }),
    },
  };
});

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
    // A dropped `obese` reads as a missing category rather than an empty one.
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

  // Zero switches the warning off, and `??` keeps it out of the shared fallback.
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
    // Losing the row would make the report total disagree with the source records.
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

    // The chips are lit from this, so a range from a shared link still highlights
    // the preset it matches.
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
  const puroks = [
    { purok_id: 'p1', barangay_id: 'b1', name: 'Purok 1', code: null, is_active: true, created_at: '', updated_at: '', created_by: '' },
  ];

  it('names the scope, and says so when there is none', () => {
    expect(describeScope({ from: 'a', to: 'b', barangayId: null }, { barangays, puroks })).toBe('All barangays');
    expect(describeScope({ from: 'a', to: 'b', barangayId: 'b1' }, { barangays, puroks })).toBe('Cabugao');
    // A barangay this session cannot read must not read as "everything".
    expect(describeScope({ from: 'a', to: 'b', barangayId: 'gone' }, { barangays, puroks })).toBe('Unknown barangay');
  });

  it('names the purok too once one is set', () => {
    expect(describeScope({ from: 'a', to: 'b', barangayId: 'b1', purokId: 'p1' }, { barangays, puroks })).toBe(
      'Cabugao — Purok 1',
    );
    // A purok this session cannot name must not drop back to the barangay name.
    expect(describeScope({ from: 'a', to: 'b', barangayId: 'b1', purokId: 'gone' }, { barangays, puroks })).toBe(
      'Cabugao — Unknown purok',
    );
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

  // An RHU export spans every barangay, so no single name may caption it.
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

  // A resident the portal did not read back is unknown, not young.
  it('does not treat an unknown resident as a child', () => {
    expect(assessmentsBelowAdultBmiAge([{ resident_id: 'nobody' }], residents, on)).toBe(0);
  });
});

describe('readAllResidentPages', () => {
  const resident = (id: string) => ({ resident_id: id }) as unknown as Individual;
  const full = (offset: number) =>
    Array.from({ length: PULL_PAGE_SIZE }, (_, index) => resident(`r${offset + index}`));

  it('follows every page, not just the first', async () => {
    // One oversized range is trimmed to the cap in silence, and the export prints
    // its own row count as though the file were complete.
    const pages = [
      { rows: full(0), total: PULL_PAGE_SIZE + 2 },
      { rows: [resident('last-1'), resident('last-2')], total: PULL_PAGE_SIZE + 2 },
    ];

    const rows = await readAllResidentPages((offset) => Promise.resolve(pages[offset / PULL_PAGE_SIZE]));

    expect(rows).toHaveLength(PULL_PAGE_SIZE + 2);
    expect(rows.at(-1)?.resident_id).toBe('last-2');
  });

  it('stops on a short page without asking for another', async () => {
    const reads: number[] = [];
    const rows = await readAllResidentPages((offset) => {
      reads.push(offset);
      return Promise.resolve({ rows: [resident('r1')], total: 1 });
    });

    expect(reads).toEqual([0]);
    expect(rows).toHaveLength(1);
  });

  // A reader that keeps handing back full pages must not spin forever.
  it('stops once the reported total is covered', async () => {
    const reads: number[] = [];
    const rows = await readAllResidentPages((offset) => {
      reads.push(offset);
      return Promise.resolve({ rows: full(offset), total: PULL_PAGE_SIZE });
    });

    expect(reads).toEqual([0]);
    expect(rows).toHaveLength(PULL_PAGE_SIZE);
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

  // Two barangays of very different size, plus an unstamped household. `big` is
  // three times `small` at the same underweight rate, which a count-shaded map
  // gets wrong.
  const snapshot: AdminSnapshot = {
    ...emptyAdminSnapshot,
    barangays: [barangay('big', 'Cabugao'), barangay('small', 'Salay'), barangay('empty', 'Pag-asa')],
    households: [
      { household_id: 'h1', barangay_id: 'big', updated_at: '' },
      { household_id: 'h2', barangay_id: 'big', updated_at: '' },
      { household_id: 'h3', barangay_id: 'small', updated_at: '' },
      { household_id: 'h4', updated_at: '' },
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
    // A missing row reads as an omission; a 0% rate claims everyone was weighed.
    expect(at('empty').residents).toBe(0);
    expect(at('empty').underweightRate).toBeNull();
    expect(at('empty').coverageRate).toBeNull();
  });

  it('keeps every barangay for an RHU account, which reads all of them', () => {
    // The reason the portal has an RHU role at all: one account comparing
    // barangays. A picked barangay narrows the panels, never this list.
    expect(stats.map((row) => row.barangayId)).toEqual(['big', 'empty', 'small', '']);
  });

  it('names only its own barangay for a barangay administrator', () => {
    // `barangays` returns every row to any signed-in account, but this session
    // reads one barangay's households — the rest would be reported at zero.
    const own = barangayStats(
      {
        ...snapshot,
        households: snapshot.households.filter((household) => household.barangay_id === 'small'),
        residents: snapshot.residents.filter((resident) => resident.household_id === 'h3'),
        assessments: snapshot.assessments.filter((row) => row.resident_id === 'r4'),
      },
      'small',
    );

    expect(own.map((row) => row.barangayId)).toEqual(['small']);
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

    // A trend drawn only from the months with data hides the month nobody was assessed.
    expect(points.map((point) => point.month)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(points[1]).toMatchObject({ assessments: 0, underweight: 0, rate: null });
    expect(points[0]).toMatchObject({ assessments: 1, underweight: 1, rate: 1 });
  });
});

describe('monthlyReleases', () => {
  it('draws an empty month inside the range at zero, on the same months monthlyTrend walks', () => {
    const points = monthlyReleases(
      [
        { ...release('1', 'a', 4), disbursement_date: '2026-01-05' },
        { ...release('2', 'a', 6), disbursement_date: '2026-03-10' },
      ],
      { from: '2026-01-01', to: '2026-03-31', barangayId: null },
    );

    expect(points.map((point) => point.month)).toEqual(['2026-01', '2026-02', '2026-03']);
    // February has neither release, and must be drawn at zero rather than skipped.
    expect(points[1]).toMatchObject({ units: 0, releases: 0 });
    expect(points[0]).toMatchObject({ units: 4, releases: 1 });
    expect(points[2]).toMatchObject({ units: 6, releases: 1 });
  });
});

describe('showsSection', () => {
  const base = { from: 'a', to: 'b', barangayId: null };

  it('shows every card when no section is picked', () => {
    for (const section of REPORT_SECTIONS) {
      expect(showsSection({ ...base, reportSections: null }, section.id)).toBe(true);
      expect(showsSection({ ...base, reportSections: [] }, section.id)).toBe(true);
    }
  });

  it('shows only the picked cards', () => {
    const filters = { ...base, reportSections: ['demographics', 'stock'] };

    expect(REPORT_SECTIONS.filter((section) => showsSection(filters, section.id)).map((section) => section.id)).toEqual([
      'demographics',
      'stock',
    ]);
  });
});

describe('filterInventory', () => {
  const items = [
    item('a', 'Paracetamol', 5, 10),
    item('b', 'Bandage', 40, 10),
    item('c', 'Leaflets', 0, 0),
  ];
  const withType = (row: InventoryItem, type: InventoryItem['type']): InventoryItem => ({ ...row, type });
  const typed = [withType(items[0], 'medicine'), withType(items[1], 'hygiene'), withType(items[2], 'other')];

  it('matches on item type', () => {
    expect(filterInventory(typed, { from: 'a', to: 'b', barangayId: null, itemType: 'medicine' }).map((row) => row.item_id)).toEqual([
      'a',
    ]);
  });

  it('matches low stock the same way lowStockItems does', () => {
    expect(filterInventory(items, { from: 'a', to: 'b', barangayId: null, stockLevel: 'low' }).map((row) => row.item_id)).toEqual([
      'a',
    ]);
    expect(
      filterInventory(items, { from: 'a', to: 'b', barangayId: null, stockLevel: 'sufficient' }).map((row) => row.item_id),
    ).toEqual(['b', 'c']);
  });

  // `reorder_level: 0` switches the warning off, even though stock 0 is at level 0.
  it('keeps a reorder_level of 0 out of "low", matching lowStockItems', () => {
    expect(filterInventory(items, { from: 'a', to: 'b', barangayId: null, stockLevel: 'low' })).not.toContainEqual(
      expect.objectContaining({ item_id: 'c' }),
    );
  });
});

const accountProfile = (
  user_id: string,
  role: 'admin' | 'barangay_admin' | 'bhw',
  is_active: boolean,
  barangay_id: string | null = null,
): AccountRow['profile'] => ({
  user_id,
  role,
  barangay_id,
  full_name: user_id,
  is_active,
  created_at: '',
  updated_at: '',
  created_by: null,
  disabled_at: null,
  disabled_by: null,
});

const account = (row: Partial<AccountRow> & { profile: AccountRow['profile'] }): AccountRow => ({
  purokName: null,
  assignedSince: null,
  purokId: null,
  barangayId: null,
  ...row,
});

describe('filterAccounts', () => {
  const rows = [
    account({ profile: accountProfile('rhu', 'admin', true) }),
    account({ profile: accountProfile('ba', 'barangay_admin', true, 'b1'), barangayId: 'b1' }),
    account({ profile: accountProfile('bhw-active', 'bhw', true), purokId: 'p1', barangayId: 'b1' }),
    account({ profile: accountProfile('bhw-inactive', 'bhw', false), purokId: 'p2', barangayId: 'b2' }),
  ];
  const ids = (filtered: AccountRow[]) => filtered.map((row) => row.profile.user_id);

  it('matches role', () => {
    expect(ids(filterAccounts(rows, { from: 'a', to: 'b', barangayId: null, accountRole: 'bhw' }))).toEqual([
      'bhw-active',
      'bhw-inactive',
    ]);
  });

  it('matches active state', () => {
    expect(ids(filterAccounts(rows, { from: 'a', to: 'b', barangayId: null, accountActive: 'inactive' }))).toEqual([
      'bhw-inactive',
    ]);
  });

  it('matches barangay', () => {
    expect(ids(filterAccounts(rows, { from: 'a', to: 'b', barangayId: 'b1' }))).toEqual(['ba', 'bhw-active']);
  });

  it('matches purok', () => {
    expect(ids(filterAccounts(rows, { from: 'a', to: 'b', barangayId: null, purokId: 'p2' }))).toEqual(['bhw-inactive']);
  });

  // A BHW's barangay is reachable only through their purok assignment.
  it('finds a BHW whose barangay is reached only through their purok', () => {
    expect(ids(filterAccounts(rows, { from: 'a', to: 'b', barangayId: 'b2' }))).toEqual(['bhw-inactive']);
  });
});

describe('birthdayRangeFor', () => {
  const on = new Date(2026, 7, 22); // 2026-08-22, local time, matching ageBandOf's own clock.

  // "Under 5" has no lower age limit, so it needs only a lower birthday bound.
  it('gives Under 5 no upper bound on the birthday, only a lower one', () => {
    expect(birthdayRangeFor('Under 5', on)).toEqual({ from: '2021-08-23', to: null });
  });

  it('brackets the middle bands on both sides', () => {
    expect(birthdayRangeFor('5 to 9', on)).toEqual({ from: '2016-08-23', to: '2021-08-22' });
    expect(birthdayRangeFor('10 to 19', on)).toEqual({ from: '2006-08-23', to: '2016-08-22' });
    expect(birthdayRangeFor('20 to 59', on)).toEqual({ from: '1966-08-23', to: '2006-08-22' });
  });

  // The band the plan calls out by name: nobody is too old to be in it.
  it('gives 60 and over no lower bound', () => {
    expect(birthdayRangeFor('60 and over', on)).toEqual({ from: null, to: '1966-08-22' });
  });

  it('agrees with ageBandOf at every boundary it computes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(on);

    for (const band of AGE_BANDS) {
      const range = birthdayRangeFor(band.label, on);

      if (range.to) {
        expect(ageBandOf(range.to)).toBe(band.label);
      }

      if (range.from) {
        expect(ageBandOf(range.from)).toBe(band.label);
      }
    }

    vi.useRealTimers();
  });
});

describe('nutritionByBarangay', () => {
  it('lands a household with no barangay_id in the Unassigned row rather than dropping it', () => {
    const snapshot: AdminSnapshot = {
      ...emptyAdminSnapshot,
      barangays: [{ barangay_id: 'b1', name: 'Cabugao', code: null, is_active: true, created_at: '', updated_at: '', created_by: null }],
      households: [{ household_id: 'h1', updated_at: '' }],
      residents: [{ resident_id: 'r1', household_id: 'h1', sex: 'female', birthday: '2000-01-01', updated_at: '' }],
      assessments: [assessment('a1', 'r1', '2026-05-01', 'underweight')],
    };

    const rows = nutritionByBarangay(snapshot);
    const unassigned = rows.find((row) => row.label === 'Unassigned');

    expect(unassigned).toBeDefined();
    expect(unassigned?.values).toEqual(NUTRITION_ORDER.map((status) => (status === 'underweight' ? 1 : 0)));
    // Nothing goes missing between the snapshot and the chart.
    expect(rows.reduce((sum, row) => sum + row.values.reduce((a, b) => a + b, 0), 0)).toBe(snapshot.assessments.length);
  });
});

describe('fetchAdminSnapshot purok narrowing', () => {
  beforeEach(() => {
    // The snapshot read is cached at module scope, so it outlives a test. Every
    // case here has to start from the network or it inherits the last one's rows.
    invalidateAdminSnapshot();
    fake.reads = 0;
    fake.tables = {
      barangays: [{ barangay_id: 'b1', name: 'Cabugao', code: null, is_active: true, created_at: '', updated_at: '', created_by: null }],
      puroks: [{ purok_id: 'p1', barangay_id: 'b1', name: 'Purok 1', code: null, is_active: true, created_at: '', updated_at: '', created_by: '' }],
      households: [
        { household_id: 'h1', purok_id: 'p1', barangay_id: 'b1', updated_at: '' },
        { household_id: 'h2', purok_id: 'p2', barangay_id: 'b1', updated_at: '' },
      ],
      individuals: [
        { resident_id: 'r1', household_id: 'h1', sex: 'female', birthday: '2000-01-01', updated_at: '', status: 'active' },
        { resident_id: 'r2', household_id: 'h2', sex: 'male', birthday: '2000-01-01', updated_at: '', status: 'active' },
      ],
      health_assessments: [assessment('a1', 'r1', '2026-05-01', 'normal'), assessment('a2', 'r2', '2026-05-02', 'normal')],
      supply_disbursements: [
        { ...release('d1', 'i1', 3), resident_id: 'r1' },
        { ...release('d2', 'i1', 5), resident_id: 'r2' },
      ],
      inventory_items: [item('i1', 'Rice', 20, 5)],
      inventory_allocations: [],
    };
  });

  it('drops another purok\'s residents, assessments and disbursements, but not the barangay-level inventory', async () => {
    const snapshot = await fetchAdminSnapshot({ from: '2026-01-01', to: '2026-12-31', barangayId: null, purokId: 'p1' });

    expect(snapshot.households.map((row) => row.household_id)).toEqual(['h1']);
    expect(snapshot.residents.map((row) => row.resident_id)).toEqual(['r1']);
    expect(snapshot.assessments.map((row) => row.assessment_id)).toEqual(['a1']);
    expect(snapshot.disbursements.map((row) => row.log_id)).toEqual(['d1']);
    // Stock is held at the barangay, so the purok filter must leave it alone.
    expect(snapshot.inventoryItems.map((row) => row.item_id)).toEqual(['i1']);
  });

  // The whole point of the cache: a scope change re-narrows rows already in
  // hand instead of re-reading eight tables to throw most of them away.
  it('serves a second scope over the same period without reading again', async () => {
    const period = { from: '2026-01-01', to: '2026-12-31' };

    const all = await fetchAdminSnapshot({ ...period, barangayId: null, purokId: null });
    const reads = fake.reads;

    expect(reads).toBeGreaterThan(0);

    const narrowed = await fetchAdminSnapshot({ ...period, barangayId: null, purokId: 'p1' });

    expect(fake.reads).toBe(reads);
    // Cached rows, but not a cached answer — the narrowing still ran.
    expect(all.residents.map((row) => row.resident_id)).toEqual(['r1', 'r2']);
    expect(narrowed.residents.map((row) => row.resident_id)).toEqual(['r1']);
  });

  it('reads again for another period, and after an invalidation', async () => {
    await fetchAdminSnapshot({ from: '2026-01-01', to: '2026-12-31', barangayId: null, purokId: null });
    const reads = fake.reads;

    // A different period is a different question, so the cache cannot answer it.
    await fetchAdminSnapshot({ from: '2026-01-01', to: '2026-06-30', barangayId: null, purokId: null });
    expect(fake.reads).toBeGreaterThan(reads);

    // And `refresh()` — the 60s poll, the return-to-tab re-read, a stock
    // movement — must always reach the network, period unchanged or not.
    const before = fake.reads;

    invalidateAdminSnapshot();
    await fetchAdminSnapshot({ from: '2026-01-01', to: '2026-06-30', barangayId: null, purokId: null });

    expect(fake.reads).toBeGreaterThan(before);
  });
});

describe('useAdminData URL round trip', () => {
  // `useSearchParams` needs a router and a DOM, so this exercises the plain
  // `URLSearchParams` logic the hook wraps.
  const sample: AdminFilters = {
    from: '2026-01-01',
    to: '2026-12-31',
    barangayId: 'b1',
    purokId: 'p1',
    sex: 'female',
    ageBand: '5 to 9',
    membership: 'active',
    itemType: 'medicine',
    stockLevel: 'low',
    accountRole: 'bhw',
    accountActive: 'active',
    reportSections: ['demographics', 'stock'],
  };

  it('carries every FILTER_PARAMS key, and the sections list, through a set/parse cycle', () => {
    const params = paramsFromFilters(new URLSearchParams(), sample);
    const parsed = filtersFromParams(params);

    expect(parsed).toEqual(sample);

    for (const [, param] of FILTER_PARAMS) {
      expect(params.get(param)).not.toBeNull();
    }
    expect(params.get('sections')).toBe('demographics,stock');
  });

  it('writes no param, and parses back null, for a key that is unset', () => {
    const params = paramsFromFilters(new URLSearchParams(), { from: '2026-01-01', to: '2026-12-31', barangayId: null });
    const parsed = filtersFromParams(params);

    for (const [key, param] of FILTER_PARAMS) {
      expect(params.has(param)).toBe(false);
      expect(parsed[key as keyof AdminFilters]).toBeNull();
    }
    expect(params.has('sections')).toBe(false);
    expect(parsed.reportSections).toBeNull();
  });

  // A malformed period does not fail a fetch, it throws inside `monthsIn` during
  // render, which unmounts the screen. Falling back to the default is what keeps
  // a hand-edited or truncated link from doing that.
  it('falls back to the default period when a date in the URL is not a date', () => {
    const fallback = defaultAdminFilters();

    for (const bad of ['garbage', '2026-13-01', '2026-02-31', '2026-09']) {
      const parsed = filtersFromParams(new URLSearchParams(`from=${bad}&to=${bad}`));

      expect(parsed.from).toBe(fallback.from);
      expect(parsed.to).toBe(fallback.to);
    }
  });

  it('keeps a valid period from the URL', () => {
    const parsed = filtersFromParams(new URLSearchParams('from=2026-01-01&to=2026-06-30'));

    expect(parsed).toMatchObject({ from: '2026-01-01', to: '2026-06-30' });
  });
});

describe('managesAccount', () => {
  it('lets an RHU admin manage every role', () => {
    expect(managesAccount('admin', 'admin')).toBe(true);
    expect(managesAccount('admin', 'barangay_admin')).toBe(true);
    expect(managesAccount('admin', 'bhw')).toBe(true);
  });

  it('lets a barangay admin manage health workers and nobody else', () => {
    expect(managesAccount('barangay_admin', 'bhw')).toBe(true);
    // A barangay administrator gets no controls on another administrator's row,
    // their own included.
    expect(managesAccount('barangay_admin', 'barangay_admin')).toBe(false);
    expect(managesAccount('barangay_admin', 'admin')).toBe(false);
  });

  it('gives a health worker and an unread role nothing', () => {
    expect(managesAccount('bhw', 'bhw')).toBe(false);
    expect(managesAccount(null, 'bhw')).toBe(false);
  });
});
