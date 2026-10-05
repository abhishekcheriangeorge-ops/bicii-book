-- Shop schedule configuration: settings, opening hours, closures and
-- appointment types, with their history (SPEC §6 "shop_hours",
-- "closure_overrides", "appointment_types", §21 "shop-hours settings", §22
-- "Destructive actions require reason", §24; DATA-MODEL.md §3, §15, §16;
-- PLAN D2, D9, D35, D37, D38).
--
-- Rules encoded here:
--   * public.shop_settings is a single row (id = 1) that always exists: the
--     migration inserts it and nobody deletes it (shop_settings_required).
--     The time zone is fixed at Asia/Singapore in the MVP (D35; SPEC §24)
--     and no RPC edits it or the currency; an owner write of an unknown
--     time zone is refused (shop_timezone_invalid).
--     public_site_url is informational until Phase 8 decides whether it or
--     NEXT_PUBLIC_PUBLIC_SITE_URL is the QR base (D9 note); until then the
--     env var is.
--   * D35: private.shop_timezone() and private.shop_currency() now read
--     shop_settings (same signatures, same fallbacks). Every shop-day
--     computation still goes through private.shop_day() / shop_today() /
--     shop_day_start(); local wall-clock instants are
--     `(day + t) at time zone private.shop_timezone()`.
--   * Weekly hours: any number of non-overlapping intervals per weekday
--     (0 = Sunday, as extract(dow)), closes_at up to 24:00. An inactive row
--     is closed.
--   * Closures (D38): a `closed` override blocks every appointment that
--     overlaps [starts_at, ends_at) (whole days or part of one day) and
--     beats custom hours; a `custom_hours` override covers whole shop-local
--     days and REPLACES all weekly intervals on each of them with
--     opens_at..closes_at. Custom-hours overrides never overlap each other.
--   * Appointment types are never deleted (deactivate). The future columns
--     DATA-MODEL §3 lists (required_skill and mechanic availability) are
--     not created now.
--   * D2: one intake_capacity_units pool per intake_slot_minutes window;
--     private.capacity_for_window() is the single place capacity is read,
--     the extension point for mechanic hours, leave and skills.
--   * Settings changes (hours, closures, slot length, capacity, type
--     duration and units) never move, shrink or cancel existing
--     appointments: appointments snapshot ends_at and capacity_units (D38).
--   * Writes go through the admin RPCs below; each takes the shop_settings
--     row FOR UPDATE first, which serialises schedule configuration changes
--     against each other and against bookings (which hold it FOR SHARE;
--     lock order in the appointments migration).
--   * Every change appends to public.schedule_events (triggers, every
--     writer): the row on create and delete, the changed columns on update;
--     an update that changes nothing appends nothing. Append-only.
--   * Reads: every active staff member reads the five tables (RLS);
--     anonymous visitors and customers read only through
--     public_appointment_types() and public_shop_hours() (and the slots
--     RPC in the appointments migration).

create type public.closure_kind as enum ('closed', 'custom_hours');
create type public.schedule_entity as enum ('shop_settings', 'shop_hours', 'closure_override', 'appointment_type');
create type public.schedule_event_type as enum ('created', 'updated', 'deleted');

-- ---------------------------------------------------------------------------
-- Guard: admins only (the schedule settings RPCs).
-- ---------------------------------------------------------------------------
create function private.require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  return private.current_staff_id();
end;
$$;

-- ---------------------------------------------------------------------------
-- shop_settings (single row)
-- ---------------------------------------------------------------------------
create table public.shop_settings (
  id smallint primary key default 1,
  -- Fixed in the MVP (D35): no RPC changes it.
  timezone text not null default 'Asia/Singapore',
  default_currency text not null default 'SGD',
  intake_slot_minutes integer not null default 30,
  intake_capacity_units integer not null default 2,
  booking_min_notice_minutes integer not null default 120,
  booking_horizon_days integer not null default 60,
  customer_max_active_bookings integer not null default 3,
  customer_cancel_cutoff_minutes integer not null default 120,
  -- Informational until Phase 8 (D9 note).
  public_site_url text null,
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.staff (id) on delete restrict,
  constraint shop_settings_singleton check (id = 1),
  constraint shop_settings_currency_check check (default_currency ~ '^[A-Z]{3}$'),
  constraint shop_settings_slot_minutes_check check (
    intake_slot_minutes between 5 and 240 and 1440 % intake_slot_minutes = 0
  ),
  constraint shop_settings_capacity_check check (intake_capacity_units between 1 and 50),
  constraint shop_settings_notice_check check (booking_min_notice_minutes between 0 and 10080),
  constraint shop_settings_horizon_check check (booking_horizon_days between 1 and 365),
  constraint shop_settings_customer_limit_check check (customer_max_active_bookings between 1 and 20),
  constraint shop_settings_cancel_cutoff_check check (customer_cancel_cutoff_minutes between 0 and 10080),
  constraint shop_settings_public_site_url_check check (
    public_site_url ~ '^https?://[^[:space:]]+$' and pg_catalog.char_length(public_site_url) <= 200
  )
);
create index shop_settings_updated_by_idx on public.shop_settings (updated_by);

comment on table public.shop_settings is
  'The shop''s schedule settings: one row (id = 1), always present. Written by update_shop_settings (admin).';
comment on column public.shop_settings.timezone is
  'Fixed at Asia/Singapore in the MVP (D35); read through private.shop_timezone(), never directly.';
comment on column public.shop_settings.intake_slot_minutes is
  'Length of one capacity window; windows are aligned to shop-local midnight (D38).';
comment on column public.shop_settings.intake_capacity_units is
  'Units each window can take across the shop (D2); read only through private.capacity_for_window().';
comment on column public.shop_settings.public_site_url is
  'The public site''s base URL. Informational until Phase 8 decides the QR base (D9 note); NEXT_PUBLIC_PUBLIC_SITE_URL is the QR base until then.';

create function private.shop_settings_enforce_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.timezone := pg_catalog.btrim(new.timezone);
  begin
    perform pg_catalog.now() at time zone new.timezone;
  exception when others then
    raise exception using
      errcode = 'P0001',
      message = 'shop_timezone_invalid',
      detail = 'That is not a time zone Postgres knows (an IANA name such as Asia/Singapore).';
  end;
  new.public_site_url := nullif(pg_catalog.btrim(new.public_site_url), '');
  new.updated_by := coalesce(private.current_staff_id(), new.updated_by);
  return new;
end;
$$;

create trigger shop_settings_enforce_rules
  before insert or update on public.shop_settings
  for each row execute function private.shop_settings_enforce_rules();

create trigger shop_settings_set_updated_at
  before update on public.shop_settings
  for each row execute function private.set_updated_at();

create function private.shop_settings_keep_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'shop_settings_required',
    detail = 'The shop settings row cannot be deleted; change its values instead.';
end;
$$;

create trigger shop_settings_keep_row
  before delete on public.shop_settings
  for each row execute function private.shop_settings_keep_row();

-- ---------------------------------------------------------------------------
-- D35: the calendar helpers now read the settings row (same signatures,
-- language, volatility and grants as Phase 5; not security definer: only
-- definer RPCs and owner-run views call them).
-- ---------------------------------------------------------------------------
create or replace function private.shop_timezone()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce((select s.timezone from public.shop_settings s where s.id = 1), 'Asia/Singapore');
$$;

comment on function private.shop_timezone() is
  'D35 SHOP-TZ: the shop time zone, from shop_settings.timezone (fixed at Asia/Singapore in the MVP; that is also the fallback).';

create or replace function private.shop_currency()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce((select s.default_currency from public.shop_settings s where s.id = 1), 'SGD');
$$;

comment on function private.shop_currency() is
  'D35 SHOP-TZ: the shop currency (report totals sum this currency only), from shop_settings.default_currency; fallback SGD.';

revoke all on function private.shop_timezone(), private.shop_currency()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- shop_hours (weekly)
-- ---------------------------------------------------------------------------
create table public.shop_hours (
  id uuid primary key default gen_random_uuid(),
  -- 0 = Sunday .. 6 = Saturday, as extract(dow).
  weekday smallint not null check (weekday between 0 and 6),
  opens_at time not null,
  closes_at time not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shop_hours_interval_check check (opens_at < closes_at and closes_at <= time '24:00'),
  constraint shop_hours_weekday_opens_at_key unique (weekday, opens_at)
);

comment on table public.shop_hours is
  'Weekly opening intervals (several per weekday allowed, never overlapping). Inactive rows are closed. Replaced per weekday by set_shop_hours (admin).';

create trigger shop_hours_set_updated_at
  before update on public.shop_hours
  for each row execute function private.set_updated_at();

create function private.shop_hours_enforce_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.shop_hours h
    where h.weekday = new.weekday
      and h.id <> new.id
      and h.opens_at < new.closes_at
      and new.opens_at < h.closes_at
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'shop_hours_overlap',
      detail = 'Opening intervals of the same weekday cannot overlap.';
  end if;
  return new;
end;
$$;

create trigger shop_hours_enforce_rules
  before insert or update on public.shop_hours
  for each row execute function private.shop_hours_enforce_rules();

-- ---------------------------------------------------------------------------
-- closure_overrides
-- ---------------------------------------------------------------------------
create table public.closure_overrides (
  id uuid primary key default gen_random_uuid(),
  kind public.closure_kind not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- custom_hours only: the open hours on each covered shop-local date.
  opens_at time null,
  closes_at time null,
  reason text not null,
  created_by uuid null references public.staff (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint closure_overrides_range_check check (
    ends_at > starts_at and ends_at - starts_at <= interval '366 days'
  ),
  constraint closure_overrides_hours_shape check (
    (kind = 'custom_hours') = (opens_at is not null and closes_at is not null)
    and (opens_at is null or (opens_at < closes_at and closes_at <= time '24:00'))
  ),
  constraint closure_overrides_reason_check check (
    pg_catalog.btrim(reason) <> '' and pg_catalog.char_length(reason) <= 200
  ),
  -- Backstop for save_closure_override's closure_custom_hours_overlap (a
  -- range type has its own GiST operator class: no extension needed).
  constraint closure_overrides_custom_hours_no_overlap
    exclude using gist (tstzrange(starts_at, ends_at, '[)') with &&) where (kind = 'custom_hours')
);
create index closure_overrides_range_idx on public.closure_overrides using gist (tstzrange(starts_at, ends_at, '[)'));
create index closure_overrides_created_by_idx on public.closure_overrides (created_by);

comment on table public.closure_overrides is
  'Closures (D38): closed blocks [starts_at, ends_at) and beats custom hours; custom_hours covers whole shop-local days and replaces the weekly hours with opens_at..closes_at on each. Written by save_closure_override / delete_closure_override (admin).';

create trigger closure_overrides_set_updated_at
  before update on public.closure_overrides
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- appointment_types
-- ---------------------------------------------------------------------------
create table public.appointment_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text null,
  duration_minutes integer not null,
  capacity_units integer not null default 1,
  -- Customers may book it online (D37) when also active.
  public boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointment_types_name_check check (
    pg_catalog.btrim(name) <> '' and pg_catalog.char_length(name) <= 80
  ),
  constraint appointment_types_description_check check (pg_catalog.char_length(description) <= 500),
  constraint appointment_types_duration_check check (
    duration_minutes between 5 and 480 and duration_minutes % 5 = 0
  ),
  constraint appointment_types_capacity_check check (capacity_units between 1 and 50)
);
create unique index appointment_types_name_key on public.appointment_types (pg_catalog.lower(name));

comment on table public.appointment_types is
  'What can be booked: duration and the capacity units it takes in every window it overlaps (D2). Never deleted (deactivate). Future columns (DATA-MODEL §3: required_skill, mechanic availability) are not created yet.';

create trigger appointment_types_set_updated_at
  before update on public.appointment_types
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- schedule_events (append-only history of the four tables above)
-- ---------------------------------------------------------------------------
create table public.schedule_events (
  id bigint generated always as identity primary key,
  entity public.schedule_entity not null,
  -- Null for shop_settings (a single row).
  entity_id uuid null,
  event_type public.schedule_event_type not null,
  -- created / deleted: the row; updated: {"column": {"from", "to"}} for the
  -- changed columns only.
  payload jsonb not null default '{}'::jsonb,
  reason text null,
  actor_staff_id uuid null references public.staff (id) on delete restrict,
  actor_user_id uuid null,
  correlation_id text null,
  created_at timestamptz not null default clock_timestamp(),
  constraint schedule_events_payload_object check (pg_catalog.jsonb_typeof(payload) = 'object'),
  constraint schedule_events_reason_check check (pg_catalog.char_length(reason) <= 500)
);
create index schedule_events_entity_idx on public.schedule_events (entity, entity_id, created_at desc);
create index schedule_events_actor_staff_id_idx on public.schedule_events (actor_staff_id);

comment on table public.schedule_events is
  'Append-only history of shop settings, hours, closures and appointment types, written by triggers.';

create function private.schedule_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'schedule_history_append_only',
    detail = 'Schedule history cannot be changed or deleted.';
end;
$$;

create trigger schedule_events_append_only
  before update or delete on public.schedule_events
  for each row execute function private.schedule_events_append_only();

-- One trigger function for the four tables (AFTER INSERT/UPDATE/DELETE).
create function private.record_schedule_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  kind public.schedule_entity;
  ev public.schedule_event_type;
  body jsonb;
  row_id uuid;
begin
  kind := case tg_table_name
    when 'shop_settings' then 'shop_settings'
    when 'shop_hours' then 'shop_hours'
    when 'closure_overrides' then 'closure_override'
    when 'appointment_types' then 'appointment_type'
  end::public.schedule_entity;

  if tg_op = 'INSERT' then
    ev := 'created';
    body := pg_catalog.to_jsonb(new);
  elsif tg_op = 'DELETE' then
    ev := 'deleted';
    body := pg_catalog.to_jsonb(old);
  else
    ev := 'updated';
    select coalesce(
             pg_catalog.jsonb_object_agg(n.key, pg_catalog.jsonb_build_object('from', o.value, 'to', n.value)),
             '{}'::jsonb)
      into body
    from pg_catalog.jsonb_each(pg_catalog.to_jsonb(new)) n
    join pg_catalog.jsonb_each(pg_catalog.to_jsonb(old)) o on o.key = n.key
    where n.value is distinct from o.value
      and n.key not in ('updated_at', 'updated_by');
    if body = '{}'::jsonb then
      return null;
    end if;
  end if;

  if kind <> 'shop_settings' then
    row_id := ((case when tg_op = 'DELETE' then pg_catalog.to_jsonb(old) else pg_catalog.to_jsonb(new) end) ->> 'id')::uuid;
  end if;

  insert into public.schedule_events
    (entity, entity_id, event_type, payload, reason, actor_staff_id, actor_user_id, correlation_id)
  values
    (kind, row_id, ev, body, private.change_reason(), private.current_staff_id(), auth.uid(),
     private.current_correlation_id());
  return null;
end;
$$;

create trigger shop_settings_record_history
  after insert or update or delete on public.shop_settings
  for each row execute function private.record_schedule_event();
create trigger shop_hours_record_history
  after insert or update or delete on public.shop_hours
  for each row execute function private.record_schedule_event();
create trigger closure_overrides_record_history
  after insert or update or delete on public.closure_overrides
  for each row execute function private.record_schedule_event();
create trigger appointment_types_record_history
  after insert or update or delete on public.appointment_types
  for each row execute function private.record_schedule_event();

-- The settings row, in every database (production included).
insert into public.shop_settings (id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Private schedule helpers (called only by definer RPCs, as the owner).
-- ---------------------------------------------------------------------------
create function private.shop_settings_row()
returns public.shop_settings
language sql
stable
set search_path = ''
as $$
  select s.* from public.shop_settings s where s.id = 1;
$$;

-- The open hours of one shop-local date as instants (D38): a custom_hours
-- override covering the date replaces every weekly interval; otherwise the
-- ACTIVE weekly intervals of that weekday. Adjacent intervals merge (one
-- continuous stretch). Closed overrides are NOT subtracted here (see
-- private.closed_ranges). `day + time '24:00'` is the next midnight.
create function private.shop_hours_ranges(day date)
returns tstzmultirange
language sql
stable
set search_path = ''
as $$
  with tz as (select private.shop_timezone() as name),
  custom as (
    select c.opens_at, c.closes_at
    from public.closure_overrides c
    where c.kind = 'custom_hours'
      and pg_catalog.tstzrange(c.starts_at, c.ends_at, '[)') @> private.shop_day_start(shop_hours_ranges.day)
    order by c.starts_at
    limit 1
  )
  select case
    when exists (select 1 from custom) then (
      select pg_catalog.tstzmultirange(pg_catalog.tstzrange(
               (shop_hours_ranges.day + cu.opens_at) at time zone tz.name,
               (shop_hours_ranges.day + cu.closes_at) at time zone tz.name, '[)'))
      from custom cu, tz
    )
    else coalesce((
      select pg_catalog.range_agg(pg_catalog.tstzrange(
               (shop_hours_ranges.day + h.opens_at) at time zone tz.name,
               (shop_hours_ranges.day + h.closes_at) at time zone tz.name, '[)'))
      from public.shop_hours h, tz
      where h.active
        and h.weekday = extract(dow from shop_hours_ranges.day)::smallint
    ), '{}'::tstzmultirange)
  end;
$$;

-- The closed overrides overlapping [from_ts, to_ts), merged.
create function private.closed_ranges(from_ts timestamptz, to_ts timestamptz)
returns tstzmultirange
language sql
stable
set search_path = ''
as $$
  select coalesce(pg_catalog.range_agg(pg_catalog.tstzrange(c.starts_at, c.ends_at, '[)')), '{}'::tstzmultirange)
  from public.closure_overrides c
  where c.kind = 'closed'
    and pg_catalog.tstzrange(c.starts_at, c.ends_at, '[)')
        && pg_catalog.tstzrange(closed_ranges.from_ts, closed_ranges.to_ts, '[)');
$$;

-- D2 EXTENSION POINT: the capacity units one intake window can take. Today
-- the shop-wide pool (shop_settings.intake_capacity_units) for every
-- window; a later migration replaces this body (same signature) to derive
-- it from mechanic working hours, leave and skills. Nothing else reads
-- intake_capacity_units for capacity.
create function private.capacity_for_window(window_start timestamptz, window_end timestamptz)
returns integer
language sql
stable
set search_path = ''
as $$
  select s.intake_capacity_units from public.shop_settings s where s.id = 1;
$$;

comment on function private.capacity_for_window(timestamptz, timestamptz) is
  'D2 EXTENSION POINT: capacity units of one intake window (shop-wide pool today; mechanic hours/leave/skills later).';

-- ---------------------------------------------------------------------------
-- Admin RPCs. Each: require_admin, then shop_settings FOR UPDATE (serialises
-- schedule configuration), then validate and write; returns the row.
-- ---------------------------------------------------------------------------

-- Null keeps a field; public_site_url '' clears it. No time zone or
-- currency parameter (fixed in the MVP, D35). Lowering the capacity below an
-- active type's units is refused. Existing appointments are untouched (D38).
create function public.update_shop_settings(
  intake_slot_minutes integer default null,
  intake_capacity_units integer default null,
  booking_min_notice_minutes integer default null,
  booking_horizon_days integer default null,
  customer_max_active_bookings integer default null,
  customer_cancel_cutoff_minutes integer default null,
  public_site_url text default null
)
returns public.shop_settings
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_row public.shop_settings;
  next_row public.shop_settings;
  result public.shop_settings;
begin
  perform private.require_admin();

  select s.* into current_row from public.shop_settings s where s.id = 1 for update;
  next_row := current_row;
  next_row.intake_slot_minutes := coalesce(update_shop_settings.intake_slot_minutes, current_row.intake_slot_minutes);
  next_row.intake_capacity_units := coalesce(update_shop_settings.intake_capacity_units, current_row.intake_capacity_units);
  next_row.booking_min_notice_minutes :=
    coalesce(update_shop_settings.booking_min_notice_minutes, current_row.booking_min_notice_minutes);
  next_row.booking_horizon_days := coalesce(update_shop_settings.booking_horizon_days, current_row.booking_horizon_days);
  next_row.customer_max_active_bookings :=
    coalesce(update_shop_settings.customer_max_active_bookings, current_row.customer_max_active_bookings);
  next_row.customer_cancel_cutoff_minutes :=
    coalesce(update_shop_settings.customer_cancel_cutoff_minutes, current_row.customer_cancel_cutoff_minutes);
  next_row.public_site_url := case
    when update_shop_settings.public_site_url is null then current_row.public_site_url
    else nullif(pg_catalog.btrim(update_shop_settings.public_site_url), '')
  end;

  if exists (
    select 1 from public.appointment_types t
    where t.active and t.capacity_units > next_row.intake_capacity_units
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'shop_capacity_below_type',
      detail = 'An active appointment type takes more units than that; change or deactivate the type first.';
  end if;

  if next_row.intake_slot_minutes is not distinct from current_row.intake_slot_minutes
     and next_row.intake_capacity_units is not distinct from current_row.intake_capacity_units
     and next_row.booking_min_notice_minutes is not distinct from current_row.booking_min_notice_minutes
     and next_row.booking_horizon_days is not distinct from current_row.booking_horizon_days
     and next_row.customer_max_active_bookings is not distinct from current_row.customer_max_active_bookings
     and next_row.customer_cancel_cutoff_minutes is not distinct from current_row.customer_cancel_cutoff_minutes
     and next_row.public_site_url is not distinct from current_row.public_site_url then
    return current_row;
  end if;

  update public.shop_settings s
  set intake_slot_minutes = next_row.intake_slot_minutes,
      intake_capacity_units = next_row.intake_capacity_units,
      booking_min_notice_minutes = next_row.booking_min_notice_minutes,
      booking_horizon_days = next_row.booking_horizon_days,
      customer_max_active_bookings = next_row.customer_max_active_bookings,
      customer_cancel_cutoff_minutes = next_row.customer_cancel_cutoff_minutes,
      public_site_url = next_row.public_site_url
  where s.id = 1
  returning s.* into result;
  return result;
end;
$$;

comment on function public.update_shop_settings(integer, integer, integer, integer, integer, integer, text) is
  'Admin: change the booking settings (null keeps a field, public_site_url '''' clears it). No time zone or currency (D35). Never moves existing appointments (D38).';

-- Replaces one weekday's intervals atomically: a JSON array of 0..4
-- {"opens_at": "HH:MM", "closes_at": "HH:MM"} (closes_at may be "24:00");
-- every row of the weekday gets `active`. The same intervals and flag again
-- return the existing rows and append nothing.
create function public.set_shop_hours(weekday smallint, intervals jsonb, active boolean default true)
returns setof public.shop_hours
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  item jsonb;
  o text;
  c text;
  opens time[] := '{}';
  closes time[] := '{}';
  i integer;
  j integer;
  wanted text[];
  existing text[];
begin
  perform private.require_admin();

  if set_shop_hours.weekday is null or set_shop_hours.weekday not between 0 and 6 then
    raise exception 'weekday must be 0 (Sunday) to 6 (Saturday)' using errcode = '22023';
  end if;
  if set_shop_hours.active is null then
    raise exception 'active is required' using errcode = '22004';
  end if;
  if set_shop_hours.intervals is null
     or pg_catalog.jsonb_typeof(set_shop_hours.intervals) <> 'array'
     or pg_catalog.jsonb_array_length(set_shop_hours.intervals) > 4 then
    raise exception 'intervals must be a JSON array of at most 4 {opens_at, closes_at} objects'
      using errcode = '22023';
  end if;

  for item in select e.value from pg_catalog.jsonb_array_elements(set_shop_hours.intervals) e loop
    if pg_catalog.jsonb_typeof(item) <> 'object'
       or pg_catalog.jsonb_typeof(item -> 'opens_at') is distinct from 'string'
       or pg_catalog.jsonb_typeof(item -> 'closes_at') is distinct from 'string' then
      raise exception 'each interval needs opens_at and closes_at as "HH:MM"' using errcode = '22023';
    end if;
    o := item ->> 'opens_at';
    c := item ->> 'closes_at';
    if o !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or c !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$' then
      raise exception 'times must be "HH:MM" (closes_at may be "24:00")' using errcode = '22023';
    end if;
    if o::time >= c::time then
      raise exception using
        errcode = '23514',
        constraint = 'shop_hours_interval_check',
        message = 'new row for relation "shop_hours" violates check constraint "shop_hours_interval_check"';
    end if;
    opens := opens || o::time;
    closes := closes || c::time;
  end loop;

  for i in 1 .. coalesce(pg_catalog.array_length(opens, 1), 0) loop
    for j in i + 1 .. coalesce(pg_catalog.array_length(opens, 1), 0) loop
      if opens[i] < closes[j] and opens[j] < closes[i] then
        raise exception using
          errcode = 'P0001',
          message = 'shop_hours_overlap',
          detail = 'Opening intervals of the same weekday cannot overlap.';
      end if;
    end loop;
  end loop;

  perform 1 from public.shop_settings s where s.id = 1 for update;

  select coalesce(pg_catalog.array_agg(x.v order by x.v), '{}') into wanted
  from (
    select pg_catalog.format('%s-%s-%s', u.open_t, u.close_t, set_shop_hours.active) as v
    from unnest(opens, closes) as u(open_t, close_t)
  ) x;
  select coalesce(pg_catalog.array_agg(pg_catalog.format('%s-%s-%s', h.opens_at, h.closes_at, h.active)
                                       order by pg_catalog.format('%s-%s-%s', h.opens_at, h.closes_at, h.active)), '{}')
    into existing
  from public.shop_hours h
  where h.weekday = set_shop_hours.weekday;

  if wanted <> existing then
    delete from public.shop_hours h where h.weekday = set_shop_hours.weekday;
    insert into public.shop_hours (weekday, opens_at, closes_at, active)
    select set_shop_hours.weekday, u.open_t, u.close_t, set_shop_hours.active
    from unnest(opens, closes) as u(open_t, close_t)
    order by u.open_t;
  end if;

  return query
    select h.* from public.shop_hours h
    where h.weekday = set_shop_hours.weekday
    order by h.opens_at;
end;
$$;

comment on function public.set_shop_hours(smallint, jsonb, boolean) is
  'Admin: replace one weekday''s opening intervals (0..4, "HH:MM", closes_at up to "24:00"); a replay of the same intervals appends nothing.';

-- Creates or edits a closure. closure_id is the client-made idempotency key:
-- is_new and absent -> insert; is_new and an identical row -> that row
-- (replay, no event); is_new and a different row -> closure_conflict (a
-- late replay of a create never overwrites a later edit); not is_new and
-- absent -> P0002; not is_new -> update (no event when unchanged).
--   closed, no times: whole days [first_day 00:00, last_day + 1 00:00);
--   closed, from_time and to_time: part of ONE day (first_day = last_day);
--   custom_hours: from_time/to_time required, whole days, open hours
--   from_time..to_time on each (they replace the weekly hours, D38).
create function public.save_closure_override(
  closure_id uuid,
  is_new boolean,
  kind public.closure_kind,
  first_day date,
  last_day date,
  reason text,
  from_time time default null,
  to_time time default null
)
returns public.closure_overrides
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_admin();
  tz text;
  cleaned text := nullif(pg_catalog.btrim(coalesce(save_closure_override.reason, '')), '');
  target_starts timestamptz;
  target_ends timestamptz;
  target_opens time;
  target_closes time;
  found_row public.closure_overrides;
  result public.closure_overrides;
begin
  if save_closure_override.closure_id is null or save_closure_override.is_new is null
     or save_closure_override.kind is null or save_closure_override.first_day is null
     or save_closure_override.last_day is null then
    raise exception 'closure_id, is_new, kind, first_day and last_day are required' using errcode = '22004';
  end if;
  if cleaned is null then
    raise exception using
      errcode = 'P0001',
      message = 'reason_required',
      detail = 'Say why the shop is closed or keeping different hours.';
  end if;
  if pg_catalog.char_length(cleaned) > 200 then
    raise exception using
      errcode = '23514',
      constraint = 'closure_overrides_reason_check',
      message = 'new row for relation "closure_overrides" violates check constraint "closure_overrides_reason_check"';
  end if;

  perform 1 from public.shop_settings s where s.id = 1 for update;
  tz := private.shop_timezone();

  if save_closure_override.last_day < save_closure_override.first_day
     or save_closure_override.last_day - save_closure_override.first_day > 365 then
    raise exception using
      errcode = 'P0001',
      message = 'closure_invalid_range',
      detail = 'The last day must be on or after the first day, at most 366 days in all.';
  end if;

  if save_closure_override.kind = 'closed' then
    if save_closure_override.from_time is null and save_closure_override.to_time is null then
      target_starts := private.shop_day_start(save_closure_override.first_day);
      target_ends := private.shop_day_start(save_closure_override.last_day + 1);
    elsif save_closure_override.from_time is not null and save_closure_override.to_time is not null
          and save_closure_override.first_day = save_closure_override.last_day
          and save_closure_override.from_time < save_closure_override.to_time then
      target_starts := (save_closure_override.first_day + save_closure_override.from_time) at time zone tz;
      target_ends := (save_closure_override.first_day + save_closure_override.to_time) at time zone tz;
    else
      raise exception using
        errcode = 'P0001',
        message = 'closure_invalid_range',
        detail = 'Close whole days (no times), or part of one day with a start time before the end time.';
    end if;
  else
    if save_closure_override.from_time is null or save_closure_override.to_time is null
       or save_closure_override.from_time >= save_closure_override.to_time then
      raise exception using
        errcode = 'P0001',
        message = 'closure_invalid_range',
        detail = 'Different opening hours need an opening time before the closing time.';
    end if;
    target_starts := private.shop_day_start(save_closure_override.first_day);
    target_ends := private.shop_day_start(save_closure_override.last_day + 1);
    target_opens := save_closure_override.from_time;
    target_closes := save_closure_override.to_time;
    if exists (
      select 1 from public.closure_overrides c
      where c.kind = 'custom_hours'
        and c.id <> save_closure_override.closure_id
        and pg_catalog.tstzrange(c.starts_at, c.ends_at, '[)')
            && pg_catalog.tstzrange(target_starts, target_ends, '[)')
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'closure_custom_hours_overlap',
        detail = 'Another override with different opening hours already covers some of those days.';
    end if;
  end if;

  select c.* into found_row from public.closure_overrides c where c.id = save_closure_override.closure_id for update;

  if found_row.id is null then
    if not save_closure_override.is_new then
      raise exception 'closure % not found', save_closure_override.closure_id using errcode = 'P0002';
    end if;
    insert into public.closure_overrides as c (id, kind, starts_at, ends_at, opens_at, closes_at, reason, created_by)
    values (save_closure_override.closure_id, save_closure_override.kind, target_starts, target_ends,
            target_opens, target_closes, cleaned, me)
    returning c.* into result;
    return result;
  end if;

  if found_row.kind = save_closure_override.kind
     and found_row.starts_at = target_starts
     and found_row.ends_at = target_ends
     and found_row.opens_at is not distinct from target_opens
     and found_row.closes_at is not distinct from target_closes
     and found_row.reason = cleaned then
    return found_row;
  end if;

  if save_closure_override.is_new then
    raise exception using
      errcode = 'P0001',
      message = 'closure_conflict',
      detail = 'A closure with this id exists with other values (it was changed since); reload it.';
  end if;

  update public.closure_overrides c
  set kind = save_closure_override.kind,
      starts_at = target_starts,
      ends_at = target_ends,
      opens_at = target_opens,
      closes_at = target_closes,
      reason = cleaned
  where c.id = found_row.id
  returning c.* into result;
  return result;
end;
$$;

comment on function public.save_closure_override(uuid, boolean, public.closure_kind, date, date, text, time, time) is
  'Admin: create (is_new) or edit a closure by its client-made id; whole days, part of one day, or custom hours over whole days (D38). Replays return the row.';

-- Deleting a closure re-opens the shop, so it needs a reason (SPEC §22),
-- kept in schedule_events with the deleted row. Returns the deleted row, or
-- null when it no longer exists (replay).
create function public.delete_closure_override(closure_id uuid, reason text)
returns public.closure_overrides
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  cleaned text := nullif(pg_catalog.btrim(coalesce(delete_closure_override.reason, '')), '');
  result public.closure_overrides;
begin
  perform private.require_admin();
  if cleaned is null then
    raise exception using
      errcode = 'P0001',
      message = 'reason_required',
      detail = 'Say why the closure is being removed.';
  end if;
  if pg_catalog.char_length(cleaned) > 500 then
    raise exception using
      errcode = 'P0001',
      message = 'reason_too_long',
      detail = 'Keep the reason under 500 characters.';
  end if;
  if delete_closure_override.closure_id is null then
    raise exception 'closure_id is required' using errcode = '22004';
  end if;

  perform 1 from public.shop_settings s where s.id = 1 for update;

  perform private.set_change_reason(cleaned);
  delete from public.closure_overrides c
  where c.id = delete_closure_override.closure_id
  returning c.* into result;
  perform private.set_change_reason(null);
  return result;
end;
$$;

comment on function public.delete_closure_override(uuid, text) is
  'Admin: remove a closure with a reason (kept in schedule_events); null when it is already gone.';

-- Creates or edits an appointment type by its client-made id (same
-- insert-or-replay semantics as closures; appointment_type_conflict). An
-- active type cannot take more units than the shop's intake capacity.
-- Changing duration or units never alters existing appointments (D38).
create function public.save_appointment_type(
  appointment_type_id uuid,
  is_new boolean,
  name text,
  description text,
  duration_minutes integer,
  capacity_units integer,
  public boolean,
  active boolean,
  sort_order integer default 0
)
returns public.appointment_types
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  clean_name text := pg_catalog.btrim(save_appointment_type.name);
  clean_description text := nullif(pg_catalog.btrim(save_appointment_type.description), '');
  clean_sort integer := coalesce(save_appointment_type.sort_order, 0);
  capacity integer;
  found_row public.appointment_types;
  result public.appointment_types;
begin
  perform private.require_admin();
  if save_appointment_type.appointment_type_id is null or save_appointment_type.is_new is null
     or save_appointment_type.duration_minutes is null or save_appointment_type.capacity_units is null
     or save_appointment_type.public is null or save_appointment_type.active is null then
    raise exception 'appointment_type_id, is_new, duration_minutes, capacity_units, public and active are required'
      using errcode = '22004';
  end if;

  select s.intake_capacity_units into capacity from public.shop_settings s where s.id = 1 for update;

  if save_appointment_type.active and save_appointment_type.capacity_units > capacity then
    raise exception using
      errcode = 'P0001',
      message = 'appointment_type_capacity_too_large',
      detail = pg_catalog.format('The shop takes %s units per slot; raise the capacity first.', capacity);
  end if;

  select t.* into found_row
  from public.appointment_types t
  where t.id = save_appointment_type.appointment_type_id
  for update;

  if found_row.id is null then
    if not save_appointment_type.is_new then
      raise exception 'appointment type % not found', save_appointment_type.appointment_type_id
        using errcode = 'P0002';
    end if;
    insert into public.appointment_types as t
      (id, name, description, duration_minutes, capacity_units, public, active, sort_order)
    values (save_appointment_type.appointment_type_id, clean_name, clean_description,
            save_appointment_type.duration_minutes, save_appointment_type.capacity_units,
            save_appointment_type.public, save_appointment_type.active, clean_sort)
    returning t.* into result;
    return result;
  end if;

  if found_row.name is not distinct from clean_name
     and found_row.description is not distinct from clean_description
     and found_row.duration_minutes = save_appointment_type.duration_minutes
     and found_row.capacity_units = save_appointment_type.capacity_units
     and found_row.public = save_appointment_type.public
     and found_row.active = save_appointment_type.active
     and found_row.sort_order = clean_sort then
    return found_row;
  end if;

  if save_appointment_type.is_new then
    raise exception using
      errcode = 'P0001',
      message = 'appointment_type_conflict',
      detail = 'An appointment type with this id exists with other values (it was changed since); reload it.';
  end if;

  update public.appointment_types t
  set name = clean_name,
      description = clean_description,
      duration_minutes = save_appointment_type.duration_minutes,
      capacity_units = save_appointment_type.capacity_units,
      public = save_appointment_type.public,
      active = save_appointment_type.active,
      sort_order = clean_sort
  where t.id = found_row.id
  returning t.* into result;
  return result;
end;
$$;

comment on function public.save_appointment_type(uuid, boolean, text, text, integer, integer, boolean, boolean, integer) is
  'Admin: create (is_new) or edit an appointment type by its client-made id; never deleted (deactivate). Existing appointments keep their snapshot (D38).';

-- ---------------------------------------------------------------------------
-- Public schedule reads (anonymous visitors and customers; D37).
-- ---------------------------------------------------------------------------

-- Active, public types (never their capacity units).
create function public.public_appointment_types()
returns table (id uuid, name text, description text, duration_minutes integer)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.name, t.description, t.duration_minutes
  from public.appointment_types t
  where t.active and t.public
  order by t.sort_order, t.name, t.id;
$$;

comment on function public.public_appointment_types() is
  'Everyone: the appointment types customers can book online (active and public; no capacity units).';

-- The active weekly hours. Closures are not listed (their reasons are
-- internal); available_slots already leaves them out.
create function public.public_shop_hours()
returns table (weekday smallint, opens_at time, closes_at time)
language sql
stable
security definer
set search_path = ''
as $$
  select h.weekday, h.opens_at, h.closes_at
  from public.shop_hours h
  where h.active
  order by h.weekday, h.opens_at;
$$;

comment on function public.public_shop_hours() is
  'Everyone: the active weekly opening hours (closures are not listed).';

-- ---------------------------------------------------------------------------
-- Privileges and RLS: staff read; writes only through the admin RPCs.
-- ---------------------------------------------------------------------------
revoke all on function
  private.require_admin(),
  private.shop_settings_enforce_rules(),
  private.shop_settings_keep_row(),
  private.shop_hours_enforce_rules(),
  private.schedule_events_append_only(),
  private.record_schedule_event(),
  private.shop_settings_row(),
  private.shop_hours_ranges(date),
  private.closed_ranges(timestamptz, timestamptz),
  private.capacity_for_window(timestamptz, timestamptz)
from public, anon, authenticated, service_role;

revoke all on function
  public.update_shop_settings(integer, integer, integer, integer, integer, integer, text),
  public.set_shop_hours(smallint, jsonb, boolean),
  public.save_closure_override(uuid, boolean, public.closure_kind, date, date, text, time, time),
  public.delete_closure_override(uuid, text),
  public.save_appointment_type(uuid, boolean, text, text, integer, integer, boolean, boolean, integer),
  public.public_appointment_types(),
  public.public_shop_hours()
from public, anon, authenticated, service_role;

grant execute on function
  public.update_shop_settings(integer, integer, integer, integer, integer, integer, text),
  public.set_shop_hours(smallint, jsonb, boolean),
  public.save_closure_override(uuid, boolean, public.closure_kind, date, date, text, time, time),
  public.delete_closure_override(uuid, text),
  public.save_appointment_type(uuid, boolean, text, text, integer, integer, boolean, boolean, integer)
to authenticated;

grant execute on function
  public.public_appointment_types(),
  public.public_shop_hours()
to anon, authenticated;

alter table public.shop_settings enable row level security;
alter table public.shop_hours enable row level security;
alter table public.closure_overrides enable row level security;
alter table public.appointment_types enable row level security;
alter table public.schedule_events enable row level security;

revoke all on table
  public.shop_settings,
  public.shop_hours,
  public.closure_overrides,
  public.appointment_types,
  public.schedule_events
from public, anon, authenticated, service_role;
revoke all on sequence public.schedule_events_id_seq from public, anon, authenticated, service_role;

grant select on table
  public.shop_settings,
  public.shop_hours,
  public.closure_overrides,
  public.appointment_types,
  public.schedule_events
to authenticated, service_role;

create policy shop_settings_select_staff on public.shop_settings
  for select to authenticated using ((select private.is_staff()));
create policy shop_hours_select_staff on public.shop_hours
  for select to authenticated using ((select private.is_staff()));
create policy closure_overrides_select_staff on public.closure_overrides
  for select to authenticated using ((select private.is_staff()));
create policy appointment_types_select_staff on public.appointment_types
  for select to authenticated using ((select private.is_staff()));
create policy schedule_events_select_staff on public.schedule_events
  for select to authenticated using ((select private.is_staff()));
