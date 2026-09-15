-- Project MABISA — list reads the portal pages on the server
--
-- Applied to the live project on 2026-09-15 as migration `server_paging`.
--
-- Each view and function runs as the caller, so the row scope is still the
-- tables' own RLS. PostgREST adds the filters, order, range and count.

-- Barangay stock with its name and low-stock state, so both can be filtered and sorted on.
create or replace view public.inventory_item_rows with (security_invoker = true) as
select
  item.item_id,
  item.item_name,
  item.type,
  item.current_stock,
  item.reorder_level,
  item.barangay_id,
  item.created_at,
  item.updated_at,
  barangay.name as barangay_name,
  -- Same rule as `lowStockItems`: a level of 0 turns the warning off.
  item.reorder_level > 0 and item.current_stock <= item.reorder_level as is_low
from public.inventory_items as item
left join public.barangays as barangay on barangay.barangay_id = item.barangay_id;

revoke all on public.inventory_item_rows from public, anon, authenticated;
grant select on public.inventory_item_rows to authenticated;

-- Every account with its current purok. A BHW's barangay is reached through the purok, a barangay admin's off the profile.
create or replace view public.account_rows with (security_invoker = true) as
select
  profile.user_id,
  profile.role,
  profile.barangay_id,
  profile.full_name,
  profile.is_active,
  profile.created_at,
  profile.updated_at,
  profile.created_by,
  profile.disabled_at,
  profile.disabled_by,
  assignment.purok_id,
  purok.name as purok_name,
  assignment.started_at as assigned_since,
  coalesce(purok.barangay_id, profile.barangay_id) as scope_barangay_id
from public.profiles as profile
left join public.bhw_purok_assignments as assignment
  on assignment.bhw_id = profile.user_id and assignment.ended_at is null
left join public.puroks as purok on purok.purok_id = assignment.purok_id;

revoke all on public.account_rows from public, anon, authenticated;
grant select on public.account_rows to authenticated;

-- One page of residents checked in the period: each one's latest check, by last name.
create or replace function public.resident_health_page(
  period_from date,
  period_to date,
  scope_barangay_id uuid default null,
  scope_purok_id uuid default null,
  search_text text default null,
  page_limit integer default 10,
  page_offset integer default 0
)
returns table (
  resident_id uuid,
  household_id uuid,
  first_name text,
  last_name text,
  sex text,
  birthday date,
  household_number text,
  barangay_name text,
  checks integer,
  latest jsonb,
  total_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with checked as (
    select
      assessment.resident_id,
      count(*)::integer as checks,
      -- A same-day correction: the later write is the one that counts.
      (array_agg(to_jsonb(assessment) order by assessment.assessment_date desc, assessment.updated_at desc))[1] as latest
    from public.health_assessments as assessment
    where assessment.assessment_date between period_from and period_to
    group by assessment.resident_id
  )
  select
    person.resident_id,
    person.household_id,
    person.first_name,
    person.last_name,
    person.sex,
    person.birthday,
    household.household_number,
    coalesce(barangay.name, 'Unassigned'),
    checked.checks,
    checked.latest,
    (count(*) over ())::integer
  from checked
  join public.individuals as person on person.resident_id = checked.resident_id
  join public.households as household on household.household_id = person.household_id
  left join public.barangays as barangay on barangay.barangay_id = household.barangay_id
  where (scope_barangay_id is null or household.barangay_id = scope_barangay_id)
    and (scope_purok_id is null or household.purok_id = scope_purok_id)
    and (
      coalesce(search_text, '') = ''
      or strpos(lower(concat_ws(' ', person.first_name, person.last_name, household.household_number)), lower(search_text)) > 0
    )
  order by person.last_name, person.first_name, person.resident_id
  limit greatest(page_limit, 1)
  offset greatest(page_offset, 0)
$$;

revoke execute on function public.resident_health_page(date, date, uuid, uuid, text, integer, integer) from public, anon;
grant execute on function public.resident_health_page(date, date, uuid, uuid, text, integer, integer) to authenticated;

-- Every resident with their household's number and scope, so the registry can search and filter on one row.
-- Applied to the live project as migration `resident_rows`.
create or replace view public.resident_rows with (security_invoker = true) as
select
  person.resident_id,
  person.household_id,
  person.first_name,
  person.middle_name,
  person.last_name,
  person.sex,
  person.birthday,
  person.is_household_head,
  person.relationship_to_head,
  person.occupation,
  person.educational_attainment,
  person.is_out_of_school_youth,
  person.is_pregnant_nursing_fp,
  person.philhealth_number,
  person.status,
  person.status_changed_on,
  person.created_at,
  person.updated_at,
  household.household_number,
  household.barangay_id,
  household.purok_id,
  barangay.name as barangay_name
from public.individuals as person
join public.households as household on household.household_id = person.household_id
left join public.barangays as barangay on barangay.barangay_id = household.barangay_id;

revoke all on public.resident_rows from public, anon, authenticated;
grant select on public.resident_rows to authenticated;

-- Only the authenticated policies call these; a signed-out caller has no use for them.
-- Applied to the live project as migration `revoke_anon_execute_on_readable_ids`.
revoke execute on function public.readable_household_ids() from public, anon;
revoke execute on function public.readable_resident_ids() from public, anon;
