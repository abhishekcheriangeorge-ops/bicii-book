-- Parts on jobs: add_inventory_line, the void_line stock reversal and the
-- unit rule at completion and reopen (SPEC §2, §9 "If an inventory line
-- consumed stock, voiding/reducing it creates a reversing movement", §12 "A
-- work-order part consumes stock exactly once", §23, §25; DATA-MODEL.md §4,
-- §5, §7, §16; PLAN D1, D6, D14, D15, D16, D23 NEG-CONSUMPTION,
-- D24 PART-PRICE-COST, D25 SOLD-AT-COMPLETION, D27 SHOP-OWNED-ONLY).
--
-- Rules encoded here:
--   * A part line consumes stock exactly once: add_inventory_line takes the
--     client's line id as its idempotency key; a replay returns the line and
--     its movement (inventory_movements_job_consumption_once is the
--     backstop). A unit is on at most one live line
--     (work_order_line_items_unit_once).
--   * Voiding a part line writes a linked reversal (reversal_of_id) and
--     never erases the original movement; a unit goes back to available.
--   * A unit on a job is held_for_customer while the job is open and sold
--     when the job is completed (D25, refining D6); a reopen returns it to
--     held_for_customer with no stock movement, and re-completion sells it
--     again. Lines change only while the job is open (D15): to return a
--     part from a completed job, reopen it and void the line.
--   * A job with a live line, parts included, is not cancelled (D16: Phase
--     3's work_order_has_lines covers it; nothing is added here).
--   * Lock order: see the inventory migration's header (work order, line,
--     stock, bike, units, product).

-- ---------------------------------------------------------------------------
-- Line sources get their foreign keys (Phase 3 left them open).
-- ---------------------------------------------------------------------------
alter table public.work_order_line_items
  add constraint work_order_line_items_source_product_id_fkey
  foreign key (source_product_id) references public.products (id) on delete restrict;
alter table public.work_order_line_items
  add constraint work_order_line_items_source_inventory_unit_id_fkey
  foreign key (source_inventory_unit_id) references public.inventory_units (id) on delete restrict;
create index work_order_line_items_source_inventory_unit_id_idx
  on public.work_order_line_items (source_inventory_unit_id);
-- A unit is on at most one live line.
create unique index work_order_line_items_unit_once
  on public.work_order_line_items (source_inventory_unit_id)
  where voided_at is null and source_inventory_unit_id is not null;

-- add_inventory_line's result: never a cost.
create type public.inventory_line_result as (
  line_id uuid,
  movement_id bigint,
  location_id uuid,
  on_hand_after integer,
  replayed boolean
);

-- ---------------------------------------------------------------------------
-- add_inventory_line
-- ---------------------------------------------------------------------------

-- The replay answer for an existing line id: the same job, type, product,
-- unit and quantity return the line with its job_consumption movement and
-- the current on-hand there; anything else is line_conflict (a foreign line
-- id never comes back as a successful replay).
create function private.inventory_line_replay(
  existing public.work_order_line_items,
  work_order_id uuid,
  product_id uuid,
  inventory_unit_id uuid,
  quantity integer
)
returns public.inventory_line_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  consumption public.inventory_movements;
  result public.inventory_line_result;
begin
  if existing.work_order_id is distinct from inventory_line_replay.work_order_id
     or existing.line_type is distinct from 'inventory'
     or existing.source_product_id is distinct from inventory_line_replay.product_id
     or existing.source_inventory_unit_id is distinct from inventory_line_replay.inventory_unit_id
     or existing.quantity is distinct from inventory_line_replay.quantity::numeric then
    raise exception using
      errcode = 'P0001',
      message = 'line_conflict',
      detail = 'That line id is already used for another line.';
  end if;
  select m.* into consumption from public.inventory_movements m
  where m.work_order_line_item_id = existing.id and m.movement_type = 'job_consumption';
  result := row(
    existing.id,
    consumption.id,
    consumption.location_id,
    case when consumption.id is not null
      then private.stock_on_hand(consumption.product_id, consumption.location_id) end,
    true
  );
  return result;
end;
$$;

-- Active staff (any). Adds a part to an open job: the line (snapshotting
-- the price, the cost and the Cult Commons rate), its job_consumption
-- movement and, for a unique unit, held_for_customer. The order is exact:
-- (1) lock the job; (2) lock the stock (and the unit); (3) replay check,
-- before the open check, so a replay after completion still returns the
-- line; (4) open check (D15); (5) validation; (6) effects.
create function public.add_inventory_line(
  line_id uuid,
  work_order_id uuid,
  product_id uuid,
  quantity integer default 1,
  location_id uuid default null,
  inventory_unit_id uuid default null,
  unit_sale_price public.money_amount default null
)
returns public.inventory_line_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_staff();
  wo public.work_orders;
  unit public.inventory_units;
  existing public.work_order_line_items;
  prod public.products;
  chosen_location uuid;
  chosen_location_name text;
  loc_active boolean;
  sale_price public.money_amount;
  direct_cost public.money_amount;
  description text;
  inserted uuid;
  movement bigint;
  on_hand integer;
  result public.inventory_line_result;
  err_state text;
  err_constraint text;
  err_table text;
  err_schema text;
  err_column text;
  err_message text;
begin
  if add_inventory_line.line_id is null or add_inventory_line.work_order_id is null
     or add_inventory_line.product_id is null or add_inventory_line.quantity is null then
    raise exception 'line_id, work_order_id, product_id and quantity are required' using errcode = '22004';
  end if;

  -- (1) The job FOR UPDATE: completion, reopen and cancellation of this job
  -- are fully serialised with this call.
  wo := private.lock_work_order(add_inventory_line.work_order_id);
  -- (2) The stock (both tracking types, so the replay check is serialised),
  -- then the unit.
  perform private.lock_stock(add_inventory_line.product_id);
  if add_inventory_line.inventory_unit_id is not null then
    select u.* into unit from public.inventory_units u where u.id = add_inventory_line.inventory_unit_id for update;
    if not found then
      raise exception 'unit % not found', add_inventory_line.inventory_unit_id using errcode = 'P0002';
    end if;
  end if;

  -- (3) Replay.
  select li.* into existing from public.work_order_line_items li where li.id = add_inventory_line.line_id;
  if found then
    return private.inventory_line_replay(
      existing, wo.id, add_inventory_line.product_id, add_inventory_line.inventory_unit_id,
      add_inventory_line.quantity
    );
  end if;

  -- (4) Only an open job takes lines (D15).
  perform private.require_open_work_order(wo.id);

  -- (5) Validation.
  if add_inventory_line.quantity < 1 or add_inventory_line.quantity > 999 then
    raise exception using
      errcode = 'P0001',
      message = 'quantity_invalid',
      detail = 'Add between 1 and 999.';
  end if;
  select p.* into prod from public.products p where p.id = add_inventory_line.product_id;
  if not found then
    raise exception 'product % not found', add_inventory_line.product_id using errcode = 'P0002';
  end if;
  if prod.archived_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'product_archived',
      detail = 'That product is archived.';
  end if;
  if not prod.active then
    raise exception using
      errcode = 'P0001',
      message = 'product_inactive',
      detail = 'That product is inactive.';
  end if;
  if prod.currency <> wo.currency then
    raise exception using
      errcode = 'P0001',
      message = 'currency_mismatch',
      detail = 'That product is priced in another currency than the job.';
  end if;
  -- D27 SHOP-OWNED-ONLY: consignment and customer_owned stock is never a
  -- job part. Phase 6 keeps this refusal (its backstop trigger raises the
  -- same code) and does NOT replace this function.
  if prod.ownership_type <> 'shop_owned' then
    raise exception using
      errcode = 'P0001',
      message = 'ownership_not_saleable',
      detail = 'That item is not shop stock, so it cannot be used on a job.';
  end if;

  if prod.tracking_type = 'quantity' then
    if add_inventory_line.inventory_unit_id is not null then
      raise exception using
        errcode = 'P0001',
        message = 'unit_product_mismatch',
        detail = 'That unit does not belong to this product.';
    end if;
    if add_inventory_line.location_id is null then
      -- The default location: the active one with the lowest (sort_order, name).
      select l.id into chosen_location from public.locations l
      where l.active
      order by l.sort_order, l.name
      limit 1;
      if not found then
        raise exception using
          errcode = 'P0001',
          message = 'location_required',
          detail = 'There is no active stock location; add one first.';
      end if;
    else
      select l.active into loc_active from public.locations l where l.id = add_inventory_line.location_id;
      if not found then
        raise exception 'location % not found', add_inventory_line.location_id using errcode = 'P0002';
      end if;
      if not loc_active then
        raise exception using
          errcode = 'P0001',
          message = 'location_inactive',
          detail = 'That location is inactive; choose another or reactivate it.';
      end if;
      chosen_location := add_inventory_line.location_id;
    end if;
    -- D23 NEG-CONSUMPTION: on-hand may go below zero here (the part was
    -- physically used); the UI warns and reporting shows it.
  else
    if add_inventory_line.inventory_unit_id is null then
      raise exception using
        errcode = 'P0001',
        message = 'unit_required',
        detail = 'Choose which unit goes on the job.';
    end if;
    if add_inventory_line.quantity <> 1 then
      raise exception using
        errcode = 'P0001',
        message = 'quantity_invalid',
        detail = 'A unique item is added one at a time.';
    end if;
    if unit.product_id <> prod.id then
      raise exception using
        errcode = 'P0001',
        message = 'unit_product_mismatch',
        detail = 'That unit does not belong to this product.';
    end if;
    if unit.ownership_type <> 'shop_owned' then
      raise exception using
        errcode = 'P0001',
        message = 'ownership_not_saleable',
        detail = 'That item is not shop stock, so it cannot be used on a job.';
    end if;
    if unit.status <> 'available' or unit.archived_at is not null then
      raise exception using
        errcode = 'P0001',
        message = 'unit_not_available',
        detail = 'That unit is not available.';
    end if;
    if add_inventory_line.location_id is not null and add_inventory_line.location_id <> unit.location_id then
      raise exception using
        errcode = 'P0001',
        message = 'unit_location_mismatch',
        detail = 'That unit is somewhere else.';
    end if;
    chosen_location := unit.location_id;
  end if;

  -- D24 PART-PRICE-COST: both must be known. Any staff member may override
  -- the price (D14); the cost is never overridden.
  sale_price := coalesce(
    add_inventory_line.unit_sale_price,
    private.selling_price(prod.id, add_inventory_line.inventory_unit_id)
  );
  if sale_price is null then
    raise exception using
      errcode = 'P0001',
      message = 'part_price_missing',
      detail = 'This part has no sale price; enter one.';
  end if;
  direct_cost := coalesce(unit.direct_cost, prod.default_direct_cost);
  if direct_cost is null then
    raise exception using
      errcode = 'P0001',
      message = 'part_cost_missing',
      detail = 'This part has no cost yet, so its yield cannot be worked out.';
  end if;

  description := case
    when unit.id is null then prod.name
    else prod.name || ' · ' || unit.short_id || coalesce(' · S/N ' || unit.serial_number, '')
  end;

  -- (6) Effects. The line (Phase 3's trigger writes line_added).
  begin
    insert into public.work_order_line_items as li (
      id, work_order_id, line_type, source_product_id, source_inventory_unit_id, description_snapshot,
      quantity, unit_sale_price_snapshot, unit_direct_cost_snapshot, cost_pending,
      cult_commons_rate_snapshot, currency, created_by
    )
    values (
      add_inventory_line.line_id, wo.id, 'inventory', prod.id, unit.id, pg_catalog.left(description, 300),
      add_inventory_line.quantity, sale_price, direct_cost, false,
      private.cult_commons_rate_at(pg_catalog.clock_timestamp()), wo.currency, actor
    )
    on conflict (id) do nothing
    returning li.id into inserted;
  exception
    when check_violation or not_null_violation then
      -- No DETAIL: it would print the row, costs included (raise_without_row).
      get stacked diagnostics
        err_state = returned_sqlstate, err_constraint = constraint_name, err_table = table_name,
        err_schema = schema_name, err_column = column_name, err_message = message_text;
      perform private.raise_without_row(err_state, err_constraint, err_table, err_schema, err_column, err_message);
  end;

  if inserted is null then
    -- Backstop: the id was taken by a call this one was not serialised with
    -- (another job). Same match-or-conflict rule as the replay above.
    select li.* into existing from public.work_order_line_items li where li.id = add_inventory_line.line_id;
    return private.inventory_line_replay(
      existing, wo.id, add_inventory_line.product_id, add_inventory_line.inventory_unit_id,
      add_inventory_line.quantity
    );
  end if;

  movement := private.record_movement(
    prod.id, unit.id, chosen_location, -add_inventory_line.quantity, 'job_consumption', null,
    direct_cost, null, wo.id, inserted, null
  );

  if unit.id is not null then
    -- The job is open, so the unit is held, never sold, here (D25).
    perform private.set_event_context(
      pg_catalog.jsonb_build_object('work_order_id', wo.id, 'job_number', wo.job_number, 'line_id', inserted)
    );
    perform private.set_unit_status(unit.id, 'held_for_customer');
    perform private.refresh_unique_publication(prod.id);
    perform private.set_event_context(null);
  end if;

  on_hand := private.stock_on_hand(prod.id, chosen_location);
  select l.name into chosen_location_name from public.locations l where l.id = chosen_location;
  perform private.record_work_order_event(
    wo.id, 'stock_consumed',
    pg_catalog.jsonb_build_object(
      'line_id', inserted,
      'movement_id', movement,
      'product_id', prod.id,
      'product_short_id', prod.short_id,
      'inventory_unit_id', unit.id,
      'unit_short_id', unit.short_id,
      'location_id', chosen_location,
      'location_name', chosen_location_name,
      'quantity', add_inventory_line.quantity,
      'on_hand_after', on_hand
    )
  );

  result := row(inserted, movement, chosen_location, on_hand, false);
  return result;
end;
$$;

comment on function public.add_inventory_line(uuid, uuid, uuid, integer, uuid, uuid, public.money_amount) is
  'Active staff: add a part to an open job (line + job_consumption movement; a unit becomes held_for_customer); replay-safe by line id; never returns a cost.';

-- ---------------------------------------------------------------------------
-- void_line, with the inventory branch (replaces Phase 3's).
-- ---------------------------------------------------------------------------

-- Active staff: void a line on an open job with a reason (kept, never
-- deleted). Phase 3's signature, guard, return type, reason rules, error
-- order, effects and lock order are unchanged (the line's job, then
-- private.lock_work_order, then the line FOR UPDATE); an inventory line now
-- also gets its linked reversal movement (allowed even at a location
-- deactivated since), its unit goes back to available and its product's
-- publication is refreshed (sold -> public, no requirement check). A part
-- on a completed job is returned by reopening the job first (D15, D25).
create or replace function public.void_line(line_id uuid, reason text)
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
  unit public.inventory_units;
  consumption public.inventory_movements;
  reversal bigint;
  product_short text;
  location_name text;
  err_state text;
  err_constraint text;
  err_table text;
  err_schema text;
  err_column text;
  err_message text;
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

  begin
    update public.work_order_line_items li
    set voided_at = pg_catalog.clock_timestamp(), voided_by = actor, void_reason = cleaned
    where li.id = target.id;
  exception
    when check_violation or not_null_violation then
      -- No DETAIL: it would print the row, costs included (raise_without_row).
      get stacked diagnostics
        err_state = returned_sqlstate, err_constraint = constraint_name, err_table = table_name,
        err_schema = schema_name, err_column = column_name, err_message = message_text;
      perform private.raise_without_row(err_state, err_constraint, err_table, err_schema, err_column, err_message);
  end;

  if target.line_type = 'inventory' then
    -- Lock order steps 3 and 5: the stock, then the unit.
    perform private.lock_stock(target.source_product_id);
    if target.source_inventory_unit_id is not null then
      select u.* into unit from public.inventory_units u
      where u.id = target.source_inventory_unit_id
      for update;
    end if;

    select m.* into consumption from public.inventory_movements m
    where m.work_order_line_item_id = target.id and m.movement_type = 'job_consumption';
    if found and not exists (
      select 1 from public.inventory_movements r where r.reversal_of_id = consumption.id
    ) then
      reversal := private.record_movement(
        consumption.product_id, consumption.inventory_unit_id, consumption.location_id,
        -consumption.quantity_delta, 'reversal', cleaned, consumption.unit_cost_snapshot,
        null, wo.id, target.id, consumption.id
      );
    end if;

    if unit.id is not null and unit.status = 'held_for_customer' then
      perform private.set_event_context(
        pg_catalog.jsonb_build_object('work_order_id', wo.id, 'job_number', wo.job_number, 'line_id', target.id)
      );
      perform private.set_change_reason(cleaned);
      perform private.set_unit_status(unit.id, 'available');
      perform private.set_change_reason(null);
      perform private.set_event_context(null);
      perform private.refresh_unique_publication(target.source_product_id);
    end if;

    if reversal is not null then
      select p.short_id into product_short from public.products p where p.id = consumption.product_id;
      select l.name into location_name from public.locations l where l.id = consumption.location_id;
      perform private.record_work_order_event(
        wo.id, 'stock_reversed',
        pg_catalog.jsonb_build_object(
          'line_id', target.id,
          'movement_id', reversal,
          'reversal_of_id', consumption.id,
          'product_short_id', product_short,
          'unit_short_id', unit.short_id,
          'location_name', location_name,
          'quantity', -consumption.quantity_delta,
          'on_hand_after', private.stock_on_hand(consumption.product_id, consumption.location_id)
        )
      );
    end if;
  end if;
  return target.id;
end;
$$;

comment on function public.void_line(uuid, text) is
  'Active staff: void a line on an open job with a reason (kept, never deleted); a part line also gets its linked stock reversal and its unit returns to available; replay-safe; returns the id.';

-- ---------------------------------------------------------------------------
-- D25 SOLD-AT-COMPLETION: units follow completed_at.
--
-- Phase 3's private.work_orders_enforce_rules (BEFORE) stamps completed_at
-- on completion and clears it on reopen; its Phase 4 EXTENSION POINT is
-- resolved by this separate AFTER trigger (that function is not replaced).
-- completed_at is set by a BEFORE trigger and never in an UPDATE's target
-- list, so this is AFTER UPDATE ... WHEN (old.completed_at is distinct
-- from new.completed_at) with no column list: an `UPDATE OF completed_at`
-- trigger would never fire.
--
-- It runs under the work-order row lock set_work_order_status holds (lock
-- order step 1) and takes the rest in order: the stock per product
-- ascending, then the units ascending, then (refresh) the products.
-- ---------------------------------------------------------------------------
create function private.work_orders_sell_held_units()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cause text;
  pid uuid;
  uid uuid;
begin
  if old.completed_at is null and new.completed_at is not null then
    cause := 'job_completed';
  elsif old.completed_at is not null and new.completed_at is null then
    cause := 'job_reopened';
  else
    return null;
  end if;

  for pid in
    select distinct li.source_product_id
    from public.work_order_line_items li
    where li.work_order_id = new.id and li.voided_at is null and li.line_type = 'inventory'
      and li.source_inventory_unit_id is not null
    order by 1
  loop
    perform private.lock_stock(pid);
  end loop;

  perform 1
  from public.inventory_units u
  where u.id in (
    select li.source_inventory_unit_id
    from public.work_order_line_items li
    where li.work_order_id = new.id and li.voided_at is null and li.line_type = 'inventory'
      and li.source_inventory_unit_id is not null
  )
  order by u.id
  for update;

  perform private.set_event_context(
    pg_catalog.jsonb_build_object('work_order_id', new.id, 'job_number', new.job_number, 'cause', cause)
  );

  for uid in
    select u.id
    from public.inventory_units u
    where u.id in (
      select li.source_inventory_unit_id
      from public.work_order_line_items li
      where li.work_order_id = new.id and li.voided_at is null and li.line_type = 'inventory'
        and li.source_inventory_unit_id is not null
    )
      and (
        (cause = 'job_completed' and u.status = 'held_for_customer')
        or (cause = 'job_reopened' and u.status = 'sold' and u.sold_sale_line_id is null)
      )
    order by u.id
  loop
    if cause = 'job_completed' then
      perform private.set_unit_status(uid, 'sold', new.completed_at);
    else
      -- No stock movement: the unit never left the job. The product stays
      -- 'sold' until the line is voided or the job completes again.
      perform private.set_unit_status(uid, 'held_for_customer');
    end if;
  end loop;

  perform private.set_event_context(null);

  if cause = 'job_completed' then
    for pid in
      select distinct li.source_product_id
      from public.work_order_line_items li
      where li.work_order_id = new.id and li.voided_at is null and li.line_type = 'inventory'
        and li.source_inventory_unit_id is not null
      order by 1
    loop
      perform private.refresh_unique_publication(pid);
    end loop;
  end if;
  return null;
end;
$$;

create trigger work_orders_sell_held_units
  after update on public.work_orders
  for each row
  when (old.completed_at is distinct from new.completed_at)
  execute function private.work_orders_sell_held_units();

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function
  private.inventory_line_replay(public.work_order_line_items, uuid, uuid, uuid, integer),
  private.work_orders_sell_held_units()
from public, anon, authenticated, service_role;

revoke all on function
  public.add_inventory_line(uuid, uuid, uuid, integer, uuid, uuid, public.money_amount),
  public.void_line(uuid, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.add_inventory_line(uuid, uuid, uuid, integer, uuid, uuid, public.money_amount),
  public.void_line(uuid, text)
to authenticated;
