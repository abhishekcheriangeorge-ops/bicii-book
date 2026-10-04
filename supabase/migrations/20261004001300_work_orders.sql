-- Workshop work orders, staff assignments and the job timeline (SPEC §2, §7,
-- §7.1, §7.2, §7.3, §8, §23 "Completed_at and collected_at represent
-- different events"; DATA-MODEL.md §4, §15, §16; PLAN D9, D15, D16, D18,
-- D19, D22).
--
-- Rules encoded here, for every writer (RPC, seed, SQL editor):
--   * A job number (J-######) is assigned by the server on insert from
--     private.next_short_id('J') and never changes (D9).
--   * A job is checked in as `received`. Its customer must exist and not be
--     archived, its bike too, and the customer must be the bike's current
--     owner or the bike must have no owner (a shop bike) (D18).
--   * Status changes follow the transition table in
--     private.work_order_transition_rule (D15, D16): completed only from
--     in_progress or paused; collected only from completed or
--     ready_for_collection; collected and cancelled are final; nothing
--     returns to received; cancelling and reopening need a reason. The
--     trigger stamps the business timestamps from status_changed_at:
--     started_at on the first in_progress (kept for good), completed_at,
--     ready_for_collection_at, collected_at, cancelled_at with the reason.
--     Reopening (completed or ready_for_collection -> in_progress) clears
--     completed_at and ready_for_collection_at (D15 DEVIATION, owner to
--     confirm before Phase 5). The stamps change only with a status change.
--   * One lead mechanic plus any number of additional staff per job, in
--     work_order_assignments (history kept: rows are closed, never edited
--     or deleted). work_orders.lead_mechanic_id is kept equal to the active
--     lead by the assignments trigger and can be set to nothing else.
--   * work_order_events is the timeline, append-only and written by
--     triggers so no path skips it: checked_in, one event per status
--     change, details_changed, approval_flagged, assignment_changed,
--     photo_added/photo_removed; notes and diagnoses through
--     add_work_order_note; line events in the lines migration. Payloads
--     never contain cost, yield, rate or Cult Commons values: every staff
--     member reads the timeline, with or without view_costs.
--   * Photos on a job may be internal or customer, never public (D19).
--   * Customer access boundary: base tables are staff-only; customers see
--     their own jobs through customer-safe RPCs (step 2, D17).
--   * work_orders.appointment_id has no foreign key yet: Phase 2 adds it
--     together with check_in_appointment, built on private.create_work_order.

create type public.work_order_status as enum (
  'received',
  'diagnosing',
  'awaiting_customer',
  'awaiting_parts',
  'ready_to_start',
  'in_progress',
  'paused',
  'completed',
  'ready_for_collection',
  'collected',
  'cancelled'
);

create type public.assignment_role as enum ('lead', 'additional');

create type public.work_order_event_type as enum (
  'checked_in',
  'status_changed',
  'completed',
  'ready_for_collection',
  'collected',
  'cancelled',
  'reopened',
  'assignment_changed',
  'note_added',
  'diagnosis_added',
  'details_changed',
  'approval_flagged',
  'photo_added',
  'photo_removed',
  'line_added',
  'line_voided',
  'stock_consumed',
  'stock_reversed'
);

create type public.work_order_note_kind as enum ('note', 'diagnosis');

-- ---------------------------------------------------------------------------
-- The status machine (D15, D16). Mirrored by src/lib/workshop.ts
-- (transitionRule); a database test compares all 121 pairs.
-- ---------------------------------------------------------------------------

-- Open: lines may still change (before completion).
create function private.work_order_status_is_open(s public.work_order_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select s not in ('completed', 'ready_for_collection', 'collected', 'cancelled');
$$;

-- Closed: final; nothing about the job changes any more except its notes.
create function private.work_order_status_is_closed(s public.work_order_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select s in ('collected', 'cancelled');
$$;

-- 'allowed', 'reason_required' or null (not allowed). Same status -> null:
-- callers treat a same-status request as a replay before asking.
create function private.work_order_transition_rule(
  from_status public.work_order_status,
  to_status public.work_order_status
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when from_status is null or to_status is null or from_status = to_status then null
    when to_status = 'received' then null
    when from_status in ('collected', 'cancelled') then null
    when to_status = 'cancelled' then
      case when from_status in ('completed', 'ready_for_collection') then null else 'reason_required' end
    when from_status in ('received', 'diagnosing', 'awaiting_customer', 'awaiting_parts', 'ready_to_start') then
      case when to_status in ('diagnosing', 'awaiting_customer', 'awaiting_parts', 'ready_to_start', 'in_progress')
           then 'allowed' end
    when from_status = 'in_progress' then
      case when to_status in ('diagnosing', 'awaiting_customer', 'awaiting_parts', 'paused', 'completed')
           then 'allowed' end
    when from_status = 'paused' then
      case when to_status in ('diagnosing', 'awaiting_customer', 'awaiting_parts', 'in_progress', 'completed')
           then 'allowed' end
    when from_status = 'completed' then
      case when to_status in ('ready_for_collection', 'collected') then 'allowed'
           when to_status = 'in_progress' then 'reason_required' end
    when from_status = 'ready_for_collection' then
      case when to_status = 'collected' then 'allowed'
           when to_status = 'in_progress' then 'reason_required' end
  end;
$$;

-- ---------------------------------------------------------------------------
-- work_orders
-- ---------------------------------------------------------------------------
create table public.work_orders (
  id uuid primary key default gen_random_uuid(),
  -- Always assigned by work_orders_enforce_rules on insert (the '' default
  -- only makes the column optional; any value given is replaced).
  job_number text not null default '' unique,
  customer_id uuid not null references public.customers (id) on delete restrict,
  bike_id uuid not null references public.bikes (id) on delete restrict,
  -- Phase 2 adds: references public.appointments (id).
  appointment_id uuid null,
  -- Denormalised from the active lead assignment; set by the assignments
  -- trigger only.
  lead_mechanic_id uuid null references public.staff (id) on delete restrict,
  status public.work_order_status not null default 'received',
  requested_work text not null,
  -- The bike's condition on arrival.
  intake_notes text null,
  -- Staff only; never in a customer projection.
  internal_notes text null,
  completion_notes text null,
  -- Optional internal approval flag (SPEC §7.1); no customer workflow.
  approval_flag boolean not null default false,
  approval_note text null,
  checked_in_at timestamptz not null default clock_timestamp(),
  status_changed_at timestamptz not null default clock_timestamp(),
  started_at timestamptz null,
  completed_at timestamptz null,
  ready_for_collection_at timestamptz null,
  collected_at timestamptz null,
  cancelled_at timestamptz null,
  cancellation_reason text null,
  currency char(3) not null default 'SGD',
  -- Null only for rows created outside the app.
  created_by uuid null references public.staff (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_orders_job_number_format check (job_number ~ '^J-[0-9]{6}$'),
  constraint work_orders_requested_work_check check (
    pg_catalog.btrim(requested_work) <> '' and pg_catalog.char_length(requested_work) <= 2000
  ),
  constraint work_orders_intake_notes_check check (pg_catalog.char_length(intake_notes) <= 5000),
  constraint work_orders_internal_notes_check check (pg_catalog.char_length(internal_notes) <= 10000),
  constraint work_orders_completion_notes_check check (pg_catalog.char_length(completion_notes) <= 5000),
  constraint work_orders_approval_note_check check (pg_catalog.char_length(approval_note) <= 500),
  constraint work_orders_cancellation_reason_check check (pg_catalog.char_length(cancellation_reason) <= 500),
  constraint work_orders_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint work_orders_collected_stamp check ((status = 'collected') = (collected_at is not null)),
  constraint work_orders_cancelled_stamp check (
    (status = 'cancelled') = (cancelled_at is not null and cancellation_reason is not null)
  ),
  constraint work_orders_completed_stamp check (
    (status in ('completed', 'ready_for_collection', 'collected')) = (completed_at is not null)
  ),
  constraint work_orders_ready_after_completed check (
    ready_for_collection_at is null or completed_at is not null
  ),
  constraint work_orders_ready_stamp check (
    status <> 'ready_for_collection' or ready_for_collection_at is not null
  ),
  constraint work_orders_completed_after_started check (completed_at is null or started_at is not null),
  constraint work_orders_started_after_check_in check (started_at is null or started_at >= checked_in_at),
  constraint work_orders_completed_after_check_in check (completed_at is null or completed_at >= checked_in_at),
  -- SPEC §23: completion and collection are different events.
  constraint work_orders_collected_after_completed check (collected_at is null or collected_at > completed_at),
  constraint work_orders_status_changed_after_check_in check (status_changed_at >= checked_in_at)
);

create index work_orders_status_idx on public.work_orders (status);
create index work_orders_customer_id_idx on public.work_orders (customer_id, checked_in_at desc);
create index work_orders_bike_id_idx on public.work_orders (bike_id, checked_in_at desc);
create index work_orders_lead_mechanic_id_idx on public.work_orders (lead_mechanic_id);
create index work_orders_checked_in_at_idx on public.work_orders (checked_in_at);
create index work_orders_completed_at_idx on public.work_orders (completed_at);
create index work_orders_collected_at_idx on public.work_orders (collected_at);
create index work_orders_created_by_idx on public.work_orders (created_by);

comment on table public.work_orders is
  'Workshop jobs. Written only by the workshop RPCs; status rules, stamps and the timeline are enforced by triggers.';
comment on column public.work_orders.job_number is 'J-######, server-assigned from private.next_short_id(''J''); immutable.';
comment on column public.work_orders.appointment_id is 'Foreign key to appointments added in Phase 2.';
comment on column public.work_orders.lead_mechanic_id is
  'The active lead assignment''s staff member; maintained by the work_order_assignments trigger.';
comment on column public.work_orders.internal_notes is 'Staff only; never returned by a customer RPC.';
comment on column public.work_orders.completed_at is
  'Workshop revenue recognition date (D3). Cleared by a reopen and stamped again on the final completion (D15).';

create trigger work_orders_set_updated_at
  before update on public.work_orders
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- work_order_assignments
-- ---------------------------------------------------------------------------
create table public.work_order_assignments (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders (id) on delete restrict,
  staff_id uuid not null references public.staff (id) on delete restrict,
  role public.assignment_role not null,
  -- Null only for rows created outside the app.
  assigned_by uuid null references public.staff (id) on delete restrict,
  assigned_at timestamptz not null default clock_timestamp(),
  unassigned_at timestamptz null,
  unassigned_by uuid null references public.staff (id) on delete restrict,
  constraint work_order_assignments_unassigned_after_assigned check (
    unassigned_at is null or unassigned_at >= assigned_at
  )
);
create unique index work_order_assignments_active_staff_key
  on public.work_order_assignments (work_order_id, staff_id) where unassigned_at is null;
create unique index work_order_assignments_one_lead_key
  on public.work_order_assignments (work_order_id) where role = 'lead' and unassigned_at is null;
create index work_order_assignments_staff_id_idx
  on public.work_order_assignments (staff_id) where unassigned_at is null;
create index work_order_assignments_assigned_by_idx on public.work_order_assignments (assigned_by);
create index work_order_assignments_unassigned_by_idx on public.work_order_assignments (unassigned_by);

comment on table public.work_order_assignments is
  'Who works on a job: one active lead, any number of additional staff. Rows are closed (unassigned_at), never edited or deleted.';

-- ---------------------------------------------------------------------------
-- work_order_events
-- ---------------------------------------------------------------------------
create table public.work_order_events (
  id bigint generated always as identity primary key,
  work_order_id uuid not null references public.work_orders (id) on delete restrict,
  event_type public.work_order_event_type not null,
  -- Null when the change was made outside the app.
  actor_staff_id uuid null references public.staff (id) on delete restrict,
  -- auth.uid() of the caller; no foreign key (logins may go).
  actor_user_id uuid null,
  -- Never cost, yield, rate or Cult Commons values.
  payload jsonb not null default '{}'::jsonb,
  correlation_id text null,
  created_at timestamptz not null default clock_timestamp(),
  constraint work_order_events_payload_object check (pg_catalog.jsonb_typeof(payload) = 'object')
);
create index work_order_events_work_order_idx on public.work_order_events (work_order_id, created_at, id);
create index work_order_events_type_idx on public.work_order_events (event_type, created_at);
create index work_order_events_actor_staff_id_idx on public.work_order_events (actor_staff_id);

comment on table public.work_order_events is
  'Append-only job timeline, written by triggers and add_work_order_note. Payloads never carry costs, yield or Cult Commons values.';

create function private.work_order_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'work_order_history_append_only',
    detail = 'A job''s timeline cannot be changed or deleted.';
end;
$$;

create trigger work_order_events_append_only
  before update or delete on public.work_order_events
  for each row execute function private.work_order_events_append_only();

-- Appends one timeline event with the caller as actor and the request's
-- correlation ID. `at` is the business timestamp of what happened (default
-- now). Phase 4 reuses it for stock events.
create function private.record_work_order_event(
  work_order_id uuid,
  event_type public.work_order_event_type,
  payload jsonb,
  "at" timestamptz default null
)
returns public.work_order_events
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result public.work_order_events;
begin
  insert into public.work_order_events as e
    (work_order_id, event_type, actor_staff_id, actor_user_id, payload, correlation_id, created_at)
  values (
    record_work_order_event.work_order_id,
    record_work_order_event.event_type,
    private.current_staff_id(),
    auth.uid(),
    coalesce(record_work_order_event.payload, '{}'::jsonb),
    private.current_correlation_id(),
    coalesce(record_work_order_event."at", pg_catalog.clock_timestamp())
  )
  returning e.* into result;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- work_orders: rules every writer obeys.
-- ---------------------------------------------------------------------------
create function private.work_orders_enforce_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule text;
  owner_id uuid;
  bike_archived timestamptz;
  customer_archived timestamptz;
  active_lead uuid;
begin
  new.requested_work := pg_catalog.btrim(new.requested_work);
  new.intake_notes := nullif(pg_catalog.btrim(new.intake_notes), '');
  new.internal_notes := nullif(pg_catalog.btrim(new.internal_notes), '');
  new.completion_notes := nullif(pg_catalog.btrim(new.completion_notes), '');
  new.approval_note := nullif(pg_catalog.btrim(new.approval_note), '');

  if tg_op = 'INSERT' then
    -- Server-assigned, whatever the caller sent (D9).
    new.job_number := private.next_short_id('J');

    if new.status is distinct from 'received'
       or new.lead_mechanic_id is not null
       or new.started_at is not null or new.completed_at is not null
       or new.ready_for_collection_at is not null or new.collected_at is not null
       or new.cancelled_at is not null or new.cancellation_reason is not null then
      raise exception using
        errcode = 'P0001',
        message = 'work_order_transition_invalid',
        detail = 'A job is checked in as received, without a lead or any later timestamps.';
    end if;
    new.status_changed_at := new.checked_in_at;

    select c.archived_at into customer_archived from public.customers c where c.id = new.customer_id;
    if not found then
      raise exception 'customer % not found', new.customer_id using errcode = 'P0002';
    end if;
    if customer_archived is not null then
      raise exception using
        errcode = 'P0001',
        message = 'work_order_customer_archived',
        detail = 'That customer is archived; unarchive them before checking in a bike.';
    end if;

    select b.customer_id, b.archived_at into owner_id, bike_archived from public.bikes b where b.id = new.bike_id;
    if not found then
      raise exception 'bike % not found', new.bike_id using errcode = 'P0002';
    end if;
    if bike_archived is not null then
      raise exception using
        errcode = 'P0001',
        message = 'work_order_bike_archived',
        detail = 'That bike is archived; unarchive it before checking it in.';
    end if;
    -- D18: the job's customer owns the bike, or nobody does (a shop bike).
    if owner_id is not null and owner_id <> new.customer_id then
      raise exception using
        errcode = 'P0001',
        message = 'bike_owner_mismatch',
        detail = 'That bike belongs to another customer; transfer it to this customer first.';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.id is distinct from old.id
     or new.job_number is distinct from old.job_number
     or new.customer_id is distinct from old.customer_id
     or new.bike_id is distinct from old.bike_id
     or new.appointment_id is distinct from old.appointment_id
     or new.currency is distinct from old.currency
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.checked_in_at is distinct from old.checked_in_at then
    raise exception using
      errcode = 'P0001',
      message = 'work_order_immutable',
      detail = 'A job keeps its number, customer, bike, appointment and check-in time.';
  end if;

  if new.lead_mechanic_id is distinct from old.lead_mechanic_id then
    select a.staff_id into active_lead
    from public.work_order_assignments a
    where a.work_order_id = new.id and a.role = 'lead' and a.unassigned_at is null;
    if new.lead_mechanic_id is distinct from active_lead then
      raise exception using
        errcode = 'P0001',
        message = 'work_order_immutable',
        detail = 'The lead mechanic changes only through the job''s assignments.';
    end if;
  end if;

  -- The stamps are derived from status changes; nobody writes them directly.
  if new.started_at is distinct from old.started_at
     or new.completed_at is distinct from old.completed_at
     or new.ready_for_collection_at is distinct from old.ready_for_collection_at
     or new.collected_at is distinct from old.collected_at
     or new.cancelled_at is distinct from old.cancelled_at
     or new.cancellation_reason is distinct from old.cancellation_reason
     or (new.status = old.status and new.status_changed_at is distinct from old.status_changed_at) then
    raise exception using
      errcode = 'P0001',
      message = 'work_order_immutable',
      detail = 'A job''s timestamps change only with its status.';
  end if;

  if new.status = old.status then
    return new;
  end if;

  rule := private.work_order_transition_rule(old.status, new.status);
  if rule is null then
    raise exception using
      errcode = 'P0001',
      message = 'work_order_transition_invalid',
      detail = pg_catalog.format('A job cannot move from %s to %s.', old.status, new.status);
  end if;
  if rule = 'reason_required' and private.change_reason() is null then
    raise exception using
      errcode = 'P0001',
      message = 'reason_required',
      detail = pg_catalog.format('Say why the job is moving from %s to %s.', old.status, new.status);
  end if;

  if new.status_changed_at = old.status_changed_at then
    new.status_changed_at := pg_catalog.clock_timestamp();
  elsif new.status_changed_at < old.status_changed_at then
    raise exception 'status_changed_at cannot go back in time' using errcode = '22023';
  end if;

  if new.status = 'in_progress' and new.started_at is null then
    new.started_at := new.status_changed_at;
  end if;
  if new.status = 'in_progress' and old.status in ('completed', 'ready_for_collection') then
    -- Reopen (D15 DEVIATION, owner to confirm before Phase 5): the completion
    -- stamps are cleared and stamped again on the final completion, so D3
    -- recognises the job then. started_at is kept; the timeline keeps the
    -- earlier `completed` event. Phase 4 replaces this function (create or
    -- replace) to handle unique units per D6: block the reopen while a
    -- unique-unit line is sold, or move the unit back to held_for_customer.
    new.completed_at := null;
    new.ready_for_collection_at := null;
  end if;
  case new.status
    when 'completed' then new.completed_at := new.status_changed_at;
    when 'ready_for_collection' then new.ready_for_collection_at := new.status_changed_at;
    when 'collected' then new.collected_at := new.status_changed_at;
    when 'cancelled' then
      new.cancelled_at := new.status_changed_at;
      new.cancellation_reason := private.change_reason();
    else null;
  end case;
  return new;
end;
$$;

create trigger work_orders_enforce_rules
  before insert or update on public.work_orders
  for each row execute function private.work_orders_enforce_rules();

-- The timeline for work_orders writes (one event per action).
create function private.work_orders_record_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  kind public.work_order_event_type;
  payload jsonb;
  changes jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    perform private.record_work_order_event(
      new.id, 'checked_in',
      pg_catalog.jsonb_build_object(
        'job_number', new.job_number,
        'customer_id', new.customer_id,
        'bike_id', new.bike_id,
        'requested_work', new.requested_work
      ),
      new.checked_in_at
    );
    return null;
  end if;

  if new.status is distinct from old.status then
    kind := case
      when new.status = 'completed' then 'completed'
      when new.status = 'ready_for_collection' then 'ready_for_collection'
      when new.status = 'collected' then 'collected'
      when new.status = 'cancelled' then 'cancelled'
      when new.status = 'in_progress' and old.status in ('completed', 'ready_for_collection') then 'reopened'
      else 'status_changed'
    end::public.work_order_event_type;
    payload := pg_catalog.jsonb_build_object(
      'from', old.status, 'to', new.status, 'note', private.change_reason()
    );
    if old.started_at is null and new.started_at is not null then
      payload := payload || pg_catalog.jsonb_build_object('started', true);
    end if;
    perform private.record_work_order_event(new.id, kind, payload, new.status_changed_at);
  end if;

  if new.requested_work is distinct from old.requested_work then
    changes := changes || pg_catalog.jsonb_build_object('requested_work',
      pg_catalog.jsonb_build_object('from', old.requested_work, 'to', new.requested_work));
  end if;
  if new.intake_notes is distinct from old.intake_notes then
    changes := changes || pg_catalog.jsonb_build_object('intake_notes',
      pg_catalog.jsonb_build_object('from', old.intake_notes, 'to', new.intake_notes));
  end if;
  if new.internal_notes is distinct from old.internal_notes then
    changes := changes || pg_catalog.jsonb_build_object('internal_notes',
      pg_catalog.jsonb_build_object('from', old.internal_notes, 'to', new.internal_notes));
  end if;
  if new.completion_notes is distinct from old.completion_notes then
    changes := changes || pg_catalog.jsonb_build_object('completion_notes',
      pg_catalog.jsonb_build_object('from', old.completion_notes, 'to', new.completion_notes));
  end if;
  if changes <> '{}'::jsonb then
    perform private.record_work_order_event(new.id, 'details_changed', changes);
  end if;

  if new.approval_flag is distinct from old.approval_flag
     or new.approval_note is distinct from old.approval_note then
    perform private.record_work_order_event(
      new.id, 'approval_flagged',
      pg_catalog.jsonb_build_object('flagged', new.approval_flag, 'note', new.approval_note)
    );
  end if;
  return null;
end;
$$;

create trigger work_orders_record_history
  after insert or update on public.work_orders
  for each row execute function private.work_orders_record_history();

-- ---------------------------------------------------------------------------
-- work_order_assignments: rules and history.
-- ---------------------------------------------------------------------------
create function private.work_order_assignments_enforce_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.staff s where s.id = new.staff_id and s.active) then
      if exists (select 1 from public.staff s where s.id = new.staff_id) then
        raise exception using
          errcode = 'P0001',
          message = 'staff_inactive',
          detail = 'Only active staff can be assigned to a job.';
      end if;
      raise exception 'staff % not found', new.staff_id using errcode = 'P0002';
    end if;
    if exists (
      select 1 from public.work_orders w
      where w.id = new.work_order_id and private.work_order_status_is_closed(w.status)
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'work_order_closed',
        detail = 'This job is collected or cancelled and can no longer change.';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE'
     or old.unassigned_at is not null
     or new.unassigned_at is null
     or old.unassigned_by is not null
     or new.id is distinct from old.id
     or new.work_order_id is distinct from old.work_order_id
     or new.staff_id is distinct from old.staff_id
     or new.role is distinct from old.role
     or new.assigned_by is distinct from old.assigned_by
     or new.assigned_at is distinct from old.assigned_at then
    raise exception using
      errcode = 'P0001',
      message = 'assignment_immutable',
      detail = 'An assignment is only ever closed; assign again instead.';
  end if;
  return new;
end;
$$;

create trigger work_order_assignments_enforce_rules
  before insert or update or delete on public.work_order_assignments
  for each row execute function private.work_order_assignments_enforce_rules();

create function private.work_order_assignments_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_lead uuid;
begin
  select a.staff_id into active_lead
  from public.work_order_assignments a
  where a.work_order_id = new.work_order_id and a.role = 'lead' and a.unassigned_at is null;

  update public.work_orders w
  set lead_mechanic_id = active_lead
  where w.id = new.work_order_id and w.lead_mechanic_id is distinct from active_lead;

  if tg_op = 'INSERT' then
    perform private.record_work_order_event(
      new.work_order_id, 'assignment_changed',
      pg_catalog.jsonb_build_object('action', 'assigned', 'staff_id', new.staff_id, 'role', new.role),
      new.assigned_at
    );
  elsif old.unassigned_at is null and new.unassigned_at is not null then
    perform private.record_work_order_event(
      new.work_order_id, 'assignment_changed',
      pg_catalog.jsonb_build_object('action', 'unassigned', 'staff_id', new.staff_id, 'role', new.role),
      new.unassigned_at
    );
  end if;
  return null;
end;
$$;

create trigger work_order_assignments_sync
  after insert or update on public.work_order_assignments
  for each row execute function private.work_order_assignments_sync();

-- ---------------------------------------------------------------------------
-- Attachments on jobs (Phase 1 extension point) and D19.
-- ---------------------------------------------------------------------------
create or replace function private.attachment_entity_exists(entity_type public.attachment_entity, entity_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  case attachment_entity_exists.entity_type
    when 'customer' then
      return exists (select 1 from public.customers c where c.id = attachment_entity_exists.entity_id);
    when 'bike' then
      return exists (select 1 from public.bikes b where b.id = attachment_entity_exists.entity_id);
    when 'work_order' then
      return exists (select 1 from public.work_orders w where w.id = attachment_entity_exists.entity_id);
    else
      -- product, inventory_unit, consignment_item: their phases add a branch.
      return null;
  end case;
end;
$$;

-- D19: photos on a job may be internal or customer, never public (mirrors
-- D13 for customer records). A business error for record_attachment and
-- set_attachment_visibility; the check constraint below is the backstop.
create function private.attachments_work_order_never_public()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.entity_type = 'work_order' and new.visibility = 'public' then
    raise exception using
      errcode = 'P0001',
      message = 'attachment_work_order_never_public',
      detail = 'Photos on a job can''t be made public.';
  end if;
  return new;
end;
$$;

create trigger attachments_work_order_never_public
  before insert or update of visibility on public.attachments
  for each row execute function private.attachments_work_order_never_public();

alter table public.attachments
  add constraint attachments_work_order_never_public check (
    not (entity_type = 'work_order' and visibility = 'public')
  );

-- Photos added to or removed from a job appear on its timeline.
create function private.attachments_work_order_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.entity_type = 'work_order' then
      perform private.record_work_order_event(
        new.entity_id, 'photo_added',
        pg_catalog.jsonb_build_object('attachment_id', new.id, 'visibility', new.visibility),
        new.created_at
      );
    end if;
  elsif old.entity_type = 'work_order' then
    perform private.record_work_order_event(
      old.entity_id, 'photo_removed',
      pg_catalog.jsonb_build_object('attachment_id', old.id, 'reason', private.change_reason())
    );
  end if;
  return null;
end;
$$;

create trigger attachments_work_order_events
  after insert or delete on public.attachments
  for each row execute function private.attachments_work_order_events();

-- ---------------------------------------------------------------------------
-- Privileges. Every write is an RPC (workshop RPCs migration): no insert,
-- update or delete grants to API roles.
-- ---------------------------------------------------------------------------
revoke all on function
  private.work_order_status_is_open(public.work_order_status),
  private.work_order_status_is_closed(public.work_order_status),
  private.work_order_transition_rule(public.work_order_status, public.work_order_status),
  private.work_order_events_append_only(),
  private.record_work_order_event(uuid, public.work_order_event_type, jsonb, timestamptz),
  private.work_orders_enforce_rules(),
  private.work_orders_record_history(),
  private.work_order_assignments_enforce_rules(),
  private.work_order_assignments_sync(),
  private.attachment_entity_exists(public.attachment_entity, uuid),
  private.attachments_work_order_never_public(),
  private.attachments_work_order_events()
from public, anon, authenticated, service_role;

alter table public.work_orders enable row level security;
alter table public.work_order_assignments enable row level security;
alter table public.work_order_events enable row level security;

revoke all on table public.work_orders from public, anon, authenticated, service_role;
revoke all on table public.work_order_assignments from public, anon, authenticated, service_role;
revoke all on table public.work_order_events from public, anon, authenticated, service_role;
-- The identity's sequence too: hosted Supabase grants it to the API roles.
revoke all on sequence public.work_order_events_id_seq from public, anon, authenticated, service_role;

grant select on table public.work_orders to authenticated, service_role;
grant select on table public.work_order_assignments to authenticated, service_role;
grant select on table public.work_order_events to authenticated, service_role;

create policy work_orders_select_staff on public.work_orders
  for select to authenticated
  using ((select private.is_staff()));

create policy work_order_assignments_select_staff on public.work_order_assignments
  for select to authenticated
  using ((select private.is_staff()));

create policy work_order_events_select_staff on public.work_order_events
  for select to authenticated
  using ((select private.is_staff()));
