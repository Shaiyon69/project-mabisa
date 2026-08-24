export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

// Mirrors public.app_role.
//
//   admin          RHU. Reads every barangay, writes nothing anywhere.
//   barangay_admin One barangay. Reads its residents; owns its supply stock and
//                  allocates quantities to its own BHWs. Writes no field data.
//   bhw            One purok. Records field data there, and releases only from
//                  what a barangay_admin allocated to them personally.
//
// `is_admin()` means RHU specifically, not "a desk account" — use `is_rhu_or_barangay_admin()` for both.
export type UserRole = 'admin' | 'barangay_admin' | 'bhw';

/** True for the two roles that sign in to the admin portal rather than the phone. */
export function isDeskRole(role: UserRole | null): boolean {
  return role === 'admin' || role === 'barangay_admin';
}
export type IndividualSex = 'male' | 'female';
// How a member stands to the household head — the head itself carries no value
// (is_household_head already says it). Union is read off the tuple, so a
// category added here can't go missing from the type.
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

// public.profiles — the single source of a session's role. Writes go through
// the admin_* RPCs, not the table, so there is no Insert/Update variant here.
export type Profile = {
  user_id: string;
  role: UserRole;
  /** Set on a barangay_admin, null otherwise (`profiles_barangay_scope` enforces it). A BHW's barangay is read through their purok assignment, not stored here. */
  barangay_id: string | null;
  full_name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  disabled_at: string | null;
  disabled_by: string | null;
};

// Read-only to the client, like puroks and bhw_purok_assignments below — every
// write goes through an admin_* RPC so it carries an audit event.
export type Barangay = {
  barangay_id: string;
  name: string;
  code: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

export type Purok = {
  purok_id: string;
  /** The purok's barangay, and through it every household recorded in it. */
  barangay_id: string;
  name: string;
  code: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string;
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
  // Server-stamped by the `households_stamp_scope` trigger from the writer's
  // purok assignment. Optional here — a device form never supplies these; the trigger overwrites whatever arrives.
  purok_id?: string;
  barangay_id?: string;
  household_number: string;
  /**
   * Who profiled the household and who last edited it, stamped by
   * `households_stamp_actor` from the session. Optional here for the same reason as
   * the scope columns above — a device never supplies them, and the phone's mirror is
   * built from the local table, which does not carry them.
   */
  recorded_by?: string;
  updated_by?: string;
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
  first_name: string;
  middle_name?: string;
  last_name: string;
  sex: IndividualSex;
  birthday: string;
  is_household_head: boolean;
  // Null on the head and on rows predating this column.
  relationship_to_head?: RelationshipToHead | null;
  occupation: string | null;
  educational_attainment: string | null;
  is_out_of_school_youth: boolean;
  is_pregnant_nursing_fp: boolean;
  philhealth_number: string | null;
  created_at: string;
  updated_at: string;
  // Who last wrote the row, for attribution. Null on rows predating this column.
  updated_by?: string | null;
  // Duplicate-override provenance — which record the BHW was warned about, why
  // they overrode it, by whom, and when.
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

/**
 * Barangay supply stock, as the admin portal sees it. `current_stock` is what
 * the barangay holds **unallocated**, not the total — an allocated quantity
 * moves to `BhwItemStock` instead. `barangay_id` optional: the phone's local mirror has no such column.
 */
export type InventoryItem = {
  item_id: string;
  item_name: string;
  type: InventoryItemType;
  current_stock: number;
  barangay_id?: string;
  created_at: string;
  updated_at: string;
};

/**
 * One hand-out from barangay stock to a named BHW. Append-only — no UPDATE/DELETE
 * policy, since rewriting history would silently change a running total someone already acted on.
 */
export type InventoryAllocation = {
  allocation_id: string;
  item_id: string;
  bhw_id: string;
  quantity: number;
  reason: string;
  allocated_by: string;
  allocated_at: string;
};

/** public.bhw_item_stock — one BHW's allocations minus releases, per item. What a phone pulls in place of `inventory_items`. */
export type BhwItemStock = {
  bhw_id: string;
  item_id: string;
  item_name: string;
  type: InventoryItemType;
  barangay_id: string;
  current_stock: number;
  updated_at: string;
};

export type SupplyDisbursement = {
  log_id: string;
  item_id: string;
  resident_id: string;
  disbursement_date: string;
  quantity: number;
  /** Who released it, stamped server-side — without it allocation can't be enforced. Optional: the local mirror doesn't carry it. */
  bhw_id?: string | null;
  created_at: string;
  updated_at: string;
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
      barangays: RowDefinition<Barangay, never, never>;
      puroks: RowDefinition<Purok, never, never>;
      bhw_purok_assignments: RowDefinition<BhwPurokAssignment, never, never>;
      households: RowDefinition<Household, HouseholdInsert, HouseholdUpdate>;
      individuals: RowDefinition<Individual, IndividualInsert, IndividualUpdate>;
      health_assessments: RowDefinition<HealthAssessment, HealthAssessmentInsert, HealthAssessmentUpdate>;
      inventory_items: RowDefinition<InventoryItem, InventoryItemInsert, InventoryItemUpdate>;
      supply_disbursements: RowDefinition<SupplyDisbursement, SupplyDisbursementInsert, SupplyDisbursementUpdate>;
      // Written only by barangay_admin_allocate_stock — never for both write shapes.
      inventory_allocations: RowDefinition<InventoryAllocation, never, never>;
    };
    Views: {
      bhw_item_stock: RowDefinition<BhwItemStock, never, never>;
    };
    // The helpers the database defines and grants to `authenticated`. The admin_*
    // RPCs are omitted until a surface calls one.
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
      current_barangay_id: {
        Args: Record<string, never>;
        Returns: string | null;
      };
      barangay_admin_create_item: {
        Args: { target_item_name: string; target_type: InventoryItemType; target_initial_stock?: number };
        Returns: InventoryItem;
      };
      barangay_admin_restock_item: {
        Args: { target_item_id: string; target_quantity: number; target_reason: string };
        Returns: InventoryItem;
      };
      barangay_admin_allocate_stock: {
        Args: { target_item_id: string; target_bhw_id: string; target_quantity: number; target_reason: string };
        Returns: InventoryAllocation;
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
