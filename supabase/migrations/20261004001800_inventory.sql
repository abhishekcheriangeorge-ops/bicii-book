-- Inventory: locations, products, unique units, the stock ledger, their
-- history, cost and price views, and the manual stock RPCs (SPEC §2
-- "Inventory ledger", "Stable physical identity", §11, §12, §15, §22, §23,
-- §25; DATA-MODEL.md §6, §7, §11, §15, §16; PLAN D9, D13, D23 NEG-CONSUMPTION,
-- D24 PART-PRICE-COST, D26 PUBLICATION-MACHINE, D27 SHOP-OWNED-ONLY).
--
-- Rules encoded here, for every writer (RPC, seed, SQL editor):
--   * Catalog identity (products, P-######) is separate from physical
--     identity (inventory_units, U-######, one row per unique item). Both
--     short IDs are assigned by the server and never change (D9).
--   * Stock is the sum of inventory_movements. The ledger is append-only for
--     every writer; a mistake is corrected by a linked reversal, never by
--     editing or deleting a row. Movements are inserted only through
--     private.record_movement, called by the RPCs (no API role may insert).
--   * A unique unit is never in two states or two locations: a deferred
--     constraint trigger (inventory_unit_ledger_consistent) checks at commit
--     that its ledger nets to 1 at its own location while it is available or
--     reserved, and to 0 everywhere otherwise.
--   * Costs are staff-only financial data (SPEC §4.2): authenticated has no
--     column grant on products.default_direct_cost,
--     inventory_units.direct_cost or inventory_movements.unit_cost_snapshot;
--     they are read through the definer views product_costs,
--     inventory_unit_costs and inventory_movement_costs (view_costs only).
--     Direct writes of a cost column by a caller without view_costs are
--     refused (42501) by the two invoker cost-write guards.
--   * Publication is explicit (SPEC §15, D26): draft -> internal_only ->
--     public, never public by default; entering public needs a selling
--     price, a public photo and, for a unique product, an available unit.
--   * Photos on stock are internal or public, never customer: stock has no
--     customer (D13 extended, enforced like D19).
--   * A shop bike linked to a unit in stock cannot be given to a customer or
--     archived (bike_in_stock): the public page never shows a bike a
--     customer owns.
--   * Customer access boundary: every table here is staff-only. The
--     anonymous projection is reporting.public_items (Step 2).
--
-- GLOBAL LOCK ORDER (binding for this phase and every later phase that
-- touches stock; DATA-MODEL §7). Every RPC and trigger acquires, in order:
--   1. the work_orders row FOR UPDATE, always through
--      private.lock_work_order (add_inventory_line, void_line;
--      set_work_order_status already holds it when the completion/reopen
--      trigger runs). Never FOR SHARE on a work order before FOR UPDATE in
--      the same transaction (the line trigger's FOR SHARE runs after the RPC
--      already holds FOR UPDATE, which is harmless);
--   2. the work_order_line_items row FOR UPDATE;
--   3. private.lock_stock(product_id); several products in ascending
--      product_id order;
--   4. the bikes row FOR UPDATE (only create_unique_unit, before
--      private.register_unit links the bike);
--   5. the inventory_units row FOR UPDATE; several units in ascending id;
--   6. the products row FOR UPDATE, taken only by
--      private.refresh_unique_publication (and Step 2's
--      set_publication_status).
-- Every RPC takes its locks before its replay check and before any other
-- read. Functions that lock and then read stay VOLATILE, so each later
-- statement takes a fresh READ COMMITTED snapshot.
--
-- Extension points for later phases (private, no grants):
--   private.record_movement      the single insert path into the ledger
--   private.register_unit        the single unit-creation path (Phase 6
--                                creates consigned units through it)
--   private.selling_price        the single selling-price source (Phase 6
--                                replaces it for consignment asking prices)
--   private.lock_stock           the per-product stock lock
--   private.refresh_unique_publication  sold <-> public for unique products
--   private.stock_on_hand        ledger on-hand at one location

create type public.tracking_type as enum ('quantity', 'unique');
create type public.ownership_type as enum ('shop_owned', 'consignment', 'customer_owned');
create type public.publication_status as enum ('draft', 'internal_only', 'public', 'sold', 'archived');
create type public.unit_status as enum (
  'available',
  'reserved',
  'sold',
  'returned_to_consignor',
  'written_off',
  'held_for_customer'
);
create type public.location_kind as enum ('shop_floor', 'workshop', 'storage', 'offsite');
create type public.movement_type as enum (
  'purchase_received',
  'job_consumption',
  'retail_sale',
  'online_sale',
  'stock_adjustment',
  'damaged',
  'return',
  'consignment_received',
  'consignment_returned',
  'transfer',
  'reversal'
);
create type public.product_event_type as enum (
  'created',
  'details_changed',
  'price_changed',
  'cost_changed',
  'publication_changed',
  'archived',
  'unarchived'
);
create type public.inventory_unit_event_type as enum (
  'created',
  'status_changed',
  'moved',
  'details_changed',
  'price_changed',
  'cost_changed',
  'archived',
  'unarchived'
);

-- ---------------------------------------------------------------------------
-- State machines (immutable; mirrored in src/lib/inventory.ts, compared pair
-- by pair in tests/db/inventory-catalog.test.ts). Same-state pairs are
-- false: callers treat them as replays before asking.
-- ---------------------------------------------------------------------------

-- D26 PUBLICATION-MACHINE. 'sold' is entered only by sale paths and only for
-- unique products (the products trigger checks the tracking type); sold ->
-- public is the system restore of private.refresh_unique_publication.
create function private.publication_transition_allowed(
  from_status public.publication_status,
  to_status public.publication_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when from_status is null or to_status is null or from_status = to_status then false
    when from_status = 'draft' then to_status in ('internal_only', 'archived')
    when from_status = 'internal_only' then to_status in ('public', 'archived')
    when from_status = 'public' then to_status in ('internal_only', 'sold', 'archived')
    when from_status = 'sold' then to_status in ('public', 'archived')
    when from_status = 'archived' then to_status = 'internal_only'
    else false
  end;
$$;

-- Unit status matrix. sold -> held_for_customer happens only when a job is
-- reopened (D25 SOLD-AT-COMPLETION); status has no client grant, so only
-- definer paths reach any of these.
create function private.unit_status_transition_allowed(
  from_status public.unit_status,
  to_status public.unit_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when from_status is null or to_status is null or from_status = to_status then false
    when from_status = 'available' then
      to_status in ('reserved', 'held_for_customer', 'sold', 'returned_to_consignor', 'written_off')
    when from_status = 'reserved' then to_status in ('available', 'held_for_customer', 'sold')
    when from_status = 'held_for_customer' then to_status in ('available', 'sold')
    when from_status = 'sold' then to_status in ('available', 'held_for_customer')
    when from_status = 'written_off' then to_status = 'available'
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
-- Event context: extra keys for unit history ({work_order_id, job_number,
-- line_id} or {..., cause}). Transaction-local; RPCs and triggers set it
-- around a write and clear it straight after (like private.set_change_reason).
-- ---------------------------------------------------------------------------
create function private.set_event_context(context jsonb)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_catalog.set_config('app.event_context', coalesce(context::text, ''), true);
$$;

create function private.event_context()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(pg_catalog.current_setting('app.event_context', true), '')::jsonb, '{}'::jsonb);
$$;

-- ---------------------------------------------------------------------------
-- locations
-- ---------------------------------------------------------------------------
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind public.location_kind not null default 'shop_floor',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint locations_name_key unique (name),
  constraint locations_name_check check (
    pg_catalog.btrim(name) <> '' and pg_catalog.char_length(name) <= 80
  )
);

comment on table public.locations is
  'Where stock is. The default location is the active one with the lowest (sort_order, name); there is no flag.';

create trigger locations_set_updated_at
  before update on public.locations
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
create table public.products (
  -- Client-supplied by the app's form id (the create's idempotency key).
  id uuid primary key default gen_random_uuid(),
  -- Always assigned by products_enforce_rules on insert.
  short_id text not null default '' unique,
  sku text null,
  -- SKUs collide regardless of case and punctuation.
  sku_key text generated always as (
    nullif(upper(regexp_replace(coalesce(sku, ''), '[^A-Za-z0-9]', '', 'g')), '')
  ) stored,
  name text not null,
  description text null,
  brand text null,
  category_id uuid null references public.categories (id) on delete restrict,
  tracking_type public.tracking_type not null,
  -- Phase 6 sets consignment; not client-writable.
  ownership_type public.ownership_type not null default 'shop_owned',
  publication_status public.publication_status not null default 'draft',
  -- Assigned at the first publish; never changes afterwards.
  public_slug text null,
  default_sale_price public.money_amount null,
  -- Staff-only financial data: no column grant to authenticated; read it
  -- through product_costs (view_costs).
  default_direct_cost public.money_amount null,
  currency char(3) not null default 'SGD',
  reorder_point integer null,
  -- Phase 10; not client-writable.
  shopify_product_id text null,
  shopify_variant_id text null,
  active boolean not null default true,
  search_text text generated always as (
    lower(name || ' ' || coalesce(brand, '') || ' ' || coalesce(sku, ''))
  ) stored,
  -- Null only for rows created outside the app.
  created_by uuid null references public.staff (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  constraint products_public_slug_key unique (public_slug),
  constraint products_shopify_product_id_key unique (shopify_product_id),
  constraint products_shopify_variant_id_key unique (shopify_variant_id),
  constraint products_short_id_format check (short_id ~ '^P-[0-9]{6}$'),
  constraint products_sku_check check (pg_catalog.char_length(sku) <= 64),
  constraint products_name_check check (
    pg_catalog.btrim(name) <> '' and pg_catalog.char_length(name) <= 200
  ),
  constraint products_description_check check (pg_catalog.char_length(description) <= 5000),
  constraint products_brand_check check (pg_catalog.char_length(brand) <= 100),
  constraint products_public_slug_format check (public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint products_default_sale_price_check check (default_sale_price >= 0),
  constraint products_default_direct_cost_check check (default_direct_cost >= 0),
  constraint products_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint products_reorder_point_check check (reorder_point >= 0)
);
create unique index products_sku_key_unique on public.products (sku_key);
create index products_sku_key_trgm_idx on public.products using gin (sku_key extensions.gin_trgm_ops);
create index products_category_id_idx on public.products (category_id);
create index products_search_text_trgm_idx on public.products using gin (search_text extensions.gin_trgm_ops);
create index products_created_by_idx on public.products (created_by);

comment on table public.products is
  'Catalog identity (P-######). Quantity products are counted in the ledger; unique products have one inventory_units row per item.';
comment on column public.products.short_id is 'P-######, server-assigned from private.next_short_id(''P''); immutable; encoded in its QR.';
comment on column public.products.default_direct_cost is
  'Staff-only (view_costs): not granted to authenticated; read through product_costs.';
comment on column public.products.public_slug is 'Assigned at the first publish (name slug + short id); never changes.';
comment on column public.products.sku_key is 'Generated: the SKU upper-cased without punctuation; unique.';

create trigger products_set_updated_at
  before update on public.products
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- inventory_units (one row per physical unique item)
-- ---------------------------------------------------------------------------
create table public.inventory_units (
  id uuid primary key default gen_random_uuid(),
  -- Always assigned by inventory_units_enforce_rules on insert.
  short_id text not null default '' unique,
  product_id uuid not null references public.products (id) on delete restrict,
  location_id uuid not null references public.locations (id) on delete restrict,
  serial_number text null,
  serial_key text generated always as (
    nullif(upper(regexp_replace(coalesce(serial_number, ''), '[^A-Za-z0-9]', '', 'g')), '')
  ) stored,
  -- PUBLIC once the product is published (shown on the public page).
  condition text null,
  ownership_type public.ownership_type not null default 'shop_owned',
  -- Phase 6 adds the foreign key to consignment_items.
  consignment_item_id uuid null,
  -- When the unit is a complete bike; bikes.inventory_unit_id points back.
  bike_id uuid null references public.bikes (id) on delete restrict,
  status public.unit_status not null default 'available',
  -- Overrides the product's default sale price.
  sale_price public.money_amount null,
  -- Staff-only (view_costs): purchase cost or consignor payout.
  direct_cost public.money_amount null,
  -- Phase 6 adds the foreign key to sale_lines.
  sold_sale_line_id uuid null unique,
  sold_at timestamptz null,
  -- Staff only; never public.
  internal_notes text null,
  created_by uuid null references public.staff (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  constraint inventory_units_bike_id_key unique (bike_id),
  constraint inventory_units_short_id_format check (short_id ~ '^U-[0-9]{6}$'),
  constraint inventory_units_serial_number_check check (pg_catalog.char_length(serial_number) <= 100),
  constraint inventory_units_condition_check check (pg_catalog.char_length(condition) <= 500),
  constraint inventory_units_internal_notes_check check (pg_catalog.char_length(internal_notes) <= 10000),
  constraint inventory_units_sale_price_check check (sale_price >= 0),
  constraint inventory_units_direct_cost_check check (direct_cost >= 0),
  constraint inventory_units_consignment_shape check (
    ownership_type <> 'consignment' or consignment_item_id is not null
  ),
  constraint inventory_units_sold_shape check ((status = 'sold') = (sold_at is not null))
);
create index inventory_units_product_id_idx on public.inventory_units (product_id);
create index inventory_units_location_id_idx on public.inventory_units (location_id);
create index inventory_units_status_idx on public.inventory_units (status);
create index inventory_units_serial_key_idx on public.inventory_units (serial_key);
create index inventory_units_serial_key_trgm_idx on public.inventory_units using gin (serial_key extensions.gin_trgm_ops);
create index inventory_units_created_by_idx on public.inventory_units (created_by);

comment on table public.inventory_units is
  'One row per physical unique item (U-######). Created only through RPCs; status, location, bike and ownership change only through RPCs and triggers.';
comment on column public.inventory_units.condition is 'PUBLIC once the product is published: shown on the public page.';
comment on column public.inventory_units.direct_cost is
  'Staff-only (view_costs): not granted to authenticated; read through inventory_unit_costs.';
comment on column public.inventory_units.internal_notes is 'Staff only; never public.';

create trigger inventory_units_set_updated_at
  before update on public.inventory_units
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- bikes: the Phase 1 column gets its foreign key.
-- ---------------------------------------------------------------------------
alter table public.bikes
  add constraint bikes_inventory_unit_id_fkey
  foreign key (inventory_unit_id) references public.inventory_units (id) on delete restrict;
create unique index bikes_inventory_unit_id_key on public.bikes (inventory_unit_id);

comment on column public.bikes.inventory_unit_id is
  'The unit this shop bike is in stock as (set by private.register_unit; no client grant).';

-- ---------------------------------------------------------------------------
-- inventory_movements (append-only ledger)
-- ---------------------------------------------------------------------------
create table public.inventory_movements (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products (id) on delete restrict,
  inventory_unit_id uuid null references public.inventory_units (id) on delete restrict,
  location_id uuid not null references public.locations (id) on delete restrict,
  quantity_delta integer not null,
  movement_type public.movement_type not null,
  work_order_id uuid null references public.work_orders (id) on delete restrict,
  work_order_line_item_id uuid null references public.work_order_line_items (id) on delete restrict,
  -- Phase 6 adds the foreign key to sale_lines.
  sale_line_id uuid null,
  -- Phase 7 adds the foreign key to purchase_receipt_lines.
  purchase_receipt_line_id uuid null,
  -- Phase 6 adds the foreign key to consignment_items.
  consignment_item_id uuid null,
  -- The calling RPC's per-call idempotency key; a transfer's two rows share
  -- it (replaces DATA-MODEL's transfer_group_id).
  request_id uuid null,
  reversal_of_id bigint null references public.inventory_movements (id) on delete restrict,
  -- Staff-only (view_costs): read through inventory_movement_costs.
  unit_cost_snapshot public.money_amount null,
  currency char(3) not null default 'SGD',
  reason text null,
  -- Null only for rows created outside the app.
  created_by uuid null references public.staff (id) on delete restrict,
  correlation_id text null,
  created_at timestamptz not null default clock_timestamp(),
  constraint inventory_movements_reversal_of_id_key unique (reversal_of_id),
  constraint inventory_movements_quantity_delta_check check (
    quantity_delta <> 0 and abs(quantity_delta) <= 100000
  ),
  constraint inventory_movements_unit_delta check (inventory_unit_id is null or abs(quantity_delta) = 1),
  constraint inventory_movements_reason_required check (
    movement_type not in ('stock_adjustment', 'damaged') or reason is not null
  ),
  constraint inventory_movements_reason_check check (
    reason is null or (pg_catalog.btrim(reason) <> '' and pg_catalog.char_length(reason) <= 500)
  ),
  constraint inventory_movements_reversal_shape check (
    (movement_type = 'reversal') = (reversal_of_id is not null)
  ),
  constraint inventory_movements_job_consumption_shape check (
    movement_type <> 'job_consumption'
    or (work_order_line_item_id is not null and work_order_id is not null and quantity_delta < 0)
  ),
  constraint inventory_movements_damaged_negative check (movement_type <> 'damaged' or quantity_delta < 0),
  constraint inventory_movements_transfer_request check (movement_type <> 'transfer' or request_id is not null),
  constraint inventory_movements_unit_cost_snapshot_check check (unit_cost_snapshot >= 0),
  constraint inventory_movements_currency_check check (currency ~ '^[A-Z]{3}$')
);

-- The idempotency guarantees. Phases 6, 7 and 10 rely on these exact
-- predicates; do not change them.
create unique index inventory_movements_job_consumption_once
  on public.inventory_movements (work_order_line_item_id) where movement_type = 'job_consumption';
create unique index inventory_movements_sale_line_once
  on public.inventory_movements (sale_line_id) where movement_type in ('retail_sale', 'online_sale');
create unique index inventory_movements_receipt_line_once
  on public.inventory_movements (purchase_receipt_line_id) where movement_type = 'purchase_received';
create unique index inventory_movements_request_once
  on public.inventory_movements (request_id, product_id, location_id) where request_id is not null;

create index inventory_movements_product_location_idx on public.inventory_movements (product_id, location_id, id);
create index inventory_movements_unit_idx on public.inventory_movements (inventory_unit_id, id);
create index inventory_movements_work_order_idx on public.inventory_movements (work_order_id);
create index inventory_movements_line_idx on public.inventory_movements (work_order_line_item_id);
create index inventory_movements_created_by_idx on public.inventory_movements (created_by);
create index inventory_movements_id_desc_idx on public.inventory_movements (id desc);

comment on table public.inventory_movements is
  'The stock ledger (SPEC §12): append-only; on-hand is the sum of quantity_delta. Inserted only through private.record_movement.';
comment on column public.inventory_movements.request_id is
  'The calling RPC''s per-call idempotency key (a transfer''s two rows share it).';
comment on column public.inventory_movements.unit_cost_snapshot is
  'Staff-only (view_costs): not granted to authenticated; read through inventory_movement_costs.';

-- ---------------------------------------------------------------------------
-- History (append-only, written by triggers)
-- ---------------------------------------------------------------------------
create table public.product_events (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  event_type public.product_event_type not null,
  -- Null when the change was made outside the app.
  actor_staff_id uuid null references public.staff (id) on delete restrict,
  -- Never a cost.
  payload jsonb not null default '{}'::jsonb,
  reason text null,
  correlation_id text null,
  created_at timestamptz not null default clock_timestamp(),
  constraint product_events_payload_object check (pg_catalog.jsonb_typeof(payload) = 'object')
);
create index product_events_product_idx on public.product_events (product_id, created_at desc);
create index product_events_actor_staff_id_idx on public.product_events (actor_staff_id);

comment on table public.product_events is
  'Append-only product history, written by triggers. Payloads never carry costs.';

create table public.inventory_unit_events (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.inventory_units (id) on delete restrict,
  event_type public.inventory_unit_event_type not null,
  actor_staff_id uuid null references public.staff (id) on delete restrict,
  payload jsonb not null default '{}'::jsonb,
  reason text null,
  correlation_id text null,
  created_at timestamptz not null default clock_timestamp(),
  constraint inventory_unit_events_payload_object check (pg_catalog.jsonb_typeof(payload) = 'object')
);
create index inventory_unit_events_unit_idx on public.inventory_unit_events (unit_id, created_at desc);
create index inventory_unit_events_actor_staff_id_idx on public.inventory_unit_events (actor_staff_id);

comment on table public.inventory_unit_events is
  'Append-only unit history, written by triggers. Payloads never carry costs.';

create function private.product_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'product_events_append_only',
    detail = 'Product history cannot be changed or deleted.';
end;
$$;

create trigger product_events_append_only
  before update or delete on public.product_events
  for each row execute function private.product_events_append_only();

create function private.inventory_unit_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'inventory_unit_events_append_only',
    detail = 'Unit history cannot be changed or deleted.';
end;
$$;

create trigger inventory_unit_events_append_only
  before update or delete on public.inventory_unit_events
  for each row execute function private.inventory_unit_events_append_only();

create function private.inventory_movements_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'movement_append_only',
    detail = 'The stock ledger cannot be changed or deleted; record a reversal instead.';
end;
$$;

create trigger inventory_movements_append_only
  before update or delete on public.inventory_movements
  for each row execute function private.inventory_movements_append_only();

-- ---------------------------------------------------------------------------
-- Private helpers (extension points; see the header).
-- ---------------------------------------------------------------------------

-- The per-product stock lock (lock order step 3). Every stock-changing RPC
-- calls it before it reads on-hand, units or replay rows.
create function private.lock_stock(product_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bicii.stock:' || lock_stock.product_id::text, 0)
  );
end;
$$;

-- Ledger on-hand of one product at one location.
create function private.stock_on_hand(product_id uuid, location_id uuid)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  select coalesce(sum(m.quantity_delta), 0)::integer
  from public.inventory_movements m
  where m.product_id = stock_on_hand.product_id and m.location_id = stock_on_hand.location_id;
$$;

-- THE single selling-price source: the unit's own price, else the product's
-- default (the product default alone when inventory_unit_id is null).
-- public.selling_prices, the publication price requirement,
-- add_inventory_line's default and Step 2's reporting.public_items call it.
-- Cross-phase contract: Phase 6 replaces it (create or replace) to return a
-- consignment item's asking price; Phase 8's labels and Phase 10's Shopify
-- price use it unchanged, so label, public page, Shopify and sale agree.
create function private.selling_price(product_id uuid, inventory_unit_id uuid)
returns public.money_amount
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when selling_price.inventory_unit_id is null then
      (select p.default_sale_price from public.products p where p.id = selling_price.product_id)
    else
      (select coalesce(u.sale_price, p.default_sale_price)
         from public.inventory_units u
         join public.products p on p.id = u.product_id
        where u.id = selling_price.inventory_unit_id and u.product_id = selling_price.product_id)
  end;
$$;

-- THE single insert path into the ledger. Currency from the product. Refuses
-- an inactive location unless the movement is a reversal (a void must never
-- be blocked by a location deactivated since). A check violation is
-- re-raised without its row (unit_cost_snapshot is a hidden column).
create function private.record_movement(
  product_id uuid,
  inventory_unit_id uuid,
  location_id uuid,
  quantity_delta integer,
  movement_type public.movement_type,
  reason text,
  unit_cost_snapshot public.money_amount,
  request_id uuid,
  work_order_id uuid,
  work_order_line_item_id uuid,
  reversal_of_id bigint
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
  select p.currency into product_currency from public.products p where p.id = record_movement.product_id;
  if not found then
    raise exception 'product % not found', record_movement.product_id using errcode = 'P0002';
  end if;
  select l.active into location_active from public.locations l where l.id = record_movement.location_id;
  if not found then
    raise exception 'location % not found', record_movement.location_id using errcode = 'P0002';
  end if;
  if not location_active and record_movement.movement_type <> 'reversal' then
    raise exception using
      errcode = 'P0001',
      message = 'location_inactive',
      detail = 'That location is inactive; choose another or reactivate it.';
  end if;

  begin
    insert into public.inventory_movements as m (
      product_id, inventory_unit_id, location_id, quantity_delta, movement_type, reason,
      unit_cost_snapshot, request_id, work_order_id, work_order_line_item_id, reversal_of_id, currency
    )
    values (
      record_movement.product_id, record_movement.inventory_unit_id, record_movement.location_id,
      record_movement.quantity_delta, record_movement.movement_type,
      nullif(pg_catalog.btrim(record_movement.reason), ''),
      record_movement.unit_cost_snapshot, record_movement.request_id, record_movement.work_order_id,
      record_movement.work_order_line_item_id, record_movement.reversal_of_id, product_currency
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

-- THE single unit-creation path: the insert plus the bike link. Accepts
-- ownership 'consignment' with a consignment_item_id for Phase 6's
-- create_consignment_item; Phase 4 creates shop-owned units only (D27).
-- The caller has taken private.lock_stock(product_id) and, with a bike, the
-- bike FOR UPDATE (lock order 3, 4); the caller writes the +1 movement.
create function private.register_unit(
  unit_id uuid,
  product_id uuid,
  location_id uuid,
  ownership_type public.ownership_type,
  serial_number text,
  condition text,
  sale_price public.money_amount,
  direct_cost public.money_amount,
  bike_id uuid,
  consignment_item_id uuid
)
returns public.inventory_units
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result public.inventory_units;
  err_state text;
  err_constraint text;
  err_table text;
  err_schema text;
  err_column text;
  err_message text;
begin
  begin
    insert into public.inventory_units as u (
      id, product_id, location_id, ownership_type, serial_number, condition, sale_price, direct_cost,
      bike_id, consignment_item_id
    )
    values (
      register_unit.unit_id, register_unit.product_id, register_unit.location_id, register_unit.ownership_type,
      register_unit.serial_number, register_unit.condition, register_unit.sale_price, register_unit.direct_cost,
      register_unit.bike_id, register_unit.consignment_item_id
    )
    returning u.* into result;
  exception
    when check_violation or not_null_violation then
      get stacked diagnostics
        err_state = returned_sqlstate, err_constraint = constraint_name, err_table = table_name,
        err_schema = schema_name, err_column = column_name, err_message = message_text;
      perform private.raise_without_row(err_state, err_constraint, err_table, err_schema, err_column, err_message);
  end;
  if register_unit.bike_id is not null then
    update public.bikes b set inventory_unit_id = result.id where b.id = register_unit.bike_id;
  end if;
  return result;
end;
$$;

-- Changes a unit's status (and sold_at) through the unit trigger, re-raising
-- a check violation without the row (direct_cost is a hidden column). The
-- caller holds the unit FOR UPDATE and has set the event context.
create function private.set_unit_status(
  unit_id uuid,
  status public.unit_status,
  sold_at timestamptz default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  err_state text;
  err_constraint text;
  err_table text;
  err_schema text;
  err_column text;
  err_message text;
begin
  begin
    update public.inventory_units u
    set status = set_unit_status.status,
        sold_at = case
          when set_unit_status.status = 'sold'
            then coalesce(set_unit_status.sold_at, pg_catalog.clock_timestamp())
        end
    where u.id = set_unit_status.unit_id;
  exception
    when check_violation or not_null_violation then
      get stacked diagnostics
        err_state = returned_sqlstate, err_constraint = constraint_name, err_table = table_name,
        err_schema = schema_name, err_column = column_name, err_message = message_text;
      perform private.raise_without_row(err_state, err_constraint, err_table, err_schema, err_column, err_message);
  end;
end;
$$;

-- The first missing requirement for entering 'public' (D26), or null:
-- publication_requires_available_unit (a unique product with no available
-- unit), publication_requires_price (no selling price: the product's for a
-- quantity product, any available unit's for a unique one) or
-- publication_requires_photo (no public photo on the product, any of its
-- units or a unit's bike). Reads the stored rows: set the price or add the
-- photo first, then publish.
create function private.publication_requirements_met(product_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p public.products;
begin
  select pr.* into p from public.products pr where pr.id = publication_requirements_met.product_id;
  if not found then
    raise exception 'product % not found', publication_requirements_met.product_id using errcode = 'P0002';
  end if;

  if p.tracking_type = 'quantity' then
    if private.selling_price(p.id, null) is null then
      return 'publication_requires_price';
    end if;
  else
    if not exists (
      select 1 from public.inventory_units u
      where u.product_id = p.id and u.status = 'available' and u.archived_at is null
    ) then
      return 'publication_requires_available_unit';
    end if;
    if exists (
      select 1 from public.inventory_units u
      where u.product_id = p.id and u.status = 'available' and u.archived_at is null
        and private.selling_price(p.id, u.id) is null
    ) then
      return 'publication_requires_price';
    end if;
  end if;

  if not exists (
    select 1 from public.attachments a
    where a.visibility = 'public'
      and (
        (a.entity_type = 'product' and a.entity_id = p.id)
        or (a.entity_type = 'inventory_unit'
            and a.entity_id in (select u.id from public.inventory_units u where u.product_id = p.id))
        or (a.entity_type = 'bike'
            and a.entity_id in (
              select u.bike_id from public.inventory_units u
              where u.product_id = p.id and u.bike_id is not null
            ))
      )
  ) then
    return 'publication_requires_photo';
  end if;
  return null;
end;
$$;

-- For a unique product: 'public' becomes 'sold' when no unit is available,
-- reserved or held_for_customer and at least one is sold; 'sold' becomes
-- 'public' again when a unit is available (the system restore, which skips
-- the publication requirements). Anything else is left alone; in particular
-- 'sold' stays 'sold' while the only units are held_for_customer (a reopened
-- job, D25). Callers change unit status BEFORE calling it. Statement 1 locks
-- the product (lock order step 6); statement 2, with a fresh READ COMMITTED
-- snapshot, counts the units. Writes through the products trigger, which
-- records publication_changed.
create function private.refresh_unique_publication(product_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p_tracking public.tracking_type;
  p_status public.publication_status;
  in_stock integer;
  available integer;
  sold integer;
  target public.publication_status;
  err_state text;
  err_constraint text;
  err_table text;
  err_schema text;
  err_column text;
  err_message text;
begin
  perform 1 from public.products p where p.id = refresh_unique_publication.product_id for update;

  select p.tracking_type, p.publication_status into p_tracking, p_status
  from public.products p where p.id = refresh_unique_publication.product_id;
  if not found or p_tracking <> 'unique' or p_status not in ('public', 'sold') then
    return;
  end if;

  select count(*) filter (where u.status in ('available', 'reserved', 'held_for_customer'))::integer,
         count(*) filter (where u.status = 'available')::integer,
         count(*) filter (where u.status = 'sold')::integer
    into in_stock, available, sold
  from public.inventory_units u
  where u.product_id = refresh_unique_publication.product_id;

  if p_status = 'public' and in_stock = 0 and sold > 0 then
    target := 'sold';
  elsif p_status = 'sold' and available > 0 then
    target := 'public';
  else
    return;
  end if;

  begin
    update public.products p
    set publication_status = target
    where p.id = refresh_unique_publication.product_id;
  exception
    when check_violation or not_null_violation then
      get stacked diagnostics
        err_state = returned_sqlstate, err_constraint = constraint_name, err_table = table_name,
        err_schema = schema_name, err_column = column_name, err_message = message_text;
      perform private.raise_without_row(err_state, err_constraint, err_table, err_schema, err_column, err_message);
  end;
end;
$$;

-- The database proof that a unique unit is never in two states or two
-- locations (SPEC §12, §23): while available or reserved its ledger nets to
-- 1 at its own location and 0 elsewhere; in every other status it nets to 0
-- at every location (held_for_customer <-> sold needs no movement). A linked
-- bike points back at the unit.
create function private.assert_unit_consistent(unit_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  unit public.inventory_units;
  expected integer;
begin
  select u.* into unit from public.inventory_units u where u.id = assert_unit_consistent.unit_id;
  if not found then
    return;
  end if;
  expected := case when unit.status in ('available', 'reserved') then 1 else 0 end;

  if exists (
       select 1
       from (
         select m.location_id, sum(m.quantity_delta) as net
         from public.inventory_movements m
         where m.inventory_unit_id = unit.id
         group by m.location_id
       ) s
       where s.net <> case when expected = 1 and s.location_id = unit.location_id then 1 else 0 end
     )
     or (
       expected = 1
       and coalesce((
         select sum(m.quantity_delta) from public.inventory_movements m
         where m.inventory_unit_id = unit.id and m.location_id = unit.location_id
       ), 0) <> 1
     )
     or (
       unit.bike_id is not null
       and not exists (
         select 1 from public.bikes b where b.id = unit.bike_id and b.inventory_unit_id = unit.id
       )
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'unit_ledger_inconsistent',
      detail = pg_catalog.format(
        'Unit %s does not match its stock ledger (status %s); record the missing movement.',
        unit.short_id, unit.status
      );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- locations: rules
-- ---------------------------------------------------------------------------
create function private.locations_enforce_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.name := pg_catalog.btrim(new.name);
  if tg_op = 'UPDATE' and old.active and not new.active and exists (
    select 1 from public.inventory_movements m
    where m.location_id = new.id
    group by m.product_id
    having sum(m.quantity_delta) <> 0
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'location_has_stock',
      detail = 'That location still holds stock; move or adjust it to zero first.';
  end if;
  return new;
end;
$$;

create trigger locations_enforce_rules
  before insert or update on public.locations
  for each row execute function private.locations_enforce_rules();

-- The one-shop bootstrap (SPEC §11: the MVP starts with one shop). In the
-- migration, not the seed, so a hosted database has a location to stock.
insert into public.locations (id, name, kind, sort_order)
values ('1c000000-0000-4000-8000-000000000001', 'Shop floor', 'shop_floor', 10)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- products: rules every writer obeys, the cost-write guard and history
-- ---------------------------------------------------------------------------
create function private.products_enforce_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  missing text;
  slug text;
begin
  new.sku := nullif(pg_catalog.btrim(new.sku), '');
  -- Not nulled: a blank name fails products_name_check, which says why.
  new.name := pg_catalog.btrim(new.name);
  new.description := nullif(pg_catalog.btrim(new.description), '');
  new.brand := nullif(pg_catalog.btrim(new.brand), '');

  if new.category_id is not null
     and (tg_op = 'INSERT' or new.category_id is distinct from old.category_id)
     and exists (
       select 1 from public.categories c
       where c.id = new.category_id and c.kind <> 'product'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'category_kind_mismatch',
      detail = 'A product can only be filed under a product category.';
  end if;

  if tg_op = 'INSERT' then
    -- Server-assigned, whatever the caller sent (D9).
    new.short_id := private.next_short_id('P');
    new.created_by := coalesce(new.created_by, private.current_staff_id());
    if new.publication_status not in ('draft', 'internal_only') then
      raise exception using
        errcode = 'P0001',
        message = 'publication_initial_invalid',
        detail = 'A new product starts as a draft or internal only; publish it afterwards.';
    end if;
    new.public_slug := null;
    return new;
  end if;

  -- UPDATE
  if new.short_id is distinct from old.short_id then
    raise exception using
      errcode = 'P0001',
      message = 'product_short_id_immutable',
      detail = 'A product keeps its short ID for life; it is printed on its labels.';
  end if;
  if new.tracking_type is distinct from old.tracking_type then
    raise exception using
      errcode = 'P0001',
      message = 'product_tracking_type_immutable',
      detail = 'A product stays quantity- or unique-tracked; create a new product instead.';
  end if;
  if old.public_slug is not null and new.public_slug is distinct from old.public_slug then
    raise exception using
      errcode = 'P0001',
      message = 'product_slug_immutable',
      detail = 'A published product keeps its public address.';
  end if;

  if new.publication_status is distinct from old.publication_status then
    if not private.publication_transition_allowed(old.publication_status, new.publication_status)
       or (new.publication_status = 'sold' and new.tracking_type <> 'unique') then
      raise exception using
        errcode = 'P0001',
        message = 'publication_transition_invalid',
        detail = pg_catalog.format('A product cannot move from %s to %s.', old.publication_status,
                                   new.publication_status);
    end if;
    -- sold -> public is the system restore done only by
    -- private.refresh_unique_publication (a void or a restock made a unit
    -- available again). It skips the requirements on purpose, so a photo or
    -- price edited after the sale never blocks returning stock. Every other
    -- entry into public must meet them.
    if new.publication_status = 'public' and old.publication_status <> 'sold' then
      missing := private.publication_requirements_met(new.id);
      if missing is not null then
        raise exception using
          errcode = 'P0001',
          message = missing,
          detail = case missing
            when 'publication_requires_price' then 'Set a selling price before publishing.'
            when 'publication_requires_available_unit' then 'There is no available unit to publish.'
            else 'Add a public photo before publishing.'
          end;
      end if;
    end if;
    if new.publication_status = 'public' and new.public_slug is null then
      slug := pg_catalog.btrim(
        pg_catalog.regexp_replace(pg_catalog.lower(new.name), '[^a-z0-9]+', '-', 'g'), '-'
      );
      if slug = '' then
        slug := 'item';
      end if;
      new.public_slug := slug || '-' || pg_catalog.lower(new.short_id);
    end if;
  end if;

  if old.archived_at is null and new.archived_at is not null then
    if new.publication_status = 'public' then
      raise exception using
        errcode = 'P0001',
        message = 'product_published',
        detail = 'Unpublish the product before archiving it.';
    end if;
    if exists (
         select 1 from public.inventory_movements m
         where m.product_id = new.id
         group by m.location_id
         having sum(m.quantity_delta) <> 0
       )
       or exists (
         select 1 from public.inventory_units u
         where u.product_id = new.id and u.status in ('available', 'reserved', 'held_for_customer')
       ) then
      raise exception using
        errcode = 'P0001',
        message = 'product_has_stock',
        detail = 'The product still has stock; adjust it to zero or write off its units first.';
    end if;
  end if;
  return new;
end;
$$;

create trigger products_enforce_rules
  before insert or update on public.products
  for each row execute function private.products_enforce_rules();

-- Direct API writes of a product's cost need view_costs (D14, SPEC §4.2).
-- SECURITY INVOKER on purpose: inside a security definer function
-- current_user is the owner, so this check never fires for the definer RPCs,
-- which run as the owner and check view_costs themselves (by design). For a
-- direct write through PostgREST current_user is authenticated or anon. The
-- products_enforce_rules trigger cannot be invoker: it calls
-- private.next_short_id, whose EXECUTE is not granted to authenticated.
-- Direct API writes always name the column, so the column list is right.
create function private.products_cost_write_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed boolean;
begin
  if current_user::text not in ('authenticated', 'anon') then
    return new;
  end if;
  -- An UPDATE that names the column is refused whatever the value: a
  -- refusal only when it differs would answer "is the stored cost X?"
  -- (an equality oracle on a hidden column). The trigger is UPDATE OF the
  -- column, so it fires only when the column is in the SET list.
  if tg_op = 'INSERT' then
    changed := new.default_direct_cost is not null;
  else
    changed := true;
  end if;
  if changed and not private.has_permission('view_costs') then
    raise exception 'permission view_costs required to set a cost' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger products_cost_write_guard
  before insert or update of default_direct_cost on public.products
  for each row execute function private.products_cost_write_guard();

create function private.record_product_event(
  product_id uuid,
  event_type public.product_event_type,
  payload jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into public.product_events (product_id, event_type, actor_staff_id, payload, reason, correlation_id)
  values (
    record_product_event.product_id, record_product_event.event_type, private.current_staff_id(),
    coalesce(record_product_event.payload, '{}'::jsonb), private.change_reason(),
    private.current_correlation_id()
  );
end;
$$;

-- Payloads are exact and never name or carry a cost (details_changed lists
-- field names only; cost_changed is empty).
create function private.products_record_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fields text[] := '{}';
begin
  if tg_op = 'INSERT' then
    perform private.record_product_event(
      new.id, 'created',
      pg_catalog.jsonb_build_object(
        'short_id', new.short_id,
        'name', new.name,
        'tracking_type', new.tracking_type,
        'publication_status', new.publication_status
      )
    );
    return null;
  end if;

  if new.sku is distinct from old.sku then fields := fields || 'sku'::text; end if;
  if new.name is distinct from old.name then fields := fields || 'name'::text; end if;
  if new.description is distinct from old.description then fields := fields || 'description'::text; end if;
  if new.brand is distinct from old.brand then fields := fields || 'brand'::text; end if;
  if new.category_id is distinct from old.category_id then fields := fields || 'category_id'::text; end if;
  if new.reorder_point is distinct from old.reorder_point then fields := fields || 'reorder_point'::text; end if;
  if new.active is distinct from old.active then fields := fields || 'active'::text; end if;
  if new.ownership_type is distinct from old.ownership_type then fields := fields || 'ownership_type'::text; end if;
  if new.currency is distinct from old.currency then fields := fields || 'currency'::text; end if;
  if new.shopify_product_id is distinct from old.shopify_product_id then
    fields := fields || 'shopify_product_id'::text;
  end if;
  if new.shopify_variant_id is distinct from old.shopify_variant_id then
    fields := fields || 'shopify_variant_id'::text;
  end if;
  if pg_catalog.cardinality(fields) > 0 then
    perform private.record_product_event(
      new.id, 'details_changed', pg_catalog.jsonb_build_object('fields', pg_catalog.to_jsonb(fields))
    );
  end if;

  if new.default_sale_price is distinct from old.default_sale_price then
    perform private.record_product_event(
      new.id, 'price_changed',
      pg_catalog.jsonb_build_object('from', old.default_sale_price, 'to', new.default_sale_price)
    );
  end if;
  if new.default_direct_cost is distinct from old.default_direct_cost then
    perform private.record_product_event(new.id, 'cost_changed', '{}'::jsonb);
  end if;
  if new.publication_status is distinct from old.publication_status then
    perform private.record_product_event(
      new.id, 'publication_changed',
      pg_catalog.jsonb_build_object('from', old.publication_status, 'to', new.publication_status)
    );
  end if;
  if old.archived_at is null and new.archived_at is not null then
    perform private.record_product_event(new.id, 'archived', '{}'::jsonb);
  elsif old.archived_at is not null and new.archived_at is null then
    perform private.record_product_event(new.id, 'unarchived', '{}'::jsonb);
  end if;
  return null;
end;
$$;

create trigger products_record_history
  after insert or update on public.products
  for each row execute function private.products_record_history();

-- ---------------------------------------------------------------------------
-- inventory_units: rules, the cost-write guard and history
-- ---------------------------------------------------------------------------
create function private.inventory_units_enforce_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  product_tracking public.tracking_type;
begin
  new.serial_number := nullif(pg_catalog.btrim(new.serial_number), '');
  new.condition := nullif(pg_catalog.btrim(new.condition), '');
  new.internal_notes := nullif(pg_catalog.btrim(new.internal_notes), '');

  if tg_op = 'INSERT' then
    new.short_id := private.next_short_id('U');
    new.created_by := coalesce(new.created_by, private.current_staff_id());
    select p.tracking_type into product_tracking from public.products p where p.id = new.product_id;
    if not found then
      raise exception 'product % not found', new.product_id using errcode = 'P0002';
    end if;
    if product_tracking <> 'unique' then
      raise exception using
        errcode = 'P0001',
        message = 'product_not_unique',
        detail = 'Only a unique-tracked product has individual units.';
    end if;
    if new.status <> 'available' then
      raise exception using
        errcode = 'P0001',
        message = 'unit_status_transition_invalid',
        detail = 'A unit starts available.';
    end if;
    new.sold_at := null;
    return new;
  end if;

  if new.short_id is distinct from old.short_id then
    raise exception using
      errcode = 'P0001',
      message = 'unit_short_id_immutable',
      detail = 'A unit keeps its short ID for life; it is printed on its label.';
  end if;
  if new.product_id is distinct from old.product_id then
    raise exception using
      errcode = 'P0001',
      message = 'unit_product_mismatch',
      detail = 'A unit stays with its product.';
  end if;
  if new.status is distinct from old.status then
    if not private.unit_status_transition_allowed(old.status, new.status) then
      raise exception using
        errcode = 'P0001',
        message = 'unit_status_transition_invalid',
        detail = pg_catalog.format('A unit cannot move from %s to %s.', old.status, new.status);
    end if;
    if new.status = 'sold' and new.sold_at is null then
      new.sold_at := pg_catalog.clock_timestamp();
    elsif new.status <> 'sold' then
      new.sold_at := null;
    end if;
  end if;
  if old.archived_at is null and new.archived_at is not null
     and new.status not in ('sold', 'written_off', 'returned_to_consignor') then
    raise exception using
      errcode = 'P0001',
      message = 'unit_in_stock',
      detail = 'Only a sold, written-off or returned unit can be archived.';
  end if;
  return new;
end;
$$;

create trigger inventory_units_enforce_rules
  before insert or update on public.inventory_units
  for each row execute function private.inventory_units_enforce_rules();

-- Same rule and reason as products_cost_write_guard (SECURITY INVOKER on
-- purpose: definer RPCs run as the owner and check view_costs themselves).
create function private.inventory_units_cost_write_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed boolean;
begin
  if current_user::text not in ('authenticated', 'anon') then
    return new;
  end if;
  -- An UPDATE that names the column is refused whatever the value: a
  -- refusal only when it differs would answer "is the stored cost X?"
  -- (an equality oracle on a hidden column). The trigger is UPDATE OF the
  -- column, so it fires only when the column is in the SET list.
  if tg_op = 'INSERT' then
    changed := new.direct_cost is not null;
  else
    changed := true;
  end if;
  if changed and not private.has_permission('view_costs') then
    raise exception 'permission view_costs required to set a cost' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger inventory_units_cost_write_guard
  before insert or update of direct_cost on public.inventory_units
  for each row execute function private.inventory_units_cost_write_guard();

create function private.record_unit_event(
  unit_id uuid,
  event_type public.inventory_unit_event_type,
  payload jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into public.inventory_unit_events (unit_id, event_type, actor_staff_id, payload, reason, correlation_id)
  values (
    record_unit_event.unit_id, record_unit_event.event_type, private.current_staff_id(),
    coalesce(record_unit_event.payload, '{}'::jsonb), private.change_reason(),
    private.current_correlation_id()
  );
end;
$$;

create function private.inventory_units_record_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fields text[] := '{}';
begin
  if tg_op = 'INSERT' then
    perform private.record_unit_event(
      new.id, 'created',
      pg_catalog.jsonb_build_object(
        'short_id', new.short_id,
        'product_id', new.product_id,
        'location_id', new.location_id,
        'status', new.status,
        'ownership_type', new.ownership_type
      )
    );
    return null;
  end if;

  if new.status is distinct from old.status then
    perform private.record_unit_event(
      new.id, 'status_changed',
      private.event_context() || pg_catalog.jsonb_build_object('from', old.status, 'to', new.status)
    );
  end if;
  if new.location_id is distinct from old.location_id then
    perform private.record_unit_event(
      new.id, 'moved',
      pg_catalog.jsonb_build_object('from_location_id', old.location_id, 'to_location_id', new.location_id)
    );
  end if;

  if new.serial_number is distinct from old.serial_number then fields := fields || 'serial_number'::text; end if;
  if new.condition is distinct from old.condition then fields := fields || 'condition'::text; end if;
  if new.internal_notes is distinct from old.internal_notes then fields := fields || 'internal_notes'::text; end if;
  if new.bike_id is distinct from old.bike_id then fields := fields || 'bike_id'::text; end if;
  if new.ownership_type is distinct from old.ownership_type then fields := fields || 'ownership_type'::text; end if;
  if new.consignment_item_id is distinct from old.consignment_item_id then
    fields := fields || 'consignment_item_id'::text;
  end if;
  if new.sold_sale_line_id is distinct from old.sold_sale_line_id then
    fields := fields || 'sold_sale_line_id'::text;
  end if;
  if pg_catalog.cardinality(fields) > 0 then
    perform private.record_unit_event(
      new.id, 'details_changed', pg_catalog.jsonb_build_object('fields', pg_catalog.to_jsonb(fields))
    );
  end if;

  if new.sale_price is distinct from old.sale_price then
    perform private.record_unit_event(
      new.id, 'price_changed', pg_catalog.jsonb_build_object('from', old.sale_price, 'to', new.sale_price)
    );
  end if;
  if new.direct_cost is distinct from old.direct_cost then
    perform private.record_unit_event(new.id, 'cost_changed', '{}'::jsonb);
  end if;
  if old.archived_at is null and new.archived_at is not null then
    perform private.record_unit_event(new.id, 'archived', '{}'::jsonb);
  elsif old.archived_at is not null and new.archived_at is null then
    perform private.record_unit_event(new.id, 'unarchived', '{}'::jsonb);
  end if;
  return null;
end;
$$;

create trigger inventory_units_record_history
  after insert or update on public.inventory_units
  for each row execute function private.inventory_units_record_history();

-- ---------------------------------------------------------------------------
-- inventory_movements: rules and the deferred unit consistency check
-- ---------------------------------------------------------------------------
create function private.inventory_movements_enforce_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  product_tracking public.tracking_type;
  unit_product uuid;
  original public.inventory_movements;
begin
  select p.tracking_type into product_tracking from public.products p where p.id = new.product_id;
  if not found then
    raise exception 'product % not found', new.product_id using errcode = 'P0002';
  end if;
  if (product_tracking = 'unique') <> (new.inventory_unit_id is not null) then
    raise exception using
      errcode = 'P0001',
      message = 'movement_invalid',
      detail = 'A unique product''s stock moves unit by unit; a quantity product''s never names a unit.';
  end if;
  if new.inventory_unit_id is not null then
    select u.product_id into unit_product from public.inventory_units u where u.id = new.inventory_unit_id;
    if unit_product is distinct from new.product_id then
      raise exception using
        errcode = 'P0001',
        message = 'movement_invalid',
        detail = 'The unit belongs to another product.';
    end if;
  end if;
  if new.reversal_of_id is not null then
    select m.* into original from public.inventory_movements m where m.id = new.reversal_of_id;
    if not found
       or original.movement_type = 'reversal'
       or original.product_id is distinct from new.product_id
       or original.inventory_unit_id is distinct from new.inventory_unit_id
       or original.location_id is distinct from new.location_id
       or new.quantity_delta <> -original.quantity_delta then
      raise exception using
        errcode = 'P0001',
        message = 'movement_invalid',
        detail = 'A reversal undoes exactly one earlier movement: same item and place, opposite quantity.';
    end if;
  end if;
  new.created_by := coalesce(new.created_by, private.current_staff_id());
  new.correlation_id := coalesce(new.correlation_id, private.current_correlation_id());
  return new;
end;
$$;

create trigger inventory_movements_enforce_rules
  before insert on public.inventory_movements
  for each row execute function private.inventory_movements_enforce_rules();

create function private.inventory_movements_unit_consistent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_unit_consistent(new.inventory_unit_id);
  return null;
end;
$$;

create constraint trigger inventory_unit_ledger_consistent
  after insert on public.inventory_movements
  deferrable initially deferred
  for each row
  when (new.inventory_unit_id is not null)
  execute function private.inventory_movements_unit_consistent();

create function private.inventory_units_ledger_consistent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or new.status is distinct from old.status
     or new.location_id is distinct from old.location_id
     or new.bike_id is distinct from old.bike_id then
    perform private.assert_unit_consistent(new.id);
  end if;
  return null;
end;
$$;

create constraint trigger inventory_unit_ledger_consistent
  after insert or update on public.inventory_units
  deferrable initially deferred
  for each row
  execute function private.inventory_units_ledger_consistent();

-- ---------------------------------------------------------------------------
-- bikes: a shop bike in stock stays the shop's (public/private boundary).
-- A bike whose unit is sold, written off or returned may be transferred
-- (that is how a sold shop bike reaches its buyer). Covers both
-- transfer_bike_ownership and a direct archive (Phase 1 grant).
-- ---------------------------------------------------------------------------
create function private.bikes_guard_stock_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  unit_short_id text;
begin
  if new.inventory_unit_id is null then
    return new;
  end if;
  if (old.customer_id is null and new.customer_id is not null)
     or (old.archived_at is null and new.archived_at is not null) then
    select u.short_id into unit_short_id
    from public.inventory_units u
    where u.id = new.inventory_unit_id and u.status in ('available', 'reserved', 'held_for_customer');
    if found then
      raise exception using
        errcode = 'P0001',
        message = 'bike_in_stock',
        detail = pg_catalog.format('This bike is in stock as %s; sell or write off the unit first.', unit_short_id);
    end if;
  end if;
  return new;
end;
$$;

-- WHEN, not UPDATE OF: the columns may also change through other triggers.
create trigger bikes_guard_stock_link
  before update on public.bikes
  for each row
  when (old.customer_id is distinct from new.customer_id or old.archived_at is distinct from new.archived_at)
  execute function private.bikes_guard_stock_link();

-- ---------------------------------------------------------------------------
-- Photos on stock (Phase 1 extension point) and the stock-photo rule.
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
    when 'product' then
      return exists (select 1 from public.products p where p.id = attachment_entity_exists.entity_id);
    when 'inventory_unit' then
      return exists (select 1 from public.inventory_units u where u.id = attachment_entity_exists.entity_id);
    else
      -- consignment_item: Phase 6 adds a branch.
      return null;
  end case;
end;
$$;

-- Stock has no customer (D13 extended, D19's pattern): photos on a product
-- or a unit are internal or public, never customer. A business error for
-- record_attachment and set_attachment_visibility; the CHECK is the backstop.
create function private.attachments_stock_never_customer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.entity_type in ('product', 'inventory_unit') and new.visibility = 'customer' then
    raise exception using
      errcode = 'P0001',
      message = 'attachment_stock_never_customer',
      detail = 'Stock photos have no customer; choose Internal or Public.';
  end if;
  return new;
end;
$$;

create trigger attachments_stock_never_customer
  before insert or update of visibility on public.attachments
  for each row execute function private.attachments_stock_never_customer();

alter table public.attachments
  add constraint attachments_stock_never_customer check (
    not (entity_type in ('product', 'inventory_unit') and visibility = 'customer')
  );

-- ---------------------------------------------------------------------------
-- Cost and price views. Definer views (they read columns authenticated has
-- no grant on), security_barrier, gated in their WHERE clause. Expected
-- Cult Commons is Phase 3's generated cult_commons_share for quantity 1
-- (D1): round(greatest(round(price, 2) - round(cost, 2), 0) x rate, 2), at
-- the rate in force now; null when the price or the cost is unknown.
-- ---------------------------------------------------------------------------
create view public.product_costs
with (security_barrier)
as
  select p.id as product_id,
         p.default_direct_cost,
         p.currency,
         (x.price - p.default_direct_cost)::public.money_amount as expected_yield,
         (case when x.price is not null and p.default_direct_cost is not null then
            round(greatest(round(x.price, 2) - round(p.default_direct_cost, 2), 0) * r.rate, 2)
          end)::public.money_amount as expected_cult_commons
  from public.products p
  cross join lateral (select private.selling_price(p.id, null) as price) x
  cross join (select private.cult_commons_rate_at(now()) as rate) r
  where (select private.has_permission('view_costs'));

comment on view public.product_costs is
  'Per product: default direct cost, expected yield and Cult Commons at the default price, for view_costs only.';

create view public.inventory_unit_costs
with (security_barrier)
as
  select u.id as unit_id,
         u.direct_cost,
         x.cost as effective_cost,
         p.currency,
         (x.price - x.cost)::public.money_amount as expected_yield,
         (case when x.price is not null and x.cost is not null then
            round(greatest(round(x.price, 2) - round(x.cost, 2), 0) * r.rate, 2)
          end)::public.money_amount as expected_cult_commons
  from public.inventory_units u
  join public.products p on p.id = u.product_id
  cross join lateral (
    select private.selling_price(u.product_id, u.id) as price,
           coalesce(u.direct_cost, p.default_direct_cost)::public.money_amount as cost
  ) x
  cross join (select private.cult_commons_rate_at(now()) as rate) r
  where (select private.has_permission('view_costs'));

comment on view public.inventory_unit_costs is
  'Per unit: its own and effective direct cost (unit, else product), expected yield and Cult Commons, for view_costs only.';

create view public.inventory_movement_costs
with (security_barrier)
as
  select m.id as movement_id, m.unit_cost_snapshot, m.currency
  from public.inventory_movements m
  where (select private.has_permission('view_costs'));

comment on view public.inventory_movement_costs is
  'Per movement: the unit cost snapshot, for view_costs only.';

create view public.selling_prices
with (security_barrier)
as
  select s.product_id, s.inventory_unit_id, s.selling_price, s.currency
  from (
    select p.id as product_id, null::uuid as inventory_unit_id,
           private.selling_price(p.id, null) as selling_price, p.currency
    from public.products p
    union all
    select u.product_id, u.id, private.selling_price(u.product_id, u.id), p.currency
    from public.inventory_units u
    join public.products p on p.id = u.product_id
  ) s
  where (select private.is_staff());

comment on view public.selling_prices is
  'The effective selling price (private.selling_price) of every product (inventory_unit_id null) and unit, for active staff.';

-- ---------------------------------------------------------------------------
-- Manual stock RPCs. Locks first (lock order), then the replay check, then
-- validation. Return types are narrow: never a cost.
-- ---------------------------------------------------------------------------

-- adjust_stock: a manual movement with a mandatory reason (SPEC §23 "Every
-- manual stock adjustment records actor, timestamp and reason"). Quantity
-- products only. A negative delta may never leave the location below zero
-- (D23: only job consumption may).
create function public.adjust_stock(
  request_id uuid,
  product_id uuid,
  location_id uuid,
  quantity_delta integer,
  movement_type public.movement_type,
  reason text,
  unit_cost public.money_amount default null
)
returns table (movement_id bigint, on_hand integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  cleaned text := nullif(pg_catalog.btrim(coalesce(adjust_stock.reason, '')), '');
  prod public.products;
  loc_active boolean;
  existing public.inventory_movements;
  inserted bigint;
begin
  perform private.require_permission('adjust_stock');
  if adjust_stock.request_id is null or adjust_stock.product_id is null or adjust_stock.location_id is null
     or adjust_stock.quantity_delta is null or adjust_stock.movement_type is null then
    raise exception 'request_id, product_id, location_id, quantity_delta and movement_type are required'
      using errcode = '22004';
  end if;
  if adjust_stock.movement_type not in ('stock_adjustment', 'damaged') then
    raise exception using
      errcode = 'P0001',
      message = 'movement_type_not_manual',
      detail = 'Only a stock adjustment or damaged stock can be recorded by hand.';
  end if;
  if cleaned is null then
    raise exception using
      errcode = 'P0001',
      message = 'reason_required',
      detail = 'Say why the stock is being adjusted.';
  end if;
  if pg_catalog.char_length(cleaned) > 500 then
    raise exception using
      errcode = 'P0001',
      message = 'reason_too_long',
      detail = 'Keep the reason under 500 characters.';
  end if;
  if adjust_stock.quantity_delta = 0 or abs(adjust_stock.quantity_delta) > 100000
     or (adjust_stock.movement_type = 'damaged' and adjust_stock.quantity_delta > 0) then
    raise exception using
      errcode = 'P0001',
      message = 'quantity_invalid',
      detail = 'Enter a quantity other than zero (damaged stock is a negative quantity).';
  end if;
  if adjust_stock.unit_cost is not null then
    if not private.has_permission('view_costs') then
      raise exception 'permission view_costs required to set a cost' using errcode = '42501';
    end if;
    if adjust_stock.quantity_delta < 0 then
      raise exception 'a unit cost is recorded only for stock added' using errcode = '22023';
    end if;
  end if;

  perform private.lock_stock(adjust_stock.product_id);

  -- Replay: the same request returns its movement; the key used for
  -- anything else is request_conflict.
  select m.* into existing from public.inventory_movements m
  where m.request_id = adjust_stock.request_id
  order by m.id
  limit 1;
  if found then
    if existing.product_id = adjust_stock.product_id and existing.location_id = adjust_stock.location_id
       and existing.quantity_delta = adjust_stock.quantity_delta
       and existing.movement_type = adjust_stock.movement_type
       and existing.inventory_unit_id is null then
      return query select existing.id, private.stock_on_hand(existing.product_id, existing.location_id);
      return;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'request_conflict',
      detail = 'That request id was already used for another stock change.';
  end if;

  select p.* into prod from public.products p where p.id = adjust_stock.product_id;
  if not found then
    raise exception 'product % not found', adjust_stock.product_id using errcode = 'P0002';
  end if;
  if prod.tracking_type <> 'quantity' then
    raise exception using
      errcode = 'P0001',
      message = 'product_unit_tracked',
      detail = 'A unique product''s stock changes unit by unit.';
  end if;
  if prod.archived_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'product_archived',
      detail = 'That product is archived; unarchive it first.';
  end if;
  select l.active into loc_active from public.locations l where l.id = adjust_stock.location_id;
  if not found then
    raise exception 'location % not found', adjust_stock.location_id using errcode = 'P0002';
  end if;
  if not loc_active then
    raise exception using
      errcode = 'P0001',
      message = 'location_inactive',
      detail = 'That location is inactive; choose another or reactivate it.';
  end if;
  if adjust_stock.quantity_delta < 0
     and private.stock_on_hand(prod.id, adjust_stock.location_id) + adjust_stock.quantity_delta < 0 then
    raise exception using
      errcode = 'P0001',
      message = 'insufficient_stock',
      detail = 'There is not that much stock at that location.';
  end if;

  inserted := private.record_movement(
    prod.id, null, adjust_stock.location_id, adjust_stock.quantity_delta, adjust_stock.movement_type,
    cleaned, coalesce(adjust_stock.unit_cost, prod.default_direct_cost), adjust_stock.request_id,
    null, null, null
  );
  return query select inserted, private.stock_on_hand(prod.id, adjust_stock.location_id);
end;
$$;

comment on function public.adjust_stock(
  uuid, uuid, uuid, integer, public.movement_type, text, public.money_amount
) is 'adjust_stock: record a stock adjustment or damaged stock with a reason (a unit cost needs view_costs); replay-safe by request_id.';

-- transfer_stock: two 'transfer' rows (-q at from, +q at to) sharing the
-- request_id; for a unique product the unit moves too.
create function public.transfer_stock(
  request_id uuid,
  product_id uuid,
  from_location_id uuid,
  to_location_id uuid,
  quantity integer,
  reason text default null,
  inventory_unit_id uuid default null
)
returns table (movement_id bigint, location_id uuid, quantity_delta integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  cleaned text := nullif(pg_catalog.btrim(coalesce(transfer_stock.reason, '')), '');
  prod_tracking public.tracking_type;
  prod_archived timestamptz;
  unit public.inventory_units;
  found_count integer;
  matching integer;
  from_active boolean;
  to_active boolean;
  err_state text;
  err_constraint text;
  err_table text;
  err_schema text;
  err_column text;
  err_message text;
begin
  perform private.require_permission('manage_inventory');
  if transfer_stock.request_id is null or transfer_stock.product_id is null
     or transfer_stock.from_location_id is null or transfer_stock.to_location_id is null
     or transfer_stock.quantity is null then
    raise exception 'request_id, product_id, from_location_id, to_location_id and quantity are required'
      using errcode = '22004';
  end if;
  if cleaned is not null and pg_catalog.char_length(cleaned) > 500 then
    raise exception using
      errcode = 'P0001',
      message = 'reason_too_long',
      detail = 'Keep the reason under 500 characters.';
  end if;
  if transfer_stock.from_location_id = transfer_stock.to_location_id then
    raise exception using
      errcode = 'P0001',
      message = 'transfer_same_location',
      detail = 'Choose two different locations.';
  end if;

  perform private.lock_stock(transfer_stock.product_id);
  select p.tracking_type, p.archived_at into prod_tracking, prod_archived
  from public.products p where p.id = transfer_stock.product_id;
  if not found then
    raise exception 'product % not found', transfer_stock.product_id using errcode = 'P0002';
  end if;
  if transfer_stock.inventory_unit_id is not null then
    select u.* into unit from public.inventory_units u where u.id = transfer_stock.inventory_unit_id for update;
    if not found then
      raise exception 'unit % not found', transfer_stock.inventory_unit_id using errcode = 'P0002';
    end if;
  end if;

  -- Replay: both rows of the same transfer return; the key used for
  -- anything else is request_conflict.
  select count(*)::integer,
         count(*) filter (
           where m.product_id = transfer_stock.product_id
             and m.movement_type = 'transfer'
             and m.inventory_unit_id is not distinct from transfer_stock.inventory_unit_id
             and ((m.location_id = transfer_stock.from_location_id and m.quantity_delta = -transfer_stock.quantity)
               or (m.location_id = transfer_stock.to_location_id and m.quantity_delta = transfer_stock.quantity))
         )::integer
    into found_count, matching
  from public.inventory_movements m
  where m.request_id = transfer_stock.request_id;
  if found_count > 0 then
    if found_count = 2 and matching = 2 then
      return query
        select m.id, m.location_id, m.quantity_delta
        from public.inventory_movements m
        where m.request_id = transfer_stock.request_id
        order by m.id;
      return;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'request_conflict',
      detail = 'That request id was already used for another stock change.';
  end if;

  select l.active into from_active from public.locations l where l.id = transfer_stock.from_location_id;
  if not found then
    raise exception 'location % not found', transfer_stock.from_location_id using errcode = 'P0002';
  end if;
  select l.active into to_active from public.locations l where l.id = transfer_stock.to_location_id;
  if not found then
    raise exception 'location % not found', transfer_stock.to_location_id using errcode = 'P0002';
  end if;
  if not from_active or not to_active then
    raise exception using
      errcode = 'P0001',
      message = 'location_inactive',
      detail = 'That location is inactive; choose another or reactivate it.';
  end if;
  if prod_archived is not null then
    raise exception using
      errcode = 'P0001',
      message = 'product_archived',
      detail = 'That product is archived; unarchive it first.';
  end if;

  if prod_tracking = 'quantity' then
    if transfer_stock.inventory_unit_id is not null then
      raise exception using
        errcode = 'P0001',
        message = 'unit_product_mismatch',
        detail = 'That unit does not belong to this product.';
    end if;
    if transfer_stock.quantity < 1 or transfer_stock.quantity > 100000 then
      raise exception using
        errcode = 'P0001',
        message = 'quantity_invalid',
        detail = 'Move at least one.';
    end if;
    if private.stock_on_hand(transfer_stock.product_id, transfer_stock.from_location_id) < transfer_stock.quantity then
      raise exception using
        errcode = 'P0001',
        message = 'insufficient_stock',
        detail = 'There is not that much stock at that location.';
    end if;
  else
    if transfer_stock.inventory_unit_id is null then
      raise exception using
        errcode = 'P0001',
        message = 'unit_required',
        detail = 'Choose which unit to move.';
    end if;
    if transfer_stock.quantity <> 1 then
      raise exception using
        errcode = 'P0001',
        message = 'quantity_invalid',
        detail = 'A unique item moves one at a time.';
    end if;
    if unit.product_id <> transfer_stock.product_id then
      raise exception using
        errcode = 'P0001',
        message = 'unit_product_mismatch',
        detail = 'That unit does not belong to this product.';
    end if;
    if unit.status not in ('available', 'reserved') or unit.archived_at is not null then
      raise exception using
        errcode = 'P0001',
        message = 'unit_not_available',
        detail = 'That unit is not in stock.';
    end if;
    if unit.location_id <> transfer_stock.from_location_id then
      raise exception using
        errcode = 'P0001',
        message = 'unit_location_mismatch',
        detail = 'That unit is somewhere else.';
    end if;
    perform private.set_change_reason(cleaned);
    begin
      update public.inventory_units u set location_id = transfer_stock.to_location_id where u.id = unit.id;
    exception
      when check_violation or not_null_violation then
        get stacked diagnostics
          err_state = returned_sqlstate, err_constraint = constraint_name, err_table = table_name,
          err_schema = schema_name, err_column = column_name, err_message = message_text;
        perform private.raise_without_row(err_state, err_constraint, err_table, err_schema, err_column, err_message);
    end;
    perform private.set_change_reason(null);
  end if;

  perform private.record_movement(
    transfer_stock.product_id, transfer_stock.inventory_unit_id, transfer_stock.from_location_id,
    -transfer_stock.quantity, 'transfer', cleaned, null, transfer_stock.request_id, null, null, null
  );
  perform private.record_movement(
    transfer_stock.product_id, transfer_stock.inventory_unit_id, transfer_stock.to_location_id,
    transfer_stock.quantity, 'transfer', cleaned, null, transfer_stock.request_id, null, null, null
  );
  return query
    select m.id, m.location_id, m.quantity_delta
    from public.inventory_movements m
    where m.request_id = transfer_stock.request_id
    order by m.id;
end;
$$;

comment on function public.transfer_stock(uuid, uuid, uuid, uuid, integer, text, uuid) is
  'manage_inventory: move stock (or one unique unit) between active locations; replay-safe by request_id.';

-- The narrow results of the unit RPCs (never a cost).
create type public.unique_unit_result as (unit_id uuid, short_id text);
create type public.unit_status_result as (unit_id uuid, status public.unit_status);

-- create_unique_unit: a shop-owned unit (D27) with its +1 movement
-- (request_id = the client's new unit id, the one key created for this
-- call). A double tap replays under the stock lock instead of raising 23505.
create function public.create_unique_unit(
  unit_id uuid,
  product_id uuid,
  location_id uuid,
  serial_number text default null,
  condition text default null,
  sale_price public.money_amount default null,
  direct_cost public.money_amount default null,
  bike_id uuid default null,
  reason text default null
)
returns public.unique_unit_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  cleaned text := nullif(pg_catalog.btrim(coalesce(create_unique_unit.reason, '')), '');
  existing public.inventory_units;
  prod public.products;
  loc_active boolean;
  bike public.bikes;
  created public.inventory_units;
  result public.unique_unit_result;
begin
  perform private.require_permission('manage_inventory');
  if create_unique_unit.direct_cost is not null and not private.has_permission('view_costs') then
    raise exception 'permission view_costs required to set a cost' using errcode = '42501';
  end if;
  if create_unique_unit.unit_id is null or create_unique_unit.product_id is null
     or create_unique_unit.location_id is null then
    raise exception 'unit_id, product_id and location_id are required' using errcode = '22004';
  end if;
  if cleaned is not null and pg_catalog.char_length(cleaned) > 500 then
    raise exception using
      errcode = 'P0001',
      message = 'reason_too_long',
      detail = 'Keep the reason under 500 characters.';
  end if;

  perform private.lock_stock(create_unique_unit.product_id);

  select u.* into existing from public.inventory_units u where u.id = create_unique_unit.unit_id;
  if found then
    if existing.product_id = create_unique_unit.product_id then
      result := row(existing.id, existing.short_id);
      return result;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'unit_conflict',
      detail = 'That unit id is already used for another unit.';
  end if;

  select p.* into prod from public.products p where p.id = create_unique_unit.product_id;
  if not found then
    raise exception 'product % not found', create_unique_unit.product_id using errcode = 'P0002';
  end if;
  if prod.tracking_type <> 'unique' then
    raise exception using
      errcode = 'P0001',
      message = 'product_not_unique',
      detail = 'Only a unique-tracked product has individual units.';
  end if;
  if prod.archived_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'product_archived',
      detail = 'That product is archived; unarchive it first.';
  end if;
  if not prod.active then
    raise exception using
      errcode = 'P0001',
      message = 'product_inactive',
      detail = 'That product is inactive.';
  end if;
  select l.active into loc_active from public.locations l where l.id = create_unique_unit.location_id;
  if not found then
    raise exception 'location % not found', create_unique_unit.location_id using errcode = 'P0002';
  end if;
  if not loc_active then
    raise exception using
      errcode = 'P0001',
      message = 'location_inactive',
      detail = 'That location is inactive; choose another or reactivate it.';
  end if;

  if create_unique_unit.bike_id is not null then
    -- Lock order step 4: a concurrent transfer_bike_ownership waits, then
    -- hits bike_in_stock.
    select b.* into bike from public.bikes b where b.id = create_unique_unit.bike_id for update;
    if not found then
      raise exception 'bike % not found', create_unique_unit.bike_id using errcode = 'P0002';
    end if;
    if bike.archived_at is not null then
      raise exception using
        errcode = 'P0001',
        message = 'bike_archived',
        detail = 'That bike is archived; unarchive it first.';
    end if;
    if bike.customer_id is not null then
      raise exception using
        errcode = 'P0001',
        message = 'bike_has_owner',
        detail = 'That bike belongs to a customer; only a shop bike can be stock.';
    end if;
    if bike.inventory_unit_id is not null then
      raise exception using
        errcode = 'P0001',
        message = 'bike_already_linked',
        detail = 'That bike is already in stock as another unit.';
    end if;
  end if;

  perform private.set_change_reason(cleaned);
  created := private.register_unit(
    create_unique_unit.unit_id, prod.id, create_unique_unit.location_id, 'shop_owned',
    create_unique_unit.serial_number, create_unique_unit.condition, create_unique_unit.sale_price,
    create_unique_unit.direct_cost, create_unique_unit.bike_id, null
  );
  perform private.record_movement(
    prod.id, created.id, created.location_id, 1, 'stock_adjustment',
    coalesce(cleaned, 'Registered as a unique item'),
    coalesce(create_unique_unit.direct_cost, prod.default_direct_cost),
    created.id, null, null, null
  );
  perform private.set_change_reason(null);
  -- A new available unit on a sold product restores it to public (D26's
  -- system restore, as a void does); lock order step 6, after the stock,
  -- the bike and the unit.
  perform private.refresh_unique_publication(prod.id);
  result := row(created.id, created.short_id);
  return result;
end;
$$;

comment on function public.create_unique_unit(
  uuid, uuid, uuid, text, text, public.money_amount, public.money_amount, uuid, text
) is 'manage_inventory: register a shop-owned unique unit (a cost needs view_costs) with its +1 movement; replay-safe by unit id.';

-- write_off_unit: available or reserved -> written_off with a 'damaged'
-- movement of -1 and the reason.
create function public.write_off_unit(request_id uuid, unit_id uuid, reason text)
returns public.unit_status_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  cleaned text := nullif(pg_catalog.btrim(coalesce(write_off_unit.reason, '')), '');
  unit_product uuid;
  unit public.inventory_units;
  existing public.inventory_movements;
  default_cost public.money_amount;
  result public.unit_status_result;
begin
  perform private.require_permission('adjust_stock');
  if write_off_unit.request_id is null or write_off_unit.unit_id is null then
    raise exception 'request_id and unit_id are required' using errcode = '22004';
  end if;
  if cleaned is null then
    raise exception using
      errcode = 'P0001',
      message = 'reason_required',
      detail = 'Say why the unit is being written off.';
  end if;
  if pg_catalog.char_length(cleaned) > 500 then
    raise exception using
      errcode = 'P0001',
      message = 'reason_too_long',
      detail = 'Keep the reason under 500 characters.';
  end if;

  select u.product_id into unit_product from public.inventory_units u where u.id = write_off_unit.unit_id;
  if not found then
    raise exception 'unit % not found', write_off_unit.unit_id using errcode = 'P0002';
  end if;
  perform private.lock_stock(unit_product);
  select u.* into unit from public.inventory_units u where u.id = write_off_unit.unit_id for update;

  select m.* into existing from public.inventory_movements m
  where m.request_id = write_off_unit.request_id
  order by m.id
  limit 1;
  if found then
    if existing.movement_type = 'damaged' and existing.inventory_unit_id = unit.id then
      result := row(unit.id, unit.status);
      return result;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'request_conflict',
      detail = 'That request id was already used for another stock change.';
  end if;

  if unit.status = 'written_off' then
    result := row(unit.id, unit.status);
    return result;
  end if;
  if unit.status not in ('available', 'reserved') then
    raise exception using
      errcode = 'P0001',
      message = 'unit_not_available',
      detail = 'Only a unit in stock can be written off.';
  end if;

  select p.default_direct_cost into default_cost from public.products p where p.id = unit.product_id;
  perform private.set_change_reason(cleaned);
  perform private.set_unit_status(unit.id, 'written_off');
  perform private.record_movement(
    unit.product_id, unit.id, unit.location_id, -1, 'damaged', cleaned,
    coalesce(unit.direct_cost, default_cost), write_off_unit.request_id, null, null, null
  );
  perform private.set_change_reason(null);
  result := row(unit.id, 'written_off'::public.unit_status);
  return result;
end;
$$;

comment on function public.write_off_unit(uuid, uuid, text) is
  'adjust_stock: write off an available or reserved unit with a reason (a damaged movement); replay-safe by request_id.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function
  private.publication_transition_allowed(public.publication_status, public.publication_status),
  private.unit_status_transition_allowed(public.unit_status, public.unit_status),
  private.set_event_context(jsonb),
  private.event_context(),
  private.product_events_append_only(),
  private.inventory_unit_events_append_only(),
  private.inventory_movements_append_only(),
  private.lock_stock(uuid),
  private.stock_on_hand(uuid, uuid),
  private.selling_price(uuid, uuid),
  private.record_movement(
    uuid, uuid, uuid, integer, public.movement_type, text, public.money_amount, uuid, uuid, uuid, bigint
  ),
  private.register_unit(
    uuid, uuid, uuid, public.ownership_type, text, text, public.money_amount, public.money_amount, uuid, uuid
  ),
  private.set_unit_status(uuid, public.unit_status, timestamptz),
  private.publication_requirements_met(uuid),
  private.refresh_unique_publication(uuid),
  private.assert_unit_consistent(uuid),
  private.locations_enforce_rules(),
  private.products_enforce_rules(),
  private.products_cost_write_guard(),
  private.record_product_event(uuid, public.product_event_type, jsonb),
  private.products_record_history(),
  private.inventory_units_enforce_rules(),
  private.inventory_units_cost_write_guard(),
  private.record_unit_event(uuid, public.inventory_unit_event_type, jsonb),
  private.inventory_units_record_history(),
  private.inventory_movements_enforce_rules(),
  private.inventory_movements_unit_consistent(),
  private.inventory_units_ledger_consistent(),
  private.bikes_guard_stock_link(),
  private.attachment_entity_exists(public.attachment_entity, uuid),
  private.attachments_stock_never_customer()
from public, anon, authenticated, service_role;

-- The cost and price views call these as the caller (a view's functions run
-- with the privileges of the query using it), so authenticated may execute
-- them. Neither is reachable through the API: `private` is not exposed.
grant execute on function
  private.selling_price(uuid, uuid),
  private.cult_commons_rate_at(timestamptz)
to authenticated;

revoke all on function
  public.adjust_stock(uuid, uuid, uuid, integer, public.movement_type, text, public.money_amount),
  public.transfer_stock(uuid, uuid, uuid, uuid, integer, text, uuid),
  public.create_unique_unit(uuid, uuid, uuid, text, text, public.money_amount, public.money_amount, uuid, text),
  public.write_off_unit(uuid, uuid, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.adjust_stock(uuid, uuid, uuid, integer, public.movement_type, text, public.money_amount),
  public.transfer_stock(uuid, uuid, uuid, uuid, integer, text, uuid),
  public.create_unique_unit(uuid, uuid, uuid, text, text, public.money_amount, public.money_amount, uuid, text),
  public.write_off_unit(uuid, uuid, text)
to authenticated;

alter table public.locations enable row level security;
alter table public.products enable row level security;
alter table public.inventory_units enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.product_events enable row level security;
alter table public.inventory_unit_events enable row level security;

revoke all on table public.locations from public, anon, authenticated, service_role;
revoke all on table public.products from public, anon, authenticated, service_role;
revoke all on table public.inventory_units from public, anon, authenticated, service_role;
revoke all on table public.inventory_movements from public, anon, authenticated, service_role;
revoke all on table public.product_events from public, anon, authenticated, service_role;
revoke all on table public.inventory_unit_events from public, anon, authenticated, service_role;
revoke all on table public.product_costs from public, anon, authenticated, service_role;
revoke all on table public.inventory_unit_costs from public, anon, authenticated, service_role;
revoke all on table public.inventory_movement_costs from public, anon, authenticated, service_role;
revoke all on table public.selling_prices from public, anon, authenticated, service_role;
-- The identity's sequence too: hosted Supabase grants it to the API roles.
revoke all on sequence public.inventory_movements_id_seq from public, anon, authenticated, service_role;

grant select on table public.locations to authenticated;
grant insert (id, name, kind, active, sort_order) on table public.locations to authenticated;
grant update (name, kind, active, sort_order) on table public.locations to authenticated;
grant select on table public.locations to service_role;

-- Every column except default_direct_cost (SPEC §4.2 cost gating). A
-- `select *` therefore fails; callers list their columns. Publication,
-- slug, short ID, ownership and Shopify links change only through RPCs and
-- later phases.
grant select (
  id, short_id, sku, sku_key, name, description, brand, category_id, tracking_type, ownership_type,
  publication_status, public_slug, default_sale_price, currency, reorder_point, shopify_product_id,
  shopify_variant_id, active, search_text, created_by, created_at, updated_at, archived_at
) on table public.products to authenticated;
grant insert (
  id, sku, name, description, brand, category_id, tracking_type, default_sale_price, default_direct_cost,
  currency, reorder_point, active
) on table public.products to authenticated;
grant update (
  sku, name, description, brand, category_id, default_sale_price, default_direct_cost, reorder_point,
  active, archived_at
) on table public.products to authenticated;
grant select on table public.products to service_role;

-- Every column except direct_cost. Units are created only through RPCs.
grant select (
  id, short_id, product_id, location_id, serial_number, serial_key, condition, ownership_type,
  consignment_item_id, bike_id, status, sale_price, sold_sale_line_id, sold_at, internal_notes,
  created_by, created_at, updated_at, archived_at
) on table public.inventory_units to authenticated;
grant update (
  serial_number, condition, sale_price, direct_cost, internal_notes, archived_at
) on table public.inventory_units to authenticated;
grant select on table public.inventory_units to service_role;

-- Every column except unit_cost_snapshot; no writes for any API role.
grant select (
  id, product_id, inventory_unit_id, location_id, quantity_delta, movement_type, work_order_id,
  work_order_line_item_id, sale_line_id, purchase_receipt_line_id, consignment_item_id, request_id,
  reversal_of_id, currency, reason, created_by, correlation_id, created_at
) on table public.inventory_movements to authenticated;
grant select on table public.inventory_movements to service_role;

grant select on table public.product_events to authenticated, service_role;
grant select on table public.inventory_unit_events to authenticated, service_role;

grant select on table public.product_costs to authenticated;
grant select on table public.inventory_unit_costs to authenticated;
grant select on table public.inventory_movement_costs to authenticated;
grant select on table public.selling_prices to authenticated;

create policy locations_select_staff on public.locations
  for select to authenticated
  using ((select private.is_staff()));

create policy locations_insert_manage_inventory on public.locations
  for insert to authenticated
  with check ((select private.has_permission('manage_inventory')));

create policy locations_update_manage_inventory on public.locations
  for update to authenticated
  using ((select private.has_permission('manage_inventory')))
  with check ((select private.has_permission('manage_inventory')));

create policy products_select_staff on public.products
  for select to authenticated
  using ((select private.is_staff()));

create policy products_insert_manage_inventory on public.products
  for insert to authenticated
  with check ((select private.has_permission('manage_inventory')));

create policy products_update_manage_inventory on public.products
  for update to authenticated
  using ((select private.has_permission('manage_inventory')))
  with check ((select private.has_permission('manage_inventory')));

create policy inventory_units_select_staff on public.inventory_units
  for select to authenticated
  using ((select private.is_staff()));

create policy inventory_units_update_manage_inventory on public.inventory_units
  for update to authenticated
  using ((select private.has_permission('manage_inventory')))
  with check ((select private.has_permission('manage_inventory')));

create policy inventory_movements_select_staff on public.inventory_movements
  for select to authenticated
  using ((select private.is_staff()));

create policy product_events_select_staff on public.product_events
  for select to authenticated
  using ((select private.is_staff()));

create policy inventory_unit_events_select_staff on public.inventory_unit_events
  for select to authenticated
  using ((select private.is_staff()));
