export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

// Mirrors public.app_role from the foundation slice, which is the only role
// enum the database has. There is no separate `lgu` role: an LGU official signs
// in as `admin`, and every RLS helper (`is_admin()`, `current_app_role()`) tests
// exactly these two values.
export type UserRole = 'admin' | 'bhw';
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
  // Server-stamped from the writer's active assignment by 202608160002 and the
  // only place purok membership is recorded. Optional here because a device
  // form never supplies it — accepting it from a sync payload would let a
  // client choose its own scope.
  purok_id?: string;
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
};

export type SupplyDisbursement = {
  log_id: string;
  item_id: string;
  resident_id: string;
  disbursement_date: string;
  quantity: number;
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
      puroks: RowDefinition<Purok, never, never>;
      bhw_purok_assignments: RowDefinition<BhwPurokAssignment, never, never>;
      households: RowDefinition<Household, HouseholdInsert, HouseholdUpdate>;
      individuals: RowDefinition<Individual, IndividualInsert, IndividualUpdate>;
      health_assessments: RowDefinition<HealthAssessment, HealthAssessmentInsert, HealthAssessmentUpdate>;
      inventory_items: RowDefinition<InventoryItem, InventoryItemInsert, InventoryItemUpdate>;
      supply_disbursements: RowDefinition<SupplyDisbursement, SupplyDisbursementInsert, SupplyDisbursementUpdate>;
    };
    Views: Record<string, never>;
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
