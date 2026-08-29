-- =============================================================================
-- Barangay scoping, the barangay_admin role, and per-BHW stock allocation
--
-- Applied to the live project on 2026-08-23 as two migrations:
--   20260823_barangay_admin_role   -- section 0 only
--   20260823_barangay_scoping      -- sections 1 to 11
--
-- Section 0 is separate because Postgres will not let a new enum value be *used*
-- in the same transaction that adds it, and every migration runs in one.
--
-- Three roles after this file:
--
--   admin          RHU. Reads every barangay. Writes nothing anywhere.
--   barangay_admin One barangay. Reads its residents; owns its supply stock and
--                  hands quantities to its own BHWs. Writes no field data.
--   bhw            One purok. Records field data there; disburses only from
--                  what a barangay_admin allocated to them personally.
--
-- `is_admin()` keeps its old meaning -- RHU admin, the top role -- because eight
-- admin_* RPCs and four foundation policies test it by name. A barangay_admin is
-- NOT an admin to that function. Use `is_barangay_admin()` for the new role and
-- `is_rhu_or_barangay_admin()` where either belongs.
--
-- BEFORE THIS FILE HELPS ANYONE, RUN SECTION 11. Scoping keys off puroks and
-- assignments, and both tables are empty. Until they are seeded, a BHW cannot
-- save a household at all -- the stamp in section 5 rejects the insert rather
-- than filing a record under no barangay.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. The role itself  (its own migration -- see the header)
-- -----------------------------------------------------------------------------

alter type public.app_role add value if not exists 'barangay_admin';


-- -----------------------------------------------------------------------------
-- 1. Barangays
--
-- The unit an RHU supervises and a barangay_admin is confined to. Everything
-- else in this file is a path from a row to one of these ids.
-- -----------------------------------------------------------------------------

create table if not exists public.barangays (
  barangay_id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  code text unique check (code is null or length(btrim(code)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (user_id)
);

drop trigger if exists barangays_set_updated_at on public.barangays;
create trigger barangays_set_updated_at
  before update on public.barangays
  for each row execute function private.set_updated_at();

-- A barangay's name and code are labels, not data about anyone. Every active
-- account reads them so a screen can print "Barangay San Isidro" instead of a
-- uuid; nothing here is scoped, because scoping the *names* would leave an RHU
-- report unable to caption the rows it is allowed to read.
drop policy if exists barangays_select_active_profile on public.barangays;
create policy barangays_select_active_profile
  on public.barangays for select to authenticated
  using (public.current_profile_is_active());


-- -----------------------------------------------------------------------------
-- 2. Puroks belong to a barangay
--
-- This is the join that gives a *household* its barangay: a household is stamped
-- with the recording BHW's purok (section 5), and the purok carries the
-- barangay. One place records the relationship, so a household cannot end up
-- filed under a barangay its purok does not belong to.
-- -----------------------------------------------------------------------------

alter table public.puroks
  add column if not exists barangay_id uuid references public.barangays (barangay_id);

-- `puroks` is empty on the live project, so this is a declaration rather than a
-- migration of anything. It is written to fail loudly if that stops being true.
do $$
begin
  if exists (select 1 from public.puroks where barangay_id is null) then
    raise exception 'Existing puroks have no barangay. Assign one before enforcing NOT NULL.';
  end if;
end;
$$;

alter table public.puroks alter column barangay_id set not null;

create index if not exists puroks_barangay_id_idx on public.puroks (barangay_id);

-- Purok names are unique *within a barangay*, not across the system.
--
-- The foundation slice indexed `lower(btrim(name))` globally, which was correct
-- while the database held one barangay and wrong the moment it held three: every
-- barangay has a Purok 1, and the first seed attempt failed on exactly that.
-- Applied as its own migration, `scope_purok_uniqueness_to_barangay`.
drop index if exists public.puroks_name_unique_ci;
drop index if exists public.puroks_code_unique_ci;

create unique index puroks_name_unique_ci
  on public.puroks (barangay_id, lower(btrim(name)));

create unique index puroks_code_unique_ci
  on public.puroks (barangay_id, lower(btrim(code)))
  where code is not null;

-- Purok creation stays with the RHU admin, and now has to say which barangay.
-- Signature change rather than an overload: an overload would leave the old
-- two-argument form callable, and it can no longer answer the question.
drop function if exists public.admin_create_purok(text, text);

create or replace function public.admin_create_purok(
  target_barangay_id uuid,
  target_name text,
  target_code text default null
)
returns public.puroks
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  actor_id uuid := private.assert_admin();
  created_purok public.puroks;
begin
  if not exists (
    select 1 from public.barangays
    where barangay_id = target_barangay_id and is_active
  ) then
    raise check_violation using message = 'A purok needs an active barangay';
  end if;

  insert into public.puroks (barangay_id, name, code, created_by)
  values (target_barangay_id, btrim(target_name), nullif(btrim(target_code), ''), actor_id)
  returning * into created_purok;

  perform private.write_audit_event(
    'purok.created',
    'puroks',
    created_purok.purok_id,
    null,
    jsonb_build_object('code', created_purok.code, 'barangay_id', target_barangay_id)
  );

  return created_purok;
end;
$$;


-- -----------------------------------------------------------------------------
-- 3. Which barangay an account belongs to
--
-- A barangay_admin carries the id on their profile. A BHW does not: theirs is
-- read through their active purok assignment, so moving a BHW to another purok
-- moves their barangay with it and there is no second column to forget. An RHU
-- admin has none, and that is the point -- null here means "not confined".
-- -----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists barangay_id uuid references public.barangays (barangay_id);

alter table public.profiles drop constraint if exists profiles_barangay_scope;
alter table public.profiles add constraint profiles_barangay_scope check (
  case role
    when 'barangay_admin' then barangay_id is not null
    else barangay_id is null
  end
);

create index if not exists profiles_barangay_id_idx on public.profiles (barangay_id);

-- `admin_create_profile` has to be able to supply that barangay, or the role it
-- was just taught about is one it can never create. Before this it took three
-- arguments, always inserted a null barangay, and so failed with a raw
-- `profiles_barangay_scope` violation for every `barangay_admin` asked of it.
-- Applied as `admin_create_profile_accepts_barangay`.
drop function if exists public.admin_create_profile(uuid, public.app_role, text);

create or replace function public.admin_create_profile(
  target_user_id uuid,
  target_role public.app_role,
  target_full_name text,
  target_barangay_id uuid default null
)
returns public.profiles
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  actor_id uuid := private.assert_admin();
  created_profile public.profiles;
begin
  if not exists (select 1 from auth.users as auth_user where auth_user.id = target_user_id) then
    raise foreign_key_violation using message = 'The target Auth user does not exist';
  end if;

  if nullif(btrim(target_full_name), '') is null then
    raise check_violation using message = 'Profile full name is required';
  end if;

  -- `profiles_barangay_scope` enforces this shape, but a raw constraint violation
  -- is not an answer anybody can act on. Say which argument is wrong.
  if target_role = 'barangay_admin'::public.app_role then
    if target_barangay_id is null then
      raise check_violation using message = 'A barangay administrator must be given a barangay';
    end if;

    if not exists (select 1 from public.barangays where barangay_id = target_barangay_id and is_active) then
      raise check_violation using message = 'That barangay does not exist or is not active';
    end if;
  elsif target_barangay_id is not null then
    raise check_violation using message =
      'Only a barangay administrator is confined to a barangay. A BHW gets theirs from a purok assignment, and an RHU admin has none.';
  end if;

  insert into public.profiles (user_id, role, full_name, barangay_id, is_active, created_by)
  values (target_user_id, target_role, btrim(target_full_name), target_barangay_id, true, actor_id)
  returning * into created_profile;

  perform private.write_audit_event(
    'profile.created',
    'profiles',
    target_user_id,
    null,
    jsonb_build_object('role', target_role, 'barangay_id', target_barangay_id)
  );

  return created_profile;
end;
$$;

revoke execute on function public.admin_create_profile(uuid, public.app_role, text, uuid) from public, anon;
grant execute on function public.admin_create_profile(uuid, public.app_role, text, uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- 4. Role helpers
--
-- `is_bhw()` and `is_lgu_staff()` used to read `public.users`, the pre-foundation
-- role table, while the app read `public.profiles`. The live data showed what
-- that costs: the account "Shaiyon" is `admin` in profiles and `bhw` in users, so
-- it signed in to the admin portal and still passed every `is_bhw()` write check.
-- One role table now answers, and it is the one the app reads.
--
-- `public.users` is left in place rather than dropped -- it holds rows and a
-- signup trigger still writes to it -- but after this file nothing in the data
-- path consults it.
-- -----------------------------------------------------------------------------

create or replace function public.is_bhw()
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog'
as $$
  select coalesce(public.current_app_role() = 'bhw'::public.app_role, false);
$$;

create or replace function public.is_barangay_admin()
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog'
as $$
  select coalesce(public.current_app_role() = 'barangay_admin'::public.app_role, false);
$$;

-- Either desk role. Reading is what they share; writing is where they differ, so
-- this appears in SELECT policies only.
create or replace function public.is_rhu_or_barangay_admin()
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog'
as $$
  select public.is_admin() or public.is_barangay_admin();
$$;

-- The caller's barangay: their profile's for a barangay_admin, their active
-- assignment's for a BHW, null for an RHU admin (and for anyone unassigned,
-- which denies rather than opens -- every comparison against null is false).
create or replace function public.current_barangay_id()
returns uuid
language sql
stable
security definer
set search_path to 'pg_catalog'
as $$
  select coalesce(
    (
      select profile.barangay_id
      from public.profiles as profile
      where profile.user_id = auth.uid()
        and profile.is_active
    ),
    (
      select purok.barangay_id
      from public.bhw_purok_assignments as assignment
      join public.puroks as purok
        on purok.purok_id = assignment.purok_id
       and purok.is_active
      join public.profiles as profile
        on profile.user_id = assignment.bhw_id
       and profile.is_active
       and profile.role = 'bhw'::public.app_role
      where assignment.bhw_id = auth.uid()
        and assignment.ended_at is null
      limit 1
    )
  );
$$;

-- The same question asked about somebody else, for the policies that decide
-- whether a barangay_admin may see a given account.
create or replace function public.profile_barangay_id(target_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path to 'pg_catalog'
as $$
  select coalesce(
    (
      select profile.barangay_id
      from public.profiles as profile
      where profile.user_id = target_user_id
    ),
    (
      select purok.barangay_id
      from public.bhw_purok_assignments as assignment
      join public.puroks as purok
        on purok.purok_id = assignment.purok_id
      where assignment.bhw_id = target_user_id
        and assignment.ended_at is null
      limit 1
    )
  );
$$;


-- -----------------------------------------------------------------------------
-- 5. Households carry their scope, and the server decides it
--
-- The columns the client types already declared and the database never had. A
-- device does not supply either one: a payload that chose its own purok would be
-- a client choosing what it is allowed to see next.
-- -----------------------------------------------------------------------------

alter table public.households
  add column if not exists purok_id uuid references public.puroks (purok_id),
  add column if not exists barangay_id uuid references public.barangays (barangay_id);

create index if not exists households_purok_id_idx on public.households (purok_id);
create index if not exists households_barangay_id_idx on public.households (barangay_id);
create index if not exists individuals_household_id_idx on public.individuals (household_id);

create or replace function private.stamp_household_scope()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  writer_purok uuid;
begin
  -- An update never moves a household between puroks. The sync engine replays a
  -- correction as an upsert, so this is also what keeps a re-pushed INSERT from
  -- re-deciding the scope of a row that already has one.
  if tg_op = 'UPDATE' then
    new.purok_id := old.purok_id;
    new.barangay_id := old.barangay_id;
    return new;
  end if;

  writer_purok := public.current_bhw_purok_id();

  if writer_purok is null then
    raise check_violation using message =
      'This account has no active purok assignment, so there is no barangay to file the household under. An administrator must assign a purok first.';
  end if;

  new.purok_id := writer_purok;

  select purok.barangay_id
  into new.barangay_id
  from public.puroks as purok
  where purok.purok_id = writer_purok;

  return new;
end;
$$;

drop trigger if exists households_stamp_scope on public.households;
create trigger households_stamp_scope
  before insert or update on public.households
  for each row execute function private.stamp_household_scope();

-- Everything hanging off a household reaches its scope through this. SECURITY
-- DEFINER so the lookup sees the household row itself rather than being filtered
-- by the very policy it is being called from.
--
-- ponytail: one function call per row, so a full-table read is a nested loop.
-- Fine against a barangay's households; add a materialized scope column if a
-- multi-barangay report ever gets slow.
create or replace function public.can_read_household(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog'
as $$
  select exists (
    select 1
    from public.households as household
    where household.household_id = target_household_id
      and (
        public.is_admin()
        or (public.is_barangay_admin() and household.barangay_id = public.current_barangay_id())
        or (public.is_bhw() and household.purok_id = public.current_bhw_purok_id())
      )
  );
$$;

create or replace function public.can_read_resident(target_resident_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog'
as $$
  select exists (
    select 1
    from public.individuals as individual
    where individual.resident_id = target_resident_id
      and public.can_read_household(individual.household_id)
  );
$$;


-- -----------------------------------------------------------------------------
-- 6. Field data, scoped
--
-- Replaces `using (true)` on all four tables -- which let every authenticated
-- session read every resident in the system, and would have made a barangay_admin
-- indistinguishable from the RHU.
--
-- Writes stay BHW-only and are now bounded to the writer's own purok as well: the
-- old checks asked only *whether* the caller was a BHW, never *whose* household
-- they were writing into.
-- -----------------------------------------------------------------------------

drop policy if exists households_select_authenticated on public.households;
create policy households_select_scoped
  on public.households for select to authenticated
  using (
    public.current_profile_is_active()
    and (
      public.is_admin()
      or (public.is_barangay_admin() and barangay_id = public.current_barangay_id())
      or (public.is_bhw() and purok_id = public.current_bhw_purok_id())
    )
  );

-- INSERT keeps the plain is_bhw() check: the trigger in section 5 assigns the
-- scope, so there is nothing for a WITH CHECK to compare that the row did not
-- just receive from the server.
drop policy if exists households_update_bhw on public.households;
create policy households_update_bhw
  on public.households for update to authenticated
  using (public.is_bhw() and purok_id = public.current_bhw_purok_id())
  with check (public.is_bhw());

drop policy if exists individuals_select_authenticated on public.individuals;
create policy individuals_select_scoped
  on public.individuals for select to authenticated
  using (public.current_profile_is_active() and public.can_read_household(household_id));

drop policy if exists individuals_insert_bhw on public.individuals;
create policy individuals_insert_bhw
  on public.individuals for insert to authenticated
  with check (public.is_bhw() and public.can_read_household(household_id));

drop policy if exists individuals_update_bhw on public.individuals;
create policy individuals_update_bhw
  on public.individuals for update to authenticated
  using (public.is_bhw() and public.can_read_household(household_id))
  with check (public.is_bhw() and public.can_read_household(household_id));

drop policy if exists health_assessments_select_authenticated on public.health_assessments;
create policy health_assessments_select_scoped
  on public.health_assessments for select to authenticated
  using (public.current_profile_is_active() and public.can_read_resident(resident_id));

drop policy if exists health_assessments_insert_bhw on public.health_assessments;
create policy health_assessments_insert_bhw
  on public.health_assessments for insert to authenticated
  with check (public.is_bhw() and public.can_read_resident(resident_id));

drop policy if exists health_assessments_update_bhw on public.health_assessments;
create policy health_assessments_update_bhw
  on public.health_assessments for update to authenticated
  using (public.is_bhw() and public.can_read_resident(resident_id))
  with check (public.is_bhw() and public.can_read_resident(resident_id));


-- -----------------------------------------------------------------------------
-- 7. Supply: barangay stock, allocated to named BHWs
--
-- `inventory_items.current_stock` changes meaning here. It was "what exists";
-- it is now "what the barangay still holds unallocated". The quantity a BHW may
-- release is not on this table at all -- it is allocations to them, minus what
-- they have already released, which is the `bhw_item_stock` view below.
-- -----------------------------------------------------------------------------

alter table public.inventory_items
  add column if not exists barangay_id uuid references public.barangays (barangay_id);

do $$
begin
  if exists (select 1 from public.inventory_items where barangay_id is null) then
    raise exception 'Existing inventory items have no barangay. Assign one before enforcing NOT NULL.';
  end if;
end;
$$;

alter table public.inventory_items alter column barangay_id set not null;

create index if not exists inventory_items_barangay_id_idx on public.inventory_items (barangay_id);

-- Read by the barangay that owns it, and by the RHU. No INSERT or UPDATE policy
-- at all: every write goes through the RPCs in section 9, which is what keeps a
-- stock figure and its audit event from being able to disagree.
drop policy if exists inventory_items_select_authenticated on public.inventory_items;
drop policy if exists inventory_items_insert_lgu_staff on public.inventory_items;
drop policy if exists inventory_items_update_lgu_staff on public.inventory_items;

create policy inventory_items_select_scoped
  on public.inventory_items for select to authenticated
  using (
    public.current_profile_is_active()
    and (public.is_admin() or barangay_id = public.current_barangay_id())
  );

-- The ledger. Append-only by construction: there is no UPDATE or DELETE policy,
-- and the RPC is the only writer. A correction is a further row, not an edit,
-- because "how much does this BHW hold" is a running total and rewriting history
-- silently changes an answer somebody already acted on.
create table if not exists public.inventory_allocations (
  allocation_id uuid primary key default extensions.gen_random_uuid(),
  item_id uuid not null references public.inventory_items (item_id),
  bhw_id uuid not null references public.profiles (user_id),
  quantity integer not null check (quantity > 0),
  reason text not null check (length(btrim(reason)) > 0),
  allocated_by uuid not null references public.profiles (user_id),
  allocated_at timestamptz not null default now()
);

create index if not exists inventory_allocations_bhw_item_idx
  on public.inventory_allocations (bhw_id, item_id);

create policy inventory_allocations_select_scoped
  on public.inventory_allocations for select to authenticated
  using (
    public.current_profile_is_active()
    and (
      public.is_admin()
      or bhw_id = auth.uid()
      or (
        public.is_barangay_admin()
        and exists (
          select 1
          from public.inventory_items as item
          where item.item_id = inventory_allocations.item_id
            and item.barangay_id = public.current_barangay_id()
        )
      )
    )
  );

-- What one BHW may actually release, per item. The phone pulls this instead of
-- `inventory_items`, so the number on a field device is that device's holder's
-- own stock rather than the barangay's.
--
-- security_invoker so the reader's own policies decide the rows: a BHW sees only
-- their allocations, a barangay_admin sees their barangay's, the RHU sees all.
create or replace view public.bhw_item_stock
with (security_invoker = true) as
select
  allocation.bhw_id,
  allocation.item_id,
  item.item_name,
  item.type,
  item.barangay_id,
  sum(allocation.quantity)::integer - coalesce(released.quantity, 0)::integer as current_stock,
  greatest(max(allocation.allocated_at), coalesce(released.last_at, max(allocation.allocated_at))) as updated_at
from public.inventory_allocations as allocation
join public.inventory_items as item
  on item.item_id = allocation.item_id
left join lateral (
  select sum(disbursement.quantity) as quantity, max(disbursement.updated_at) as last_at
  from public.supply_disbursements as disbursement
  where disbursement.bhw_id = allocation.bhw_id
    and disbursement.item_id = allocation.item_id
) as released on true
group by
  allocation.bhw_id,
  allocation.item_id,
  item.item_name,
  item.type,
  item.barangay_id,
  released.quantity,
  released.last_at;

grant select on public.bhw_item_stock to authenticated;
revoke all on public.bhw_item_stock from anon;


-- -----------------------------------------------------------------------------
-- 8. A release names its BHW, and cannot exceed what they hold
--
-- `supply_disbursements` had no attribution at all, which made "what this BHW
-- still holds" unanswerable and so made allocation unenforceable.
-- -----------------------------------------------------------------------------

alter table public.supply_disbursements
  add column if not exists bhw_id uuid references public.profiles (user_id);

create index if not exists supply_disbursements_bhw_item_idx
  on public.supply_disbursements (bhw_id, item_id);

create or replace function public.bhw_available_stock(target_bhw_id uuid, target_item_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'pg_catalog'
as $$
  select
    coalesce((
      select sum(allocation.quantity)
      from public.inventory_allocations as allocation
      where allocation.bhw_id = target_bhw_id
        and allocation.item_id = target_item_id
    ), 0)::integer
    - coalesce((
      select sum(disbursement.quantity)
      from public.supply_disbursements as disbursement
      where disbursement.bhw_id = target_bhw_id
        and disbursement.item_id = target_item_id
    ), 0)::integer;
$$;

create or replace function private.stamp_disbursement_actor()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  available integer;
begin
  if tg_op = 'UPDATE' then
    -- A release cannot change hands or change size after the fact; either would
    -- move a balance that a later release was already checked against.
    new.bhw_id := old.bhw_id;
    new.item_id := old.item_id;
    new.quantity := old.quantity;
    return new;
  end if;

  new.bhw_id := auth.uid();

  available := public.bhw_available_stock(new.bhw_id, new.item_id);

  -- Offline work reaches this check late, so it is the point where a device that
  -- released more than it was allocated finds out. The sync engine surfaces the
  -- message and holds the entry rather than dropping it.
  if available < new.quantity then
    raise check_violation using message = format(
      'Only %s of this item is allocated to you and still unreleased; %s cannot be released.',
      available, new.quantity
    );
  end if;

  return new;
end;
$$;

drop trigger if exists supply_disbursements_stamp_actor on public.supply_disbursements;
create trigger supply_disbursements_stamp_actor
  before insert or update on public.supply_disbursements
  for each row execute function private.stamp_disbursement_actor();

drop policy if exists supply_disbursements_select_authenticated on public.supply_disbursements;
create policy supply_disbursements_select_scoped
  on public.supply_disbursements for select to authenticated
  using (public.current_profile_is_active() and public.can_read_resident(resident_id));

drop policy if exists supply_disbursements_insert_bhw on public.supply_disbursements;
create policy supply_disbursements_insert_bhw
  on public.supply_disbursements for insert to authenticated
  with check (public.is_bhw() and public.can_read_resident(resident_id));

drop policy if exists supply_disbursements_update_bhw on public.supply_disbursements;
create policy supply_disbursements_update_bhw
  on public.supply_disbursements for update to authenticated
  using (public.is_bhw() and public.can_read_resident(resident_id))
  with check (public.is_bhw() and public.can_read_resident(resident_id));


-- -----------------------------------------------------------------------------
-- 9. The barangay_admin's three write paths
--
-- The RHU admin is deliberately absent from all three. "RHU reads, barangay
-- allocates" is the rule, and a security-definer RPC is where it is actually
-- enforced -- a hidden button is not a permission.
-- -----------------------------------------------------------------------------

create or replace function private.assert_barangay_admin()
returns uuid
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null or not public.is_barangay_admin() then
    raise insufficient_privilege using message = 'Active barangay administrator access is required';
  end if;

  return actor_id;
end;
$$;

create or replace function public.barangay_admin_create_item(
  target_item_name text,
  target_type text,
  target_initial_stock integer default 0
)
returns public.inventory_items
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  actor_id uuid := private.assert_barangay_admin();
  actor_barangay uuid := public.current_barangay_id();
  created_item public.inventory_items;
begin
  if nullif(btrim(target_item_name), '') is null then
    raise check_violation using message = 'An item name is required';
  end if;

  if target_initial_stock < 0 then
    raise check_violation using message = 'Opening stock cannot be negative';
  end if;

  insert into public.inventory_items (item_name, type, current_stock, barangay_id)
  values (btrim(target_item_name), target_type, target_initial_stock, actor_barangay)
  returning * into created_item;

  perform private.write_audit_event(
    'inventory.item_created',
    'inventory_items',
    created_item.item_id,
    null,
    jsonb_build_object('barangay_id', actor_barangay, 'opening_stock', target_initial_stock)
  );

  return created_item;
end;
$$;

create or replace function public.barangay_admin_restock_item(
  target_item_id uuid,
  target_quantity integer,
  target_reason text
)
returns public.inventory_items
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  actor_id uuid := private.assert_barangay_admin();
  actor_barangay uuid := public.current_barangay_id();
  updated_item public.inventory_items;
begin
  if target_quantity <= 0 then
    raise check_violation using message = 'A restock quantity must be positive';
  end if;

  if nullif(btrim(target_reason), '') is null then
    raise check_violation using message = 'A reason is required';
  end if;

  update public.inventory_items
  set current_stock = current_stock + target_quantity
  where item_id = target_item_id
    and barangay_id = actor_barangay
  returning * into updated_item;

  if updated_item.item_id is null then
    raise no_data_found using message = 'That item is not in your barangay';
  end if;

  perform private.write_audit_event(
    'inventory.restocked',
    'inventory_items',
    target_item_id,
    btrim(target_reason),
    jsonb_build_object('added', target_quantity, 'current_stock', updated_item.current_stock)
  );

  return updated_item;
end;
$$;

create or replace function public.barangay_admin_allocate_stock(
  target_item_id uuid,
  target_bhw_id uuid,
  target_quantity integer,
  target_reason text
)
returns public.inventory_allocations
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  actor_id uuid := private.assert_barangay_admin();
  actor_barangay uuid := public.current_barangay_id();
  source_item public.inventory_items;
  new_allocation public.inventory_allocations;
begin
  if target_quantity <= 0 then
    raise check_violation using message = 'An allocation quantity must be positive';
  end if;

  if nullif(btrim(target_reason), '') is null then
    raise check_violation using message = 'A reason is required';
  end if;

  -- Locked for the duration: two allocations of the same item racing each other
  -- would otherwise both read the pre-decrement figure and both pass the check.
  select *
  into source_item
  from public.inventory_items
  where item_id = target_item_id
    and barangay_id = actor_barangay
  for update;

  if source_item.item_id is null then
    raise no_data_found using message = 'That item is not in your barangay';
  end if;

  -- "Their respective BHWs only": an active BHW whose current purok assignment
  -- sits in this administrator's barangay.
  if not exists (
    select 1
    from public.profiles as profile
    where profile.user_id = target_bhw_id
      and profile.role = 'bhw'::public.app_role
      and profile.is_active
      and public.profile_barangay_id(target_bhw_id) = actor_barangay
  ) then
    raise check_violation using message = 'Stock can be allocated only to an active BHW assigned in your barangay';
  end if;

  if source_item.current_stock < target_quantity then
    raise check_violation using message = format(
      'Only %s of %s is unallocated; %s cannot be handed out.',
      source_item.current_stock, source_item.item_name, target_quantity
    );
  end if;

  update public.inventory_items
  set current_stock = current_stock - target_quantity
  where item_id = target_item_id;

  insert into public.inventory_allocations (item_id, bhw_id, quantity, reason, allocated_by)
  values (target_item_id, target_bhw_id, target_quantity, btrim(target_reason), actor_id)
  returning * into new_allocation;

  perform private.write_audit_event(
    'inventory.allocated',
    'inventory_allocations',
    new_allocation.allocation_id,
    btrim(target_reason),
    jsonb_build_object(
      'item_id', target_item_id,
      'bhw_id', target_bhw_id,
      'quantity', target_quantity,
      'barangay_stock_left', source_item.current_stock - target_quantity
    )
  );

  return new_allocation;
end;
$$;

-- Supabase grants anon an explicit EXECUTE on every new function, and an explicit
-- grant survives a revoke from PUBLIC. Both statements are needed; this was
-- learned the hard way on is_bhw().
revoke execute on function
  public.barangay_admin_create_item(text, text, integer),
  public.barangay_admin_restock_item(uuid, integer, text),
  public.barangay_admin_allocate_stock(uuid, uuid, integer, text),
  public.bhw_available_stock(uuid, uuid),
  public.current_barangay_id(),
  public.profile_barangay_id(uuid),
  public.can_read_household(uuid),
  public.can_read_resident(uuid),
  public.is_barangay_admin(),
  public.is_rhu_or_barangay_admin()
from public, anon;

grant execute on function
  public.barangay_admin_create_item(text, text, integer),
  public.barangay_admin_restock_item(uuid, integer, text),
  public.barangay_admin_allocate_stock(uuid, uuid, integer, text)
to authenticated;

-- Applied as a third migration, `revoke_anon_execute_on_definer_functions`, after
-- the database linter caught it: recreating admin_create_purok gave it a fresh
-- default grant to `anon`. It asserts admin on its first line, so an anonymous
-- call was refused anyway, but an unauthenticated caller has no business reaching
-- the function at all. The two legacy helpers alongside it predate this file.
revoke execute on function public.admin_create_purok(uuid, text, text) from public, anon;
grant execute on function public.admin_create_purok(uuid, text, text) to authenticated;

revoke execute on function public.current_user_role() from public, anon;
revoke execute on function public.is_lgu_staff() from public, anon;


-- -----------------------------------------------------------------------------
-- 10. The desk roles can see the accounts they administer
--
-- A barangay_admin allocating stock has to be able to list their own BHWs, and
-- the audit trail is what makes a stock movement reviewable rather than merely
-- recorded.
-- -----------------------------------------------------------------------------

drop policy if exists profiles_select_foundation on public.profiles;
create policy profiles_select_foundation
  on public.profiles for select to authenticated
  using (
    public.current_profile_is_active()
    and (
      public.is_admin()
      or user_id = auth.uid()
      or (
        public.is_barangay_admin()
        and public.profile_barangay_id(user_id) = public.current_barangay_id()
      )
    )
  );

drop policy if exists puroks_select_foundation on public.puroks;
create policy puroks_select_foundation
  on public.puroks for select to authenticated
  using (
    public.current_profile_is_active()
    and (
      public.is_admin()
      or (public.is_barangay_admin() and barangay_id = public.current_barangay_id())
      or purok_id = public.current_bhw_purok_id()
    )
  );

drop policy if exists assignments_select_foundation on public.bhw_purok_assignments;
create policy assignments_select_foundation
  on public.bhw_purok_assignments for select to authenticated
  using (
    public.current_profile_is_active()
    and (
      public.is_admin()
      or bhw_id = auth.uid()
      or (
        public.is_barangay_admin()
        and public.profile_barangay_id(bhw_id) = public.current_barangay_id()
      )
    )
  );

-- The audit table's whitelist predates the supply tables.
alter table public.audit_events drop constraint if exists audit_events_entity_table_check;
alter table public.audit_events add constraint audit_events_entity_table_check check (
  entity_table = any (array[
    'profiles',
    'puroks',
    'bhw_purok_assignments',
    'authorized_devices',
    'barangays',
    'inventory_items',
    'inventory_allocations'
  ])
);

drop policy if exists audit_events_select_admin on public.audit_events;
create policy audit_events_select_admin
  on public.audit_events for select to authenticated
  using (public.is_rhu_or_barangay_admin() and public.current_profile_is_active());


-- =============================================================================
-- 11. Seeding -- APPLIED 2026-08-23
--
-- Nothing above does anything until a barangay, its puroks, and its BHW
-- assignments exist: `current_bhw_purok_id()` is null for every account until
-- then, which means BHWs can save nothing (section 5 rejects the insert),
-- barangay administrators see nothing, and only the RHU sees anything at all.
--
-- What was seeded:
--
--   Cabugao  (CABUGAO)  Purok 1, Purok 2   cabugao@bhw.local
--   Salay    (SALAY)    Purok 1, Purok 2   salay@bhw.local
--   Pag-asa  (PAG-ASA)  Purok 1, Purok 2   pag-asa@bhw.local
--
-- Each of those three is a `barangay_admin` profile over its own barangay. The
-- three pre-existing BHW accounts were assigned one per barangay, to Purok 1:
-- bhw@mabisa.local to Cabugao, admin@bhw.local to Pag-asa, and
-- mitzignacio2252@gmail.com to Salay. The two `admin` accounts -- mitzadmin and
-- Shaiyon -- are the RHU, unchanged and unconfined.
--
-- All field data was cleared first: it predated scoping, carried no purok, and
-- so was visible to nobody but the RHU.
--
-- The seed passwords are a shared eight-character string. That is a development
-- convenience and nothing else. Rotate every one of them before this database
-- holds a real resident's record.
--
-- Purok names are unique per barangay, not globally -- see section 2. The first
-- seed attempt failed on exactly that, because every barangay has a Purok 1.
-- =============================================================================

-- To add a barangay after this point, in order:

-- 11a. The barangay.
--
--   insert into public.barangays (name, code, created_by)
--   values ('Barangay Name', 'CODE', auth.uid())
--   returning barangay_id;

-- 11b. Its puroks. Through the RPC, so the audit trail records it.
--
--   select public.admin_create_purok('<barangay_id>', 'Purok 1', 'P1');

-- 11c. Its administrator. There is no RPC for a role change by design -- it is
--      the one operation that grants access rather than using it, so it stays a
--      deliberate statement typed by a human. The account must already exist in
--      auth.users; create it through the Supabase dashboard rather than by
--      inserting a password hash from SQL.
--
--   update public.profiles
--   set role = 'barangay_admin'::public.app_role,
--       barangay_id = '<barangay_id>'
--   where user_id = '<auth user id>';

-- 11d. Assign each BHW a purok. Without this they cannot record anything.
--
--   select public.admin_assign_bhw_to_purok('<bhw user id>', '<purok_id>', 'Initial assignment');


-- =============================================================================
-- 12. Columns the client had been writing to for a week, and the database
--     did not have
--
-- Applied 2026-08-23 as `individual_attribution_and_relationship_columns`.
--
-- Not part of the role work, kept here because this is the file the README points
-- at. `src/types/database.ts` declared all six of these and cited a migration
-- number that was never applied, so every newly registered resident failed its
-- push with "column not found" and dead-lettered. Verified afterwards by pushing
-- the exact payload shape the sync engine sends.
--
-- Attribution is stamped from the session rather than trusted from the payload.
-- The device does send its own id, and in the honest case it is the same value —
-- but "who recorded this" is the one field whose whole purpose is to be
-- unforgeable, and a client-supplied answer to it is worth nothing.
-- =============================================================================

alter table public.individuals
  add column if not exists relationship_to_head text,
  add column if not exists updated_by uuid references public.profiles (user_id),
  add column if not exists duplicate_override_of uuid references public.individuals (resident_id),
  add column if not exists duplicate_override_reason text,
  add column if not exists duplicate_override_by uuid references public.profiles (user_id),
  add column if not exists duplicate_override_at timestamptz;

-- Mirrors RELATIONSHIPS_TO_HEAD in src/types/database.ts. The tuple there is the
-- list; if a category is added to the picker it has to be added here too, or the
-- save fails at the sync boundary rather than in the form.
alter table public.individuals drop constraint if exists individuals_relationship_to_head_check;
alter table public.individuals add constraint individuals_relationship_to_head_check check (
  relationship_to_head is null
  or relationship_to_head = any (array['spouse', 'child', 'parent', 'sibling', 'other_relative', 'unrelated'])
);

-- The head has no relationship to themself; `is_household_head` already says it.
alter table public.individuals drop constraint if exists individuals_head_has_no_relationship;
alter table public.individuals add constraint individuals_head_has_no_relationship check (
  not (is_household_head and relationship_to_head is not null)
);

-- An override without its reason is not provenance, it is just a pointer. The
-- reason is the whole record of why a BHW said "different person".
alter table public.individuals drop constraint if exists individuals_override_is_complete;
alter table public.individuals add constraint individuals_override_is_complete check (
  duplicate_override_of is null
  or (duplicate_override_reason is not null and length(btrim(duplicate_override_reason)) > 0)
);

alter table public.individuals drop constraint if exists individuals_override_is_not_self;
alter table public.individuals add constraint individuals_override_is_not_self check (
  duplicate_override_of is null or duplicate_override_of <> resident_id
);

create index if not exists individuals_duplicate_override_of_idx
  on public.individuals (duplicate_override_of);

create or replace function private.stamp_individual_actor()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
begin
  new.updated_by := auth.uid();

  if new.duplicate_override_of is not null then
    new.duplicate_override_by := auth.uid();
    -- The device's clock, not the server's, when the device supplied one: the
    -- override happened in the field, possibly days before this row arrived.
    new.duplicate_override_at := coalesce(new.duplicate_override_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists individuals_stamp_actor on public.individuals;
create trigger individuals_stamp_actor
  before insert or update on public.individuals
  for each row execute function private.stamp_individual_actor();

-- =============================================================================
-- MEMBER STATUS  (applied 2026-08-29, migration `individuals_status`)
--
-- A member who moved out, died or transferred is marked, never deleted. Her row
-- is the parent of every weight, height and supply release ever recorded for
-- her (`on delete cascade`), so deleting it to record that she left would take
-- the history with it and leave no trace that she was ever here — the next round
-- of profiling would add her back as a stranger.
--
-- Default lists filter to `active`, which is the part the field asked for. No
-- DELETE policy is added: removal still goes through the SQL editor, by design.
-- =============================================================================

alter table public.individuals
  add column if not exists status text not null default 'active',
  add column if not exists status_changed_on date;

alter table public.individuals drop constraint if exists individuals_status_check;
alter table public.individuals add constraint individuals_status_check check (
  status in ('active', 'moved_out', 'deceased', 'transferred')
);

comment on column public.individuals.status is
  'Whether this person is still counted in the household. A member who left is marked, never deleted: their assessments and supply releases stay attached to a person who has a reason for being gone.';

comment on column public.individuals.status_changed_on is
  'The day the status last moved away from active. Null while active.';
