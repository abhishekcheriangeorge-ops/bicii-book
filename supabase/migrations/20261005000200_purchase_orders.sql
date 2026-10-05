-- Purchase orders, their lines and their history (SPEC §2 "auditability",
-- §14 "Purchase orders"; DATA-MODEL.md §10, §15, §16; PLAN D9, D60
-- D-PO-COSTS, D61 D-PO-CANCEL, D62 D-PO-SCOPE, D65 D-OVERRECEIPT).
--
-- Rules encoded here, for every writer:
--   * A PO's number (PO-######, D9) is assigned by the server from
--     private.next_short_id('PO') whatever the caller sent, and never
--     changes. Its currency is the shop currency at creation
--     (private.shop_currency(), D35, D62); its lines copy it.
--   * Status: draft -> submitted -> partially_received -> received, or
--     cancelled from draft, submitted or partially_received (D61, with a
--     reason). received and cancelled are final: no edit, no reopen (D65).
--     The supplier changes only while the PO is a draft. Status moves only
--     through the RPCs (submit, cancel, receive) and
--     private.refresh_purchase_order_status (the receiving migration).
--   * The PO, lines and events are staff-readable and have no write grant:
--     every write is an RPC requiring manage_purchasing. Line costs and
--     totals are purchase costs (D60): authenticated has no column grant on
--     them; the history payloads carry costs, so purchase_order_events rows
--     are visible to private.can_view_purchase_costs() only.
--   * History is appended by triggers, never edited (SPEC §2): one event per
--     create, details change, line add/change/remove, submit, receive,
--     status change and cancel, with actor, reason and correlation id.
--   * A supplier with an open PO (draft, submitted, partially_received)
--     cannot be archived.
--   * Lock order: see the suppliers migration's header. Every RPC that
--     touches an existing PO locks its row FOR UPDATE before reading
--     anything else.

create type public.purchase_order_status as enum (
  'draft',
  'submitted',
  'partially_received',
  'received',
  'cancelled'
);

create type public.purchase_order_event_type as enum (
  'created',
  'details_changed',
  'line_added',
  'line_changed',
  'line_removed',
  'submitted',
  'received',
  'status_changed',
  'cancelled'
);

-- ---------------------------------------------------------------------------
-- purchase_orders
-- ---------------------------------------------------------------------------
create table public.purchase_orders (
  -- Client-supplied by the app's form id (the create's idempotency key).
  id uuid primary key default gen_random_uuid(),
  -- Always assigned by purchase_orders_enforce_rules on insert (D9).
  po_number text not null default '' unique,
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  status public.purchase_order_status not null default 'draft',
  expected_at date null,
  -- The supplier's order or quote number.
  supplier_reference text null,
  -- No default: the create RPC sets private.shop_currency() (D62).
  currency char(3) not null,
  notes text null,
  -- Null only for rows created outside the app.
  created_by uuid null references public.staff (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz null,
  submitted_by uuid null references public.staff (id) on delete restrict,
  -- When it became fully received.
  received_at timestamptz null,
  cancelled_at timestamptz null,
  cancelled_by uuid null references public.staff (id) on delete restrict,
  cancellation_reason text null,
  constraint purchase_orders_po_number_format check (po_number ~ '^PO-[0-9]{6}$'),
  constraint purchase_orders_supplier_reference_check check (pg_catalog.char_length(supplier_reference) <= 100),
  constraint purchase_orders_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint purchase_orders_notes_check check (pg_catalog.char_length(notes) <= 2000),
  constraint purchase_orders_cancellation_reason_check check (
    cancellation_reason is null
    or (pg_catalog.btrim(cancellation_reason) <> '' and pg_catalog.char_length(cancellation_reason) <= 500)
  ),
  constraint purchase_orders_submitted_shape check ((status = 'draft') = (submitted_at is null) or status = 'cancelled'),
  constraint purchase_orders_received_shape check ((status = 'received') = (received_at is not null)),
  constraint purchase_orders_cancelled_shape check (
    (status = 'cancelled') = (cancelled_at is not null and cancellation_reason is not null)
  )
);

create index purchase_orders_supplier_idx on public.purchase_orders (supplier_id, created_at desc);
create index purchase_orders_status_idx on public.purchase_orders (status, expected_at);
create index purchase_orders_created_by_idx on public.purchase_orders (created_by);
create index purchase_orders_submitted_by_idx on public.purchase_orders (submitted_by);
create index purchase_orders_cancelled_by_idx on public.purchase_orders (cancelled_by);

comment on table public.purchase_orders is
  'Purchase orders (PO-######, SPEC §14). Staff read; every write is a manage_purchasing RPC. Currency = the shop currency at creation (D62).';
comment on column public.purchase_orders.po_number is
  'PO-######, server-assigned from private.next_short_id(''PO'') (D9); immutable.';
comment on column public.purchase_orders.received_at is 'When the PO became fully received (the completing receipt''s received_at).';

create trigger purchase_orders_set_updated_at
  before update on public.purchase_orders
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- purchase_order_lines
-- ---------------------------------------------------------------------------
create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  quantity_ordered integer not null,
  -- Purchase cost (D60). 0 is a known cost (D24 as amended); the bound keeps
  -- 100000 x cost inside numeric(12,2).
  unit_cost public.money_amount not null,
  -- Copied from the PO (D62).
  currency char(3) not null,
  ordered_total public.money_amount generated always as (round(quantity_ordered * unit_cost, 2)) stored,
  -- Overrides the PO's expected_at.
  expected_at date null,
  notes text null,
  created_by uuid null references public.staff (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_order_lines_product_once unique (purchase_order_id, product_id),
  constraint purchase_order_lines_quantity_ordered_check check (quantity_ordered > 0 and quantity_ordered <= 100000),
  constraint purchase_order_lines_unit_cost_check check (unit_cost between 0 and 99999.99),
  constraint purchase_order_lines_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint purchase_order_lines_notes_check check (pg_catalog.char_length(notes) <= 500)
);

create index purchase_order_lines_product_id_idx on public.purchase_order_lines (product_id);
create index purchase_order_lines_created_by_idx on public.purchase_order_lines (created_by);

comment on table public.purchase_order_lines is
  'One product per line per PO (D62); quantity received is derived from purchase_receipt_lines. unit_cost and ordered_total are purchase costs (D60): read through purchase_order_lines_staff.';

create trigger purchase_order_lines_set_updated_at
  before update on public.purchase_order_lines
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- purchase_order_events (append-only, written by triggers)
-- ---------------------------------------------------------------------------
create table public.purchase_order_events (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id) on delete restrict,
  event_type public.purchase_order_event_type not null,
  -- No foreign key: a removed line keeps its events.
  purchase_order_line_id uuid null,
  -- The receiving migration adds the foreign key.
  purchase_receipt_id uuid null,
  -- May carry purchase costs (D60): rows are visible to
  -- private.can_view_purchase_costs() only.
  payload jsonb not null default '{}'::jsonb,
  reason text null,
  -- Null when the change was made outside the app.
  actor_staff_id uuid null references public.staff (id) on delete restrict,
  correlation_id text null,
  created_at timestamptz not null default clock_timestamp(),
  constraint purchase_order_events_payload_object check (pg_catalog.jsonb_typeof(payload) = 'object'),
  constraint purchase_order_events_reason_check check (
    reason is null or (pg_catalog.btrim(reason) <> '' and pg_catalog.char_length(reason) <= 500)
  )
);

create index purchase_order_events_po_idx on public.purchase_order_events (purchase_order_id, created_at);
create index purchase_order_events_actor_staff_id_idx on public.purchase_order_events (actor_staff_id);

comment on table public.purchase_order_events is
  'Append-only PO history (SPEC §2), written by triggers. Payloads carry purchase costs: rows for view_costs or manage_purchasing only (D60).';

create function private.purchase_order_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'purchase_order_history_append_only',
    detail = 'Purchase order history cannot be changed or deleted.';
end;
$$;

create trigger purchase_order_events_append_only
  before update or delete on public.purchase_order_events
  for each row execute function private.purchase_order_events_append_only();

create function private.record_purchase_order_event(
  purchase_order_id uuid,
  event_type public.purchase_order_event_type,
  purchase_order_line_id uuid,
  purchase_receipt_id uuid,
  payload jsonb,
  reason text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into public.purchase_order_events (
    purchase_order_id, event_type, purchase_order_line_id, purchase_receipt_id, payload, reason,
    actor_staff_id, correlation_id
  )
  values (
    record_purchase_order_event.purchase_order_id, record_purchase_order_event.event_type,
    record_purchase_order_event.purchase_order_line_id, record_purchase_order_event.purchase_receipt_id,
    coalesce(record_purchase_order_event.payload, '{}'::jsonb),
    nullif(pg_catalog.btrim(record_purchase_order_event.reason), ''),
    private.current_staff_id(), private.current_correlation_id()
  );
end;
$$;

-- {field: {from, to}} for each listed field whose value differs.
create function private.changed_fields(old_row jsonb, new_row jsonb, fields text[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_object_agg(f, pg_catalog.jsonb_build_object('from', old_row -> f, 'to', new_row -> f)),
    '{}'::jsonb
  )
  from pg_catalog.unnest(fields) f
  where (old_row -> f) is distinct from (new_row -> f);
$$;

-- ---------------------------------------------------------------------------
-- purchase_orders: rules every writer obeys
-- ---------------------------------------------------------------------------
create function private.purchase_orders_enforce_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  supplier_archived timestamptz;
begin
  new.supplier_reference := nullif(pg_catalog.btrim(new.supplier_reference), '');
  new.notes := nullif(pg_catalog.btrim(new.notes), '');
  new.cancellation_reason := nullif(pg_catalog.btrim(new.cancellation_reason), '');

  if tg_op = 'INSERT' then
    -- Server-assigned, whatever the caller sent (D9).
    new.po_number := private.next_short_id('PO');
    new.created_by := coalesce(new.created_by, private.current_staff_id());
  else
    if new.po_number is distinct from old.po_number then
      raise exception using
        errcode = 'P0001',
        message = 'purchase_order_number_immutable',
        detail = 'A purchase order keeps its number for life.';
    end if;
    if new.supplier_id is distinct from old.supplier_id and old.status <> 'draft' then
      raise exception using
        errcode = 'P0001',
        message = 'purchase_order_supplier_locked',
        detail = 'The supplier can change only while the order is a draft.';
    end if;
  end if;

  if tg_op = 'INSERT' or new.supplier_id is distinct from old.supplier_id then
    -- FOR SHARE serialises with a concurrent archive of the supplier (its
    -- guard then sees this PO, or this check sees the archive).
    select s.archived_at into supplier_archived
    from public.suppliers s
    where s.id = new.supplier_id
    for share;
    if found and supplier_archived is not null then
      raise exception using
        errcode = 'P0001',
        message = 'supplier_archived',
        detail = 'That supplier is archived; unarchive it first.';
    end if;
  end if;
  return new;
end;
$$;

create trigger purchase_orders_enforce_rules
  before insert or update on public.purchase_orders
  for each row execute function private.purchase_orders_enforce_rules();

-- History. Changes to created_at, submitted_at or received_at alone write
-- nothing (the seed back-dates them).
create function private.purchase_orders_record_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  details jsonb;
begin
  if tg_op = 'INSERT' then
    perform private.record_purchase_order_event(
      new.id, 'created', null, null,
      pg_catalog.jsonb_build_object('supplier_id', new.supplier_id, 'expected_at', new.expected_at),
      null
    );
    return null;
  end if;

  details := private.changed_fields(
    pg_catalog.to_jsonb(old), pg_catalog.to_jsonb(new),
    array['supplier_id', 'expected_at', 'supplier_reference', 'notes']
  );
  if details <> '{}'::jsonb then
    perform private.record_purchase_order_event(new.id, 'details_changed', null, null, details, private.change_reason());
  end if;

  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status = 'submitted' then
      perform private.record_purchase_order_event(new.id, 'submitted', null, null, '{}'::jsonb, null);
    elsif new.status = 'cancelled' then
      perform private.record_purchase_order_event(
        new.id, 'cancelled', null, null,
        pg_catalog.jsonb_build_object('from', old.status), new.cancellation_reason
      );
    else
      perform private.record_purchase_order_event(
        new.id, 'status_changed', null, null,
        pg_catalog.jsonb_build_object('from', old.status, 'to', new.status), null
      );
    end if;
  end if;
  return null;
end;
$$;

create trigger purchase_orders_record_history
  after insert or update on public.purchase_orders
  for each row execute function private.purchase_orders_record_history();

-- Line history: line_added, line_changed {field: {from, to}} with the change
-- reason, line_removed with the deleted row and the reason.
create function private.purchase_order_lines_record_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  details jsonb;
begin
  if tg_op = 'INSERT' then
    perform private.record_purchase_order_event(
      new.purchase_order_id, 'line_added', new.id, null,
      pg_catalog.jsonb_build_object(
        'product_id', new.product_id,
        'quantity_ordered', new.quantity_ordered,
        'unit_cost', new.unit_cost,
        'expected_at', new.expected_at
      ),
      private.change_reason()
    );
    return null;
  elsif tg_op = 'UPDATE' then
    details := private.changed_fields(
      pg_catalog.to_jsonb(old), pg_catalog.to_jsonb(new),
      array['quantity_ordered', 'unit_cost', 'expected_at', 'notes']
    );
    if details <> '{}'::jsonb then
      perform private.record_purchase_order_event(
        new.purchase_order_id, 'line_changed', new.id, null, details, private.change_reason()
      );
    end if;
    return null;
  end if;

  perform private.record_purchase_order_event(
    old.purchase_order_id, 'line_removed', old.id, null, pg_catalog.to_jsonb(old), private.change_reason()
  );
  return null;
end;
$$;

create trigger purchase_order_lines_record_history
  after insert or update or delete on public.purchase_order_lines
  for each row execute function private.purchase_order_lines_record_history();

-- ---------------------------------------------------------------------------
-- suppliers: an open order keeps its supplier active.
-- ---------------------------------------------------------------------------
create function private.suppliers_guard_open_orders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.archived_at is null and new.archived_at is not null and exists (
    select 1 from public.purchase_orders po
    where po.supplier_id = new.id and po.status in ('draft', 'submitted', 'partially_received')
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'supplier_has_open_orders',
      detail = 'This supplier still has open orders; receive or cancel them first.';
  end if;
  return new;
end;
$$;

create trigger suppliers_guard_open_orders
  before update on public.suppliers
  for each row
  when (old.archived_at is null and new.archived_at is not null)
  execute function private.suppliers_guard_open_orders();

-- ---------------------------------------------------------------------------
-- Private helpers
-- ---------------------------------------------------------------------------

-- Locks a PO (lock order step 1) and returns it; P0002 when missing.
create function private.lock_purchase_order(purchase_order_id uuid)
returns public.purchase_orders
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  po public.purchase_orders;
begin
  select o.* into po from public.purchase_orders o where o.id = lock_purchase_order.purchase_order_id for update;
  if not found then
    raise exception 'purchase order % not found', lock_purchase_order.purchase_order_id using errcode = 'P0002';
  end if;
  return po;
end;
$$;

-- D66 D-REORDER / the PO line sheet: the supplier's last cost for the
-- product, else the product's cost, else 0 (0 is a known cost, D24 amended).
create function private.default_purchase_unit_cost(supplier_id uuid, product_id uuid)
returns public.money_amount
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select sp.last_unit_cost from public.supplier_products sp
      where sp.supplier_id = default_purchase_unit_cost.supplier_id
        and sp.product_id = default_purchase_unit_cost.product_id),
    (select p.default_direct_cost from public.products p where p.id = default_purchase_unit_cost.product_id),
    0
  )::public.money_amount;
$$;

-- ---------------------------------------------------------------------------
-- RPCs (manage_purchasing)
-- ---------------------------------------------------------------------------

-- Creates a draft PO, idempotent by id: the same id with the same supplier
-- returns the PO unchanged (no event); with another supplier it is
-- purchase_order_conflict. Never ON CONFLICT: the BEFORE INSERT trigger
-- would consume private.seq_short_id_po on every replay.
create function public.create_purchase_order(
  id uuid,
  supplier_id uuid,
  expected_at date default null,
  supplier_reference text default null,
  notes text default null
)
returns public.purchase_orders
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  staff uuid := private.require_permission('manage_purchasing');
  existing public.purchase_orders;
  supplier_archived timestamptz;
  result public.purchase_orders;
  err_constraint text;
begin
  if create_purchase_order.id is null or create_purchase_order.supplier_id is null then
    raise exception 'id and supplier_id are required' using errcode = '22004';
  end if;

  select o.* into existing from public.purchase_orders o where o.id = create_purchase_order.id for update;
  if found then
    if existing.supplier_id = create_purchase_order.supplier_id then
      return existing;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'purchase_order_conflict',
      detail = 'That order id is already used for an order with another supplier.';
  end if;

  select s.archived_at into supplier_archived from public.suppliers s where s.id = create_purchase_order.supplier_id;
  if not found then
    raise exception 'supplier % not found', create_purchase_order.supplier_id using errcode = 'P0002';
  end if;
  if supplier_archived is not null then
    raise exception using
      errcode = 'P0001',
      message = 'supplier_archived',
      detail = 'That supplier is archived; unarchive it first.';
  end if;

  begin
    insert into public.purchase_orders as o (
      id, supplier_id, expected_at, supplier_reference, notes, currency, created_by
    )
    values (
      create_purchase_order.id, create_purchase_order.supplier_id, create_purchase_order.expected_at,
      create_purchase_order.supplier_reference, create_purchase_order.notes,
      private.shop_currency()::char(3), staff
    )
    returning o.* into result;
  exception
    when unique_violation then
      get stacked diagnostics err_constraint = constraint_name;
      if err_constraint is distinct from 'purchase_orders_pkey' then
        raise;
      end if;
      select o.* into existing from public.purchase_orders o where o.id = create_purchase_order.id for update;
      if existing.supplier_id = create_purchase_order.supplier_id then
        return existing;
      end if;
      raise exception using
        errcode = 'P0001',
        message = 'purchase_order_conflict',
        detail = 'That order id is already used for an order with another supplier.';
  end;
  return result;
end;
$$;

comment on function public.create_purchase_order(uuid, uuid, date, text, text) is
  'manage_purchasing: create a draft PO in the shop currency (D62); replay-safe by id.';

-- Sets the supplier, expected date, supplier reference and notes exactly
-- (null clears the optional ones). The supplier changes only on a draft.
create function public.update_purchase_order(
  purchase_order_id uuid,
  supplier_id uuid,
  expected_at date,
  supplier_reference text,
  notes text
)
returns public.purchase_orders
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  po public.purchase_orders;
  new_reference text := nullif(pg_catalog.btrim(update_purchase_order.supplier_reference), '');
  new_notes text := nullif(pg_catalog.btrim(update_purchase_order.notes), '');
  result public.purchase_orders;
begin
  perform private.require_permission('manage_purchasing');
  if update_purchase_order.purchase_order_id is null or update_purchase_order.supplier_id is null then
    raise exception 'purchase_order_id and supplier_id are required' using errcode = '22004';
  end if;
  po := private.lock_purchase_order(update_purchase_order.purchase_order_id);
  if po.status in ('received', 'cancelled') then
    raise exception using
      errcode = 'P0001',
      message = 'purchase_order_closed',
      detail = 'This order is closed: it has been fully received or cancelled.';
  end if;
  if update_purchase_order.supplier_id <> po.supplier_id then
    if po.status <> 'draft' then
      raise exception using
        errcode = 'P0001',
        message = 'purchase_order_supplier_locked',
        detail = 'The supplier can change only while the order is a draft.';
    end if;
    if not exists (select 1 from public.suppliers s where s.id = update_purchase_order.supplier_id) then
      raise exception 'supplier % not found', update_purchase_order.supplier_id using errcode = 'P0002';
    end if;
  end if;

  if update_purchase_order.supplier_id = po.supplier_id
     and update_purchase_order.expected_at is not distinct from po.expected_at
     and new_reference is not distinct from po.supplier_reference
     and new_notes is not distinct from po.notes then
    return po;
  end if;

  update public.purchase_orders o
  set supplier_id = update_purchase_order.supplier_id,
      expected_at = update_purchase_order.expected_at,
      supplier_reference = new_reference,
      notes = new_notes
  where o.id = po.id
  returning o.* into result;
  return result;
end;
$$;

comment on function public.update_purchase_order(uuid, uuid, date, text, text) is
  'manage_purchasing: set a PO''s supplier (draft only), expected date, supplier reference and notes; refused once closed.';

-- draft -> submitted. A replay (already submitted or further) returns the PO.
create function public.submit_purchase_order(purchase_order_id uuid)
returns public.purchase_orders
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  staff uuid := private.require_permission('manage_purchasing');
  po public.purchase_orders;
  result public.purchase_orders;
begin
  if submit_purchase_order.purchase_order_id is null then
    raise exception 'purchase_order_id is required' using errcode = '22004';
  end if;
  po := private.lock_purchase_order(submit_purchase_order.purchase_order_id);
  if po.status in ('submitted', 'partially_received', 'received') then
    return po;
  end if;
  if po.status = 'cancelled' then
    raise exception using
      errcode = 'P0001',
      message = 'purchase_order_closed',
      detail = 'This order is cancelled.';
  end if;
  if not exists (select 1 from public.purchase_order_lines l where l.purchase_order_id = po.id) then
    raise exception using
      errcode = 'P0001',
      message = 'purchase_order_needs_lines',
      detail = 'Add at least one line to the order.';
  end if;
  if exists (select 1 from public.suppliers s where s.id = po.supplier_id and s.archived_at is not null) then
    raise exception using
      errcode = 'P0001',
      message = 'supplier_archived',
      detail = 'That supplier is archived; unarchive it first.';
  end if;

  update public.purchase_orders o
  set status = 'submitted', submitted_at = now(), submitted_by = staff
  where o.id = po.id
  returning o.* into result;
  return result;
end;
$$;

comment on function public.submit_purchase_order(uuid) is
  'manage_purchasing: submit a draft PO with at least one line; a replay returns it unchanged.';

-- D61 D-PO-CANCEL: from draft, submitted or partially_received with a
-- reason. Receipts, movements and stock stay. A replay returns the PO.
create function public.cancel_purchase_order(purchase_order_id uuid, reason text)
returns public.purchase_orders
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  staff uuid := private.require_permission('manage_purchasing');
  cleaned text := nullif(pg_catalog.btrim(coalesce(cancel_purchase_order.reason, '')), '');
  po public.purchase_orders;
  result public.purchase_orders;
begin
  if cancel_purchase_order.purchase_order_id is null then
    raise exception 'purchase_order_id is required' using errcode = '22004';
  end if;
  if cleaned is null then
    raise exception using
      errcode = 'P0001',
      message = 'reason_required',
      detail = 'Say why the order is being cancelled.';
  end if;
  if pg_catalog.char_length(cleaned) > 500 then
    raise exception using
      errcode = 'P0001',
      message = 'reason_too_long',
      detail = 'Keep the reason under 500 characters.';
  end if;
  po := private.lock_purchase_order(cancel_purchase_order.purchase_order_id);
  if po.status = 'cancelled' then
    return po;
  end if;
  if po.status = 'received' then
    raise exception using
      errcode = 'P0001',
      message = 'purchase_order_closed',
      detail = 'A fully received order cannot be cancelled.';
  end if;

  update public.purchase_orders o
  set status = 'cancelled', cancelled_at = now(), cancelled_by = staff, cancellation_reason = cleaned
  where o.id = po.id
  returning o.* into result;
  return result;
end;
$$;

comment on function public.cancel_purchase_order(uuid, text) is
  'manage_purchasing: cancel a draft, submitted or partially received PO with a reason (D61); receipts and stock stay.';

-- The PO line sheet's cost prefill (allowed by D60): per known product, the
-- supplier's last cost ('supplier_last'), else the product's cost
-- ('product'), else 0 ('none', only when both are NULL; a stored 0 is a
-- known cost). Unknown ids are omitted.
create function public.purchase_cost_defaults(supplier_id uuid, product_ids uuid[])
returns table (product_id uuid, unit_cost public.money_amount, source text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('manage_purchasing');
  if purchase_cost_defaults.supplier_id is null or purchase_cost_defaults.product_ids is null then
    raise exception 'supplier_id and product_ids are required' using errcode = '22004';
  end if;
  if coalesce(pg_catalog.cardinality(purchase_cost_defaults.product_ids), 0) > 200 then
    raise exception 'at most 200 products at a time' using errcode = '22023';
  end if;
  return query
    select p.id,
           coalesce(sp.last_unit_cost, p.default_direct_cost, 0)::public.money_amount,
           case
             when sp.last_unit_cost is not null then 'supplier_last'
             when p.default_direct_cost is not null then 'product'
             else 'none'
           end
    from public.products p
    left join public.supplier_products sp
      on sp.supplier_id = purchase_cost_defaults.supplier_id and sp.product_id = p.id
    where p.id = any (purchase_cost_defaults.product_ids)
    order by p.id;
end;
$$;

comment on function public.purchase_cost_defaults(uuid, uuid[]) is
  'manage_purchasing: default unit costs for PO lines (supplier last cost, else product cost, else 0) with their source.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function
  private.purchase_order_events_append_only(),
  private.record_purchase_order_event(uuid, public.purchase_order_event_type, uuid, uuid, jsonb, text),
  private.changed_fields(jsonb, jsonb, text[]),
  private.purchase_orders_enforce_rules(),
  private.purchase_orders_record_history(),
  private.purchase_order_lines_record_history(),
  private.suppliers_guard_open_orders(),
  private.lock_purchase_order(uuid),
  private.default_purchase_unit_cost(uuid, uuid),
  public.create_purchase_order(uuid, uuid, date, text, text),
  public.update_purchase_order(uuid, uuid, date, text, text),
  public.submit_purchase_order(uuid),
  public.cancel_purchase_order(uuid, text),
  public.purchase_cost_defaults(uuid, uuid[])
from public, anon, authenticated, service_role;

grant execute on function
  public.create_purchase_order(uuid, uuid, date, text, text),
  public.update_purchase_order(uuid, uuid, date, text, text),
  public.submit_purchase_order(uuid),
  public.cancel_purchase_order(uuid, text),
  public.purchase_cost_defaults(uuid, uuid[])
to authenticated;

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.purchase_order_events enable row level security;

revoke all on table public.purchase_orders from public, anon, authenticated, service_role;
revoke all on table public.purchase_order_lines from public, anon, authenticated, service_role;
revoke all on table public.purchase_order_events from public, anon, authenticated, service_role;

grant select on table public.purchase_orders to authenticated, service_role;

-- Every column except unit_cost and ordered_total (D60). No writes.
grant select (
  id, purchase_order_id, product_id, quantity_ordered, currency, expected_at, notes, created_by,
  created_at, updated_at
) on table public.purchase_order_lines to authenticated;
grant select on table public.purchase_order_lines to service_role;

grant select on table public.purchase_order_events to authenticated, service_role;

create policy purchase_orders_select_staff on public.purchase_orders
  for select to authenticated
  using ((select private.is_staff()));

create policy purchase_order_lines_select_staff on public.purchase_order_lines
  for select to authenticated
  using ((select private.is_staff()));

-- D60: the payloads carry costs.
create policy purchase_order_events_select_purchase_costs on public.purchase_order_events
  for select to authenticated
  using ((select private.is_staff()) and (select private.can_view_purchase_costs()));
