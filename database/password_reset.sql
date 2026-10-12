-- Project MABISA — an administrator resets a forgotten password
--
-- Applied to the live project on 2026-10-12 as migration `admin_record_password_reset`.
--
-- The new password is set by the `reset-password` function, which holds the service
-- role. This is the gate it calls first, as the caller: the same reach as
-- deactivating an account, minus RHU accounts, which reset their own by email.

create or replace function public.admin_record_password_reset(target_user_id uuid, change_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_id uuid := private.assert_can_manage_bhw(target_user_id);
begin
  if nullif(btrim(change_reason), '') is null then
    raise check_violation using message = 'A reason is required';
  end if;

  if (select role from public.profiles where user_id = target_user_id) = 'admin'::public.app_role then
    raise insufficient_privilege using message = 'An RHU account resets its own password from the sign-in screen';
  end if;

  perform private.write_audit_event('profile.password_reset', 'profiles', target_user_id, btrim(change_reason));
end;
$$;

revoke execute on function public.admin_record_password_reset(uuid, text) from public, anon;
grant execute on function public.admin_record_password_reset(uuid, text) to authenticated;
