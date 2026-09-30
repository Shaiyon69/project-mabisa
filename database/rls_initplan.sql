-- Wraps every no-argument session helper in a policy (and in readable_household_ids)
-- in a scalar subquery, so Postgres runs it once per statement as an initplan
-- instead of once per row. The helpers are SECURITY DEFINER and never inlined,
-- so a 960-row inventory read was paying for ~3,000 profile lookups.
-- Same predicates, same answers. Helpers that take a row column stay per-row.
-- Applied to the live project as migration `rls_initplan`.

create or replace function public.readable_household_ids()
returns setof uuid
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select h.household_id from public.households h
  where (select public.is_admin())
     or ((select public.is_barangay_admin()) and h.barangay_id = (select public.current_barangay_id()))
     or ((select public.is_bhw()) and h.purok_id = (select public.current_bhw_purok_id()));
$$;

alter policy barangays_select_active_profile on public.barangays
  using ((select public.current_profile_is_active()));

alter policy puroks_select_foundation on public.puroks
  using (
    (select public.current_profile_is_active())
    and (
      (select public.is_admin())
      or ((select public.is_barangay_admin()) and barangay_id = (select public.current_barangay_id()))
      or purok_id = (select public.current_bhw_purok_id())
    )
  );

alter policy inventory_items_select_scoped on public.inventory_items
  using (
    (select public.current_profile_is_active())
    and ((select public.is_admin()) or barangay_id = (select public.current_barangay_id()))
  );

alter policy inventory_allocations_select_scoped on public.inventory_allocations
  using (
    (select public.current_profile_is_active())
    and (
      (select public.is_admin())
      or bhw_id = (select auth.uid())
      or (
        (select public.is_barangay_admin())
        and exists (
          select 1 from public.inventory_items item
          where item.item_id = inventory_allocations.item_id
            and item.barangay_id = (select public.current_barangay_id())
        )
      )
    )
  );

alter policy profiles_select_foundation on public.profiles
  using (
    (select public.current_profile_is_active())
    and (
      (select public.is_admin())
      or user_id = (select auth.uid())
      or ((select public.is_barangay_admin()) and public.bhw_home_barangay_id(user_id) = (select public.current_barangay_id()))
    )
  );

alter policy assignments_select_foundation on public.bhw_purok_assignments
  using (
    (select public.current_profile_is_active())
    and (
      (select public.is_admin())
      or bhw_id = (select auth.uid())
      or ((select public.is_barangay_admin()) and public.profile_barangay_id(bhw_id) = (select public.current_barangay_id()))
    )
  );

alter policy audit_events_select_admin on public.audit_events
  using (
    (select public.current_profile_is_active())
    and (
      (select public.is_admin())
      or ((select public.is_barangay_admin()) and public.profile_barangay_id(actor_user_id) = (select public.current_barangay_id()))
    )
  );
