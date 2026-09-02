import { PULL_PAGE_SIZE, readAllPages, supabase } from '../lib/supabase';
import { ADULT_BMI_MIN_AGE, ageInYears } from '../lib/utils';
import type {
  Barangay,
  BhwItemStock,
  BhwPurokAssignment,
  HealthAssessment,
  Individual,
  InventoryAllocation,
  InventoryItem,
  InventoryItemType,
  NutritionStatus,
  Profile,
  Purok,
  SupplyDisbursement,
} from '../types/database';

/**
 * Where the admin portal gets its numbers — reads Supabase directly, never
 * localDatabase. Row scope (RHU sees every barangay, a barangay_admin only its
 * own) is enforced by `barangay_roles.sql`, not re-filtered here.
 */

/** The period a dashboard/report is scoped to — travels with the data so a caption can't drift from its numbers. */
export type AdminFilters = {
  from: string;
  to: string;
  /**
   * Which barangay the screen is scoped to, or null for every barangay the
   * session can read. This is a *narrowing* of what RLS already allows, never a
   * widening: a `barangay_admin` who clears it still sees only their own, and an
   * `admin` who sets it is choosing to look at one of the several they may read.
   */
  barangayId: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The ranges an LGU officer actually asks for, as one list so the chips, the
 * default and the "which chip is lit" test cannot drift apart.
 *
 * `to` is always today: a period ending in the future would caption a report
 * with a range no record can fall in.
 */
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

/**
 * Which preset the current range *is*, or null when it is a custom one. Derived
 * rather than stored, so a range that arrived in a shared link still lights the
 * chip it corresponds to instead of showing as custom.
 */
export function activePreset(filters: AdminFilters): PeriodPresetId | null {
  return (
    PERIOD_PRESETS.find((preset) => {
      const range = presetRange(preset.id);

      return range.from === filters.from && range.to === filters.to;
    })?.id ?? null
  );
}

/** Year to date: the period an LGU report is usually asked for. */
export function defaultAdminFilters(): AdminFilters {
  return { ...presetRange('ytd'), barangayId: null };
}

export function describePeriod(filters: AdminFilters): string {
  return `${filters.from} to ${filters.to}`;
}

/** The barangay clause a caption and a CSV preamble both need. */
export function describeScope(filters: AdminFilters, barangays: Barangay[]): string {
  if (!filters.barangayId) {
    return 'All barangays';
  }

  return barangays.find((barangay) => barangay.barangay_id === filters.barangayId)?.name ?? 'Unknown barangay';
}

/**
 * Only the columns the summaries need. `household_id` is here because every
 * barangay-level number on this portal is reached through it: `individuals`
 * carries no barangay of its own, and `households.barangay_id` is the single
 * place membership is recorded.
 */
export type AdminResident = Pick<Individual, 'resident_id' | 'household_id' | 'sex' | 'birthday' | 'updated_at'>;

/**
 * Just enough of a household to place everything under it in a barangay. Both
 * scope columns are optional for the same reason they are on `Household`: they
 * are trigger-stamped, so a row can exist without them.
 */
export type AdminHousehold = {
  household_id: string;
  purok_id?: string;
  barangay_id?: string;
  updated_at: string;
};

export type AdminSnapshot = {
  /** Every barangay the session may read, for the scope picker and the map. */
  barangays: Barangay[];
  /**
   * Households as rows rather than a bare count. The count is still what the
   * dashboard tile shows, but every per-barangay figure on this portal is a join
   * through this list — `individuals`, `health_assessments` and
   * `supply_disbursements` all reach a barangay only via the household.
   */
  households: AdminHousehold[];
  /** Totals, not period-scoped: a household does not stop existing outside the range. */
  householdCount: number;
  residentCount: number;
  residents: AdminResident[];
  /** Period-scoped, per FR-06 ("assessments during a selected period"). */
  assessments: HealthAssessment[];
  disbursements: SupplyDisbursement[];
  /** Stock is a current position, so it ignores the period too. */
  inventoryItems: InventoryItem[];
  /** Stock handed from the barangay to a BHW. Also a position, not a period figure. */
  allocations: InventoryAllocation[];
  /** The barangay this snapshot covers, spelled as it should appear on an export. */
  barangayLabel: string;
  /** When this snapshot was read from the central database. */
  fetchedAt: string;
  /** Newest `updated_at` in the rows that came back, or null when none did. */
  newestRecordAt: string | null;
};

export const emptyAdminSnapshot: AdminSnapshot = {
  barangays: [],
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
 * Every read here is paged rather than a bare `select`.
 *
 * A plain select stops at the server's row cap and reports nothing about it, so
 * past that many rows the resident count, every chart band and every CSV export
 * read as complete while describing only the first page. The counts are the
 * dangerous part: a truncated figure in an LGU report is not obviously wrong to
 * the person reading it. The secondary sort is the primary key so pages are a
 * stable sequence — the date columns repeat freely, and without a tiebreak a row
 * could shuffle across a page seam and be read twice or not at all.
 *
 * The field tables were empty when this was written, so the cap has never
 * actually been hit. It costs one helper to make sure it never is.
 */
export async function fetchAdminSnapshot(filters: AdminFilters): Promise<AdminSnapshot> {
  const [barangays, households, residents, assessments, disbursements, inventory, allocations, barangayLabel] = await Promise.all([
    readAllPages<Barangay>('Barangay', (from, to) =>
      supabase.from('barangays').select('*').order('name').order('barangay_id').range(from, to),
    ),
    // Rows rather than a count: `individuals` carries no barangay of its own, so
    // every per-barangay figure below is a join through this list.
    readAllPages<AdminHousehold>('Household', (from, to) =>
      supabase
        .from('households')
        .select('household_id, purok_id, barangay_id, updated_at')
        .order('household_id')
        .range(from, to),
    ),
    // Active members only: a resident who moved out or died is still on file, but
    // counting her as profiled today would overstate the population served.
    readAllPages<AdminResident>('Resident', (from, to) =>
      supabase
        .from('individuals')
        .select('resident_id, household_id, sex, birthday, updated_at')
        .eq('status', 'active')
        .order('resident_id')
        .range(from, to),
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

  // The barangay filter narrows what RLS already allowed; it never widens it. An
  // `admin` picking one of several is choosing what to look at, and a
  // `barangay_admin` who clears it still reads only the one barangay the policies
  // let through. Everything below is placed by its household, because that is the
  // only table carrying `barangay_id`.
  const scope = filters.barangayId;
  const householdRows = households.filter((household) => !scope || household.barangay_id === scope);
  const inScope = new Set(householdRows.map((household) => household.household_id));

  const residentRows = residents.filter((resident) => inScope.has(resident.household_id));
  const residentIds = new Set(residentRows.map((resident) => resident.resident_id));

  const assessmentRows = assessments.filter((row) => residentIds.has(row.resident_id));
  const disbursementRows = disbursements.filter((row) => residentIds.has(row.resident_id));
  const inventoryRows = inventory.filter((item) => !scope || item.barangay_id === scope);
  const itemIds = new Set(inventoryRows.map((item) => item.item_id));
  const allocationRows = allocations.filter((row) => itemIds.has(row.item_id));

  return {
    barangays,
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

/**
 * What an export should call the area it covers: a barangay administrator's own
 * barangay by name, or the whole unit (with a count) for an RHU account whose
 * rows may span several — naming any single one would be a false heading.
 */
export async function fetchBarangayScope(): Promise<string> {
  const [scope, barangays] = await Promise.all([
    // Null for an RHU account — that's the answer, not a missing one.
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

/** How recently a field device actually contributed something, vs. just when the portal asked. */
function newest(rows: { updated_at: string }[]): string | null {
  return rows.reduce<string | null>((latest, row) => (!latest || row.updated_at > latest ? row.updated_at : latest), null);
}

/**
 * How many assessments in this set were taken on someone under `ADULT_BMI_MIN_AGE`.
 *
 * The status column is an adult BMI band on every row, so these are the rows where
 * it classifies nothing. The portal reader never saw the caveat the BHW saw at the
 * point of measurement, and a bar chart hides ages entirely — so the count is
 * reported alongside the summary rather than quietly folded into it.
 */
export function assessmentsBelowAdultBmiAge(
  assessments: { resident_id: string }[],
  residents: { resident_id: string; birthday: string }[],
  on: Date = new Date(),
): number {
  const birthdays = new Map(residents.map((resident) => [resident.resident_id, resident.birthday]));

  return assessments.filter((assessment) => {
    const birthday = birthdays.get(assessment.resident_id);
    // An unknown resident is not evidence of a child — don't inflate the caveat.
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

/** Counts rows by a key. `order` fixes the categories and keeps the zeroes (an empty category shouldn't look missing). */
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

/** Demographic age bands (not a health classification) matching the bands Philippine barangay health reporting already uses. */
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

/**
 * Unallocated stock at or below this is an alert (matches InventoryTable). Measures
 * what's left to hand out, not total held — an item can read low here while its
 * BHWs carry plenty, which is why every surface says "unallocated" not "on hand".
 */
export const LOW_STOCK_THRESHOLD = 10;

/** The level to warn at: the item's own, or the shared fallback for one never given a level. */
export function reorderLevelOf(item: InventoryItem): number {
  return item.reorder_level ?? LOW_STOCK_THRESHOLD;
}

/**
 * Items at or below their own warning level. A level of 0 is the office switching the
 * warning off for that item — a one-off delivery of leaflets should not sit in the
 * alert count forever once it runs out.
 */
export function lowStockItems(items: InventoryItem[]): InventoryItem[] {
  return items.filter((item) => {
    const level = reorderLevelOf(item);

    return level > 0 && item.current_stock <= level;
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

/**
 * BHW accounts with their current purok. Three plain queries joined in memory,
 * not a PostgREST embed — the `Database` type declares no relationships, so an
 * embed would come back untyped.
 */
export type AccountRow = {
  profile: Profile;
  purokName: string | null;
  assignedSince: string | null;
};

export async function fetchAccounts(): Promise<AccountRow[]> {
  // Paged, not a bare select: the accounts table reports its own row count as the
  // total, so a read that stopped at the server's cap would look complete.
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
  const active = new Map(assignments.map((assignment) => [assignment.bhw_id, assignment]));

  return profiles.map((profile) => {
    const assignment = active.get(profile.user_id);

    return {
      profile,
      purokName: assignment ? purokNames.get(assignment.purok_id) ?? null : null,
      assignedSince: assignment?.started_at ?? null,
    };
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
 * A drill-down from a dashboard bar: the residents whose assessment in the
 * period landed in one nutrition band.
 *
 * Held separately from the search term because it resolves through a different
 * table — the status lives on `health_assessments`, not on the resident — and
 * because it carries the period, which the registry otherwise ignores.
 */
export type ResidentStatusFilter = {
  status: NutritionStatus;
  from: string;
  to: string;
};

/**
 * Resident ids with an assessment in the band over the period.
 *
 * A resident assessed twice in the period with two different results appears
 * under both, which is the honest answer for a period summary: the dashboard bar
 * counted both assessments too, so the list and the bar agree.
 */
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
 * One page of the central resident registry.
 *
 * `household_number` and the barangay live on `households`, not on
 * `individuals`, so they take a second query keyed by the page's household ids —
 * ten of them, not the whole barangay. The same lookup runs first when the
 * search term might *be* a household number, and again when a barangay is
 * selected, since PostgREST cannot filter a row by a column on its parent
 * without an embed and the embeds are untyped here (`Relationships` is empty).
 */
export async function fetchResidentPage(
  query: string,
  limit: number,
  offset: number,
  statusFilter?: ResidentStatusFilter,
  barangayId?: string | null,
): Promise<ResidentPage> {
  const search = sanitizeSearch(query);
  let request = supabase.from('individuals').select('*', { count: 'exact' });

  if (barangayId) {
    const scoped = await readAllPages<{ household_id: string }>('Barangay household', (from, to) =>
      supabase.from('households').select('household_id').eq('barangay_id', barangayId).order('household_id').range(from, to),
    );

    const scopedIds = scoped.map((household) => household.household_id);

    // A barangay with no households is an empty registry, not an unfiltered one —
    // `.in()` rejects an empty list, and dropping the filter would show every
    // barangay under a heading naming one.
    if (!scopedIds.length) {
      return { rows: [], total: 0 };
    }

    request = request.in('household_id', scopedIds);
  }

  if (statusFilter) {
    const residentIds = await residentIdsWithStatus(statusFilter);

    // Nobody in the band means an empty page, not an unfiltered one, for the same
    // reason as the barangay clause above.
    if (!residentIds.length) {
      return { rows: [], total: 0 };
    }

    // ponytail: the ids ride in the URL, so a barangay-scale band (hundreds) is
    // fine and tens of thousands would not be. Move to an RPC or a view joining
    // the two tables if a period ever returns that many.
    request = request.in('resident_id', residentIds);
  }

  if (search) {
    // Paged: past the server's cap the `.in()` clause below would quietly lose
    // household ids, and the search would under-return with nothing to show for it.
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
  // One page of households, so the barangay names come along in the same round
  // trip rather than costing a third query. `barangays` is readable by any active
  // profile, so the lookup never returns fewer names than the page needs.
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
 *
 * An export cannot ask for the whole set in one range: the server trims it to
 * `PULL_PAGE_SIZE` and says nothing, so the file stops at a thousand rows while
 * printing its own row count as though it were complete. Takes the reader rather
 * than calling `fetchResidentPage` itself, so the paging can be exercised without
 * a network.
 */
export async function readAllResidentPages(
  read: (offset: number) => Promise<ResidentPage>,
): Promise<Individual[]> {
  const rows: Individual[] = [];

  for (let offset = 0; ; offset += PULL_PAGE_SIZE) {
    const page = await read(offset);
    rows.push(...page.rows);

    // A short page is the end of the set; the total is the belt to that braces,
    // and stops a reader that keeps handing back full pages from looping forever.
    if (page.rows.length < PULL_PAGE_SIZE || rows.length >= page.total) {
      return rows;
    }
  }
}

// -----------------------------------------------------------------------------
// Supply stock — the barangay administrator's three write paths. All three are
// RPCs, not table writes: `inventory_items` has no INSERT/UPDATE policy at all,
// so a stock change is only ever possible through a function that also writes
// the audit event. An RHU admin calling any of these gets `insufficient_privilege`.
// -----------------------------------------------------------------------------

/** The BHWs a barangay administrator may allocate to. RLS already limits the rows to their own barangay. */
export async function fetchAllocatableBhws(): Promise<AccountRow[]> {
  const accounts = await fetchAccounts();

  // An unassigned BHW has no barangay and the RPC will refuse them — leave them
  // out of the picker rather than surprise the admin after the form is filled in.
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

/**
 * The puroks an assignment can name. Inactive ones are excluded rather than
 * shown greyed out: `admin_assign_bhw_to_purok` rejects them, so offering one
 * is offering a button that can only fail.
 */
export async function fetchActivePuroks(): Promise<Purok[]> {
  return readAllPages<Purok>('Purok', (from, to) =>
    supabase.from('puroks').select('*').eq('is_active', true).order('name').order('purok_id').range(from, to),
  );
}

/**
 * Account mutations, both through the `admin_*` SECURITY DEFINER RPCs.
 *
 * Never a direct table write. Each RPC asserts an active admin and writes an
 * audit event in the same transaction as the change, which is the whole reason
 * the foundation slice withholds table-level grants — a direct update from this
 * client would succeed at nothing except losing the audit trail.
 *
 * The reason string is required by the function signature and is what the audit
 * row carries, so the UI must collect it rather than send a placeholder.
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
 * One row per barangay, which is what the map, the comparison table and the
 * coverage panel are all rendered from.
 *
 * Computed once from the snapshot rather than three times from three queries, so
 * a barangay cannot show one resident count on the map and another in the table
 * beside it. Barangays the session can read but that hold nothing still appear,
 * with zeroes — a barangay missing from a comparison reads as an omission.
 */
export function barangayStats(snapshot: AdminSnapshot): BarangayStats[] {
  const householdBarangay = new Map(
    snapshot.households.map((household) => [household.household_id, household.barangay_id ?? '']),
  );
  const residentBarangay = new Map(
    snapshot.residents.map((resident) => [resident.resident_id, householdBarangay.get(resident.household_id) ?? '']),
  );

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

    // A household whose barangay was never stamped, or one outside the list the
    // session can name. Counted rather than dropped: a total that silently
    // excludes rows is the way a dashboard lies.
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

  // Unassigned last, then by name: it is a data-quality row, not a barangay, and
  // sorting it in among real ones invites it being read as one.
  return [...rows.values()].sort((a, b) =>
    a.barangayId === b.barangayId ? 0 : !a.barangayId ? 1 : !b.barangayId ? -1 : a.name.localeCompare(b.name),
  );
}

export type TrendPoint = {
  /** `2026-03`, so points sort as strings. */
  month: string;
  label: string;
  assessments: number;
  underweight: number;
  rate: number | null;
};

/**
 * Assessments per month across the selected period, with the underweight share
 * of each.
 *
 * Every month in the range is emitted, including the empty ones. A trend drawn
 * only from the months that have data is not a trend — it hides exactly the gap
 * an officer is looking for, which is the month nobody was assessed.
 */
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

  const points: TrendPoint[] = [];
  const start = new Date(`${filters.from.slice(0, 7)}-01T00:00:00Z`);
  const end = `${filters.to.slice(0, 7)}`;

  // ponytail: 36 months is the ceiling. A longer range would draw a column per
  // month across a dashboard card; bucket by year here if one is ever asked for.
  for (let step = 0; step < 36; step += 1) {
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + step, 1));
    const month = cursor.toISOString().slice(0, 7);
    const bucket = counts.get(month) ?? { assessments: 0, underweight: 0 };

    points.push({
      month,
      label: cursor.toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' }),
      assessments: bucket.assessments,
      underweight: bucket.underweight,
      rate: bucket.assessments ? bucket.underweight / bucket.assessments : null,
    });

    if (month >= end) {
      break;
    }
  }

  return points;
}

export type ItemUtilization = {
  itemId: string;
  itemName: string;
  type: InventoryItemType;
  /** Barangay stock not yet handed to any BHW — what `current_stock` means once allocation is in use. */
  onHand: number;
  /** Cumulative, not period-scoped: an allocation is a position, like stock. */
  allocated: number;
  /** Released to residents during the selected period. */
  releasedInPeriod: number;
  reorderLevel: number;
};

/**
 * Where each item's stock currently sits, and how much of it moved.
 *
 * The three numbers are deliberately not made to add up to a single total:
 * `onHand` and `allocated` are positions and `releasedInPeriod` is a flow over
 * the filter's range, so subtracting one from another would produce a figure
 * that is true only when the period covers all of time. What a BHW still
 * carries is `bhw_item_stock`, which the database computes.
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

/**
 * What each BHW is still carrying, per item, from the `bhw_item_stock` view.
 *
 * Read from the view rather than subtracted here: the arithmetic (allocations
 * minus releases) is the database's, so the portal and the field app cannot
 * disagree about how much a health worker has left.
 */
export async function fetchBhwStock(): Promise<BhwItemStock[]> {
  return readAllPages<BhwItemStock>('Carried stock', (from, to) =>
    supabase.from('bhw_item_stock').select('*').order('item_name').order('item_id').range(from, to),
  );
}
