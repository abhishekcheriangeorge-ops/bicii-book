-- Receiving purchase orders: receipts, receipt lines, their link to the stock
-- ledger, PO line edits, the last-cost rule, the costed views and progress
-- reporting (SPEC §2, §12 "purchase_received", §14 "Receive against PO",
-- §23 "Receiving the same purchase receipt twice cannot double stock",
-- §27.2; DATA-MODEL.md §7, §10, §14, §15, §16; PLAN D5, D24 (as amended),
-- D60 D-PO-COSTS, D61 D-PO-CANCEL, D62 D-PO-SCOPE, D63 D-LASTCOST,
-- D64 D-RECEIPT-TIME, D65 D-OVERRECEIPT).
--
-- Rules encoded here, for every writer:
--   * A delivery is recorded once. receive_purchase takes a client
--     idempotency key per submission: a replay with the same key and lines
--     returns the first receipt and writes nothing; the key used for
--     anything else is purchase_receipt_key_reused. Each receipt line
--     writes exactly one purchase_received movement (Phase 4's unique index
--     inventory_movements_receipt_line_once is the ledger backstop; this
--     migration adds the foreign key and requires the link).
--   * Receiving never exceeds what is outstanding (D65): the check runs per
--     PO line under the PO lock; extra units first raise quantity_ordered on
--     an open PO. received and cancelled POs are closed.
--   * Receipts and receipt lines are immutable for every writer; a wrong
--     count is corrected with a reasoned stock adjustment (D65).
--   * D64 D-RECEIPT-TIME: received_at defaults to now, may be back-dated up
--     to 30 days, never more than 5 minutes ahead nor before the PO's
--     submitted_at. Movements keep record time (Phase 4's ledger has no
--     effective date); their reason carries the delivery time in shop time.
--   * D63 D-LASTCOST (refines D5): a receipt sets products.default_direct_cost
--     and the supplier's last cost to its actual unit cost (0 included, D24 as
--     amended) unless a later receipt (by received_at, then recording order)
--     already set it; no snapshot is ever touched.
--   * D60 D-PO-COSTS: receipt costs and totals are purchase costs, read
--     through the *_staff definer views (view_costs or manage_purchasing).
--   * Lock order: the suppliers migration's header. receive_purchase takes the
--     PO row, then private.lock_stock for each product in ascending id, then
--     updates products and supplier_products in ascending product id.

-- ---------------------------------------------------------------------------
-- purchase_receipts
-- ---------------------------------------------------------------------------
create table public.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id) on delete restrict,
  -- The client generates one per submission.
  idempotency_key uuid not null,
  -- The supplier's delivery note.
  reference text null,
  -- When the goods arrived (D64): reports and the last-cost order use it.
  received_at timestamptz not null,
  received_by uuid not null references public.staff (id) on delete restrict,
  notes text null,
  correlation_id text null,
  created_at timestamptz not null default clock_timestamp(),
  constraint purchase_receipts_idempotency_key_key unique (idempotency_key),
  constraint purchase_receipts_reference_check check (pg_catalog.char_length(reference) <= 100),
  constraint purchase_receipts_notes_check check (pg_catalog.char_length(notes) <= 2000)
);

create index purchase_receipts_po_idx on public.purchase_receipts (purchase_order_id, received_at);
create index purchase_receipts_received_by_idx on public.purchase_receipts (received_by);

comment on table public.purchase_receipts is
  'One delivery against a PO (SPEC §14). Immutable; recorded only by receive_purchase, once per idempotency key.';
comment on column public.purchase_receipts.received_at is
  'D64 D-RECEIPT-TIME: when the goods arrived (back-dating up to 30 days); movements keep record time.';

-- ---------------------------------------------------------------------------
-- purchase_receipt_lines
-- ---------------------------------------------------------------------------
create table public.purchase_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_receipt_id uuid not null references public.purchase_receipts (id) on delete restrict,
  purchase_order_line_id uuid not null references public.purchase_order_lines (id) on delete restrict,
  -- Copied from the PO line.
  product_id uuid not null references public.products (id) on delete restrict,
  location_id uuid not null references public.locations (id) on delete restrict,
  -- 1-based input order.
  line_number smallint not null,
  quantity_received integer not null,
  -- Purchase cost (D60); never NULL (an omitted cost is the PO line's), 0 is
  -- a known cost (D24 as amended).
  unit_cost_actual public.money_amount not null,
  -- Copied from the PO.
  currency char(3) not null,
  received_total public.money_amount generated always as (round(quantity_received * unit_cost_actual, 2)) stored,
  created_at timestamptz not null default clock_timestamp(),
  unique (purchase_receipt_id, line_number),
  constraint purchase_receipt_lines_quantity_received_check check (
    quantity_received > 0 and quantity_received <= 100000
  ),
  constraint purchase_receipt_lines_unit_cost_actual_check check (unit_cost_actual between 0 and 99999.99),
  constraint purchase_receipt_lines_currency_check check (currency ~ '^[A-Z]{3}$')
);

create index purchase_receipt_lines_po_line_idx on public.purchase_receipt_lines (purchase_order_line_id);
create index purchase_receipt_lines_product_id_idx on public.purchase_receipt_lines (product_id);
create index purchase_receipt_lines_location_id_idx on public.purchase_receipt_lines (location_id);

comment on table public.purchase_receipt_lines is
  'What one delivery brought for one PO line at one location; one purchase_received movement each. Immutable. unit_cost_actual and received_total are purchase costs (D60).';

create function private.purchase_receipts_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'purchase_receipt_immutable',
    detail = 'A recorded delivery cannot be changed or deleted; correct stock with an adjustment.';
end;
$$;

create trigger purchase_receipts_immutable
  before update or delete on public.purchase_receipts
  for each row execute function private.purchase_receipts_immutable();

create trigger purchase_receipt_lines_immutable
  before update or delete on public.purchase_receipt_lines
  for each row execute function private.purchase_receipts_immutable();

alter table public.purchase_order_events
  add constraint purchase_order_events_purchase_receipt_id_fkey
  foreign key (purchase_receipt_id) references public.purchase_receipts (id) on delete restrict;
create index purchase_order_events_purchase_receipt_id_idx on public.purchase_order_events (purchase_receipt_id);

-- ---------------------------------------------------------------------------
-- The ledger link. One purchase_received movement per receipt line is
-- Phase 4's unique index inventory_movements_receipt_line_once; this adds
-- only the foreign key and the requirement (no second index).
-- ---------------------------------------------------------------------------
alter table public.inventory_movements
  add constraint inventory_movements_purchase_receipt_line_id_fkey
  foreign key (purchase_receipt_line_id) references public.purchase_receipt_lines (id) on delete restrict;
alter table public.inventory_movements
  add constraint inventory_movements_purchase_received_has_receipt_line check (
    movement_type <> 'purchase_received' or purchase_receipt_line_id is not null
  );

-- The purchase twin of private.record_movement (an extension point next to
-- it, DATA-MODEL §7): record_movement has no receipt-line parameter and is
-- left alone (the consignment phase may redefine it). Same rules: currency
-- from the product, P0002 for a missing product or location,
-- location_inactive for an inactive one, check and not-null violations
-- re-raised without the row (unit_cost_snapshot is a hidden column).
create function private.record_receipt_movement(
  product_id uuid,
  location_id uuid,
  quantity integer,
  unit_cost_snapshot public.money_amount,
  purchase_receipt_line_id uuid,
  reason text
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  product_currency char(3);
  location_active boolean;
  inserted bigint;
  err_state text;
  err_constraint text;
  err_table text;
  err_schema text;
  err_column text;
  err_message text;
begin
  select p.currency into product_currency from public.products p where p.id = record_receipt_movement.product_id;
  if not found then
    raise exception 'product % not found', record_receipt_movement.product_id using errcode = 'P0002';
  end if;
  select l.active into location_active from public.locations l where l.id = record_receipt_movement.location_id;
  if not found then
    raise exception 'location % not found', record_receipt_movement.location_id using errcode = 'P0002';
  end if;
  if not location_active then
    raise exception using
      errcode = 'P0001',
      message = 'location_inactive',
      detail = 'That location is inactive; choose another or reactivate it.';
  end if;

  begin
    insert into public.inventory_movements as m (
      product_id, location_id, quantity_delta, movement_type, reason, unit_cost_snapshot,
      purchase_receipt_line_id, currency
    )
    values (
      record_receipt_movement.product_id, record_receipt_movement.location_id,
      record_receipt_movement.quantity, 'purchase_received',
      nullif(pg_catalog.btrim(record_receipt_movement.reason), ''),
      record_receipt_movement.unit_cost_snapshot, record_receipt_movement.purchase_receipt_line_id,
      product_currency
    )
    returning m.id into inserted;
  exception
    when check_violation or not_null_violation then
      get stacked diagnostics
        err_state = returned_sqlstate, err_constraint = constraint_name, err_table = table_name,
        err_schema = schema_name, err_column = column_name, err_message = message_text;
      perform private.raise_without_row(err_state, err_constraint, err_table, err_schema, err_column, err_message);
  end;
  return inserted;
end;
$$;

-- received (every line's received total >= ordered, at completed_at),
-- partially_received (any receipt) or submitted. Acts only on submitted and
-- partially_received POs: received and cancelled are final, drafts wait for
-- submission. The caller holds the PO row lock.
create function private.refresh_purchase_order_status(po_id uuid, completed_at timestamptz)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_status public.purchase_order_status;
  line_count integer;
  complete_count integer;
  any_receipt boolean;
  target public.purchase_order_status;
begin
  select o.status into current_status from public.purchase_orders o where o.id = refresh_purchase_order_status.po_id;
  if not found or current_status not in ('submitted', 'partially_received') then
    return;
  end if;

  select count(*)::integer,
         count(*) filter (where coalesce(r.received, 0) >= l.quantity_ordered)::integer,
         coalesce(sum(r.received), 0) > 0
    into line_count, complete_count, any_receipt
  from public.purchase_order_lines l
  left join lateral (
    select sum(rl.quantity_received)::integer as received
    from public.purchase_receipt_lines rl
    where rl.purchase_order_line_id = l.id
  ) r on true
  where l.purchase_order_id = refresh_purchase_order_status.po_id;

  if not any_receipt then
    any_receipt := exists (
      select 1 from public.purchase_receipts pr where pr.purchase_order_id = refresh_purchase_order_status.po_id
    );
  end if;

  if line_count > 0 and complete_count = line_count then
    target := 'received';
  elsif any_receipt then
    target := 'partially_received';
  else
    target := 'submitted';
  end if;
  if target = current_status then
    return;
  end if;

  update public.purchase_orders o
  set status = target,
      received_at = case when target = 'received' then refresh_purchase_order_status.completed_at end
  where o.id = refresh_purchase_order_status.po_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- PO lines (here because they read receipt lines)
-- ---------------------------------------------------------------------------

-- Adds or changes a PO line, upsert by id. Lock the PO first; closed POs
-- refuse (raising a quantity on a received PO is refused, D65). A new line
-- orders a quantity-tracked, shop-owned, active product in the PO's
-- currency, once per PO (D62). unit_cost 0 is accepted (D24 as amended).
-- Products are read without locks.
create function public.set_purchase_order_line(
  id uuid,
  purchase_order_id uuid,
  product_id uuid,
  quantity_ordered integer,
  unit_cost public.money_amount,
  expected_at date default null,
  notes text default null,
  reason text default null
)
returns public.purchase_order_lines
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  staff uuid := private.require_permission('manage_purchasing');
  cleaned_notes text := nullif(pg_catalog.btrim(set_purchase_order_line.notes), '');
  cleaned_reason text := nullif(pg_catalog.btrim(set_purchase_order_line.reason), '');
  po public.purchase_orders;
  existing public.purchase_order_lines;
  prod public.products;
  received integer;
  result public.purchase_order_lines;
  err_state text;
  err_constraint text;
  err_table text;
  err_schema text;
  err_column text;
  err_message text;
begin
  if set_purchase_order_line.id is null or set_purchase_order_line.purchase_order_id is null
     or set_purchase_order_line.product_id is null or set_purchase_order_line.quantity_ordered is null
     or set_purchase_order_line.unit_cost is null then
    raise exception 'id, purchase_order_id, product_id, quantity_ordered and unit_cost are required'
      using errcode = '22004';
  end if;
  if cleaned_reason is not null and pg_catalog.char_length(cleaned_reason) > 500 then
    raise exception using
      errcode = 'P0001',
      message = 'reason_too_long',
      detail = 'Keep the reason under 500 characters.';
  end if;

  po := private.lock_purchase_order(set_purchase_order_line.purchase_order_id);
  if po.status in ('received', 'cancelled') then
    raise exception using
      errcode = 'P0001',
      message = 'purchase_order_closed',
      detail = 'This order is closed: it has been fully received or cancelled. Extra units go on a new order.';
  end if;

  select l.* into existing from public.purchase_order_lines l where l.id = set_purchase_order_line.id;
  if found then
    if existing.purchase_order_id <> po.id or existing.product_id <> set_purchase_order_line.product_id then
      raise exception using
        errcode = 'P0001',
        message = 'purchase_line_conflict',
        detail = 'That line id is already used for another line.';
    end if;
    select coalesce(sum(rl.quantity_received), 0)::integer into received
    from public.purchase_receipt_lines rl
    where rl.purchase_order_line_id = existing.id;
    if set_purchase_order_line.quantity_ordered < received then
      raise exception using
        errcode = 'P0001',
        message = 'purchase_line_below_received',
        detail = pg_catalog.format('%s already received; the order cannot be for fewer.', received);
    end if;
    if existing.quantity_ordered = set_purchase_order_line.quantity_ordered
       and existing.unit_cost = set_purchase_order_line.unit_cost
       and existing.expected_at is not distinct from set_purchase_order_line.expected_at
       and existing.notes is not distinct from cleaned_notes then
      return existing;
    end if;

    perform private.set_change_reason(cleaned_reason);
    begin
      update public.purchase_order_lines l
      set quantity_ordered = set_purchase_order_line.quantity_ordered,
          unit_cost = set_purchase_order_line.unit_cost,
          expected_at = set_purchase_order_line.expected_at,
          notes = cleaned_notes
      where l.id = existing.id
      returning l.* into result;
    exception
      when check_violation or not_null_violation then
        get stacked diagnostics
          err_state = returned_sqlstate, err_constraint = constraint_name, err_table = table_name,
          err_schema = schema_name, err_column = column_name, err_message = message_text;
        perform private.raise_without_row(err_state, err_constraint, err_table, err_schema, err_column, err_message);
    end;
    perform private.set_change_reason(null);
  else
    select p.* into prod from public.products p where p.id = set_purchase_order_line.product_id;
    if not found then
      raise exception 'product % not found', set_purchase_order_line.product_id using errcode = 'P0002';
    end if;
    if prod.tracking_type <> 'quantity' then
      raise exception using
        errcode = 'P0001',
        message = 'purchase_line_unique_product',
        detail = 'Unique items are registered one by one in Stock, not ordered on a purchase order.';
    end if;
    if prod.ownership_type <> 'shop_owned' then
      raise exception using
        errcode = 'P0001',
        message = 'purchase_line_not_shop_owned',
        detail = 'Only shop-owned products are bought from suppliers.';
    end if;
    if not prod.active or prod.archived_at is not null then
      raise exception using
        errcode = 'P0001',
        message = 'purchase_line_product_inactive',
        detail = 'That product is inactive or archived.';
    end if;
    if prod.currency <> po.currency then
      raise exception using
        errcode = 'P0001',
        message = 'purchase_currency_mismatch',
        detail = pg_catalog.format('The product is priced in %s but the order is in %s.', prod.currency, po.currency);
    end if;
    if exists (
      select 1 from public.purchase_order_lines l
      where l.purchase_order_id = po.id and l.product_id = prod.id
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'purchase_line_duplicate_product',
        detail = 'That product is already on this order; change its line instead.';
    end if;

    perform private.set_change_reason(cleaned_reason);
    begin
      insert into public.purchase_order_lines as l (
        id, purchase_order_id, product_id, quantity_ordered, unit_cost, currency, expected_at, notes, created_by
      )
      values (
        set_purchase_order_line.id, po.id, prod.id, set_purchase_order_line.quantity_ordered,
        set_purchase_order_line.unit_cost, po.currency, set_purchase_order_line.expected_at, cleaned_notes, staff
      )
      returning l.* into result;
    exception
      when check_violation or not_null_violation then
        get stacked diagnostics
          err_state = returned_sqlstate, err_constraint = constraint_name, err_table = table_name,
          err_schema = schema_name, err_column = column_name, err_message = message_text;
        perform private.raise_without_row(err_state, err_constraint, err_table, err_schema, err_column, err_message);
    end;
    perform private.set_change_reason(null);
  end if;

  -- A reduction to the received total can complete a partially received PO.
  perform private.refresh_purchase_order_status(po.id, now());
  return result;
end;
$$;

comment on function public.set_purchase_order_line(uuid, uuid, uuid, integer, public.money_amount, date, text, text) is
  'manage_purchasing: add or change a PO line (upsert by id) on an open PO (D62, D65); 0 is a valid cost.';

-- Removes a line without receipts. On a submitted PO a reason is required
-- and the last line never goes. An unknown id returns no row (replay).
create function public.remove_purchase_order_line(line_id uuid, reason text default null)
returns setof public.purchase_order_lines
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  cleaned text := nullif(pg_catalog.btrim(coalesce(remove_purchase_order_line.reason, '')), '');
  po_id uuid;
  po public.purchase_orders;
  line public.purchase_order_lines;
begin
  perform private.require_permission('manage_purchasing');
  if remove_purchase_order_line.line_id is null then
    raise exception 'line_id is required' using errcode = '22004';
  end if;
  if cleaned is not null and pg_catalog.char_length(cleaned) > 500 then
    raise exception using
      errcode = 'P0001',
      message = 'reason_too_long',
      detail = 'Keep the reason under 500 characters.';
  end if;

  select l.purchase_order_id into po_id from public.purchase_order_lines l where l.id = remove_purchase_order_line.line_id;
  if not found then
    return;
  end if;
  po := private.lock_purchase_order(po_id);
  select l.* into line from public.purchase_order_lines l where l.id = remove_purchase_order_line.line_id;
  if not found then
    return;
  end if;

  if po.status in ('received', 'cancelled') then
    raise exception using
      errcode = 'P0001',
      message = 'purchase_order_closed',
      detail = 'This order is closed: it has been fully received or cancelled.';
  end if;
  if exists (select 1 from public.purchase_receipt_lines rl where rl.purchase_order_line_id = line.id) then
    raise exception using
      errcode = 'P0001',
      message = 'purchase_line_has_receipts',
      detail = 'Part of this line has been received; lower its quantity instead.';
  end if;
  if po.status <> 'draft' then
    if cleaned is null then
      raise exception using
        errcode = 'P0001',
        message = 'reason_required',
        detail = 'Say why the line is being removed from a submitted order.';
    end if;
    if not exists (
      select 1 from public.purchase_order_lines l where l.purchase_order_id = po.id and l.id <> line.id
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'purchase_order_needs_lines',
        detail = 'A submitted order keeps at least one line; cancel the order instead.';
    end if;
  end if;

  perform private.set_change_reason(cleaned);
  delete from public.purchase_order_lines l where l.id = line.id;
  perform private.set_change_reason(null);
  perform private.refresh_purchase_order_status(po.id, now());
  return next line;
end;
$$;

comment on function public.remove_purchase_order_line(uuid, text) is
  'manage_purchasing: remove a PO line without receipts (a reason once submitted; never the last line); no row on a replay.';

-- ---------------------------------------------------------------------------
-- Receiving
-- ---------------------------------------------------------------------------

-- Does `lines` describe the stored receipt? Same number of elements and the
-- same set of (purchase_order_line_id, location_id) keys, each with the same
-- quantity; an element that gives unit_cost_actual must equal the stored
-- cost, one without matches on the other fields alone. Never compares with
-- the PO line's CURRENT unit_cost. Malformed input simply does not match.
create function private.purchase_receipt_matches(receipt_id uuid, lines jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  stored_count integer;
  input_count integer;
  input_keys integer;
  matched integer;
begin
  if pg_catalog.jsonb_typeof(purchase_receipt_matches.lines) is distinct from 'array' then
    return false;
  end if;
  select count(*)::integer into stored_count
  from public.purchase_receipt_lines rl where rl.purchase_receipt_id = purchase_receipt_matches.receipt_id;

  with input as (
    select (e ->> 'purchase_order_line_id')::uuid as line_id,
           (e ->> 'location_id')::uuid as location_id,
           (e ->> 'quantity_received')::numeric as quantity,
           round((e ->> 'unit_cost_actual')::numeric, 2) as cost
    from pg_catalog.jsonb_array_elements(purchase_receipt_matches.lines) e
  )
  select count(*)::integer,
         count(distinct (i.line_id, i.location_id))::integer,
         count(*) filter (where exists (
           select 1 from public.purchase_receipt_lines rl
           where rl.purchase_receipt_id = purchase_receipt_matches.receipt_id
             and rl.purchase_order_line_id = i.line_id
             and rl.location_id = i.location_id
             and rl.quantity_received = i.quantity
             and (i.cost is null or rl.unit_cost_actual = i.cost)
         ))::integer
    into input_count, input_keys, matched
  from input i;

  return input_count = stored_count and input_keys = input_count and matched = input_count;
exception
  when data_exception then
    return false;
end;
$$;

-- Records a delivery against a submitted or partially received PO.
-- Replay-safe by idempotency_key (the first receipt comes back and nothing is
-- written). See the header for the rules; the steps are numbered as in
-- DATA-MODEL §10.
create function public.receive_purchase(
  purchase_order_id uuid,
  idempotency_key uuid,
  lines jsonb,
  reference text default null,
  received_at timestamptz default null,
  notes text default null
)
returns public.purchase_receipts
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  staff uuid;
  po public.purchase_orders;
  existing public.purchase_receipts;
  receipt public.purchase_receipts;
  effective timestamptz;
  n integer;
  elem jsonb;
  ord bigint;
  v_line_id uuid;
  v_location_id uuid;
  v_quantity numeric;
  v_cost numeric;
  pol public.purchase_order_lines;
  loc_active boolean;
  a_line uuid[] := '{}';
  a_location uuid[] := '{}';
  a_quantity integer[] := '{}';
  a_cost public.money_amount[] := '{}';
  a_product uuid[] := '{}';
  a_receipt_line uuid[] := '{}';
  r record;
  inserted uuid;
  movement_reason text;
  cost_reason text;
  candidate public.money_amount;
  current_cost public.money_amount;
  newer_exists boolean;
  supplier_newer boolean;
  err_constraint text;
begin
  -- 1. Guard and arguments.
  staff := private.require_permission('manage_purchasing');
  if receive_purchase.purchase_order_id is null or receive_purchase.idempotency_key is null
     or receive_purchase.lines is null then
    raise exception 'purchase_order_id, idempotency_key and lines are required' using errcode = '22004';
  end if;
  if pg_catalog.jsonb_typeof(receive_purchase.lines) <> 'array' then
    raise exception 'lines must be a JSON array' using errcode = '22023';
  end if;
  n := pg_catalog.jsonb_array_length(receive_purchase.lines);
  if n > 200 then
    raise exception 'at most 200 lines per receipt' using errcode = '22023';
  end if;
  if n = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'purchase_receipt_empty',
      detail = 'Enter at least one received line.';
  end if;

  -- 2. Fast path: a replay of this submission returns its receipt and writes
  -- nothing.
  select pr.* into existing from public.purchase_receipts pr where pr.idempotency_key = receive_purchase.idempotency_key;
  if found then
    if existing.purchase_order_id = receive_purchase.purchase_order_id
       and private.purchase_receipt_matches(existing.id, receive_purchase.lines) then
      return existing;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'purchase_receipt_key_reused',
      detail = 'This submission was already recorded with other lines or on another order.';
  end if;

  -- 3. Lock the PO (lock order step 1), then repeat step 2: a concurrent call
  -- with the same key may have committed while this one waited.
  po := private.lock_purchase_order(receive_purchase.purchase_order_id);
  select pr.* into existing from public.purchase_receipts pr where pr.idempotency_key = receive_purchase.idempotency_key;
  if found then
    if existing.purchase_order_id = po.id
       and private.purchase_receipt_matches(existing.id, receive_purchase.lines) then
      return existing;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'purchase_receipt_key_reused',
      detail = 'This submission was already recorded with other lines or on another order.';
  end if;

  -- 4. Status.
  if po.status = 'draft' then
    raise exception using
      errcode = 'P0001',
      message = 'purchase_order_not_submitted',
      detail = 'Submit the order before receiving against it.';
  end if;
  if po.status in ('received', 'cancelled') then
    raise exception using
      errcode = 'P0001',
      message = 'purchase_order_closed',
      detail = 'This order is closed: it has been fully received or cancelled. Extra units go on a new order.';
  end if;

  -- 5. Parse and validate each element, in input order.
  for elem, ord in
    select e.value, e.ordinality from pg_catalog.jsonb_array_elements(receive_purchase.lines) with ordinality e
  loop
    if pg_catalog.jsonb_typeof(elem) <> 'object' then
      raise exception 'line % is not an object', ord using errcode = '22023';
    end if;
    v_line_id := (elem ->> 'purchase_order_line_id')::uuid;
    v_location_id := (elem ->> 'location_id')::uuid;
    if v_line_id is null or v_location_id is null then
      raise exception 'line % needs purchase_order_line_id and location_id', ord using errcode = '22023';
    end if;
    v_quantity := (elem ->> 'quantity_received')::numeric;
    if v_quantity is null or v_quantity <= 0 or v_quantity <> pg_catalog.trunc(v_quantity) or v_quantity > 100000 then
      raise exception using
        errcode = 'P0001',
        message = 'purchase_receipt_quantity_invalid',
        detail = 'Enter a whole number of units received, at least 1.';
    end if;

    select l.* into pol from public.purchase_order_lines l where l.id = v_line_id;
    if not found or pol.purchase_order_id <> po.id then
      raise exception using
        errcode = 'P0001',
        message = 'purchase_receipt_line_foreign',
        detail = 'That line is not on this order.';
    end if;

    if elem ? 'unit_cost_actual' and pg_catalog.jsonb_typeof(elem -> 'unit_cost_actual') <> 'null' then
      v_cost := (elem ->> 'unit_cost_actual')::numeric;
      if v_cost < 0 or v_cost > 99999.99 then
        raise exception using
          errcode = 'P0001',
          message = 'purchase_receipt_cost_invalid',
          detail = 'Enter a unit cost between 0 and 99,999.99.';
      end if;
    else
      -- An omitted cost is the PO line's (receipt costs are never NULL).
      v_cost := pol.unit_cost;
    end if;

    select l.active into loc_active from public.locations l where l.id = v_location_id;
    if not found then
      raise exception 'location % not found', v_location_id using errcode = 'P0002';
    end if;
    if not loc_active then
      raise exception using
        errcode = 'P0001',
        message = 'location_inactive',
        detail = 'That location is inactive; choose another or reactivate it.';
    end if;

    if exists (
      select 1 from unnest(a_line, a_location) u(l, x) where u.l = v_line_id and u.x = v_location_id
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'purchase_receipt_line_duplicate',
        detail = 'The same order line appears twice for one location; combine them.';
    end if;

    a_line := a_line || v_line_id;
    a_location := a_location || v_location_id;
    a_quantity := a_quantity || v_quantity::integer;
    a_cost := a_cost || v_cost::public.money_amount;
    a_product := a_product || pol.product_id;
  end loop;

  -- 6. Over-receipt, per PO line under the PO lock; nothing is written when
  -- any line fails (D65).
  for r in
    select u.line_ref, sum(u.qty)::integer as attempted,
           pl.quantity_ordered, p.name as product_name, p.short_id,
           coalesce((
             select sum(rl.quantity_received) from public.purchase_receipt_lines rl
             where rl.purchase_order_line_id = u.line_ref
           ), 0)::integer as received
    from unnest(a_line, a_quantity) u(line_ref, qty)
    join public.purchase_order_lines pl on pl.id = u.line_ref
    join public.products p on p.id = pl.product_id
    group by u.line_ref, pl.quantity_ordered, p.name, p.short_id
    order by u.line_ref
  loop
    if r.received + r.attempted > r.quantity_ordered then
      raise exception using
        errcode = 'P0001',
        message = 'purchase_over_receipt',
        detail = pg_catalog.format(
          '%s (%s): ordered %s, already received %s, this delivery %s.',
          r.product_name, r.short_id, r.quantity_ordered, r.received, r.attempted
        );
    end if;
  end loop;

  -- 7. When (D64).
  effective := coalesce(receive_purchase.received_at, now());
  if effective > now() + interval '5 minutes' then
    raise exception using
      errcode = 'P0001',
      message = 'purchase_receipt_in_future',
      detail = 'The delivery date is in the future.';
  end if;
  if effective < now() - interval '30 days' then
    raise exception using
      errcode = 'P0001',
      message = 'purchase_receipt_too_old',
      detail = 'A delivery can be back-dated by at most 30 days.';
  end if;
  if effective < po.submitted_at then
    raise exception using
      errcode = 'P0001',
      message = 'purchase_receipt_before_submission',
      detail = 'The delivery date is before the order was submitted.';
  end if;

  -- 8. The receipt; a concurrent call with the same key on another order
  -- meets the unique key and gets step 2's answer.
  begin
    insert into public.purchase_receipts as pr (
      purchase_order_id, idempotency_key, reference, received_at, received_by, notes, correlation_id
    )
    values (
      po.id, receive_purchase.idempotency_key, nullif(pg_catalog.btrim(receive_purchase.reference), ''),
      effective, staff, nullif(pg_catalog.btrim(receive_purchase.notes), ''), private.current_correlation_id()
    )
    returning pr.* into receipt;
  exception
    when unique_violation then
      get stacked diagnostics err_constraint = constraint_name;
      if err_constraint is distinct from 'purchase_receipts_idempotency_key_key' then
        raise;
      end if;
      select pr.* into existing from public.purchase_receipts pr where pr.idempotency_key = receive_purchase.idempotency_key;
      if existing.purchase_order_id = po.id
         and private.purchase_receipt_matches(existing.id, receive_purchase.lines) then
        return existing;
      end if;
      raise exception using
        errcode = 'P0001',
        message = 'purchase_receipt_key_reused',
        detail = 'This submission was already recorded with other lines or on another order.';
  end;

  -- 9. The stock locks (lock order step 3), ascending, before any receipt
  -- line or movement.
  for r in select distinct u.p from unnest(a_product) u(p) order by u.p loop
    perform private.lock_stock(r.p);
  end loop;

  -- 10. Receipt lines in input order, then one movement per receipt line.
  for i in 1 .. n loop
    insert into public.purchase_receipt_lines as rl (
      purchase_receipt_id, purchase_order_line_id, product_id, location_id, line_number,
      quantity_received, unit_cost_actual, currency
    )
    values (
      receipt.id, a_line[i], a_product[i], a_location[i], i, a_quantity[i], a_cost[i], po.currency
    )
    returning rl.id into inserted;
    a_receipt_line := a_receipt_line || inserted;
  end loop;

  movement_reason := po.po_number || ' received '
    || pg_catalog.to_char(effective at time zone private.shop_timezone(), 'FMDD Mon YYYY HH24:MI');
  for r in
    select u.p, u.l, u.q, u.c, u.rl
    from unnest(a_product, a_location, a_quantity, a_cost, a_receipt_line) with ordinality
      u(p, l, q, c, rl, n)
    order by u.p, u.l, u.n
  loop
    perform private.record_receipt_movement(r.p, r.l, r.q, r.c, r.rl, movement_reason);
  end loop;

  -- 11. Last cost (D5 as refined by D63 D-LASTCOST): per product in
  -- ascending id, the cost of its highest line_number line here, unless a
  -- later receipt (by received_at, then recording order) already set it.
  cost_reason := 'Received on ' || po.po_number || coalesce(' (delivery note ' || receipt.reference || ')', '');
  perform private.set_change_reason(cost_reason);
  for r in
    select distinct on (u.p) u.p, u.c
    from unnest(a_product, a_cost) with ordinality u(p, c, n)
    order by u.p, u.n desc
  loop
    candidate := r.c;
    newer_exists := exists (
      select 1
      from public.purchase_receipt_lines rl
      join public.purchase_receipts pr on pr.id = rl.purchase_receipt_id
      where rl.product_id = r.p
        and pr.id <> receipt.id
        and (pr.received_at, pr.created_at, pr.id) > (receipt.received_at, receipt.created_at, receipt.id)
    );
    if not newer_exists then
      select p.default_direct_cost into current_cost from public.products p where p.id = r.p;
      if current_cost is distinct from candidate then
        update public.products p set default_direct_cost = candidate where p.id = r.p;
      end if;
    end if;
  end loop;
  perform private.set_change_reason(null);

  for r in
    select distinct on (u.p) u.p, u.c
    from unnest(a_product, a_cost) with ordinality u(p, c, n)
    order by u.p, u.n desc
  loop
    supplier_newer := exists (
      select 1
      from public.purchase_receipt_lines rl
      join public.purchase_receipts pr on pr.id = rl.purchase_receipt_id
      join public.purchase_orders o on o.id = pr.purchase_order_id
      where rl.product_id = r.p
        and o.supplier_id = po.supplier_id
        and pr.id <> receipt.id
        and (pr.received_at, pr.created_at, pr.id) > (receipt.received_at, receipt.created_at, receipt.id)
    );
    insert into public.supplier_products as sp (
      supplier_id, product_id, last_unit_cost, currency, last_received_at
    )
    values (po.supplier_id, r.p, r.c, po.currency, effective)
    on conflict on constraint supplier_products_pkey do update
    set last_unit_cost = case when supplier_newer then sp.last_unit_cost else excluded.last_unit_cost end,
        last_received_at = greatest(sp.last_received_at, excluded.last_received_at),
        currency = excluded.currency;
  end loop;

  -- 12. History: the delivery.
  perform private.record_purchase_order_event(
    po.id, 'received', null, receipt.id,
    pg_catalog.jsonb_build_object(
      'reference', receipt.reference,
      'received_at', effective,
      'units', (select sum(q) from unnest(a_quantity) q),
      'lines', (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'purchase_order_line_id', u.l,
            'product_id', u.p,
            'quantity_received', u.q,
            'location_id', u.x
          ) order by u.n
        )
        from unnest(a_line, a_product, a_quantity, a_location) with ordinality u(l, p, q, x, n)
      )
    ),
    null
  );

  -- 13. Then the status, so its status_changed event follows 'received'.
  perform private.refresh_purchase_order_status(po.id, effective);

  -- 14.
  return receipt;
end;
$$;

comment on function public.receive_purchase(uuid, uuid, jsonb, text, timestamptz, text) is
  'manage_purchasing: record a delivery against a submitted PO (stock, last cost, status); replay-safe by idempotency_key (D63, D64, D65).';

-- After a lost response: the receipt recorded under this key, if any.
create function public.purchase_receipt_by_key(idempotency_key uuid)
returns setof public.purchase_receipts
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('manage_purchasing');
  return query
    select pr.* from public.purchase_receipts pr where pr.idempotency_key = purchase_receipt_by_key.idempotency_key;
end;
$$;

comment on function public.purchase_receipt_by_key(uuid) is
  'manage_purchasing: the receipt recorded under an idempotency key (zero or one row).';

-- ---------------------------------------------------------------------------
-- Costed views (D60). Definer views (they read columns authenticated has no
-- grant on), security_barrier, filtered by private.can_view_purchase_costs().
-- Totals are computed here, never in TypeScript.
-- ---------------------------------------------------------------------------
create view public.purchase_order_lines_staff
with (security_barrier)
as
  select l.id as purchase_order_line_id,
         l.purchase_order_id,
         l.product_id,
         l.unit_cost,
         l.ordered_total,
         coalesce(r.received_value, 0)::public.money_amount as received_value,
         l.currency
  from public.purchase_order_lines l
  left join lateral (
    select sum(rl.received_total) as received_value
    from public.purchase_receipt_lines rl
    where rl.purchase_order_line_id = l.id
  ) r on true
  where (select private.can_view_purchase_costs());

comment on view public.purchase_order_lines_staff is
  'D60 D-PO-COSTS: PO line unit cost, ordered total and received value, for view_costs or manage_purchasing only.';

create view public.purchase_receipt_lines_staff
with (security_barrier)
as
  select rl.id as purchase_receipt_line_id,
         rl.purchase_receipt_id,
         rl.unit_cost_actual,
         rl.received_total,
         rl.currency
  from public.purchase_receipt_lines rl
  where (select private.can_view_purchase_costs());

comment on view public.purchase_receipt_lines_staff is
  'D60 D-PO-COSTS: receipt line actual cost and total, for view_costs or manage_purchasing only.';

create view public.purchase_order_totals_staff
with (security_barrier)
as
  select po.id as purchase_order_id,
         po.currency,
         coalesce(t.ordered_total, 0)::public.money_amount as ordered_total,
         coalesce(t.received_total, 0)::public.money_amount as received_total,
         (case when po.status in ('submitted', 'partially_received') then coalesce(t.outstanding_total, 0)
               else 0 end)::public.money_amount as outstanding_total
  from public.purchase_orders po
  left join lateral (
    select sum(l.ordered_total) as ordered_total,
           sum(r.received_total) as received_total,
           sum(round(greatest(l.quantity_ordered - coalesce(r.received, 0), 0) * l.unit_cost, 2)) as outstanding_total
    from public.purchase_order_lines l
    left join lateral (
      select sum(rl.quantity_received) as received, sum(rl.received_total) as received_total
      from public.purchase_receipt_lines rl
      where rl.purchase_order_line_id = l.id
    ) r on true
    where l.purchase_order_id = po.id
  ) t on true
  where (select private.can_view_purchase_costs());

comment on view public.purchase_order_totals_staff is
  'D60 D-PO-COSTS: per PO, ordered, received and outstanding value (outstanding only while submitted or partially received).';

-- ---------------------------------------------------------------------------
-- Progress reporting (invoker views, no cost columns; staff-only through the
-- base tables' RLS).
-- ---------------------------------------------------------------------------

-- Not a competing calendar helper: it delegates to Phase 5's
-- private.shop_today() so an invoker view can use the shop day
-- (authenticated has no EXECUTE on the Phase 5 helpers, and once Phase 2's
-- bodies read shop_settings this definer wrapper reads it as the owner).
create function private.purchasing_shop_today()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select private.shop_today();
$$;

create view reporting.purchase_order_progress
with (security_invoker = true)
as
  select po.id as purchase_order_id,
         po.po_number,
         po.supplier_id,
         po.status as po_status,
         l.id as purchase_order_line_id,
         l.product_id,
         l.quantity_ordered,
         coalesce(r.received, 0)::integer as quantity_received,
         (case when po.status in ('draft', 'submitted', 'partially_received')
            then greatest(l.quantity_ordered - coalesce(r.received, 0), 0) else 0 end)::integer
           as quantity_outstanding,
         (case when po.status = 'cancelled'
            then greatest(l.quantity_ordered - coalesce(r.received, 0), 0) else 0 end)::integer
           as quantity_cancelled,
         coalesce(l.expected_at, po.expected_at) as expected_at,
         r.last_received_at,
         coalesce(
           po.status in ('submitted', 'partially_received')
           and l.quantity_ordered - coalesce(r.received, 0) > 0
           and coalesce(l.expected_at, po.expected_at) < private.purchasing_shop_today(),
           false
         ) as is_overdue
  from public.purchase_orders po
  join public.purchase_order_lines l on l.purchase_order_id = po.id
  left join lateral (
    select sum(rl.quantity_received)::integer as received, max(pr.received_at) as last_received_at
    from public.purchase_receipt_lines rl
    join public.purchase_receipts pr on pr.id = rl.purchase_receipt_id
    where rl.purchase_order_line_id = l.id
  ) r on true;

comment on view reporting.purchase_order_progress is
  'One row per PO line: ordered, received, outstanding (open POs) and cancelled (D61) quantities; overdue against the shop day (D35).';

create view reporting.product_on_order
with (security_invoker = true)
as
  select pp.product_id,
         sum(pp.quantity_outstanding)::integer as quantity_on_order,
         count(distinct pp.purchase_order_id)::integer as open_purchase_orders,
         min(pp.expected_at) as next_expected_at
  from reporting.purchase_order_progress pp
  where pp.po_status in ('submitted', 'partially_received')
    and pp.quantity_outstanding > 0
  group by pp.product_id;

comment on view reporting.product_on_order is
  'Per product: units still to come on submitted and partially received POs (never drafts, D66), how many POs and the next expected date.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function
  private.purchase_receipts_immutable(),
  private.record_receipt_movement(uuid, uuid, integer, public.money_amount, uuid, text),
  private.refresh_purchase_order_status(uuid, timestamptz),
  private.purchase_receipt_matches(uuid, jsonb),
  private.purchasing_shop_today(),
  public.set_purchase_order_line(uuid, uuid, uuid, integer, public.money_amount, date, text, text),
  public.remove_purchase_order_line(uuid, text),
  public.receive_purchase(uuid, uuid, jsonb, text, timestamptz, text),
  public.purchase_receipt_by_key(uuid)
from public, anon, authenticated, service_role;

-- The progress view runs as the caller.
grant execute on function private.purchasing_shop_today() to authenticated;

grant execute on function
  public.set_purchase_order_line(uuid, uuid, uuid, integer, public.money_amount, date, text, text),
  public.remove_purchase_order_line(uuid, text),
  public.receive_purchase(uuid, uuid, jsonb, text, timestamptz, text),
  public.purchase_receipt_by_key(uuid)
to authenticated;

alter table public.purchase_receipts enable row level security;
alter table public.purchase_receipt_lines enable row level security;

revoke all on table public.purchase_receipts from public, anon, authenticated, service_role;
revoke all on table public.purchase_receipt_lines from public, anon, authenticated, service_role;
revoke all on table public.purchase_order_lines_staff from public, anon, authenticated, service_role;
revoke all on table public.purchase_receipt_lines_staff from public, anon, authenticated, service_role;
revoke all on table public.purchase_order_totals_staff from public, anon, authenticated, service_role;
revoke all on table reporting.purchase_order_progress from public, anon, authenticated, service_role;
revoke all on table reporting.product_on_order from public, anon, authenticated, service_role;

grant select on table public.purchase_receipts to authenticated, service_role;

-- Every column except unit_cost_actual and received_total (D60). No writes.
grant select (
  id, purchase_receipt_id, purchase_order_line_id, product_id, location_id, line_number,
  quantity_received, currency, created_at
) on table public.purchase_receipt_lines to authenticated;
grant select on table public.purchase_receipt_lines to service_role;

grant select on table public.purchase_order_lines_staff to authenticated;
grant select on table public.purchase_receipt_lines_staff to authenticated;
grant select on table public.purchase_order_totals_staff to authenticated;
grant select on table reporting.purchase_order_progress to authenticated;
grant select on table reporting.product_on_order to authenticated;

create policy purchase_receipts_select_staff on public.purchase_receipts
  for select to authenticated
  using ((select private.is_staff()));

create policy purchase_receipt_lines_select_staff on public.purchase_receipt_lines
  for select to authenticated
  using ((select private.is_staff()));
