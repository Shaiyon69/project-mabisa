import { supabase } from '../lib/supabase';
import { ageInYears } from '../lib/utils';
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
 * Where the admin portal gets its numbers.
 *
 * This module exists because of one defect: every admin page used to read
 * `useMabisaData().snapshot`, which is the *admin browser's own* local SQLite
 * mirror — a BHW cache that on an LGU workstation is empty, and on a shared
 * machine holds whatever the last field device happened to sync. FR-06 requires
 * the central PostgreSQL database. Nothing here touches localDatabase.
 *
 * Which rows come back is settled by the policies in `barangay_roles.sql`, not
 * re-filtered here. An RHU admin reads every barangay; a barangay administrator
 * reads their own and nothing else; the other four tables reach that scope
 * through their foreign keys. Adding a client-side filter would be a second copy
 * of the rule to keep in step with the first.
 */

/**
 * The period a dashboard or report is scoped to. FR-06 requires every summary to
 * state its period, so the filter travels *with* the data rather than living
 * only in the control that set it — a caption cannot drift from its numbers if
 * it is rendered from the same object.
 */
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

export function describePeriod(filters: AdminFilters): string {
  return `${filters.from} to ${filters.to}`;
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
  /**
   * The barangay this snapshot covers, spelled the way it should appear on the
   * face of an export. Read from the data rather than from the build, because
   * one database now holds every barangay in the RHU.
   */
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

export async function fetchAdminSnapshot(filters: AdminFilters): Promise<AdminSnapshot> {
  const [households, residents, assessments, disbursements, inventory, barangayLabel] = await Promise.all([
    // head:true asks for the count without the rows — the dashboard needs the
    // number of households, never the households themselves.
    supabase.from('households').select('household_id', { count: 'exact', head: true }),
    supabase.from('individuals').select('resident_id, sex, birthday, updated_at'),
    supabase
      .from('health_assessments')
      .select('*')
      .gte('assessment_date', filters.from)
      .lte('assessment_date', filters.to)
      .order('assessment_date', { ascending: false }),
    supabase
      .from('supply_disbursements')
      .select('*')
      .gte('disbursement_date', filters.from)
      .lte('disbursement_date', filters.to)
      .order('disbursement_date', { ascending: false }),
    supabase.from('inventory_items').select('*').order('item_name'),
    fetchBarangayScope(),
  ]);

  const failure = [households, residents, assessments, disbursements, inventory].find((result) => result.error);
  if (failure?.error) {
    throw new Error(failure.error.message);
  }

  const residentRows = (residents.data ?? []) as AdminResident[];
  const assessmentRows = assessments.data ?? [];
  const disbursementRows = disbursements.data ?? [];
  const inventoryRows = inventory.data ?? [];

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
 * What an export should call the area it covers.
 *
 * A barangay administrator is confined to one, so it is named. An RHU account is
 * confined to none and its rows may span several, so naming any single barangay
 * would put a false heading on a true report — it gets the whole unit instead,
 * with the count, so a reader can tell a municipal summary from a barangay one at
 * a glance.
 *
 * Exported for its test: this is the line an official LGU document is captioned
 * with, and getting it wrong is worse than leaving it blank.
 */
export async function fetchBarangayScope(): Promise<string> {
  const [scope, barangays] = await Promise.all([
    // Null for an RHU account, which is confined to no barangay. That null is the
    // answer, not a missing one.
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

/**
 * Data freshness, per FR-06. The fetch timestamp only says when the portal
 * asked; this says how recently a field device actually contributed something,
 * which is the number that tells an official whether the barangay has synced.
 */
function newest(rows: { updated_at: string }[]): string | null {
  return rows.reduce<string | null>((latest, row) => (!latest || row.updated_at > latest ? row.updated_at : latest), null);
}

/** One row of a distribution summary. */
export type Tally = {
  label: string;
  count: number;
};

/**
 * Counts rows by a key. `order` fixes the categories and keeps the zeroes — a
 * nutrition distribution that silently drops `obese` because nobody fell in it
 * reads as a missing category rather than as an empty one. Without `order` the
 * categories are whatever appeared, largest first.
 */
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

/**
 * Demographic age bands, not a health classification — they group residents for
 * a headcount and carry no judgement about any of them. The boundaries follow
 * the bands Philippine barangay health reporting already uses, so a MABISA
 * summary lines up with the forms an LGU officer is used to.
 */
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
 * Unallocated stock at or below this is called out as an alert. Matches
 * InventoryTable.
 *
 * It measures what is left to hand out, not what the barangay owns: an item can
 * read as low here while its health workers are carrying plenty. That is the
 * useful reading for the person doing the allocating, and the wrong one for
 * anyone deciding whether to reorder — which is why every surface that shows it
 * says "unallocated" rather than "on hand".
 */
export const LOW_STOCK_THRESHOLD = 10;

export function lowStockItems(items: InventoryItem[]): InventoryItem[] {
  return items.filter((item) => item.current_stock <= LOW_STOCK_THRESHOLD);
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
 * BHW accounts with their current purok, for FR-08's read-only half.
 *
 * Three plain queries joined in memory rather than one PostgREST embed: the
 * `Database` type declares no relationships, so an embedded select would come
 * back untyped and defeat the point of the typed client. There are as many rows
 * here as there are health workers in one barangay.
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

/**
 * Strips the characters PostgREST reads as filter syntax. A search box feeds
 * straight into `.or()`, where a comma or a parenthesis is not a character in a
 * surname but a new condition.
 */
function sanitizeSearch(query: string): string {
  return query
    .trim()
    .replace(/[,()*%\\".']/g, ' ')
    .replace(/'/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * One page of the central resident registry.
 *
 * `household_number` lives on `households`, not on `individuals`, so it takes a
 * second query keyed by the page's household ids — ten of them, not the whole
 * barangay. The same lookup runs first when the search term might *be* a
 * household number, since PostgREST cannot filter a row by a column on its
 * parent without an embed.
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
// Supply stock — the barangay administrator's three write paths
//
// All three are RPCs rather than table writes, and that is the enforcement, not a
// convenience: `inventory_items` has a SELECT policy and no INSERT or UPDATE
// policy at all, so a stock figure cannot be changed except through a function
// that also writes the audit event explaining it. An RHU admin calling any of
// these gets `insufficient_privilege` from the database — reads are their whole
// remit, and hiding the controls from them is cosmetics on top of that.
// -----------------------------------------------------------------------------

/** The BHWs a barangay administrator may allocate to. RLS already limits the rows to their own barangay. */
export async function fetchAllocatableBhws(): Promise<AccountRow[]> {
  const accounts = await fetchAccounts();

  // An unassigned BHW has no purok and therefore no barangay, and the RPC will
  // refuse them. Leaving them out of the picker means the refusal is not a
  // surprise arriving after the form is filled in.
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
