import { PULL_PAGE_SIZE, readAllPages, supabase } from '../lib/supabase';
import { ADULT_BMI_MIN_AGE, ageInYears } from '../lib/utils';
import type { ChartRow } from '../lib/charts';
import type {
  Barangay,
  BhwItemStock,
  BhwPurokAssignment,
  HealthAssessment,
  Individual,
  IndividualSex,
  InventoryAllocation,
  InventoryItem,
  InventoryItemType,
  NutritionStatus,
  Profile,
  Purok,
  ResidentStatus,
  SupplyDisbursement,
  UserRole,
} from '../types/database';

/** Admin portal reads. Goes to Supabase directly, never localDatabase; row scope is enforced by RLS. */

/** The period and scope a dashboard or report is filtered by. */
export type AdminFilters = {
  from: string;
  to: string;
  /** Barangay to narrow to, or null for every barangay the session can read. */
  barangayId: string | null;
  /** Purok to narrow to. Scopes residents, assessments and disbursements, never inventory. */
  purokId?: string | null;
  // Residents tab.
  sex?: IndividualSex | null;
  /** An `AGE_BANDS` label, converted to a birthday window by `birthdayRangeFor`. */
  ageBand?: string | null;
  /** Membership state to narrow to. Absent means every state. */
  membership?: ResidentStatus | null;
  // Inventory tab.
  itemType?: InventoryItemType | null;
  /** Stock level to narrow to, decided by `lowStockItems`. */
  stockLevel?: 'low' | 'sufficient' | null;
  // Accounts tab.
  accountRole?: UserRole | null;
  accountActive?: 'active' | 'inactive' | null;
  /** Which Reports cards to render. Absent or empty means all of them. */
  reportSections?: string[] | null;
};

/**
 * Each narrow filter's key paired with the URL param it rides in. `membership`
 * maps to `member` because `status` names the nutrition-band drill-down.
 * `reportSections` is a list and rides separately as a `sections` param.
 */
export const FILTER_PARAMS = [
  ['barangayId', 'barangay'],
  ['purokId', 'purok'],
  ['sex', 'sex'],
  ['ageBand', 'age'],
  ['membership', 'member'],
  ['itemType', 'type'],
  ['stockLevel', 'stock'],
  ['accountRole', 'role'],
  ['accountActive', 'active'],
] as const;

/** The Reports cards, as the slugs `reportSections` selects them by. */
export const REPORT_SECTIONS = [
  { id: 'demographics', label: 'Resident demographics' },
  { id: 'nutrition', label: 'Nutrition status' },
  { id: 'stock', label: 'Unallocated stock' },
  { id: 'supply', label: 'Supply allocation' },
] as const;

export type ReportSectionId = (typeof REPORT_SECTIONS)[number]['id'];

/** Whether a Reports card renders. An unset or empty list means every card. */
export function showsSection(filters: AdminFilters, id: ReportSectionId): boolean {
  return !filters.reportSections?.length || filters.reportSections.includes(id);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The selectable period ranges. `to` is always today. */
export const PERIOD_PRESETS = [
  { id: 'last30', label: 'Last 30 days', days: 30 },
  { id: 'last90', label: 'Last 90 days', days: 90 },
  { id: 'ytd', label: 'Year to date', days: null },
  { id: 'last12', label: 'Last 12 months', days: 365 },
] as const;

export type PeriodPresetId = (typeof PERIOD_PRESETS)[number]['id'];

export function presetRange(id: PeriodPresetId): { from: string; to: string } {
  const now = new Date();
  const preset = PERIOD_PRESETS.find((candidate) => candidate.id === id);

  return {
    from: preset?.days ? isoDay(new Date(now.getTime() - (preset.days - 1) * DAY_MS)) : `${now.getFullYear()}-01-01`,
    to: isoDay(now),
  };
}

/** Which preset the current range is, or null when it is a custom one. */
export function activePreset(filters: AdminFilters): PeriodPresetId | null {
  return (
    PERIOD_PRESETS.find((preset) => {
      const range = presetRange(preset.id);

      return range.from === filters.from && range.to === filters.to;
    })?.id ?? null
  );
}

/** The starting filters: year to date, every barangay. */
export function defaultAdminFilters(): AdminFilters {
  return { ...presetRange('ytd'), barangayId: null };
}

export function describePeriod(filters: AdminFilters): string {
  return `${filters.from} to ${filters.to}`;
}

/** The scope clause a caption and a CSV preamble both need, naming the purok too once one is set. */
export function describeScope(filters: AdminFilters, snapshot: Pick<AdminSnapshot, 'barangays' | 'puroks'>): string {
  if (!filters.barangayId) {
    return 'All barangays';
  }

  const barangayName = snapshot.barangays.find((barangay) => barangay.barangay_id === filters.barangayId)?.name ?? 'Unknown barangay';

  if (!filters.purokId) {
    return barangayName;
  }

  const purokName = snapshot.puroks.find((purok) => purok.purok_id === filters.purokId)?.name ?? 'Unknown purok';

  return `${barangayName} — ${purokName}`;
}

/** Only the resident columns the summaries need. `household_id` is how a resident reaches a barangay. */
export type AdminResident = Pick<Individual, 'resident_id' | 'household_id' | 'sex' | 'birthday' | 'updated_at'>;

/** Just enough of a household to place everything under it in a barangay. Both scope columns are trigger-stamped, so optional. */
export type AdminHousehold = {
  household_id: string;
  purok_id?: string;
  barangay_id?: string;
  updated_at: string;
};

export type AdminSnapshot = {
  /** Every barangay the session may read, for the scope picker and the map. */
  barangays: Barangay[];
  /** Every active purok the session may read, for the scope picker and `describeScope`. */
  puroks: Purok[];
  /** Households as rows, since every per-barangay figure joins through them. */
  households: AdminHousehold[];
  /** Totals, not period-scoped. */
  householdCount: number;
  residentCount: number;
  residents: AdminResident[];
  /** Period-scoped. */
  assessments: HealthAssessment[];
  disbursements: SupplyDisbursement[];
  /** A current stock position, so not period-scoped either. */
  inventoryItems: InventoryItem[];
  /** Stock handed from the barangay to a BHW, also a position. */
  allocations: InventoryAllocation[];
  /** The barangay this snapshot covers, as it should appear on an export. */
  barangayLabel: string;
  /** When this snapshot was read from the central database. */
  fetchedAt: string;
  /** Newest `updated_at` in the rows that came back, or null when none did. */
  newestRecordAt: string | null;
};

export const emptyAdminSnapshot: AdminSnapshot = {
  barangays: [],
  puroks: [],
  households: [],
  householdCount: 0,
  residentCount: 0,
  residents: [],
  assessments: [],
  disbursements: [],
  inventoryItems: [],
  allocations: [],
  barangayLabel: '',
  fetchedAt: new Date(0).toISOString(),
  newestRecordAt: null,
};

/**
 * Reads every table the admin portal summarises, then narrows to the filters.
 *
 * Every read is paged: a plain select stops at the server's row cap without
 * saying so, and a truncated count in an LGU report does not read as wrong. The
 * secondary sort is the primary key, so pages are a stable sequence.
 */
export async function fetchAdminSnapshot(filters: AdminFilters): Promise<AdminSnapshot> {
  const [barangays, puroks, households, residents, residentHouseholds, assessments, disbursements, inventory, allocations, barangayLabel] = await Promise.all([
    readAllPages<Barangay>('Barangay', (from, to) =>
      supabase.from('barangays').select('*').order('name').order('barangay_id').range(from, to),
    ),
    fetchActivePuroks(),
    // Rows rather than a count: `individuals` carries no barangay of its own, so
    // every per-barangay figure below joins through this list.
    readAllPages<AdminHousehold>('Household', (from, to) =>
      supabase
        .from('households')
        .select('household_id, purok_id, barangay_id, updated_at')
        .order('household_id')
        .range(from, to),
    ),
    // Active members only: someone who moved out or died is still on file, but
    // is not counted in the resident-facing demographics.
    readAllPages<AdminResident>('Resident', (from, to) =>
      supabase
        .from('individuals')
        .select('resident_id, household_id, sex, birthday, updated_at')
        .eq('status', 'active')
        .order('resident_id')
        .range(from, to),
    ),
    // Every status, id columns only: scopes assessments/disbursements below, which
    // must not drop a record just because the resident later changed status.
    readAllPages<Pick<AdminResident, 'resident_id' | 'household_id'>>('Resident (all statuses)', (from, to) =>
      supabase.from('individuals').select('resident_id, household_id').order('resident_id').range(from, to),
    ),
    readAllPages<HealthAssessment>('Health assessment', (from, to) =>
      supabase
        .from('health_assessments')
        .select('*')
        .gte('assessment_date', filters.from)
        .lte('assessment_date', filters.to)
        .order('assessment_date', { ascending: false })
        .order('assessment_id')
        .range(from, to),
    ),
    readAllPages<SupplyDisbursement>('Supply disbursement', (from, to) =>
      supabase
        .from('supply_disbursements')
        .select('*')
        .gte('disbursement_date', filters.from)
        .lte('disbursement_date', filters.to)
        .order('disbursement_date', { ascending: false })
        .order('log_id')
        .range(from, to),
    ),
    readAllPages<InventoryItem>('Inventory', (from, to) =>
      supabase.from('inventory_items').select('*').order('item_name').order('item_id').range(from, to),
    ),
    readAllPages<InventoryAllocation>('Allocation', (from, to) =>
      supabase
        .from('inventory_allocations')
        .select('*')
        .order('allocated_at', { ascending: false })
        .order('allocation_id')
        .range(from, to),
    ),
    fetchBarangayScope(),
  ]);

  // Narrow to the selected barangay and purok. Both reach everything below
  // through the household, the only table carrying `barangay_id`.
  const scope = filters.barangayId;
  const householdRows = households.filter(
    (household) => (!scope || household.barangay_id === scope) && (!filters.purokId || household.purok_id === filters.purokId),
  );
  const inScope = new Set(householdRows.map((household) => household.household_id));

  const residentRows = residents.filter((resident) => inScope.has(resident.household_id));

  // All statuses, not just active: a record made before a resident moved out or
  // died must still count in the period it happened.
  const scopedResidentIds = new Set(
    residentHouseholds.filter((resident) => inScope.has(resident.household_id)).map((resident) => resident.resident_id),
  );

  const assessmentRows = assessments.filter((row) => scopedResidentIds.has(row.resident_id));
  const disbursementRows = disbursements.filter((row) => scopedResidentIds.has(row.resident_id));
  // Barangay-scoped only: stock is held at the barangay, not per purok.
  const inventoryRows = inventory.filter((item) => !scope || item.barangay_id === scope);
  const itemIds = new Set(inventoryRows.map((item) => item.item_id));
  const allocationRows = allocations.filter((row) => itemIds.has(row.item_id));

  return {
    barangays,
    puroks,
    households: householdRows,
    householdCount: householdRows.length,
    residentCount: residentRows.length,
    residents: residentRows,
    assessments: assessmentRows,
    disbursements: disbursementRows,
    inventoryItems: inventoryRows,
    allocations: allocationRows,
    barangayLabel,
    fetchedAt: new Date().toISOString(),
    newestRecordAt: newest([...residentRows, ...assessmentRows, ...disbursementRows, ...inventoryRows]),
  };
}

/** What an export should call the area it covers: one barangay by name, or the whole unit for an RHU account. */
export async function fetchBarangayScope(): Promise<string> {
  const [scope, barangays] = await Promise.all([
    // Null for an RHU account.
    supabase.rpc('current_barangay_id'),
    readAllPages<{ barangay_id: string; name: string }>('Barangay', (from, to) =>
      supabase.from('barangays').select('barangay_id, name').order('name').order('barangay_id').range(from, to),
    ),
  ]);

  if (scope.error) {
    throw new Error(scope.error.message);
  }

  return describeBarangayScope(scope.data, barangays);
}

export function describeBarangayScope(scopeId: string | null, barangays: { barangay_id: string; name: string }[]): string {
  if (scopeId) {
    return barangays.find((barangay) => barangay.barangay_id === scopeId)?.name ?? 'Barangay name not configured';
  }

  if (barangays.length === 1) {
    return barangays[0].name;
  }

  if (barangays.length === 0) {
    return 'Barangay name not configured';
  }

  return `All barangays (${barangays.length}) — Rural Health Unit`;
}

/** The newest `updated_at` across the rows, or null when there are none. */
function newest(rows: { updated_at: string }[]): string | null {
  return rows.reduce<string | null>((latest, row) => (!latest || row.updated_at > latest ? row.updated_at : latest), null);
}

/**
 * How many assessments in this set were taken on someone under
 * `ADULT_BMI_MIN_AGE` — the rows the adult BMI band classifies nothing for.
 */
export function assessmentsBelowAdultBmiAge(
  assessments: { resident_id: string }[],
  residents: { resident_id: string; birthday: string }[],
  on: Date = new Date(),
): number {
  const birthdays = new Map(residents.map((resident) => [resident.resident_id, resident.birthday]));

  return assessments.filter((assessment) => {
    const birthday = birthdays.get(assessment.resident_id);
    // An unknown resident is not counted.
    if (!birthday) {
      return false;
    }

    const age = ageInYears(birthday, on);
    return age !== null && age < ADULT_BMI_MIN_AGE;
  }).length;
}

/** One row of a distribution summary. */
export type Tally = {
  label: string;
  count: number;
};

/** Counts rows by a key. `order` fixes the categories and keeps the zeroes. */
export function tally<Row>(rows: Row[], key: (row: Row) => string | null, order?: readonly string[]): Tally[] {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const value = key(row);
    if (value !== null) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }

  if (order) {
    return order.map((label) => ({ label, count: counts.get(label) ?? 0 }));
  }

  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

export const NUTRITION_ORDER: readonly NutritionStatus[] = ['underweight', 'normal', 'overweight', 'obese'];

/** Demographic age bands, matching the ones Philippine barangay health reporting uses. */
export const AGE_BANDS = [
  { label: 'Under 5', min: 0, max: 4 },
  { label: '5 to 9', min: 5, max: 9 },
  { label: '10 to 19', min: 10, max: 19 },
  { label: '20 to 59', min: 20, max: 59 },
  { label: '60 and over', min: 60, max: Infinity },
] as const;

export function ageBandOf(birthday: string): string | null {
  const age = ageInYears(birthday);

  if (age === null || age < 0) {
    return null;
  }

  return AGE_BANDS.find((band) => age >= band.min && age <= band.max)?.label ?? null;
}

/** A calendar date shifted back whole years, in local time. */
function yearsBefore(date: Date, years: number): Date {
  return new Date(date.getFullYear() - years, date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** `YYYY-MM-DD` off a date's local calendar parts, not `isoDay`'s UTC ones. */
function isoLocalDay(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * The birthday window a resident in this `AGE_BANDS` label falls in, as
 * `.gte`/`.lte` bounds — the query-side counterpart to `ageBandOf`. An open-
 * ended band returns null for the bound it does not need.
 */
export function birthdayRangeFor(label: string, on: Date = new Date()): { from: string | null; to: string | null } {
  const band = AGE_BANDS.find((candidate) => candidate.label === label);

  if (!band) {
    return { from: null, to: null };
  }

  const to = band.min > 0 ? isoLocalDay(yearsBefore(on, band.min)) : null;
  const from = Number.isFinite(band.max) ? isoLocalDay(addDays(yearsBefore(on, band.max + 1), 1)) : null;

  return { from, to };
}

/** Unallocated stock at or below this is an alert. Measures what is left to hand out, not total held. */
export const LOW_STOCK_THRESHOLD = 10;

/** The level to warn at: the item's own, or the shared fallback for one never given a level. */
export function reorderLevelOf(item: InventoryItem): number {
  return item.reorder_level ?? LOW_STOCK_THRESHOLD;
}

/** Items at or below their own warning level. A level of 0 turns the warning off for that item. */
export function lowStockItems(items: InventoryItem[]): InventoryItem[] {
  return items.filter((item) => {
    const level = reorderLevelOf(item);

    return level > 0 && item.current_stock <= level;
  });
}

/** Inventory rows the Inventory tab's scope filters match. Low stock is decided by `lowStockItems`. */
export function filterInventory(items: InventoryItem[], filters: AdminFilters): InventoryItem[] {
  const low = new Set(lowStockItems(items).map((item) => item.item_id));

  return items.filter((item) => {
    if (filters.itemType && item.type !== filters.itemType) {
      return false;
    }

    if (filters.stockLevel === 'low' && !low.has(item.item_id)) {
      return false;
    }

    if (filters.stockLevel === 'sufficient' && low.has(item.item_id)) {
      return false;
    }

    return true;
  });
}

/** Quantity released per item over the period, largest first. */
export function disbursementsByItem(disbursements: SupplyDisbursement[], items: InventoryItem[]): Tally[] {
  const names = new Map(items.map((item) => [item.item_id, item.item_name]));
  const totals = new Map<string, number>();

  for (const disbursement of disbursements) {
    const name = names.get(disbursement.item_id) ?? 'Unknown item';
    totals.set(name, (totals.get(name) ?? 0) + disbursement.quantity);
  }

  return [...totals.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

/** BHW accounts with their current purok. Three plain queries joined in memory, since the embeds are untyped here. */
export type AccountRow = {
  profile: Profile;
  purokName: string | null;
  assignedSince: string | null;
  /** The purok a BHW currently carries the assignment for, or null for a desk account or an unassigned BHW. */
  purokId: string | null;
  /**
   * The barangay this row belongs to. Reached through the purok assignment for
   * a BHW, whose profile carries none, and off the profile for a `barangay_admin`.
   */
  barangayId: string | null;
};

export async function fetchAccounts(): Promise<AccountRow[]> {
  // Paged: the accounts table reports its own row count as the total, so a
  // read stopping at the server's cap would look complete.
  const [profiles, assignments, puroks] = await Promise.all([
    readAllPages<Profile>('Account', (from, to) =>
      supabase.from('profiles').select('*').order('full_name').order('user_id').range(from, to),
    ),
    readAllPages<BhwPurokAssignment>('Purok assignment', (from, to) =>
      supabase.from('bhw_purok_assignments').select('*').is('ended_at', null).order('assignment_id').range(from, to),
    ),
    readAllPages<Purok>('Purok', (from, to) =>
      supabase.from('puroks').select('*').order('purok_id').range(from, to),
    ),
  ]);

  const purokNames = new Map(puroks.map((purok: Purok) => [purok.purok_id, purok.name]));
  const purokBarangays = new Map(puroks.map((purok: Purok) => [purok.purok_id, purok.barangay_id]));
  const active = new Map(assignments.map((assignment) => [assignment.bhw_id, assignment]));

  return profiles.map((profile) => {
    const assignment = active.get(profile.user_id);
    const purokId = assignment?.purok_id ?? null;

    return {
      profile,
      purokName: assignment ? purokNames.get(assignment.purok_id) ?? null : null,
      assignedSince: assignment?.started_at ?? null,
      purokId,
      barangayId: (purokId ? purokBarangays.get(purokId) : undefined) ?? profile.barangay_id ?? null,
    };
  });
}

/**
 * Whether this session may act on that account, which decides only whether the
 * Accounts table draws its buttons. Enforcement is
 * `private.assert_can_manage_bhw()`, which both account RPCs open with.
 * Barangay is absent because rows outside one never reach the client.
 */
export function managesAccount(viewer: UserRole | null, account: UserRole): boolean {
  if (viewer === 'admin') {
    return true;
  }

  return viewer === 'barangay_admin' && account === 'bhw';
}

/** Account rows the Accounts tab's scope filters match: role, active state, barangay and purok. */
export function filterAccounts(rows: AccountRow[], filters: AdminFilters): AccountRow[] {
  return rows.filter((row) => {
    if (filters.accountRole && row.profile.role !== filters.accountRole) {
      return false;
    }

    if (filters.accountActive === 'active' && !row.profile.is_active) {
      return false;
    }

    if (filters.accountActive === 'inactive' && row.profile.is_active) {
      return false;
    }

    if (filters.barangayId && row.barangayId !== filters.barangayId) {
      return false;
    }

    if (filters.purokId && row.purokId !== filters.purokId) {
      return false;
    }

    return true;
  });
}

export type ResidentPage = {
  rows: Individual[];
  total: number;
};

/** Strips characters PostgREST reads as filter syntax before the search feeds into `.or()`. */
function sanitizeSearch(query: string): string {
  return query
    .trim()
    .replace(/[,()*%\\".']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
/**
 * A drill-down from a dashboard bar: residents whose assessment in the period
 * landed in one nutrition band. Carries its own period, since the status lives
 * on `health_assessments` rather than on the resident.
 */
export type ResidentStatusFilter = {
  status: NutritionStatus;
  from: string;
  to: string;
};

/** Resident ids with an assessment in the band over the period. Someone assessed twice appears under both bands. */
async function residentIdsWithStatus(filter: ResidentStatusFilter): Promise<string[]> {
  const rows = await readAllPages<{ resident_id: string; assessment_id: string }>('Assessment band', (from, to) =>
    supabase
      .from('health_assessments')
      .select('resident_id, assessment_id')
      .eq('nutrition_status', filter.status)
      .gte('assessment_date', filter.from)
      .lte('assessment_date', filter.to)
      .order('assessment_id')
      .range(from, to),
  );

  return [...new Set(rows.map((row) => row.resident_id))];
}

/**
 * One page of the central resident registry, with the household number and
 * barangay name joined in from `households` by a second query.
 *
 * `statusFilter` is separate from `filters` because it arrives only from the
 * dashboard's nutrition-band drill-down and names a period of its own.
 */
export async function fetchResidentPage(
  query: string,
  limit: number,
  offset: number,
  filters: AdminFilters,
  statusFilter?: ResidentStatusFilter,
): Promise<ResidentPage> {
  const search = sanitizeSearch(query);
  let request = supabase.from('individuals').select('*', { count: 'exact' });

  if (filters.barangayId || filters.purokId) {
    const scoped = await readAllPages<{ household_id: string }>('Barangay household', (from, to) => {
      let householdQuery = supabase.from('households').select('household_id').order('household_id');

      if (filters.barangayId) {
        householdQuery = householdQuery.eq('barangay_id', filters.barangayId);
      }

      if (filters.purokId) {
        householdQuery = householdQuery.eq('purok_id', filters.purokId);
      }

      return householdQuery.range(from, to);
    });

    const scopedIds = scoped.map((household) => household.household_id);

    // An empty barangay or purok is an empty registry, not an unfiltered one:
    // `.in()` rejects an empty list, and dropping the filter widens the scope.
    if (!scopedIds.length) {
      return { rows: [], total: 0 };
    }

    request = request.in('household_id', scopedIds);
  }

  if (filters.sex) {
    request = request.eq('sex', filters.sex);
  }

  if (filters.ageBand) {
    const range = birthdayRangeFor(filters.ageBand);

    if (range.from) {
      request = request.gte('birthday', range.from);
    }

    if (range.to) {
      request = request.lte('birthday', range.to);
    }
  }

  if (filters.membership) {
    request = request.eq('status', filters.membership);
  }

  if (statusFilter) {
    const residentIds = await residentIdsWithStatus(statusFilter);

    // Nobody in the band means an empty page, not an unfiltered one.
    if (!residentIds.length) {
      return { rows: [], total: 0 };
    }

    // ponytail: the ids ride in the URL, so a barangay-scale band (hundreds) is
    // fine and tens of thousands would not be. Move to an RPC or a view joining
    // the two tables if a period ever returns that many.
    request = request.in('resident_id', residentIds);
  }

  if (search) {
    // Paged: past the server's cap the `.in()` clause below would lose household ids.
    const households = await readAllPages<{ household_id: string }>('Household search', (from, to) =>
      supabase
        .from('households')
        .select('household_id')
        .ilike('household_number', `%${search}%`)
        .order('household_id')
        .range(from, to),
    );
    const householdIds = households.map((household) => household.household_id);
    const clauses = [`first_name.ilike.%${search}%`, `last_name.ilike.%${search}%`];

    if (householdIds.length) {
      clauses.push(`household_id.in.(${householdIds.join(',')})`);
    }

    request = request.or(clauses.join(','));
  }

  const { data, count, error } = await request.order('last_name').range(offset, offset + limit - 1);

  if (error) {
    throw new Error(error.message);
  }

  const rows = data ?? [];
  const householdIds = [...new Set(rows.map((row) => row.household_id))];
  // One page of households, so the barangay names come along in the same round trip.
  const [households, barangays] = await Promise.all([
    householdIds.length
      ? supabase.from('households').select('household_id, household_number, barangay_id').in('household_id', householdIds)
      : Promise.resolve({ data: [] as { household_id: string; household_number: string; barangay_id: string | null }[] }),
    supabase.from('barangays').select('barangay_id, name'),
  ]);

  const barangayNames = new Map((barangays.data ?? []).map((barangay) => [barangay.barangay_id, barangay.name]));
  const parents = new Map((households.data ?? []).map((household) => [household.household_id, household]));

  return {
    rows: rows.map((row) => {
      const parent = parents.get(row.household_id);

      return {
        ...row,
        household_number: parent?.household_number,
        barangay_name: parent?.barangay_id ? barangayNames.get(parent.barangay_id) : undefined,
      };
    }),
    total: count ?? 0,
  };
}

/**
 * Every resident the current filters match, followed page by page to the end.
 * Takes the reader rather than calling `fetchResidentPage`, so the paging can
 * be exercised without a network.
 */
export async function readAllResidentPages(
  read: (offset: number) => Promise<ResidentPage>,
): Promise<Individual[]> {
  const rows: Individual[] = [];

  for (let offset = 0; ; offset += PULL_PAGE_SIZE) {
    const page = await read(offset);
    rows.push(...page.rows);

    // A short page ends the set; the total stops a reader that keeps handing
    // back full pages from looping forever.
    if (page.rows.length < PULL_PAGE_SIZE || rows.length >= page.total) {
      return rows;
    }
  }
}

// -----------------------------------------------------------------------------
// Supply stock — the barangay administrator's write paths. All are RPCs, since
// `inventory_items` has no INSERT/UPDATE policy: the function also writes the
// audit event. An RHU admin calling one gets `insufficient_privilege`.
// -----------------------------------------------------------------------------

/** The BHWs a barangay administrator may allocate to. */
export async function fetchAllocatableBhws(): Promise<AccountRow[]> {
  const accounts = await fetchAccounts();

  // An unassigned BHW has no barangay and the RPC refuses them.
  return accounts.filter((account) => account.profile.role === 'bhw' && account.purokName !== null);
}

export async function createInventoryItem(name: string, type: InventoryItemType, openingStock: number): Promise<void> {
  const { error } = await supabase.rpc('barangay_admin_create_item', {
    target_item_name: name,
    target_type: type,
    target_initial_stock: openingStock,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function restockInventoryItem(itemId: string, quantity: number, reason: string): Promise<void> {
  const { error } = await supabase.rpc('barangay_admin_restock_item', {
    target_item_id: itemId,
    target_quantity: quantity,
    target_reason: reason,
  });

  if (error) {
    throw new Error(error.message);
  }
}

/** Sets the level an item warns at. 0 turns the warning off for that item. */
export async function setReorderLevel(itemId: string, level: number): Promise<void> {
  const { error } = await supabase.rpc('barangay_admin_set_reorder_level', {
    target_item_id: itemId,
    target_level: level,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function allocateStockToBhw(itemId: string, bhwId: string, quantity: number, reason: string): Promise<void> {
  const { error } = await supabase.rpc('barangay_admin_allocate_stock', {
    target_item_id: itemId,
    target_bhw_id: bhwId,
    target_quantity: quantity,
    target_reason: reason,
  });

  if (error) {
    throw new Error(error.message);
  }
}

/** The puroks an assignment can name. `admin_assign_bhw_to_purok` rejects inactive ones. */
export async function fetchActivePuroks(): Promise<Purok[]> {
  return readAllPages<Purok>('Purok', (from, to) =>
    supabase.from('puroks').select('*').eq('is_active', true).order('name').order('purok_id').range(from, to),
  );
}

/**
 * Account mutations, both through `admin_*` SECURITY DEFINER RPCs rather than
 * table writes: each asserts an active admin and writes the audit event in the
 * same transaction. `reason` is what that audit row carries.
 */
export async function setProfileActive(userId: string, makeActive: boolean, reason: string): Promise<void> {
  const { error } = await supabase.rpc('admin_set_profile_active', {
    target_user_id: userId,
    make_active: makeActive,
    change_reason: reason,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function assignBhwToPurok(bhwId: string, purokId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('admin_assign_bhw_to_purok', {
    target_bhw_id: bhwId,
    target_purok_id: purokId,
    assignment_reason: reason,
  });

  if (error) {
    throw new Error(error.message);
  }
}
export const SHADED_STATUS: NutritionStatus = 'underweight';

export type BarangayStats = {
  /** Empty string for the households no barangay has been stamped on. */
  barangayId: string;
  name: string;
  households: number;
  residents: number;
  /** Assessments recorded in the period, not residents. */
  assessments: number;
  /** Distinct residents with at least one assessment in the period. */
  residentsAssessed: number;
  underweight: number;
  /** Share of this barangay's assessments, null when it recorded none. */
  underweightRate: number | null;
  /** Share of its registered residents assessed at all, null when it has none. */
  coverageRate: number | null;
  unitsReleased: number;
};

/**
 * Every resident's barangay, reached through their household — the only row
 * that records one. Empty string covers an unstamped household and a missing
 * one alike, which both callers fold into an "Unassigned" bucket.
 */
function residentBarangayMap(snapshot: Pick<AdminSnapshot, 'households' | 'residents'>): Map<string, string> {
  const householdBarangay = new Map(
    snapshot.households.map((household) => [household.household_id, household.barangay_id ?? '']),
  );

  return new Map(
    snapshot.residents.map((resident) => [resident.resident_id, householdBarangay.get(resident.household_id) ?? '']),
  );
}

/**
 * One row per barangay, which the map, the comparison table and the coverage
 * panel all render from. Barangays holding nothing still appear, with zeroes.
 */
export function barangayStats(snapshot: AdminSnapshot): BarangayStats[] {
  const residentBarangay = residentBarangayMap(snapshot);

  const rows = new Map<string, BarangayStats>();
  const blank = (barangayId: string, name: string): BarangayStats => ({
    barangayId,
    name,
    households: 0,
    residents: 0,
    assessments: 0,
    residentsAssessed: 0,
    underweight: 0,
    underweightRate: null,
    coverageRate: null,
    unitsReleased: 0,
  });

  for (const barangay of snapshot.barangays) {
    rows.set(barangay.barangay_id, blank(barangay.barangay_id, barangay.name));
  }

  const at = (barangayId: string): BarangayStats => {
    const existing = rows.get(barangayId);

    if (existing) {
      return existing;
    }

    // A household with no barangay, or one outside the list the session can
    // name. Counted rather than dropped.
    const created = blank(barangayId, barangayId ? 'Unknown barangay' : 'Unassigned');
    rows.set(barangayId, created);

    return created;
  };

  for (const household of snapshot.households) {
    at(household.barangay_id ?? '').households += 1;
  }

  for (const resident of snapshot.residents) {
    at(residentBarangay.get(resident.resident_id) ?? '').residents += 1;
  }

  const assessedResidents = new Map<string, Set<string>>();

  for (const assessment of snapshot.assessments) {
    const barangayId = residentBarangay.get(assessment.resident_id) ?? '';
    const row = at(barangayId);

    row.assessments += 1;

    if (assessment.nutrition_status === SHADED_STATUS) {
      row.underweight += 1;
    }

    const seen = assessedResidents.get(barangayId) ?? new Set<string>();
    seen.add(assessment.resident_id);
    assessedResidents.set(barangayId, seen);
  }

  for (const disbursement of snapshot.disbursements) {
    at(residentBarangay.get(disbursement.resident_id) ?? '').unitsReleased += disbursement.quantity;
  }

  for (const [barangayId, row] of rows) {
    row.residentsAssessed = assessedResidents.get(barangayId)?.size ?? 0;
    row.underweightRate = row.assessments ? row.underweight / row.assessments : null;
    row.coverageRate = row.residents ? row.residentsAssessed / row.residents : null;
  }

  // Unassigned last, then by name: it is a data-quality row, not a barangay.
  return [...rows.values()].sort((a, b) =>
    a.barangayId === b.barangayId ? 0 : !a.barangayId ? 1 : !b.barangayId ? -1 : a.name.localeCompare(b.name),
  );
}

/** One `ChartRow` per barangay, its four values in `NUTRITION_ORDER`, for the Analytics nutrition mix. */
export function nutritionByBarangay(snapshot: AdminSnapshot): ChartRow[] {
  const residentBarangay = residentBarangayMap(snapshot);
  const rows = new Map<string, { barangayId: string; name: string; counts: Map<NutritionStatus, number> }>();

  const at = (barangayId: string, name: string) => {
    const existing = rows.get(barangayId);

    if (existing) {
      return existing;
    }

    const created = { barangayId, name, counts: new Map<NutritionStatus, number>() };
    rows.set(barangayId, created);

    return created;
  };

  for (const barangay of snapshot.barangays) {
    at(barangay.barangay_id, barangay.name);
  }

  for (const assessment of snapshot.assessments) {
    const barangayId = residentBarangay.get(assessment.resident_id) ?? '';
    const row = at(barangayId, barangayId ? 'Unknown barangay' : 'Unassigned');

    row.counts.set(assessment.nutrition_status, (row.counts.get(assessment.nutrition_status) ?? 0) + 1);
  }

  // Unassigned last, then by name, matching `barangayStats`.
  return [...rows.values()]
    .sort((a, b) => (a.barangayId === b.barangayId ? 0 : !a.barangayId ? 1 : !b.barangayId ? -1 : a.name.localeCompare(b.name)))
    .map((row) => ({
      key: row.barangayId,
      label: row.name,
      values: NUTRITION_ORDER.map((status) => row.counts.get(status) ?? 0),
    }));
}

export type TrendPoint = {
  /** `2026-03`, so points sort as strings. */
  month: string;
  label: string;
  assessments: number;
  underweight: number;
  rate: number | null;
};

/** Every month in the filtered period, in order, including the empty ones a chart must still draw at zero. */
export function monthsIn(filters: AdminFilters): { month: string; label: string }[] {
  const months: { month: string; label: string }[] = [];
  const start = new Date(`${filters.from.slice(0, 7)}-01T00:00:00Z`);
  const end = `${filters.to.slice(0, 7)}`;

  // ponytail: 36 months is the ceiling. A longer range would draw a column per
  // month across a dashboard card; bucket by year here if one is ever asked for.
  for (let step = 0; step < 36; step += 1) {
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + step, 1));
    const month = cursor.toISOString().slice(0, 7);

    months.push({
      month,
      label: cursor.toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' }),
    });

    if (month >= end) {
      break;
    }
  }

  return months;
}

export function monthlyTrend(assessments: HealthAssessment[], filters: AdminFilters): TrendPoint[] {
  const counts = new Map<string, { assessments: number; underweight: number }>();

  for (const assessment of assessments) {
    const month = assessment.assessment_date.slice(0, 7);
    const bucket = counts.get(month) ?? { assessments: 0, underweight: 0 };

    bucket.assessments += 1;
    if (assessment.nutrition_status === SHADED_STATUS) {
      bucket.underweight += 1;
    }
    counts.set(month, bucket);
  }

  return monthsIn(filters).map(({ month, label }) => {
    const bucket = counts.get(month) ?? { assessments: 0, underweight: 0 };

    return {
      month,
      label,
      assessments: bucket.assessments,
      underweight: bucket.underweight,
      rate: bucket.assessments ? bucket.underweight / bucket.assessments : null,
    };
  });
}

/** Supply movement over the same months `monthsIn` gives the assessment trend. */
export function monthlyReleases(
  disbursements: SupplyDisbursement[],
  filters: AdminFilters,
): { month: string; label: string; units: number; releases: number }[] {
  const totals = new Map<string, { units: number; releases: number }>();

  for (const disbursement of disbursements) {
    const month = disbursement.disbursement_date.slice(0, 7);
    const bucket = totals.get(month) ?? { units: 0, releases: 0 };

    bucket.units += disbursement.quantity;
    bucket.releases += 1;
    totals.set(month, bucket);
  }

  return monthsIn(filters).map(({ month, label }) => {
    const bucket = totals.get(month) ?? { units: 0, releases: 0 };

    return { month, label, units: bucket.units, releases: bucket.releases };
  });
}

export type ItemUtilization = {
  itemId: string;
  itemName: string;
  type: InventoryItemType;
  /** Barangay stock not yet handed to any BHW. */
  onHand: number;
  /** Cumulative, not period-scoped. */
  allocated: number;
  /** Released to residents during the selected period. */
  releasedInPeriod: number;
  reorderLevel: number;
};

/**
 * Where each item's stock sits, and how much of it moved. The three numbers do
 * not sum: two are positions and `releasedInPeriod` is a flow over the filter's
 * range. What a BHW still carries is `bhw_item_stock`.
 */
export function supplyUtilization(snapshot: AdminSnapshot): ItemUtilization[] {
  const allocated = new Map<string, number>();
  const released = new Map<string, number>();

  for (const allocation of snapshot.allocations) {
    allocated.set(allocation.item_id, (allocated.get(allocation.item_id) ?? 0) + allocation.quantity);
  }

  for (const disbursement of snapshot.disbursements) {
    released.set(disbursement.item_id, (released.get(disbursement.item_id) ?? 0) + disbursement.quantity);
  }

  return snapshot.inventoryItems
    .map((item) => ({
      itemId: item.item_id,
      itemName: item.item_name,
      type: item.type,
      onHand: item.current_stock,
      allocated: allocated.get(item.item_id) ?? 0,
      releasedInPeriod: released.get(item.item_id) ?? 0,
      reorderLevel: item.reorder_level ?? 0,
    }))
    .sort((a, b) => b.releasedInPeriod - a.releasedInPeriod || a.itemName.localeCompare(b.itemName));
}

/** What each BHW is still carrying, per item, from the `bhw_item_stock` view. */
export async function fetchBhwStock(): Promise<BhwItemStock[]> {
  return readAllPages<BhwItemStock>('Carried stock', (from, to) =>
    supabase.from('bhw_item_stock').select('*').order('item_name').order('item_id').range(from, to),
  );
}
