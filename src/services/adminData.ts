import { supabase } from '../lib/supabase';
import { ageInYears } from '../lib/utils';
import type {
  Barangay,
  BhwItemStock,
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
 * Where the admin portal gets its numbers.
 *
 * This module exists because of one defect: every admin page used to read
 * `useMabisaData().snapshot`, which is the *admin browser's own* local SQLite
 * mirror — a BHW cache that on an LGU workstation is empty, and on a shared
 * machine holds whatever the last field device happened to sync. FR-06 requires
 * the central PostgreSQL database. Nothing here touches localDatabase.
 *
 * Which rows come back is settled by the purok policies in 202608160002, not
 * re-filtered here: `is_admin()` opens `households` to the whole barangay and
 * the other four reach that scope through their foreign keys. An admin sees
 * every synchronized purok; a non-admin session reaching this code sees only
 * its own, which is the same answer the route guard gives.
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

/** Just enough of a household to place everything under it in a barangay. */
export type AdminHousehold = {
  household_id: string;
  purok_id: string | null;
  barangay_id: string | null;
  updated_at: string;
};

export type AdminSnapshot = {
  /** Every barangay the session may read, for the scope picker and the map. */
  barangays: Barangay[];
  /**
   * Households as rows rather than a bare count. The count is still what the
   * dashboard tile shows, but every per-barangay figure on this portal is a
   * join through this list — `individuals`, `health_assessments` and
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
  fetchedAt: new Date(0).toISOString(),
  newestRecordAt: null,
};

/** One page of a paged read. PostgREST's own ceiling is at or below this. */
const PAGE_SIZE = 1000;

type PagedResult<Row> = { data: Row[] | null; error: { message: string } | null };

/**
 * Every row a query matches, not the first page of them.
 *
 * PostgREST caps an unbounded `select()` at a server-side maximum — 1000 rows by
 * default — and returns the truncated set with no error and no marker. A
 * barangay of a few thousand residents therefore reads back as exactly 1000, and
 * every total, rate and export computed from it is quietly wrong in a way that
 * looks entirely plausible. So each read is paged until a short page arrives.
 *
 * ponytail: fine at barangay scale — a few round trips on a wired workstation.
 * If the portal ever covers a city, move the aggregates into an RPC and stop
 * shipping rows to the browser at all.
 */
async function fetchAllRows<Row>(page: (from: number, to: number) => PromiseLike<PagedResult<Row>>): Promise<Row[]> {
  const rows: Row[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await page(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error(error.message);
    }

    const batch = data ?? [];
    rows.push(...batch);

    if (batch.length < PAGE_SIZE) {
      return rows;
    }
  }
}

/**
 * Reads the central database once, then narrows to the chosen barangay in
 * memory.
 *
 * ponytail: the scope filter is applied here rather than in the query because
 * only `households` and `inventory_items` carry `barangay_id` — the other three
 * would each need an embed or an RPC to be filtered server-side, and a barangay
 * is a few thousand rows. If a deployment ever reaches tens of thousands of
 * residents, move this to a `barangay_admin_snapshot(from, to, barangay)` RPC
 * returning the aggregates rather than the rows.
 */
export async function fetchAdminSnapshot(filters: AdminFilters): Promise<AdminSnapshot> {
  const [barangays, households, residents, assessments, disbursements, inventory, allocations] = await Promise.all([
    fetchAllRows((from, to) => supabase.from('barangays').select('*').order('name').range(from, to)),
    // Ordered by primary key so the pages partition the table: without an order
    // the same row can appear on two pages and another on none.
    fetchAllRows((from, to) =>
      supabase
        .from('households')
        .select('household_id, purok_id, barangay_id, updated_at')
        .order('household_id')
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from('individuals')
        .select('resident_id, household_id, sex, birthday, updated_at')
        .order('resident_id')
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from('health_assessments')
        .select('*')
        .gte('assessment_date', filters.from)
        .lte('assessment_date', filters.to)
        .order('assessment_date', { ascending: false })
        .order('assessment_id')
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from('supply_disbursements')
        .select('*')
        .gte('disbursement_date', filters.from)
        .lte('disbursement_date', filters.to)
        .order('disbursement_date', { ascending: false })
        .order('log_id')
        .range(from, to),
    ),
    fetchAllRows((from, to) => supabase.from('inventory_items').select('*').order('item_name').order('item_id').range(from, to)),
    fetchAllRows((from, to) =>
      supabase
        .from('inventory_allocations')
        .select('*')
        .order('allocated_at', { ascending: false })
        .order('allocation_id')
        .range(from, to),
    ),
  ]);

  const scope = filters.barangayId;
  const householdRows = (households as AdminHousehold[]).filter(
    (household) => !scope || household.barangay_id === scope,
  );
  const inScope = new Set(householdRows.map((household) => household.household_id));

  const residentRows = (residents as AdminResident[]).filter((resident) => inScope.has(resident.household_id));
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
    fetchedAt: new Date().toISOString(),
    newestRecordAt: newest([...residentRows, ...assessmentRows, ...disbursementRows, ...inventoryRows]),
  };
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
 * the bands Philippine barangay health reporting already uses, so a BRHP-MSAM
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

/** Stock at or below this is called out as an alert. Matches InventoryTable. */
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
 * The band the barangay comparison and the map are shaded on.
 *
 * Deliberately `underweight` alone, and deliberately not called "malnutrition"
 * anywhere a user can read: the scale produces a reading, not a diagnosis, and
 * over-nutrition bands are a different question from the one an LGU officer
 * asks when they look at this map. Every caption says "underweight rate" and
 * names its denominator.
 */
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

/**
 * The puroks an assignment can name. Inactive ones are excluded rather than
 * shown greyed out: `admin_assign_bhw_to_purok` rejects them, so offering one
 * is offering a button that can only fail.
 */
export async function fetchActivePuroks(): Promise<Purok[]> {
  const { data, error } = await supabase.from('puroks').select('*').eq('is_active', true).order('name');

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
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

/**
 * Stock movement, all four through `barangay_admin_*` SECURITY DEFINER RPCs for
 * the same reason the account mutations go through `admin_*`: each asserts an
 * active barangay admin, moves the stock and writes the audit event in one
 * transaction, and the tables withhold the grants that would let a direct write
 * succeed at anything except losing the audit trail.
 *
 * `allocate` additionally refuses to over-allocate and refuses a BHW outside the
 * caller's barangay — both checked in the function, so this client never has to
 * decide either. An `admin` (RHU/LGU) session is rejected by all four: stock
 * belongs to a barangay, and an account above that scope has no barangay to
 * spend from.
 */
export async function allocateStock(itemId: string, bhwId: string, quantity: number, reason: string): Promise<void> {
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

export async function restockItem(itemId: string, quantity: number, reason: string): Promise<void> {
  const { error } = await supabase.rpc('barangay_admin_restock_item', {
    target_item_id: itemId,
    target_quantity: quantity,
    target_reason: reason,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function createInventoryItem(
  itemName: string,
  type: InventoryItemType,
  initialStock: number,
): Promise<void> {
  const { error } = await supabase.rpc('barangay_admin_create_item', {
    target_item_name: itemName,
    target_type: type,
    target_initial_stock: initialStock,
  });

  if (error) {
    throw new Error(error.message);
  }
}

/**
 * What each BHW is still carrying, per item, from the `bhw_item_stock` view.
 *
 * Read from the view rather than subtracted here: the arithmetic (allocations
 * minus releases) is the database's, so the portal and the field app cannot
 * disagree about how much a health worker has left.
 */
export async function fetchBhwStock(): Promise<BhwItemStock[]> {
  const { data, error } = await supabase.from('bhw_item_stock').select('*').order('item_name');

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
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
  const rows = await fetchAllRows((from, to) =>
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

export async function fetchResidentPage(
  query: string,
  limit: number,
  offset: number,
  statusFilter?: ResidentStatusFilter,
  barangayId?: string | null,
): Promise<ResidentPage> {
  const search = sanitizeSearch(query);
  let request = supabase.from('individuals').select('*', { count: 'exact' });

  // A barangay narrows the registry through the household, the only row that
  // records membership. Same shape as the search's household-number lookup
  // below: PostgREST cannot filter a row on a column of its parent without an
  // embed, and the embeds are untyped here because `Relationships` is empty.
  if (barangayId) {
    const scoped = await fetchAllRows((from, to) =>
      supabase.from('households').select('household_id').eq('barangay_id', barangayId).order('household_id').range(from, to),
    );

    const scopedIds = scoped.map((household) => household.household_id);

    // A barangay with no households is an empty registry, not an unfiltered
    // one — `.in()` rejects an empty list, and dropping the filter would show
    // every barangay under a heading naming one.
    if (!scopedIds.length) {
      return { rows: [], total: 0 };
    }

    request = request.in('household_id', scopedIds);
  }

  if (statusFilter) {
    const residentIds = await residentIdsWithStatus(statusFilter);

    // Nobody in the band means an empty page, not an unfiltered one — an `.in()`
    // on an empty list is a filter PostgREST will not accept, and dropping the
    // filter would show the whole registry under a heading that says otherwise.
    if (!residentIds.length) {
      return { rows: [], total: 0 };
    }

    // ponytail: the ids ride in the URL, so a barangay-scale band (hundreds)
    // is fine and tens of thousands would not be. Move to an RPC or a view
    // joining the two tables if a period ever returns that many.
    request = request.in('resident_id', residentIds);
  }

  if (search) {
    const households = await fetchAllRows((from, to) =>
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
  // Ten households, so the barangay names come along in the same round trip
  // rather than costing a third query. `barangays` is readable by any active
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
 * Every resident the current filters match, for the CSV export.
 *
 * `fetchResidentPage` cannot do this in one call: PostgREST caps a response at
 * a server-side row limit regardless of the `.range()` asked for, so a single
 * oversized page silently returns a prefix and the export would disagree with
 * the count printed beside it. Paging until a short batch arrives is the same
 * rule `fetchAllRows` follows, expressed one level up because the page function
 * owns the search, status and barangay filters.
 */
export async function fetchAllResidents(
  query: string,
  statusFilter?: ResidentStatusFilter,
  barangayId?: string | null,
): Promise<Individual[]> {
  const rows: Individual[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await fetchResidentPage(query, PAGE_SIZE, offset, statusFilter, barangayId);

    rows.push(...page.rows);

    if (page.rows.length < PAGE_SIZE || rows.length >= page.total) {
      return rows;
    }
  }
}
