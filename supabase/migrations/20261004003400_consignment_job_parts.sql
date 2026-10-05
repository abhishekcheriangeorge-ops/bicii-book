-- Consigned stock as a job part: the owner's D27 change (2026-10-05),
-- implemented by D44 CONS-JOB-PART (SPEC §2, §9, §10, §12, §13, §23;
-- DATA-MODEL.md §5, §7, §9, §16; PLAN D1, D6/D25 SOLD-AT-COMPLETION, D14,
-- D23 NEG-CONSUMPTION, D24 PART-PRICE-COST (amended: only NULL is missing),
-- D27, D29 BIKE-WITH-CUSTOMER, D44, D45 CONS-QTY-FIFO, D50 CONS-STOCK-MOVES).
--
-- Rules encoded here:
--   * Consignment stock may be a job part; customer_owned stock never is
--     (ownership_not_saleable, from add_inventory_line and, for every other
--     insert path, the backstop trigger work_order_line_items_consignment_rules).
--   * A consigned part's line snapshots its cost as the item's agreed amount
--     (+ its live shop-borne charges for a unique item, D4/D45) and its
--     consignor_payout_snapshot as the agreed amount per unit, and names its
--     consignment item. Both are immutable, like every other snapshot.
--   * A consigned quantity part draws from exactly one item, FIFO: the oldest
--     active item of the product (received_at, then short_id) whose
--     remaining quantity covers the part (consignment_quantity_unavailable
--     otherwise); its default price is that item's asking price, else the
--     product default; any staff member may override it (D14). Consigned
--     stock never goes below zero (insufficient_stock): D23 does not apply,
--     because on-hand must equal the consignors' remaining quantity (D50).
--   * The unit is held on add and sold at completion (D6/D25). The item is
--     sold, and the consignor liability (quantity x payout snapshot) exists,
--     exactly while the line is live and its job has a completed_at
--     (reporting.consignment_item_position derives it; nothing is stored):
--     a reopen removes both until the job is completed again, a void on the
--     open job returns the stock through Phase 4's linked reversal (the D50
--     movement trigger links it to its item), and a repeated completion or a
--     replay never creates a second liability.
--   * A consigned part is returned by reopen + void, never by restock_unit.
--   * Lock order (consignment migration header): work order, line, stock,
--     bikes, units, consignment items, products.

-- ---------------------------------------------------------------------------
-- The backstop for every insert path, and the new columns' immutability
-- (Phase 3's work_order_line_items_enforce_rules is not replaced; this
-- trigger runs before it, trigger names sort that way).
-- ---------------------------------------------------------------------------
create function private.work_order_line_items_consignment_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  prod_ownership public.ownership_type;
  unit_ownership public.ownership_type;
  unit_item uuid;
  consigned boolean;
begin
  if tg_op = 'UPDATE' then
    if new.consignment_item_id is distinct from old.consignment_item_id
       or new.consignor_payout_snapshot is distinct from old.consignor_payout_snapshot then
      raise exception using
        errcode = 'P0001',
        message = 'line_immutable',
        detail = 'A line cannot be edited, only voided once; void it and add a new one.';
    end if;
    return new;
  end if;

  if new.line_type <> 'inventory' or new.source_product_id is null then
    return new;
  end if;
  select p.ownership_type into prod_ownership from public.products p where p.id = new.source_product_id;
  if new.source_inventory_unit_id is not null then
    select u.ownership_type, u.consignment_item_id into unit_ownership, unit_item
    from public.inventory_units u where u.id = new.source_inventory_unit_id;
  end if;

  if prod_ownership = 'customer_owned' or unit_ownership = 'customer_owned' then
    raise exception using
      errcode = 'P0001',
      message = 'ownership_not_saleable',
      detail = 'That item belongs to a customer, so it cannot be used on a job.';
  end if;

  consigned := coalesce(unit_ownership, prod_ownership) = 'consignment';
  if consigned then
    if new.consignor_payout_snapshot is null
       or new.consignment_item_id is null
       or (new.source_inventory_unit_id is not null and new.consignment_item_id is distinct from unit_item)
       or not exists (
         select 1 from public.consignment_items i
         where i.id = new.consignment_item_id and i.product_id = new.source_product_id
       ) then
      raise exception using
        errcode = 'P0001',
        message = 'line_consignment_mismatch',
        detail = 'A consigned part names its own consignment item and what the consignor is owed.';
    end if;
  elsif new.consignment_item_id is not null or new.consignor_payout_snapshot is not null then
    raise exception using
      errcode = 'P0001',
      message = 'line_consignment_mismatch',
      detail = 'Only a consigned part names a consignment item.';
  end if;
  return new;
end;
$$;

create trigger work_order_line_items_consignment_rules
  before insert or update on public.work_order_line_items
  for each row execute function private.work_order_line_items_consignment_rules();

-- ---------------------------------------------------------------------------
-- The staff line view (definer, view_costs) gains the two columns at the
-- end; otherwise unchanged.
-- ---------------------------------------------------------------------------
create or replace view public.work_order_line_items_staff
with (security_barrier)
as
  select li.id, li.work_order_id, li.line_type, li.source_service_id, li.source_product_id,
         li.source_inventory_unit_id, li.description_snapshot, li.quantity,
         li.unit_sale_price_snapshot, li.unit_direct_cost_snapshot, li.cost_pending,
         li.cult_commons_rate_snapshot, li.currency, li.sale_total, li.cost_total, li.yield_total, li.cult_commons_share,
         li.created_by, li.created_at, li.voided_at, li.voided_by, li.void_reason,
         li.consignment_item_id, li.consignor_payout_snapshot
  from public.work_order_line_items li
  where (select private.has_permission('view_costs'));

comment on view public.work_order_line_items_staff is
  'Every line column including cost, rate, yield, Cult Commons and a consigned part''s payout snapshot (D44), for view_costs only.';

-- ---------------------------------------------------------------------------
-- add_inventory_line (replaces Phase 4's; same signature, return type,
-- guard and step order).
-- ---------------------------------------------------------------------------

-- Active staff (any). Adds a part to an open job: the line (snapshotting
-- the price, the cost, the Cult Commons rate and, for consigned stock, its
-- consignment item and payout), its job_consumption movement and, for a
-- unique unit, held_for_customer. The order is exact: (1) lock the job;
-- (2) lock the stock (and the unit); (3) replay check, before the open
-- check, so a replay after completion still returns the line; (4) open
-- check (D15); (5) validation, locking a consigned part's item(s) (lock
-- order 6); (6) effects.
create or replace function public.add_inventory_line(
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
  item public.consignment_items;
  candidate record;
  chosen_location uuid;
  chosen_location_name text;
  loc_active boolean;
  sale_price public.money_amount;
  direct_cost public.money_amount;
  payout public.money_amount;
  shop_charges numeric;
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
  -- D27 (changed by the owner 2026-10-05; D44): shop-owned and consigned
  -- stock may be a job part; customer_owned stock never is (the line
  -- trigger work_order_line_items_consignment_rules is the backstop).
  if prod.ownership_type = 'customer_owned' then
    raise exception using
      errcode = 'P0001',
      message = 'ownership_not_saleable',
      detail = 'That item belongs to a customer, so it cannot be used on a job.';
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

    if prod.ownership_type = 'consignment' then
      -- D44/D45: lock the product's active items (lock order 6, id order),
      -- then read their positions in a new statement and take the oldest
      -- item whose remaining quantity covers the part.
      perform 1 from public.consignment_items i
      where i.product_id = prod.id and i.status = 'active'
      order by i.id
      for update;
      select i.id into candidate
      from public.consignment_items i
      join reporting.consignment_item_position pos on pos.consignment_item_id = i.id
      where i.product_id = prod.id and i.status = 'active'
        and pos.remaining_qty >= add_inventory_line.quantity
      order by i.received_at, i.short_id
      limit 1;
      if not found then
        raise exception using
          errcode = 'P0001',
          message = 'consignment_quantity_unavailable',
          detail = 'No single consignment of this item has that many left; add fewer, or one consignor''s stock at a time.';
      end if;
      select i.* into item from public.consignment_items i where i.id = candidate.id;
      -- No negative consumption for consigned stock (D50, not D23).
      if private.stock_on_hand(prod.id, chosen_location) < add_inventory_line.quantity then
        raise exception using
          errcode = 'P0001',
          message = 'insufficient_stock',
          detail = 'There is not that much of this consigned item at that location.';
      end if;
    end if;
    -- Shop-owned stock: D23 NEG-CONSUMPTION, on-hand may go below zero here
    -- (the part was physically used); the UI warns and reporting shows it.
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
    if unit.ownership_type = 'customer_owned' then
      raise exception using
        errcode = 'P0001',
        message = 'ownership_not_saleable',
        detail = 'That item belongs to a customer, so it cannot be used on a job.';
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
    if unit.consignment_item_id is not null then
      -- D44: the unit's item, after the unit (lock order 6).
      select i.* into item from public.consignment_items i where i.id = unit.consignment_item_id for update;
      if item.status <> 'active' then
        raise exception using
          errcode = 'P0001',
          message = 'consignment_item_not_active',
          detail = 'That consigned item is no longer with the shop.';
      end if;
    end if;
    chosen_location := unit.location_id;
  end if;

  -- D24 PART-PRICE-COST (amended: 0 is known, only NULL is missing). Any
  -- staff member may override the price (D14); the cost is never
  -- overridden. A consigned part costs its item's agreed amount, plus a
  -- unique item's live shop-borne charges (D4); the consignor is owed the
  -- agreed amount per unit (D44).
  if item.id is not null then
    select pos.shop_charges into shop_charges
    from reporting.consignment_item_position pos where pos.consignment_item_id = item.id;
    payout := item.agreed_amount_owed;
    direct_cost := (item.agreed_amount_owed + case when unit.id is not null then coalesce(shop_charges, 0) else 0 end)
      ::public.money_amount;
    sale_price := case
      when unit.id is not null then
        coalesce(add_inventory_line.unit_sale_price, private.selling_price(prod.id, unit.id))
      else coalesce(add_inventory_line.unit_sale_price, item.asking_price, prod.default_sale_price)
    end;
  else
    sale_price := coalesce(
      add_inventory_line.unit_sale_price,
      private.selling_price(prod.id, add_inventory_line.inventory_unit_id)
    );
    direct_cost := coalesce(unit.direct_cost, prod.default_direct_cost);
  end if;
  if sale_price is null then
    raise exception using
      errcode = 'P0001',
      message = 'part_price_missing',
      detail = 'This part has no sale price; enter one.';
  end if;
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
      cult_commons_rate_snapshot, currency, created_by, consignment_item_id, consignor_payout_snapshot
    )
    values (
      add_inventory_line.line_id, wo.id, 'inventory', prod.id, unit.id, pg_catalog.left(description, 300),
      add_inventory_line.quantity, sale_price, direct_cost, false,
      private.cult_commons_rate_at(pg_catalog.clock_timestamp()), wo.currency, actor, item.id, payout
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

  -- Shop-owned parts write exactly Phase 4's movement; a consigned part's
  -- names its item (D50).
  movement := private.record_linked_movement(
    prod.id, unit.id, chosen_location, -add_inventory_line.quantity, 'job_consumption', null,
    direct_cost, null, wo.id, inserted, null, null, item.id
  );

  if unit.id is not null then
    -- The job is open, so the unit is held, never sold, here (D25).
    perform private.set_event_context(
      pg_catalog.jsonb_build_object('work_order_id', wo.id, 'job_number', wo.job_number, 'line_id', inserted)
    );
    perform private.set_unit_status(unit.id, 'held_for_customer');
    perform private.set_event_context(null);
  end if;
  if item.id is not null then
    -- A no-op while the job is open: a held part keeps its item active.
    perform private.refresh_consignment_item_status(item.id);
  end if;
  if unit.id is not null then
    perform private.refresh_unique_publication(prod.id);
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
  'Active staff: add a shop-owned or consigned part to an open job (line + job_consumption movement; a unit becomes held_for_customer; a consigned part snapshots its item and payout, D44); replay-safe by line id; never returns a cost.';

-- ---------------------------------------------------------------------------
-- D25 SOLD-AT-COMPLETION, extended for consigned parts (replaces Phase 4's
-- function; the trigger is unchanged). It runs under the work-order row
-- lock set_work_order_status holds (lock order 1) and takes the rest in
-- order: the stock for the products of the job's live unit lines and live
-- consigned lines, ascending; the linked bikes (reopen); the units; the
-- consignment items of the job's live lines, ascending; then the unit
-- statuses, the items' statuses (completion -> sold when nothing is left,
-- reopen -> active; their status_changed events carry the job context) and
-- finally the publication refresh (products last).
-- ---------------------------------------------------------------------------
create or replace function private.work_orders_sell_held_units()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cause text;
  pid uuid;
  uid uuid;
  iid uuid;
  owned_bike text;
  owned_unit text;
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
      and (li.source_inventory_unit_id is not null or li.consignment_item_id is not null)
    order by 1
  loop
    perform private.lock_stock(pid);
  end loop;

  if cause = 'job_reopened' then
    -- Lock order step 4, before the units: the linked bikes of the units
    -- this reopen would hold again. D29: a sold shop bike that has passed
    -- to its buyer is not taken back by a reopen (it would put a bike a
    -- customer owns back into stock, clear its sold_at and with it the
    -- public photo cut-off). The bike goes back to the shop first.
    perform 1
    from public.bikes b
    where b.id in (
      select u.bike_id
      from public.inventory_units u
      join public.work_order_line_items li on li.source_inventory_unit_id = u.id
      where li.work_order_id = new.id and li.voided_at is null and li.line_type = 'inventory'
        and u.bike_id is not null
    )
    order by b.id
    for update;

    select b.short_id, u.short_id into owned_bike, owned_unit
    from public.inventory_units u
    join public.work_order_line_items li on li.source_inventory_unit_id = u.id
    join public.bikes b on b.id = u.bike_id
    where li.work_order_id = new.id and li.voided_at is null and li.line_type = 'inventory'
      and u.status = 'sold' and u.sold_sale_line_id is null
      and b.customer_id is not null
    order by u.id
    limit 1;
    if found then
      raise exception using
        errcode = 'P0001',
        message = 'bike_with_customer',
        detail = pg_catalog.format(
          '%s (sold on this job as %s) now belongs to a customer; transfer it back to the shop before reopening the job.',
          owned_bike, owned_unit
        );
    end if;
  end if;

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

  -- Lock order step 6: the consignment items of the job's live lines.
  perform 1
  from public.consignment_items i
  where i.id in (
    select li.consignment_item_id
    from public.work_order_line_items li
    where li.work_order_id = new.id and li.voided_at is null and li.consignment_item_id is not null
  )
  order by i.id
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

  -- D44: the items follow the job's completed_at (sold while it is set and
  -- nothing is left; active again after a reopen). Liability is derived
  -- from the same lines, so a repeated completion adds nothing.
  for iid in
    select distinct li.consignment_item_id
    from public.work_order_line_items li
    where li.work_order_id = new.id and li.voided_at is null and li.consignment_item_id is not null
    order by 1
  loop
    perform private.refresh_consignment_item_status(iid);
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

-- ---------------------------------------------------------------------------
-- Privileges (create or replace keeps the existing grants; re-stated).
-- ---------------------------------------------------------------------------
revoke all on function
  private.work_order_line_items_consignment_rules(),
  private.work_orders_sell_held_units()
from public, anon, authenticated, service_role;

revoke all on function
  public.add_inventory_line(uuid, uuid, uuid, integer, uuid, uuid, public.money_amount)
from public, anon, authenticated, service_role;

grant execute on function
  public.add_inventory_line(uuid, uuid, uuid, integer, uuid, uuid, public.money_amount)
to authenticated;
