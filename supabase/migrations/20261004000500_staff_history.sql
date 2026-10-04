-- Staff history and the staff write rules (SPEC §2 "History over overwrites",
-- "Security is enforced in the data/service layer"; §4.2; §22 "Destructive
-- actions require reason and create audit/reversal records"; DATA-MODEL.md
-- §1, §15, §16).
--
-- Rules encoded here:
--   * Every change to a staff row or a permission row appends a
--     staff_events row: created, details_changed, role_changed, deactivated,
--     reactivated, permission_granted, permission_revoked. Triggers write
--     them, so no path (RPC, seed, the first-admin SQL in RUNBOOK) can skip
--     history. staff_events is append-only.
--   * The actor is the signed-in staff member (null for SQL run outside the
--     app, e.g. seed or the first-admin bootstrap). A grant's actor is its
--     granted_by. The reason comes from the RPC; the correlation ID from the
--     request (private.current_correlation_id()).
--   * Staff rows change only through RPCs: authenticated loses its direct
--     INSERT/UPDATE grants, so "nobody deactivates themselves", "only an
--     admin changes an admin" and "deactivation needs a reason" cannot be
--     bypassed with a plain UPDATE. A BEFORE trigger additionally enforces,
--     for every writer, that staff.email is the Auth login's email and that
--     a signed-in user never deactivates their own staff row.
--   * Delegation ceiling (PLAN D11): a manage_staff holder who is not an
--     admin may grant or revoke only permissions they hold themselves, never
--     manage_staff, never on their own row and never on an admin's row.
--     Admins are unrestricted.

-- ---------------------------------------------------------------------------
-- Correlation: RPCs called through PostgREST read the request's correlation
-- ID from the `x-correlation-id` header the server's Supabase client sends
-- (src/lib/supabase/server.ts). set_correlation_id() still wins when an RPC
-- sets it explicitly. Malformed values are ignored, never stored.
-- ---------------------------------------------------------------------------
create or replace function private.current_correlation_id()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(pg_catalog.current_setting('app.correlation_id', true), ''),
    (
      select h.value
      from (
        select (nullif(pg_catalog.current_setting('request.headers', true), '')::json
                 ->> 'x-correlation-id') as value
      ) h
      where h.value ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
    )
  );
$$;
revoke all on function private.current_correlation_id() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- staff_events
-- ---------------------------------------------------------------------------
create type public.staff_event_type as enum (
  'created',
  'details_changed',
  'role_changed',
  'deactivated',
  'reactivated',
  'permission_granted',
  'permission_revoked'
);

create table public.staff_events (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff (id) on delete restrict,
  event_type public.staff_event_type not null,
  -- Set for permission_granted / permission_revoked only.
  permission public.permission_key null,
  -- Null when the change was made outside the app (seed, SQL editor).
  actor_staff_id uuid null references public.staff (id) on delete restrict,
  -- What changed: {"role": {"from": "staff", "to": "admin"}}, the revoked
  -- grant's granted_by/granted_at, the created row's fields.
  payload jsonb not null default '{}'::jsonb,
  reason text null,
  correlation_id text null,
  -- clock_timestamp(), not now(): several events in one transaction keep
  -- their order.
  created_at timestamptz not null default clock_timestamp(),
  constraint staff_events_permission_matches_type check (
    (event_type in ('permission_granted', 'permission_revoked')) = (permission is not null)
  ),
  constraint staff_events_reason_check check (
    reason is null or (pg_catalog.btrim(reason) <> '' and pg_catalog.char_length(reason) <= 500)
  )
);
create index staff_events_staff_id_created_at_idx on public.staff_events (staff_id, created_at desc);
create index staff_events_actor_staff_id_idx on public.staff_events (actor_staff_id);
comment on table public.staff_events is
  'Append-only history of staff and permission changes: who changed what, when, why. Written by triggers.';

-- Append-only, for every role including the owner.
create function private.staff_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'staff_history_append_only',
    detail = 'Staff history cannot be changed or deleted.';
end;
$$;

create trigger staff_events_append_only
  before update or delete on public.staff_events
  for each row execute function private.staff_events_append_only();

alter table public.staff_events enable row level security;
revoke all on table public.staff_events from public, anon, authenticated, service_role;
-- Read through staff_history() (admin or manage_staff), which adds names.
-- RLS is still on, with no policy, so a future grant cannot expose it by
-- accident.

-- ---------------------------------------------------------------------------
-- Writing events
-- ---------------------------------------------------------------------------

-- RPCs pass their reason to the history triggers through this
-- transaction-local setting, and clear it straight after the write.
create function private.set_staff_event_reason(reason text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  cleaned text := nullif(pg_catalog.btrim(coalesce(reason, '')), '');
begin
  if cleaned is not null and pg_catalog.char_length(cleaned) > 500 then
    raise exception using
      errcode = 'P0001',
      message = 'reason_too_long',
      detail = 'Keep the reason under 500 characters.';
  end if;
  perform pg_catalog.set_config('app.staff_event_reason', coalesce(cleaned, ''), true);
end;
$$;

create function private.record_staff_event(
  staff_id uuid,
  event_type public.staff_event_type,
  permission public.permission_key,
  actor_staff_id uuid,
  payload jsonb
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.staff_events
    (staff_id, event_type, permission, actor_staff_id, payload, reason, correlation_id)
  values (
    record_staff_event.staff_id,
    record_staff_event.event_type,
    record_staff_event.permission,
    record_staff_event.actor_staff_id,
    coalesce(record_staff_event.payload, '{}'::jsonb),
    nullif(pg_catalog.current_setting('app.staff_event_reason', true), ''),
    private.current_correlation_id()
  );
$$;

create function private.staff_record_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_staff_id();
  details jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    perform private.record_staff_event(
      new.id, 'created', null, actor,
      pg_catalog.jsonb_build_object(
        'display_name', new.display_name,
        'email', new.email::text,
        'role', new.role,
        'active', new.active
      )
    );
    return null;
  end if;

  if new.role is distinct from old.role then
    perform private.record_staff_event(
      new.id, 'role_changed', null, actor,
      pg_catalog.jsonb_build_object('role', pg_catalog.jsonb_build_object('from', old.role, 'to', new.role))
    );
  end if;
  if new.active is distinct from old.active then
    perform private.record_staff_event(
      new.id, case when new.active then 'reactivated' else 'deactivated' end::public.staff_event_type,
      null, actor, '{}'::jsonb
    );
  end if;
  if new.display_name is distinct from old.display_name then
    details := details || pg_catalog.jsonb_build_object(
      'display_name', pg_catalog.jsonb_build_object('from', old.display_name, 'to', new.display_name));
  end if;
  if new.email is distinct from old.email then
    details := details || pg_catalog.jsonb_build_object(
      'email', pg_catalog.jsonb_build_object('from', old.email::text, 'to', new.email::text));
  end if;
  if details <> '{}'::jsonb then
    perform private.record_staff_event(new.id, 'details_changed', null, actor, details);
  end if;
  return null;
end;
$$;

create trigger staff_record_history
  after insert or update on public.staff
  for each row execute function private.staff_record_history();

create function private.staff_permissions_record_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.record_staff_event(
      new.staff_id, 'permission_granted', new.permission,
      coalesce(new.granted_by, private.current_staff_id()), '{}'::jsonb
    );
  elsif tg_op = 'DELETE' then
    -- The row is gone; its grant history moves into the event.
    perform private.record_staff_event(
      old.staff_id, 'permission_revoked', old.permission, private.current_staff_id(),
      pg_catalog.jsonb_build_object('granted_by', old.granted_by, 'granted_at', old.granted_at)
    );
  else
    if new.staff_id is distinct from old.staff_id or new.permission is distinct from old.permission then
      raise exception using
        errcode = 'P0001',
        message = 'staff_permission_immutable',
        detail = 'Revoke the permission and grant the new one instead of editing the row.';
    end if;
  end if;
  return null;
end;
$$;

create trigger staff_permissions_record_history
  after insert or update or delete on public.staff_permissions
  for each row execute function private.staff_permissions_record_history();

-- ---------------------------------------------------------------------------
-- Rules every writer obeys, including the service role and SQL run by hand.
-- ---------------------------------------------------------------------------
create function private.staff_enforce_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  login_email text;
begin
  if tg_op = 'INSERT'
     or new.email is distinct from old.email
     or new.auth_user_id is distinct from old.auth_user_id then
    select u.email::text into login_email from auth.users u where u.id = new.auth_user_id;
    if login_email is null or pg_catalog.lower(login_email) <> pg_catalog.lower(new.email::text) then
      raise exception using
        errcode = 'P0001',
        message = 'staff_email_mismatch',
        detail = 'The staff email must be the email of the Auth login it is linked to.';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.active and not new.active
     and auth.uid() is not null and old.auth_user_id = auth.uid() then
    raise exception 'staff cannot deactivate themselves' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger staff_enforce_rules
  before insert or update on public.staff
  for each row execute function private.staff_enforce_rules();

-- ---------------------------------------------------------------------------
-- Direct writes: none for API roles. Every staff and permission change goes
-- through the RPCs below (DATA-MODEL §15).
-- ---------------------------------------------------------------------------
drop policy staff_insert_admin on public.staff;
drop policy staff_update_admin on public.staff;
revoke insert, update, delete on table public.staff from authenticated, service_role;
revoke insert, update, delete on table public.staff_permissions from authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Authorization for permission changes (delegation ceiling, PLAN D11).
-- Locks the target row. Returns the actor's staff id.
-- ---------------------------------------------------------------------------
create function private.authorize_permission_change(
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
  if target.role = 'admin' then
    raise exception 'only an admin changes an admin''s permissions' using errcode = '42501';
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

-- ---------------------------------------------------------------------------
-- RPCs (replacing the Phase 0 versions; same names and results).
-- ---------------------------------------------------------------------------

-- Admin, or manage_staff within the delegation ceiling. Idempotent: granting
-- an existing permission returns the existing row unchanged and records no
-- event.
create or replace function public.grant_permission(target_staff_id uuid, permission public.permission_key)
returns public.staff_permissions
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.authorize_permission_change(target_staff_id, grant_permission.permission);
  result public.staff_permissions;
begin
  insert into public.staff_permissions as sp (staff_id, permission, granted_by)
  values (target_staff_id, grant_permission.permission, actor)
  on conflict on constraint staff_permissions_pkey do nothing;

  select sp.* into result
  from public.staff_permissions sp
  where sp.staff_id = target_staff_id and sp.permission = grant_permission.permission;
  return result;
end;
$$;

-- Admin, or manage_staff within the delegation ceiling. Returns the removed
-- row, or null when there was nothing to revoke (replay-safe, no event).
-- The removed row's granted_by/granted_at are kept in the
-- permission_revoked event.
create or replace function public.revoke_permission(target_staff_id uuid, permission public.permission_key)
returns public.staff_permissions
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result public.staff_permissions;
begin
  perform private.authorize_permission_change(target_staff_id, revoke_permission.permission);

  delete from public.staff_permissions sp
  where sp.staff_id = target_staff_id and sp.permission = revoke_permission.permission
  returning sp.* into result;
  return result;
end;
$$;

-- Admin or manage_staff. Deactivating needs a reason (P0001
-- reason_required); reactivating takes an optional one. Nobody deactivates
-- themselves, only admins change an admin's state, and the last active
-- admin cannot be deactivated (trigger). Replaying the current state is a
-- no-op and records no event.
drop function public.set_staff_active(uuid, boolean);
create function public.set_staff_active(target_staff_id uuid, active boolean, reason text default null)
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

-- Admin or manage_staff: rename, or (admin only) change role. Null leaves a
-- field as it is. Only admins rename admins; nobody changes their own role;
-- the last active admin cannot be demoted (trigger). Email is not editable
-- here: it must stay the Auth login's email (staff_enforce_rules).
create function public.update_staff(
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
  if update_staff.display_name is not null and target.role = 'admin' and not caller_is_admin then
    raise exception 'only an admin can rename an admin' using errcode = '42501';
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

-- Admin or manage_staff: one staff member's history, newest first, with the
-- actor's name (manage_staff holders cannot read other staff rows).
create function public.staff_history(target_staff_id uuid, max_rows integer default 100)
returns table (
  id uuid,
  event_type public.staff_event_type,
  permission public.permission_key,
  actor_staff_id uuid,
  actor_display_name text,
  payload jsonb,
  reason text,
  correlation_id text,
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
    select e.id, e.event_type, e.permission, e.actor_staff_id, a.display_name,
           e.payload, e.reason, e.correlation_id, e.created_at
    from public.staff_events e
    left join public.staff a on a.id = e.actor_staff_id
    where e.staff_id = target_staff_id
    order by e.created_at desc, e.id
    limit greatest(1, least(coalesce(max_rows, 100), 500));
end;
$$;

comment on function public.staff_history(uuid, integer) is
  'Admin or manage_staff: a staff member''s history (staff_events), newest first, with actor names.';

revoke all on function
  private.staff_events_append_only(),
  private.set_staff_event_reason(text),
  private.record_staff_event(uuid, public.staff_event_type, public.permission_key, uuid, jsonb),
  private.staff_record_history(),
  private.staff_permissions_record_history(),
  private.staff_enforce_rules(),
  private.authorize_permission_change(uuid, public.permission_key)
from public, anon, authenticated, service_role;

revoke all on function
  public.grant_permission(uuid, public.permission_key),
  public.revoke_permission(uuid, public.permission_key),
  public.set_staff_active(uuid, boolean, text),
  public.update_staff(uuid, text, public.staff_role, text),
  public.staff_history(uuid, integer)
from public, anon, authenticated, service_role;

grant execute on function
  public.grant_permission(uuid, public.permission_key),
  public.revoke_permission(uuid, public.permission_key),
  public.set_staff_active(uuid, boolean, text),
  public.update_staff(uuid, text, public.staff_role, text),
  public.staff_history(uuid, integer)
to authenticated;
