-- Project MABISA — terms_acceptances: who agreed to which Terms of Use and Privacy Notice
--
-- Not yet applied to the live project. Until it is, the client's insert after
-- sign-in fails quietly (logged in development) and sign-in is unaffected.
--
-- One row per sign-in that ticked the agreement, so the record shows each time a
-- person agreed and to which wording (`TERMS_VERSION` in
-- src/components/common/TermsNotice.tsx). Append-only: nobody updates or deletes
-- a row through the API, since an acceptance that can be edited proves nothing.

create table if not exists public.terms_acceptances (
  acceptance_id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  terms_version text not null check (length(terms_version) between 1 and 32),
  accepted_at timestamptz not null default now()
);

alter table public.terms_acceptances enable row level security;

create index if not exists terms_acceptances_user_id_idx on public.terms_acceptances (user_id, accepted_at desc);

-- The account and the time are the server's, never the device's.
create or replace function private.stamp_terms_acceptance()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
begin
  new.user_id := auth.uid();
  new.accepted_at := now();

  return new;
end;
$$;

drop trigger if exists terms_acceptances_stamp on public.terms_acceptances;
create trigger terms_acceptances_stamp
  before insert on public.terms_acceptances
  for each row execute function private.stamp_terms_acceptance();

-- Not gated on current_profile_is_active(): a disabled account that still signed
-- in agreed to the terms all the same, and the record should say so.
drop policy if exists terms_acceptances_insert_own on public.terms_acceptances;
create policy terms_acceptances_insert_own
  on public.terms_acceptances for insert to authenticated
  with check (user_id = (select auth.uid()));

-- Each account reads its own; the RHU reads everyone's, for an NPC compliance check.
drop policy if exists terms_acceptances_select_own_or_admin on public.terms_acceptances;
create policy terms_acceptances_select_own_or_admin
  on public.terms_acceptances for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

revoke all on public.terms_acceptances from anon;
revoke update, delete, truncate on public.terms_acceptances from authenticated;
grant select, insert on public.terms_acceptances to authenticated;
