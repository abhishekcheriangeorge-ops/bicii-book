-- Staff identity and authorization (SPEC §4.2; DATA-MODEL.md §1, §15, §16).
--
-- Rules encoded here:
--   * "Staff" in any policy means an ACTIVE staff row for the calling
--     auth.uid(). Deactivating a staff member revokes everything at once.
--   * role = admin implies every permission; role = staff has only the rows
--     granted in staff_permissions.
--   * Staff see their own row and the names of colleagues (staff_directory);
--     admins see and edit every row. Anonymous users see nothing.
--   * Permission changes go through grant_permission / revoke_permission /
--     set_staff_active (admin or manage_staff), which record who granted.

-- ---------------------------------------------------------------------------
-- Enums. Adding a value is a migration: these are business facts.
-- ---------------------------------------------------------------------------
create type public.staff_role as enum ('admin', 'staff');

create type public.permission_key as enum (
  'view_costs',
  'manage_inventory',
  'adjust_stock',
  'manage_consignments',
  'manage_purchasing',
  'manage_staff',
  'view_financial_reports'
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.staff (
  id uuid primary key default gen_random_uuid(),
  -- Restrict: staff rows are history (assignments, ledgers); deactivate
  -- instead of deleting the login.
  auth_user_id uuid not null unique references auth.users (id) on delete restrict,
  display_name text not null check (btrim(display_name) <> ''),
  email extensions.citext not null unique,
  role public.staff_role not null default 'staff',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.staff is
  'Workshop staff. Active staff are authorized per role/permissions; admin implies all permissions.';

create trigger staff_set_updated_at
  before update on public.staff
  for each row execute function private.set_updated_at();

create table public.staff_permissions (
  staff_id uuid not null references public.staff (id) on delete restrict,
  permission public.permission_key not null,
  -- Null for rows created outside the app (seed, service role).
  granted_by uuid null references public.staff (id) on delete restrict,
  granted_at timestamptz not null default now(),
  primary key (staff_id, permission)
);
create index staff_permissions_granted_by_idx on public.staff_permissions (granted_by);
comment on table public.staff_permissions is
  'Granular permissions for role=staff. Ignored for admins (admin implies all) and for inactive staff (none).';

-- ---------------------------------------------------------------------------
-- Helpers (private; security definer so they can read staff under RLS).
-- ---------------------------------------------------------------------------
create function private.current_staff_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.staff s
  where s.auth_user_id = auth.uid()
    and s.active;
$$;

create function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff s
    where s.auth_user_id = auth.uid() and s.active
  );
$$;

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff s
    where s.auth_user_id = auth.uid() and s.active and s.role = 'admin'
  );
$$;

create function private.has_permission(permission public.permission_key)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff s
    where s.auth_user_id = auth.uid()
      and s.active
      and (
        s.role = 'admin'
        or exists (
          select 1 from public.staff_permissions sp
          where sp.staff_id = s.id and sp.permission = has_permission.permission
        )
      )
  );
$$;

-- Every privileged RPC calls one of these first. SQLSTATE 42501
-- (insufficient_privilege) maps to HTTP 403 in PostgREST.
create function private.require_staff()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  staff_id uuid := private.current_staff_id();
begin
  if staff_id is null then
    raise exception 'active staff membership required'
      using errcode = '42501';
  end if;
  return staff_id;
end;
$$;

create function private.require_permission(permission public.permission_key)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(require_permission.permission) then
    raise exception 'permission % required', require_permission.permission
      using errcode = '42501';
  end if;
  return private.current_staff_id();
end;
$$;

-- Lockout guard: an update may never leave the shop without an active admin.
-- The advisory lock serialises concurrent demotions so two admins cannot
-- demote each other at the same time.
create function private.staff_keep_an_active_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'admin' and old.active and not (new.role = 'admin' and new.active) then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('bicii.staff.active_admins'));
    if not exists (
      select 1 from public.staff s
      where s.role = 'admin' and s.active and s.id <> old.id
    ) then
      raise exception 'cannot remove the last active admin'
        using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

create trigger staff_keep_an_active_admin
  before update of role, active on public.staff
  for each row execute function private.staff_keep_an_active_admin();

revoke all on function
  private.current_staff_id(),
  private.is_staff(),
  private.is_admin(),
  private.has_permission(public.permission_key),
  private.require_staff(),
  private.require_permission(public.permission_key),
  private.staff_keep_an_active_admin()
from public, anon, authenticated, service_role;

-- RLS policy expressions run as the caller, so the API role that has
-- policies needs USAGE on `private` and EXECUTE on the predicates the
-- policies call. Nothing else in `private` is granted; `private` is not an
-- exposed API schema, so none of this is reachable over HTTP.
grant usage on schema private to authenticated;
grant execute on function
  private.current_staff_id(),
  private.is_staff(),
  private.is_admin(),
  private.has_permission(public.permission_key)
to authenticated;

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------
alter table public.staff enable row level security;
alter table public.staff_permissions enable row level security;

revoke all on table public.staff from public, anon, authenticated, service_role;
revoke all on table public.staff_permissions from public, anon, authenticated, service_role;

grant select on table public.staff to authenticated;
grant insert (auth_user_id, display_name, email, role, active) on table public.staff to authenticated;
grant update (display_name, email, role, active) on table public.staff to authenticated;
grant select on table public.staff_permissions to authenticated;
-- Writes to staff_permissions only through the RPCs below.

grant select, insert, update, delete on table public.staff to service_role;
grant select, insert, update, delete on table public.staff_permissions to service_role;

-- staff: own row (while active) or admin. Colleague names: staff_directory().
create policy staff_select_own_or_admin on public.staff
  for select to authenticated
  using (id = (select private.current_staff_id()) or (select private.is_admin()));

create policy staff_insert_admin on public.staff
  for insert to authenticated
  with check ((select private.is_admin()));

create policy staff_update_admin on public.staff
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- staff_permissions: own rows (while active) or admin.
create policy staff_permissions_select_own_or_admin on public.staff_permissions
  for select to authenticated
  using (staff_id = (select private.current_staff_id()) or (select private.is_admin()));

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- The caller's staff row plus effective permissions: every permission for an
-- active admin, the granted ones for active staff, none when inactive. Zero
-- rows when the caller has no staff row (e.g. a customer).
create function public.my_staff_profile()
returns table (
  id uuid,
  auth_user_id uuid,
  display_name text,
  email text,
  role public.staff_role,
  active boolean,
  permissions public.permission_key[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    s.auth_user_id,
    s.display_name,
    s.email::text,
    s.role,
    s.active,
    case
      when not s.active then '{}'::public.permission_key[]
      when s.role = 'admin' then pg_catalog.enum_range(null::public.permission_key)
      else coalesce(
        (select pg_catalog.array_agg(sp.permission order by sp.permission)
         from public.staff_permissions sp
         where sp.staff_id = s.id),
        '{}'::public.permission_key[]
      )
    end
  from public.staff s
  where s.auth_user_id = auth.uid();
$$;

-- Names of every colleague (active or not, so history stays readable) for
-- pickers and timelines. Active staff only.
create function public.staff_directory()
returns table (
  id uuid,
  display_name text,
  role public.staff_role,
  active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff();
  return query
    select s.id, s.display_name, s.role, s.active
    from public.staff s
    order by s.active desc, s.display_name;
end;
$$;

-- Admin or manage_staff. Idempotent: granting an existing permission returns
-- the existing row unchanged.
create function public.grant_permission(target_staff_id uuid, permission public.permission_key)
returns public.staff_permissions
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid;
  result public.staff_permissions;
begin
  if private.is_admin() then
    actor := private.current_staff_id();
  else
    actor := private.require_permission('manage_staff');
  end if;

  perform 1 from public.staff s where s.id = target_staff_id for update;
  if not found then
    raise exception 'staff % not found', target_staff_id using errcode = 'P0002';
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

-- Admin or manage_staff. Returns the removed row, or null when there was
-- nothing to revoke (replay-safe).
create function public.revoke_permission(target_staff_id uuid, permission public.permission_key)
returns public.staff_permissions
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result public.staff_permissions;
begin
  if not private.is_admin() then
    perform private.require_permission('manage_staff');
  end if;

  perform 1 from public.staff s where s.id = target_staff_id for update;
  if not found then
    raise exception 'staff % not found', target_staff_id using errcode = 'P0002';
  end if;

  delete from public.staff_permissions sp
  where sp.staff_id = target_staff_id and sp.permission = revoke_permission.permission
  returning sp.* into result;
  return result;
end;
$$;

-- Admin or manage_staff. Nobody deactivates themselves (lockout), only admins
-- change an admin's state, and the last active admin cannot be deactivated
-- (trigger above).
create function public.set_staff_active(target_staff_id uuid, active boolean)
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
  if target.role = 'admin' and not caller_is_admin then
    raise exception 'only an admin can change an admin''s status' using errcode = '42501';
  end if;

  update public.staff s
  set active = set_staff_active.active
  where s.id = target_staff_id
  returning s.* into target;
  return target;
end;
$$;

revoke all on function
  public.my_staff_profile(),
  public.staff_directory(),
  public.grant_permission(uuid, public.permission_key),
  public.revoke_permission(uuid, public.permission_key),
  public.set_staff_active(uuid, boolean)
from public, anon, authenticated, service_role;

grant execute on function
  public.my_staff_profile(),
  public.staff_directory(),
  public.grant_permission(uuid, public.permission_key),
  public.revoke_permission(uuid, public.permission_key),
  public.set_staff_active(uuid, boolean)
to authenticated;
