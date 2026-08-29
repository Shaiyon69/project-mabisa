export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

// Mirrors public.app_role, which is the only role enum the database has. There
// is no separate `lgu` role: an RHU or LGU official signs in as `admin`.
//
// The three are nested scopes, and every RLS helper tests exactly these values:
//   admin          -- is_admin(), reads every barangay
//   barangay_admin -- is_barangay_admin(), reads and allocates within one
//                     barangay (current_barangay_id())
//   bhw            -- is_bhw(), reads and writes within one purok
export const USER_ROLES = ['admin', 'barangay_admin', 'bhw'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: unknown): value is UserRole {
  return USER_ROLES.includes(value as UserRole);
}

/**
 * The roles that belong on the admin portal rather than the field app.
 *
 * One predicate rather than a test per surface: an unknown role has to land
 * somewhere, and giving each surface its own would leave a null role rejected by
 * both and bouncing between them forever.
 */
export function isPortalRole(role: UserRole | null): boolean {
  return role === 'admin' || role === 'barangay_admin';
}
export type IndividualSex = 'male' | 'female';
// How a member stands to the household head. The head themself carries no value:
// `is_household_head` already says it, and a second column asserting the same
// fact is a second column to keep in step.
// The tuple is the list; the union is read off it, so a category added for the
// picker and the check constraint cannot go missing from the type.
export const RELATIONSHIPS_TO_HEAD = [
  'spouse',
  'child',
  'parent',
  'sibling',
  'other_relative',
  'unrelated',
] as const;
export type RelationshipToHead = (typeof RELATIONSHIPS_TO_HEAD)[number];
export type InventoryItemType = 'medicine' | 'food' | 'equipment' | 'hygiene' | 'other';
export type NutritionStatus = 'underweight' | 'normal' | 'overweight' | 'obese';

// public.profiles from 202607160001_foundation_slice_a.sql -- the single source
// of a session's role. Writes go through the admin_* RPCs, never through the
// table, so there is no Insert/Update variant here.
export type Profile = {
  user_id: string;
  role: UserRole;
  full_name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  disabled_at: string | null;
  disabled_by: string | null;
  // Which barangay this account belongs to. Nullable, and null on accounts
  // created before the column existed — six of the nine rows in the live
  // database at the time of writing. Read-only here like the rest of the row:
  // `admin_create_profile` takes the barangay and stamps it.
  barangay_id: string | null;
};

// public.barangays. Read-only to the client, like the rest of the governance
// tables — `barangays_select_active_profile` opens it to any active profile, so
// the whole list is readable and it is the scoping policies on the field tables
// that decide whose data can actually be seen under each name.
export type Barangay = {
  barangay_id: string;
  name: string;
  code: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

// public.inventory_allocations: barangay stock handed to one BHW to carry. The
// row is written only by `barangay_admin_allocate_stock`, which decrements
// `inventory_items.current_stock` and writes the audit event in one transaction.
export type InventoryAllocation = {
  allocation_id: string;
  item_id: string;
  bhw_id: string;
  quantity: number;
  reason: string;
  allocated_by: string;
  allocated_at: string;
};

// The public.bhw_item_stock view: allocations to a BHW minus what they have
// released, per item. This is what a BHW actually has on hand, as distinct from
// `inventory_items.current_stock`, which after allocation means the barangay's
// *unallocated* remainder.
export type BhwItemStock = {
  bhw_id: string;
  item_id: string;
  item_name: string;
  type: InventoryItemType;
  barangay_id: string;
  current_stock: number;
  updated_at: string;
};

// public.puroks and public.bhw_purok_assignments, also from the foundation
// slice. Like profiles they are read-only to the client — every write goes
// through an admin_* RPC so it carries an audit event — so both are typed with
// `never` for Insert and Update.
export type Purok = {
  purok_id: string;
  name: string;
  code: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string;
  // Not null centrally: purok names are only unique within a barangay, so the
  // barangay is part of what identifies one.
  barangay_id: string;
};

export type BhwPurokAssignment = {
  assignment_id: string;
  bhw_id: string;
  purok_id: string;
  started_at: string;
  ended_at: string | null;
  assigned_by: string;
  ended_by: string | null;
  assignment_reason: string;
  end_reason: string | null;
  created_at: string;
};

export type Household = {
  household_id: string;
  // Scope and attribution, all four stamped by the `households_stamp_scope` and
  // `households_stamp_actor` triggers rather than by a column default. Optional
  // here for two reasons that happen to agree: a device form never supplies one
  // — accepting scope from a sync payload would let a client choose the rows it
  // owns — and the SQLite mirror has no such columns, so a household read back
  // from the device carries none of them.
  purok_id?: string;
  barangay_id?: string | null;
  recorded_by?: string | null;
  updated_by?: string | null;
  household_number: string;
  // `dwelling_type`, `electric_service` and `fuel_used` are gone: the form
  // stopped asking them because they are not health data, and the central table
  // has since dropped the columns. They were still declared here and still rode
  // along in the queued payload as placeholders, which Supabase rejects as
  // unknown columns — one of them fails the whole household insert, so no field
  // record synced at all. The local SQLite mirror still carries them; see the
  // note on `householdColumns`.
  toilet_type: string[];
  water_source: string[];
  food_production: string[];
  health_status_notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Individual = {
  resident_id: string;
  household_id: string;
  household_number?: string;
  // Both joined in by the admin registry from `households`, which is where they
  // live — a resident has no barangay of their own. Absent on a row read from
  // the device mirror, which has one barangay and does not store its name.
  barangay_name?: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  sex: IndividualSex;
  birthday: string;
  is_household_head: boolean;
  // Null on the head, and on every row written before the column existed. Until
  // this was added a spouse, a child and a boarder were indistinguishable.
  relationship_to_head?: RelationshipToHead | null;
  occupation: string | null;
  educational_attainment: string | null;
  is_out_of_school_youth: boolean;
  is_pregnant_nursing_fp: boolean;
  philhealth_number: string | null;
  created_at: string;
  updated_at: string;
  // The account behind the most recent write, so an authorized correction to a
  // saved profile is attributable. Null on every row written before the column.
  updated_by?: string | null;
  // Duplicate-override provenance. The system only ever warns about a likely
  // duplicate — the BHW confirms identity in person — so when they say it is a
  // different person, these four record which record they were shown, why they
  // overrode it, who they were, and when.
  duplicate_override_of?: string | null;
  duplicate_override_reason?: string | null;
  duplicate_override_by?: string | null;
  duplicate_override_at?: string | null;
};

export type HealthAssessment = {
  assessment_id: string;
  resident_id: string;
  assessment_date: string;
  weight: number;
  height: number;
  bmi: number;
  nutrition_status: NutritionStatus;
  created_at: string;
  updated_at: string;
};

export type InventoryItem = {
  item_id: string;
  item_name: string;
  type: InventoryItemType;
  current_stock: number;
  created_at: string;
  updated_at: string;
  // Both are `not null` centrally, and both are optional here because this type
  // describes rows from two sources. A row read from Supabase always carries
  // them; a row read from the device mirror never does, because `inventoryColumns`
  // does not store them — the phone has one barangay and shows no reorder
  // indicator, so mirroring either would be storage nothing reads.
  //
  // reorder_level is the per-item stock threshold. It is not yet what the
  // low-stock badge tests: it defaults to 0, so switching the badge over before
  // the levels are actually set would silently retire every alert. See
  // LOW_STOCK_THRESHOLD in services/adminData.ts.
  barangay_id?: string;
  reorder_level?: number;
};

export type SupplyDisbursement = {
  log_id: string;
  item_id: string;
  resident_id: string;
  disbursement_date: string;
  quantity: number;
  created_at: string;
  updated_at: string;
  // Which BHW released it. Optional for the same reason as InventoryItem's two:
  // the central row always carries it, the device mirror does not store it.
  // `bhw_item_stock` subtracts on this column, so a release with a null bhw_id
  // never comes off anyone's carried stock.
  bhw_id?: string | null;
};

// profiles is read-only to the client: `Insert` and `Update` are `never` so a
// direct `.insert()` on it is a build error, not a runtime RLS rejection.
export type ProfileInsert = never;
export type ProfileUpdate = never;

export type HouseholdInsert = Omit<Household, 'household_id' | 'created_at' | 'updated_at'> & {
  household_id?: string;
  created_at?: string;
  updated_at?: string;
};
export type HouseholdUpdate = Partial<Omit<Household, 'household_id'>>;

export type IndividualInsert = Omit<Individual, 'resident_id' | 'created_at' | 'updated_at'> & {
  resident_id?: string;
  created_at?: string;
  updated_at?: string;
};
export type IndividualUpdate = Partial<Omit<Individual, 'resident_id'>>;

export type HealthAssessmentInsert = Omit<HealthAssessment, 'assessment_id' | 'assessment_date' | 'created_at' | 'updated_at'> & {
  assessment_id?: string;
  assessment_date?: string;
  created_at?: string;
  updated_at?: string;
};
export type HealthAssessmentUpdate = Partial<Omit<HealthAssessment, 'assessment_id'>>;

export type InventoryItemInsert = Omit<InventoryItem, 'item_id' | 'current_stock' | 'created_at' | 'updated_at'> & {
  item_id?: string;
  current_stock?: number;
  created_at?: string;
  updated_at?: string;
};
export type InventoryItemUpdate = Partial<Omit<InventoryItem, 'item_id'>>;

export type SupplyDisbursementInsert = Omit<SupplyDisbursement, 'log_id' | 'disbursement_date' | 'created_at' | 'updated_at'> & {
  log_id?: string;
  disbursement_date?: string;
  created_at?: string;
  updated_at?: string;
};
export type SupplyDisbursementUpdate = Partial<Omit<SupplyDisbursement, 'log_id'>>;

type RowDefinition<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: never[];
};

export type Database = {
  public: {
    Tables: {
      profiles: RowDefinition<Profile, ProfileInsert, ProfileUpdate>;
      puroks: RowDefinition<Purok, never, never>;
      barangays: RowDefinition<Barangay, never, never>;
      bhw_purok_assignments: RowDefinition<BhwPurokAssignment, never, never>;
      // Written only by barangay_admin_allocate_stock, so no Insert/Update.
      inventory_allocations: RowDefinition<InventoryAllocation, never, never>;
      households: RowDefinition<Household, HouseholdInsert, HouseholdUpdate>;
      individuals: RowDefinition<Individual, IndividualInsert, IndividualUpdate>;
      health_assessments: RowDefinition<HealthAssessment, HealthAssessmentInsert, HealthAssessmentUpdate>;
      inventory_items: RowDefinition<InventoryItem, InventoryItemInsert, InventoryItemUpdate>;
      supply_disbursements: RowDefinition<SupplyDisbursement, SupplyDisbursementInsert, SupplyDisbursementUpdate>;
    };
    Views: {
      bhw_item_stock: { Row: BhwItemStock; Relationships: never[] };
    };
    // The helpers the foundation slice defines and grants to `authenticated`,
    // plus the admin_* RPCs a surface actually calls. The rest stay out until
    // one does — an unused entry here is a contract nothing checks.
    //
    // Argument names are the SQL parameter names, not a convenience renaming:
    // the client sends them as named arguments, so a mismatch is a runtime
    // 404 from PostgREST rather than a type error.
    Functions: {
      current_app_role: {
        Args: Record<string, never>;
        Returns: UserRole | null;
      };
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      current_bhw_purok_id: {
        Args: Record<string, never>;
        Returns: string | null;
      };
      admin_set_profile_active: {
        Args: { target_user_id: string; make_active: boolean; change_reason: string };
        Returns: Profile;
      };
      admin_assign_bhw_to_purok: {
        Args: { target_bhw_id: string; target_purok_id: string; assignment_reason: string };
        Returns: BhwPurokAssignment;
      };
      // The inventory RPCs. Each asserts an active barangay_admin, moves stock
      // and writes its audit event in one transaction — an `admin` session
      // calling one is rejected by the function, not by this type, because
      // stock belongs to a barangay and an RHU account is above that scope.
      barangay_admin_allocate_stock: {
        Args: { target_item_id: string; target_bhw_id: string; target_quantity: number; target_reason: string };
        Returns: InventoryAllocation;
      };
      barangay_admin_restock_item: {
        Args: { target_item_id: string; target_quantity: number; target_reason: string };
        Returns: InventoryItem;
      };
      barangay_admin_create_item: {
        Args: { target_item_name: string; target_type: InventoryItemType; target_initial_stock: number };
        Returns: InventoryItem;
      };
      barangay_admin_set_reorder_level: {
        Args: { target_item_id: string; target_level: number };
        Returns: InventoryItem;
      };
      current_barangay_id: {
        Args: Record<string, never>;
        Returns: string | null;
      };
    };
    Enums: {
      app_role: UserRole;
      individual_sex: IndividualSex;
      relationship_to_head: RelationshipToHead;
      inventory_item_type: InventoryItemType;
      nutrition_status: NutritionStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
