-- Who administers which role (PLAN D93 ROLE-ADMINISTRATION, restating D11
-- for roles; D92 ROLE-EXCEPTIONS; ADR-021; DATA-MODEL.md §1, §15, §16).
--
-- Rules encoded here (same signatures and results as before; every
-- function replaced here has its revoke/grant restated):
--   * Only an admin invites anyone as admin or manager, changes anyone's
--     role (promote or demote) and changes an admin's or a manager's row
--     (rename, deactivate, reactivate, exceptions).
--   * A manage_staff holder who is not an admin (a mechanic or a manager
--     granted manage_staff as an exception) invites mechanics only and acts
--     on mechanics' rows only, within the unchanged D11 ceiling for
--     exceptions: only permissions they hold themselves, never manage_staff,
--     never their own row.
--   * Nobody changes their own role; the last active admin cannot be
--     demoted or deactivated (staff_keep_an_active_admin, unchanged).
--   * Every role change appends one role_changed event with its actor and
--     an optional reason (at most 500 characters); exceptions the new role
--     implies are deleted with permission_revoked events carrying the same
--     actor and reason (staff_role_drop_implied_exceptions).
--   * grant_permission refuses an exception the target's role already
--     implies (P0001 permission_implied_by_role) before inserting; revoking
--     a row that does not exist stays a replay-safe null.

-- ---------------------------------------------------------------------------
-- create_staff: role defaults to mechanic; only an admin creates an admin
-- or a manager.
-- ---------------------------------------------------------------------------
create or replace function public.create_staff(
  auth_user_id uuid,
  display_name text,
  email text,
  role public.staff_role default 'mechanic'
)
returns public.staff
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_is_admin boolean := private.is_admin();
  login_email text;
  result public.staff;
begin
  if not caller_is_admin then
    perform private.require_permission('manage_staff');
  end if;

  if create_staff.auth_user_id is null or create_staff.email is null or create_staff.role is null then
    raise exception 'auth_user_id, email and role are required' using errcode = '22004';
  end if;
  if create_staff.role <> 'mechanic' and not caller_is_admin then
    raise exception 'only an admin can create an admin or a manager' using errcode = '42501';
  end if;

  select u.email::text into login_email from auth.users u where u.id = create_staff.auth_user_id;
  if not found then
    raise exception 'auth user % not found', create_staff.auth_user_id using errcode = 'P0002';
  end if;
  if login_email is null or lower(login_email) <> lower(btrim(create_staff.email)) then
    raise exception using
      errcode = 'P0001',
      message = 'staff_email_mismatch',
      detail = 'The staff email must be the email of the Auth login it is linked to.';
  end if;

  insert into public.staff (auth_user_id, display_name, email, role)
  values (
    create_staff.auth_user_id,
    btrim(create_staff.display_name),
    lower(btrim(create_staff.email)),
    create_staff.role
  )
  returning * into result;
  return result;
end;
$$;

comment on function public.create_staff(uuid, text, text, public.staff_role) is
  'Admin or manage_staff: link an existing Auth login to a new active staff row (role mechanic by default). Only admins create admins and managers (D93).';

comment on function public.staff_roster() is
  'Admin or manage_staff: every staff row with its exceptions (granted_permissions: staff_permissions rows on top of the role, D92), for Staff settings.';

-- ---------------------------------------------------------------------------
-- Authorization for exception changes (D11 ceiling, D93). Locks the target
-- row. Returns the actor's staff id.
-- ---------------------------------------------------------------------------
create or replace function private.authorize_permission_change(
  target_staff_id uuid,
  permission public.permission_key
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_is_admin boolean := private.is_admin();
  actor uuid;
  target public.staff;
begin
  if caller_is_admin then
    actor := private.current_staff_id();
  else
    actor := private.require_permission('manage_staff');
  end if;

  select s.* into target from public.staff s where s.id = target_staff_id for update;
  if not found then
    raise exception 'staff % not found', target_staff_id using errcode = 'P0002';
  end if;

  if caller_is_admin then
    return actor;
  end if;
  if target.id = actor then
    raise exception 'staff cannot change their own permissions' using errcode = '42501';
  end if;
  if target.role <> 'mechanic' then
    raise exception 'only an admin changes an admin''s or a manager''s access' using errcode = '42501';
  end if;
  if authorize_permission_change.permission = 'manage_staff' then
    raise exception 'only an admin grants or revokes manage_staff' using errcode = '42501';
  end if;
  if not private.has_permission(authorize_permission_change.permission) then
    raise exception 'only permissions the caller holds can be granted or revoked (%)',
      authorize_permission_change.permission
      using errcode = '42501';
  end if;
  return actor;
end;
$$;

-- Admin, or manage_staff within the ceiling. Refuses an exception the
-- target's role already implies (D92). Idempotent: granting an existing
-- exception returns the existing row unchanged and records no event.
create or replace function public.grant_permission(target_staff_id uuid, permission public.permission_key)
returns public.staff_permissions
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.authorize_permission_change(target_staff_id, grant_permission.permission);
  target_role public.staff_role;
  result public.staff_permissions;
begin
  -- The target row is locked by authorize_permission_change.
  select s.role into target_role from public.staff s where s.id = target_staff_id;
  if private.role_implies(target_role, grant_permission.permission) then
    raise exception using
      errcode = 'P0001',
      message = 'permission_implied_by_role',
      detail = 'Their role already includes that permission.';
  end if;

  insert into public.staff_permissions as sp (staff_id, permission, granted_by)
  values (target_staff_id, grant_permission.permission, actor)
  on conflict on constraint staff_permissions_pkey do nothing;

  select sp.* into result
  from public.staff_permissions sp
  where sp.staff_id = target_staff_id and sp.permission = grant_permission.permission;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_staff_active: an admin acts on anyone; a manage_staff holder who is
-- not an admin on mechanics only. Otherwise unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.set_staff_active(target_staff_id uuid, active boolean, reason text default null)
returns public.staff
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid;
  caller_is_admin boolean := private.is_admin();
  target public.staff;
begin
  if caller_is_admin then
    actor := private.current_staff_id();
  else
    actor := private.require_permission('manage_staff');
  end if;

  if set_staff_active.active is null then
    raise exception 'active must be true or false' using errcode = '22004';
  end if;

  select s.* into target from public.staff s where s.id = target_staff_id for update;
  if not found then
    raise exception 'staff % not found', target_staff_id using errcode = 'P0002';
  end if;

  if target.id = actor and not set_staff_active.active then
    raise exception 'staff cannot deactivate themselves' using errcode = '42501';
  end if;
  if target.role <> 'mechanic' and not caller_is_admin then
    raise exception 'only an admin changes an admin''s or a manager''s access' using errcode = '42501';
  end if;
  if target.active = set_staff_active.active then
    return target;
  end if;
  if not set_staff_active.active and nullif(pg_catalog.btrim(coalesce(reason, '')), '') is null then
    raise exception using
      errcode = 'P0001',
      message = 'reason_required',
      detail = 'Say why this person is being deactivated.';
  end if;

  perform private.set_staff_event_reason(reason);
  update public.staff s
  set active = set_staff_active.active
  where s.id = target_staff_id
  returning s.* into target;
  perform private.set_staff_event_reason(null);
  return target;
end;
$$;

-- ---------------------------------------------------------------------------
-- update_staff: rename, or (admin only, never one's own) change role. Null
-- leaves a field as it is. A manage_staff holder who is not an admin renames
-- mechanics only. The reason reaches role_changed and any permission_revoked
-- events through set_staff_event_reason. The last active admin cannot be
-- demoted (trigger). Email is not editable here (staff_enforce_rules).
-- ---------------------------------------------------------------------------
create or replace function public.update_staff(
  target_staff_id uuid,
  display_name text default null,
  role public.staff_role default null,
  reason text default null
)
returns public.staff
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid;
  caller_is_admin boolean := private.is_admin();
  target public.staff;
begin
  if caller_is_admin then
    actor := private.current_staff_id();
  else
    actor := private.require_permission('manage_staff');
  end if;

  select s.* into target from public.staff s where s.id = target_staff_id for update;
  if not found then
    raise exception 'staff % not found', target_staff_id using errcode = 'P0002';
  end if;

  if update_staff.role is not null and update_staff.role <> target.role then
    if not caller_is_admin then
      raise exception 'only an admin changes roles' using errcode = '42501';
    end if;
    if target.id = actor then
      raise exception 'staff cannot change their own role' using errcode = '42501';
    end if;
  end if;
  if update_staff.display_name is not null and target.role <> 'mechanic' and not caller_is_admin then
    raise exception 'only an admin can rename an admin or a manager' using errcode = '42501';
  end if;

  perform private.set_staff_event_reason(reason);
  update public.staff s
  set display_name = coalesce(pg_catalog.btrim(update_staff.display_name), s.display_name),
      role = coalesce(update_staff.role, s.role)
  where s.id = target_staff_id
  returning s.* into target;
  perform private.set_staff_event_reason(null);
  return target;
end;
$$;

comment on function public.update_staff(uuid, text, public.staff_role, text) is
  'Admin or manage_staff: rename (non-admins: mechanics only), or change role (admins only, never their own; the last active admin stays). A role change appends role_changed with the reason and drops exceptions the new role implies (D92, D93).';

-- ---------------------------------------------------------------------------
-- Privileges (restated for every function replaced here)
-- ---------------------------------------------------------------------------
revoke all on function
  private.authorize_permission_change(uuid, public.permission_key)
from public, anon, authenticated, service_role;

revoke all on function
  public.create_staff(uuid, text, text, public.staff_role),
  public.grant_permission(uuid, public.permission_key),
  public.set_staff_active(uuid, boolean, text),
  public.update_staff(uuid, text, public.staff_role, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.create_staff(uuid, text, text, public.staff_role),
  public.grant_permission(uuid, public.permission_key),
  public.set_staff_active(uuid, boolean, text),
  public.update_staff(uuid, text, public.staff_role, text)
to authenticated;
