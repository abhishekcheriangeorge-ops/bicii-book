-- Deactivation ends the person's Supabase Auth sessions at once (PLAN D71;
-- D10 staff sign-in with email codes; DATA-MODEL §15 and §16
-- set_staff_active).
--
-- Rules encoded here:
--   * When a staff row goes from active to inactive, through
--     set_staff_active or any other writer (the service role, SQL run by
--     hand), the person's auth.sessions rows are deleted in the same
--     transaction. Their refresh tokens cascade (refresh_tokens.session_id
--     ... on delete cascade), and refresh tokens without a session are
--     deleted by user, so no device can refresh. A refused deactivation
--     (reason_required, self-deactivation, last admin) rolls back with the
--     rest of the statement and deletes nothing.
--   * Where JWTs are verified without asking Auth (hosted asymmetric keys),
--     an access token already issued stays valid until it expires (at most
--     jwt_expiry). For that window requireStaff, RLS and the RPC guards
--     refuse it because the person is inactive.
--   * Reactivation deletes nothing; the person signs in again with a code.
--   * The trigger, not the Auth admin API, does this: it fires for every
--     writer and commits or rolls back with the deactivation itself.
--
-- The migration refuses to apply when its role cannot delete from
-- auth.sessions and auth.refresh_tokens (RUNBOOK "Applying migrations"):
-- the trigger function is security definer, so it runs with exactly the
-- migration role's rights.

do $$
begin
  if not pg_catalog.has_table_privilege(current_user, 'auth.sessions', 'DELETE')
     or not pg_catalog.has_table_privilege(current_user, 'auth.refresh_tokens', 'DELETE') then
    raise exception using
      message = pg_catalog.format(
        'role %I cannot delete from auth.sessions and auth.refresh_tokens, so deactivation could not revoke Auth sessions (PLAN D71)',
        current_user),
      hint = 'Do not edit this migration. See docs/RUNBOOK.md "Applying migrations": resolve the grant with Supabase, then apply it again.';
  end if;
end;
$$;

create function private.revoke_auth_sessions_on_deactivation()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- Refresh tokens and MFA claims of these sessions cascade.
  delete from auth.sessions s where s.user_id = new.auth_user_id;
  -- Refresh tokens issued without a session (older Auth versions); the
  -- column is varchar.
  delete from auth.refresh_tokens t where t.user_id = new.auth_user_id::text;
  return null;
end;
$$;

comment on function private.revoke_auth_sessions_on_deactivation() is
  'Trigger staff_revoke_sessions: deletes a deactivated person''s Supabase Auth sessions and refresh tokens (PLAN D71).';

revoke all on function private.revoke_auth_sessions_on_deactivation()
from public, anon, authenticated, service_role;

create trigger staff_revoke_sessions
  after update of active on public.staff
  for each row
  when (old.active and not new.active)
  execute function private.revoke_auth_sessions_on_deactivation();
