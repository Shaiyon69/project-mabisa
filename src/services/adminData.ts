import { readAllPages, supabase } from '../lib/supabase';
import { ADULT_BMI_MIN_AGE, ageInYears } from '../lib/utils';
import type {
  HealthAssessment,
  Individual,
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
};

/** Year to date: the period an LGU report is usually asked for. */
export function defaultAdminFilters(): AdminFilters {
  const now = new Date();

  return {
    from: `${now.getFullYear()}-01-01`,
    to: now.toISOString().slice(0, 10),
  };
}

/** Only the columns the demographic summaries need. */
export type AdminResident = Pick<Individual, 'resident_id' | 'sex' | 'birthday' | 'updated_at'>;

export type AdminSnapshot = {
  /** Totals, not period-scoped: a household does not stop existing outside the range. */
  householdCount: number;
  residentCount: number;
  residents: AdminResident[];
  /** Period-scoped, per FR-06 ("assessments during a selected period"). */
  assessments: HealthAssessment[];
  disbursements: SupplyDisbursement[];
  /** Stock is a current position, so it ignores the period too. */
  inventoryItems: InventoryItem[];
  /** The barangay this snapshot covers, spelled as it should appear on an export. */
  barangayLabel: string;
  /** When this snapshot was read from the central database. */
  fetchedAt: string;
  /** Newest `updated_at` in the rows that came back, or null when none did. */
  newestRecordAt: string | null;
};

export const emptyAdminSnapshot: AdminSnapshot = {
  householdCount: 0,
  residentCount: 0,
  residents: [],
  assessments: [],
  disbursements: [],
  inventoryItems: [],
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
  const [households, residentRows, assessmentRows, disbursementRows, inventoryRows, barangayLabel] = await Promise.all([
    // head:true asks for the count without the rows.
    supabase.from('households').select('household_id', { count: 'exact', head: true }),
    // Active members only: a resident who moved out or died is still on file, but
    // counting her as profiled today would overstate the population served.
    readAllPages<AdminResident>('Resident', (from, to) =>
      supabase
        .from('individuals')
        .select('resident_id, sex, birthday, updated_at')
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
    fetchBarangayScope(),
  ]);

  if (households.error) {
    throw new Error(households.error.message);
  }

  return {
    householdCount: households.count ?? 0,
    residentCount: residentRows.length,
    residents: residentRows,
    assessments: assessmentRows,
    disbursements: disbursementRows,
    inventoryItems: inventoryRows,
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
    supabase.from('barangays').select('barangay_id, name').order('name'),
  ]);

  if (scope.error) {
    throw new Error(scope.error.message);
  }

  if (barangays.error) {
    throw new Error(barangays.error.message);
  }

  return describeBarangayScope(scope.data, barangays.data ?? []);
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
  const [profiles, assignments, puroks] = await Promise.all([
    supabase.from('profiles').select('*').order('full_name'),
    supabase.from('bhw_purok_assignments').select('*').is('ended_at', null),
    supabase.from('puroks').select('*'),
  ]);

  const failure = [profiles, assignments, puroks].find((result) => result.error);
  if (failure?.error) {
    throw new Error(failure.error.message);
  }

  const purokNames = new Map((puroks.data ?? []).map((purok: Purok) => [purok.purok_id, purok.name]));
  const active = new Map((assignments.data ?? []).map((assignment) => [assignment.bhw_id, assignment]));

  return (profiles.data ?? []).map((profile) => {
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
 * One page of the central resident registry. `household_number` lives on
 * `households`, so it takes a second query keyed by the page's household ids —
 * also run first, in case the search term is itself a household number.
 */
export async function fetchResidentPage(query: string, limit: number, offset: number): Promise<ResidentPage> {
  const search = sanitizeSearch(query);
  let request = supabase.from('individuals').select('*', { count: 'exact' });

  if (search) {
    const households = await supabase.from('households').select('household_id').ilike('household_number', `%${search}%`);
    const householdIds = (households.data ?? []).map((household) => household.household_id);
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
  const households = householdIds.length
    ? await supabase.from('households').select('household_id, household_number').in('household_id', householdIds)
    : { data: [] as { household_id: string; household_number: string }[] };

  const numbers = new Map((households.data ?? []).map((household) => [household.household_id, household.household_number]));

  return {
    rows: rows.map((row) => ({ ...row, household_number: numbers.get(row.household_id) })),
    total: count ?? 0,
  };
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
