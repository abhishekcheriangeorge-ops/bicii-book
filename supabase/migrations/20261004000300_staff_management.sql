-- Staff management from Staff settings (SPEC §4.2, §21 "Staff/permissions
-- and settings"; PLAN D10; DATA-MODEL.md §1, §15, §16).
--
-- Rules encoded here:
--   * Inviting a colleague is two steps: the server creates the Supabase
--     Auth login with the service-role admin API, then calls create_staff AS
--     THE INVITING USER, so the authorization check below runs with their
--     identity, not the service role's.
--   * create_staff is for admins and holders of manage_staff. Only an admin
--     can create another admin (mirrors set_staff_active: only an admin
--     changes an admin's state).
--   * The staff email must be the Auth login's email; staff emails are
--     unique case-insensitively (citext unique -> SQLSTATE 23505).
--   * staff_roster gives the people who manage staff the list they manage:
--     every staff row with its granted permissions. Without it a manage_staff
--     holder who is not an admin could grant permissions but not see them
--     (staff_permissions select is admin or own rows, §15).
--
-- Error convention for application-raised business errors (new in this
-- migration, used by every later RPC): SQLSTATE P0001 with MESSAGE set to a
-- stable snake_case code and DETAIL set to an explanation. The app maps the
-- code to a user-facing message (src/lib/db-errors.ts); unknown codes become
-- a generic error. Authorization failures stay 42501.

create function public.create_staff(
  auth_user_id uuid,
  display_name text,
  email text,
  role public.staff_role default 'staff'
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
  if create_staff.role = 'admin' and not caller_is_admin then
    raise exception 'only an admin can create an admin' using errcode = '42501';
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
  'Admin or manage_staff: link an existing Auth login to a new active staff row. Only admins create admins.';

-- Admin or manage_staff: every staff row with the permissions GRANTED to it
-- (not effective permissions: admins hold every permission by role, which
-- the UI shows separately). Active first, then by name.
create function public.staff_roster()
returns table (
  id uuid,
  auth_user_id uuid,
  display_name text,
  email text,
  role public.staff_role,
  active boolean,
  granted_permissions public.permission_key[],
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    perform private.require_permission('manage_staff');
  end if;

  return query
    select
      s.id,
      s.auth_user_id,
      s.display_name,
      s.email::text,
      s.role,
      s.active,
      coalesce(
        (select pg_catalog.array_agg(sp.permission order by sp.permission)
         from public.staff_permissions sp
         where sp.staff_id = s.id),
        '{}'::public.permission_key[]
      ),
      s.created_at
    from public.staff s
    order by s.active desc, s.display_name, s.id;
end;
$$;

comment on function public.staff_roster() is
  'Admin or manage_staff: every staff row with its granted permissions, for Staff settings.';

revoke all on function
  public.create_staff(uuid, text, text, public.staff_role),
  public.staff_roster()
from public, anon, authenticated, service_role;

grant execute on function
  public.create_staff(uuid, text, text, public.staff_role),
  public.staff_roster()
to authenticated;
