-- Appointments: booking, capacity, status and history (SPEC §2, §6
-- "Prevent overbooking transactionally", §23 "Appointment booking cannot
-- exceed configured capacity", §25; DATA-MODEL.md §3, §15, §16; PLAN D2,
-- D37, D38, D39).
--
-- Rules encoded here:
--   * An appointment reserves intake capacity (D2): it takes its type's
--     capacity_units in every intake window it overlaps. Windows are
--     intake_slot_minutes long and aligned to shop-local midnight (D38).
--     Cancelled and no-show appointments take nothing.
--   * A booking starts on the grid; the whole [starts_at, ends_at) lies
--     inside one continuous open stretch of one shop-local date (weekly
--     hours, or the custom hours that replace them), overlaps no closed
--     override and fits the capacity of every window it overlaps (D38).
--     private.appointment_slot_problem() names the first rule a booking
--     breaks, in that order; private.available_slots_at() lists the starts
--     that break none (the TypeScript mirror reproduces it exactly).
--   * ends_at and capacity_units are snapshots of the type when booked:
--     later settings or type changes never move, shrink or cancel an
--     existing appointment (D38).
--   * Self-booking (D37, final): customers book only active and public
--     types, at least booking_min_notice_minutes ahead and at most
--     booking_horizon_days ahead, and hold at most
--     customer_max_active_bookings upcoming booked/confirmed bookings they
--     made themselves (source = 'customer'; staff-made bookings never
--     count). Staff are exempt from notice, horizon, limit and the public
--     flag, never from hours, closures or capacity, and cannot book an
--     appointment that is already over. The customer RPCs are in the
--     customer access migration.
--   * Status machine (D39), for every writer: booked -> confirmed |
--     arrived | checked_in | cancelled | no_show; confirmed -> arrived |
--     checked_in | cancelled | no_show; arrived -> checked_in | cancelled;
--     no_show -> arrived; checked_in -> completed. cancelled and completed
--     are final (rebook instead). Cancelling needs a reason. Staff mark
--     confirmed, arrived and no_show (no_show only once it has started; a
--     no-show becomes arrived only on its own shop-local date, re-checking
--     capacity); checked_in only through check-in (step 2, D40); completed
--     only automatically from the linked work order (step 2, D36).
--   * Every booking, status change and change of bike or notes appends one
--     appointment_events row (triggers, every writer); replays and no-op
--     updates append nothing; the history is append-only.
--   * Every booking is idempotent on its client-made id: the same id with
--     the same customer, type and start returns the original row (no
--     event), even after the type is deactivated; another booking under the
--     same id is appointment_conflict.
--   * Base tables are readable by active staff only; customers read their
--     own appointments through the my_* RPCs (customer access pattern,
--     DATA-MODEL §15). No API role writes them directly.
--
-- LOCK ORDER (every path follows it, so nothing deadlocks):
--   (a) the shop_settings row (id = 1): FOR SHARE by every appointment
--       writer that reads the settings (booking, mark_appointment_status,
--       cancel_my_appointment), FOR UPDATE by the admin configuration RPCs;
--   (b) the per-customer advisory lock
--       hashtextextended('bicii.appointments.customer.' || customer_id, 0)
--       (customer self-booking only; Phase 11 reuses
--       private.appointment_lock_customer and adds no lock of its own);
--   (c) the per-day advisory lock
--       hashtextextended('bicii.appointments.' || local_day, 0) and/or the
--       appointment row FOR UPDATE: mark_appointment_status takes the row,
--       then the day lock; booking takes the day lock and never an
--       appointment row lock, so there is no cycle;
--   (d) step 2's check-in then takes the work order, customer and bike row
--       locks through Phase 3's path.

create type public.appointment_status as enum (
  'booked',
  'confirmed',
  'arrived',
  'checked_in',
  'completed',
  'cancelled',
  'no_show'
);

-- 'customer' is shown as "Booked online" on the public site.
create type public.appointment_source as enum ('staff', 'customer');

create type public.appointment_event_type as enum (
  'booked',
  'confirmed',
  'arrived',
  'checked_in',
  'completed',
  'cancelled',
  'no_show',
  'details_changed',
  'work_order_linked'
);

-- ---------------------------------------------------------------------------
-- appointments
-- ---------------------------------------------------------------------------
create table public.appointments (
  -- Client-made: the booking's idempotency key.
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict,
  bike_id uuid null references public.bikes (id) on delete restrict,
  appointment_type_id uuid not null references public.appointment_types (id) on delete restrict,
  starts_at timestamptz not null,
  -- Snapshot: starts_at + the type's duration when booked (D38).
  ends_at timestamptz not null,
  -- Snapshot of the type's capacity_units when booked (D38).
  capacity_units integer not null,
  status public.appointment_status not null default 'booked',
  source public.appointment_source not null,
  -- The customer's own words; customers see it (D42).
  customer_note text null,
  -- Staff only; never in a customer projection (D8, D42).
  internal_note text null,
  confirmed_at timestamptz null,
  arrived_at timestamptz null,
  checked_in_at timestamptz null,
  completed_at timestamptz null,
  no_show_at timestamptz null,
  cancelled_at timestamptz null,
  cancellation_reason text null,
  -- Who cancelled, as a channel (staff or the customer), never a person.
  cancelled_via public.appointment_source null,
  created_by_user_id uuid null references auth.users (id) on delete set null,
  created_by_staff_id uuid null references public.staff (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_range_check check (ends_at > starts_at),
  constraint appointments_capacity_units_check check (capacity_units between 1 and 50),
  constraint appointments_customer_note_check check (pg_catalog.char_length(customer_note) <= 1000),
  constraint appointments_internal_note_check check (pg_catalog.char_length(internal_note) <= 5000),
  constraint appointments_cancellation_reason_check check (pg_catalog.char_length(cancellation_reason) <= 500),
  constraint appointments_status_stamps check (
    (status <> 'cancelled' or (cancelled_at is not null and cancellation_reason is not null))
    and (status not in ('checked_in', 'completed') or checked_in_at is not null)
    and (status <> 'no_show' or no_show_at is not null)
    and (status <> 'completed' or completed_at is not null)
  ),
  constraint appointments_cancelled_via_check check ((status = 'cancelled') = (cancelled_via is not null))
);

create index appointments_active_range_idx on public.appointments (starts_at, ends_at)
  where status not in ('cancelled', 'no_show');
create index appointments_customer_idx on public.appointments (customer_id, starts_at desc);
create index appointments_bike_idx on public.appointments (bike_id);
create index appointments_type_idx on public.appointments (appointment_type_id);
create index appointments_created_by_staff_idx on public.appointments (created_by_staff_id);
create index appointments_created_by_user_idx on public.appointments (created_by_user_id);

comment on table public.appointments is
  'Booked intake capacity (D2). Written only by the appointment RPCs; the status machine (D39), stamps and history are enforced by triggers for every writer.';
comment on column public.appointments.ends_at is 'Snapshot: starts_at + the type''s duration when booked; never moved by settings changes (D38).';
comment on column public.appointments.capacity_units is 'Snapshot of the type''s units when booked (D38).';
comment on column public.appointments.internal_note is 'Staff only; never returned by a customer RPC (D8, D42).';
comment on column public.appointments.cancelled_via is 'Channel that cancelled (staff or customer), never a person (D37, D42).';

create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- appointment_events (append-only history)
-- ---------------------------------------------------------------------------
create table public.appointment_events (
  id bigint generated always as identity primary key,
  appointment_id uuid not null references public.appointments (id) on delete restrict,
  event_type public.appointment_event_type not null,
  from_status public.appointment_status null,
  to_status public.appointment_status null,
  reason text null,
  payload jsonb not null default '{}'::jsonb,
  actor_staff_id uuid null references public.staff (id) on delete restrict,
  actor_user_id uuid null,
  correlation_id text null,
  created_at timestamptz not null default clock_timestamp(),
  constraint appointment_events_payload_object check (pg_catalog.jsonb_typeof(payload) = 'object'),
  constraint appointment_events_reason_check check (pg_catalog.char_length(reason) <= 500)
);
create index appointment_events_appointment_idx on public.appointment_events (appointment_id, created_at, id);
create index appointment_events_actor_staff_id_idx on public.appointment_events (actor_staff_id);

comment on table public.appointment_events is
  'Append-only appointment history, written by triggers: booked, each status change, details_changed (bike, notes), and from step 2 work_order_linked. Timelines order by (created_at, id).';

create function private.appointment_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'appointment_history_append_only',
    detail = 'Appointment history cannot be changed or deleted.';
end;
$$;

create trigger appointment_events_append_only
  before update or delete on public.appointment_events
  for each row execute function private.appointment_events_append_only();

-- Appends one event with the caller as actor and the request's correlation
-- ID. `at` is the business time of what happened (default now).
create function private.record_appointment_event(
  appointment_id uuid,
  event_type public.appointment_event_type,
  from_status public.appointment_status,
  to_status public.appointment_status,
  reason text,
  payload jsonb,
  "at" timestamptz default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into public.appointment_events
    (appointment_id, event_type, from_status, to_status, reason, payload,
     actor_staff_id, actor_user_id, correlation_id, created_at)
  values (
    record_appointment_event.appointment_id,
    record_appointment_event.event_type,
    record_appointment_event.from_status,
    record_appointment_event.to_status,
    record_appointment_event.reason,
    coalesce(record_appointment_event.payload, '{}'::jsonb),
    private.current_staff_id(),
    auth.uid(),
    private.current_correlation_id(),
    coalesce(record_appointment_event."at", pg_catalog.clock_timestamp())
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- The status machine (D39). Mirrored by the TypeScript transition table
-- (tests/fixtures/appointment-transitions.ts; step 3's src/lib).
-- ---------------------------------------------------------------------------
create function private.appointment_transition_allowed(
  from_status public.appointment_status,
  to_status public.appointment_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case from_status
    when 'booked' then to_status in ('confirmed', 'arrived', 'checked_in', 'cancelled', 'no_show')
    when 'confirmed' then to_status in ('arrived', 'checked_in', 'cancelled', 'no_show')
    when 'arrived' then to_status in ('checked_in', 'cancelled')
    when 'no_show' then to_status = 'arrived'
    when 'checked_in' then to_status = 'completed'
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
-- appointments: rules every writer obeys (the owner and the seed included).
-- ---------------------------------------------------------------------------
create function private.appointments_enforce_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  default_stamp timestamptz;
  bike_owner uuid;
  bike_archived timestamptz;
  bike_found boolean := false;
begin
  new.customer_note := nullif(pg_catalog.btrim(new.customer_note), '');
  new.internal_note := nullif(pg_catalog.btrim(new.internal_note), '');
  new.cancellation_reason := nullif(pg_catalog.btrim(new.cancellation_reason), '');

  if new.bike_id is not null and (tg_op = 'INSERT' or new.bike_id is distinct from old.bike_id) then
    select b.customer_id, b.archived_at into bike_owner, bike_archived
    from public.bikes b where b.id = new.bike_id;
    bike_found := found;
  end if;

  if tg_op = 'INSERT' then
    -- Any status (history, seed): fill the stamps the status needs.
    default_stamp := least(pg_catalog.now(), new.starts_at);
    if new.status = 'confirmed' then
      new.confirmed_at := coalesce(new.confirmed_at, default_stamp);
    elsif new.status = 'arrived' then
      new.arrived_at := coalesce(new.arrived_at, default_stamp);
    elsif new.status in ('checked_in', 'completed') then
      new.arrived_at := coalesce(new.arrived_at, new.checked_in_at, default_stamp);
      new.checked_in_at := coalesce(new.checked_in_at, new.arrived_at);
      if new.status = 'completed' then
        new.completed_at := coalesce(new.completed_at, greatest(new.checked_in_at, default_stamp));
      end if;
    elsif new.status = 'no_show' then
      new.no_show_at := coalesce(new.no_show_at, default_stamp);
    elsif new.status = 'cancelled' then
      new.cancelled_at := coalesce(new.cancelled_at, default_stamp);
      new.cancellation_reason := coalesce(new.cancellation_reason, private.change_reason());
      new.cancelled_via := coalesce(new.cancelled_via, 'staff');
    end if;
  else
    if new.id is distinct from old.id
       or new.customer_id is distinct from old.customer_id
       or new.appointment_type_id is distinct from old.appointment_type_id
       or new.starts_at is distinct from old.starts_at
       or new.ends_at is distinct from old.ends_at
       or new.capacity_units is distinct from old.capacity_units
       or new.source is distinct from old.source
       or new.created_by_user_id is distinct from old.created_by_user_id
       or new.created_by_staff_id is distinct from old.created_by_staff_id
       or new.created_at is distinct from old.created_at then
      raise exception using
        errcode = 'P0001',
        message = 'appointment_immutable',
        detail = 'An appointment keeps its customer, type, times, units and origin; cancel and rebook instead.';
    end if;

    -- Stamps (and the cancellation reason and channel) are set once, only
    -- together with the status they belong to, and never change after.
    if (old.confirmed_at is not null and new.confirmed_at is distinct from old.confirmed_at)
       or (old.arrived_at is not null and new.arrived_at is distinct from old.arrived_at)
       or (old.checked_in_at is not null and new.checked_in_at is distinct from old.checked_in_at)
       or (old.completed_at is not null and new.completed_at is distinct from old.completed_at)
       or (old.no_show_at is not null and new.no_show_at is distinct from old.no_show_at)
       or (old.cancelled_at is not null and new.cancelled_at is distinct from old.cancelled_at)
       or (old.cancellation_reason is not null and new.cancellation_reason is distinct from old.cancellation_reason)
       or (new.status = old.status and (
             new.confirmed_at is distinct from old.confirmed_at
             or new.arrived_at is distinct from old.arrived_at
             or new.checked_in_at is distinct from old.checked_in_at
             or new.completed_at is distinct from old.completed_at
             or new.no_show_at is distinct from old.no_show_at
             or new.cancelled_at is distinct from old.cancelled_at
             or new.cancellation_reason is distinct from old.cancellation_reason))
       or (new.cancelled_via is distinct from old.cancelled_via
           and not (new.status = 'cancelled' and old.status <> 'cancelled')) then
      raise exception using
        errcode = 'P0001',
        message = 'appointment_immutable',
        detail = 'An appointment''s timestamps change only with its status.';
    end if;

    if new.bike_id is distinct from old.bike_id and old.status not in ('booked', 'confirmed', 'arrived') then
      raise exception using
        errcode = 'P0001',
        message = 'appointment_immutable',
        detail = 'The bike can change only before the appointment is checked in, completed, cancelled or missed.';
    end if;

    if new.status <> old.status then
      if not private.appointment_transition_allowed(old.status, new.status) then
        raise exception using
          errcode = 'P0001',
          message = 'appointment_transition_invalid',
          detail = pg_catalog.format('An appointment cannot move from %s to %s.', old.status, new.status);
      end if;
      case new.status
        when 'confirmed' then new.confirmed_at := coalesce(new.confirmed_at, pg_catalog.now());
        when 'arrived' then new.arrived_at := coalesce(new.arrived_at, pg_catalog.now());
        when 'checked_in' then
          new.checked_in_at := coalesce(new.checked_in_at, pg_catalog.now());
          new.arrived_at := coalesce(new.arrived_at, new.checked_in_at);
        when 'completed' then new.completed_at := coalesce(new.completed_at, pg_catalog.now());
        when 'no_show' then new.no_show_at := coalesce(new.no_show_at, pg_catalog.now());
        when 'cancelled' then
          if private.change_reason() is null then
            raise exception using
              errcode = 'P0001',
              message = 'reason_required',
              detail = 'Say why the appointment is cancelled.';
          end if;
          new.cancellation_reason := private.change_reason();
          new.cancelled_at := coalesce(new.cancelled_at, pg_catalog.now());
          new.cancelled_via := coalesce(new.cancelled_via, 'staff');
        else null;
      end case;
    end if;
  end if;

  if new.bike_id is not null and (tg_op = 'INSERT' or new.bike_id is distinct from old.bike_id) then
    if not bike_found then
      raise exception 'bike % not found', new.bike_id using errcode = 'P0002';
    end if;
    if bike_owner is distinct from new.customer_id then
      raise exception using
        errcode = 'P0001',
        message = 'appointment_bike_not_owned',
        detail = 'The bike must belong to the appointment''s customer.';
    end if;
    if bike_archived is not null then
      raise exception using
        errcode = 'P0001',
        message = 'appointment_bike_archived',
        detail = 'That bike is archived; unarchive it or pick another.';
    end if;
  end if;
  return new;
end;
$$;

create trigger appointments_enforce_rules
  before insert or update on public.appointments
  for each row execute function private.appointments_enforce_rules();

-- History: one event per booking, status change and details change.
create function private.appointments_record_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  type_name text;
  changes jsonb := '{}'::jsonb;
  stamp timestamptz;
begin
  if tg_op = 'INSERT' then
    select t.name into type_name from public.appointment_types t where t.id = new.appointment_type_id;
    perform private.record_appointment_event(
      new.id, 'booked', null, new.status, private.change_reason(),
      pg_catalog.jsonb_build_object(
        'appointment_type_id', new.appointment_type_id,
        'appointment_type_name', type_name,
        'starts_at', new.starts_at,
        'ends_at', new.ends_at,
        'source', new.source,
        'status', new.status
      ),
      new.created_at
    );
    return null;
  end if;

  if new.status <> old.status then
    stamp := case new.status
      when 'confirmed' then new.confirmed_at
      when 'arrived' then new.arrived_at
      when 'checked_in' then new.checked_in_at
      when 'completed' then new.completed_at
      when 'no_show' then new.no_show_at
      when 'cancelled' then new.cancelled_at
    end;
    perform private.record_appointment_event(
      new.id, new.status::text::public.appointment_event_type, old.status, new.status,
      private.change_reason(),
      case when new.status = 'cancelled'
        then pg_catalog.jsonb_build_object('via', new.cancelled_via)
        else '{}'::jsonb
      end,
      stamp
    );
  end if;

  if new.bike_id is distinct from old.bike_id then
    changes := changes || pg_catalog.jsonb_build_object('bike_id',
      pg_catalog.jsonb_build_object('from', old.bike_id, 'to', new.bike_id));
  end if;
  if new.customer_note is distinct from old.customer_note then
    changes := changes || pg_catalog.jsonb_build_object('customer_note',
      pg_catalog.jsonb_build_object('from', old.customer_note, 'to', new.customer_note));
  end if;
  if new.internal_note is distinct from old.internal_note then
    changes := changes || pg_catalog.jsonb_build_object('internal_note',
      pg_catalog.jsonb_build_object('from', old.internal_note, 'to', new.internal_note));
  end if;
  if changes <> '{}'::jsonb then
    perform private.record_appointment_event(new.id, 'details_changed', null, null, null, changes);
  end if;
  return null;
end;
$$;

create trigger appointments_record_history
  after insert or update on public.appointments
  for each row execute function private.appointments_record_history();

-- ---------------------------------------------------------------------------
-- Locks (lock order (b) and (c) above).
-- ---------------------------------------------------------------------------
create function private.appointment_lock_customer(customer_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bicii.appointments.customer.' || appointment_lock_customer.customer_id::text, 0));
end;
$$;

create function private.appointment_lock_day(local_day date)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bicii.appointments.' || appointment_lock_day.local_day::text, 0));
end;
$$;

-- ---------------------------------------------------------------------------
-- Capacity and slots (D2, D38).
-- ---------------------------------------------------------------------------

-- The intake windows (grid aligned to shop-local midnight, intake_slot_minutes
-- long) that overlap [from_ts, to_ts).
create function private.appointment_windows(from_ts timestamptz, to_ts timestamptz)
returns table (window_start timestamptz, window_end timestamptz)
language sql
stable
security definer
set search_path = ''
-- The planner's default row estimates for generate_series make this look
-- expensive enough to JIT-compile on every call; it is small and fast.
set jit = off
as $$
  select w.window_start, w.window_end
  from (
    select
      (d.day::date + pg_catalog.make_interval(mins => g.m)) at time zone tz.name as window_start,
      (d.day::date + pg_catalog.make_interval(mins => g.m + s.intake_slot_minutes)) at time zone tz.name as window_end
    from public.shop_settings s
    cross join (select private.shop_timezone() as name) tz
    cross join pg_catalog.generate_series(
      private.shop_day(appointment_windows.from_ts)::timestamp,
      private.shop_day(appointment_windows.to_ts - interval '1 microsecond')::timestamp,
      interval '1 day'
    ) as d(day)
    cross join pg_catalog.generate_series(0, 1440 - s.intake_slot_minutes, s.intake_slot_minutes) as g(m)
    where s.id = 1
  ) w
  where w.window_start < appointment_windows.to_ts
    and w.window_end > appointment_windows.from_ts
  order by w.window_start;
$$;

-- True when adding `capacity_units` over [starts_at, ends_at) would take
-- some overlapped window past private.capacity_for_window (D2). Cancelled
-- and no-show appointments take nothing; exclude_id leaves one out (a
-- reinstated no-show re-checking its own place, D39).
create function private.appointment_capacity_exceeded(
  starts_at timestamptz,
  ends_at timestamptz,
  capacity_units integer,
  exclude_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
-- The planner's default row estimates for generate_series make this look
-- expensive enough to JIT-compile on every call; it is small and fast.
set jit = off
as $$
  select exists (
    select 1
    from private.appointment_windows(appointment_capacity_exceeded.starts_at, appointment_capacity_exceeded.ends_at) w
    where coalesce((
            select sum(a.capacity_units)
            from public.appointments a
            where a.status not in ('cancelled', 'no_show')
              and (appointment_capacity_exceeded.exclude_id is null or a.id <> appointment_capacity_exceeded.exclude_id)
              and a.starts_at < w.window_end
              and a.ends_at > w.window_start
          ), 0) + appointment_capacity_exceeded.capacity_units
          > private.capacity_for_window(w.window_start, w.window_end)
  );
$$;

-- The first rule a booking of [starts_at, ends_at) with `capacity_units`
-- breaks, or null, in this order (D38):
--   appointment_slot_misaligned    the start's local time is not on the grid;
--   appointment_outside_hours      it crosses local midnight or is not inside
--                                  one open stretch of its local date;
--   appointment_closed             it overlaps a closed override;
--   appointment_capacity_exceeded  some overlapped window would be over
--                                  capacity (exclude_id left out).
create function private.appointment_slot_problem(
  starts_at timestamptz,
  ends_at timestamptz,
  capacity_units integer,
  exclude_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
-- The planner's default row estimates for generate_series make this look
-- expensive enough to JIT-compile on every call; it is small and fast.
set jit = off
as $$
declare
  slot integer;
  local_t time;
  local_day date;
begin
  if appointment_slot_problem.starts_at is null or appointment_slot_problem.ends_at is null
     or appointment_slot_problem.capacity_units is null then
    raise exception 'starts_at, ends_at and capacity_units are required' using errcode = '22004';
  end if;
  if appointment_slot_problem.ends_at <= appointment_slot_problem.starts_at then
    raise exception 'ends_at must be after starts_at' using errcode = '22023';
  end if;

  select s.intake_slot_minutes into slot from public.shop_settings s where s.id = 1;
  local_t := (appointment_slot_problem.starts_at at time zone private.shop_timezone())::time;
  local_day := private.shop_day(appointment_slot_problem.starts_at);

  if extract(second from local_t) <> 0
     or (extract(hour from local_t)::integer * 60 + extract(minute from local_t)::integer) % slot <> 0 then
    return 'appointment_slot_misaligned';
  end if;

  if private.shop_day(appointment_slot_problem.ends_at - interval '1 microsecond') <> local_day
     or not (pg_catalog.tstzrange(appointment_slot_problem.starts_at, appointment_slot_problem.ends_at, '[)')
             <@ private.shop_hours_ranges(local_day)) then
    return 'appointment_outside_hours';
  end if;

  if pg_catalog.tstzrange(appointment_slot_problem.starts_at, appointment_slot_problem.ends_at, '[)')
     && private.closed_ranges(appointment_slot_problem.starts_at, appointment_slot_problem.ends_at) then
    return 'appointment_closed';
  end if;

  if private.appointment_capacity_exceeded(
       appointment_slot_problem.starts_at, appointment_slot_problem.ends_at,
       appointment_slot_problem.capacity_units, appointment_slot_problem.exclude_id) then
    return 'appointment_capacity_exceeded';
  end if;
  return null;
end;
$$;

-- The bookable starts of one shop-local date for one type, as of `as_of`.
-- The type must be active (and public unless for_staff), else nothing.
-- Candidates are the grid starts of `day`; each [s, s + duration) must pass
-- appointment_slot_problem. Staff keep starts whose slot has not ended
-- (slot_end > as_of); everyone else keeps starts at least the notice ahead
-- and at most the horizon ahead (and nothing on a day past the horizon).
-- remaining_units = the least free capacity over the overlapped windows
-- before this booking. Ordered by slot_start. Phase 11's bookable_slots
-- wrapper and step 3's TypeScript mirror depend on this exact signature
-- and result.
create function private.available_slots_at(
  day date,
  appointment_type_id uuid,
  as_of timestamptz,
  for_staff boolean
)
returns table (slot_start timestamptz, slot_end timestamptz, remaining_units integer)
language sql
stable
security definer
set search_path = ''
-- The planner's default row estimates for generate_series make this look
-- expensive enough to JIT-compile on every call; it is small and fast.
set jit = off
as $$
  with s as (
    select st.intake_slot_minutes, st.booking_min_notice_minutes, st.booking_horizon_days
    from public.shop_settings st
    where st.id = 1
  ),
  t as (
    select ty.duration_minutes, ty.capacity_units
    from public.appointment_types ty
    where ty.id = available_slots_at.appointment_type_id
      and ty.active
      and (coalesce(available_slots_at.for_staff, false) or ty.public)
  ),
  candidates as (
    select c.cs,
           c.cs + pg_catalog.make_interval(mins => t.duration_minutes) as ce,
           t.capacity_units as units
    from s
    cross join t
    cross join pg_catalog.generate_series(0, 1440 - s.intake_slot_minutes, s.intake_slot_minutes) as g(m)
    cross join lateral (
      select (available_slots_at.day + pg_catalog.make_interval(mins => g.m))
               at time zone private.shop_timezone() as cs
    ) c
    where available_slots_at.day is not null
      and available_slots_at.as_of is not null
      and (coalesce(available_slots_at.for_staff, false)
           or available_slots_at.day <= private.shop_day(available_slots_at.as_of) + s.booking_horizon_days)
  )
  select c.cs, c.ce, r.remaining
  from candidates c
  cross join s
  cross join lateral (
    select min(
             private.capacity_for_window(w.window_start, w.window_end)
             - coalesce((
                 select sum(a.capacity_units)
                 from public.appointments a
                 where a.status not in ('cancelled', 'no_show')
                   and a.starts_at < w.window_end
                   and a.ends_at > w.window_start
               ), 0)
           )::integer as remaining
    from private.appointment_windows(c.cs, c.ce) w
  ) r
  where case
          when coalesce(available_slots_at.for_staff, false) then c.ce > available_slots_at.as_of
          else c.cs >= available_slots_at.as_of + pg_catalog.make_interval(mins => s.booking_min_notice_minutes)
               and c.cs <= available_slots_at.as_of + pg_catalog.make_interval(days => s.booking_horizon_days)
        end
    and private.appointment_slot_problem(c.cs, c.ce, c.units, null) is null
  order by c.cs;
$$;

-- ---------------------------------------------------------------------------
-- Booking (staff and customers share this core; D37, D38).
-- ---------------------------------------------------------------------------
create function private.book_appointment_core(
  appointment_id uuid,
  customer_id uuid,
  appointment_type_id uuid,
  starts_at timestamptz,
  bike_id uuid,
  customer_note text,
  internal_note text,
  source public.appointment_source
)
returns public.appointments
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  settings public.shop_settings;
  local_day date;
  existing public.appointments;
  appt_type public.appointment_types;
  new_ends timestamptz;
  customer_archived_at timestamptz;
  bike_owner uuid;
  bike_archived_at timestamptz;
  active_count integer;
  problem text;
  result public.appointments;
  failed_constraint text;
begin
  -- (1)
  if book_appointment_core.appointment_id is null or book_appointment_core.customer_id is null
     or book_appointment_core.appointment_type_id is null or book_appointment_core.starts_at is null
     or book_appointment_core.source is null then
    raise exception 'appointment_id, customer_id, appointment_type_id and starts_at are required'
      using errcode = '22004';
  end if;

  -- (2) lock order (a)
  select s.* into settings from public.shop_settings s where s.id = 1 for share;
  -- (3)
  local_day := private.shop_day(book_appointment_core.starts_at);
  -- (4) lock order (b): customer self-booking only
  if book_appointment_core.source = 'customer' then
    perform private.appointment_lock_customer(book_appointment_core.customer_id);
  end if;
  -- (5) lock order (c)
  perform private.appointment_lock_day(local_day);

  -- (6) replay, before anything that can change over time
  select a.* into existing from public.appointments a where a.id = book_appointment_core.appointment_id;
  if existing.id is not null then
    if existing.customer_id = book_appointment_core.customer_id
       and existing.appointment_type_id = book_appointment_core.appointment_type_id
       and existing.starts_at = book_appointment_core.starts_at then
      return existing;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'appointment_conflict',
      detail = 'Another booking already uses this id; start the booking again.';
  end if;

  -- (7) the type
  select t.* into appt_type from public.appointment_types t where t.id = book_appointment_core.appointment_type_id;
  if appt_type.id is null then
    raise exception 'appointment type % not found', book_appointment_core.appointment_type_id using errcode = 'P0002';
  end if;
  if not appt_type.active or (book_appointment_core.source = 'customer' and not appt_type.public) then
    raise exception using
      errcode = 'P0001',
      message = 'appointment_type_unavailable',
      detail = 'That appointment type is not available for booking.';
  end if;
  new_ends := book_appointment_core.starts_at + pg_catalog.make_interval(mins => appt_type.duration_minutes);

  -- (8) customer and bike
  select c.archived_at into customer_archived_at from public.customers c where c.id = book_appointment_core.customer_id;
  if not found then
    raise exception 'customer % not found', book_appointment_core.customer_id using errcode = 'P0002';
  end if;
  if customer_archived_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'customer_archived',
      detail = 'That customer is archived; unarchive them first.';
  end if;
  if book_appointment_core.bike_id is not null then
    select b.customer_id, b.archived_at into bike_owner, bike_archived_at
    from public.bikes b where b.id = book_appointment_core.bike_id;
    if book_appointment_core.source = 'customer' then
      -- Customers learn nothing about bikes that are not theirs: an unknown
      -- bike and someone else's read the same.
      if not found or bike_owner is distinct from book_appointment_core.customer_id then
        raise exception using
          errcode = 'P0001',
          message = 'appointment_bike_not_owned',
          detail = 'Pick one of your own bikes.';
      end if;
      if bike_archived_at is not null then
        raise exception using
          errcode = 'P0001',
          message = 'appointment_bike_archived',
          detail = 'That bike is archived; pick another.';
      end if;
    else
      if not found then
        raise exception 'bike % not found', book_appointment_core.bike_id using errcode = 'P0002';
      end if;
      if bike_archived_at is not null then
        raise exception using
          errcode = 'P0001',
          message = 'appointment_bike_archived',
          detail = 'That bike is archived; unarchive it or pick another.';
      end if;
      if bike_owner is distinct from book_appointment_core.customer_id then
        raise exception using
          errcode = 'P0001',
          message = 'appointment_bike_not_owned',
          detail = 'That bike belongs to someone else; transfer it first or pick another.';
      end if;
    end if;
  end if;

  -- (9) time rules (D37)
  if book_appointment_core.source = 'staff' then
    if new_ends <= pg_catalog.now() then
      raise exception using
        errcode = 'P0001',
        message = 'appointment_in_past',
        detail = 'That appointment would already be over.';
    end if;
  else
    if book_appointment_core.starts_at
       < pg_catalog.now() + pg_catalog.make_interval(mins => settings.booking_min_notice_minutes) then
      raise exception using
        errcode = 'P0001',
        message = 'appointment_too_soon',
        detail = pg_catalog.format('Online bookings start at least %s minutes ahead.', settings.booking_min_notice_minutes);
    end if;
    if book_appointment_core.starts_at
       > pg_catalog.now() + pg_catalog.make_interval(days => settings.booking_horizon_days) then
      raise exception using
        errcode = 'P0001',
        message = 'appointment_too_far_ahead',
        detail = pg_catalog.format('Online bookings are at most %s days ahead.', settings.booking_horizon_days);
    end if;
    -- Both locks are held: concurrent bookings of this customer wait here.
    select count(*)::integer into active_count
    from public.appointments a
    where a.customer_id = book_appointment_core.customer_id
      and a.source = 'customer'
      and a.status in ('booked', 'confirmed')
      and a.starts_at > pg_catalog.now();
    if active_count >= settings.customer_max_active_bookings then
      raise exception using
        errcode = 'P0001',
        message = 'appointment_customer_limit',
        detail = pg_catalog.format('At most %s upcoming online bookings at a time.', settings.customer_max_active_bookings);
    end if;
  end if;

  -- (10) hours, closures, capacity (D38, D2)
  problem := private.appointment_slot_problem(book_appointment_core.starts_at, new_ends, appt_type.capacity_units, null);
  if problem is not null then
    raise exception using
      errcode = 'P0001',
      message = problem,
      detail = case problem
        when 'appointment_slot_misaligned' then 'Bookings start on the shop''s slot grid.'
        when 'appointment_outside_hours' then 'The shop is not open for the whole appointment.'
        when 'appointment_closed' then 'The shop is closed for some of that time.'
        else 'That time is already fully booked.'
      end;
  end if;

  -- (11)
  begin
    insert into public.appointments as a
      (id, customer_id, bike_id, appointment_type_id, starts_at, ends_at, capacity_units, status, source,
       customer_note, internal_note, created_by_user_id, created_by_staff_id)
    values
      (book_appointment_core.appointment_id, book_appointment_core.customer_id, book_appointment_core.bike_id,
       book_appointment_core.appointment_type_id, book_appointment_core.starts_at, new_ends,
       appt_type.capacity_units, 'booked', book_appointment_core.source,
       book_appointment_core.customer_note, book_appointment_core.internal_note,
       auth.uid(), private.current_staff_id())
    returning a.* into result;
  exception when unique_violation then
    get stacked diagnostics failed_constraint = constraint_name;
    if failed_constraint is distinct from 'appointments_pkey' then
      raise;
    end if;
    select a.* into existing from public.appointments a where a.id = book_appointment_core.appointment_id;
    if existing.customer_id = book_appointment_core.customer_id
       and existing.appointment_type_id = book_appointment_core.appointment_type_id
       and existing.starts_at = book_appointment_core.starts_at then
      return existing;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'appointment_conflict',
      detail = 'Another booking already uses this id; start the booking again.';
  end;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff RPCs (active staff; D37)
-- ---------------------------------------------------------------------------

-- Books for a customer. Exempt from notice, horizon, the customer limit and
-- the public flag, never from hours, closures or capacity; an appointment
-- that would already be over is refused (appointment_in_past).
create function public.book_appointment(
  appointment_id uuid,
  customer_id uuid,
  appointment_type_id uuid,
  starts_at timestamptz,
  bike_id uuid default null,
  customer_note text default null,
  internal_note text default null
)
returns public.appointments
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.require_staff();
  return private.book_appointment_core(
    book_appointment.appointment_id, book_appointment.customer_id, book_appointment.appointment_type_id,
    book_appointment.starts_at, book_appointment.bike_id, book_appointment.customer_note,
    book_appointment.internal_note, 'staff');
end;
$$;

comment on function public.book_appointment(uuid, uuid, uuid, timestamptz, uuid, text, text) is
  'Active staff: book an appointment for a customer under a client-made id (replay-safe); hours, closures and capacity always apply (D37, D38).';

-- Everyone (anonymous visitors included, D37): the bookable starts of one
-- shop-local date for one type. Staff see every active type and the free
-- units; everyone else sees active public types only, within the notice
-- and horizon, and remaining_units NULL.
create function public.available_slots(day date, appointment_type_id uuid)
returns table (slot_start timestamptz, slot_end timestamptz, remaining_units integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  staff boolean := private.is_staff();
begin
  if available_slots.day is null or available_slots.appointment_type_id is null then
    raise exception 'day and appointment_type_id are required' using errcode = '22004';
  end if;
  return query
    select x.slot_start, x.slot_end, case when staff then x.remaining_units end
    from private.available_slots_at(available_slots.day, available_slots.appointment_type_id, pg_catalog.now(), staff) x;
end;
$$;

comment on function public.available_slots(date, uuid) is
  'Everyone: bookable starts of one shop day for one type (D37, D38). remaining_units for staff only.';

-- Staff mark confirmed, arrived or no-show (D39). checked_in goes through
-- check-in, cancelled through cancel_appointment, completed follows the
-- work order (D36). Same status: the row unchanged, no event.
create function public.mark_appointment_status(
  appointment_id uuid,
  status public.appointment_status,
  reason text default null
)
returns public.appointments
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  appt public.appointments;
  result public.appointments;
begin
  perform private.require_staff();
  if mark_appointment_status.appointment_id is null or mark_appointment_status.status is null then
    raise exception 'appointment_id and status are required' using errcode = '22004';
  end if;

  perform 1 from public.shop_settings s where s.id = 1 for share;
  select a.* into appt from public.appointments a where a.id = mark_appointment_status.appointment_id for update;
  if appt.id is null then
    raise exception 'appointment % not found', mark_appointment_status.appointment_id using errcode = 'P0002';
  end if;

  if mark_appointment_status.status = 'checked_in' then
    raise exception using
      errcode = 'P0001',
      message = 'appointment_use_check_in',
      detail = 'Check-in creates or links the work order; use check-in.';
  end if;
  if mark_appointment_status.status = 'cancelled' then
    raise exception using
      errcode = 'P0001',
      message = 'appointment_use_cancel',
      detail = 'Cancel with cancel_appointment, which needs a reason.';
  end if;
  if mark_appointment_status.status in ('booked', 'completed') then
    raise exception using
      errcode = 'P0001',
      message = 'appointment_transition_invalid',
      detail = 'An appointment is never set back to booked, and completes with its work order.';
  end if;

  if appt.status = mark_appointment_status.status then
    return appt;
  end if;
  if not private.appointment_transition_allowed(appt.status, mark_appointment_status.status) then
    raise exception using
      errcode = 'P0001',
      message = 'appointment_transition_invalid',
      detail = pg_catalog.format('An appointment cannot move from %s to %s.', appt.status, mark_appointment_status.status);
  end if;
  if mark_appointment_status.status = 'no_show' and pg_catalog.now() < appt.starts_at then
    raise exception using
      errcode = 'P0001',
      message = 'appointment_not_started',
      detail = 'An appointment is a no-show only after it has started.';
  end if;

  if appt.status = 'no_show' and mark_appointment_status.status = 'arrived' then
    -- D39: a late arrival is reinstated only on its own shop-local date,
    -- and only if its place is still free. Other slot rules are not
    -- re-checked: settings changes never cancel a booking (D38).
    if private.shop_today() <> private.shop_day(appt.starts_at) then
      raise exception using
        errcode = 'P0001',
        message = 'appointment_transition_invalid',
        detail = 'A no-show can be marked arrived only on the day of the appointment; rebook instead.';
    end if;
    perform private.appointment_lock_day(private.shop_day(appt.starts_at));
    if private.appointment_capacity_exceeded(appt.starts_at, appt.ends_at, appt.capacity_units, appt.id) then
      raise exception using
        errcode = 'P0001',
        message = 'appointment_capacity_exceeded',
        detail = 'Its place has been booked since; book another time instead.';
    end if;
  end if;

  perform private.set_change_reason(mark_appointment_status.reason);
  update public.appointments a
  set status = mark_appointment_status.status
  where a.id = appt.id
  returning a.* into result;
  perform private.set_change_reason(null);
  return result;
end;
$$;

comment on function public.mark_appointment_status(uuid, public.appointment_status, text) is
  'Active staff: mark an appointment confirmed, arrived or no_show (D39); same status is a no-op.';

-- Staff cancel a booked, confirmed or arrived appointment, at any time,
-- with a reason (cancelled_via = staff). Already cancelled: returned as it
-- is, no event.
create function public.cancel_appointment(appointment_id uuid, reason text)
returns public.appointments
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  cleaned text := nullif(pg_catalog.btrim(coalesce(cancel_appointment.reason, '')), '');
  appt public.appointments;
  result public.appointments;
begin
  perform private.require_staff();
  if cleaned is null then
    raise exception using
      errcode = 'P0001',
      message = 'reason_required',
      detail = 'Say why the appointment is cancelled.';
  end if;
  if pg_catalog.char_length(cleaned) > 500 then
    raise exception using
      errcode = 'P0001',
      message = 'reason_too_long',
      detail = 'Keep the reason under 500 characters.';
  end if;
  if cancel_appointment.appointment_id is null then
    raise exception 'appointment_id is required' using errcode = '22004';
  end if;

  select a.* into appt from public.appointments a where a.id = cancel_appointment.appointment_id for update;
  if appt.id is null then
    raise exception 'appointment % not found', cancel_appointment.appointment_id using errcode = 'P0002';
  end if;
  if appt.status = 'cancelled' then
    return appt;
  end if;
  if appt.status not in ('booked', 'confirmed', 'arrived') then
    raise exception using
      errcode = 'P0001',
      message = 'appointment_transition_invalid',
      detail = pg_catalog.format('A %s appointment cannot be cancelled.', appt.status);
  end if;

  perform private.set_change_reason(cleaned);
  update public.appointments a
  set status = 'cancelled', cancelled_via = 'staff'
  where a.id = appt.id
  returning a.* into result;
  perform private.set_change_reason(null);
  return result;
end;
$$;

comment on function public.cancel_appointment(uuid, text) is
  'Active staff: cancel a booked, confirmed or arrived appointment with a reason (cancelled_via = staff); replay returns it.';

-- Staff change the bike and notes. Null keeps a field; '' clears a note;
-- clear_bike removes the bike. The bike changes only before check-in and
-- must be the customer's and not archived (trigger); the customer's note
-- only while the appointment is not cancelled, completed or a no-show;
-- the internal note always. Nothing changed: no update, no event.
create function public.update_appointment(
  appointment_id uuid,
  bike_id uuid default null,
  clear_bike boolean default false,
  customer_note text default null,
  internal_note text default null
)
returns public.appointments
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  appt public.appointments;
  next_bike uuid;
  next_customer_note text;
  next_internal_note text;
  result public.appointments;
begin
  perform private.require_staff();
  if update_appointment.appointment_id is null then
    raise exception 'appointment_id is required' using errcode = '22004';
  end if;

  select a.* into appt from public.appointments a where a.id = update_appointment.appointment_id for update;
  if appt.id is null then
    raise exception 'appointment % not found', update_appointment.appointment_id using errcode = 'P0002';
  end if;

  next_bike := case
    when coalesce(update_appointment.clear_bike, false) then null
    when update_appointment.bike_id is not null then update_appointment.bike_id
    else appt.bike_id
  end;
  next_customer_note := case
    when update_appointment.customer_note is null then appt.customer_note
    else nullif(pg_catalog.btrim(update_appointment.customer_note), '')
  end;
  next_internal_note := case
    when update_appointment.internal_note is null then appt.internal_note
    else nullif(pg_catalog.btrim(update_appointment.internal_note), '')
  end;

  if next_bike is not distinct from appt.bike_id
     and next_customer_note is not distinct from appt.customer_note
     and next_internal_note is not distinct from appt.internal_note then
    return appt;
  end if;

  if next_customer_note is distinct from appt.customer_note
     and appt.status in ('cancelled', 'completed', 'no_show') then
    raise exception using
      errcode = 'P0001',
      message = 'appointment_immutable',
      detail = 'The customer''s note is kept as it was once the appointment is over.';
  end if;

  update public.appointments a
  set bike_id = next_bike,
      customer_note = next_customer_note,
      internal_note = next_internal_note
  where a.id = appt.id
  returning a.* into result;
  return result;
end;
$$;

comment on function public.update_appointment(uuid, uuid, boolean, text, text) is
  'Active staff: change an appointment''s bike (before check-in) and notes; null keeps, '''' clears; no-op when unchanged.';

-- ---------------------------------------------------------------------------
-- Privileges and RLS: staff read; writes only through the RPCs.
-- ---------------------------------------------------------------------------
revoke all on function
  private.appointment_events_append_only(),
  private.record_appointment_event(uuid, public.appointment_event_type, public.appointment_status,
                                   public.appointment_status, text, jsonb, timestamptz),
  private.appointment_transition_allowed(public.appointment_status, public.appointment_status),
  private.appointments_enforce_rules(),
  private.appointments_record_history(),
  private.appointment_lock_customer(uuid),
  private.appointment_lock_day(date),
  private.appointment_windows(timestamptz, timestamptz),
  private.appointment_capacity_exceeded(timestamptz, timestamptz, integer, uuid),
  private.appointment_slot_problem(timestamptz, timestamptz, integer, uuid),
  private.available_slots_at(date, uuid, timestamptz, boolean),
  private.book_appointment_core(uuid, uuid, uuid, timestamptz, uuid, text, text, public.appointment_source)
from public, anon, authenticated, service_role;

revoke all on function
  public.book_appointment(uuid, uuid, uuid, timestamptz, uuid, text, text),
  public.available_slots(date, uuid),
  public.mark_appointment_status(uuid, public.appointment_status, text),
  public.cancel_appointment(uuid, text),
  public.update_appointment(uuid, uuid, boolean, text, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.book_appointment(uuid, uuid, uuid, timestamptz, uuid, text, text),
  public.mark_appointment_status(uuid, public.appointment_status, text),
  public.cancel_appointment(uuid, text),
  public.update_appointment(uuid, uuid, boolean, text, text)
to authenticated;

-- D37: times are readable without signing in. Phase 11 must not revoke anon.
grant execute on function public.available_slots(date, uuid) to anon, authenticated;

alter table public.appointments enable row level security;
alter table public.appointment_events enable row level security;

revoke all on table public.appointments, public.appointment_events
  from public, anon, authenticated, service_role;
revoke all on sequence public.appointment_events_id_seq from public, anon, authenticated, service_role;

grant select on table public.appointments, public.appointment_events to authenticated, service_role;

create policy appointments_select_staff on public.appointments
  for select to authenticated using ((select private.is_staff()));
create policy appointment_events_select_staff on public.appointment_events
  for select to authenticated using ((select private.is_staff()));
