-- Project MABISA — immunizations: a minimal vaccination log
--
-- Applied to the live project on 2026-09-14 as migration `immunizations`.
--
-- One row per dose given — no schedule or due-date engine. Same shape as
-- `health_assessments`: a leaf off `individuals`, scoped and policied the same way.

create table if not exists public.immunizations (
  immunization_id uuid primary key default gen_random_uuid(),
  resident_id uuid not null references public.individuals (resident_id) on delete cascade,
  vaccine_name text not null,
  dose_number smallint,
  date_given date not null,
  given_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.immunizations enable row level security;

create index if not exists immunizations_resident_id_idx on public.immunizations (resident_id);

-- The giver is the caller on insert and never changes after; a device-supplied value is ignored.
create or replace function private.stamp_immunization_actor()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
begin
  if tg_op = 'UPDATE' then
    new.given_by := old.given_by;
  else
    new.given_by := auth.uid();
  end if;

  return new;
end;
$$;

drop trigger if exists immunizations_stamp_actor on public.immunizations;
create trigger immunizations_stamp_actor
  before insert or update on public.immunizations
  for each row execute function private.stamp_immunization_actor();

drop trigger if exists immunizations_set_updated_at on public.immunizations;
create trigger immunizations_set_updated_at
  before update on public.immunizations
  for each row execute function private.set_updated_at();

-- Same read-once shape as health_assessments_select_scoped, not a per-row can_read_resident().
drop policy if exists immunizations_select_scoped on public.immunizations;
create policy immunizations_select_scoped
  on public.immunizations for select to authenticated
  using (
    (select public.current_profile_is_active())
    and resident_id in (select public.readable_resident_ids())
  );

drop policy if exists immunizations_insert_bhw on public.immunizations;
create policy immunizations_insert_bhw
  on public.immunizations for insert to authenticated
  with check (public.is_bhw() and public.can_read_resident(resident_id));

drop policy if exists immunizations_update_bhw on public.immunizations;
create policy immunizations_update_bhw
  on public.immunizations for update to authenticated
  using (public.is_bhw() and public.can_read_resident(resident_id))
  with check (public.is_bhw() and public.can_read_resident(resident_id));
