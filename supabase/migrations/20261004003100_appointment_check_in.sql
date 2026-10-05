-- Appointments and work orders: check-in, the link and completion (SPEC §6
-- "Check-in", §7.1, §23; DATA-MODEL.md §3, §4, §16; PLAN D18, D36, D40).
--
-- Rules encoded here:
--   * work_orders.appointment_id now references public.appointments (on
--     delete restrict; appointments are never deleted anyway) and is unique
--     where set: one appointment, at most one work order.
--   * Phase 3's private.work_orders_enforce_rules (not replaced) already lets
--     appointment_id go null -> value exactly once and raises
--     work_order_immutable on any later change or clear. This migration
--     relies on that rule and adds no second immutability code.
--   * Whenever a value is SET (an insert with an appointment, or an update
--     from null), for every writer (check_in_appointment, a direct call of
--     private.create_work_order, the owner, the seed): the appointment must
--     be checked_in (appointment_not_checked_in) and belong to the job's
--     customer and bike (appointment_work_order_mismatch) (D40).
--   * The link is written to both histories, dated at the check-in instant:
--     the appointment's work_order_linked event and the job's
--     appointment_linked event, which comes right after the job's own
--     checked_in event. P3's checked_in payload and
--     private.work_orders_record_history are unchanged; customers never see
--     appointment_linked (my_work_order_timeline whitelists event types, D8).
--   * D36: the appointment completes when its job first reaches completed,
--     ready_for_collection or collected; reopening the job does not reopen
--     it; a cancelled job leaves it checked_in. Staff never mark completed.
--   * D40: check_in_appointment needs a bike owned by the appointment's
--     customer (a shop bike or someone else's is refused; transfer first)
--     and either creates the job through Phase 3's private.create_work_order
--     (job number, checked_in event, D18 and the lead exactly as for a
--     walk-in) or links one OPEN (before completed), unlinked job of the
--     same customer and bike. One transaction: any failure leaves the
--     appointment untouched. Invariant: every checked_in or completed
--     appointment has exactly one work order.
--   * Walk-ins are unaffected: public.create_work_order keeps passing null.
--
-- Triggers on public.work_orders after this migration (same kind fire in
-- name order):
--   BEFORE: work_orders_appointment_rules (INSERT, UPDATE OF appointment_id),
--           work_orders_enforce_rules (P3), work_orders_set_updated_at (P3);
--   AFTER:  work_orders_record_history (P3; the checked_in event),
--           work_orders_sell_held_units (P4),
--           work_orders_sync_appointment_completion (UPDATE OF status, D36),
--           work_orders_sync_appointment_link (INSERT, UPDATE OF
--           appointment_id; after record_history, so checked_in comes first).
--
-- LOCK ORDER (continues the appointments migration's (a)-(d)):
--   check_in_appointment takes (c) the appointment row FOR UPDATE, then (d)
--   the existing work order FOR UPDATE (link_existing only), then the
--   customer and the bike FOR SHARE (Phase 3's order; create_work_order
--   takes the same two again). The D36 completion trigger runs under the
--   job's row lock and then updates its appointment row: the reverse order,
--   but only for an appointment that is already checked_in, and check-in
--   never locks a work order for one of those (it returns the existing
--   link), so no cycle forms.

alter table public.work_orders
  add constraint work_orders_appointment_id_fkey
  foreign key (appointment_id) references public.appointments (id) on delete restrict;

create unique index work_orders_appointment_id_key
  on public.work_orders (appointment_id) where appointment_id is not null;

comment on column public.work_orders.appointment_id is
  'The appointment this job was checked in from (D40). Set once (on insert, or null -> value on update; P3''s work_order_immutable afterwards), only to a checked_in appointment of the same customer and bike; unique.';

-- ---------------------------------------------------------------------------
-- The link: checked on the way in (every writer) ...
-- ---------------------------------------------------------------------------
create function private.work_orders_appointment_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  appt public.appointments;
begin
  -- Only when a value is being set; a change or clear of a set value is
  -- P3's work_order_immutable (work_orders_enforce_rules).
  if new.appointment_id is null or (tg_op = 'UPDATE' and old.appointment_id is not null) then
    return new;
  end if;

  select a.* into appt from public.appointments a where a.id = new.appointment_id;
  if appt.id is null then
    raise exception 'appointment % not found', new.appointment_id using errcode = 'P0002';
  end if;
  if appt.status <> 'checked_in' then
    raise exception using
      errcode = 'P0001',
      message = 'appointment_not_checked_in',
      detail = 'Only a checked-in appointment can be linked to a job.';
  end if;
  if appt.customer_id is distinct from new.customer_id or appt.bike_id is distinct from new.bike_id then
    raise exception using
      errcode = 'P0001',
      message = 'appointment_work_order_mismatch',
      detail = 'The job and the appointment must have the same customer and bike.';
  end if;
  return new;
end;
$$;

create trigger work_orders_appointment_rules
  before insert or update of appointment_id on public.work_orders
  for each row execute function private.work_orders_appointment_rules();

-- ... and written to both histories, dated at the check-in.
create function private.work_orders_sync_appointment_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  appt public.appointments;
  type_name text;
  linked_at timestamptz;
begin
  if new.appointment_id is null or (tg_op = 'UPDATE' and old.appointment_id is not null) then
    return null;
  end if;

  select a.* into appt from public.appointments a where a.id = new.appointment_id;
  select t.name into type_name from public.appointment_types t where t.id = appt.appointment_type_id;
  -- The check-in instant: a new job's own check-in (live: now; the seed: its
  -- seeded time), or the appointment's when an older job is linked.
  linked_at := greatest(new.checked_in_at, appt.checked_in_at);

  perform private.record_appointment_event(
    appt.id, 'work_order_linked', null, null, null,
    pg_catalog.jsonb_build_object(
      'work_order_id', new.id,
      'job_number', new.job_number,
      'created', tg_op = 'INSERT'
    ),
    linked_at
  );
  perform private.record_work_order_event(
    new.id, 'appointment_linked',
    pg_catalog.jsonb_build_object(
      'appointment_id', appt.id,
      'starts_at', appt.starts_at,
      'appointment_type_name', type_name,
      'created', tg_op = 'INSERT'
    ),
    linked_at
  );
  return null;
end;
$$;

create trigger work_orders_sync_appointment_link
  after insert or update of appointment_id on public.work_orders
  for each row execute function private.work_orders_sync_appointment_link();

-- ---------------------------------------------------------------------------
-- D36: the appointment completes with its job (first completion only).
-- ---------------------------------------------------------------------------
create function private.work_orders_sync_appointment_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.appointment_id is not null
     and new.status in ('completed', 'ready_for_collection', 'collected')
     and old.status not in ('completed', 'ready_for_collection', 'collected') then
    -- Only a checked_in appointment moves: a completed one stays as it was
    -- (re-completion after a reopen); the appointments trigger writes the
    -- 'completed' event with the current staff member as actor.
    update public.appointments a
    set status = 'completed',
        completed_at = coalesce(new.completed_at, pg_catalog.now())
    where a.id = new.appointment_id
      and a.status = 'checked_in';
  end if;
  return null;
end;
$$;

create trigger work_orders_sync_appointment_completion
  after update of status on public.work_orders
  for each row execute function private.work_orders_sync_appointment_completion();

-- ---------------------------------------------------------------------------
-- check_in_appointment (D40)
-- ---------------------------------------------------------------------------
create type public.appointment_check_in as (
  appointment_id uuid,
  appointment_status public.appointment_status,
  work_order_id uuid,
  job_number text,
  created boolean
);

comment on type public.appointment_check_in is
  'check_in_appointment''s result: the appointment, its status, its one work order and whether this call created it.';

-- Active staff: check an appointment in with the customer's bike, creating a
-- new job (link_existing = false, under the client-made work_order_id) or
-- linking an open, unlinked job of the same customer and bike
-- (link_existing = true, work_order_id = that job). Replay-safe: an
-- appointment already checked in (or completed) returns its link with
-- created = false, whatever work_order_id is passed. requested_work
-- defaults to the customer's note; blank both -> requested_work_required.
create function public.check_in_appointment(
  appointment_id uuid,
  bike_id uuid,
  work_order_id uuid,
  link_existing boolean default false,
  requested_work text default null,
  intake_notes text default null,
  lead_mechanic_id uuid default null
)
returns public.appointment_check_in
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_staff();
  appt public.appointments;
  linked public.work_orders;
  target public.work_orders;
  bike_owner uuid;
  bike_archived timestamptz;
  result public.appointment_check_in;
begin
  -- (1)
  if check_in_appointment.appointment_id is null or check_in_appointment.bike_id is null
     or check_in_appointment.work_order_id is null then
    raise exception 'appointment_id, bike_id and work_order_id are required' using errcode = '22004';
  end if;

  -- (2) lock order (c)
  select a.* into appt from public.appointments a where a.id = check_in_appointment.appointment_id for update;
  if appt.id is null then
    raise exception 'appointment % not found', check_in_appointment.appointment_id using errcode = 'P0002';
  end if;

  -- (3) Already checked in (a replay, or a second device): its one link.
  if appt.status in ('checked_in', 'completed') then
    select w.* into linked from public.work_orders w where w.appointment_id = appt.id;
    result := (appt.id, appt.status, linked.id, linked.job_number, false)::public.appointment_check_in;
    return result;
  end if;

  -- (4)
  if appt.status not in ('booked', 'confirmed', 'arrived') then
    raise exception using
      errcode = 'P0001',
      message = 'appointment_transition_invalid',
      detail = pg_catalog.format('A %s appointment cannot be checked in; book again instead.', appt.status);
  end if;

  -- (7b, checks first) the existing job, lock order (d)
  if coalesce(check_in_appointment.link_existing, false) then
    select w.* into target from public.work_orders w where w.id = check_in_appointment.work_order_id for update;
    if target.id is null then
      raise exception 'work order % not found', check_in_appointment.work_order_id using errcode = 'P0002';
    end if;
    if target.customer_id is distinct from appt.customer_id
       or target.bike_id is distinct from check_in_appointment.bike_id
       or not private.work_order_status_is_open(target.status)
       or target.appointment_id is not null then
      raise exception using
        errcode = 'P0001',
        message = 'appointment_work_order_mismatch',
        detail = 'Link an open job of this customer and bike that has no appointment yet.';
    end if;
  end if;

  -- (5) the bike: the customer's own, not archived (D40); held against a
  -- concurrent transfer in Phase 3's order (customer, then bike).
  perform 1 from public.customers c where c.id = appt.customer_id for share;
  select b.customer_id, b.archived_at into bike_owner, bike_archived
  from public.bikes b where b.id = check_in_appointment.bike_id for share;
  if not found then
    raise exception 'bike % not found', check_in_appointment.bike_id using errcode = 'P0002';
  end if;
  if bike_archived is not null then
    raise exception using
      errcode = 'P0001',
      message = 'appointment_bike_archived',
      detail = 'That bike is archived; unarchive it or pick another.';
  end if;
  if bike_owner is distinct from appt.customer_id then
    raise exception using
      errcode = 'P0001',
      message = 'appointment_bike_not_owned',
      detail = 'Check in a bike the customer owns; transfer it to them first.';
  end if;

  -- (6) the appointment (the trigger stamps checked_in_at and arrived_at and
  -- writes the checked_in event).
  update public.appointments a
  set bike_id = check_in_appointment.bike_id,
      status = 'checked_in'
  where a.id = appt.id
  returning a.* into appt;

  if coalesce(check_in_appointment.link_existing, false) then
    -- (7b) the triggers check the link and write both link events.
    update public.work_orders w
    set appointment_id = appt.id
    where w.id = target.id
    returning w.* into linked;
  else
    -- (7a) exactly as a walk-in, plus the appointment.
    linked := private.create_work_order(
      actor,
      check_in_appointment.work_order_id,
      appt.customer_id,
      check_in_appointment.bike_id,
      coalesce(nullif(pg_catalog.btrim(check_in_appointment.requested_work), ''), appt.customer_note),
      check_in_appointment.intake_notes,
      check_in_appointment.lead_mechanic_id,
      '{}'::uuid[],
      '[]'::jsonb,
      appt.id
    );
    -- create_work_order replays any job with this id, customer and bike:
    -- an older job under the id is not this appointment's.
    if linked.appointment_id is distinct from appt.id then
      raise exception using
        errcode = 'P0001',
        message = 'work_order_conflict',
        detail = 'That job id is already used for another job.';
    end if;
  end if;

  -- (8)
  result := (appt.id, appt.status, linked.id, linked.job_number,
             not coalesce(check_in_appointment.link_existing, false))::public.appointment_check_in;
  return result;
end;
$$;

comment on function public.check_in_appointment(uuid, uuid, uuid, boolean, text, text, uuid) is
  'Active staff: check an appointment in with the customer''s own bike, creating its job (private.create_work_order) or linking an open unlinked job of the same customer and bike (D40); replays return the existing link (created = false).';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function
  private.work_orders_appointment_rules(),
  private.work_orders_sync_appointment_link(),
  private.work_orders_sync_appointment_completion()
from public, anon, authenticated, service_role;

revoke all on function public.check_in_appointment(uuid, uuid, uuid, boolean, text, text, uuid)
from public, anon, authenticated, service_role;

grant execute on function public.check_in_appointment(uuid, uuid, uuid, boolean, text, text, uuid)
to authenticated;
