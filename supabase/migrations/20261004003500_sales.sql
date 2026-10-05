-- In-store sales, restocks and retail refunds (SPEC §2 "Financial
-- snapshots", "Idempotent ... mutations", §10, §12, §13, §23, §25;
-- DATA-MODEL.md §7, §8, §9, §15, §16; PLAN D1, D6/D25 SOLD-AT-COMPLETION,
-- D7, D9, D14, D24 PART-PRICE-COST (amended: only NULL is missing), D26
-- PUBLICATION-MACHINE, D29 BIKE-WITH-CUSTOMER, D44 CONS-JOB-PART, D45
-- CONS-QTY-FIFO, D46 CONS-RESTOCK, D48 SALES-ACCESS, D49 RETAIL-REFUND, D50
-- CONS-STOCK-MOVES, D53 PRICE-OVERRIDE).
--
-- Rules encoded here, for every writer (RPC, seed, SQL editor):
--   * A sale (S-######, D9, from a never-reused sequence) snapshots each
--     line's economics when it is recorded: description, unit sale price,
--     unit direct cost, the Cult Commons rate in force at the sale's
--     recognized_at and, for consigned stock, the consignor payout per unit.
--     The totals are generated columns with exactly the expressions of
--     work_order_line_items (D1: Cult Commons per line, max(yield, 0) x
--     rate). Lines never change afterwards; catalogue edits never reach
--     them. 0 is a known price and a known cost; only NULL is missing (D24).
--   * private.sell_line is THE single sale-line writer: the line, its
--     retail_sale / online_sale movement (linked by sale_line_id) and the
--     unit or consignment state. Phase 10 calls it with 'online_sale'.
--   * A unique unit cannot be sold twice: a unit sale needs an available
--     unit and at most one live (not restocked) sale line exists per unit
--     (sale_lines_unit_sells_once, a partial unique index that replaces
--     DATA-MODEL §8's plain unique: a unit may be sold again only after
--     restock_unit marked its previous line restocked; D46).
--   * A retail sale never takes stock below zero (insufficient_stock).
--   * Consigned stock: a unit line costs its item's agreed amount plus its
--     live shop-borne charges (D4) and owes the consignor the agreed amount;
--     a quantity line draws from exactly one item, the one named or the
--     FIFO head whose remaining quantity covers it (D45), at that item's
--     asking price unless overridden (D53). The consignor liability is
--     derived from live, non-restocked lines (reporting.
--     consignment_item_position), never stored (D46).
--   * restock_unit puts a sold unit back into stock with a reason: a
--     `return` movement linked to the sale line, the line marked restocked,
--     the unit available again. A consigned unit also needs
--     manage_consignments (D46); a unit sold through a job is never
--     restocked (D44); a unit whose bike a customer owns never goes back
--     into stock (D29). The sale and its refunds are untouched (D7).
--   * Refunds are financial facts only (D7, D49): admins record them,
--     capped at the sale total minus earlier refunds; they never move stock
--     or change a unit. Reports net neither refunds nor restocks (D49).
--   * Access (D48): every active staff member may record a sale and read
--     sale headers, lines, quantities, prices and totals and refunds; sale
--     cost, yield, Cult Commons, rate and payout snapshots are not granted
--     (view_costs reads them through the Phase 6 read RPCs). Customers and
--     anonymous users read none of it.
--
-- GLOBAL LOCK ORDER: the consignment migration's header (0 the request's
-- own header insert, 0b consignors, 1 work order, 2 line, 3 stock, 4 bikes,
-- 5 units, 6 consignment items, 7 products). record_retail_sale inserts its
-- header first (0), then 3 -> 5 -> 6 -> 7; restock_unit takes 3 -> 4 -> 5 ->
-- 6 -> 7; record_sale_refund locks only its sale row. No path locks a sale
-- header after a stock lock, unit or item.
--
-- Idempotency: record_retail_sale by sale id (the header insert ... on
-- conflict do nothing; a replay with the same request fingerprint returns
-- the recorded sale with replayed = true, another payload is sale_conflict);
-- restock_unit by sale line (a restocked line is a no-op);
-- record_sale_refund by refund id.
--
-- The request fingerprint of a sale (private.sale_request_fingerprint) is
-- md5 of the canonical JSON
--   {"lines": [ {unit, product, location, quantity, price, item, shopify}
--               ... in the caller's order ],
--    "customer": uuid|null, "recognized_at": "YYYY-MM-DDTHH24:MI:SS.USZ"|null,
--    "notes": trimmed text|null}
-- where ids are cast to uuid (case-insensitive), the quantity to integer
-- and the price to money_amount and back to text, so "1000", 1000 and
-- "1000.00" fingerprint alike; recognized_at is the instant the caller
-- gave, written in UTC (a NULL stays NULL, so a replay that again omits it
-- matches although the sale was stamped with now()).

create type public.sale_source as enum ('retail', 'online_shopify', 'work_order');
create type public.sale_status as enum ('recorded', 'partially_refunded', 'refunded', 'voided');

comment on type public.sale_source is
  'retail (the in-store sale sheet, Phase 6) | online_shopify (Phase 10) | work_order (reserved, never written).';
comment on type public.sale_status is
  'recorded | partially_refunded | refunded (D49, refunds only) | voided (reserved: never written, excluded by every view).';

-- ---------------------------------------------------------------------------
-- sales
-- ---------------------------------------------------------------------------
create table public.sales (
  -- Client-supplied: the sale's idempotency key.
  id uuid primary key,
  -- Always assigned by sales_enforce_rules on insert (D9).
  sale_number text not null default '' unique,
  source public.sale_source not null default 'retail',
  customer_id uuid null references public.customers (id) on delete restrict,
  -- Reserved (no UI): a sale raised from a job.
  work_order_id uuid null references public.work_orders (id) on delete restrict,
  -- Phase 10.
  shopify_order_id text null unique,
  shopify_order_name text null,
  recognized_at timestamptz not null,
  status public.sale_status not null default 'recorded',
  currency char(3) not null,
  notes text null,
  -- The request's fingerprint (idempotency); never shown.
  request_fingerprint text null,
  -- Null only for rows created outside the app.
  created_by uuid null references public.staff (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_sale_number_format check (sale_number ~ '^S-[0-9]{6}$'),
  constraint sales_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint sales_notes_check check (pg_catalog.char_length(notes) <= 2000),
  constraint sales_shopify_order_id_check check (pg_catalog.char_length(shopify_order_id) <= 100),
  constraint sales_shopify_order_name_check check (pg_catalog.char_length(shopify_order_name) <= 100)
);
create index sales_recognized_at_idx on public.sales (recognized_at desc);
create index sales_customer_id_idx on public.sales (customer_id);
create index sales_work_order_id_idx on public.sales (work_order_id);
create index sales_created_by_idx on public.sales (created_by);

comment on table public.sales is
  'Non-workshop revenue (S-######): in-store sales (Phase 6) and Shopify orders (Phase 10). Immutable except status (refunds, D49); never deleted. Recognised at recognized_at (DATA-MODEL §14).';
comment on column public.sales.recognized_at is
  'When the sale is recognised for reporting (D32 covers workshop lines; sales use this instant). Past instants are allowed (backfilling); never more than 5 minutes ahead.';

create trigger sales_set_updated_at
  before update on public.sales
  for each row execute function private.set_updated_at();

-- The number on insert; afterwards only status (and updated_at) change;
-- never deleted.
create function private.sales_enforce_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Server-assigned, whatever the caller sent (D9).
    new.sale_number := private.next_short_id('S');
    new.created_by := coalesce(new.created_by, private.current_staff_id());
    new.notes := nullif(pg_catalog.btrim(new.notes), '');
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception using
      errcode = 'P0001',
      message = 'sale_immutable',
      detail = 'A sale is never deleted; record a refund instead.';
  end if;
  if new.sale_number is distinct from old.sale_number then
    raise exception using
      errcode = 'P0001',
      message = 'sale_number_immutable',
      detail = 'A sale keeps its number for life; it is printed on its receipt.';
  end if;
  if (pg_catalog.to_jsonb(new) - 'status' - 'updated_at') <> (pg_catalog.to_jsonb(old) - 'status' - 'updated_at') then
    raise exception using
      errcode = 'P0001',
      message = 'sale_immutable',
      detail = 'A recorded sale cannot be edited; refunds change its status only.';
  end if;
  return new;
end;
$$;

create trigger sales_enforce_rules
  before insert or update or delete on public.sales
  for each row execute function private.sales_enforce_rules();

-- ---------------------------------------------------------------------------
-- sale_lines
-- ---------------------------------------------------------------------------
create table public.sale_lines (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id) on delete restrict,
  line_number smallint not null,
  product_id uuid not null references public.products (id) on delete restrict,
  inventory_unit_id uuid null references public.inventory_units (id) on delete restrict,
  consignment_item_id uuid null references public.consignment_items (id) on delete restrict,
  description_snapshot text not null,
  quantity public.line_quantity not null,
  unit_sale_price_snapshot public.money_amount not null,
  -- Staff-only (view_costs): no column grant to authenticated (D48).
  unit_direct_cost_snapshot public.money_amount not null,
  -- Per unit, owed to the consignor (consigned stock only). view_costs or
  -- manage_consignments through the read RPCs; never granted (D48).
  consignor_payout_snapshot public.money_amount null,
  cult_commons_rate_snapshot public.rate_fraction not null,
  currency char(3) not null,
  -- Generated (SPEC §10, D1), exactly as work_order_line_items. Postgres
  -- forbids a generated column that references another, so each
  -- expression is written out in full.
  sale_total public.money_amount generated always as (
    round(quantity * unit_sale_price_snapshot, 2)
  ) stored,
  cost_total public.money_amount generated always as (
    round(quantity * unit_direct_cost_snapshot, 2)
  ) stored,
  yield_total public.money_amount generated always as (
    round(quantity * unit_sale_price_snapshot, 2) - round(quantity * unit_direct_cost_snapshot, 2)
  ) stored,
  cult_commons_share public.money_amount generated always as (
    round(
      greatest(
        round(quantity * unit_sale_price_snapshot, 2) - round(quantity * unit_direct_cost_snapshot, 2),
        0
      ) * cult_commons_rate_snapshot,
      2
    )
  ) stored,
  -- Phase 10; written only at insert.
  shopify_line_item_id text null unique,
  -- Set once by restock_unit (D46): the line's unit went back into stock.
  restocked_at timestamptz null,
  restocked_by uuid null references public.staff (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint sale_lines_sale_line_number_key unique (sale_id, line_number),
  constraint sale_lines_line_number_check check (line_number >= 1),
  constraint sale_lines_description_check check (
    pg_catalog.btrim(description_snapshot) <> '' and pg_catalog.char_length(description_snapshot) <= 300
  ),
  constraint sale_lines_quantity_check check (quantity > 0 and quantity = trunc(quantity)),
  constraint sale_lines_unit_sale_price_check check (unit_sale_price_snapshot >= 0),
  constraint sale_lines_unit_direct_cost_check check (unit_direct_cost_snapshot >= 0),
  constraint sale_lines_consignor_payout_check check (consignor_payout_snapshot >= 0),
  constraint sale_lines_rate_check check (
    cult_commons_rate_snapshot >= 0 and cult_commons_rate_snapshot <= 1
  ),
  constraint sale_lines_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint sale_lines_shopify_line_item_id_check check (pg_catalog.char_length(shopify_line_item_id) <= 100),
  constraint sale_lines_unit_quantity_one check (inventory_unit_id is null or quantity = 1),
  constraint sale_lines_consignment_payout check ((consignment_item_id is null) = (consignor_payout_snapshot is null)),
  constraint sale_lines_restock_unit_only check (restocked_at is null or inventory_unit_id is not null),
  constraint sale_lines_restock_shape check (restocked_by is null or restocked_at is not null)
);
-- D46: at most one live (not restocked) sale line per unit. Replaces
-- DATA-MODEL §8's plain unique (a recorded deviation): resale only after
-- restock_unit.
create unique index sale_lines_unit_sells_once
  on public.sale_lines (inventory_unit_id) where inventory_unit_id is not null and restocked_at is null;
create index sale_lines_product_id_idx on public.sale_lines (product_id);
create index sale_lines_inventory_unit_id_idx on public.sale_lines (inventory_unit_id);
create index sale_lines_consignment_item_id_idx on public.sale_lines (consignment_item_id);
create index sale_lines_restocked_by_idx on public.sale_lines (restocked_by);

comment on table public.sale_lines is
  'Sale lines with snapshotted economics and generated totals (SPEC §10, D1). Immutable except restocked_at/restocked_by (once, D46); never deleted. Written only by private.sell_line.';
comment on column public.sale_lines.unit_direct_cost_snapshot is
  'Staff-only (view_costs): no column grant to authenticated; read through the Phase 6 read RPCs (D48).';
comment on column public.sale_lines.consignor_payout_snapshot is
  'Per unit, what the consignor is owed for this line (D46). Consignment money: never granted (D48).';

-- Only restocked_at / restocked_by change, once, from null; nothing is
-- deleted. Generated columns are left out of the comparison (they are not
-- yet computed in a BEFORE trigger and follow the other columns anyway).
create function private.sale_lines_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.description_snapshot := pg_catalog.btrim(new.description_snapshot);
    if new.restocked_at is not null or new.restocked_by is not null then
      raise exception using
        errcode = 'P0001',
        message = 'sale_lines_immutable',
        detail = 'A line is recorded first and restocked afterwards.';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE'
     or old.restocked_at is not null
     or new.restocked_at is null
     or (pg_catalog.to_jsonb(new) - 'restocked_at' - 'restocked_by' - 'sale_total' - 'cost_total'
           - 'yield_total' - 'cult_commons_share')
        <> (pg_catalog.to_jsonb(old) - 'restocked_at' - 'restocked_by' - 'sale_total' - 'cost_total'
           - 'yield_total' - 'cult_commons_share') then
    raise exception using
      errcode = 'P0001',
      message = 'sale_lines_immutable',
      detail = 'A sale line cannot be edited or deleted; its unit can only be restocked once.';
  end if;
  return new;
end;
$$;

create trigger sale_lines_immutable
  before insert or update or delete on public.sale_lines
  for each row execute function private.sale_lines_immutable();

-- ---------------------------------------------------------------------------
-- sale_refunds (append-only, financial only: D7, D49)
-- ---------------------------------------------------------------------------
create table public.sale_refunds (
  -- Client-supplied: the refund's idempotency key.
  id uuid primary key,
  sale_id uuid not null references public.sales (id) on delete restrict,
  -- Phase 10.
  shopify_refund_id text null unique,
  amount public.money_amount not null,
  currency char(3) not null,
  reason text not null,
  -- Phase 6 writes false; Phase 10 records Shopify's flag. Never moves stock.
  restocked boolean not null default false,
  recorded_by uuid null references public.staff (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint sale_refunds_amount_check check (amount > 0),
  constraint sale_refunds_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint sale_refunds_reason_check check (
    pg_catalog.btrim(reason) <> '' and pg_catalog.char_length(reason) <= 500
  ),
  constraint sale_refunds_shopify_refund_id_check check (pg_catalog.char_length(shopify_refund_id) <= 100)
);
create index sale_refunds_sale_id_idx on public.sale_refunds (sale_id, created_at);
create index sale_refunds_recorded_by_idx on public.sale_refunds (recorded_by);

comment on table public.sale_refunds is
  'Refunds of a sale: financial facts only (D7, D49), never a stock movement; capped at the sale total minus earlier refunds. Append-only.';

create function private.sale_refunds_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.reason := pg_catalog.btrim(new.reason);
    return new;
  end if;
  raise exception using
    errcode = 'P0001',
    message = 'sale_refund_immutable',
    detail = 'A refund cannot be changed or deleted.';
end;
$$;

create trigger sale_refund_immutable
  before insert or update or delete on public.sale_refunds
  for each row execute function private.sale_refunds_immutable();

-- ---------------------------------------------------------------------------
-- Phase 4 links: the columns get their foreign keys; a sale line is
-- restocked at most once in the ledger. inventory_movements_sale_line_once
-- (one retail_sale / online_sale movement per line) is unchanged.
-- ---------------------------------------------------------------------------
alter table public.inventory_movements
  add constraint inventory_movements_sale_line_id_fkey
  foreign key (sale_line_id) references public.sale_lines (id) on delete restrict;
create unique index inventory_movements_restock_once
  on public.inventory_movements (sale_line_id) where movement_type = 'return' and sale_line_id is not null;
create index inventory_movements_sale_line_id_idx on public.inventory_movements (sale_line_id);

alter table public.inventory_units
  add constraint inventory_units_sold_sale_line_id_fkey
  foreign key (sold_sale_line_id) references public.sale_lines (id) on delete restrict;

-- ---------------------------------------------------------------------------
-- reporting.consignment_item_position, replaced with the same columns in
-- the same order (D44, D45, D46). Sales on voided sales never count.
--   sold_qty      Σ quantity of the item's sale lines
--   restocked_qty Σ quantity of those that were restocked
--   job_held_qty  live job lines whose job has no completed_at
--   job_sold_qty  live job lines whose job has a completed_at
--   returned_qty  -Σ quantity_delta of the item's consignment_returned movements
--   remaining_qty quantity - (sold_qty - restocked_qty) - job_held_qty
--                 - job_sold_qty - returned_qty
--   owed_qty      (sold_qty - restocked_qty) + job_sold_qty
--   liability     round(Σ quantity x consignor_payout_snapshot over live,
--                 non-restocked sale lines and live job lines of completed
--                 jobs, 2)
--   last_sale_at  the latest recognized_at of those live sale lines' sales
--                 and completed_at of those job lines' jobs
-- ---------------------------------------------------------------------------
create or replace view reporting.consignment_item_position
with (security_invoker = true)
as
  select i.id as consignment_item_id,
         i.consignor_id,
         i.product_id,
         i.inventory_unit_id,
         i.quantity,
         coalesce(s.sold_qty, 0)::integer as sold_qty,
         coalesce(s.restocked_qty, 0)::integer as restocked_qty,
         coalesce(j.held_qty, 0)::integer as job_held_qty,
         coalesce(j.sold_qty, 0)::integer as job_sold_qty,
         coalesce(r.returned_qty, 0)::integer as returned_qty,
         (i.quantity - (coalesce(s.sold_qty, 0) - coalesce(s.restocked_qty, 0)) - coalesce(j.held_qty, 0)
           - coalesce(j.sold_qty, 0) - coalesce(r.returned_qty, 0))::integer as remaining_qty,
         ((coalesce(s.sold_qty, 0) - coalesce(s.restocked_qty, 0)) + coalesce(j.sold_qty, 0))::integer as owed_qty,
         round(coalesce(s.liability, 0) + coalesce(j.liability, 0), 2)::numeric as liability,
         greatest(s.last_sale_at, j.last_sale_at) as last_sale_at,
         r.last_returned_at,
         coalesce(c.consignor_charges, 0.00)::numeric as consignor_charges,
         coalesce(c.shop_charges, 0.00)::numeric as shop_charges
  from public.consignment_items i
  left join lateral (
    select sum(sl.quantity) as sold_qty,
           sum(sl.quantity) filter (where sl.restocked_at is not null) as restocked_qty,
           sum(sl.quantity * sl.consignor_payout_snapshot) filter (where sl.restocked_at is null) as liability,
           max(sa.recognized_at) filter (where sl.restocked_at is null) as last_sale_at
    from public.sale_lines sl
    join public.sales sa on sa.id = sl.sale_id
    where sl.consignment_item_id = i.id and sa.status <> 'voided'
  ) s on true
  left join lateral (
    select sum(li.quantity) filter (where w.completed_at is null) as held_qty,
           sum(li.quantity) filter (where w.completed_at is not null) as sold_qty,
           sum(li.quantity * li.consignor_payout_snapshot) filter (where w.completed_at is not null) as liability,
           max(w.completed_at) filter (where w.completed_at is not null) as last_sale_at
    from public.work_order_line_items li
    join public.work_orders w on w.id = li.work_order_id
    where li.consignment_item_id = i.id and li.voided_at is null
  ) j on true
  left join lateral (
    select -sum(m.quantity_delta) as returned_qty,
           max(m.created_at) as last_returned_at
    from public.inventory_movements m
    where m.consignment_item_id = i.id and m.movement_type = 'consignment_returned'
  ) r on true
  left join lateral (
    select sum(ch.amount) filter (where ch.bearer = 'consignor') as consignor_charges,
           sum(ch.amount) filter (where ch.bearer = 'shop') as shop_charges
    from public.consignment_item_charges ch
    where ch.consignment_item_id = i.id and ch.voided_at is null
  ) c on true;

comment on view reporting.consignment_item_position is
  'Per consignment item: quantities sold (sale lines), restocked, on jobs, returned and remaining, the quantity owed and the consignor liability from live non-restocked sale lines and live lines of completed jobs (D44, D46), and live charges by bearer. The only derivation; nothing is stored; no API grant.';

-- ---------------------------------------------------------------------------
-- Result type (narrow: never a cost).
-- ---------------------------------------------------------------------------
create type public.sale_result as (
  sale_id uuid,
  sale_number text,
  status public.sale_status,
  recognized_at timestamptz,
  replayed boolean
);

-- ---------------------------------------------------------------------------
-- private.sale_request_fingerprint: the canonical request (header comment).
-- The casts raise 22P02 for a malformed id, quantity or price and 23514 for
-- a NaN price (money_amount_not_nan).
-- ---------------------------------------------------------------------------
create function private.sale_request_fingerprint(
  lines jsonb,
  customer_id uuid,
  recognized_at timestamptz,
  notes text
)
returns text
language sql
stable
set search_path = ''
as $$
  select pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'lines', coalesce((
        select pg_catalog.jsonb_agg(
                 pg_catalog.jsonb_build_object(
                   'unit', (e.l ->> 'inventory_unit_id')::uuid,
                   'product', (e.l ->> 'product_id')::uuid,
                   'location', (e.l ->> 'location_id')::uuid,
                   'quantity', (e.l ->> 'quantity')::integer,
                   'price', ((e.l ->> 'unit_sale_price')::public.money_amount)::text,
                   'item', (e.l ->> 'consignment_item_id')::uuid,
                   'shopify', e.l ->> 'shopify_line_item_id'
                 )
                 order by e.ord
               )
        from pg_catalog.jsonb_array_elements(sale_request_fingerprint.lines) with ordinality as e(l, ord)
      ), '[]'::jsonb),
      'customer', sale_request_fingerprint.customer_id,
      'recognized_at', pg_catalog.to_char(
        sale_request_fingerprint.recognized_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ),
      'notes', nullif(pg_catalog.btrim(sale_request_fingerprint.notes), '')
    )::text
  );
$$;

-- ---------------------------------------------------------------------------
-- private.sell_line: THE single sale-line writer (Phase 10 calls it with
-- 'online_sale' and may replace it with the same signature to read more
-- keys). The caller holds every lock (lock order 3, 5, 6) and refreshes the
-- unique products' publication afterwards (7).
--   p_line, a unit:     {"inventory_unit_id": uuid, "unit_sale_price"?: numeric,
--                        "shopify_line_item_id"?: text}
--   p_line, a quantity: {"product_id": uuid, "location_id": uuid, "quantity": int,
--                        "consignment_item_id"?: uuid, "unit_sale_price"?: numeric,
--                        "shopify_line_item_id"?: text}
-- Anything else is sale_line_invalid. Writes the line, its movement (-1 or
-- -quantity, p_movement_type, linked by sale_line_id and the item), the
-- unit's sale (sold at the sale's recognized_at, sold_sale_line_id) and the
-- consignment item's status.
-- ---------------------------------------------------------------------------
create function private.sell_line(
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
       where k not in ('inventory_unit_id', 'unit_sale_price', 'shopify_line_item_id')
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

  elsif product_key is not null and unit_key is null and not exists (
       select 1 from pg_catalog.jsonb_object_keys(sell_line.p_line) k
       where k not in (
         'product_id', 'location_id', 'quantity', 'consignment_item_id', 'unit_sale_price', 'shopify_line_item_id'
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
    -- A retail sale never takes stock below zero (D23 covers job parts only).
    if private.stock_on_hand(prod.id, location_key) < qty then
      raise exception using
        errcode = 'P0001',
        message = 'insufficient_stock',
        detail = 'There is not that much of this item at that location.';
    end if;

    if prod.ownership_type = 'consignment' then
      -- D45: the item named, else the FIFO head whose remaining quantity
      -- covers the line (the caller holds the product's items, lock order 6).
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
        if remaining < qty then
          raise exception using
            errcode = 'P0001',
            message = 'consignment_quantity_unavailable',
            detail = pg_catalog.format('%s has %s left.', item.short_id, remaining);
        end if;
      else
        select i.* into item
        from public.consignment_items i
        join reporting.consignment_item_position pos on pos.consignment_item_id = i.id
        where i.product_id = prod.id and i.status = 'active' and pos.remaining_qty >= qty
        order by i.received_at, i.short_id
        limit 1;
        if not found then
          raise exception using
            errcode = 'P0001',
            message = 'consignment_quantity_unavailable',
            detail = 'No single consignment of this item has that many left; sell fewer, or one consignor''s stock at a time.';
        end if;
      end if;
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
      currency, shopify_line_item_id
    )
    values (
      sell_line.p_sale.id, sell_line.p_line_number, prod.id, unit.id, item.id, pg_catalog.left(description, 300),
      qty, sale_price, direct_cost, payout, private.cult_commons_rate_at(sell_line.p_sale.recognized_at),
      sell_line.p_sale.currency, sell_line.p_line ->> 'shopify_line_item_id'
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

-- ---------------------------------------------------------------------------
-- record_retail_sale (active staff, D48): an in-store sale of units and
-- quantities. Order: (1) shape and the fingerprint; (2) the header insert
-- (lock order 0, the idempotency row): a replay returns the recorded sale;
-- (3) state; (4) locks: the stock of every product, the units, the items;
-- (5) the lines in array order; (6) the unique products' publication, last.
-- ---------------------------------------------------------------------------
create function public.record_retail_sale(
  sale_id uuid,
  lines jsonb,
  customer_id uuid default null,
  recognized_at timestamptz default null,
  notes text default null
)
returns public.sale_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_staff();
  fingerprint text;
  sale public.sales;
  customer_archived timestamptz;
  pid uuid;
  line_index integer := 0;
  element jsonb;
  result public.sale_result;
  err_state text;
  err_constraint text;
  err_table text;
  err_schema text;
  err_column text;
  err_message text;
begin
  -- (1) Shape.
  if record_retail_sale.sale_id is null then
    raise exception 'sale_id is required' using errcode = '22004';
  end if;
  if record_retail_sale.lines is null or pg_catalog.jsonb_typeof(record_retail_sale.lines) <> 'array'
     or pg_catalog.jsonb_array_length(record_retail_sale.lines) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'sale_lines_required',
      detail = 'Add at least one item to the sale.';
  end if;
  if pg_catalog.jsonb_array_length(record_retail_sale.lines) > 50 then
    raise exception using
      errcode = 'P0001',
      message = 'sale_too_many_lines',
      detail = 'A sale holds at most 50 lines; record the rest as another sale.';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(record_retail_sale.lines) e(l)
    where (e.l ->> 'inventory_unit_id') is not null
    group by (e.l ->> 'inventory_unit_id')::uuid
    having count(*) > 1
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'sale_duplicate_unit',
      detail = 'The same unit is on the sale twice.';
  end if;
  if record_retail_sale.customer_id is not null and not exists (
    select 1 from public.customers c where c.id = record_retail_sale.customer_id
  ) then
    raise exception 'customer % not found', record_retail_sale.customer_id using errcode = 'P0002';
  end if;
  if record_retail_sale.recognized_at > pg_catalog.now() + interval '5 minutes' then
    raise exception using
      errcode = 'P0001',
      message = 'sale_recognized_in_future',
      detail = 'A sale cannot be dated in the future.';
  end if;
  fingerprint := private.sale_request_fingerprint(
    record_retail_sale.lines, record_retail_sale.customer_id, record_retail_sale.recognized_at,
    record_retail_sale.notes
  );

  -- (2) Idempotency: the request's own row (lock order 0). A concurrent
  -- replay waits on this insert and then finds the committed sale.
  begin
    insert into public.sales as s (
      id, source, customer_id, recognized_at, currency, notes, request_fingerprint, created_by
    )
    values (
      record_retail_sale.sale_id, 'retail', record_retail_sale.customer_id,
      coalesce(record_retail_sale.recognized_at, pg_catalog.now()), private.shop_currency(),
      record_retail_sale.notes, fingerprint, actor
    )
    on conflict (id) do nothing
    returning s.* into sale;
  exception
    when check_violation or not_null_violation then
      get stacked diagnostics
        err_state = returned_sqlstate, err_constraint = constraint_name, err_table = table_name,
        err_schema = schema_name, err_column = column_name, err_message = message_text;
      perform private.raise_without_row(err_state, err_constraint, err_table, err_schema, err_column, err_message);
  end;
  if sale.id is null then
    select s.* into sale from public.sales s where s.id = record_retail_sale.sale_id;
    if sale.request_fingerprint is not distinct from fingerprint and sale.source = 'retail' then
      result := row(sale.id, sale.sale_number, sale.status, sale.recognized_at, true);
      return result;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'sale_conflict',
      detail = 'That sale id is already used for another sale.';
  end if;

  -- (3) State.
  if record_retail_sale.customer_id is not null then
    select c.archived_at into customer_archived from public.customers c where c.id = record_retail_sale.customer_id;
    if customer_archived is not null then
      raise exception using
        errcode = 'P0001',
        message = 'customer_archived',
        detail = 'That customer is archived; unarchive them or sell to a walk-in.';
    end if;
  end if;

  -- (4) Locks, in the global order. Units' products are read without a
  -- lock (immutable); an unknown unit or product is reported by sell_line.
  for pid in
    select distinct x.product_id
    from (
      select (e.l ->> 'product_id')::uuid as product_id
      from pg_catalog.jsonb_array_elements(record_retail_sale.lines) e(l)
      union
      select u.product_id
      from public.inventory_units u
      where u.id in (
        select (e.l ->> 'inventory_unit_id')::uuid from pg_catalog.jsonb_array_elements(record_retail_sale.lines) e(l)
      )
    ) x
    where x.product_id is not null
    order by 1
  loop
    perform private.lock_stock(pid);
  end loop;

  perform 1
  from public.inventory_units u
  where u.id in (
    select (e.l ->> 'inventory_unit_id')::uuid from pg_catalog.jsonb_array_elements(record_retail_sale.lines) e(l)
  )
  order by u.id
  for update;

  -- Lock order 6: the locked units' items, every active item of each
  -- consigned quantity product on the sale (FIFO reads them) and any item
  -- named.
  perform 1
  from public.consignment_items i
  where i.id in (
      select u.consignment_item_id
      from public.inventory_units u
      where u.id in (
        select (e.l ->> 'inventory_unit_id')::uuid from pg_catalog.jsonb_array_elements(record_retail_sale.lines) e(l)
      )
    )
    or i.id in (
      select (e.l ->> 'consignment_item_id')::uuid from pg_catalog.jsonb_array_elements(record_retail_sale.lines) e(l)
    )
    or (
      i.status = 'active'
      and i.product_id in (
        select (e.l ->> 'product_id')::uuid from pg_catalog.jsonb_array_elements(record_retail_sale.lines) e(l)
      )
    )
  order by i.id
  for update;

  -- (5) The lines, in array order.
  for element in
    select e.l from pg_catalog.jsonb_array_elements(record_retail_sale.lines) with ordinality e(l, ord) order by e.ord
  loop
    line_index := line_index + 1;
    perform private.sell_line(sale, line_index, element, 'retail_sale');
  end loop;

  -- (6) Products last (lock order 7): a public unique product with nothing
  -- left in stock becomes sold (D26).
  for pid in
    select distinct u.product_id
    from public.inventory_units u
    where u.id in (
      select (e.l ->> 'inventory_unit_id')::uuid from pg_catalog.jsonb_array_elements(record_retail_sale.lines) e(l)
    )
    order by 1
  loop
    perform private.refresh_unique_publication(pid);
  end loop;

  result := row(sale.id, sale.sale_number, sale.status, sale.recognized_at, false);
  return result;
end;
$$;

comment on function public.record_retail_sale(uuid, jsonb, uuid, timestamptz, text) is
  'Active staff (D48): record an in-store sale of units and quantities (lines snapshot price, cost, rate and consignor payout; one retail_sale movement each; units sold; consigned items follow, D45/D46); replay-safe by sale id with a request fingerprint; never returns a cost.';

-- ---------------------------------------------------------------------------
-- restock_unit (adjust_stock; a consigned unit also manage_consignments,
-- D46): put a unit sold on `sale_line_id` back into stock with a reason.
-- Deviates from DATA-MODEL's original row restock_unit(unit_id,
-- location_id, reason): it names the sale line, which is also the replay
-- key (a restocked line is a no-op, even if the unit was sold again since).
-- ---------------------------------------------------------------------------
create function public.restock_unit(
  unit_id uuid,
  sale_line_id uuid,
  location_id uuid default null,
  reason text default null
)
returns public.unit_status_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_permission('adjust_stock');
  cleaned text := nullif(pg_catalog.btrim(coalesce(restock_unit.reason, '')), '');
  unit_product uuid;
  unit_bike uuid;
  unit public.inventory_units;
  bike_owner uuid;
  bike_short text;
  line public.sale_lines;
  sale_number text;
  target_location uuid;
  loc_active boolean;
  result public.unit_status_result;
  err_state text;
  err_constraint text;
  err_table text;
  err_schema text;
  err_column text;
  err_message text;
begin
  if restock_unit.unit_id is null or restock_unit.sale_line_id is null then
    raise exception 'unit_id and sale_line_id are required' using errcode = '22004';
  end if;
  if cleaned is null then
    raise exception using
      errcode = 'P0001',
      message = 'reason_required',
      detail = 'Say why the item is going back into stock.';
  end if;
  if pg_catalog.char_length(cleaned) > 500 then
    raise exception using
      errcode = 'P0001',
      message = 'reason_too_long',
      detail = 'Keep the reason under 500 characters.';
  end if;

  -- Locks: the stock (3), the bike (4), the unit (5), the item (6).
  select u.product_id, u.bike_id into unit_product, unit_bike
  from public.inventory_units u where u.id = restock_unit.unit_id;
  if not found then
    raise exception 'unit % not found', restock_unit.unit_id using errcode = 'P0002';
  end if;
  perform private.lock_stock(unit_product);
  if unit_bike is not null then
    select b.customer_id, b.short_id into bike_owner, bike_short
    from public.bikes b where b.id = unit_bike for update;
  end if;
  select u.* into unit from public.inventory_units u where u.id = restock_unit.unit_id for update;
  if unit.consignment_item_id is not null then
    perform 1 from public.consignment_items i where i.id = unit.consignment_item_id for update;
  end if;

  select sl.* into line from public.sale_lines sl where sl.id = restock_unit.sale_line_id;
  if not found then
    raise exception 'sale line % not found', restock_unit.sale_line_id using errcode = 'P0002';
  end if;
  if line.inventory_unit_id is distinct from unit.id then
    raise exception using
      errcode = 'P0001',
      message = 'restock_line_mismatch',
      detail = 'That sale line is for another item.';
  end if;
  -- Replay: the line is already restocked; nothing is written.
  if line.restocked_at is not null then
    result := row(unit.id, unit.status);
    return result;
  end if;
  if unit.consignment_item_id is not null and not private.has_permission('manage_consignments') then
    raise exception 'permission manage_consignments required to restock a consigned item' using errcode = '42501';
  end if;
  if unit.status <> 'sold' then
    raise exception using
      errcode = 'P0001',
      message = 'unit_not_sold',
      detail = pg_catalog.format('%s is not sold, so it cannot be restocked.', unit.short_id);
  end if;
  if unit.sold_sale_line_id is distinct from line.id then
    -- A unit sold through a job is returned by reopen + void (D44).
    raise exception using
      errcode = 'P0001',
      message = 'restock_line_mismatch',
      detail = pg_catalog.format('%s was not sold on that sale line.', unit.short_id);
  end if;
  if bike_owner is not null then
    raise exception using
      errcode = 'P0001',
      message = 'bike_with_customer',
      detail = pg_catalog.format(
        '%s (sold as %s) now belongs to a customer; transfer it back to the shop before restocking.',
        bike_short, unit.short_id
      );
  end if;
  target_location := coalesce(restock_unit.location_id, unit.location_id);
  select l.active into loc_active from public.locations l where l.id = target_location;
  if not found then
    raise exception 'location % not found', target_location using errcode = 'P0002';
  end if;
  if not loc_active then
    raise exception using
      errcode = 'P0001',
      message = 'location_inactive',
      detail = 'That location is inactive; choose another or reactivate it.';
  end if;

  select s.sale_number into sale_number from public.sales s where s.id = line.sale_id;
  perform private.set_change_reason(cleaned);
  perform private.set_event_context(
    pg_catalog.jsonb_build_object(
      'sale_id', line.sale_id, 'sale_number', sale_number, 'sale_line_id', line.id, 'cause', 'restock'
    )
  );
  begin
    update public.sale_lines sl
    set restocked_at = pg_catalog.now(), restocked_by = actor
    where sl.id = line.id;
  exception
    when check_violation or not_null_violation then
      get stacked diagnostics
        err_state = returned_sqlstate, err_constraint = constraint_name, err_table = table_name,
        err_schema = schema_name, err_column = column_name, err_message = message_text;
      perform private.raise_without_row(err_state, err_constraint, err_table, err_schema, err_column, err_message);
  end;
  perform private.record_linked_movement(
    unit.product_id, unit.id, target_location, 1, 'return', cleaned, line.unit_direct_cost_snapshot, null,
    null, null, null, line.id, line.consignment_item_id
  );
  update public.inventory_units u
  set location_id = target_location, sold_sale_line_id = null
  where u.id = unit.id;
  perform private.set_unit_status(unit.id, 'available');
  if unit.consignment_item_id is not null then
    -- sold -> active again, with the reason (D46).
    perform private.refresh_consignment_item_status(unit.consignment_item_id);
  end if;
  perform private.set_event_context(null);
  perform private.set_change_reason(null);

  -- Products last (lock order 7): sold -> public again (D26).
  perform private.refresh_unique_publication(unit.product_id);
  result := row(unit.id, 'available'::public.unit_status);
  return result;
end;
$$;

comment on function public.restock_unit(uuid, uuid, uuid, text) is
  'adjust_stock (a consigned unit also manage_consignments, D46): put a unit sold on that sale line back into stock with a reason (a return movement; the line marked restocked; the unit available; a consigned item active again; the product back from sold). Never for a unit sold through a job (D44) or whose bike a customer owns (D29). Replay-safe by sale line.';

-- ---------------------------------------------------------------------------
-- record_sale_refund (admins only, D49): a financial fact (D7), capped at
-- the sale total minus earlier refunds; never touches stock or units.
-- ---------------------------------------------------------------------------
create function public.record_sale_refund(
  refund_id uuid,
  sale_id uuid,
  amount public.money_amount,
  reason text
)
returns public.sale_refunds
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_staff();
  cleaned text := nullif(pg_catalog.btrim(coalesce(record_sale_refund.reason, '')), '');
  existing public.sale_refunds;
  sale public.sales;
  sale_total numeric;
  refunded numeric;
  inserted public.sale_refunds;
  err_state text;
  err_constraint text;
  err_table text;
  err_schema text;
  err_column text;
  err_message text;
begin
  -- D49: view_financial_reports is a read permission; money going out is
  -- an admin's decision.
  if not private.is_admin() then
    raise exception 'an admin records refunds' using errcode = '42501';
  end if;
  if record_sale_refund.refund_id is null or record_sale_refund.sale_id is null
     or record_sale_refund.amount is null then
    raise exception 'refund_id, sale_id and amount are required' using errcode = '22004';
  end if;

  select r.* into existing from public.sale_refunds r where r.id = record_sale_refund.refund_id;
  if found then
    if existing.sale_id = record_sale_refund.sale_id and existing.amount = record_sale_refund.amount
       and existing.reason is not distinct from cleaned then
      return existing;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'sale_refund_conflict',
      detail = 'That refund id is already used for another refund.';
  end if;
  if cleaned is null then
    raise exception using
      errcode = 'P0001',
      message = 'reason_required',
      detail = 'Say why the sale is being refunded.';
  end if;
  if pg_catalog.char_length(cleaned) > 500 then
    raise exception using
      errcode = 'P0001',
      message = 'reason_too_long',
      detail = 'Keep the reason under 500 characters.';
  end if;

  select s.* into sale from public.sales s where s.id = record_sale_refund.sale_id for update;
  if not found then
    raise exception 'sale % not found', record_sale_refund.sale_id using errcode = 'P0002';
  end if;
  -- A concurrent replay waited on the sale: check again under the lock.
  select r.* into existing from public.sale_refunds r where r.id = record_sale_refund.refund_id;
  if found then
    if existing.sale_id = record_sale_refund.sale_id and existing.amount = record_sale_refund.amount
       and existing.reason is not distinct from cleaned then
      return existing;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'sale_refund_conflict',
      detail = 'That refund id is already used for another refund.';
  end if;
  if sale.status = 'voided' then
    raise exception using
      errcode = 'P0001',
      message = 'sale_voided',
      detail = 'That sale was voided.';
  end if;

  select coalesce(sum(sl.sale_total), 0) into sale_total from public.sale_lines sl where sl.sale_id = sale.id;
  select coalesce(sum(r.amount), 0) into refunded from public.sale_refunds r where r.sale_id = sale.id;
  if record_sale_refund.amount > sale_total - refunded then
    raise exception using
      errcode = 'P0001',
      message = 'refund_exceeds_sale',
      detail = pg_catalog.format(
        'At most %s is left to refund on %s.', pg_catalog.to_char(sale_total - refunded, 'FM999,999,990.00'),
        sale.sale_number
      );
  end if;

  begin
    insert into public.sale_refunds as r (id, sale_id, amount, currency, reason, restocked, recorded_by)
    values (record_sale_refund.refund_id, sale.id, record_sale_refund.amount, sale.currency, cleaned, false, actor)
    returning r.* into inserted;
  exception
    when check_violation or not_null_violation then
      get stacked diagnostics
        err_state = returned_sqlstate, err_constraint = constraint_name, err_table = table_name,
        err_schema = schema_name, err_column = column_name, err_message = message_text;
      perform private.raise_without_row(err_state, err_constraint, err_table, err_schema, err_column, err_message);
  end;

  update public.sales s
  set status = case
        when refunded + record_sale_refund.amount >= sale_total then 'refunded'::public.sale_status
        else 'partially_refunded'::public.sale_status
      end
  where s.id = sale.id;
  return inserted;
end;
$$;

comment on function public.record_sale_refund(uuid, uuid, public.money_amount, text) is
  'Admins (D49): refund part or all of a sale with a reason, capped at the sale total minus earlier refunds; financial only (D7: no movement, no unit change); the sale becomes partially_refunded or refunded; replay-safe by refund id.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function
  private.sales_enforce_rules(),
  private.sale_lines_immutable(),
  private.sale_refunds_immutable(),
  private.sale_request_fingerprint(jsonb, uuid, timestamptz, text),
  private.sell_line(public.sales, integer, jsonb, public.movement_type)
from public, anon, authenticated, service_role;

revoke all on function
  public.record_retail_sale(uuid, jsonb, uuid, timestamptz, text),
  public.restock_unit(uuid, uuid, uuid, text),
  public.record_sale_refund(uuid, uuid, public.money_amount, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.record_retail_sale(uuid, jsonb, uuid, timestamptz, text),
  public.restock_unit(uuid, uuid, uuid, text),
  public.record_sale_refund(uuid, uuid, public.money_amount, text)
to authenticated;

alter table public.sales enable row level security;
alter table public.sale_lines enable row level security;
alter table public.sale_refunds enable row level security;

revoke all on table public.sales from public, anon, authenticated, service_role;
revoke all on table public.sale_lines from public, anon, authenticated, service_role;
revoke all on table public.sale_refunds from public, anon, authenticated, service_role;

-- Every column except the request fingerprint. Written only by the RPCs.
grant select (
  id, sale_number, source, customer_id, work_order_id, shopify_order_id, shopify_order_name, recognized_at,
  status, currency, notes, created_by, created_at, updated_at
) on table public.sales to authenticated;
grant select on table public.sales to service_role;

-- Every column except cost, yield, Cult Commons, rate and payout (D48):
-- view_costs reads them through the read RPCs. A `select *` fails.
grant select (
  id, sale_id, line_number, product_id, inventory_unit_id, consignment_item_id, description_snapshot, quantity,
  unit_sale_price_snapshot, currency, sale_total, shopify_line_item_id, restocked_at, restocked_by, created_at
) on table public.sale_lines to authenticated;
grant select on table public.sale_lines to service_role;

grant select on table public.sale_refunds to authenticated, service_role;

create policy sales_select_staff on public.sales
  for select to authenticated
  using ((select private.is_staff()));

create policy sale_lines_select_staff on public.sale_lines
  for select to authenticated
  using ((select private.is_staff()));

create policy sale_refunds_select_staff on public.sale_refunds
  for select to authenticated
  using ((select private.is_staff()));
