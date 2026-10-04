-- Workshop RPCs: check-in, status, details, notes, approval, assignments,
-- lines and the timeline (SPEC §2 "Idempotent ... mutations",
-- "Transactional invariants", §7, §7.1, §7.2, §7.3, §9, §22, §25;
-- DATA-MODEL.md §4, §5, §16; PLAN D14, D15, D16, D18, D22).
--
-- Every RPC is security definer, starts with private.require_staff(), locks
-- the work order it changes (`for update`, always before any of its lines,
-- so concurrent calls on one job serialise in one order) and is safe to
-- replay: creating a job or a line takes a client-chosen id and a replay
-- returns the original, whatever happened to the job since; a status, flag
-- or assignment that is already in place changes nothing and records
-- nothing. The table triggers (work orders and lines migrations) enforce
-- the rules and write the timeline for every writer; the RPCs add the
-- caller-facing checks and the order in which errors are reported.
--
-- Line RPCs return the line id only: a line row carries its cost, and an
-- RPC result is not column-gated (staff without view_costs call them too).
--
-- Extension points: Phase 2's check_in_appointment calls
-- private.create_work_order with an appointment id; Phase 4 adds
-- add_inventory_line (reusing private.require_open_work_order) and replaces
-- void_line with the stock-reversal branch for inventory lines.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

-- The work order, locked for update; P0002 when absent. No status check.
create function private.lock_work_order(work_order_id uuid)
returns public.work_orders
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result public.work_orders;
begin
  select w.* into result from public.work_orders w where w.id = lock_work_order.work_order_id for update;
  if not found then
    raise exception 'work order % not found', lock_work_order.work_order_id using errcode = 'P0002';
  end if;
  return result;
end;
$$;

-- The work order, locked; work_order_locked unless it is open (lines may
-- change only before completion, D15).
create function private.require_open_work_order(work_order_id uuid)
returns public.work_orders
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result public.work_orders := private.lock_work_order(require_open_work_order.work_order_id);
begin
  if not private.work_order_status_is_open(result.status) then
    raise exception using
      errcode = 'P0001',
      message = 'work_order_locked',
      detail = 'This job is completed or closed; reopen it to change its lines.';
  end if;
  return result;
end;
$$;

-- work_order_closed when the job is collected or cancelled.
create function private.require_unclosed_work_order(wo public.work_orders)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if private.work_order_status_is_closed(wo.status) then
    raise exception using
      errcode = 'P0001',
      message = 'work_order_closed',
      detail = 'This job is collected or cancelled and can no longer change.';
  end if;
end;
$$;

-- Assigns staff_id to the (locked, not closed) job in `role` (D22). Already
-- active in that role: returns the row, no event. Active in the other role:
-- that row is closed first. A new lead closes the previous lead's row (they
-- leave the job; not demoted). Only active staff (staff_inactive).
create function private.assign_staff_to_work_order(
  work_order_id uuid,
  staff_id uuid,
  role public.assignment_role,
  actor uuid
)
returns public.work_order_assignments
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_active boolean;
  current_row public.work_order_assignments;
  result public.work_order_assignments;
begin
  select s.active into target_active from public.staff s where s.id = assign_staff_to_work_order.staff_id;
  if not found then
    raise exception 'staff % not found', assign_staff_to_work_order.staff_id using errcode = 'P0002';
  end if;
  if not target_active then
    raise exception using
      errcode = 'P0001',
      message = 'staff_inactive',
      detail = 'Only active staff can be assigned to a job.';
  end if;

  select a.* into current_row
  from public.work_order_assignments a
  where a.work_order_id = assign_staff_to_work_order.work_order_id
    and a.staff_id = assign_staff_to_work_order.staff_id
    and a.unassigned_at is null
  for update;
  if found then
    if current_row.role = assign_staff_to_work_order.role then
      return current_row;
    end if;
    update public.work_order_assignments a
    set unassigned_at = pg_catalog.clock_timestamp(), unassigned_by = assign_staff_to_work_order.actor
    where a.id = current_row.id;
  end if;

  if assign_staff_to_work_order.role = 'lead' then
    update public.work_order_assignments a
    set unassigned_at = pg_catalog.clock_timestamp(), unassigned_by = assign_staff_to_work_order.actor
    where a.work_order_id = assign_staff_to_work_order.work_order_id
      and a.role = 'lead'
      and a.unassigned_at is null;
  end if;

  insert into public.work_order_assignments as a (work_order_id, staff_id, role, assigned_by)
  values (
    assign_staff_to_work_order.work_order_id, assign_staff_to_work_order.staff_id,
    assign_staff_to_work_order.role, assign_staff_to_work_order.actor
  )
  returning a.* into result;
  return result;
end;
$$;

-- Adds a service line to a job the caller has locked (wo). Order, so that a
-- replay returns the original result instead of an error: (1) the line id
-- exists -> same job, type and service returns it (no event, no other
-- check), anything else is line_conflict; (2) the job must be open; (3) the
-- service must exist, be active and not archived; (4) snapshot description,
-- price, cost and the rate in force now; (5) insert, and re-check if a
-- concurrent call took the id first.
create function private.insert_service_line(
  wo public.work_orders,
  line_id uuid,
  service_id uuid,
  quantity public.line_quantity,
  unit_sale_price public.money_amount,
  unit_direct_cost public.money_amount,
  description text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  existing public.work_order_line_items;
  svc public.services;
  inserted uuid;
begin
  select li.* into existing from public.work_order_line_items li where li.id = insert_service_line.line_id;
  if found then
    if existing.work_order_id = wo.id and existing.line_type = 'service'
       and existing.source_service_id = insert_service_line.service_id then
      return existing.id;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'line_conflict',
      detail = 'That line id is already used for another line.';
  end if;

  if not private.work_order_status_is_open(wo.status) then
    raise exception using
      errcode = 'P0001',
      message = 'work_order_locked',
      detail = 'This job is completed or closed; reopen it to change its lines.';
  end if;

  select s.* into svc from public.services s where s.id = insert_service_line.service_id;
  if not found then
    raise exception 'service % not found', insert_service_line.service_id using errcode = 'P0002';
  end if;
  if not svc.active or svc.archived_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'service_unavailable',
      detail = 'That service is inactive or archived.';
  end if;

  insert into public.work_order_line_items as li (
    id, work_order_id, line_type, source_service_id, description_snapshot, quantity,
    unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency, created_by
  )
  values (
    insert_service_line.line_id, wo.id, 'service', svc.id,
    coalesce(nullif(pg_catalog.btrim(insert_service_line.description), ''), svc.name),
    insert_service_line.quantity,
    coalesce(insert_service_line.unit_sale_price, svc.default_sale_price),
    coalesce(insert_service_line.unit_direct_cost, svc.default_direct_cost),
    private.cult_commons_rate_at(pg_catalog.clock_timestamp()),
    wo.currency,
    private.current_staff_id()
  )
  on conflict (id) do nothing
  returning li.id into inserted;

  if inserted is null then
    select li.* into existing from public.work_order_line_items li where li.id = insert_service_line.line_id;
    if existing.work_order_id is distinct from wo.id or existing.line_type is distinct from 'service'
       or existing.source_service_id is distinct from insert_service_line.service_id then
      raise exception using
        errcode = 'P0001',
        message = 'line_conflict',
        detail = 'That line id is already used for another line.';
    end if;
    return existing.id;
  end if;
  return inserted;
end;
$$;

-- ---------------------------------------------------------------------------
-- Check-in
-- ---------------------------------------------------------------------------

-- The single creation path (SPEC §7.1); Phase 2's check_in_appointment calls
-- it with an appointment id. One transaction: the job, its timeline, the
-- lead and additional staff and the known services all succeed or none do.
-- services: [{line_id uuid, service_id uuid, quantity numeric default 1}],
-- at most 20; additional staff at most 10.
create function private.create_work_order(
  actor uuid,
  work_order_id uuid,
  customer_id uuid,
  bike_id uuid,
  requested_work text,
  intake_notes text,
  lead_mechanic_id uuid,
  additional_staff_ids uuid[],
  services jsonb,
  appointment_id uuid
)
returns public.work_orders
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result public.work_orders;
  inserted public.work_orders;
  extra uuid;
  extras uuid[];
  elem jsonb;
  uuid_pattern constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if create_work_order.work_order_id is null or create_work_order.customer_id is null
     or create_work_order.bike_id is null then
    raise exception 'work_order_id, customer_id and bike_id are required' using errcode = '22004';
  end if;
  if nullif(pg_catalog.btrim(coalesce(create_work_order.requested_work, '')), '') is null then
    raise exception using
      errcode = 'P0001',
      message = 'requested_work_required',
      detail = 'Say what the customer wants done.';
  end if;

  -- (1) Replay: the same job returns as it is now, without re-running any
  -- check, assignment or line (the bike may have changed hands since).
  select w.* into result from public.work_orders w where w.id = create_work_order.work_order_id for share;
  if found then
    if result.customer_id = create_work_order.customer_id and result.bike_id = create_work_order.bike_id then
      return result;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'work_order_conflict',
      detail = 'That job id is already used for another job.';
  end if;

  -- Argument shape, before anything is written.
  extras := array(
    select distinct x
    from pg_catalog.unnest(coalesce(create_work_order.additional_staff_ids, '{}'::uuid[])) as x
    where x is not null and x is distinct from create_work_order.lead_mechanic_id
  );
  if pg_catalog.cardinality(extras) > 10 then
    raise exception 'at most 10 additional staff' using errcode = '22023';
  end if;
  if create_work_order.services is not null then
    if pg_catalog.jsonb_typeof(create_work_order.services) <> 'array'
       or pg_catalog.jsonb_array_length(create_work_order.services) > 20 then
      raise exception 'services must be an array of at most 20 lines' using errcode = '22023';
    end if;
    for elem in select e from pg_catalog.jsonb_array_elements(create_work_order.services) as e loop
      if pg_catalog.jsonb_typeof(elem) <> 'object'
         or coalesce(elem ->> 'line_id', '') !~ uuid_pattern
         or coalesce(elem ->> 'service_id', '') !~ uuid_pattern
         or (elem ? 'quantity' and pg_catalog.jsonb_typeof(elem -> 'quantity') not in ('number', 'null')) then
        raise exception 'malformed service line: %', elem using errcode = '22023';
      end if;
    end loop;
  end if;

  -- (2) Hold the customer and the bike so D18 holds against a concurrent
  -- transfer_bike_ownership (which locks the bike for update).
  perform 1 from public.customers c where c.id = create_work_order.customer_id for share;
  if not found then
    raise exception 'customer % not found', create_work_order.customer_id using errcode = 'P0002';
  end if;
  perform 1 from public.bikes b where b.id = create_work_order.bike_id for share;
  if not found then
    raise exception 'bike % not found', create_work_order.bike_id using errcode = 'P0002';
  end if;

  -- (3) The trigger checks archived customer/bike and ownership (D18) and
  -- assigns the job number.
  insert into public.work_orders as w (
    id, customer_id, bike_id, appointment_id, requested_work, intake_notes, created_by
  )
  values (
    create_work_order.work_order_id, create_work_order.customer_id, create_work_order.bike_id,
    create_work_order.appointment_id, create_work_order.requested_work, create_work_order.intake_notes,
    create_work_order.actor
  )
  on conflict (id) do nothing
  returning w.* into inserted;

  if inserted.id is null then
    -- A concurrent call with the same id won the insert.
    select w.* into result from public.work_orders w where w.id = create_work_order.work_order_id;
    if result.customer_id is distinct from create_work_order.customer_id
       or result.bike_id is distinct from create_work_order.bike_id then
      raise exception using
        errcode = 'P0001',
        message = 'work_order_conflict',
        detail = 'That job id is already used for another job.';
    end if;
    return result;
  end if;

  -- (4) Only the call that inserted: staff, then the known services.
  if create_work_order.lead_mechanic_id is not null then
    perform private.assign_staff_to_work_order(
      inserted.id, create_work_order.lead_mechanic_id, 'lead', create_work_order.actor
    );
  end if;
  foreach extra in array extras loop
    perform private.assign_staff_to_work_order(inserted.id, extra, 'additional', create_work_order.actor);
  end loop;

  if create_work_order.services is not null then
    for elem in select e from pg_catalog.jsonb_array_elements(create_work_order.services) as e loop
      perform private.insert_service_line(
        inserted,
        (elem ->> 'line_id')::uuid,
        (elem ->> 'service_id')::uuid,
        coalesce((elem ->> 'quantity')::numeric, 1)::public.line_quantity,
        null, null, null
      );
    end loop;
  end if;

  select w.* into result from public.work_orders w where w.id = inserted.id;
  return result;
end;
$$;

-- Active staff: check a bike in (SPEC §7.1).
create function public.create_work_order(
  work_order_id uuid,
  customer_id uuid,
  bike_id uuid,
  requested_work text,
  intake_notes text default null,
  lead_mechanic_id uuid default null,
  additional_staff_ids uuid[] default '{}',
  services jsonb default '[]'::jsonb
)
returns public.work_orders
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_staff();
begin
  return private.create_work_order(
    actor, create_work_order.work_order_id, create_work_order.customer_id, create_work_order.bike_id,
    create_work_order.requested_work, create_work_order.intake_notes, create_work_order.lead_mechanic_id,
    create_work_order.additional_staff_ids, create_work_order.services, null
  );
end;
$$;

comment on function public.create_work_order(uuid, uuid, uuid, text, text, uuid, uuid[], jsonb) is
  'Active staff: check a bike in as a new job (J- number, lead and additional staff, known services); replay-safe by id.';

-- ---------------------------------------------------------------------------
-- Status, details, notes, approval
-- ---------------------------------------------------------------------------

-- Active staff: move a job along the status machine (D15, D16). The same
-- status is a replay (no change, no event). Cancelling and reopening need a
-- note (the reason). The triggers stamp the time and write one event.
create function public.set_work_order_status(
  work_order_id uuid,
  status public.work_order_status,
  note text default null
)
returns public.work_orders
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  wo public.work_orders;
  rule text;
  cleaned text := nullif(pg_catalog.btrim(coalesce(set_work_order_status.note, '')), '');
  result public.work_orders;
begin
  perform private.require_staff();
  if set_work_order_status.work_order_id is null or set_work_order_status.status is null then
    raise exception 'work_order_id and status are required' using errcode = '22004';
  end if;

  wo := private.lock_work_order(set_work_order_status.work_order_id);
  if wo.status = set_work_order_status.status then
    return wo;
  end if;

  rule := private.work_order_transition_rule(wo.status, set_work_order_status.status);
  if rule is null then
    raise exception using
      errcode = 'P0001',
      message = 'work_order_transition_invalid',
      detail = pg_catalog.format('A job cannot move from %s to %s.', wo.status, set_work_order_status.status);
  end if;
  if rule = 'reason_required' and cleaned is null then
    raise exception using
      errcode = 'P0001',
      message = 'reason_required',
      detail = pg_catalog.format('Say why the job is moving from %s to %s.', wo.status, set_work_order_status.status);
  end if;
  if set_work_order_status.status = 'cancelled' and exists (
    select 1 from public.work_order_line_items li where li.work_order_id = wo.id and li.voided_at is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'work_order_has_lines',
      detail = 'Void the job''s lines before cancelling it.';
  end if;

  perform private.set_change_reason(cleaned);
  update public.work_orders w
  set status = set_work_order_status.status
  where w.id = wo.id
  returning w.* into result;
  perform private.set_change_reason(null);
  return result;
end;
$$;

comment on function public.set_work_order_status(uuid, public.work_order_status, text) is
  'Active staff: change a job''s status per the transition table (D15, D16); same status is a no-op.';

-- Active staff: edit the job's text. Null keeps a field, '' clears it
-- (requested work cannot be cleared). Nothing changed: no update, no event.
-- Allowed in any status.
create function public.update_work_order(
  work_order_id uuid,
  requested_work text default null,
  intake_notes text default null,
  internal_notes text default null,
  completion_notes text default null
)
returns public.work_orders
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  wo public.work_orders;
  new_requested text;
  new_intake text;
  new_internal text;
  new_completion text;
  result public.work_orders;
begin
  perform private.require_staff();
  if update_work_order.work_order_id is null then
    raise exception 'work_order_id is required' using errcode = '22004';
  end if;
  wo := private.lock_work_order(update_work_order.work_order_id);

  new_requested := case when update_work_order.requested_work is null then wo.requested_work
                        else pg_catalog.btrim(update_work_order.requested_work) end;
  if new_requested = '' then
    raise exception using
      errcode = 'P0001',
      message = 'requested_work_required',
      detail = 'Say what the customer wants done.';
  end if;
  new_intake := case when update_work_order.intake_notes is null then wo.intake_notes
                     else nullif(pg_catalog.btrim(update_work_order.intake_notes), '') end;
  new_internal := case when update_work_order.internal_notes is null then wo.internal_notes
                       else nullif(pg_catalog.btrim(update_work_order.internal_notes), '') end;
  new_completion := case when update_work_order.completion_notes is null then wo.completion_notes
                         else nullif(pg_catalog.btrim(update_work_order.completion_notes), '') end;

  if new_requested is not distinct from wo.requested_work
     and new_intake is not distinct from wo.intake_notes
     and new_internal is not distinct from wo.internal_notes
     and new_completion is not distinct from wo.completion_notes then
    return wo;
  end if;

  update public.work_orders w
  set requested_work = new_requested,
      intake_notes = new_intake,
      internal_notes = new_internal,
      completion_notes = new_completion
  where w.id = wo.id
  returning w.* into result;
  return result;
end;
$$;

comment on function public.update_work_order(uuid, text, text, text, text) is
  'Active staff: edit requested work and notes (null keeps, '''' clears); one details_changed event.';

-- Active staff: add a note or a diagnosis to the timeline. Any status.
create function public.add_work_order_note(
  work_order_id uuid,
  kind public.work_order_note_kind,
  body text
)
returns public.work_order_events
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  cleaned text := nullif(pg_catalog.btrim(coalesce(add_work_order_note.body, '')), '');
begin
  perform private.require_staff();
  if add_work_order_note.work_order_id is null or add_work_order_note.kind is null then
    raise exception 'work_order_id and kind are required' using errcode = '22004';
  end if;
  if cleaned is null then
    raise exception using
      errcode = 'P0001',
      message = 'note_required',
      detail = 'Write the note first.';
  end if;
  if pg_catalog.char_length(cleaned) > 5000 then
    raise exception using
      errcode = 'P0001',
      message = 'note_too_long',
      detail = 'Keep the note under 5,000 characters.';
  end if;
  perform 1 from public.work_orders w where w.id = add_work_order_note.work_order_id for share;
  if not found then
    raise exception 'work order % not found', add_work_order_note.work_order_id using errcode = 'P0002';
  end if;
  return private.record_work_order_event(
    add_work_order_note.work_order_id,
    case add_work_order_note.kind when 'diagnosis' then 'diagnosis_added' else 'note_added' end
      ::public.work_order_event_type,
    pg_catalog.jsonb_build_object('body', cleaned)
  );
end;
$$;

comment on function public.add_work_order_note(uuid, public.work_order_note_kind, text) is
  'Active staff: append a note or diagnosis to a job''s timeline.';

-- Active staff: the optional internal approval flag (SPEC §7.1; no customer
-- approval workflow). Not on a collected or cancelled job. Replay: no-op.
create function public.set_approval_flag(work_order_id uuid, flagged boolean, note text default null)
returns public.work_orders
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  wo public.work_orders;
  cleaned text := nullif(pg_catalog.btrim(coalesce(set_approval_flag.note, '')), '');
  result public.work_orders;
begin
  perform private.require_staff();
  if set_approval_flag.work_order_id is null or set_approval_flag.flagged is null then
    raise exception 'work_order_id and flagged are required' using errcode = '22004';
  end if;
  wo := private.lock_work_order(set_approval_flag.work_order_id);
  perform private.require_unclosed_work_order(wo);
  if wo.approval_flag = set_approval_flag.flagged and wo.approval_note is not distinct from cleaned then
    return wo;
  end if;
  update public.work_orders w
  set approval_flag = set_approval_flag.flagged, approval_note = cleaned
  where w.id = wo.id
  returning w.* into result;
  return result;
end;
$$;

comment on function public.set_approval_flag(uuid, boolean, text) is
  'Active staff: set or clear the internal approval flag and note; replay-safe.';

-- ---------------------------------------------------------------------------
-- Assignments (D22)
-- ---------------------------------------------------------------------------
create function public.assign_staff(
  work_order_id uuid,
  staff_id uuid,
  role public.assignment_role default 'additional'
)
returns public.work_order_assignments
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_staff();
  wo public.work_orders;
begin
  if assign_staff.work_order_id is null or assign_staff.staff_id is null or assign_staff.role is null then
    raise exception 'work_order_id, staff_id and role are required' using errcode = '22004';
  end if;
  wo := private.lock_work_order(assign_staff.work_order_id);
  perform private.require_unclosed_work_order(wo);
  return private.assign_staff_to_work_order(wo.id, assign_staff.staff_id, assign_staff.role, actor);
end;
$$;

comment on function public.assign_staff(uuid, uuid, public.assignment_role) is
  'Active staff: assign anyone active to a job as lead (replacing the lead) or additional (D22); replay-safe.';

create function public.unassign_staff(work_order_id uuid, staff_id uuid)
returns public.work_order_assignments
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_staff();
  wo public.work_orders;
  result public.work_order_assignments;
begin
  if unassign_staff.work_order_id is null or unassign_staff.staff_id is null then
    raise exception 'work_order_id and staff_id are required' using errcode = '22004';
  end if;
  wo := private.lock_work_order(unassign_staff.work_order_id);
  perform private.require_unclosed_work_order(wo);
  update public.work_order_assignments a
  set unassigned_at = pg_catalog.clock_timestamp(), unassigned_by = actor
  where a.work_order_id = wo.id and a.staff_id = unassign_staff.staff_id and a.unassigned_at is null
  returning a.* into result;
  -- Null when nobody was assigned (replay-safe, no event).
  return result;
end;
$$;

comment on function public.unassign_staff(uuid, uuid) is
  'Active staff: take someone off a job; returns the closed row, or null when they were not on it.';

-- ---------------------------------------------------------------------------
-- Lines (D14). Return the line id only.
-- ---------------------------------------------------------------------------
create function public.add_service_line(
  line_id uuid,
  work_order_id uuid,
  service_id uuid,
  quantity public.line_quantity default 1,
  unit_sale_price public.money_amount default null,
  unit_direct_cost public.money_amount default null,
  description text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  wo public.work_orders;
begin
  perform private.require_staff();
  if add_service_line.unit_direct_cost is not null and not private.has_permission('view_costs') then
    raise exception 'permission view_costs required to set a cost' using errcode = '42501';
  end if;
  if add_service_line.line_id is null or add_service_line.work_order_id is null
     or add_service_line.service_id is null or add_service_line.quantity is null then
    raise exception 'line_id, work_order_id, service_id and quantity are required' using errcode = '22004';
  end if;
  -- No open check here: a replay of a line added before completion must
  -- still return it (insert_service_line checks the replay first).
  wo := private.lock_work_order(add_service_line.work_order_id);
  return private.insert_service_line(
    wo, add_service_line.line_id, add_service_line.service_id, add_service_line.quantity,
    add_service_line.unit_sale_price, add_service_line.unit_direct_cost, add_service_line.description
  );
end;
$$;

comment on function public.add_service_line(
  uuid, uuid, uuid, public.line_quantity, public.money_amount, public.money_amount, text
) is 'Active staff: add a service to an open job, snapshotting price, cost and rate (a cost override needs view_costs); replay-safe by line id; returns the id.';

create function public.add_manual_line(
  line_id uuid,
  work_order_id uuid,
  description text,
  unit_sale_price public.money_amount,
  quantity public.line_quantity default 1,
  unit_direct_cost public.money_amount default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_staff();
  wo public.work_orders;
  existing public.work_order_line_items;
  inserted uuid;
begin
  if add_manual_line.unit_direct_cost is not null and not private.has_permission('view_costs') then
    raise exception 'permission view_costs required to set a cost' using errcode = '42501';
  end if;
  if add_manual_line.line_id is null or add_manual_line.work_order_id is null
     or add_manual_line.description is null or add_manual_line.unit_sale_price is null
     or add_manual_line.quantity is null then
    raise exception 'line_id, work_order_id, description, unit_sale_price and quantity are required'
      using errcode = '22004';
  end if;

  wo := private.lock_work_order(add_manual_line.work_order_id);

  select li.* into existing from public.work_order_line_items li where li.id = add_manual_line.line_id;
  if found then
    if existing.work_order_id = wo.id and existing.line_type = 'manual' then
      return existing.id;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'line_conflict',
      detail = 'That line id is already used for another line.';
  end if;

  if not private.work_order_status_is_open(wo.status) then
    raise exception using
      errcode = 'P0001',
      message = 'work_order_locked',
      detail = 'This job is completed or closed; reopen it to change its lines.';
  end if;

  insert into public.work_order_line_items as li (
    id, work_order_id, line_type, description_snapshot, quantity,
    unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency, created_by
  )
  values (
    add_manual_line.line_id, wo.id, 'manual', add_manual_line.description, add_manual_line.quantity,
    add_manual_line.unit_sale_price, coalesce(add_manual_line.unit_direct_cost, 0),
    private.cult_commons_rate_at(pg_catalog.clock_timestamp()), wo.currency, actor
  )
  on conflict (id) do nothing
  returning li.id into inserted;

  if inserted is null then
    select li.* into existing from public.work_order_line_items li where li.id = add_manual_line.line_id;
    if existing.work_order_id is distinct from wo.id or existing.line_type is distinct from 'manual' then
      raise exception using
        errcode = 'P0001',
        message = 'line_conflict',
        detail = 'That line id is already used for another line.';
    end if;
    return existing.id;
  end if;
  return inserted;
end;
$$;

comment on function public.add_manual_line(
  uuid, uuid, text, public.money_amount, public.line_quantity, public.money_amount
) is 'Active staff: add a free-text line to an open job (a cost needs view_costs); replay-safe by line id; returns the id.';

-- Active staff: void a line with a reason. Never deletes. Replay returns the
-- id. EXTENSION POINT: Phase 4 replaces this function so voiding an
-- inventory line writes the linked reversal movement; until then inventory
-- lines are refused (line_type_unsupported).
create function public.void_line(line_id uuid, reason text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_staff();
  cleaned text := nullif(pg_catalog.btrim(coalesce(void_line.reason, '')), '');
  wo_id uuid;
  wo public.work_orders;
  target public.work_order_line_items;
begin
  if void_line.line_id is null then
    raise exception 'line_id is required' using errcode = '22004';
  end if;
  if cleaned is null then
    raise exception using
      errcode = 'P0001',
      message = 'reason_required',
      detail = 'Say why the line is being voided.';
  end if;
  if pg_catalog.char_length(cleaned) > 500 then
    raise exception using
      errcode = 'P0001',
      message = 'reason_too_long',
      detail = 'Keep the reason under 500 characters.';
  end if;

  select li.work_order_id into wo_id from public.work_order_line_items li where li.id = void_line.line_id;
  if not found then
    raise exception 'line % not found', void_line.line_id using errcode = 'P0002';
  end if;
  -- The job first, then the line: the same lock order as the add RPCs.
  wo := private.lock_work_order(wo_id);
  select li.* into target from public.work_order_line_items li where li.id = void_line.line_id for update;

  if target.voided_at is not null then
    return target.id;
  end if;
  if not private.work_order_status_is_open(wo.status) then
    raise exception using
      errcode = 'P0001',
      message = 'work_order_locked',
      detail = 'This job is completed or closed; reopen it to change its lines.';
  end if;
  if target.line_type = 'inventory' then
    raise exception using
      errcode = 'P0001',
      message = 'line_type_unsupported',
      detail = 'Parts lines are voided with their stock reversal, which arrives with inventory.';
  end if;

  update public.work_order_line_items li
  set voided_at = pg_catalog.clock_timestamp(), voided_by = actor, void_reason = cleaned
  where li.id = target.id;
  return target.id;
end;
$$;

comment on function public.void_line(uuid, text) is
  'Active staff: void a line on an open job with a reason (kept, never deleted); replay-safe; returns the id.';

-- ---------------------------------------------------------------------------
-- Timeline
-- ---------------------------------------------------------------------------

-- Active staff: a job's timeline, newest first, with the actor's name and,
-- for assignment events, the subject's (staff cannot read colleagues' staff
-- rows, so the names are resolved here).
create function public.work_order_timeline(work_order_id uuid, max_rows integer default 200)
returns table (
  id bigint,
  event_type public.work_order_event_type,
  actor_staff_id uuid,
  actor_display_name text,
  subject_staff_id uuid,
  subject_display_name text,
  payload jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff();
  return query
    select e.id, e.event_type, e.actor_staff_id, a.display_name, subj.staff_id, s.display_name,
           e.payload, e.created_at
    from public.work_order_events e
    left join public.staff a on a.id = e.actor_staff_id
    cross join lateral (
      select case
        when e.event_type = 'assignment_changed'
             and (e.payload ->> 'staff_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (e.payload ->> 'staff_id')::uuid
      end as staff_id
    ) subj
    left join public.staff s on s.id = subj.staff_id
    where e.work_order_id = work_order_timeline.work_order_id
    order by e.created_at desc, e.id desc
    limit greatest(1, least(coalesce(work_order_timeline.max_rows, 200), 500));
end;
$$;

comment on function public.work_order_timeline(uuid, integer) is
  'Active staff: a job''s timeline, newest first, with actor and assignment-subject names (at most 500 rows).';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function
  private.lock_work_order(uuid),
  private.require_open_work_order(uuid),
  private.require_unclosed_work_order(public.work_orders),
  private.assign_staff_to_work_order(uuid, uuid, public.assignment_role, uuid),
  private.insert_service_line(
    public.work_orders, uuid, uuid, public.line_quantity, public.money_amount, public.money_amount, text
  ),
  private.create_work_order(uuid, uuid, uuid, uuid, text, text, uuid, uuid[], jsonb, uuid)
from public, anon, authenticated, service_role;

revoke all on function
  public.create_work_order(uuid, uuid, uuid, text, text, uuid, uuid[], jsonb),
  public.set_work_order_status(uuid, public.work_order_status, text),
  public.update_work_order(uuid, text, text, text, text),
  public.add_work_order_note(uuid, public.work_order_note_kind, text),
  public.set_approval_flag(uuid, boolean, text),
  public.assign_staff(uuid, uuid, public.assignment_role),
  public.unassign_staff(uuid, uuid),
  public.add_service_line(uuid, uuid, uuid, public.line_quantity, public.money_amount, public.money_amount, text),
  public.add_manual_line(uuid, uuid, text, public.money_amount, public.line_quantity, public.money_amount),
  public.void_line(uuid, text),
  public.work_order_timeline(uuid, integer)
from public, anon, authenticated, service_role;

grant execute on function
  public.create_work_order(uuid, uuid, uuid, text, text, uuid, uuid[], jsonb),
  public.set_work_order_status(uuid, public.work_order_status, text),
  public.update_work_order(uuid, text, text, text, text),
  public.add_work_order_note(uuid, public.work_order_note_kind, text),
  public.set_approval_flag(uuid, boolean, text),
  public.assign_staff(uuid, uuid, public.assignment_role),
  public.unassign_staff(uuid, uuid),
  public.add_service_line(uuid, uuid, uuid, public.line_quantity, public.money_amount, public.money_amount, text),
  public.add_manual_line(uuid, uuid, text, public.money_amount, public.line_quantity, public.money_amount),
  public.void_line(uuid, text),
  public.work_order_timeline(uuid, integer)
to authenticated;
