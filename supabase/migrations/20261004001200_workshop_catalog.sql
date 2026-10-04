-- Workshop catalog: categories, services and the Cult Commons rate
-- (SPEC §9, §10, §4.2 "financial visibility permission-controlled", §23
-- "Historical line price/cost/yield snapshots do not change with catalog
-- edits"; DATA-MODEL.md §5, §15, §16; PLAN D14, D21).
--
-- Rules encoded here:
--   * Categories group services (and, from Phase 4, products). Holders of
--     manage_inventory (admins included) create and rename them; every
--     active staff member reads them. Archived, never deleted.
--   * Services carry a default sale price and a default direct cost. The
--     cost is staff-only financial data: authenticated has no column grant
--     on services.default_direct_cost, so `select *` fails for everyone and
--     the cost is read through services_staff, which returns rows only to
--     holders of view_costs (admins included). Services are written only
--     through create_service / update_service / set_service_archived
--     (manage_inventory); entering a cost also needs view_costs (D14).
--     Lines snapshot the service's values when they are added, so editing
--     or archiving a service never changes a historical job.
--   * Cult Commons is 30% of positive yield (SPEC §10). The rate is
--     effective-dated in cult_commons_rates: admin only, effective now or
--     later, never backdated; rows are append-only, except that an admin may
--     cancel a rate that has not started yet (D21). Each line snapshots
--     private.cult_commons_rate_at(clock_timestamp()) when it is added. The
--     base row (0.3000 from 1970-01-01) ships here because production needs
--     it too; it is not demo data.
--   * Customer access boundary: base tables are staff-only. The anonymous
--     and customer services listing arrives with Phase 11 through a separate
--     customer-safe projection.

create type public.category_kind as enum ('service', 'product');

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  kind public.category_kind not null,
  name text not null,
  -- Unused by the MVP screens (flat lists); kept for later grouping.
  parent_id uuid null references public.categories (id) on delete restrict,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  constraint categories_name_check check (
    pg_catalog.btrim(name) <> '' and pg_catalog.char_length(name) <= 80
  )
);
create unique index categories_active_name_key
  on public.categories (kind, pg_catalog.lower(name)) where archived_at is null;
create index categories_parent_id_idx on public.categories (parent_id);

comment on table public.categories is
  'Groups of services (and, from Phase 4, products). Archived, never deleted.';

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function private.set_updated_at();

create function private.categories_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := pg_catalog.btrim(new.name);
  return new;
end;
$$;

create trigger categories_normalize
  before insert or update on public.categories
  for each row execute function private.categories_normalize();

-- ---------------------------------------------------------------------------
-- services
-- ---------------------------------------------------------------------------
create table public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text null,
  category_id uuid null references public.categories (id) on delete restrict,
  default_sale_price public.money_amount not null,
  -- Staff-only financial data: no column grant to authenticated; read it
  -- through services_staff (view_costs).
  default_direct_cost public.money_amount not null default 0,
  currency char(3) not null default 'SGD',
  active boolean not null default true,
  -- Listed to customers and visitors (Phase 11 projection).
  public boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  constraint services_name_check check (
    pg_catalog.btrim(name) <> '' and pg_catalog.char_length(name) <= 120
  ),
  constraint services_description_check check (pg_catalog.char_length(description) <= 2000),
  constraint services_default_sale_price_check check (default_sale_price >= 0),
  constraint services_default_direct_cost_check check (default_direct_cost >= 0),
  constraint services_currency_check check (currency ~ '^[A-Z]{3}$')
);
create unique index services_active_name_key
  on public.services (pg_catalog.lower(name)) where archived_at is null;
create index services_category_id_idx on public.services (category_id);

comment on table public.services is
  'Workshop services with default sale price and direct cost. Written only by the service RPCs; cost readable via services_staff.';
comment on column public.services.default_direct_cost is
  'Staff-only (view_costs): not granted to authenticated; read through services_staff.';

create trigger services_set_updated_at
  before update on public.services
  for each row execute function private.set_updated_at();

create function private.services_enforce_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.name := pg_catalog.btrim(new.name);
  new.description := nullif(pg_catalog.btrim(new.description), '');
  if new.category_id is not null
     and (tg_op = 'INSERT' or new.category_id is distinct from old.category_id)
     and exists (
       select 1 from public.categories c
       where c.id = new.category_id and c.kind <> 'service'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'category_kind_mismatch',
      detail = 'A service can only be filed under a service category.';
  end if;
  return new;
end;
$$;

create trigger services_enforce_rules
  before insert or update on public.services
  for each row execute function private.services_enforce_rules();

-- Every column, cost included, for holders of view_costs (admins included);
-- no rows for anyone else. Runs as its owner (a definer view) so it can read
-- the cost column authenticated has no grant on; the WHERE clause is the gate.
create view public.services_staff
with (security_barrier)
as
  select s.id, s.name, s.description, s.category_id, s.default_sale_price,
         s.default_direct_cost, s.currency, s.active, s.public, s.sort_order,
         s.created_at, s.updated_at, s.archived_at
  from public.services s
  where (select private.has_permission('view_costs'));

comment on view public.services_staff is
  'Services with their default direct cost, for staff with view_costs (D14); empty for everyone else.';

-- ---------------------------------------------------------------------------
-- Cult Commons rates (SPEC §10; PLAN D21)
-- ---------------------------------------------------------------------------
create table public.cult_commons_rates (
  id uuid primary key default gen_random_uuid(),
  rate public.rate_fraction not null,
  effective_from timestamptz not null,
  -- Null for the base row and for rows created outside the app.
  created_by uuid null references public.staff (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  -- A future rate an admin withdrew before it started (D21).
  cancelled_at timestamptz null,
  cancelled_by uuid null references public.staff (id) on delete restrict,
  constraint cult_commons_rates_rate_check check (rate >= 0 and rate <= 1),
  constraint cult_commons_rates_cancelled_shape check (cancelled_by is null or cancelled_at is not null)
);
create unique index cult_commons_rates_effective_from_key
  on public.cult_commons_rates (effective_from) where cancelled_at is null;

comment on table public.cult_commons_rates is
  'Effective-dated Cult Commons rate (share of positive yield). Append-only; a future rate may be cancelled before it starts (D21).';

-- Append-only for every writer, the owner included. The one change allowed
-- is cancelling a rate that has not started yet: cancelled_at (and
-- cancelled_by) from null to set, nothing else.
create function private.cult_commons_rates_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     or old.cancelled_at is not null
     or new.cancelled_at is null
     or old.cancelled_by is not null
     or new.id is distinct from old.id
     or new.rate is distinct from old.rate
     or new.effective_from is distinct from old.effective_from
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = 'P0001',
      message = 'cult_commons_rates_append_only',
      detail = 'Cult Commons rates cannot be changed or deleted; schedule a new rate instead.';
  end if;
  if old.effective_from <= pg_catalog.clock_timestamp() then
    raise exception using
      errcode = 'P0001',
      message = 'cult_commons_rate_in_effect',
      detail = 'That rate has already started, so jobs may use it; schedule a new rate instead.';
  end if;
  return new;
end;
$$;

create trigger cult_commons_rates_append_only
  before update or delete on public.cult_commons_rates
  for each row execute function private.cult_commons_rates_append_only();

-- The base rate (SPEC §10: 30% of yield). In the migration, not the seed:
-- production needs it.
insert into public.cult_commons_rates (id, rate, effective_from, created_by)
values ('cc000000-0000-4000-8000-000000000001', 0.3000, '1970-01-01 00:00:00+00', null);

-- The rate in force at `at`: the non-cancelled row with the latest
-- effective_from <= at. Lines snapshot it when they are added.
create function private.cult_commons_rate_at("at" timestamptz)
returns public.rate_fraction
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result public.rate_fraction;
begin
  select r.rate into result
  from public.cult_commons_rates r
  where r.cancelled_at is null and r.effective_from <= cult_commons_rate_at."at"
  order by r.effective_from desc
  limit 1;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'cult_commons_rate_missing',
      detail = 'No Cult Commons rate is in force at that time; an admin must set one.';
  end if;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Service RPCs (manage_inventory; a cost also needs view_costs, D14). They
-- return the id only: a services row carries the cost, and an RPC result is
-- not column-gated.
-- ---------------------------------------------------------------------------
create function public.create_service(
  service_id uuid,
  name text,
  default_sale_price public.money_amount,
  description text default null,
  category_id uuid default null,
  default_direct_cost public.money_amount default null,
  is_active boolean default true,
  is_public boolean default false
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  existing public.services;
  inserted uuid;
begin
  perform private.require_permission('manage_inventory');
  if create_service.default_direct_cost is not null and not private.has_permission('view_costs') then
    raise exception 'permission view_costs required to set a cost' using errcode = '42501';
  end if;
  if create_service.service_id is null or create_service.name is null
     or create_service.default_sale_price is null
     or create_service.is_active is null or create_service.is_public is null then
    raise exception 'service_id, name, default_sale_price, is_active and is_public are required'
      using errcode = '22004';
  end if;

  -- Replay: the same id with the same name returns it unchanged.
  select s.* into existing from public.services s where s.id = create_service.service_id;
  if found then
    if existing.name = pg_catalog.btrim(create_service.name) then
      return existing.id;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'service_conflict',
      detail = 'That service id is already used for another service.';
  end if;

  insert into public.services as s (
    id, name, description, category_id, default_sale_price, default_direct_cost, active, public
  )
  values (
    create_service.service_id, create_service.name, create_service.description,
    create_service.category_id, create_service.default_sale_price,
    coalesce(create_service.default_direct_cost, 0), create_service.is_active, create_service.is_public
  )
  on conflict (id) do nothing
  returning s.id into inserted;

  if inserted is null then
    -- A concurrent call with the same id won the insert.
    select s.* into existing from public.services s where s.id = create_service.service_id;
    if existing.name is distinct from pg_catalog.btrim(create_service.name) then
      raise exception using
        errcode = 'P0001',
        message = 'service_conflict',
        detail = 'That service id is already used for another service.';
    end if;
    return existing.id;
  end if;
  return inserted;
end;
$$;

comment on function public.create_service(
  uuid, text, public.money_amount, text, uuid, public.money_amount, boolean, boolean
) is 'manage_inventory: create a service (a cost needs view_costs); replay-safe by id; returns the id.';

-- Full replacement of every field except default_direct_cost, where null
-- keeps the current cost and a value needs view_costs.
create function public.update_service(
  service_id uuid,
  name text,
  default_sale_price public.money_amount,
  description text default null,
  category_id uuid default null,
  is_active boolean default true,
  is_public boolean default false,
  default_direct_cost public.money_amount default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target public.services;
begin
  perform private.require_permission('manage_inventory');
  if update_service.default_direct_cost is not null and not private.has_permission('view_costs') then
    raise exception 'permission view_costs required to set a cost' using errcode = '42501';
  end if;
  if update_service.service_id is null or update_service.name is null
     or update_service.default_sale_price is null
     or update_service.is_active is null or update_service.is_public is null then
    raise exception 'service_id, name, default_sale_price, is_active and is_public are required'
      using errcode = '22004';
  end if;

  select s.* into target from public.services s where s.id = update_service.service_id for update;
  if not found then
    raise exception 'service % not found', update_service.service_id using errcode = 'P0002';
  end if;

  update public.services s
  set name = update_service.name,
      description = update_service.description,
      category_id = update_service.category_id,
      default_sale_price = update_service.default_sale_price,
      default_direct_cost = coalesce(update_service.default_direct_cost, s.default_direct_cost),
      active = update_service.is_active,
      public = update_service.is_public
  where s.id = target.id;
  return target.id;
end;
$$;

comment on function public.update_service(
  uuid, text, public.money_amount, text, uuid, boolean, boolean, public.money_amount
) is 'manage_inventory: replace a service''s fields; a new cost needs view_costs (null keeps it); returns the id.';

create function public.set_service_archived(service_id uuid, archived boolean)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target public.services;
begin
  perform private.require_permission('manage_inventory');
  if set_service_archived.service_id is null or set_service_archived.archived is null then
    raise exception 'service_id and archived are required' using errcode = '22004';
  end if;
  select s.* into target from public.services s where s.id = set_service_archived.service_id for update;
  if not found then
    raise exception 'service % not found', set_service_archived.service_id using errcode = 'P0002';
  end if;
  if (target.archived_at is not null) = set_service_archived.archived then
    return target.id;
  end if;
  update public.services s
  set archived_at = case when set_service_archived.archived then pg_catalog.clock_timestamp() end
  where s.id = target.id;
  return target.id;
end;
$$;

comment on function public.set_service_archived(uuid, boolean) is
  'manage_inventory: archive or unarchive a service (hidden from pickers; historical lines keep it); replay-safe.';

-- ---------------------------------------------------------------------------
-- Cult Commons rate RPCs (admin only; D21)
-- ---------------------------------------------------------------------------
create function public.schedule_cult_commons_rate(
  rate public.rate_fraction,
  effective_from timestamptz default null
)
returns public.cult_commons_rates
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_staff_id();
  result public.cult_commons_rates;
begin
  if not private.is_admin() then
    raise exception 'admin required' using errcode = '42501';
  end if;
  if schedule_cult_commons_rate.rate is null then
    raise exception 'rate is required' using errcode = '22004';
  end if;
  if schedule_cult_commons_rate.effective_from is not null
     and schedule_cult_commons_rate.effective_from < now() then
    raise exception using
      errcode = 'P0001',
      message = 'rate_backdated',
      detail = 'A new Cult Commons rate can start now or later, never in the past.';
  end if;

  insert into public.cult_commons_rates as r (rate, effective_from, created_by)
  values (
    schedule_cult_commons_rate.rate,
    coalesce(schedule_cult_commons_rate.effective_from, pg_catalog.clock_timestamp()),
    actor
  )
  returning r.* into result;
  return result;
end;
$$;

comment on function public.schedule_cult_commons_rate(public.rate_fraction, timestamptz) is
  'Admin: add a Cult Commons rate effective now (null) or later; never backdated (D21).';

create function public.cancel_cult_commons_rate(rate_id uuid)
returns public.cult_commons_rates
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_staff_id();
  target public.cult_commons_rates;
  result public.cult_commons_rates;
begin
  if not private.is_admin() then
    raise exception 'admin required' using errcode = '42501';
  end if;
  if cancel_cult_commons_rate.rate_id is null then
    raise exception 'rate_id is required' using errcode = '22004';
  end if;
  select r.* into target from public.cult_commons_rates r where r.id = cancel_cult_commons_rate.rate_id for update;
  if not found then
    raise exception 'Cult Commons rate % not found', cancel_cult_commons_rate.rate_id using errcode = 'P0002';
  end if;
  if target.cancelled_at is not null then
    return target;
  end if;
  if target.effective_from <= pg_catalog.clock_timestamp() then
    raise exception using
      errcode = 'P0001',
      message = 'cult_commons_rate_in_effect',
      detail = 'That rate has already started, so jobs may use it; schedule a new rate instead.';
  end if;

  -- Safe: no line can have snapshotted a rate that has not started.
  update public.cult_commons_rates r
  set cancelled_at = pg_catalog.clock_timestamp(), cancelled_by = actor
  where r.id = target.id
  returning r.* into result;
  return result;
end;
$$;

comment on function public.cancel_cult_commons_rate(uuid) is
  'Admin: withdraw a Cult Commons rate that has not started yet (D21); replay returns the cancelled row.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function
  private.categories_normalize(),
  private.services_enforce_rules(),
  private.cult_commons_rates_append_only(),
  private.cult_commons_rate_at(timestamptz)
from public, anon, authenticated, service_role;

revoke all on function
  public.create_service(uuid, text, public.money_amount, text, uuid, public.money_amount, boolean, boolean),
  public.update_service(uuid, text, public.money_amount, text, uuid, boolean, boolean, public.money_amount),
  public.set_service_archived(uuid, boolean),
  public.schedule_cult_commons_rate(public.rate_fraction, timestamptz),
  public.cancel_cult_commons_rate(uuid)
from public, anon, authenticated, service_role;

grant execute on function
  public.create_service(uuid, text, public.money_amount, text, uuid, public.money_amount, boolean, boolean),
  public.update_service(uuid, text, public.money_amount, text, uuid, boolean, boolean, public.money_amount),
  public.set_service_archived(uuid, boolean),
  public.schedule_cult_commons_rate(public.rate_fraction, timestamptz),
  public.cancel_cult_commons_rate(uuid)
to authenticated;

alter table public.categories enable row level security;
alter table public.services enable row level security;
alter table public.cult_commons_rates enable row level security;

revoke all on table public.categories from public, anon, authenticated, service_role;
revoke all on table public.services from public, anon, authenticated, service_role;
revoke all on table public.cult_commons_rates from public, anon, authenticated, service_role;
revoke all on table public.services_staff from public, anon, authenticated, service_role;

grant select on table public.categories to authenticated;
grant insert (id, kind, name, parent_id, sort_order) on table public.categories to authenticated;
grant update (name, parent_id, sort_order, archived_at) on table public.categories to authenticated;
grant select on table public.categories to service_role;

-- Every column except default_direct_cost (SPEC §4.2 cost gating).
grant select (
  id, name, description, category_id, default_sale_price, currency, active, public, sort_order,
  created_at, updated_at, archived_at
) on table public.services to authenticated;
grant select on table public.services to service_role;

grant select on table public.services_staff to authenticated;

grant select on table public.cult_commons_rates to authenticated;
grant select on table public.cult_commons_rates to service_role;

create policy categories_select_staff on public.categories
  for select to authenticated
  using ((select private.is_staff()));

create policy categories_insert_manage_inventory on public.categories
  for insert to authenticated
  with check ((select private.has_permission('manage_inventory')));

create policy categories_update_manage_inventory on public.categories
  for update to authenticated
  using ((select private.has_permission('manage_inventory')))
  with check ((select private.has_permission('manage_inventory')));

create policy services_select_staff on public.services
  for select to authenticated
  using ((select private.is_staff()));

create policy cult_commons_rates_select_view_costs on public.cult_commons_rates
  for select to authenticated
  using ((select private.has_permission('view_costs')));
