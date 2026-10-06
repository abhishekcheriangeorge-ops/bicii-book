-- Shopify order and refund processing, the retry/dismiss/link RPCs and the
-- integration rows of the operational exceptions (SPEC §2, §10, §12, §13,
-- §17, §23 "A unique inventory unit cannot be sold twice", "A duplicate
-- Shopify webhook has one business effect", §25, §26; DATA-MODEL.md §8,
-- §13, §14, §15, §16; PLAN D1, D4/D44/D46, D7, D9, D23, D24 (amended), D26,
-- D34, D35, D45/D54, D49 RETAIL-REFUND, D53, D55, D58, D80 SHOP-PRICE, D81
-- SHOP-UNIQUE, D82 SHOP-STOCK, D85 SHOP-REFUND, D86 SHOP-ACCESS, D87
-- SHOP-RETRY, D89 SHOP-TAX-TEST; ADR-020).
--
-- Rules encoded here, for every writer:
--   * An online sale goes through Phase 6's private.sell_line, the single
--     sale-line writer, with 'online_sale': the same price, cost, Cult
--     Commons (D1), rate (at the sale's recognized_at), consignor payout
--     (D4/D44/D46), movement, unit and consignment rules as an in-store
--     sale. sell_line is replaced here with the same signature only to
--     accept and persist shopify_line_part (D80); nothing else changes, and
--     no second writer exists.
--   * D80: each line's price is Shopify's line price x effective quantity
--     minus the line's discount allocations (shop money), split exactly by
--     private.shopify_split_amount so the sale's lines sum to Shopify's
--     discounted line totals; 0 is a price (D24). recognized_at = the
--     payload's processed_at, else X-Shopify-Triggered-At, else
--     received_at; never the processing time.
--   * D81/D82: a unique product sells its oldest available, non-customer-
--     owned, non-archived units at the online location; a quantity product
--     needs that much on hand there (a sale never takes stock below zero).
--     When anything cannot be fulfilled, or sell_line refuses a line,
--     NOTHING is recorded: the business writes run in one plpgsql
--     subtransaction, and the event becomes failed with a human message and
--     an open job (needs_attention, or queued with backoff for a transient
--     failure, D87).
--   * One business effect per order: the event row is locked first; a
--     processed, skipped or rejected event only closes its job; deliveries
--     of one order are serialised by an advisory lock on the order's gid
--     and the sale is unique on shopify_order_id (a second delivery is
--     duplicate_order). Every line's movement is unique per line
--     (inventory_movements_sale_line_once).
--   * D85 (D7, D49): a Shopify refund is one sale_refunds row and nothing
--     else, its amount the line-attributable refund, never above the money
--     refunded or the sale's remaining total; the sale becomes refunded or
--     partially_refunded exactly as record_sale_refund decides. It never
--     writes a movement, unit, consignment item, sale line or settlement.
--     reporting.financial_lines keeps every non-voided sale line (D49).
--   * D89: an order taxed on top of its prices (taxes_included false, tax
--     > 0) is refused; test deliveries are skipped unless accepted.
--   * D86: retry, dismiss and the links are staff RPCs with an audit row;
--     only admins dismiss and link, and only admins see the integration
--     rows of the operational exceptions (private.integration_exceptions).
--     A customer link never edits a recorded sale (sales are immutable
--     except status); orders link only through customers.shopify_customer_id,
--     never by email.
--
-- GLOBAL LOCK ORDER (the consignment migration's header). Order
-- processing: 0 the event row FOR UPDATE, then the order's advisory lock
-- ('bicii.shopify.order:' || order gid), then the sale header insert;
-- 3 private.lock_stock per product in id order; 5 the chosen units FOR
-- UPDATE in id order; 6 their consignment items and every active item of
-- each consigned quantity product, FOR UPDATE in id order; the lines; 7
-- private.refresh_unique_publication per unique product in id order, last.
-- Refund processing: 0 the event row, the order's advisory lock, then the
-- sale row FOR UPDATE (as record_sale_refund). Every path that touches an
-- event and its job locks the event row before the job (the processors,
-- private.shopify_event_failed, dismiss_integration_job, which then locks
-- the order's waiting refund events and their jobs in id order); retry
-- locks only the job; the links lock the product or customer row only.

-- ---------------------------------------------------------------------------
-- private.sell_line, replaced with the same signature (Phase 6 said Phase
-- 10 may, to read more keys). The body is 20261004003500_sales.sql's,
-- copied unchanged except: 'shopify_line_part' joins BOTH key allow-lists
-- (unit and quantity lines), and the insert writes
-- (p_line ->> 'shopify_line_part')::smallint to sale_lines.shopify_line_part
-- (D80). No guard, no price rule and no location key are added: unit lines
-- sell at the unit's own location and quantity lines take location_id, as
-- before. record_retail_sale is untouched and still refuses any line with
-- shopify_line_item_id, so an in-store line cannot claim a part
-- (sale_lines_shopify_line_part_check needs the line id).
-- ---------------------------------------------------------------------------
create or replace function private.sell_line(
  p_sale public.sales,
  p_line_number integer,
  p_line jsonb,
  p_movement_type public.movement_type
)
returns public.sale_lines
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  unit_key uuid;
  product_key uuid;
  location_key uuid;
  item_key uuid;
  price_arg public.money_amount;
  qty_text text;
  qty integer;
  unit public.inventory_units;
  prod public.products;
  item public.consignment_items;
  remaining integer;
  in_stock_since timestamptz;
  stock_label text;
  loc_active boolean;
  sale_price public.money_amount;
  direct_cost public.money_amount;
  payout public.money_amount;
  shop_charges numeric;
  description text;
  line public.sale_lines;
  err_state text;
  err_constraint text;
  err_table text;
  err_schema text;
  err_column text;
  err_message text;
begin
  if sell_line.p_line is null or pg_catalog.jsonb_typeof(sell_line.p_line) <> 'object' then
    raise exception using
      errcode = 'P0001',
      message = 'sale_line_invalid',
      detail = 'Each sale line is a unit, or a product with a location and a quantity.';
  end if;
  unit_key := (sell_line.p_line ->> 'inventory_unit_id')::uuid;
  product_key := (sell_line.p_line ->> 'product_id')::uuid;
  price_arg := (sell_line.p_line ->> 'unit_sale_price')::public.money_amount;

  if unit_key is not null and product_key is null and not exists (
       select 1 from pg_catalog.jsonb_object_keys(sell_line.p_line) k
       where k not in ('inventory_unit_id', 'unit_sale_price', 'shopify_line_item_id', 'shopify_line_part')
     ) then
    -- ---------------------------------------------------------------- unit
    select u.* into unit from public.inventory_units u where u.id = unit_key;
    if not found then
      raise exception 'unit % not found', unit_key using errcode = 'P0002';
    end if;
    if unit.status = 'sold' then
      raise exception using
        errcode = 'P0001',
        message = 'unit_already_sold',
        detail = pg_catalog.format('%s has already been sold.', unit.short_id);
    end if;
    if unit.status <> 'available' or unit.archived_at is not null then
      raise exception using
        errcode = 'P0001',
        message = 'unit_not_available',
        detail = pg_catalog.format('%s is not available to sell.', unit.short_id);
    end if;
    if unit.ownership_type = 'customer_owned' then
      raise exception using
        errcode = 'P0001',
        message = 'ownership_not_saleable',
        detail = 'That item belongs to a customer, so it cannot be sold.';
    end if;
    select p.* into prod from public.products p where p.id = unit.product_id;
    if prod.currency <> sell_line.p_sale.currency then
      raise exception using
        errcode = 'P0001',
        message = 'currency_mismatch',
        detail = 'That item is priced in another currency than the sale.';
    end if;

    sale_price := coalesce(price_arg, private.selling_price(prod.id, unit.id));
    if unit.consignment_item_id is not null then
      select i.* into item from public.consignment_items i where i.id = unit.consignment_item_id;
      if item.status <> 'active' then
        raise exception using
          errcode = 'P0001',
          message = 'consignment_item_not_active',
          detail = 'That consigned item is no longer with the shop.';
      end if;
      in_stock_since := item.received_at;
      select pos.shop_charges into shop_charges
      from reporting.consignment_item_position pos where pos.consignment_item_id = item.id;
      -- D4/D44: the agreed amount plus the live shop-borne charges; the
      -- consignor is owed the agreed amount (D46).
      direct_cost := (item.agreed_amount_owed + coalesce(shop_charges, 0))::public.money_amount;
      payout := item.agreed_amount_owed;
    else
      direct_cost := coalesce(unit.direct_cost, prod.default_direct_cost);
    end if;
    description := prod.name || ' · ' || unit.short_id || coalesce(' · S/N ' || unit.serial_number, '');
    qty := 1;
    location_key := unit.location_id;
    -- D55: a restocked unit was back in stock only from its restock.
    in_stock_since := greatest(
      in_stock_since,
      (select max(sl.restocked_at) from public.sale_lines sl where sl.inventory_unit_id = unit.id)
    );
    stock_label := unit.short_id;

  elsif product_key is not null and unit_key is null and not exists (
       select 1 from pg_catalog.jsonb_object_keys(sell_line.p_line) k
       where k not in (
         'product_id', 'location_id', 'quantity', 'consignment_item_id', 'unit_sale_price', 'shopify_line_item_id',
         'shopify_line_part'
       )
     ) then
    -- ------------------------------------------------------------ quantity
    location_key := (sell_line.p_line ->> 'location_id')::uuid;
    item_key := (sell_line.p_line ->> 'consignment_item_id')::uuid;
    select p.* into prod from public.products p where p.id = product_key;
    if not found then
      raise exception 'product % not found', product_key using errcode = 'P0002';
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
    if prod.tracking_type = 'unique' then
      raise exception using
        errcode = 'P0001',
        message = 'sale_product_is_unique',
        detail = 'That product is sold unit by unit; choose the unit.';
    end if;
    if prod.ownership_type = 'customer_owned' then
      raise exception using
        errcode = 'P0001',
        message = 'ownership_not_saleable',
        detail = 'That item belongs to a customer, so it cannot be sold.';
    end if;
    if prod.currency <> sell_line.p_sale.currency then
      raise exception using
        errcode = 'P0001',
        message = 'currency_mismatch',
        detail = 'That item is priced in another currency than the sale.';
    end if;
    qty_text := pg_catalog.btrim(sell_line.p_line ->> 'quantity');
    if qty_text is null or qty_text !~ '^[0-9]{1,3}$' or qty_text::integer < 1 then
      raise exception using
        errcode = 'P0001',
        message = 'sale_quantity_invalid',
        detail = 'Sell between 1 and 999.';
    end if;
    qty := qty_text::integer;
    if location_key is null then
      raise exception 'location_id is required to sell a quantity' using errcode = '22004';
    end if;
    select l.active into loc_active from public.locations l where l.id = location_key;
    if not found then
      raise exception 'location % not found', location_key using errcode = 'P0002';
    end if;
    if not loc_active then
      raise exception using
        errcode = 'P0001',
        message = 'location_inactive',
        detail = 'That location is inactive; choose another or reactivate it.';
    end if;
    -- A sale never takes stock below zero (D23 covers job parts only).
    if private.stock_on_hand(prod.id, location_key) < qty then
      raise exception using
        errcode = 'P0001',
        message = 'insufficient_stock',
        detail = 'There is not that much of this item at that location.';
    end if;

    if prod.ownership_type = 'consignment' then
      -- D45/D54: the item named, else the FIFO head whose stock at this
      -- location covers the line (the caller holds the product's stock and
      -- items, lock orders 3 and 6). Another consignor's stock elsewhere
      -- never answers for it.
      if item_key is not null then
        select i.* into item from public.consignment_items i where i.id = item_key;
        if not found then
          raise exception 'consignment item % not found', item_key using errcode = 'P0002';
        end if;
        if item.product_id <> prod.id then
          raise exception using
            errcode = 'P0001',
            message = 'sale_line_invalid',
            detail = 'That consignment item is for another product.';
        end if;
        if item.status <> 'active' then
          raise exception using
            errcode = 'P0001',
            message = 'consignment_item_not_active',
            detail = 'That consigned item is no longer with the shop.';
        end if;
        select pos.remaining_qty into remaining
        from reporting.consignment_item_position pos where pos.consignment_item_id = item.id;
        remaining := least(remaining, private.consignment_item_on_hand(item.id, location_key));
        if remaining < qty then
          raise exception using
            errcode = 'P0001',
            message = 'consignment_quantity_unavailable',
            detail = pg_catalog.format('%s has %s at that location.', item.short_id, greatest(remaining, 0));
        end if;
      else
        select i.* into item
        from public.consignment_items i
        join reporting.consignment_item_position pos on pos.consignment_item_id = i.id
        where i.product_id = prod.id and i.status = 'active' and pos.remaining_qty >= qty
          and private.consignment_item_on_hand(i.id, location_key) >= qty
        order by i.received_at, i.short_id
        limit 1;
        if not found then
          raise exception using
            errcode = 'P0001',
            message = 'consignment_quantity_unavailable',
            detail = 'No single consignment of this item has that many at that location; sell fewer, or one consignor''s stock at a time.';
        end if;
      end if;
      in_stock_since := item.received_at;
      stock_label := item.short_id;
      sale_price := coalesce(price_arg, item.asking_price, prod.default_sale_price);
      direct_cost := item.agreed_amount_owed;
      payout := item.agreed_amount_owed;
    else
      if item_key is not null then
        raise exception using
          errcode = 'P0001',
          message = 'sale_line_invalid',
          detail = 'Only consigned stock names a consignment item.';
      end if;
      sale_price := coalesce(price_arg, private.selling_price(prod.id, null));
      direct_cost := prod.default_direct_cost;
    end if;
    description := prod.name;

  else
    raise exception using
      errcode = 'P0001',
      message = 'sale_line_invalid',
      detail = 'Each sale line is a unit, or a product with a location and a quantity.';
  end if;

  -- D55: a sale is never dated before its stock was with the shop (a
  -- consigned item's intake, a unit's restock). Shop-owned stock otherwise
  -- has no lower bound: its registration is when it was entered, not when
  -- it arrived.
  if in_stock_since is not null and sell_line.p_sale.recognized_at < in_stock_since then
    raise exception using
      errcode = 'P0001',
      message = 'sale_before_stock',
      detail = pg_catalog.format(
        '%s came into the shop on %s; a sale cannot be dated before that.',
        stock_label,
        pg_catalog.to_char(in_stock_since at time zone private.shop_timezone(), 'FMDD Mon YYYY, HH24:MI')
      );
  end if;

  -- D24 (amended): 0 is a known price and a known cost; only NULL is missing.
  -- Any staff member may override the price (D53); the cost never.
  if sale_price is null then
    raise exception using
      errcode = 'P0001',
      message = 'sale_price_required',
      detail = 'This item has no selling price; enter one.';
  end if;
  if direct_cost is null then
    raise exception using
      errcode = 'P0001',
      message = 'sale_cost_missing',
      detail = 'This item has no cost yet, so its yield cannot be worked out; ask someone with cost access to enter it.';
  end if;

  begin
    insert into public.sale_lines as sl (
      sale_id, line_number, product_id, inventory_unit_id, consignment_item_id, description_snapshot, quantity,
      unit_sale_price_snapshot, unit_direct_cost_snapshot, consignor_payout_snapshot, cult_commons_rate_snapshot,
      currency, shopify_line_item_id, shopify_line_part
    )
    values (
      sell_line.p_sale.id, sell_line.p_line_number, prod.id, unit.id, item.id, pg_catalog.left(description, 300),
      qty, sale_price, direct_cost, payout, private.cult_commons_rate_at(sell_line.p_sale.recognized_at),
      sell_line.p_sale.currency, sell_line.p_line ->> 'shopify_line_item_id',
      (sell_line.p_line ->> 'shopify_line_part')::smallint
    )
    returning sl.* into line;
  exception
    when check_violation or not_null_violation then
      -- No DETAIL: it would print the row, costs included.
      get stacked diagnostics
        err_state = returned_sqlstate, err_constraint = constraint_name, err_table = table_name,
        err_schema = schema_name, err_column = column_name, err_message = message_text;
      perform private.raise_without_row(err_state, err_constraint, err_table, err_schema, err_column, err_message);
  end;

  perform private.record_linked_movement(
    prod.id, unit.id, location_key, -qty, sell_line.p_movement_type, null, direct_cost, null, null, null, null,
    line.id, item.id
  );

  if unit.id is not null then
    perform private.set_event_context(
      pg_catalog.jsonb_build_object(
        'sale_id', sell_line.p_sale.id, 'sale_number', sell_line.p_sale.sale_number, 'sale_line_id', line.id
      )
    );
    update public.inventory_units u set sold_sale_line_id = line.id where u.id = unit.id;
    perform private.set_unit_status(unit.id, 'sold', sell_line.p_sale.recognized_at);
    perform private.set_event_context(null);
  end if;
  if item.id is not null then
    perform private.refresh_consignment_item_status(item.id);
  end if;
  return line;
end;
$$;

comment on function private.sell_line(public.sales, integer, jsonb, public.movement_type) is
  'THE single sale-line writer (Phase 6; replaced by Phase 10 with the same body plus shopify_line_part, D80). The caller holds every lock and refreshes publication. retail_sale for record_retail_sale, online_sale for process_shopify_order_paid. No grants.';

revoke all on function private.sell_line(public.sales, integer, jsonb, public.movement_type)
from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Processing helpers (private; EXECUTE revoked from every API role)
-- ---------------------------------------------------------------------------

-- Raise an event failure: P0001 with the code as MESSAGE and the human
-- message as DETAIL. Event codes (shopify_variant_unmapped, ...) are stored
-- on the event and its job, never returned to a client as an error, so
-- they are not src/lib/db-errors.ts codes.
create function private.shopify_raise(code text, detail text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = shopify_raise.code, detail = shopify_raise.detail;
end;
$$;

-- A decimal from a payload (text or JSON number), or null when absent;
-- shopify_payload_invalid naming the field when malformed.
create function private.shopify_decimal(value text, field text, noun text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
begin
  if shopify_decimal.value is null then
    return null;
  end if;
  if pg_catalog.btrim(shopify_decimal.value) !~ '^-?[0-9]{1,12}(\.[0-9]{1,6})?$' then
    perform private.shopify_raise(
      'shopify_payload_invalid',
      pg_catalog.format(
        'Shopify sent %s BICII cannot read (%s). Check the payload in the event inspector.',
        shopify_decimal.noun, shopify_decimal.field
      )
    );
  end if;
  return pg_catalog.btrim(shopify_decimal.value)::numeric;
end;
$$;

-- A whole number >= 0 from a payload, or null when absent.
create function private.shopify_count(value text, field text, noun text)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if shopify_count.value is null then
    return null;
  end if;
  if pg_catalog.btrim(shopify_count.value) !~ '^[0-9]{1,6}$' then
    perform private.shopify_raise(
      'shopify_payload_invalid',
      pg_catalog.format(
        'Shopify sent %s BICII cannot read (%s). Check the payload in the event inspector.',
        shopify_count.noun, shopify_count.field
      )
    );
  end if;
  return pg_catalog.btrim(shopify_count.value)::integer;
end;
$$;

-- A shop-money amount of a payload object: <field>_set.shop_money.amount,
-- else <field>, as text (null when absent).
create function private.shopify_money_text(obj jsonb, field text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    shopify_money_text.obj #>> array[shopify_money_text.field || '_set', 'shop_money', 'amount'],
    shopify_money_text.obj ->> shopify_money_text.field
  );
$$;

-- The digits of a gid (for messages: "Shopify variant 4455").
create function private.shopify_gid_number(gid text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.substring(shopify_gid_number.gid, '([0-9]+)$');
$$;

-- The payload's line items with an effective quantity > 0 whose variant is
-- missing (a custom line) or linked to no product (SPEC §17.1):
-- [{line_item_id, title, variant_title, variant_gid, product_gid, quantity}].
-- A pure function of the payload and the committed mappings, so the
-- failure branch recomputes it after the processing subtransaction rolled
-- back; it never raises on a malformed payload.
create function private.shopify_unmapped_lines(payload jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'line_item_id', coalesce(private.shopify_gid_or_null('LineItem', x.li ->> 'id'), x.li ->> 'id'),
        'title', x.li ->> 'title',
        'variant_title', x.li ->> 'variant_title',
        'variant_gid', x.variant_gid,
        'product_gid', private.shopify_gid_or_null('Product', x.li ->> 'product_id'),
        'quantity', x.qty
      )
      order by x.ord
    ),
    '[]'::jsonb
  )
  from (
    select e.li, e.ord,
           private.shopify_gid_or_null('ProductVariant', e.li ->> 'variant_id') as variant_gid,
           case
             when coalesce(e.li ->> 'current_quantity', e.li ->> 'quantity') ~ '^[0-9]{1,6}$'
               then coalesce(e.li ->> 'current_quantity', e.li ->> 'quantity')::integer
           end as qty
    from pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(shopify_unmapped_lines.payload -> 'line_items') = 'array'
           then shopify_unmapped_lines.payload -> 'line_items' else '[]'::jsonb end
    ) with ordinality as e(li, ord)
    where pg_catalog.jsonb_typeof(e.li) = 'object'
  ) x
  where coalesce(x.qty, 0) > 0
    and (
      x.variant_gid is null
      or not exists (select 1 from public.products p where p.shopify_variant_id = x.variant_gid)
    );
$$;

-- Close the open job of an event (done): a processed, skipped or replayed
-- event never leaves a job running.
create function private.shopify_close_event_job(event_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.integration_retry_queue q
  set status = 'done', resolved_at = pg_catalog.now(), locked_at = null
  where q.integration_event_id = shopify_close_event_job.event_id
    and q.status in ('queued', 'running', 'needs_attention');
$$;

-- An order is recorded (D80, one business effect): every other delivery of
-- it (another webhook id) still pending or failed becomes processed /
-- duplicate_order with the sale, and its open job is closed, so the queue
-- and Today never keep a failure for a recorded order. Sibling events are
-- taken in id order with SKIP LOCKED: a locked one is being processed (it
-- finds the sale under the order lock and closes itself) or dismissed.
create function private.shopify_close_order_siblings(event_id uuid, order_gid text, sale_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  sib uuid;
begin
  for sib in
    select e.id
    from public.integration_events e
    where e.topic = 'orders/paid' and e.shopify_order_gid = shopify_close_order_siblings.order_gid
      and e.id <> shopify_close_order_siblings.event_id and e.status in ('pending', 'failed')
    order by e.id
    for update skip locked
  loop
    update public.integration_events e
    set status = 'processed', processed_at = pg_catalog.now(), outcome = 'duplicate_order',
        sale_id = shopify_close_order_siblings.sale_id
    where e.id = sib;
    perform private.shopify_close_event_job(sib);
  end loop;
end;
$$;

-- An event failed: the event becomes failed with the code and the human
-- message; its open job (created when there is none, so every failed event
-- is in the queue) is re-queued with backoff for a transient code
-- (shopify_unexpected_error, shopify_refund_order_unknown,
-- shopify_settings_missing) until max_attempts, else needs attention now
-- (D87).
create function private.shopify_event_failed(
  event_id uuid,
  code text,
  message text,
  detail text,
  result jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  job public.integration_retry_queue;
begin
  update public.integration_events e
  set status = 'failed', last_error_code = shopify_event_failed.code,
      last_error = pg_catalog.left(shopify_event_failed.message, 2000),
      last_error_detail = pg_catalog.left(shopify_event_failed.detail, 2000),
      result = coalesce(shopify_event_failed.result, '{}'::jsonb)
  where e.id = shopify_event_failed.event_id;

  select q.* into job
  from public.integration_retry_queue q
  where q.integration_event_id = shopify_event_failed.event_id and q.status in ('queued', 'running', 'needs_attention')
  for update;
  if not found then
    insert into public.integration_retry_queue as q (kind, integration_event_id)
    values ('shopify_event', shopify_event_failed.event_id)
    returning q.* into job;
  end if;

  if shopify_event_failed.code in ('shopify_unexpected_error', 'shopify_refund_order_unknown', 'shopify_settings_missing')
     and job.attempts < job.max_attempts then
    update public.integration_retry_queue q
    set status = 'queued', locked_at = null,
        next_attempt_at = pg_catalog.now() + private.integration_backoff(job.attempts),
        last_error_code = shopify_event_failed.code, last_error = pg_catalog.left(shopify_event_failed.message, 2000)
    where q.id = job.id;
  else
    update public.integration_retry_queue q
    set status = 'needs_attention', locked_at = null, next_attempt_at = pg_catalog.now(),
        last_error_code = shopify_event_failed.code, last_error = pg_catalog.left(shopify_event_failed.message, 2000)
    where q.id = job.id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- process_shopify_order_paid (service_role): record an orders/paid event
-- as one online sale, or nothing (D80-D82, D89). Business failures never
-- raise: they come back as (failed, null, null, code, message).
-- ---------------------------------------------------------------------------
create function public.process_shopify_order_paid(event_id uuid)
returns table (
  event_status public.integration_event_status,
  outcome text,
  sale_id uuid,
  error_code text,
  error_message text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
-- Arguments and outputs are never referenced bare in SQL; a bare name is
-- the column.
#variable_conflict use_column
declare
  ev public.integration_events;
  accept_tests boolean;
  p jsonb;
  settings public.shopify_settings;
  online_name text;
  order_name text;
  order_gid text;
  order_currency text;
  recognized timestamptz;
  taxes_included boolean;
  tax numeric;
  customer_gid text;
  customer_key uuid;
  li jsonb;
  disc jsonb;
  qty integer;
  current_qty integer;
  price numeric;
  discount numeric;
  line_total numeric;
  variant_raw text;
  variant_gid text;
  line_gid text;
  title text;
  parsed jsonb := '[]'::jsonb;
  mapped jsonb := '[]'::jsonb;
  unmapped_parts text[] := '{}';
  has_variant_unmapped boolean := false;
  has_custom_unmapped boolean := false;
  m jsonb;
  prod record;
  existing_sale uuid;
  sale public.sales;
  pid uuid;
  need integer;
  have integer;
  first_title text;
  pool uuid[];
  all_units uuid[] := '{}';
  unit_pool jsonb := '{}'::jsonb;
  used jsonb := '{}'::jsonb;
  unique_pids uuid[] := '{}';
  quantity_pids uuid[] := '{}';
  line_no integer := 0;
  prices numeric[];
  split record;
  split_rows integer;
  part integer;
  uid uuid;
  cursor_at integer;
  unit_ids uuid[];
  unit_prices numeric[];
  p_line jsonb;
  result_lines jsonb := '[]'::jsonb;
  err_code text;
  err_message text;
  err_detail text;
  err_state text;
  err_text text;
begin
  if process_shopify_order_paid.event_id is null then
    raise exception 'event_id is required' using errcode = '22004';
  end if;

  -- (a) The event row (lock order 0) and replays.
  select e.* into ev from public.integration_events e where e.id = process_shopify_order_paid.event_id for update;
  if not found then
    raise exception 'integration event % not found', process_shopify_order_paid.event_id using errcode = 'P0002';
  end if;
  if ev.topic <> 'orders/paid' then
    raise exception 'event % is not an orders/paid event', ev.id using errcode = '22023';
  end if;
  if ev.status in ('processed', 'skipped', 'rejected') then
    perform private.shopify_close_event_job(ev.id);
    return query select ev.status, ev.outcome, ev.sale_id, ev.last_error_code, ev.last_error;
    return;
  end if;
  select s.accept_test_orders into accept_tests from public.shopify_settings s where s.id = 1;
  if ev.test_delivery and not coalesce(accept_tests, false) then
    update public.integration_events e
    set status = 'skipped', outcome = 'test_order', processed_at = pg_catalog.now()
    where e.id = ev.id;
    perform private.shopify_close_event_job(ev.id);
    return query select 'skipped'::public.integration_event_status, 'test_order'::text, null::uuid, null::text, null::text;
    return;
  end if;
  update public.integration_events e set attempts = e.attempts + 1 where e.id = ev.id;
  p := ev.payload;
  order_name := coalesce(nullif(pg_catalog.btrim(ev.subject), ''), 'from Shopify');

  -- (b) The business writes: all or nothing.
  begin
    -- 1. Parse and validate the REST order.
    if p is null or pg_catalog.jsonb_typeof(p) <> 'object' then
      perform private.shopify_raise('shopify_payload_invalid',
        'Shopify sent an order BICII cannot read (no payload). Check the payload in the event inspector.');
    end if;
    order_gid := private.shopify_gid_or_null('Order', p ->> 'id');
    if order_gid is null then
      perform private.shopify_raise('shopify_payload_invalid',
        'Shopify sent an order BICII cannot read (missing id). Check the payload in the event inspector.');
    end if;
    order_name := pg_catalog.left(coalesce(
      nullif(pg_catalog.btrim(p ->> 'name'), ''),
      '#' || nullif(pg_catalog.btrim(p ->> 'order_number'), ''),
      'Order ' || private.shopify_gid_number(order_gid)
    ), 100);
    order_currency := p ->> 'currency';
    if order_currency is null or order_currency !~ '^[A-Z]{3}$' then
      perform private.shopify_raise('shopify_payload_invalid',
        'Shopify sent an order BICII cannot read (missing currency). Check the payload in the event inspector.');
    end if;
    if nullif(pg_catalog.btrim(p ->> 'processed_at'), '') is not null then
      begin
        recognized := (p ->> 'processed_at')::timestamptz;
      exception
        when others then
          perform private.shopify_raise('shopify_payload_invalid',
            'Shopify sent an order BICII cannot read (processed_at). Check the payload in the event inspector.');
      end;
    end if;
    -- D80: the payload's processed_at, else the trigger time, else receipt.
    recognized := coalesce(recognized, ev.triggered_at, ev.received_at);
    if p ? 'taxes_included' and pg_catalog.jsonb_typeof(p -> 'taxes_included') not in ('boolean', 'null') then
      perform private.shopify_raise('shopify_payload_invalid',
        'Shopify sent an order BICII cannot read (taxes_included). Check the payload in the event inspector.');
    end if;
    taxes_included := coalesce((p ->> 'taxes_included')::boolean, false);
    tax := coalesce(
      private.shopify_decimal(private.shopify_money_text(p, 'current_total_tax'), 'current_total_tax', 'an order'),
      private.shopify_decimal(private.shopify_money_text(p, 'total_tax'), 'total_tax', 'an order'),
      0
    );
    if p ? 'customer' and pg_catalog.jsonb_typeof(p -> 'customer') = 'object' and (p #>> '{customer,id}') is not null then
      customer_gid := private.shopify_gid_or_null('Customer', p #>> '{customer,id}');
      if customer_gid is null then
        perform private.shopify_raise('shopify_payload_invalid',
          'Shopify sent an order BICII cannot read (customer id). Check the payload in the event inspector.');
      end if;
    end if;
    if pg_catalog.jsonb_typeof(p -> 'line_items') is distinct from 'array'
       or pg_catalog.jsonb_array_length(p -> 'line_items') = 0 then
      perform private.shopify_raise('shopify_payload_invalid',
        'Shopify sent an order BICII cannot read (missing line_items). Check the payload in the event inspector.');
    end if;
    for li in select e.v from pg_catalog.jsonb_array_elements(p -> 'line_items') with ordinality e(v, n) order by e.n loop
      if pg_catalog.jsonb_typeof(li) <> 'object' then
        perform private.shopify_raise('shopify_payload_invalid',
          'Shopify sent an order BICII cannot read (a line item). Check the payload in the event inspector.');
      end if;
      line_gid := private.shopify_gid_or_null('LineItem', li ->> 'id');
      qty := private.shopify_count(li ->> 'quantity', 'line item quantity', 'an order');
      current_qty := private.shopify_count(li ->> 'current_quantity', 'line item current_quantity', 'an order');
      if line_gid is null or qty is null then
        perform private.shopify_raise('shopify_payload_invalid',
          'Shopify sent an order BICII cannot read (a line item id or quantity). Check the payload in the event inspector.');
      end if;
      qty := coalesce(current_qty, qty);
      continue when qty = 0;
      price := private.shopify_decimal(private.shopify_money_text(li, 'price'), 'line item price', 'an order');
      if price is null or price < 0 then
        perform private.shopify_raise('shopify_payload_invalid',
          'Shopify sent an order BICII cannot read (a line item price). Check the payload in the event inspector.');
      end if;
      discount := 0;
      if pg_catalog.jsonb_typeof(li -> 'discount_allocations') = 'array' then
        for disc in select d.v from pg_catalog.jsonb_array_elements(li -> 'discount_allocations') d(v) loop
          discount := discount + coalesce(
            private.shopify_decimal(private.shopify_money_text(disc, 'amount'), 'a discount allocation', 'an order'), 0
          );
        end loop;
      end if;
      -- D80: what Shopify charged for the line.
      line_total := round(price * qty - discount, 2);
      if line_total < 0 then
        perform private.shopify_raise('shopify_payload_invalid',
          'Shopify sent an order BICII cannot read (a discount larger than its line). Check the payload in the event inspector.');
      end if;
      variant_raw := nullif(pg_catalog.btrim(li ->> 'variant_id'), '');
      variant_gid := private.shopify_gid_or_null('ProductVariant', variant_raw);
      if variant_raw is not null and variant_gid is null then
        perform private.shopify_raise('shopify_payload_invalid',
          'Shopify sent an order BICII cannot read (a variant id). Check the payload in the event inspector.');
      end if;
      title := coalesce(nullif(pg_catalog.btrim(li ->> 'title'), ''), 'Untitled line');
      parsed := parsed || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'line_gid', line_gid, 'title', title, 'variant_gid', variant_gid, 'qty', qty, 'total', line_total
      ));
    end loop;
    if pg_catalog.jsonb_array_length(parsed) = 0 then
      perform private.shopify_raise('shopify_payload_invalid',
        'Shopify sent an order BICII cannot read (no line item has a quantity). Check the payload in the event inspector.');
    end if;

    -- 2. Deliveries of one order, one at a time.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bicii.shopify.order:' || order_gid, 0));

    -- 3. Already recorded (another delivery or webhook id): one effect.
    select s.id into existing_sale from public.sales s where s.shopify_order_id = order_gid;
    if found then
      update public.integration_events e
      set status = 'processed', processed_at = pg_catalog.now(), outcome = 'duplicate_order',
          sale_id = existing_sale, last_error_code = null, last_error = null, last_error_detail = null
      where e.id = ev.id;
      perform private.shopify_close_event_job(ev.id);
      perform private.shopify_close_order_siblings(ev.id, order_gid, existing_sale);
    elsif exists (
      select 1 from public.integration_events o
      where o.topic = 'orders/paid' and o.shopify_order_gid = order_gid and o.id <> ev.id and o.status = 'skipped'
    ) then
      -- 3b. Another delivery of this order was closed without a sale
      -- (dismissed, a test or a POS order): that is final for the order
      -- (D87), so a delivery under a new webhook id records nothing.
      update public.integration_events e
      set status = 'skipped', processed_at = pg_catalog.now(), outcome = 'earlier_delivery_skipped',
          last_error_code = null, last_error = null, last_error_detail = null
      where e.id = ev.id;
      perform private.shopify_close_event_job(ev.id);
    else
      -- 4. Settings, currency (D35) and tax basis (D89).
      select s.* into settings from public.shopify_settings s where s.id = 1;
      if not found then
        perform private.shopify_raise('shopify_settings_missing',
          'Shopify settings are missing, so BICII does not know which location sells online. An admin must set them; this will be retried.');
      end if;
      select l.name into online_name from public.locations l where l.id = settings.online_location_id;
      if order_currency <> private.shop_currency() then
        perform private.shopify_raise('shopify_currency_mismatch', pg_catalog.format(
          'Order %s is in %s but the shop records sales in %s. Record it by hand and dismiss this.',
          order_name, order_currency, private.shop_currency()));
      end if;
      if not taxes_included and tax > 0 then
        perform private.shopify_raise('shopify_tax_basis_unsupported', pg_catalog.format(
          'Order %s was charged tax on top of the price; BICII records tax-inclusive prices. Record it by hand and dismiss this.',
          order_name));
      end if;

      -- 5. Every line maps to a product through its variant (never by
      -- title or SKU), or nothing is recorded.
      for m in select e.v from pg_catalog.jsonb_array_elements(parsed) with ordinality e(v, n) order by e.n loop
        select pr.id, pr.tracking_type into prod
        from public.products pr
        where pr.shopify_variant_id = (m ->> 'variant_gid');
        if (m ->> 'variant_gid') is null then
          has_custom_unmapped := true;
          unmapped_parts := unmapped_parts
            || pg_catalog.format('"%s" is a custom Shopify line with no product', m ->> 'title');
        elsif prod.id is null then
          has_variant_unmapped := true;
          unmapped_parts := unmapped_parts || pg_catalog.format(
            '"%s" (Shopify variant %s) is not linked to a BICII product',
            m ->> 'title', private.shopify_gid_number(m ->> 'variant_gid'));
        else
          mapped := mapped || pg_catalog.jsonb_build_array(
            m || pg_catalog.jsonb_build_object('product_id', prod.id, 'tracking', prod.tracking_type::text)
          );
        end if;
      end loop;
      if pg_catalog.cardinality(unmapped_parts) > 0 then
        perform private.shopify_raise('shopify_variant_unmapped', pg_catalog.format(
          'Order %s: %s.%s%s', order_name, pg_catalog.array_to_string(unmapped_parts, '; '),
          case when has_variant_unmapped then
            case when pg_catalog.cardinality(unmapped_parts) > 1 and not has_custom_unmapped
                 then ' Link each to the product it is, then retry.'
                 else ' Link it to the product it is, then retry.' end
          else '' end,
          case when has_custom_unmapped
               then ' Record it by hand if needed and dismiss this with a reason.' else '' end));
      end if;

      -- 6. The sale header (lock order 0); its S- number and created_by come
      -- from sales_enforce_rules. The customer only through a linked
      -- Shopify customer id, never by email (D86).
      if customer_gid is not null then
        select c.id into customer_key from public.customers c where c.shopify_customer_id = customer_gid;
      end if;
      insert into public.sales as s (
        id, source, customer_id, shopify_order_id, shopify_order_name, recognized_at, status, currency,
        shopify_customer_id, integration_event_id
      )
      values (
        gen_random_uuid(), 'online_shopify', customer_key, order_gid, order_name, recognized, 'recorded',
        order_currency, customer_gid, ev.id
      )
      returning s.* into sale;

      -- 7. Locks in the global order: the stock of every product (3) ...
      for pid in
        select distinct (x.v ->> 'product_id')::uuid from pg_catalog.jsonb_array_elements(mapped) x(v) order by 1
      loop
        perform private.lock_stock(pid);
      end loop;
      -- ... the oldest available units of each unique product at the
      -- online location (D81), chosen under the stock lock (every stock
      -- writer of the product holds it) and then locked in id order (5) ...
      for pid, need, first_title in
        select (x.v ->> 'product_id')::uuid, sum((x.v ->> 'qty')::integer)::integer,
               (pg_catalog.array_agg(x.v ->> 'title' order by x.n))[1]
        from pg_catalog.jsonb_array_elements(mapped) with ordinality x(v, n)
        where x.v ->> 'tracking' = 'unique'
        group by 1
        order by 1
      loop
        select coalesce(pg_catalog.array_agg(c.id order by c.created_at, c.id), '{}') into pool
        from (
          select u.id, u.created_at
          from public.inventory_units u
          where u.product_id = pid and u.location_id = settings.online_location_id and u.status = 'available'
            and u.ownership_type <> 'customer_owned' and u.archived_at is null
          order by u.created_at, u.id
          limit need
        ) c;
        have := coalesce(pg_catalog.cardinality(pool), 0);
        if have < need then
          perform private.shopify_raise('shopify_unit_unavailable', pg_catalog.format(
            'Order %s: "%s" needs %s available unit%s at %s but %s. It may have sold in the shop. Refund it in Shopify and dismiss this, or make a unit available and retry.',
            order_name, first_title, need, case when need = 1 then '' else 's' end, online_name,
            case when have = 0 then 'none is available'
                 when have = 1 then 'only 1 is available'
                 else pg_catalog.format('only %s are available', have) end));
        end if;
        unit_pool := unit_pool || pg_catalog.jsonb_build_object(pid::text, pg_catalog.to_jsonb(pool));
        all_units := all_units || pool;
        unique_pids := unique_pids || pid;
      end loop;
      perform 1 from public.inventory_units u where u.id = any (all_units) order by u.id for update;
      -- ... their consignment items and every active item of each consigned
      -- quantity product on the order (sell_line's FIFO reads them) (6).
      select coalesce(pg_catalog.array_agg(distinct (x.v ->> 'product_id')::uuid), '{}') into quantity_pids
      from pg_catalog.jsonb_array_elements(mapped) x(v)
      where x.v ->> 'tracking' = 'quantity';
      perform 1
      from public.consignment_items i
      where i.id in (select u.consignment_item_id from public.inventory_units u where u.id = any (all_units))
         or (i.status = 'active' and i.product_id = any (quantity_pids))
      order by i.id
      for update;
      -- Quantity products: enough on hand at the online location (D82; a
      -- sale never takes stock below zero). sell_line checks each line again.
      for pid, need, first_title in
        select (x.v ->> 'product_id')::uuid, sum((x.v ->> 'qty')::integer)::integer,
               (pg_catalog.array_agg(x.v ->> 'title' order by x.n))[1]
        from pg_catalog.jsonb_array_elements(mapped) with ordinality x(v, n)
        where x.v ->> 'tracking' = 'quantity'
        group by 1
        order by 1
      loop
        have := private.stock_on_hand(pid, settings.online_location_id);
        if have < need then
          perform private.shopify_raise('shopify_insufficient_stock', pg_catalog.format(
            'Order %s: "%s" needs %s but BICII shows %s on hand at %s. Count and adjust the stock, then retry, or refund in Shopify and dismiss this.',
            order_name, first_title, need, have, online_name));
        end if;
      end loop;

      -- 8. The lines, through THE sale-line writer (online_sale), priced so
      -- that they sum to Shopify's discounted line totals (D80).
      for m in select e.v from pg_catalog.jsonb_array_elements(mapped) with ordinality e(v, n) order by e.n loop
        pid := (m ->> 'product_id')::uuid;
        qty := (m ->> 'qty')::integer;
        line_total := (m ->> 'total')::numeric;
        unit_ids := '{}';
        unit_prices := '{}';
        if m ->> 'tracking' = 'unique' then
          -- One line per unit; the last unit absorbs the remainder.
          prices := '{}';
          for split in select * from private.shopify_split_amount(line_total, qty) loop
            for i in 1 .. split.quantity loop
              prices := prices || split.unit_price;
            end loop;
          end loop;
          cursor_at := coalesce((used ->> pid::text)::integer, 0);
          for i in 1 .. qty loop
            uid := (unit_pool -> pid::text ->> cursor_at)::uuid;
            cursor_at := cursor_at + 1;
            line_no := line_no + 1;
            perform private.sell_line(
              sale, line_no,
              pg_catalog.jsonb_build_object(
                'inventory_unit_id', uid,
                'unit_sale_price', prices[i]::text,
                'shopify_line_item_id', m ->> 'line_gid'
              ),
              'online_sale'
            );
            unit_ids := unit_ids || uid;
            unit_prices := unit_prices || prices[i];
          end loop;
          used := used || pg_catalog.jsonb_build_object(pid::text, cursor_at);
        else
          -- One line, or two parts for an uneven split.
          select count(*)::integer into split_rows from private.shopify_split_amount(line_total, qty);
          part := 0;
          for split in select * from private.shopify_split_amount(line_total, qty) loop
            part := part + 1;
            line_no := line_no + 1;
            p_line := pg_catalog.jsonb_build_object(
              'product_id', pid,
              'location_id', settings.online_location_id,
              'quantity', split.quantity,
              'unit_sale_price', split.unit_price::text,
              'shopify_line_item_id', m ->> 'line_gid'
            );
            if split_rows > 1 then
              p_line := p_line || pg_catalog.jsonb_build_object('shopify_line_part', part);
            end if;
            perform private.sell_line(sale, line_no, p_line, 'online_sale');
            unit_prices := unit_prices || split.unit_price;
          end loop;
        end if;
        result_lines := result_lines || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'shopify_line_item_id', m ->> 'line_gid',
          'product_id', pid,
          'unit_ids', pg_catalog.to_jsonb(unit_ids),
          'quantity', qty,
          'line_total', line_total,
          'unit_prices', pg_catalog.to_jsonb(unit_prices)
        ));
      end loop;

      -- 9. Products last (lock order 7): a public unique product with no
      -- unit left becomes sold (D26).
      for pid in select x.id from pg_catalog.unnest(unique_pids) x(id) order by 1 loop
        perform private.refresh_unique_publication(pid);
      end loop;

      -- 10. Done: the event, its job, the order's other open deliveries
      -- (duplicate_order) and any refund that waited for this order (D87).
      update public.integration_events e
      set status = 'processed', processed_at = pg_catalog.now(), outcome = 'sale_recorded', sale_id = sale.id,
          last_error_code = null, last_error = null, last_error_detail = null,
          result = pg_catalog.jsonb_build_object(
            'sale_id', sale.id, 'sale_number', sale.sale_number, 'lines', result_lines
          )
      where e.id = ev.id;
      perform private.shopify_close_event_job(ev.id);
      perform private.shopify_close_order_siblings(ev.id, order_gid, sale.id);
      update public.integration_retry_queue q
      set status = 'queued', next_attempt_at = pg_catalog.now(), locked_at = null,
          max_attempts = greatest(q.max_attempts, q.attempts + 3)
      from public.integration_events r
      where q.integration_event_id = r.id and q.kind = 'shopify_event' and q.status in ('queued', 'needs_attention')
        and r.topic = 'refunds/create' and r.shopify_order_gid = order_gid;
    end if;
  exception
    when sqlstate 'P0001' then
      get stacked diagnostics err_code = message_text, err_message = pg_exception_detail;
      if err_code not like 'shopify\_%' then
        -- A sell_line refusal (insufficient_stock, consignment_quantity_
        -- unavailable, sale_before_stock, sale_cost_missing, ...).
        err_message := pg_catalog.format('Order %s could not be recorded: %s', order_name, coalesce(nullif(err_message, ''), err_code));
        err_code := 'shopify_sale_refused';
      end if;
    when others then
      get stacked diagnostics err_state = returned_sqlstate, err_text = message_text;
      err_code := 'shopify_unexpected_error';
      err_message := 'Something unexpected went wrong while recording this. It will be retried automatically.';
      err_detail := err_state || ': ' || err_text;
  end;

  -- (c) Failure: nothing above survived; the event and its job say why.
  if err_code is not null then
    perform private.shopify_event_failed(
      ev.id, err_code, err_message, err_detail,
      case when err_code = 'shopify_variant_unmapped'
           then pg_catalog.jsonb_build_object('unmapped_lines', private.shopify_unmapped_lines(ev.payload))
           else '{}'::jsonb end
    );
    return query select 'failed'::public.integration_event_status, null::text, null::uuid, err_code, err_message;
    return;
  end if;

  select e.* into ev from public.integration_events e where e.id = ev.id;
  return query select ev.status, ev.outcome, ev.sale_id, null::text, null::text;
end;
$$;

comment on function public.process_shopify_order_paid(uuid) is
  'service_role: record an orders/paid event as one online sale through private.sell_line (online_sale), all or nothing (D80-D82, D89). Replays and second deliveries have no further effect (duplicate_order), and recording the order closes its other open deliveries as duplicate_order. A delivery of an order another delivery of which was skipped (dismissed, test or POS) is skipped (earlier_delivery_skipped): a dismissal is final for the order (D87). A failure leaves the event failed with a human message and its job needs_attention (or queued with backoff when transient, D87); it never raises for a business failure.';

-- ---------------------------------------------------------------------------
-- process_shopify_refund (service_role): a refunds/create event becomes one
-- sale_refunds row and nothing else (D85; D7, D49).
-- ---------------------------------------------------------------------------
create function public.process_shopify_refund(event_id uuid)
returns table (
  event_status public.integration_event_status,
  outcome text,
  sale_id uuid,
  error_code text,
  error_message text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  ev public.integration_events;
  accept_tests boolean;
  p jsonb;
  refund_gid text;
  order_gid text;
  refund_label text;
  order_label text;
  note text;
  sale public.sales;
  dup_sale uuid;
  sib_status public.integration_event_status;
  sib_sale uuid;
  t jsonb;
  t_amount numeric;
  t_currency text;
  transactions_total numeric := 0;
  line_items_total numeric := 0;
  shipping numeric := 0;
  rli jsonb;
  line_amount numeric;
  line_details jsonb := '[]'::jsonb;
  has_lines boolean := false;
  sale_total numeric;
  refunded numeric;
  remaining numeric;
  amount numeric;
  refund_row public.sale_refunds;
  res_status public.integration_event_status;
  res_outcome text;
  res_result jsonb;
  err_code text;
  err_message text;
  err_detail text;
  err_state text;
  err_text text;
begin
  if process_shopify_refund.event_id is null then
    raise exception 'event_id is required' using errcode = '22004';
  end if;

  -- (a) The event row (lock order 0) and replays.
  select e.* into ev from public.integration_events e where e.id = process_shopify_refund.event_id for update;
  if not found then
    raise exception 'integration event % not found', process_shopify_refund.event_id using errcode = 'P0002';
  end if;
  if ev.topic <> 'refunds/create' then
    raise exception 'event % is not a refunds/create event', ev.id using errcode = '22023';
  end if;
  if ev.status in ('processed', 'skipped', 'rejected') then
    perform private.shopify_close_event_job(ev.id);
    return query select ev.status, ev.outcome, ev.sale_id, ev.last_error_code, ev.last_error;
    return;
  end if;
  select s.accept_test_orders into accept_tests from public.shopify_settings s where s.id = 1;
  if ev.test_delivery and not coalesce(accept_tests, false) then
    update public.integration_events e
    set status = 'skipped', outcome = 'test_order', processed_at = pg_catalog.now()
    where e.id = ev.id;
    perform private.shopify_close_event_job(ev.id);
    return query select 'skipped'::public.integration_event_status, 'test_order'::text, null::uuid, null::text, null::text;
    return;
  end if;
  update public.integration_events e set attempts = e.attempts + 1 where e.id = ev.id;
  p := ev.payload;

  -- (b) All or nothing.
  begin
    if p is null or pg_catalog.jsonb_typeof(p) <> 'object' then
      perform private.shopify_raise('shopify_payload_invalid',
        'Shopify sent a refund BICII cannot read (no payload). Check the payload in the event inspector.');
    end if;
    refund_gid := private.shopify_gid_or_null('Refund', p ->> 'id');
    order_gid := private.shopify_gid_or_null('Order', p ->> 'order_id');
    if refund_gid is null or order_gid is null then
      perform private.shopify_raise('shopify_payload_invalid',
        'Shopify sent a refund BICII cannot read (missing id or order_id). Check the payload in the event inspector.');
    end if;
    refund_label := private.shopify_gid_number(refund_gid);
    note := pg_catalog.left(coalesce(nullif(pg_catalog.btrim(p ->> 'note'), ''), 'Refunded in Shopify'), 500);

    -- Lock order 0: the order's advisory lock, then the sale row (as
    -- record_sale_refund).
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bicii.shopify.order:' || order_gid, 0));
    select s.* into sale from public.sales s where s.shopify_order_id = order_gid for update;

    -- Another delivery of this refund (another webhook id) already decided
    -- (D87, one business effect): processed is a duplicate; skipped
    -- (dismissed, a test, or its order not recorded) is final.
    select o.status, o.sale_id into sib_status, sib_sale
    from public.integration_events o
    where o.topic = 'refunds/create' and o.shopify_order_gid = order_gid and o.id <> ev.id
      and o.status in ('processed', 'skipped')
      and private.shopify_gid_or_null('Refund', o.payload ->> 'id') = refund_gid
    order by (o.status = 'processed') desc, o.id
    limit 1;
    select r.sale_id into dup_sale from public.sale_refunds r where r.shopify_refund_id = refund_gid;
    if found or sib_status = 'processed' then
      res_status := 'processed';
      res_outcome := 'duplicate_refund';
      update public.integration_events e
      set status = 'processed', processed_at = pg_catalog.now(), outcome = 'duplicate_refund',
          sale_id = coalesce(dup_sale, sib_sale),
          last_error_code = null, last_error = null, last_error_detail = null
      where e.id = ev.id;
      perform private.shopify_close_event_job(ev.id);
    elsif sib_status = 'skipped' then
      update public.integration_events e
      set status = 'skipped', processed_at = pg_catalog.now(), outcome = 'earlier_delivery_skipped',
          last_error_code = null, last_error = null, last_error_detail = null
      where e.id = ev.id;
      perform private.shopify_close_event_job(ev.id);
    elsif sale.id is null then
      if exists (
        select 1 from public.integration_events o
        where o.topic = 'orders/paid' and o.shopify_order_gid = order_gid and o.status = 'skipped'
      ) then
        -- The order was dismissed, a test or a POS order: nothing to refund
        -- in BICII.
        update public.integration_events e
        set status = 'skipped', processed_at = pg_catalog.now(), outcome = 'order_not_recorded',
            last_error_code = null, last_error = null, last_error_detail = null
        where e.id = ev.id;
        perform private.shopify_close_event_job(ev.id);
      else
        select coalesce(
                 (select o.subject from public.integration_events o
                   where o.topic = 'orders/paid' and o.shopify_order_gid = order_gid and o.subject is not null
                   order by o.received_at limit 1),
                 private.shopify_gid_number(order_gid)
               ) into order_label;
        perform private.shopify_raise('shopify_refund_order_unknown', pg_catalog.format(
          'Refund %s is for Shopify order %s, which BICII has not recorded yet. It is recorded automatically as soon as the order is.',
          refund_label, order_label));
      end if;
    else
      if sale.status = 'voided' then
        perform private.shopify_raise('shopify_sale_refused', pg_catalog.format(
          'Refund %s could not be recorded: %s was voided.', refund_label, sale.sale_number));
      end if;
      -- The money actually refunded: successful refund transactions.
      if pg_catalog.jsonb_typeof(p -> 'transactions') = 'array' then
        for t in select x.v from pg_catalog.jsonb_array_elements(p -> 'transactions') x(v) loop
          continue when pg_catalog.jsonb_typeof(t) <> 'object'
            or coalesce(t ->> 'kind', '') <> 'refund' or coalesce(t ->> 'status', '') <> 'success';
          t_amount := private.shopify_decimal(private.shopify_money_text(t, 'amount'), 'a transaction amount', 'a refund');
          t_currency := coalesce(t #>> '{amount_set,shop_money,currency_code}', t ->> 'currency');
          if t_currency is not null and t_currency <> sale.currency then
            perform private.shopify_raise('shopify_currency_mismatch', pg_catalog.format(
              'Refund %s is in %s but %s was recorded in %s. Record it by hand and dismiss this.',
              refund_label, t_currency, sale.sale_number, sale.currency));
          end if;
          transactions_total := transactions_total + pg_catalog.abs(coalesce(t_amount, 0));
        end loop;
      end if;
      -- The money attributed to lines (D85; one rule:
      -- private.shopify_refund_line_amount).
      if pg_catalog.jsonb_typeof(p -> 'refund_line_items') = 'array' then
        for rli in select x.v from pg_catalog.jsonb_array_elements(p -> 'refund_line_items') x(v) loop
          continue when pg_catalog.jsonb_typeof(rli) <> 'object';
          has_lines := true;
          perform private.shopify_decimal(rli #>> '{subtotal_set,shop_money,amount}', 'a refund line subtotal', 'a refund');
          perform private.shopify_decimal(rli ->> 'subtotal', 'a refund line subtotal', 'a refund');
          line_amount := coalesce(private.shopify_refund_line_amount(rli), 0);
          line_items_total := line_items_total + line_amount;
          line_details := line_details || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'line_item_id', private.shopify_gid_or_null('LineItem', rli ->> 'line_item_id'),
            'quantity', rli -> 'quantity',
            'subtotal', line_amount,
            'restock_type', rli ->> 'restock_type'
          ));
        end loop;
      end if;
      -- Shipping is never a sale line, so its refund stays in the result.
      if pg_catalog.jsonb_typeof(p -> 'refund_shipping_lines') = 'array' then
        select shipping + coalesce(sum(pg_catalog.abs(coalesce(
                 private.shopify_decimal(
                   coalesce(x.v #>> '{subtotal_amount_set,shop_money,amount}', x.v ->> 'subtotal_amount',
                            private.shopify_money_text(x.v, 'amount')),
                   'a shipping refund', 'a refund'),
                 0))), 0)
        into shipping
        from pg_catalog.jsonb_array_elements(p -> 'refund_shipping_lines') x(v)
        where pg_catalog.jsonb_typeof(x.v) = 'object';
      end if;
      if pg_catalog.jsonb_typeof(p -> 'order_adjustments') = 'array' then
        select shipping + coalesce(sum(pg_catalog.abs(coalesce(
                 private.shopify_decimal(private.shopify_money_text(x.v, 'amount'), 'an order adjustment', 'a refund'),
                 0))), 0)
        into shipping
        from pg_catalog.jsonb_array_elements(p -> 'order_adjustments') x(v)
        where pg_catalog.jsonb_typeof(x.v) = 'object' and x.v ->> 'kind' = 'shipping_refund';
      end if;

      -- D85: the line-attributable refund, never above the money refunded,
      -- capped at what is left of the sale (D49's cap).
      select coalesce(sum(sl.sale_total), 0) into sale_total from public.sale_lines sl where sl.sale_id = sale.id;
      select coalesce(sum(r.amount), 0) into refunded from public.sale_refunds r where r.sale_id = sale.id;
      remaining := greatest(sale_total - refunded, 0);
      amount := least(case when has_lines then line_items_total else transactions_total end, transactions_total, remaining);
      amount := greatest(round(amount, 2), 0);
      res_result := pg_catalog.jsonb_build_object(
        'amount', amount,
        'transactions_total', transactions_total,
        'line_items_total', line_items_total,
        'shipping_refunded', shipping,
        'unallocated_refund', transactions_total - amount,
        'refund_line_items', line_details
      );

      if transactions_total = 0 then
        res_outcome := 'no_money_refunded';
      elsif amount = 0 then
        res_outcome := 'refund_not_allocated';
      else
        insert into public.sale_refunds as r (
          id, sale_id, shopify_refund_id, amount, currency, reason, restocked, recorded_by, integration_event_id
        )
        values (gen_random_uuid(), sale.id, refund_gid, amount, sale.currency, note, false, null, ev.id)
        returning r.* into refund_row;
        -- Exactly record_sale_refund's rule (D49).
        update public.sales s
        set status = case
              when refunded + amount >= sale_total then 'refunded'::public.sale_status
              else 'partially_refunded'::public.sale_status
            end
        where s.id = sale.id;
        res_outcome := 'refund_recorded';
        res_result := pg_catalog.jsonb_build_object('sale_refund_id', refund_row.id) || res_result;
      end if;
      update public.integration_events e
      set status = 'processed', processed_at = pg_catalog.now(), outcome = res_outcome, sale_id = sale.id,
          last_error_code = null, last_error = null, last_error_detail = null, result = res_result
      where e.id = ev.id;
      perform private.shopify_close_event_job(ev.id);
    end if;
  exception
    when sqlstate 'P0001' then
      get stacked diagnostics err_code = message_text, err_message = pg_exception_detail;
      if err_code not like 'shopify\_%' then
        err_message := pg_catalog.format('Refund %s could not be recorded: %s',
          coalesce(refund_label, '?'), coalesce(nullif(err_message, ''), err_code));
        err_code := 'shopify_sale_refused';
      end if;
    when others then
      get stacked diagnostics err_state = returned_sqlstate, err_text = message_text;
      err_code := 'shopify_unexpected_error';
      err_message := 'Something unexpected went wrong while recording this. It will be retried automatically.';
      err_detail := err_state || ': ' || err_text;
  end;

  if err_code is not null then
    perform private.shopify_event_failed(ev.id, err_code, err_message, err_detail, '{}'::jsonb);
    return query select 'failed'::public.integration_event_status, null::text, null::uuid, err_code, err_message;
    return;
  end if;

  select e.* into ev from public.integration_events e where e.id = ev.id;
  return query select ev.status, ev.outcome, ev.sale_id, null::text, null::text;
end;
$$;

comment on function public.process_shopify_refund(uuid) is
  'service_role: record a refunds/create event as one sale_refunds row (D85): the line-attributable refund, never above the money refunded, capped at the sale''s remaining total; the sale becomes refunded or partially_refunded as record_sale_refund decides (D49). Never a movement, unit, consignment, line or settlement change (D7). A refund before its order waits (shopify_refund_order_unknown, retried; re-queued when the order is recorded); a refund of a dismissed, test or POS order is skipped (order_not_recorded). Another delivery of the same refund (same refund id, another webhook id) that was processed makes this one duplicate_refund; one that was skipped (dismissed, test, order not recorded) makes this one skipped (earlier_delivery_skipped): a dismissal is final (D87). The match reads the stored payloads, so it holds until they are purged.';

-- ---------------------------------------------------------------------------
-- process_shopify_event (service_role): the one entry point the queue
-- worker calls.
-- ---------------------------------------------------------------------------
create function public.process_shopify_event(event_id uuid)
returns table (
  event_status public.integration_event_status,
  outcome text,
  sale_id uuid,
  error_code text,
  error_message text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  ev public.integration_events;
begin
  if process_shopify_event.event_id is null then
    raise exception 'event_id is required' using errcode = '22004';
  end if;
  select e.* into ev from public.integration_events e where e.id = process_shopify_event.event_id;
  if not found then
    raise exception 'integration event % not found', process_shopify_event.event_id using errcode = 'P0002';
  end if;
  if ev.topic = 'orders/paid' then
    return query select * from public.process_shopify_order_paid(ev.id);
    return;
  elsif ev.topic = 'refunds/create' then
    return query select * from public.process_shopify_refund(ev.id);
    return;
  end if;
  select e.* into ev from public.integration_events e where e.id = ev.id for update;
  if ev.status in ('pending', 'failed') then
    update public.integration_events e
    set status = 'skipped', outcome = 'topic_not_handled', processed_at = pg_catalog.now()
    where e.id = ev.id
    returning e.* into ev;
  end if;
  perform private.shopify_close_event_job(ev.id);
  return query select ev.status, ev.outcome, ev.sale_id, ev.last_error_code, ev.last_error;
end;
$$;

comment on function public.process_shopify_event(uuid) is
  'service_role: process one stored event by its topic (orders/paid, refunds/create); any other topic is skipped (topic_not_handled) and its job closed.';

-- ---------------------------------------------------------------------------
-- retry_integration_job (admin; manage_inventory for a product sync, D86):
-- put a job back in the queue now. A running job is returned unchanged.
-- ---------------------------------------------------------------------------
create function public.retry_integration_job(job_id uuid)
returns public.integration_retry_queue
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  actor uuid := private.require_staff();
  job public.integration_retry_queue;
begin
  if not private.is_admin() and not private.has_permission('manage_inventory') then
    raise exception 'an admin retries integration jobs' using errcode = '42501';
  end if;
  if retry_integration_job.job_id is null then
    raise exception 'job_id is required' using errcode = '22004';
  end if;
  select q.* into job from public.integration_retry_queue q where q.id = retry_integration_job.job_id for update;
  if not found then
    raise exception 'integration job % not found', retry_integration_job.job_id using errcode = 'P0002';
  end if;
  -- D86: only admins handle inbound events (their payloads name customers).
  if job.kind <> 'product_sync' and not private.is_admin() then
    raise exception 'an admin retries Shopify order and refund jobs' using errcode = '42501';
  end if;
  if job.status in ('done', 'dismissed') then
    raise exception using
      errcode = 'P0001',
      message = 'integration_job_closed',
      detail = 'That item was already resolved.';
  end if;
  if job.status = 'running' then
    return job;
  end if;
  update public.integration_retry_queue q
  set status = 'queued', next_attempt_at = pg_catalog.now(), locked_at = null,
      max_attempts = greatest(q.max_attempts, q.attempts + 3),
      last_retried_by = actor, last_retried_at = pg_catalog.now()
  where q.id = job.id
  returning q.* into job;
  insert into public.integration_audit_events (
    event_type, product_id, job_id, integration_event_id, actor_staff_id, payload, correlation_id
  )
  values (
    'job_retried', job.product_id, job.id, job.integration_event_id, actor,
    pg_catalog.jsonb_build_object('attempts', job.attempts, 'max_attempts', job.max_attempts),
    private.current_correlation_id()
  );
  return job;
end;
$$;

comment on function public.retry_integration_job(uuid) is
  'Admins; staff with manage_inventory for product-sync jobs only (D86): re-queue a queued or needs_attention job now, allowing at least three more attempts (D87); a running job is returned unchanged; done or dismissed -> integration_job_closed. Audited (job_retried).';

-- ---------------------------------------------------------------------------
-- dismiss_integration_job (admin, reason): close a job without processing
-- it. A dismissed order also closes the refunds waiting for it (D87).
-- ---------------------------------------------------------------------------
create function public.dismiss_integration_job(job_id uuid, reason text)
returns public.integration_retry_queue
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  actor uuid := private.require_admin();
  cleaned text := private.require_reason(dismiss_integration_job.reason);
  job public.integration_retry_queue;
  ev public.integration_events;
  closed uuid[] := '{}';
  closed_orders uuid[] := '{}';
begin
  if dismiss_integration_job.job_id is null then
    raise exception 'job_id is required' using errcode = '22004';
  end if;
  -- Lock order as the processors': the event rows first, then the jobs. An
  -- order's deliveries (every orders/paid event of its gid) are locked
  -- together in id order, so two dismissals of one order never deadlock.
  select q.* into job from public.integration_retry_queue q where q.id = dismiss_integration_job.job_id;
  if not found then
    raise exception 'integration job % not found', dismiss_integration_job.job_id using errcode = 'P0002';
  end if;
  if job.integration_event_id is not null then
    select e.* into ev from public.integration_events e where e.id = job.integration_event_id;
    if ev.topic = 'orders/paid' and ev.shopify_order_gid is not null then
      perform 1
      from public.integration_events o
      where o.topic = 'orders/paid' and o.shopify_order_gid = ev.shopify_order_gid
      order by o.id
      for update;
    else
      perform 1 from public.integration_events e where e.id = ev.id for update;
    end if;
  end if;
  select q.* into job from public.integration_retry_queue q where q.id = job.id for update;
  if job.status = 'running' then
    raise exception using
      errcode = 'P0001',
      message = 'integration_job_running',
      detail = 'That item is being retried right now. Try again in a moment.';
  end if;
  if job.status in ('done', 'dismissed') then
    raise exception using
      errcode = 'P0001',
      message = 'integration_job_closed',
      detail = 'That item was already resolved.';
  end if;

  update public.integration_retry_queue q
  set status = 'dismissed', resolved_at = pg_catalog.now(), resolved_by = actor, resolution_reason = cleaned,
      locked_at = null
  where q.id = job.id
  returning q.* into job;

  if job.kind = 'shopify_event' then
    -- The event keeps its last error as the record of why.
    update public.integration_events e
    set status = 'skipped', outcome = 'dismissed', processed_at = pg_catalog.now()
    where e.id = job.integration_event_id
    returning e.* into ev;
    if ev.topic = 'orders/paid' and ev.shopify_order_gid is not null
       and not exists (select 1 from public.sales s where s.shopify_order_id = ev.shopify_order_gid) then
      -- A dismissal is final for the order (D87): its other open
      -- deliveries (another webhook id) close with it, so none can record
      -- it later and none stays on Today. Their events are locked above.
      with sibling_jobs as (
        select q.id
        from public.integration_retry_queue q
        join public.integration_events o on o.id = q.integration_event_id
        where q.kind = 'shopify_event' and q.status in ('queued', 'needs_attention')
          and o.topic = 'orders/paid' and o.shopify_order_gid = ev.shopify_order_gid and o.id <> ev.id
          and o.status in ('pending', 'failed')
        order by q.id
        for update of q
      ),
      closed_sibling_jobs as (
        update public.integration_retry_queue q
        set status = 'dismissed', resolved_at = pg_catalog.now(), resolved_by = actor, locked_at = null,
            resolution_reason = pg_catalog.left('Another delivery of this order was dismissed: ' || cleaned, 500)
        from sibling_jobs w
        where q.id = w.id
        returning q.id, q.integration_event_id
      ),
      closed_sibling_events as (
        update public.integration_events e
        set status = 'skipped', outcome = 'dismissed', processed_at = pg_catalog.now()
        from closed_sibling_jobs c
        where e.id = c.integration_event_id
        returning e.id
      )
      select coalesce(pg_catalog.array_agg(c.id order by c.id), '{}') into closed_orders
      from closed_sibling_jobs c;
      -- The waiting refunds' events, then their jobs (the processors' order).
      perform 1
      from public.integration_events r
      where r.topic = 'refunds/create' and r.shopify_order_gid = ev.shopify_order_gid
      order by r.id
      for update;
      with waiting as (
        select q.id
        from public.integration_retry_queue q
        join public.integration_events r on r.id = q.integration_event_id
        where q.kind = 'shopify_event' and q.status in ('queued', 'needs_attention')
          and r.topic = 'refunds/create' and r.shopify_order_gid = ev.shopify_order_gid
        order by q.id
        for update of q
      ),
      closed_jobs as (
        update public.integration_retry_queue q
        set status = 'dismissed', resolved_at = pg_catalog.now(), resolved_by = actor, locked_at = null,
            resolution_reason = pg_catalog.left('The order was dismissed: ' || cleaned, 500)
        from waiting w
        where q.id = w.id
        returning q.id, q.integration_event_id
      ),
      closed_events as (
        update public.integration_events e
        set status = 'skipped', outcome = 'order_not_recorded', processed_at = pg_catalog.now()
        from closed_jobs c
        where e.id = c.integration_event_id
        returning e.id
      )
      select coalesce(pg_catalog.array_agg(c.id order by c.id), '{}') into closed
      from closed_jobs c;
    end if;
  end if;

  insert into public.integration_audit_events (
    event_type, product_id, job_id, integration_event_id, actor_staff_id, reason, payload, correlation_id
  )
  values (
    'job_dismissed', job.product_id, job.id, job.integration_event_id, actor, cleaned,
    pg_catalog.jsonb_build_object(
      'closed_refund_job_ids', pg_catalog.to_jsonb(closed),
      'closed_order_job_ids', pg_catalog.to_jsonb(closed_orders)
    ),
    private.current_correlation_id()
  );
  return job;
end;
$$;

comment on function public.dismiss_integration_job(uuid, text) is
  'Admins (D86), reason required: close a queued or needs_attention job (its event becomes skipped / dismissed and keeps its last error); dismissing an order is final for that order (D87): unless a sale already exists for it, its other open deliveries close too (skipped / dismissed, ''Another delivery of this order was dismissed: '' || reason) and its waiting refunds close (order_not_recorded); a later delivery of the order or of a refund of it is skipped (earlier_delivery_skipped / order_not_recorded). running -> integration_job_running; done or dismissed -> integration_job_closed. Audited (job_dismissed).';

-- ---------------------------------------------------------------------------
-- link_shopify_variant (admin, reason): map a BICII product to a Shopify
-- variant (D84). Mapping only: nothing is pushed or published.
-- ---------------------------------------------------------------------------
create function public.link_shopify_variant(
  product_id uuid,
  shopify_product_id text,
  shopify_variant_id text,
  reason text
)
returns public.shopify_product_sync
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  actor uuid := private.require_admin();
  cleaned text := private.require_reason(link_shopify_variant.reason);
  product_gid text := private.shopify_gid('Product', link_shopify_variant.shopify_product_id);
  variant_gid text := private.shopify_gid('ProductVariant', link_shopify_variant.shopify_variant_id);
  prod public.products;
  sync public.shopify_product_sync;
begin
  if link_shopify_variant.product_id is null or product_gid is null or variant_gid is null then
    raise exception 'product_id, shopify_product_id and shopify_variant_id are required' using errcode = '22004';
  end if;
  select pr.* into prod from public.products pr where pr.id = link_shopify_variant.product_id for update;
  if not found then
    raise exception 'product % not found', link_shopify_variant.product_id using errcode = 'P0002';
  end if;
  select s.* into sync from public.shopify_product_sync s where s.product_id = prod.id;

  -- Same ids: a replay.
  if prod.shopify_product_id is not distinct from product_gid and prod.shopify_variant_id is not distinct from variant_gid
     and sync.product_id is not null then
    return sync;
  end if;
  if (prod.shopify_variant_id is not null and prod.shopify_variant_id <> variant_gid)
     or (prod.shopify_product_id is not null and prod.shopify_product_id <> product_gid
         and prod.shopify_variant_id is not null) then
    raise exception using
      errcode = 'P0001',
      message = 'shopify_ids_conflict',
      detail = 'This product is already linked to a different Shopify product.';
  end if;
  -- A Shopify product BICII created belongs to that one BICII product.
  if exists (
    select 1
    from public.products o
    join public.shopify_product_sync os on os.product_id = o.id
    where o.shopify_product_id = product_gid and o.id <> prod.id and os.shopify_origin = 'bicii'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'shopify_ids_conflict',
      detail = 'That Shopify product belongs to another BICII product.';
  end if;

  perform private.set_change_reason(cleaned);
  -- A variant on another product raises products_shopify_variant_id_key.
  update public.products pr
  set shopify_product_id = product_gid, shopify_variant_id = variant_gid
  where pr.id = prod.id;
  perform private.set_change_reason(null);

  insert into public.shopify_product_sync as s (product_id, shopify_origin, shopify_handle)
  values (prod.id, 'external', null)
  on conflict (product_id) do update
    set shopify_origin = case when s.shopify_origin = 'bicii' then 'bicii' else 'external' end,
        shopify_handle = case when s.shopify_origin = 'bicii' then s.shopify_handle else null end
  returning s.* into sync;

  insert into public.integration_audit_events (
    event_type, product_id, actor_staff_id, reason, payload, correlation_id
  )
  values (
    'variant_linked', prod.id, actor, cleaned,
    pg_catalog.jsonb_build_object(
      'from', pg_catalog.jsonb_build_object('product', prod.shopify_product_id, 'variant', prod.shopify_variant_id),
      'to', pg_catalog.jsonb_build_object('product', product_gid, 'variant', variant_gid)
    ),
    private.current_correlation_id()
  );
  return sync;
end;
$$;

comment on function public.link_shopify_variant(uuid, text, text, text) is
  'Admins (D86), reason required: link a BICII product to a Shopify product variant (numeric ids or gids) so orders for it map (D84). Mapping only: origin external unless BICII created it, no handle, Publish online untouched, nothing pushed. Another variant already on this product, or a Shopify product BICII created for another product -> shopify_ids_conflict; a variant on another product -> products_shopify_variant_id_key. Same ids: no-op. Audited (variant_linked) and recorded in product history.';

-- ---------------------------------------------------------------------------
-- link_shopify_customer (admin, reason): the durable link (SPEC §17.2,
-- D86). Never by email; never edits a recorded sale.
-- ---------------------------------------------------------------------------
create type public.shopify_customer_link_result as (
  customer_id uuid,
  shopify_customer_id text,
  earlier_online_sales integer
);

create function public.link_shopify_customer(customer_id uuid, shopify_customer_id text, reason text)
returns public.shopify_customer_link_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  actor uuid := private.require_admin();
  cleaned text := private.require_reason(link_shopify_customer.reason);
  customer_gid text := private.shopify_gid('Customer', link_shopify_customer.shopify_customer_id);
  cust public.customers;
  earlier integer;
  result public.shopify_customer_link_result;
begin
  if link_shopify_customer.customer_id is null or customer_gid is null then
    raise exception 'customer_id and shopify_customer_id are required' using errcode = '22004';
  end if;
  select c.* into cust from public.customers c where c.id = link_shopify_customer.customer_id for update;
  if not found then
    raise exception 'customer % not found', link_shopify_customer.customer_id using errcode = 'P0002';
  end if;
  -- Earlier online sales of that Shopify customer keep customer_id null
  -- (sales are immutable); they are shown linked through
  -- sales.shopify_customer_id.
  select count(*)::integer into earlier
  from public.sales s
  where s.source = 'online_shopify' and s.shopify_customer_id = customer_gid and s.customer_id is null;
  if cust.shopify_customer_id is not distinct from customer_gid then
    result := row(cust.id, customer_gid, earlier);
    return result;
  end if;
  if cust.shopify_customer_id is not null then
    raise exception using
      errcode = 'P0001',
      message = 'shopify_customer_already_linked',
      detail = 'That customer is already linked to a different Shopify customer.';
  end if;
  perform private.set_change_reason(cleaned);
  -- Taken by another customer -> customers_shopify_customer_id_key.
  update public.customers c set shopify_customer_id = customer_gid where c.id = cust.id;
  perform private.set_change_reason(null);
  insert into public.integration_audit_events (
    event_type, customer_id, actor_staff_id, reason, payload, correlation_id
  )
  values (
    'customer_linked', cust.id, actor, cleaned,
    pg_catalog.jsonb_build_object('from', cust.shopify_customer_id, 'to', customer_gid, 'earlier_online_sales', earlier),
    private.current_correlation_id()
  );
  result := row(cust.id, customer_gid, earlier);
  return result;
end;
$$;

comment on function public.link_shopify_customer(uuid, text, text) is
  'Admins (D86), reason required: link a BICII customer to a Shopify customer (numeric id or gid). Orders recorded after it get customer_id; earlier online sales are never edited (sales are immutable) and are counted in earlier_online_sales. A different id already on the customer -> shopify_customer_already_linked; an id on another customer -> customers_shopify_customer_id_key. Same id: no-op. Email is never used. Audited (customer_linked).';

-- ---------------------------------------------------------------------------
-- Operational exceptions (SPEC §26, D34, D86). Phase 9 is not built, so
-- this is P5's nine-column shape; the integration rows come from one
-- function, the extension point Phase 9 widens when it appends issue,
-- short_id, title, detail, amount and currency to the view.
-- ---------------------------------------------------------------------------
create function private.integration_exceptions()
returns table (
  kind text,
  severity text,
  entity_type text,
  entity_id uuid,
  entity_label text,
  subject_label text,
  days integer,
  quantity integer,
  since timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select 'integration_failed'::text,
         'danger'::text,
         'integration_job'::text,
         q.id,
         (case when q.kind = 'shopify_event' then coalesce(e.subject, e.topic) else p.short_id end)::text,
         pg_catalog.left(q.last_error, 300)::text,
         (private.shop_today() - private.shop_day(q.created_at))::integer,
         null::integer,
         q.created_at
  from public.integration_retry_queue q
  left join public.integration_events e on e.id = q.integration_event_id
  left join public.products p on p.id = q.product_id
  where q.status = 'needs_attention'
    and private.is_admin();
$$;

comment on function private.integration_exceptions() is
  'D86: one integration_failed row (danger) per needs_attention job, for admins only (zero rows otherwise): entity_type integration_job, the job id, the event subject or product short ID, the human message (<= 300), days since the job was created. Read only through reporting.operational_exceptions inside the definer RPCs; no API role may execute it. Phase 9 widens its columns with the view''s.';

create or replace view reporting.operational_exceptions
with (security_invoker = true)
as
  select 'overdue_job'::text as kind,
         'warning'::text as severity,
         'work_order'::text as entity_type,
         a.work_order_id as entity_id,
         a.job_number as entity_label,
         pg_catalog.concat_ws(
           ' · ',
           private.customer_label(c.first_name, c.last_name, c.display_name, c.email::text, c.phone),
           b.brand || ' ' || b.model || coalesce(' ' || b.variant, '')
         )::text as subject_label,
         a.age_days as days,
         null::integer as quantity,
         a.checked_in_at as since
  from reporting.work_order_activity a
  join public.customers c on c.id = a.customer_id
  join public.bikes b on b.id = a.bike_id
  where a.is_overdue

  union all

  select 'uncollected_job'::text,
         'warning'::text,
         'work_order'::text,
         a.work_order_id,
         a.job_number,
         pg_catalog.concat_ws(
           ' · ',
           private.customer_label(c.first_name, c.last_name, c.display_name, c.email::text, c.phone),
           b.brand || ' ' || b.model || coalesce(' ' || b.variant, '')
         )::text,
         a.days_awaiting_collection,
         null::integer,
         a.completed_at
  from reporting.work_order_activity a
  join public.customers c on c.id = a.customer_id
  join public.bikes b on b.id = a.bike_id
  where a.status in ('completed', 'ready_for_collection')
    and a.days_awaiting_collection >= 7

  union all

  select 'negative_stock'::text,
         'danger'::text,
         'product'::text,
         p.id,
         p.short_id::text,
         (p.name || ' · ' || loc.name)::text,
         null::integer,
         sl.on_hand,
         sl.last_movement_at
  from reporting.stock_levels sl
  join public.products p on p.id = sl.product_id
  join public.locations loc on loc.id = sl.location_id
  where sl.on_hand < 0

  union all

  select 'unit_hold_stale'::text,
         'danger'::text,
         'inventory_unit'::text,
         u.id,
         u.short_id::text,
         p.name::text,
         (private.shop_today() - private.shop_day(h.since))::integer,
         null::integer,
         h.since
  from public.inventory_units u
  join public.products p on p.id = u.product_id
  cross join lateral (
    select coalesce(
             (select max(e.created_at)
                from public.inventory_unit_events e
               where e.unit_id = u.id and e.event_type = 'status_changed'),
             u.updated_at
           ) as since
  ) h
  where u.status = 'held_for_customer'
    and not exists (
      select 1
      from public.work_order_line_items li
      join public.work_orders wo on wo.id = li.work_order_id
      where li.source_inventory_unit_id = u.id
        and li.voided_at is null
        and li.line_type = 'inventory'
        and private.work_order_status_is_open(wo.status)
    )

  union all

  select 'currency_mismatch'::text,
         'danger'::text,
         'work_order_line'::text,
         l.id,
         wo.job_number::text,
         (l.description_snapshot || ' · ' || l.currency)::text,
         null::integer,
         null::integer,
         wo.completed_at
  from public.work_order_line_items l
  join public.work_orders wo on wo.id = l.work_order_id
  where wo.completed_at is not null
    and l.voided_at is null
    and l.currency::text <> private.shop_currency()

  union all

  -- D86: admins only (zero rows otherwise); Phase 9 widens it with the view.
  select ie.kind, ie.severity, ie.entity_type, ie.entity_id, ie.entity_label, ie.subject_label, ie.days,
         ie.quantity, ie.since
  from private.integration_exceptions() ie;

comment on view reporting.operational_exceptions is
  'Operational exceptions (D34): overdue_job (D20: open and now() - checked_in_at > 7 days; 7 = OVERDUE_AFTER_DAYS in src/lib/workshop.ts), uncollected_job (completed or ready >= 7 shop days), negative_stock, unit_hold_stale (held unit with no live line on an open job), currency_mismatch (would-be-recognised line not in the shop currency), integration_failed (Phase 10: a needs_attention integration job; admins only, D86, from private.integration_exceptions()). Kinds are text; Phase 9 appends kinds and its columns at the end by replacing the view and widening private.integration_exceptions(). No API grants: read through public.operational_exceptions and today_dashboard.';

revoke all on table reporting.operational_exceptions from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function
  private.shopify_raise(text, text),
  private.shopify_decimal(text, text, text),
  private.shopify_count(text, text, text),
  private.shopify_money_text(jsonb, text),
  private.shopify_gid_number(text),
  private.shopify_unmapped_lines(jsonb),
  private.shopify_close_event_job(uuid),
  private.shopify_close_order_siblings(uuid, text, uuid),
  private.shopify_event_failed(uuid, text, text, text, jsonb),
  private.integration_exceptions()
from public, anon, authenticated, service_role;

revoke all on function
  public.process_shopify_order_paid(uuid),
  public.process_shopify_refund(uuid),
  public.process_shopify_event(uuid),
  public.retry_integration_job(uuid),
  public.dismiss_integration_job(uuid, text),
  public.link_shopify_variant(uuid, text, text, text),
  public.link_shopify_customer(uuid, text, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.process_shopify_order_paid(uuid),
  public.process_shopify_refund(uuid),
  public.process_shopify_event(uuid)
to service_role;

grant execute on function
  public.retry_integration_job(uuid),
  public.dismiss_integration_job(uuid, text),
  public.link_shopify_variant(uuid, text, text, text),
  public.link_shopify_customer(uuid, text, text)
to authenticated;
