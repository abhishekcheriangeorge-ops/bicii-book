-- Consignment core: consignors, consignment items, their charges and
-- history, returns to the consignor, the single selling price for consigned
-- stock and the stock rules for consigned products (SPEC §2, §10, §11, §12,
-- §13, §23; DATA-MODEL.md §6, §7, §9, §15, §16; PLAN D4, D9, D13/D19,
-- D24 PART-PRICE-COST, D26 PUBLICATION-MACHINE, D27 (changed by the owner
-- 2026-10-05), D29 BIKE-WITH-CUSTOMER, D44 CONS-JOB-PART, D45 CONS-QTY-FIFO,
-- D46 CONS-RESTOCK, D47 SETTLEMENT-RULES, D48 SALES-ACCESS,
-- D50 CONS-STOCK-MOVES, D51 CONS-BIKE-LINK, D52 CONS-PHOTOS-INTERNAL).
--
-- Rules encoded here, for every writer (RPC, seed, SQL editor):
--   * A consigned unit never exists without its consignment item (C-######,
--     D9): units are created only by create_consignment_item, through
--     private.register_unit, and inventory_units.consignment_item_id has a
--     foreign key (deferred: the intake inserts the unit before the item)
--     plus two checks tying it to ownership 'consignment'. A unit keeps its
--     item and its ownership for life; a consigned unit is never written off
--     (D50).
--   * A product is never mixed shop-owned and consigned: its ownership_type
--     cannot change once it has a unit or a movement (D45).
--   * CONS-STOCK-MOVES (D50): stock of a consignment-owned product moves only
--     through intake (consignment_received), return to the consignor
--     (consignment_returned), sale (retail_sale / online_sale with a sale
--     line), restock (return with a sale line), job consumption (D44) and
--     the reversal voiding it writes, and transfers. Adjustments, damage,
--     write-off, create_unique_unit, split and purchase receipts are
--     refused (consignment_stock_adjust_blocked), so on-hand of a consigned
--     product always equals the consignors' remaining quantity.
--   * Every charge has an explicit bearer (D4, no default): `consignor`
--     (deducted from what is owed) or `shop` (added to the item's direct
--     cost, lowering yield). Shop charges exist only on unique items, and
--     only while the unit is available (D45). Charges are voided with a
--     reason, never edited or deleted.
--   * reporting.consignment_item_position is the ONLY derivation of an
--     item's quantities and consignor liability. Liability is derived from
--     live lines, never stored (D44, D46): a replay or a repeated completion
--     can never create a second liability. Step 2 adds sale lines to it.
--   * One selling price (D45): private.selling_price returns a consigned
--     unit's item asking price, and for a consigned quantity product the
--     asking price of its FIFO-head item (the oldest active item with stock
--     left), else the product default.
--   * Photos on a consignment item (agreement, ID, condition notes) are
--     internal only (D52, the D13/D19 pattern: trigger + CHECK).
--   * Consignment money (agreed amounts, charges, item history) is readable
--     with manage_consignments or view_costs (D48,
--     private.can_view_consignment_money); a consignor's payout details with
--     manage_consignments only; customers and anonymous users see nothing.
--
-- GLOBAL LOCK ORDER (extends the inventory migration's header and
-- DATA-MODEL §7). Every RPC and trigger acquires, in order:
--   0.  the request's own idempotency lock, unique to that request and so
--       outside the order (create_consignment_item's advisory lock on
--       'bicii.consignment_item:' || item_id; step 2's sale and settlement
--       header inserts). Nothing is locked before it.
--   0b. the consignors row FOR SHARE (intake checks it is not archived;
--       archiving is a plain UPDATE that takes nothing else).
--   1.  work_orders FOR UPDATE through private.lock_work_order (job paths);
--   2.  work_order_line_items FOR UPDATE;
--   3.  private.lock_stock(product_id), several in ascending product_id;
--   4.  bikes FOR UPDATE, ascending id;
--   5.  inventory_units FOR UPDATE, ascending id;
--   6.  NEW: consignment_items FOR UPDATE, ascending id;
--   7.  products FOR UPDATE, last (private.refresh_unique_publication,
--       set_publication_status, return_consignment_item's archive).
-- A path that starts from an item reads its product_id and
-- inventory_unit_id without a lock (both immutable), takes 3 -> 5 -> 6 and
-- re-verifies. Functions that lock and then read stay VOLATILE.
--
-- Idempotency: create_consignment_item replays by item id under its
-- advisory lock (same request fingerprint -> the same item, else
-- consignment_item_conflict); add_consignment_charge by charge id;
-- void_consignment_charge returns a voided charge unchanged;
-- return_consignment_item by return_id, stored as the movement's request_id
-- (movement ids are an identity column a client cannot choose).

create type public.consignment_status as enum ('active', 'sold', 'returned', 'withdrawn');
create type public.charge_bearer as enum ('consignor', 'shop');
create type public.consignment_item_event_type as enum (
  'received',
  'terms_changed',
  'charge_added',
  'charge_voided',
  'status_changed',
  'stock_returned'
);

comment on type public.consignment_status is
  'active | sold | returned | withdrawn (withdrawn is reserved and never written in Phase 6).';

-- ---------------------------------------------------------------------------
-- Access helpers (D48). RLS policies call them as the caller, so
-- authenticated may execute them; `private` is not exposed over HTTP.
-- ---------------------------------------------------------------------------
create function private.can_view_consignment_money()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission('manage_consignments') or private.has_permission('view_costs');
$$;

comment on function private.can_view_consignment_money() is
  'D48 SALES-ACCESS: consignment money (agreed amounts, charges, item history, liability, settlements) needs manage_consignments or view_costs.';

create function private.can_view_sale_costs()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission('view_costs');
$$;

comment on function private.can_view_sale_costs() is
  'D48 SALES-ACCESS (follows D30): sale cost, yield, Cult Commons, rate and payout snapshots need view_costs.';

-- ---------------------------------------------------------------------------
-- consignors
-- ---------------------------------------------------------------------------
create table public.consignors (
  -- Client-supplied (the create's idempotency key, as for customers).
  id uuid primary key default gen_random_uuid(),
  -- A consignor is often a customer; at most one consignor per customer.
  customer_id uuid null references public.customers (id) on delete restrict,
  display_name text not null,
  email extensions.citext null,
  phone text null,
  -- manage_consignments only: no SELECT grant to authenticated (D48).
  payout_details text null,
  internal_notes text null,
  search_text text generated always as (
    lower(display_name || ' ' || coalesce(email::text, ''))
  ) stored,
  phone_digits text generated always as (
    nullif(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), '')
  ) stored,
  -- Null only for rows created outside the app.
  created_by uuid null references public.staff (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  constraint consignors_display_name_check check (
    pg_catalog.btrim(display_name) <> '' and pg_catalog.char_length(display_name) <= 200
  ),
  constraint consignors_email_check check (
    pg_catalog.char_length(email::text) <= 320 and email::text ~ '^[^@[:space:]]+@[^@[:space:]]+$'
  ),
  constraint consignors_phone_check check (pg_catalog.char_length(phone) <= 40),
  constraint consignors_payout_details_check check (pg_catalog.char_length(payout_details) <= 2000),
  constraint consignors_internal_notes_check check (pg_catalog.char_length(internal_notes) <= 10000)
);
create unique index consignors_customer_id_key on public.consignors (customer_id) where customer_id is not null;
create index consignors_search_text_trgm_idx on public.consignors using gin (search_text extensions.gin_trgm_ops);
create index consignors_phone_digits_trgm_idx on public.consignors using gin (phone_digits extensions.gin_trgm_ops);
create index consignors_created_by_idx on public.consignors (created_by);

comment on table public.consignors is
  'People or businesses whose stock the shop sells on consignment (SPEC §13). Staff read them; manage_consignments writes them. Archived, never deleted.';
comment on column public.consignors.payout_details is
  'Bank or PayNow details: manage_consignments only (no column grant to authenticated; D48).';

create trigger consignors_set_updated_at
  before update on public.consignors
  for each row execute function private.set_updated_at();

-- Trim text and store blanks as NULL; the name is trimmed but never nulled
-- (a blank name fails consignors_display_name_check, which says why).
create function private.consignors_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.display_name := pg_catalog.btrim(new.display_name);
  new.email := nullif(pg_catalog.btrim(new.email::text), '');
  new.phone := nullif(pg_catalog.btrim(new.phone), '');
  new.payout_details := nullif(pg_catalog.btrim(new.payout_details), '');
  new.internal_notes := nullif(pg_catalog.btrim(new.internal_notes), '');
  return new;
end;
$$;

create trigger consignors_normalize
  before insert or update on public.consignors
  for each row execute function private.consignors_normalize();

-- Linking an archived customer is refused; a consignor with an active item
-- is not archived (D47; Phase 6 step 2 replaces this function to add the
-- balance rule).
create function private.consignors_enforce_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, private.current_staff_id());
  end if;
  if new.customer_id is not null
     and (tg_op = 'INSERT' or new.customer_id is distinct from old.customer_id)
     and exists (
       select 1 from public.customers c where c.id = new.customer_id and c.archived_at is not null
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'customer_archived',
      detail = 'That customer is archived; unarchive them before linking a consignor.';
  end if;
  if tg_op = 'UPDATE' and old.archived_at is null and new.archived_at is not null
     and exists (
       select 1 from public.consignment_items i where i.consignor_id = new.id and i.status = 'active'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'consignor_has_open_items',
      detail = 'This consignor still has items with the shop; sell or return them before archiving.';
  end if;
  return new;
end;
$$;

create trigger consignors_enforce_rules
  before insert or update on public.consignors
  for each row execute function private.consignors_enforce_rules();

-- ---------------------------------------------------------------------------
-- consignment_items
-- ---------------------------------------------------------------------------
create table public.consignment_items (
  -- Client-supplied: the intake's idempotency key.
  id uuid primary key,
  -- Always assigned by consignment_items_enforce_rules on insert (D9).
  short_id text not null default '' unique,
  consignor_id uuid not null references public.consignors (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  -- Unique items: the one unit; quantity items: null.
  inventory_unit_id uuid null unique references public.inventory_units (id) on delete restrict,
  quantity integer not null default 1,
  received_at timestamptz not null default now(),
  -- Per unit, owed to the consignor when it is sold; 0 is a known amount
  -- (D24). Consignment money: no column grant to authenticated (D48).
  agreed_amount_owed public.money_amount not null,
  asking_price public.money_amount null,
  currency char(3) not null,
  status public.consignment_status not null default 'active',
  sold_at timestamptz null,
  returned_at timestamptz null,
  return_reason text null,
  agreement_notes text null,
  internal_notes text null,
  -- The intake request's fingerprint (idempotency); never shown.
  request_fingerprint text null,
  created_by uuid null references public.staff (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint consignment_items_short_id_format check (short_id ~ '^C-[0-9]{6}$'),
  constraint consignment_items_quantity_check check (quantity between 1 and 9999),
  constraint consignment_items_agreed_amount_owed_check check (agreed_amount_owed >= 0),
  constraint consignment_items_asking_price_check check (asking_price >= 0),
  constraint consignment_items_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint consignment_items_return_reason_check check (
    return_reason is null or (pg_catalog.btrim(return_reason) <> '' and pg_catalog.char_length(return_reason) <= 500)
  ),
  constraint consignment_items_agreement_notes_check check (pg_catalog.char_length(agreement_notes) <= 2000),
  constraint consignment_items_internal_notes_check check (pg_catalog.char_length(internal_notes) <= 10000),
  constraint consignment_items_unit_quantity_one check (inventory_unit_id is null or quantity = 1),
  constraint consignment_items_returned_has_date check (status <> 'returned' or returned_at is not null),
  constraint consignment_items_sold_has_date check ((status = 'sold') = (sold_at is not null))
);
create index consignment_items_consignor_status_idx on public.consignment_items (consignor_id, status);
create index consignment_items_product_status_idx on public.consignment_items (product_id, status, received_at);
create index consignment_items_created_by_idx on public.consignment_items (created_by);

comment on table public.consignment_items is
  'One consignment (C-######): a unique unit, or a quantity of a consignment-owned product, owed to its consignor at the agreed amount per unit when sold. Created only by create_consignment_item; quantities and liability are derived in reporting.consignment_item_position.';
comment on column public.consignment_items.agreed_amount_owed is
  'Per unit, owed on sale (the consignor payout, a direct cost). Consignment money: manage_consignments or view_costs (D48), never granted to authenticated.';
comment on column public.consignment_items.status is
  'Kept by private.refresh_consignment_item_status: active while stock is with the shop or held on a job, sold when none is left and some is owed, returned when all went back.';

create trigger consignment_items_set_updated_at
  before update on public.consignment_items
  for each row execute function private.set_updated_at();

create function private.consignment_items_enforce_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.agreement_notes := nullif(pg_catalog.btrim(new.agreement_notes), '');
  new.internal_notes := nullif(pg_catalog.btrim(new.internal_notes), '');
  new.return_reason := nullif(pg_catalog.btrim(new.return_reason), '');

  if tg_op = 'INSERT' then
    -- Server-assigned, whatever the caller sent (D9).
    new.short_id := private.next_short_id('C');
    new.created_by := coalesce(new.created_by, private.current_staff_id());
    return new;
  end if;

  if new.short_id is distinct from old.short_id then
    raise exception using
      errcode = 'P0001',
      message = 'consignment_item_short_id_immutable',
      detail = 'A consignment item keeps its ID for life; it is printed on its label.';
  end if;
  if new.consignor_id is distinct from old.consignor_id
     or new.product_id is distinct from old.product_id
     or new.inventory_unit_id is distinct from old.inventory_unit_id
     or new.quantity is distinct from old.quantity
     or new.received_at is distinct from old.received_at
     or new.currency is distinct from old.currency
     or new.request_fingerprint is distinct from old.request_fingerprint then
    raise exception using
      errcode = 'P0001',
      message = 'consignment_item_immutable',
      detail = 'A consignment item keeps its consignor, product, unit, quantity and intake date.';
  end if;
  if new.agreed_amount_owed is distinct from old.agreed_amount_owed and private.change_reason() is null then
    raise exception using
      errcode = 'P0001',
      message = 'reason_required',
      detail = 'Say why the agreed amount is changing.';
  end if;
  return new;
end;
$$;

create trigger consignment_items_enforce_rules
  before insert or update on public.consignment_items
  for each row execute function private.consignment_items_enforce_rules();

-- ---------------------------------------------------------------------------
-- consignment_item_charges (D4)
-- ---------------------------------------------------------------------------
create table public.consignment_item_charges (
  -- Client-supplied: add_consignment_charge's idempotency key.
  id uuid primary key,
  consignment_item_id uuid not null references public.consignment_items (id) on delete restrict,
  description text not null,
  amount public.money_amount not null,
  currency char(3) not null,
  -- D4: no default; the caller always chooses.
  bearer public.charge_bearer not null,
  -- The job that did the work, when there was one.
  work_order_id uuid null references public.work_orders (id) on delete restrict,
  created_by uuid null references public.staff (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  voided_at timestamptz null,
  voided_by uuid null references public.staff (id) on delete restrict,
  void_reason text null,
  constraint consignment_item_charges_description_check check (
    pg_catalog.btrim(description) <> '' and pg_catalog.char_length(description) <= 200
  ),
  constraint consignment_item_charges_amount_check check (amount > 0),
  constraint consignment_item_charges_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint consignment_item_charges_void_reason_check check (
    void_reason is null or (pg_catalog.btrim(void_reason) <> '' and pg_catalog.char_length(void_reason) <= 500)
  ),
  constraint consignment_charges_void_has_reason check ((voided_at is null) = (void_reason is null))
);
create index consignment_item_charges_item_idx on public.consignment_item_charges (consignment_item_id, created_at);
create index consignment_item_charges_work_order_id_idx on public.consignment_item_charges (work_order_id);
create index consignment_item_charges_created_by_idx on public.consignment_item_charges (created_by);
create index consignment_item_charges_voided_by_idx on public.consignment_item_charges (voided_by);

comment on table public.consignment_item_charges is
  'Charges on a consignment item with an explicit bearer (D4): consignor (deducted from what is owed) or shop (added to the direct cost; unique items only, D45). Voided with a reason, never edited or deleted.';

-- Only the void columns change, once, from null; nothing is deleted.
create function private.consignment_item_charges_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.description := pg_catalog.btrim(new.description);
    if new.voided_at is not null or new.voided_by is not null or new.void_reason is not null then
      raise exception using
        errcode = 'P0001',
        message = 'consignment_charges_immutable',
        detail = 'A charge is added first and voided afterwards.';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE'
     or old.voided_at is not null
     or new.voided_at is null
     or new.id is distinct from old.id
     or new.consignment_item_id is distinct from old.consignment_item_id
     or new.description is distinct from old.description
     or new.amount is distinct from old.amount
     or new.currency is distinct from old.currency
     or new.bearer is distinct from old.bearer
     or new.work_order_id is distinct from old.work_order_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = 'P0001',
      message = 'consignment_charges_immutable',
      detail = 'A charge cannot be edited or deleted, only voided once with a reason.';
  end if;
  new.void_reason := nullif(pg_catalog.btrim(new.void_reason), '');
  return new;
end;
$$;

create trigger consignment_charges_immutable
  before insert or update or delete on public.consignment_item_charges
  for each row execute function private.consignment_item_charges_immutable();

-- ---------------------------------------------------------------------------
-- consignment_item_events (append-only, written by triggers only)
-- ---------------------------------------------------------------------------
create table public.consignment_item_events (
  id uuid primary key default gen_random_uuid(),
  consignment_item_id uuid not null references public.consignment_items (id) on delete restrict,
  event_type public.consignment_item_event_type not null,
  -- Carries amounts: readable only with consignment money access (D48).
  payload jsonb not null default '{}'::jsonb,
  reason text null,
  actor_staff_id uuid null references public.staff (id) on delete restrict,
  correlation_id text null,
  created_at timestamptz not null default clock_timestamp(),
  constraint consignment_item_events_payload_object check (pg_catalog.jsonb_typeof(payload) = 'object'),
  constraint consignment_item_events_reason_check check (
    reason is null or (pg_catalog.btrim(reason) <> '' and pg_catalog.char_length(reason) <= 500)
  )
);
create index consignment_item_events_item_idx on public.consignment_item_events (consignment_item_id, created_at desc);
create index consignment_item_events_actor_staff_id_idx on public.consignment_item_events (actor_staff_id);

comment on table public.consignment_item_events is
  'Append-only consignment item history (received, terms_changed, charge_added, charge_voided, status_changed, stock_returned), written by triggers. Payloads carry amounts: manage_consignments or view_costs (D48).';

create function private.consignment_item_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'consignment_history_append_only',
    detail = 'Consignment history cannot be changed or deleted.';
end;
$$;

create trigger consignment_history_append_only
  before update or delete on public.consignment_item_events
  for each row execute function private.consignment_item_events_append_only();

create function private.record_consignment_item_event(
  item_id uuid,
  event_type public.consignment_item_event_type,
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
  insert into public.consignment_item_events (
    consignment_item_id, event_type, payload, reason, actor_staff_id, correlation_id
  )
  values (
    record_consignment_item_event.item_id, record_consignment_item_event.event_type,
    coalesce(record_consignment_item_event.payload, '{}'::jsonb),
    nullif(pg_catalog.btrim(record_consignment_item_event.reason), ''),
    private.current_staff_id(), private.current_correlation_id()
  );
end;
$$;

-- received / terms_changed / status_changed.
create function private.consignment_items_record_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changes jsonb := '{}'::jsonb;
  unit_bike uuid;
begin
  if tg_op = 'INSERT' then
    if new.inventory_unit_id is not null then
      select u.bike_id into unit_bike from public.inventory_units u where u.id = new.inventory_unit_id;
    end if;
    perform private.record_consignment_item_event(
      new.id, 'received',
      pg_catalog.jsonb_build_object(
        'quantity', new.quantity,
        'agreed_amount_owed', new.agreed_amount_owed,
        'asking_price', new.asking_price,
        'product_id', new.product_id,
        'inventory_unit_id', new.inventory_unit_id,
        'bike_id', unit_bike
      ),
      null
    );
    return null;
  end if;

  if new.agreed_amount_owed is distinct from old.agreed_amount_owed then
    changes := changes || pg_catalog.jsonb_build_object(
      'agreed_amount_owed',
      pg_catalog.jsonb_build_object('from', old.agreed_amount_owed, 'to', new.agreed_amount_owed)
    );
  end if;
  if new.asking_price is distinct from old.asking_price then
    changes := changes || pg_catalog.jsonb_build_object(
      'asking_price', pg_catalog.jsonb_build_object('from', old.asking_price, 'to', new.asking_price)
    );
  end if;
  if changes <> '{}'::jsonb then
    perform private.record_consignment_item_event(new.id, 'terms_changed', changes, private.change_reason());
  end if;
  if new.status is distinct from old.status then
    perform private.record_consignment_item_event(
      new.id, 'status_changed',
      pg_catalog.jsonb_build_object('from', old.status, 'to', new.status) || private.event_context(),
      private.change_reason()
    );
  end if;
  return null;
end;
$$;

create trigger consignment_items_record_history
  after insert or update on public.consignment_items
  for each row execute function private.consignment_items_record_history();

-- charge_added / charge_voided.
create function private.consignment_item_charges_record_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.record_consignment_item_event(
      new.consignment_item_id, 'charge_added',
      pg_catalog.jsonb_build_object(
        'charge_id', new.id,
        'description', new.description,
        'amount', new.amount,
        'bearer', new.bearer
      ),
      null
    );
  elsif old.voided_at is null and new.voided_at is not null then
    perform private.record_consignment_item_event(
      new.consignment_item_id, 'charge_voided',
      pg_catalog.jsonb_build_object(
        'charge_id', new.id,
        'description', new.description,
        'amount', new.amount,
        'bearer', new.bearer
      ),
      new.void_reason
    );
  end if;
  return null;
end;
$$;

create trigger consignment_item_charges_record_history
  after insert or update of voided_at on public.consignment_item_charges
  for each row execute function private.consignment_item_charges_record_history();

-- ---------------------------------------------------------------------------
-- inventory_units: the Phase 4 column gets its foreign key; a unit keeps its
-- item and ownership for life; a consigned unit is never written off (D50).
-- ---------------------------------------------------------------------------
alter table public.inventory_units
  add constraint inventory_units_consignment_item_id_fkey
  foreign key (consignment_item_id) references public.consignment_items (id)
  on delete restrict deferrable initially deferred;
alter table public.inventory_units
  add constraint inventory_units_consignment_item_ownership check (
    consignment_item_id is null or ownership_type = 'consignment'
  );
create index inventory_units_consignment_item_id_idx on public.inventory_units (consignment_item_id);

create function private.inventory_units_consignment_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.consignment_item_id is distinct from old.consignment_item_id
     or new.ownership_type is distinct from old.ownership_type then
    raise exception using
      errcode = 'P0001',
      message = 'consignment_item_immutable',
      detail = 'A unit keeps its owner and its consignment record for life.';
  end if;
  if new.ownership_type = 'consignment' and new.status = 'written_off'
     and old.status is distinct from 'written_off' then
    raise exception using
      errcode = 'P0001',
      message = 'consignment_unit_write_off_blocked',
      detail = 'A consigned unit is not the shop''s to write off; return it to the consignor or sell it.';
  end if;
  return new;
end;
$$;

create trigger inventory_units_consignment_rules
  before update on public.inventory_units
  for each row execute function private.inventory_units_consignment_rules();

-- ---------------------------------------------------------------------------
-- inventory_movements: the Phase 4 column gets its foreign key.
-- ---------------------------------------------------------------------------
alter table public.inventory_movements
  add constraint inventory_movements_consignment_item_id_fkey
  foreign key (consignment_item_id) references public.consignment_items (id) on delete restrict;
create index inventory_movements_consignment_item_idx on public.inventory_movements (consignment_item_id, id);

-- ---------------------------------------------------------------------------
-- products: ownership is fixed once used (D45).
-- ---------------------------------------------------------------------------
create function private.products_ownership_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ownership_type is distinct from old.ownership_type
     and (
       exists (select 1 from public.inventory_units u where u.product_id = new.id)
       or exists (select 1 from public.inventory_movements m where m.product_id = new.id)
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'product_ownership_immutable',
      detail = 'A product with stock history keeps its owner; consigned stock lives on its own products.';
  end if;
  return new;
end;
$$;

create trigger products_ownership_rules
  before update of ownership_type on public.products
  for each row execute function private.products_ownership_rules();

-- ---------------------------------------------------------------------------
-- work_order_line_items: consigned job parts (D44). Migration B writes these
-- columns (add_inventory_line) and adds their rules.
-- ---------------------------------------------------------------------------
alter table public.work_order_line_items
  add column consignment_item_id uuid null references public.consignment_items (id) on delete restrict,
  -- Per unit, what the consignor is owed for this part (the agreed amount).
  -- Consignment money: never granted to authenticated (D48).
  add column consignor_payout_snapshot public.money_amount null;
alter table public.work_order_line_items
  add constraint work_order_line_items_consignment_shape check (
    (consignment_item_id is null) = (consignor_payout_snapshot is null)
  ),
  add constraint work_order_line_items_consignment_inventory_only check (
    consignment_item_id is null or line_type = 'inventory'
  ),
  add constraint work_order_line_items_consignor_payout_check check (consignor_payout_snapshot >= 0);
create index work_order_line_items_consignment_item_id_idx on public.work_order_line_items (consignment_item_id);

comment on column public.work_order_line_items.consignment_item_id is
  'The consignment item a consigned part came from (D44); its liability exists while the line is live on a completed job.';
comment on column public.work_order_line_items.consignor_payout_snapshot is
  'Per unit, owed to the consignor for this part (D44). Consignment money: work_order_line_items_staff (view_costs) only.';

-- ---------------------------------------------------------------------------
-- private.record_linked_movement: the twin of private.record_movement that
-- also writes sale_line_id and consignment_item_id (record_movement is
-- unchanged; the purchasing track added its own twin the same way). Same
-- rules: currency from the product, P0002 for a missing product or
-- location, location_inactive unless the movement is a reversal, check and
-- not-null violations re-raised without the row (unit_cost_snapshot is a
-- hidden column).
-- ---------------------------------------------------------------------------
create function private.record_linked_movement(
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
  reversal_of_id bigint,
  sale_line_id uuid,
  consignment_item_id uuid
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
  select p.currency into product_currency from public.products p where p.id = record_linked_movement.product_id;
  if not found then
    raise exception 'product % not found', record_linked_movement.product_id using errcode = 'P0002';
  end if;
  select l.active into location_active from public.locations l where l.id = record_linked_movement.location_id;
  if not found then
    raise exception 'location % not found', record_linked_movement.location_id using errcode = 'P0002';
  end if;
  if not location_active and record_linked_movement.movement_type <> 'reversal' then
    raise exception using
      errcode = 'P0001',
      message = 'location_inactive',
      detail = 'That location is inactive; choose another or reactivate it.';
  end if;

  begin
    insert into public.inventory_movements as m (
      product_id, inventory_unit_id, location_id, quantity_delta, movement_type, reason,
      unit_cost_snapshot, request_id, work_order_id, work_order_line_item_id, reversal_of_id,
      sale_line_id, consignment_item_id, currency
    )
    values (
      record_linked_movement.product_id, record_linked_movement.inventory_unit_id,
      record_linked_movement.location_id, record_linked_movement.quantity_delta,
      record_linked_movement.movement_type, nullif(pg_catalog.btrim(record_linked_movement.reason), ''),
      record_linked_movement.unit_cost_snapshot, record_linked_movement.request_id,
      record_linked_movement.work_order_id, record_linked_movement.work_order_line_item_id,
      record_linked_movement.reversal_of_id, record_linked_movement.sale_line_id,
      record_linked_movement.consignment_item_id, product_currency
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

-- ---------------------------------------------------------------------------
-- D50 CONS-STOCK-MOVES: the movements consigned stock may take. BEFORE
-- INSERT, for every writer; it runs before Phase 4's
-- inventory_movements_enforce_rules (trigger names sort that way).
-- ---------------------------------------------------------------------------
create function private.inventory_movements_consignment_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  prod_ownership public.ownership_type;
  item_product uuid;
  item_unit uuid;
  original public.inventory_movements;
  allowed boolean;
begin
  select p.ownership_type into prod_ownership from public.products p where p.id = new.product_id;
  if not found then
    raise exception 'product % not found', new.product_id using errcode = 'P0002';
  end if;

  if new.movement_type in ('consignment_received', 'consignment_returned') and prod_ownership <> 'consignment' then
    raise exception using
      errcode = 'P0001',
      message = 'movement_invalid',
      detail = 'Only consigned stock is received from or returned to a consignor.';
  end if;

  if prod_ownership = 'consignment' then
    if new.movement_type = 'reversal' then
      select m.* into original from public.inventory_movements m where m.id = new.reversal_of_id;
      allowed := found and original.movement_type in ('transfer', 'job_consumption');
      -- Phase 4's void_line writes the reversal without the item: it takes
      -- the original's, so the reversal stays linked to its consignment.
      if allowed and new.consignment_item_id is null then
        new.consignment_item_id := original.consignment_item_id;
      end if;
    else
      allowed := case new.movement_type
        when 'consignment_received' then new.quantity_delta > 0 and new.consignment_item_id is not null
        when 'consignment_returned' then new.quantity_delta < 0 and new.consignment_item_id is not null
        when 'retail_sale' then
          new.quantity_delta < 0 and new.sale_line_id is not null and new.consignment_item_id is not null
        when 'online_sale' then
          new.quantity_delta < 0 and new.sale_line_id is not null and new.consignment_item_id is not null
        when 'return' then new.quantity_delta > 0 and new.sale_line_id is not null
        when 'job_consumption' then new.quantity_delta < 0 and new.consignment_item_id is not null
        when 'transfer' then true
        else false
      end;
      if not allowed and new.movement_type in (
        'consignment_received', 'consignment_returned', 'retail_sale', 'online_sale', 'return', 'job_consumption'
      ) then
        raise exception using
          errcode = 'P0001',
          message = 'movement_invalid',
          detail = 'A consigned stock movement names its consignment item (and a sale its sale line).';
      end if;
    end if;
    if not allowed then
      raise exception using
        errcode = 'P0001',
        message = 'consignment_stock_adjust_blocked',
        detail = 'Consigned stock is not adjusted, damaged, split or received by hand; return it to the consignor or sell it.';
    end if;
  end if;

  if new.consignment_item_id is not null then
    select i.product_id, i.inventory_unit_id into item_product, item_unit
    from public.consignment_items i where i.id = new.consignment_item_id;
    if not found
       or item_product is distinct from new.product_id
       or (item_unit is not null and item_unit is distinct from new.inventory_unit_id) then
      raise exception using
        errcode = 'P0001',
        message = 'movement_invalid',
        detail = 'That consignment item is for another product or unit.';
    end if;
  end if;
  return new;
end;
$$;

create trigger inventory_movements_consignment_rules
  before insert on public.inventory_movements
  for each row execute function private.inventory_movements_consignment_rules();

-- stock_returned: written for each consignment_returned movement.
create function private.inventory_movements_consignment_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.record_consignment_item_event(
    new.consignment_item_id, 'stock_returned',
    pg_catalog.jsonb_build_object(
      'movement_id', new.id,
      'quantity', -new.quantity_delta,
      'location_id', new.location_id,
      'inventory_unit_id', new.inventory_unit_id
    ),
    new.reason
  );
  return null;
end;
$$;

create trigger inventory_movements_consignment_history
  after insert on public.inventory_movements
  for each row
  when (new.movement_type = 'consignment_returned')
  execute function private.inventory_movements_consignment_history();

-- ---------------------------------------------------------------------------
-- D52: photos on a consignment item (the Phase 1 extension point) are
-- internal only. Every earlier branch is kept.
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
    when 'consignment_item' then
      return exists (
        select 1 from public.consignment_items i where i.id = attachment_entity_exists.entity_id
      );
    else
      return null;
  end case;
end;
$$;

-- The signed agreement, an ID or condition notes show terms and amounts: a
-- business error for record_attachment and set_attachment_visibility; the
-- CHECK is the backstop. Listing photos go on the product or unit (D26).
create function private.attachments_consignment_item_internal_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.entity_type = 'consignment_item' and new.visibility in ('customer', 'public') then
    raise exception using
      errcode = 'P0001',
      message = 'attachment_consignment_internal_only',
      detail = 'Photos on a consignment item stay internal; put listing photos on the product or unit.';
  end if;
  return new;
end;
$$;

create trigger attachments_consignment_item_internal_only
  before insert or update of visibility on public.attachments
  for each row execute function private.attachments_consignment_item_internal_only();

alter table public.attachments
  add constraint attachments_consignment_item_internal_only check (
    not (entity_type = 'consignment_item' and visibility in ('customer', 'public'))
  );

-- ---------------------------------------------------------------------------
-- reporting.consignment_item_position: THE derivation of an item's
-- quantities and liability (D44, D45, D46). Runs as the caller and is
-- granted to no API role: definer functions read it as their owner.
--   job_held_qty  live job lines whose job has no completed_at
--   job_sold_qty  live job lines whose job has a completed_at
--   returned_qty  -Σ quantity_delta of the item's consignment_returned movements
--   remaining_qty quantity - (sold_qty - restocked_qty) - job_held_qty
--                 - job_sold_qty - returned_qty
--   owed_qty      (sold_qty - restocked_qty) + job_sold_qty
--   liability     round(Σ quantity x consignor_payout_snapshot over the
--                 job_sold lines (+ step 2's live, non-restocked sale lines), 2)
-- sold_qty and restocked_qty are 0 here: sales do not exist until Phase 6
-- step 2, which replaces this view's body (same columns, same order).
-- ---------------------------------------------------------------------------
create view reporting.consignment_item_position
with (security_invoker = true)
as
  select i.id as consignment_item_id,
         i.consignor_id,
         i.product_id,
         i.inventory_unit_id,
         i.quantity,
         0::integer as sold_qty,
         0::integer as restocked_qty,
         coalesce(j.held_qty, 0)::integer as job_held_qty,
         coalesce(j.sold_qty, 0)::integer as job_sold_qty,
         coalesce(r.returned_qty, 0)::integer as returned_qty,
         (i.quantity - coalesce(j.held_qty, 0) - coalesce(j.sold_qty, 0) - coalesce(r.returned_qty, 0))::integer
           as remaining_qty,
         coalesce(j.sold_qty, 0)::integer as owed_qty,
         round(coalesce(j.liability, 0), 2)::numeric as liability,
         j.last_sale_at,
         r.last_returned_at,
         coalesce(c.consignor_charges, 0)::numeric as consignor_charges,
         coalesce(c.shop_charges, 0)::numeric as shop_charges
  from public.consignment_items i
  left join lateral (
    select sum(li.quantity) filter (where w.completed_at is null) as held_qty,
           sum(li.quantity) filter (where w.completed_at is not null) as sold_qty,
           sum(li.quantity * li.consignor_payout_snapshot) filter (where w.completed_at is not null) as liability,
           max(w.completed_at) as last_sale_at
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
  'Per consignment item: quantities sold, restocked, on jobs, returned and remaining, the quantity owed and the consignor liability (D44, D46), and live charges by bearer. The only derivation; no API grant. sold_qty and restocked_qty are 0 until Phase 6 step 2 adds sales.';

-- The item's status follows its position (the caller holds the item lock,
-- lock order 6). active while stock is with the shop or held on a job; sold
-- when none is left and some is owed; returned when none is left and none
-- is owed; withdrawn is never changed here. Updates only on a real change,
-- so exactly one status_changed event is written per change (with the
-- caller's change reason and event context).
create function private.refresh_consignment_item_status(item_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  item public.consignment_items;
  pos record;
  target public.consignment_status;
  target_sold_at timestamptz;
  target_returned_at timestamptz;
  target_reason text;
  err_state text;
  err_constraint text;
  err_table text;
  err_schema text;
  err_column text;
  err_message text;
begin
  select i.* into item from public.consignment_items i where i.id = refresh_consignment_item_status.item_id;
  if not found then
    raise exception 'consignment item % not found', refresh_consignment_item_status.item_id using errcode = 'P0002';
  end if;
  select p.remaining_qty, p.job_held_qty, p.owed_qty, p.last_sale_at into pos
  from reporting.consignment_item_position p
  where p.consignment_item_id = item.id;

  if pos.remaining_qty < 0 then
    raise exception using
      errcode = 'P0001',
      message = 'consignment_quantity_negative',
      detail = pg_catalog.format('Consignment item %s would have less than nothing left.', item.short_id);
  end if;
  if item.status = 'withdrawn' then
    return;
  end if;

  if pos.remaining_qty > 0 or pos.job_held_qty > 0 then
    target := 'active';
  elsif pos.owed_qty > 0 then
    target := 'sold';
  else
    target := 'returned';
  end if;
  target_sold_at := case when target = 'sold' then pos.last_sale_at end;
  if target = 'returned' then
    target_returned_at := case when item.status = 'returned' then item.returned_at else pg_catalog.now() end;
    target_reason := case when item.status = 'returned' then item.return_reason else private.change_reason() end;
  end if;

  if target = item.status
     and target_sold_at is not distinct from item.sold_at
     and target_returned_at is not distinct from item.returned_at
     and target_reason is not distinct from item.return_reason then
    return;
  end if;

  begin
    update public.consignment_items i
    set status = target,
        sold_at = target_sold_at,
        returned_at = target_returned_at,
        return_reason = target_reason
    where i.id = item.id;
  exception
    when check_violation or not_null_violation then
      get stacked diagnostics
        err_state = returned_sqlstate, err_constraint = constraint_name, err_table = table_name,
        err_schema = schema_name, err_column = column_name, err_message = message_text;
      perform private.raise_without_row(err_state, err_constraint, err_table, err_schema, err_column, err_message);
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- D45: the single selling price, replaced with the same signature, return
-- type, attributes and grants. A consigned unit sells at its item's asking
-- price (else its own price, else the product default); a consigned
-- quantity product at the asking price of its FIFO-head item (the oldest
-- active item with stock left, by received_at then short_id), else the
-- product default. Shop-owned stock: Phase 4's body unchanged. Label,
-- public page, Shopify and the sale and part defaults all read this.
-- ---------------------------------------------------------------------------
create or replace function private.selling_price(product_id uuid, inventory_unit_id uuid)
returns public.money_amount
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when selling_price.inventory_unit_id is null then
      (select case
                when p.ownership_type = 'consignment' then
                  coalesce(
                    (select i.asking_price
                       from public.consignment_items i
                       join reporting.consignment_item_position pos on pos.consignment_item_id = i.id
                      where i.product_id = p.id and i.status = 'active' and pos.remaining_qty > 0
                      order by i.received_at, i.short_id
                      limit 1),
                    p.default_sale_price
                  )
                else p.default_sale_price
              end
         from public.products p where p.id = selling_price.product_id)
    else
      (select case
                when u.consignment_item_id is not null then
                  coalesce(ci.asking_price, u.sale_price, p.default_sale_price)
                else coalesce(u.sale_price, p.default_sale_price)
              end
         from public.inventory_units u
         join public.products p on p.id = u.product_id
         left join public.consignment_items ci on ci.id = u.consignment_item_id
        where u.id = selling_price.inventory_unit_id and u.product_id = selling_price.product_id)
  end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs. Results are narrow (never a cost): a composite type, not a table
-- row type (a row type would hand over the hidden agreed amount) and not
-- `returns table` (its output names would clash with the arguments).
-- ---------------------------------------------------------------------------
create type public.consignment_item_result as (
  item_id uuid,
  short_id text,
  status public.consignment_status,
  product_id uuid,
  inventory_unit_id uuid
);

create function private.consignment_item_result(item_id uuid)
returns public.consignment_item_result
language sql
volatile
security definer
set search_path = ''
as $$
  select row(i.id, i.short_id, i.status, i.product_id, i.inventory_unit_id)::public.consignment_item_result
  from public.consignment_items i
  where i.id = consignment_item_result.item_id;
$$;

-- create_consignment_item: the intake (manage_consignments). Creates the
-- item (C-######), for a unique item its consigned unit (U-######, through
-- private.register_unit, optionally linked to a shop bike record, D51) and,
-- when no product is given, a new draft consignment-owned product; then one
-- consignment_received movement (+quantity, request_id = item id,
-- unit_cost_snapshot = the agreed amount). Replay-safe by item id: the same
-- request returns the same item, even after the consignor was archived;
-- the same id with other terms is consignment_item_conflict.
create function public.create_consignment_item(
  item_id uuid,
  consignor_id uuid,
  location_id uuid,
  agreed_amount_owed public.money_amount,
  asking_price public.money_amount default null,
  product_id uuid default null,
  product_name text default null,
  brand text default null,
  description text default null,
  category_id uuid default null,
  tracking_type public.tracking_type default 'unique',
  quantity integer default 1,
  serial_number text default null,
  condition text default null,
  received_at timestamptz default null,
  agreement_notes text default null,
  internal_notes text default null,
  new_product_id uuid default null,
  new_unit_id uuid default null,
  bike_id uuid default null
)
returns public.consignment_item_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_permission('manage_consignments');
  fingerprint text;
  existing public.consignment_items;
  consignor_archived timestamptz;
  loc_active boolean;
  prod public.products;
  target_product uuid;
  bike public.bikes;
  created_unit public.inventory_units;
  item_currency char(3);
  err_state text;
  err_constraint text;
  err_table text;
  err_schema text;
  err_column text;
  err_message text;
begin
  -- (a) Shape.
  if create_consignment_item.item_id is null or create_consignment_item.consignor_id is null
     or create_consignment_item.location_id is null or create_consignment_item.agreed_amount_owed is null
     or create_consignment_item.tracking_type is null or create_consignment_item.quantity is null then
    raise exception 'item_id, consignor_id, location_id, agreed_amount_owed, tracking_type and quantity are required'
      using errcode = '22004';
  end if;
  if create_consignment_item.quantity < 1 or create_consignment_item.quantity > 9999 then
    raise exception using
      errcode = 'P0001',
      message = 'consignment_quantity_invalid',
      detail = 'Take in between 1 and 9,999.';
  end if;
  if create_consignment_item.tracking_type = 'unique' and create_consignment_item.quantity <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'consignment_unique_quantity_one',
      detail = 'A unique item is taken in one at a time.';
  end if;
  if create_consignment_item.received_at > pg_catalog.now() + interval '5 minutes' then
    raise exception using
      errcode = 'P0001',
      message = 'consignment_received_in_future',
      detail = 'The intake date cannot be in the future.';
  end if;
  if create_consignment_item.bike_id is not null and create_consignment_item.tracking_type <> 'unique' then
    raise exception using
      errcode = 'P0001',
      message = 'consignment_bike_requires_unique',
      detail = 'Only a unique item can be a bike.';
  end if;

  -- (b) Idempotency: this request's own lock (lock order 0), then the replay
  -- by item id. No state check runs before it. The money casts make "500"
  -- and "500.00" the same request.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bicii.consignment_item:' || create_consignment_item.item_id::text, 0)
  );
  fingerprint := pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'consignor', create_consignment_item.consignor_id,
      'location', create_consignment_item.location_id,
      'product', create_consignment_item.product_id,
      'name', pg_catalog.lower(pg_catalog.btrim(create_consignment_item.product_name)),
      'tracking', create_consignment_item.tracking_type,
      'quantity', create_consignment_item.quantity,
      'agreed', create_consignment_item.agreed_amount_owed::text,
      'asking', create_consignment_item.asking_price::text,
      'bike', create_consignment_item.bike_id
    )::text
  );
  select i.* into existing from public.consignment_items i where i.id = create_consignment_item.item_id;
  if found then
    if existing.request_fingerprint is not distinct from fingerprint then
      return private.consignment_item_result(existing.id);
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'consignment_item_conflict',
      detail = 'That consignment item id is already used for another intake.';
  end if;

  -- (c) State. The consignor FOR SHARE (lock order 0b): archiving waits.
  select c.archived_at into consignor_archived
  from public.consignors c where c.id = create_consignment_item.consignor_id
  for share;
  if not found then
    raise exception 'consignor % not found', create_consignment_item.consignor_id using errcode = 'P0002';
  end if;
  if consignor_archived is not null then
    raise exception using
      errcode = 'P0001',
      message = 'consignor_archived',
      detail = 'That consignor is archived; unarchive them first.';
  end if;
  select l.active into loc_active from public.locations l where l.id = create_consignment_item.location_id;
  if not found then
    raise exception 'location % not found', create_consignment_item.location_id using errcode = 'P0002';
  end if;
  if not loc_active then
    raise exception using
      errcode = 'P0001',
      message = 'location_inactive',
      detail = 'That location is inactive; choose another or reactivate it.';
  end if;
  if create_consignment_item.product_id is null
     and nullif(pg_catalog.btrim(coalesce(create_consignment_item.product_name, '')), '') is null then
    raise exception using
      errcode = 'P0001',
      message = 'consignment_product_required',
      detail = 'Choose a consignment product or name a new one.';
  end if;

  -- (d) Locks and writes. The stock lock (lock order 3) first, then the
  -- product checks under it.
  target_product := coalesce(
    create_consignment_item.product_id, create_consignment_item.new_product_id, gen_random_uuid()
  );
  perform private.lock_stock(target_product);

  if create_consignment_item.product_id is not null then
    select p.* into prod from public.products p where p.id = create_consignment_item.product_id;
    if not found then
      raise exception 'product % not found', create_consignment_item.product_id using errcode = 'P0002';
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
    if prod.ownership_type <> 'consignment' then
      raise exception using
        errcode = 'P0001',
        message = 'product_not_consignment',
        detail = 'Consigned stock goes on a consignment product, never on shop stock.';
    end if;
    if prod.tracking_type <> create_consignment_item.tracking_type then
      raise exception using
        errcode = 'P0001',
        message = 'consignment_tracking_mismatch',
        detail = 'That product is tracked differently (unique or by quantity).';
    end if;
  else
    begin
      insert into public.products as p (
        id, name, brand, description, category_id, tracking_type, ownership_type, publication_status,
        default_sale_price, currency
      )
      values (
        target_product, create_consignment_item.product_name, create_consignment_item.brand,
        create_consignment_item.description, create_consignment_item.category_id,
        create_consignment_item.tracking_type, 'consignment', 'draft',
        create_consignment_item.asking_price, private.shop_currency()
      )
      returning p.* into prod;
    exception
      when check_violation or not_null_violation then
        get stacked diagnostics
          err_state = returned_sqlstate, err_constraint = constraint_name, err_table = table_name,
          err_schema = schema_name, err_column = column_name, err_message = message_text;
        perform private.raise_without_row(err_state, err_constraint, err_table, err_schema, err_column, err_message);
    end;
  end if;
  item_currency := prod.currency;

  if create_consignment_item.bike_id is not null then
    -- Lock order 4 and Phase 4's stock-bike rules (D51): a bike a customer
    -- owns is transferred to the shop first (D29).
    select b.* into bike from public.bikes b where b.id = create_consignment_item.bike_id for update;
    if not found then
      raise exception 'bike % not found', create_consignment_item.bike_id using errcode = 'P0002';
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
        detail = 'That bike belongs to a customer; transfer it to the shop with a reason before consigning it.';
    end if;
    if bike.inventory_unit_id is not null then
      raise exception using
        errcode = 'P0001',
        message = 'bike_already_linked',
        detail = 'That bike record is already a unit; register a new bike record.';
    end if;
  end if;

  if create_consignment_item.tracking_type = 'unique' then
    created_unit := private.register_unit(
      coalesce(create_consignment_item.new_unit_id, gen_random_uuid()), prod.id,
      create_consignment_item.location_id, 'consignment', create_consignment_item.serial_number,
      create_consignment_item.condition, create_consignment_item.asking_price,
      create_consignment_item.agreed_amount_owed, create_consignment_item.bike_id,
      create_consignment_item.item_id
    );
  end if;

  begin
    insert into public.consignment_items (
      id, consignor_id, product_id, inventory_unit_id, quantity, received_at, agreed_amount_owed,
      asking_price, currency, agreement_notes, internal_notes, request_fingerprint, created_by
    )
    values (
      create_consignment_item.item_id, create_consignment_item.consignor_id, prod.id, created_unit.id,
      create_consignment_item.quantity, coalesce(create_consignment_item.received_at, pg_catalog.now()),
      create_consignment_item.agreed_amount_owed, create_consignment_item.asking_price, item_currency,
      create_consignment_item.agreement_notes, create_consignment_item.internal_notes, fingerprint, actor
    );
  exception
    when check_violation or not_null_violation then
      get stacked diagnostics
        err_state = returned_sqlstate, err_constraint = constraint_name, err_table = table_name,
        err_schema = schema_name, err_column = column_name, err_message = message_text;
      perform private.raise_without_row(err_state, err_constraint, err_table, err_schema, err_column, err_message);
  end;

  perform private.record_linked_movement(
    prod.id, created_unit.id, create_consignment_item.location_id, create_consignment_item.quantity,
    'consignment_received', null, create_consignment_item.agreed_amount_owed, create_consignment_item.item_id,
    null, null, null, null, create_consignment_item.item_id
  );

  -- A new available unit on a sold unique product restores it to public
  -- (D26's system restore, as create_unique_unit does); products last.
  if create_consignment_item.product_id is not null and prod.tracking_type = 'unique' then
    perform private.refresh_unique_publication(prod.id);
  end if;
  return private.consignment_item_result(create_consignment_item.item_id);
end;
$$;

comment on function public.create_consignment_item(
  uuid, uuid, uuid, public.money_amount, public.money_amount, uuid, text, text, text, uuid,
  public.tracking_type, integer, text, text, timestamptz, text, text, uuid, uuid, uuid
) is 'manage_consignments: take in a consigned unique item (its unit, optionally a shop bike record) or a quantity, on a consignment product (a new draft one when none is given), with its consignment_received movement; replay-safe by item id.';

-- The item's product and unit (both immutable), read without a lock, then
-- the stock (3), the unit (5) and the item (6) locked in order and the item
-- re-read. Shared by the item RPCs below.
create function private.lock_consignment_item(item_id uuid)
returns public.consignment_items
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  item_product uuid;
  item_unit uuid;
  result public.consignment_items;
begin
  select i.product_id, i.inventory_unit_id into item_product, item_unit
  from public.consignment_items i where i.id = lock_consignment_item.item_id;
  if not found then
    raise exception 'consignment item % not found', lock_consignment_item.item_id using errcode = 'P0002';
  end if;
  perform private.lock_stock(item_product);
  if item_unit is not null then
    perform 1 from public.inventory_units u where u.id = item_unit for update;
  end if;
  select i.* into result from public.consignment_items i where i.id = lock_consignment_item.item_id for update;
  return result;
end;
$$;

-- update_consignment_terms (manage_consignments): change the agreed amount
-- (with a reason) and/or the asking price of an active item; null leaves a
-- value as it is and identical values change nothing. A unique item's unit
-- follows (direct cost = agreed, sale price = asking). Lines already on a
-- job keep their snapshots.
create function public.update_consignment_terms(
  item_id uuid,
  agreed_amount_owed public.money_amount default null,
  asking_price public.money_amount default null,
  reason text default null
)
returns public.consignment_item_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  cleaned text := nullif(pg_catalog.btrim(coalesce(update_consignment_terms.reason, '')), '');
  item public.consignment_items;
  new_agreed public.money_amount;
  new_asking public.money_amount;
  err_state text;
  err_constraint text;
  err_table text;
  err_schema text;
  err_column text;
  err_message text;
begin
  perform private.require_permission('manage_consignments');
  if update_consignment_terms.item_id is null then
    raise exception 'item_id is required' using errcode = '22004';
  end if;
  if cleaned is not null and pg_catalog.char_length(cleaned) > 500 then
    raise exception using
      errcode = 'P0001',
      message = 'reason_too_long',
      detail = 'Keep the reason under 500 characters.';
  end if;

  item := private.lock_consignment_item(update_consignment_terms.item_id);
  new_agreed := coalesce(update_consignment_terms.agreed_amount_owed, item.agreed_amount_owed);
  new_asking := coalesce(update_consignment_terms.asking_price, item.asking_price);
  if new_agreed is not distinct from item.agreed_amount_owed and new_asking is not distinct from item.asking_price then
    return private.consignment_item_result(item.id);
  end if;
  if item.status <> 'active' then
    raise exception using
      errcode = 'P0001',
      message = 'consignment_item_not_active',
      detail = 'That item is no longer with the shop.';
  end if;
  if new_agreed is distinct from item.agreed_amount_owed and cleaned is null then
    raise exception using
      errcode = 'P0001',
      message = 'reason_required',
      detail = 'Say why the agreed amount is changing.';
  end if;

  perform private.set_change_reason(cleaned);
  begin
    update public.consignment_items i
    set agreed_amount_owed = new_agreed, asking_price = new_asking
    where i.id = item.id;
    if item.inventory_unit_id is not null then
      update public.inventory_units u
      set direct_cost = new_agreed, sale_price = new_asking
      where u.id = item.inventory_unit_id;
    end if;
  exception
    when check_violation or not_null_violation then
      get stacked diagnostics
        err_state = returned_sqlstate, err_constraint = constraint_name, err_table = table_name,
        err_schema = schema_name, err_column = column_name, err_message = message_text;
      perform private.raise_without_row(err_state, err_constraint, err_table, err_schema, err_column, err_message);
  end;
  perform private.set_change_reason(null);
  return private.consignment_item_result(item.id);
end;
$$;

comment on function public.update_consignment_terms(uuid, public.money_amount, public.money_amount, text) is
  'manage_consignments: change an active item''s agreed amount (with a reason) or asking price; a unique item''s unit follows; no-op when nothing changes.';

-- add_consignment_charge (manage_consignments; D4, D45). Replay-safe by
-- charge id.
create function public.add_consignment_charge(
  charge_id uuid,
  item_id uuid,
  description text,
  amount public.money_amount,
  bearer public.charge_bearer,
  work_order_id uuid default null
)
returns public.consignment_item_charges
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_permission('manage_consignments');
  cleaned text := pg_catalog.btrim(add_consignment_charge.description);
  item public.consignment_items;
  unit_status public.unit_status;
  existing public.consignment_item_charges;
  result public.consignment_item_charges;
  err_state text;
  err_constraint text;
  err_table text;
  err_schema text;
  err_column text;
  err_message text;
begin
  if add_consignment_charge.charge_id is null or add_consignment_charge.item_id is null
     or add_consignment_charge.description is null or add_consignment_charge.amount is null then
    raise exception 'charge_id, item_id, description and amount are required' using errcode = '22004';
  end if;
  if add_consignment_charge.bearer is null then
    raise exception using
      errcode = 'P0001',
      message = 'charge_bearer_required',
      detail = 'Choose who bears the charge: the consignor or the shop.';
  end if;

  item := private.lock_consignment_item(add_consignment_charge.item_id);

  select ch.* into existing from public.consignment_item_charges ch where ch.id = add_consignment_charge.charge_id;
  if found then
    if existing.consignment_item_id = item.id and existing.description = cleaned
       and existing.amount = add_consignment_charge.amount and existing.bearer = add_consignment_charge.bearer
       and existing.work_order_id is not distinct from add_consignment_charge.work_order_id then
      return existing;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'consignment_charge_conflict',
      detail = 'That charge id is already used for another charge.';
  end if;

  if add_consignment_charge.work_order_id is not null and not exists (
    select 1 from public.work_orders w where w.id = add_consignment_charge.work_order_id
  ) then
    raise exception 'work order % not found', add_consignment_charge.work_order_id using errcode = 'P0002';
  end if;

  if add_consignment_charge.bearer = 'shop' then
    if item.status <> 'active' then
      raise exception using
        errcode = 'P0001',
        message = 'consignment_item_not_active',
        detail = 'That item is no longer with the shop.';
    end if;
    if item.inventory_unit_id is null then
      raise exception using
        errcode = 'P0001',
        message = 'shop_charge_unique_only',
        detail = 'A shop-borne charge goes on a unique item only.';
    end if;
    select u.status into unit_status from public.inventory_units u where u.id = item.inventory_unit_id;
    if unit_status <> 'available' then
      raise exception using
        errcode = 'P0001',
        message = 'shop_charge_unit_not_available',
        detail = 'That unit''s cost is already fixed on a job or a sale; add the charge while it is available.';
    end if;
  end if;

  begin
    insert into public.consignment_item_charges as ch (
      id, consignment_item_id, description, amount, currency, bearer, work_order_id, created_by
    )
    values (
      add_consignment_charge.charge_id, item.id, cleaned, add_consignment_charge.amount, item.currency,
      add_consignment_charge.bearer, add_consignment_charge.work_order_id, actor
    )
    returning ch.* into result;
  exception
    when check_violation or not_null_violation then
      get stacked diagnostics
        err_state = returned_sqlstate, err_constraint = constraint_name, err_table = table_name,
        err_schema = schema_name, err_column = column_name, err_message = message_text;
      perform private.raise_without_row(err_state, err_constraint, err_table, err_schema, err_column, err_message);
  end;
  return result;
end;
$$;

comment on function public.add_consignment_charge(
  uuid, uuid, text, public.money_amount, public.charge_bearer, uuid
) is 'manage_consignments: add a charge with an explicit bearer (D4); shop-borne only on an active unique item whose unit is available (D45); replay-safe by charge id.';

-- void_consignment_charge (manage_consignments): void a charge with a
-- reason; a voided charge is returned unchanged.
create function public.void_consignment_charge(charge_id uuid, reason text)
returns public.consignment_item_charges
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_permission('manage_consignments');
  cleaned text := nullif(pg_catalog.btrim(coalesce(void_consignment_charge.reason, '')), '');
  charge_item uuid;
  item public.consignment_items;
  unit_status public.unit_status;
  target public.consignment_item_charges;
  result public.consignment_item_charges;
  err_state text;
  err_constraint text;
  err_table text;
  err_schema text;
  err_column text;
  err_message text;
begin
  if void_consignment_charge.charge_id is null then
    raise exception 'charge_id is required' using errcode = '22004';
  end if;
  if cleaned is null then
    raise exception using
      errcode = 'P0001',
      message = 'reason_required',
      detail = 'Say why the charge is being voided.';
  end if;
  if pg_catalog.char_length(cleaned) > 500 then
    raise exception using
      errcode = 'P0001',
      message = 'reason_too_long',
      detail = 'Keep the reason under 500 characters.';
  end if;

  select ch.consignment_item_id into charge_item
  from public.consignment_item_charges ch where ch.id = void_consignment_charge.charge_id;
  if not found then
    raise exception 'charge % not found', void_consignment_charge.charge_id using errcode = 'P0002';
  end if;
  item := private.lock_consignment_item(charge_item);
  select ch.* into target from public.consignment_item_charges ch
  where ch.id = void_consignment_charge.charge_id
  for update;

  if target.voided_at is not null then
    return target;
  end if;
  if target.bearer = 'shop' then
    if item.status <> 'active' then
      raise exception using
        errcode = 'P0001',
        message = 'consignment_item_not_active',
        detail = 'That item is no longer with the shop.';
    end if;
    select u.status into unit_status from public.inventory_units u where u.id = item.inventory_unit_id;
    if unit_status is distinct from 'available' then
      raise exception using
        errcode = 'P0001',
        message = 'shop_charge_unit_not_available',
        detail = 'That unit''s cost is already fixed on a job or a sale; return it to stock first.';
    end if;
  end if;

  begin
    update public.consignment_item_charges ch
    set voided_at = pg_catalog.clock_timestamp(), voided_by = actor, void_reason = cleaned
    where ch.id = target.id
    returning ch.* into result;
  exception
    when check_violation or not_null_violation then
      get stacked diagnostics
        err_state = returned_sqlstate, err_constraint = constraint_name, err_table = table_name,
        err_schema = schema_name, err_column = column_name, err_message = message_text;
      perform private.raise_without_row(err_state, err_constraint, err_table, err_schema, err_column, err_message);
  end;
  return result;
end;
$$;

comment on function public.void_consignment_charge(uuid, text) is
  'manage_consignments: void a charge with a reason (kept, never deleted); a shop-borne charge only while its unit is available; replay-safe.';

-- return_consignment_item (manage_consignments): give stock back to the
-- consignor with a reason. return_id is the client's per-call key, stored
-- as the movement's request_id. A unique item's unit must be available (a
-- unit held on a job is returned by voiding its line first); it becomes
-- returned_to_consignor, keeps its bike link (D51) and its product is
-- archived when no unit is left in stock. A quantity item returns
-- `quantity` (default: all that remains) from one location.
create function public.return_consignment_item(
  return_id uuid,
  item_id uuid,
  reason text,
  quantity integer default null,
  location_id uuid default null
)
returns public.consignment_item_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  cleaned text := nullif(pg_catalog.btrim(coalesce(return_consignment_item.reason, '')), '');
  item public.consignment_items;
  unit public.inventory_units;
  existing public.inventory_movements;
  remaining integer;
  qty integer;
  from_location uuid;
  prod_status public.publication_status;
  err_state text;
  err_constraint text;
  err_table text;
  err_schema text;
  err_column text;
  err_message text;
begin
  perform private.require_permission('manage_consignments');
  if return_consignment_item.return_id is null or return_consignment_item.item_id is null then
    raise exception 'return_id and item_id are required' using errcode = '22004';
  end if;
  if cleaned is null then
    raise exception using
      errcode = 'P0001',
      message = 'reason_required',
      detail = 'Say why the item is going back to the consignor.';
  end if;
  if pg_catalog.char_length(cleaned) > 500 then
    raise exception using
      errcode = 'P0001',
      message = 'reason_too_long',
      detail = 'Keep the reason under 500 characters.';
  end if;

  -- Locks (3, 5, 6) before the replay check.
  item := private.lock_consignment_item(return_consignment_item.item_id);
  if item.inventory_unit_id is not null then
    select u.* into unit from public.inventory_units u where u.id = item.inventory_unit_id;
  end if;

  select m.* into existing from public.inventory_movements m
  where m.request_id = return_consignment_item.return_id
  order by m.id
  limit 1;
  if found then
    if existing.movement_type = 'consignment_returned' and existing.consignment_item_id = item.id
       and (return_consignment_item.quantity is null or -existing.quantity_delta = return_consignment_item.quantity)
       and (return_consignment_item.location_id is null or existing.location_id = return_consignment_item.location_id) then
      return private.consignment_item_result(item.id);
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'consignment_return_conflict',
      detail = 'That return id was already used for another stock change.';
  end if;

  if item.status <> 'active' then
    raise exception using
      errcode = 'P0001',
      message = 'consignment_item_not_active',
      detail = 'That item is no longer with the shop.';
  end if;

  if unit.id is not null then
    if return_consignment_item.quantity is not null and return_consignment_item.quantity <> 1 then
      raise exception using
        errcode = 'P0001',
        message = 'consignment_return_quantity_invalid',
        detail = 'A unique item goes back one at a time.';
    end if;
    if unit.status <> 'available' or unit.archived_at is not null then
      raise exception using
        errcode = 'P0001',
        message = 'unit_not_available',
        detail = 'That unit is not in stock; void it from its job first.';
    end if;
    if return_consignment_item.location_id is not null and return_consignment_item.location_id <> unit.location_id then
      raise exception using
        errcode = 'P0001',
        message = 'unit_location_mismatch',
        detail = 'That unit is somewhere else.';
    end if;
    qty := 1;
    from_location := unit.location_id;
  else
    select p.remaining_qty into remaining
    from reporting.consignment_item_position p where p.consignment_item_id = item.id;
    qty := coalesce(return_consignment_item.quantity, remaining);
    if qty < 1 or qty > remaining then
      raise exception using
        errcode = 'P0001',
        message = 'consignment_return_quantity_invalid',
        detail = pg_catalog.format('Return between 1 and %s.', remaining);
    end if;
    if return_consignment_item.location_id is null then
      raise exception 'location_id is required to return a quantity' using errcode = '22004';
    end if;
    from_location := return_consignment_item.location_id;
    if not exists (select 1 from public.locations l where l.id = from_location) then
      raise exception 'location % not found', from_location using errcode = 'P0002';
    end if;
    if private.stock_on_hand(item.product_id, from_location) < qty then
      raise exception using
        errcode = 'P0001',
        message = 'insufficient_stock',
        detail = 'There is not that much of this item at that location.';
    end if;
  end if;

  perform private.set_change_reason(cleaned);
  if unit.id is not null then
    perform private.set_unit_status(unit.id, 'returned_to_consignor');
  end if;
  -- The movement trigger writes stock_returned with this reason.
  perform private.record_linked_movement(
    item.product_id, unit.id, from_location, -qty, 'consignment_returned', cleaned, item.agreed_amount_owed,
    return_consignment_item.return_id, null, null, null, null, item.id
  );
  perform private.refresh_consignment_item_status(item.id);

  -- Last (lock order 7): a unique product with no unit left in stock is
  -- archived (an allowed D26 transition), with the reason.
  if unit.id is not null then
    select p.publication_status into prod_status
    from public.products p where p.id = item.product_id
    for update;
    if prod_status in ('draft', 'internal_only', 'public') and not exists (
      select 1 from public.inventory_units u
      where u.product_id = item.product_id and u.status in ('available', 'reserved', 'held_for_customer')
    ) then
      begin
        update public.products p set publication_status = 'archived' where p.id = item.product_id;
      exception
        when check_violation or not_null_violation then
          get stacked diagnostics
            err_state = returned_sqlstate, err_constraint = constraint_name, err_table = table_name,
            err_schema = schema_name, err_column = column_name, err_message = message_text;
          perform private.raise_without_row(err_state, err_constraint, err_table, err_schema, err_column, err_message);
      end;
    end if;
  end if;
  perform private.set_change_reason(null);
  return private.consignment_item_result(item.id);
end;
$$;

comment on function public.return_consignment_item(uuid, uuid, text, integer, uuid) is
  'manage_consignments: give consigned stock back to its consignor with a reason (a consignment_returned movement; a unit becomes returned_to_consignor); replay-safe by return_id.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function
  private.can_view_consignment_money(),
  private.can_view_sale_costs(),
  private.consignors_normalize(),
  private.consignors_enforce_rules(),
  private.consignment_items_enforce_rules(),
  private.consignment_item_charges_immutable(),
  private.consignment_item_events_append_only(),
  private.record_consignment_item_event(uuid, public.consignment_item_event_type, jsonb, text),
  private.consignment_items_record_history(),
  private.consignment_item_charges_record_history(),
  private.inventory_units_consignment_rules(),
  private.products_ownership_rules(),
  private.record_linked_movement(
    uuid, uuid, uuid, integer, public.movement_type, text, public.money_amount, uuid, uuid, uuid, bigint, uuid, uuid
  ),
  private.inventory_movements_consignment_rules(),
  private.inventory_movements_consignment_history(),
  private.attachment_entity_exists(public.attachment_entity, uuid),
  private.attachments_consignment_item_internal_only(),
  private.refresh_consignment_item_status(uuid),
  private.selling_price(uuid, uuid),
  private.consignment_item_result(uuid),
  private.lock_consignment_item(uuid)
from public, anon, authenticated, service_role;

-- RLS policies call these as the caller (D48).
grant execute on function
  private.can_view_consignment_money(),
  private.can_view_sale_costs()
to authenticated;

-- The single selling price keeps Phase 4's grants: the cost and price views
-- (authenticated) and reporting.public_items (anon) call it as the caller.
grant execute on function private.selling_price(uuid, uuid) to anon, authenticated;

revoke all on function
  public.create_consignment_item(
    uuid, uuid, uuid, public.money_amount, public.money_amount, uuid, text, text, text, uuid,
    public.tracking_type, integer, text, text, timestamptz, text, text, uuid, uuid, uuid
  ),
  public.update_consignment_terms(uuid, public.money_amount, public.money_amount, text),
  public.add_consignment_charge(uuid, uuid, text, public.money_amount, public.charge_bearer, uuid),
  public.void_consignment_charge(uuid, text),
  public.return_consignment_item(uuid, uuid, text, integer, uuid)
from public, anon, authenticated, service_role;

grant execute on function
  public.create_consignment_item(
    uuid, uuid, uuid, public.money_amount, public.money_amount, uuid, text, text, text, uuid,
    public.tracking_type, integer, text, text, timestamptz, text, text, uuid, uuid, uuid
  ),
  public.update_consignment_terms(uuid, public.money_amount, public.money_amount, text),
  public.add_consignment_charge(uuid, uuid, text, public.money_amount, public.charge_bearer, uuid),
  public.void_consignment_charge(uuid, text),
  public.return_consignment_item(uuid, uuid, text, integer, uuid)
to authenticated;

alter table public.consignors enable row level security;
alter table public.consignment_items enable row level security;
alter table public.consignment_item_charges enable row level security;
alter table public.consignment_item_events enable row level security;

revoke all on table public.consignors from public, anon, authenticated, service_role;
revoke all on table public.consignment_items from public, anon, authenticated, service_role;
revoke all on table public.consignment_item_charges from public, anon, authenticated, service_role;
revoke all on table public.consignment_item_events from public, anon, authenticated, service_role;
revoke all on table reporting.consignment_item_position from public, anon, authenticated, service_role;

-- Every column except payout_details (manage_consignments only, D48). A
-- `select *` therefore fails; callers list their columns.
grant select (
  id, customer_id, display_name, email, phone, internal_notes, search_text, phone_digits, created_by,
  created_at, updated_at, archived_at
) on table public.consignors to authenticated;
grant insert (id, customer_id, display_name, email, phone, payout_details, internal_notes)
  on table public.consignors to authenticated;
grant update (customer_id, display_name, email, phone, payout_details, internal_notes, archived_at)
  on table public.consignors to authenticated;
grant select on table public.consignors to service_role;

-- Every column except the agreed amount (consignment money) and the
-- request fingerprint. Items are created and changed only by the RPCs,
-- except their notes.
grant select (
  id, short_id, consignor_id, product_id, inventory_unit_id, quantity, received_at, asking_price, currency,
  status, sold_at, returned_at, return_reason, agreement_notes, internal_notes, created_by, created_at,
  updated_at
) on table public.consignment_items to authenticated;
grant update (agreement_notes, internal_notes) on table public.consignment_items to authenticated;
grant select on table public.consignment_items to service_role;

-- Row-gated by consignment money access (D48); written only by the RPCs
-- and triggers.
grant select on table public.consignment_item_charges to authenticated, service_role;
grant select on table public.consignment_item_events to authenticated, service_role;

-- A part's consignment item is visible to staff; its payout never is
-- (work_order_line_items_staff, view_costs).
grant select (consignment_item_id) on table public.work_order_line_items to authenticated;

create policy consignors_select_staff on public.consignors
  for select to authenticated
  using ((select private.is_staff()));

create policy consignors_insert_manage_consignments on public.consignors
  for insert to authenticated
  with check ((select private.has_permission('manage_consignments')));

create policy consignors_update_manage_consignments on public.consignors
  for update to authenticated
  using ((select private.has_permission('manage_consignments')))
  with check ((select private.has_permission('manage_consignments')));

create policy consignment_items_select_staff on public.consignment_items
  for select to authenticated
  using ((select private.is_staff()));

create policy consignment_items_update_manage_consignments on public.consignment_items
  for update to authenticated
  using ((select private.has_permission('manage_consignments')))
  with check ((select private.has_permission('manage_consignments')));

create policy consignment_item_charges_select_money on public.consignment_item_charges
  for select to authenticated
  using ((select private.is_staff()) and (select private.can_view_consignment_money()));

create policy consignment_item_events_select_money on public.consignment_item_events
  for select to authenticated
  using ((select private.is_staff()) and (select private.can_view_consignment_money()));
