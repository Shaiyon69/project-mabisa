-- Project MABISA — drop the pre-profiles role model and other dead objects
--
-- Applied to the live project on 2026-09-15 as migration `drop_legacy_users`.
--
-- `public.users` was superseded by `public.profiles`, had no grants or policies, and
-- still held password hashes. The functions, trigger function and enum below existed
-- only for it. `barangay_underweight_page` was never called by the app.

drop function if exists public.is_lgu_staff();
drop function if exists public.current_user_role();
drop table if exists public.users;
drop function if exists public.set_updated_at();
drop type if exists public.user_role;
drop function if exists public.barangay_underweight_page(date, date, integer, integer, uuid);

-- A login created without a profile: it had no role and could reach neither surface.
delete from auth.users where id = '2fb2f0ff-5679-4ba5-a77a-b5e28193c8c3' and email = 'shaine@gmail.com'
  and not exists (select 1 from public.profiles where user_id = '2fb2f0ff-5679-4ba5-a77a-b5e28193c8c3');
