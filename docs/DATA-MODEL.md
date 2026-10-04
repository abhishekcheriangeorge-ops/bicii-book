# BICII Admin — Data model

Companion to [PLAN.md](./PLAN.md) and [ADR-001](./ADR-001-architecture.md). The
authoritative requirements are in [SPEC.md](./SPEC.md); this document turns
them into tables, constraints, functions and views. Where this document adds
structure the spec did not prescribe (join tables, idempotency keys, generated
columns) that is implementation mechanics the agent is free to refine. Where a
choice would change business semantics it is listed under **Open decisions** in
PLAN.md and must not be changed silently.

Conventions used throughout:

- Every table: `id uuid primary key default gen_random_uuid()`,
  `created_at timestamptz not null default now()`, and `updated_at` maintained
  by a shared trigger where the row is mutable. `updated_at` is not an audit
  log; auditable facts get their own event or ledger row.
- Money: domain `money_amount` = `numeric(12,2)`. Rates: `numeric(5,4)`.
  Quantities on stock are `integer`; quantities on line items are
  `numeric(10,2)` with a check that inventory-backed lines are whole numbers.
- Every money-bearing row carries `currency char(3) not null default 'SGD'`.
- Timestamps are `timestamptz`. Display defaults to `Asia/Singapore`.
- Soft delete is `archived_at timestamptz null`; archived rows stay readable to
  historical references and are hidden from pickers.
- Human IDs come from dedicated sequences, are never reused, and live in a
  `short_id` or `*_number` column with a unique index:
  `B-000123` bikes, `J-000456` work orders, `P-000789` products, `U-000012`
  inventory units, `PO-000034` purchase orders, `C-000056` consignment items.
- Enums are Postgres `enum` types. Adding a value is a migration; that is the
  intent, because statuses are business facts.
- Schemas: `public` holds tables, RPCs and views (exposed through PostgREST);
  `private` holds security-definer helpers that must not be callable through
  the API; `reporting` holds views only.

## 1. Identity and authorization

```
staff
  id uuid PK
  auth_user_id uuid not null unique  -> auth.users(id)
  display_name text not null
  email citext not null unique
  role staff_role not null            -- enum: admin | staff
  active boolean not null default true
  created_at, updated_at

staff_permissions
  staff_id uuid -> staff(id)
  permission permission_key not null  -- enum below
  granted_by uuid -> staff(id)
  granted_at timestamptz
  PK (staff_id, permission)

permission_key enum:
  view_costs | manage_inventory | adjust_stock | manage_consignments |
  manage_purchasing | manage_staff | view_financial_reports
```

Rules:

- `role = admin` implies every permission. `staff` has only the rows granted.
- An update can never leave the shop without an active admin (trigger
  `staff_keep_an_active_admin`, serialised with an advisory lock).
- "Staff" in any policy means `staff.active = true` for the calling
  `auth.uid()`. Deactivating a staff member revokes everything at once.
- Helpers in `private`, all `security definer`, `stable`, with
  `search_path = ''`:
  - `private.current_staff_id() returns uuid`
  - `private.is_staff() returns boolean`
  - `private.is_admin() returns boolean`
  - `private.has_permission(permission_key) returns boolean`
  - `private.current_customer_id() returns uuid`
  - `private.require_permission(permission_key)` raises
    `insufficient_privilege` when the caller lacks it. Every privileged RPC
    calls this first.

Customers are not staff. A person can be both (a mechanic who owns a bike) by
having a `staff` row and a `customers` row pointing at the same
`auth_user_id`.

## 2. Customers, bikes, attachments

```
customers
  id uuid PK
  short_id text unique                 -- optional, for search; not printed
  auth_user_id uuid null unique         -> auth.users(id)
  first_name, last_name text null
  display_name text null                -- fallback: first + last, else email
  email citext null                     -- NOT a key; duplicates allowed
  phone text null
  internal_notes text null              -- staff only
  shopify_customer_id text null unique  -- durable Shopify link
  created_at, updated_at, archived_at

bikes
  id uuid PK
  short_id text not null unique         -- B-000123, printed on QR for bikes
  customer_id uuid null -> customers
  inventory_unit_id uuid null -> inventory_units   -- set when shop-owned/consigned
  brand text, model text, variant text, frame_size text, colour text
  serial_number text null               -- indexed, not unique (duplicates exist)
  description text, internal_notes text
  created_at, updated_at, archived_at

bike_ownership_events
  id, bike_id, from_customer_id null, to_customer_id null,
  reason text, actor_staff_id, created_at
  -- ownership changes append here; bikes.customer_id is the current owner

attachments
  id uuid PK
  entity_type attachment_entity not null  -- enum: bike | work_order | product |
                                          --   inventory_unit | customer | consignment_item
  entity_id uuid not null
  storage_bucket text not null            -- 'media-internal' | 'media-public'
  storage_path text not null unique
  media_type text not null
  byte_size integer
  width, height integer null
  caption text null
  visibility attachment_visibility not null default 'internal'
                                          -- enum: internal | customer | public
  created_by uuid -> staff
  created_at
  index (entity_type, entity_id)
```

Attachment storage: two Supabase Storage buckets. `media-internal` is private;
staff read it directly and customers get short-lived signed URLs minted on the
server for `visibility = customer` rows they are entitled to. `media-public` is
public-read and holds only rows with `visibility = public`. Changing visibility
to or from `public` moves the object between buckets inside the same service
call that updates the row. Storage policies:

- `media-internal`: insert/update/delete for active staff; select for active
  staff. Nobody else, ever. Customer access is only through signed URLs.
- `media-public`: select for all; insert/update/delete for active staff.

Object path: `{entity_type}/{entity_id}/{attachment_id}.{ext}`.

## 3. Shop hours and appointments

```
shop_settings (single row, id = 1)
  timezone text not null default 'Asia/Singapore'
  default_currency char(3) not null default 'SGD'
  intake_slot_minutes integer not null default 30
  intake_capacity_units integer not null default 2   -- per slot window
  public_site_url text not null                      -- base for QR URLs
  updated_at, updated_by

shop_hours
  id, weekday smallint (0=Sunday..6), opens_at time, closes_at time,
  active boolean
  unique (weekday, opens_at)             -- allows split days later

closure_overrides
  id, starts_at timestamptz, ends_at timestamptz, reason text,
  kind closure_kind                       -- enum: closed | custom_hours
  opens_at time null, closes_at time null -- for custom_hours
  created_by, created_at

appointment_types
  id, name, description, duration_minutes integer, capacity_units integer,
  public boolean, active boolean, sort_order integer

appointments
  id uuid PK
  customer_id uuid not null -> customers
  bike_id uuid null -> bikes
  appointment_type_id uuid not null -> appointment_types
  starts_at timestamptz not null
  ends_at timestamptz not null             -- starts_at + duration
  capacity_units integer not null          -- snapshot from type
  status appointment_status not null default 'booked'
     -- enum: booked | confirmed | arrived | checked_in | completed |
     --       cancelled | no_show
  customer_note text, internal_note text
  cancelled_at, cancellation_reason
  created_by_user_id uuid null             -- customer or staff auth id
  created_at, updated_at
  index (starts_at) where status not in ('cancelled','no_show')
```

Capacity rule (enforced in `book_appointment`): for every
`intake_slot_minutes` window overlapping `[starts_at, ends_at)`, the sum of
`capacity_units` of non-cancelled, non-no-show appointments overlapping that
window plus the new appointment must be `<= intake_capacity_units`. The window
must fall inside active `shop_hours` for that weekday and outside any `closed`
override (or inside `custom_hours`). The RPC takes
`pg_advisory_xact_lock(hashtext('appointments:' || date))` so two concurrent
bookings for the same day serialise. Walk-ins never create an appointment.

Future-proofing (tables designed now, created when needed, no code paths in
MVP): `staff_working_hours`, `staff_leave`, `staff_skills`,
`appointment_types.required_skill`. Nothing in the booking RPC assumes a
mechanic.

## 4. Workshop

```
work_orders
  id uuid PK
  job_number text not null unique         -- J-000456
  customer_id uuid not null -> customers
  bike_id uuid not null -> bikes
  appointment_id uuid null -> appointments
  lead_mechanic_id uuid null -> staff     -- denormalised from assignments
  status work_order_status not null default 'received'
     -- enum: received | diagnosing | awaiting_customer | awaiting_parts |
     --       ready_to_start | in_progress | paused | completed |
     --       ready_for_collection | collected | cancelled
  intake_notes, internal_notes, completion_notes text
  requested_work text
  approval_flag boolean not null default false   -- optional internal flag
  approval_note text null
  checked_in_at timestamptz not null default now()
  started_at, completed_at, ready_for_collection_at, collected_at timestamptz null
  cancelled_at timestamptz null, cancellation_reason text null
  currency char(3) not null default 'SGD'
  created_by uuid -> staff
  created_at, updated_at

work_order_assignments
  id, work_order_id, staff_id, role assignment_role   -- enum: lead | additional
  assigned_by uuid -> staff, assigned_at, unassigned_at null, unassigned_by null
  unique (work_order_id, staff_id) where unassigned_at is null
  unique (work_order_id) where role = 'lead' and unassigned_at is null

work_order_events  (append-only; no update/delete policy for anyone)
  id bigint identity PK
  work_order_id uuid -> work_orders
  event_type work_order_event_type
     -- enum: checked_in | photo_added | assignment_changed | note_added |
     --       diagnosis_added | line_added | line_voided | stock_consumed |
     --       stock_reversed | status_changed | completed | ready_for_collection |
     --       collected | cancelled | approval_flagged
  actor_staff_id uuid null, actor_user_id uuid null
  payload jsonb not null default '{}'     -- e.g. {from:'received', to:'in_progress'}
  created_at
  index (work_order_id, created_at)
```

Status transitions are enforced by `set_work_order_status(work_order_id,
new_status, note)`, which:

- validates the transition against an allowed-transition table in the function
  (no transition out of `collected` or `cancelled`; `collected` only from
  `ready_for_collection` or `completed`);
- stamps the matching timestamp exactly once (`started_at` on first
  `in_progress`, `completed_at` on `completed`, `ready_for_collection_at`,
  `collected_at`), never clearing an earlier stamp;
- appends a `status_changed` event plus the specific `completed` /
  `collected` event.

`completed_at` and `collected_at` are different events and different
timestamps. Reports use `completed_at` as the job's recognition date (see Open
decision D3).

## 5. Services and line items

```
categories
  id, kind category_kind (service | product), name, parent_id null, sort_order

services
  id, name, description, category_id null,
  default_sale_price money_amount not null,
  default_direct_cost money_amount not null default 0,
  active boolean, public boolean, sort_order
  created_at, updated_at, archived_at

cult_commons_rates
  id, rate numeric(5,4) not null check (rate >= 0 and rate <= 1),
  effective_from timestamptz not null unique,
  created_by, created_at
  -- seed: 0.3000 effective 1970-01-01

work_order_line_items
  id uuid PK
  work_order_id uuid -> work_orders
  line_type line_type not null             -- enum: service | inventory | manual
  source_service_id uuid null -> services
  source_product_id uuid null -> products
  source_inventory_unit_id uuid null -> inventory_units
  description_snapshot text not null
  quantity numeric(10,2) not null check (quantity > 0)
  unit_sale_price_snapshot money_amount not null
  unit_direct_cost_snapshot money_amount not null
  cult_commons_rate_snapshot numeric(5,4) not null
  currency char(3) not null
  -- generated, stored:
  sale_total        = round(quantity * unit_sale_price_snapshot, 2)
  cost_total        = round(quantity * unit_direct_cost_snapshot, 2)
  yield_total       = sale_total - cost_total
  cult_commons_share= round(greatest(yield_total, 0) * cult_commons_rate_snapshot, 2)
  sort_order integer
  created_by, created_at
  voided_at timestamptz null, voided_by uuid null, void_reason text null
  check (line_type <> 'inventory' or source_product_id is not null)
  check (line_type <> 'inventory' or quantity = trunc(quantity))
  check (source_inventory_unit_id is null or quantity = 1)
```

The arithmetic lives in generated columns so no application code can produce a
different number. A line is immutable after insert except for `voided_*`,
`sort_order` and `description_snapshot` (typo fixes; an event records the
change). Changing quantity is "void and re-add", which is what the stock ledger
needs anyway.

Totals per work order come from the view `work_order_totals` (sum over
non-voided lines of `sale_total`, `cost_total`, `yield_total`,
`cult_commons_share`, plus `bicii_yield_after_cc = yield_total -
cult_commons_share`). The cost, yield and Cult Commons columns are exposed only
through `work_order_totals_staff` (requires `view_costs`); the customer/anon
projection has sale totals only.

Cult Commons: `cult_commons_share = max(yield, 0) × rate`, where
`yield = sale − direct cost` and the consignor payout is direct cost. The rate
is snapshotted on the line from `private.cult_commons_rate_at(now())`.
Negative yield reports a loss and never produces a negative share.

## 6. Catalog and inventory

```
locations
  id, name, kind location_kind (shop_floor | workshop | storage | offsite),
  active, sort_order

products
  id uuid PK
  short_id text not null unique            -- P-000789 (encoded in QR)
  sku text null unique                     -- supplier/own SKU, optional
  name text not null, description text
  brand text null, category_id uuid null
  tracking_type tracking_type not null     -- enum: quantity | unique
  ownership_type ownership_type not null default 'shop_owned'
     -- enum: shop_owned | consignment | customer_owned
     -- for unique products this is informational; the unit carries the truth
  publication_status publication_status not null default 'draft'
     -- enum: draft | internal_only | public | sold | archived
  public_slug text null unique
  default_sale_price money_amount null
  default_direct_cost money_amount null    -- last/standard cost; see D5
  currency char(3) not null default 'SGD'
  reorder_point integer null               -- low-stock threshold
  shopify_product_id text null unique
  shopify_variant_id text null unique
  active boolean not null default true
  created_at, updated_at, archived_at

inventory_units   (one row per physical unique item)
  id uuid PK
  short_id text not null unique            -- U-000012 (encoded in QR)
  product_id uuid not null -> products (tracking_type = unique)
  location_id uuid not null -> locations
  serial_number text null
  condition text null                      -- free text or small enum later
  ownership_type ownership_type not null
  consignment_item_id uuid null -> consignment_items
  bike_id uuid null -> bikes               -- when the unit is a complete bike
  status unit_status not null default 'available'
     -- enum: available | reserved | sold | returned_to_consignor |
     --       written_off | held_for_customer
  sale_price money_amount null             -- overrides product default
  direct_cost money_amount null            -- purchase cost or consignor payout
  sold_sale_line_id uuid null unique -> sale_lines
  sold_at timestamptz null
  internal_notes text
  created_at, updated_at, archived_at

supplier_products   (future multiple suppliers per product; create now, use later)
  supplier_id, product_id, supplier_sku, last_unit_cost, lead_days
  PK (supplier_id, product_id)
```

Quantity products print one QR (`P-...`) any number of times. Unique units
print their own (`U-...`). A bulk unit that becomes special is handled by a
`stock_adjustment` movement of −1 on the product plus creating a new unique
product + unit; there is no conversion machinery.

## 7. Inventory movement ledger

```
inventory_movements  (append-only; insert only through RPCs)
  id bigint identity PK
  product_id uuid not null -> products
  inventory_unit_id uuid null -> inventory_units
  location_id uuid not null -> locations
  quantity_delta integer not null check (quantity_delta <> 0)
  movement_type movement_type not null
     -- enum: purchase_received | job_consumption | retail_sale | online_sale |
     --       stock_adjustment | damaged | return | consignment_received |
     --       consignment_returned | transfer | reversal
  work_order_id uuid null
  work_order_line_item_id uuid null -> work_order_line_items
  sale_line_id uuid null -> sale_lines
  purchase_receipt_line_id uuid null -> purchase_receipt_lines
  consignment_item_id uuid null -> consignment_items
  transfer_group_id uuid null              -- pairs the −/+ rows of a transfer
  reversal_of_id bigint null unique -> inventory_movements
  unit_cost_snapshot money_amount null
  currency char(3) not null default 'SGD'
  reason text null                         -- required for adjustments/damaged
  created_by uuid null -> staff
  created_at
  check (inventory_unit_id is null or abs(quantity_delta) = 1)
  check (movement_type not in ('stock_adjustment','damaged') or reason is not null)
  unique (work_order_line_item_id) where movement_type = 'job_consumption'
  unique (sale_line_id) where movement_type in ('retail_sale','online_sale')
  unique (purchase_receipt_line_id)
  index (product_id, location_id, created_at), index (inventory_unit_id)
```

The partial unique indexes are the idempotency guarantees: a line can consume
once, a sale line can ship once, a receipt line can be received once, a
movement can be reversed once. A retry hits the index and the RPC returns the
existing movement instead of inserting.

Stock on hand is `reporting.stock_levels`:
`select product_id, location_id, sum(quantity_delta) on_hand from
inventory_movements group by 1,2`. A cached `inventory_balances` table may be
added later as a projection maintained by trigger; `reporting.stock_reconciliation`
compares the two and is the reconciliation tool from the spec.

Unique-unit invariant: `inventory_units.status` is only changed by RPCs that
also write the movement, inside one transaction, after `select … for update` on
the unit. A `sold` unit cannot be consumed, sold or transferred; the RPC raises.

## 8. Sales (non-workshop revenue)

Workshop revenue is recorded on `work_order_line_items`. Everything else that
sells stock (over-the-counter, Shopify, a consigned bike sold in store) is a
`sale`:

```
sales
  id uuid PK
  sale_number text not null unique         -- S-000123
  source sale_source not null              -- enum: retail | online_shopify | work_order
  customer_id uuid null
  work_order_id uuid null                  -- when the shop records a job's parts
                                           --   as a POS sale too (future)
  shopify_order_id text null unique        -- idempotency for inbound orders
  shopify_order_name text null             -- '#1042' for humans
  recognized_at timestamptz not null       -- paid/recognition date
  status sale_status not null default 'recorded'
     -- enum: recorded | refunded | partially_refunded | voided
  currency char(3), notes text
  created_by uuid null, created_at, updated_at

sale_lines
  id uuid PK
  sale_id uuid -> sales
  product_id uuid not null
  inventory_unit_id uuid null unique       -- a unit sells once, full stop
  consignment_item_id uuid null
  description_snapshot text not null
  quantity numeric(10,2) not null check (quantity > 0)
  unit_sale_price_snapshot, unit_direct_cost_snapshot money_amount not null
  cult_commons_rate_snapshot numeric(5,4) not null
  currency char(3)
  sale_total, cost_total, yield_total, cult_commons_share  -- generated as in §5
  shopify_line_item_id text null unique
  created_at

sale_refunds
  id, sale_id, shopify_refund_id text null unique, amount money_amount,
  reason text, restocked boolean not null default false,
  recorded_by, created_at
```

A refund is a financial fact. It does not touch stock. Putting a unique item
back on the floor is a separate staff action (`restock_unit`) that writes a
`return` movement and flips the unit back to `available`, with a reason.

## 9. Consignment

```
consignors
  id uuid PK
  customer_id uuid null -> customers       -- a consignor is often a customer
  display_name text not null
  email citext, phone text
  payout_details text null                 -- staff only; free text in MVP
  internal_notes text
  created_at, updated_at, archived_at

consignment_items
  id uuid PK
  short_id text not null unique            -- C-000056
  consignor_id uuid not null -> consignors
  product_id uuid not null -> products
  inventory_unit_id uuid null -> inventory_units   -- unique items
  quantity integer not null default 1      -- >1 only for quantity-tracked stock
  received_at timestamptz not null
  agreed_amount_owed money_amount not null -- per unit, owed on sale
  asking_price money_amount null
  currency char(3)
  status consignment_status not null default 'active'
     -- enum: active | sold | returned | withdrawn
  sold_at timestamptz null
  returned_at timestamptz null
  agreement_notes text, internal_notes text
  created_by, created_at, updated_at

consignment_item_charges
  id, consignment_item_id, description text, amount money_amount,
  bearer charge_bearer                      -- enum: consignor | shop
  -- consignor: deducted from the amount owed at settlement
  -- shop: added to direct cost of the sale line (reduces yield)
  created_by, created_at

consignment_settlements
  id uuid PK
  consignor_id uuid -> consignors
  amount money_amount not null check (amount > 0)
  currency char(3)
  paid_at timestamptz not null
  reference text, notes text
  created_by, created_at

settlement_lines
  id, settlement_id -> consignment_settlements,
  consignment_item_id -> consignment_items,
  amount_applied money_amount not null check (amount_applied > 0)
  override_reason text null                -- required when exceeding owed
```

Liability is derived, never stored:
`reporting.consignor_ledger` computes per item
`owed = agreed_amount_owed × quantity_sold − consignor-borne charges`,
`paid = Σ settlement_lines.amount_applied`, `outstanding = owed − paid`, and
per consignor the roll-up plus active items and settlement history.
`record_settlement` rejects an allocation that would push `paid > owed` unless
`override_reason` is given by a caller with `manage_consignments`.

Selling an item (via `record_retail_sale` or the Shopify handler) sets
`consignment_items.status = sold`, writes the sale line with
`unit_direct_cost_snapshot = agreed_amount_owed (+ shop-borne charges)`, and
writes the movement. It does not create a settlement. Those are separate facts.

## 10. Suppliers and purchasing

```
suppliers
  id, name, contact_name, email, phone, website, account_reference, notes,
  active, created_at, updated_at, archived_at

purchase_orders
  id uuid PK
  po_number text not null unique           -- PO-000034
  supplier_id uuid -> suppliers
  status po_status not null default 'draft'
     -- enum: draft | submitted | partially_received | received | cancelled
  expected_at date null
  currency char(3), notes text
  created_by, created_at, updated_at

purchase_order_lines
  id, purchase_order_id, product_id, quantity_ordered integer check (> 0),
  unit_cost money_amount not null, expected_at date null, notes
  -- quantity_received is derived from receipt lines

purchase_receipts
  id uuid PK
  purchase_order_id uuid -> purchase_orders
  idempotency_key text not null unique     -- client-generated uuid per submit
  reference text null                      -- supplier delivery note
  received_at timestamptz not null
  received_by uuid -> staff
  notes, created_at

purchase_receipt_lines
  id, purchase_receipt_id, purchase_order_line_id, location_id,
  quantity_received integer check (> 0),
  unit_cost_actual money_amount not null
```

`receive_purchase(po_id, idempotency_key, lines[])` locks the PO row, checks
each line's `quantity_received <= ordered − already received`, inserts the
receipt and lines, writes one `purchase_received` movement per line with
`unit_cost_snapshot = unit_cost_actual`, updates `products.default_direct_cost`
per decision D5, and moves the PO to `partially_received` or `received`. A
second call with the same `idempotency_key` returns the original receipt and
writes nothing.

## 11. QR identity and publication

- Every product, inventory unit and bike has a `short_id`. The QR payload is
  the URL `{shop_settings.public_site_url}/q/{short_id}` and nothing else.
- The public site route `/q/[shortId]` resolves the ID through
  `reporting.public_items` (a view that exposes only rows with
  `publication_status = public` or `sold`, and only public columns: name,
  description, brand, public photos, sale price, availability, slug). Unknown or
  unpublished IDs 404 identically, so the URL space leaks nothing.
- The Admin scanner recognises the same URL (or a bare short ID) and routes to
  the staff detail page: `/products/[id]`, `/units/[id]`, `/bikes/[id]`,
  `/jobs/[id]`.
- Publication state machine on `products.publication_status`:
  `draft → internal_only → public`, `public → sold` (unique only, set by the
  sale RPC), `public|internal_only|sold → archived`. A product cannot become
  `public` without a name, at least one `public` attachment and a sale price.
  Inventory rows are never public by default.

## 12. Label printing

```
label_templates
  id, name, kind label_kind (product | unit | bike), width_mm, height_mm,
  layout jsonb      -- fields: name, price, short_id, qr, extra lines
  active

printer_profiles
  id, name, adapter printer_adapter (browser | pdf | network_raw | bluetooth),
  config jsonb, label_template_id, active

print_jobs
  id, printer_profile_id, label_template_id, entity_type, entity_id,
  quantity integer, status print_status (queued | rendered | printed | failed),
  requested_by, created_at, completed_at, error
```

MVP ships the `browser` and `pdf` adapters (render labels to a print-sized
page/PDF). A hardware adapter is a later phase once the printer models are
known; the abstraction (`LabelTemplate`, `PrintJob`, `PrinterProfile`,
`PrinterAdapter` interface in `src/lib/printing/`) is in place from day one.

## 13. Shopify integration

```
integration_events   (every inbound webhook, before any processing)
  id bigint identity PK
  provider text not null default 'shopify'
  topic text not null                      -- 'orders/paid', 'refunds/create', …
  external_event_id text not null          -- X-Shopify-Webhook-Id
  shop_domain text, api_version text
  payload jsonb not null
  headers jsonb not null
  hmac_valid boolean not null
  received_at timestamptz not null default now()
  status integration_event_status not null default 'pending'
     -- enum: pending | processed | skipped | failed
  attempts integer not null default 0
  processed_at timestamptz, last_error text, correlation_id uuid
  unique (provider, external_event_id)

shopify_product_sync
  product_id uuid PK -> products
  publish_online boolean not null default false
  sync_status sync_status not null default 'not_synced'
     -- enum: not_synced | pending | synced | error | unpublished
  shopify_product_id, shopify_variant_id, shopify_inventory_item_id text
  last_pushed_at, last_pulled_at timestamptz
  last_error text, desired_hash text       -- hash of last pushed payload
  updated_at

integration_retry_queue
  id, integration_event_id null, kind text, payload jsonb, attempts,
  next_attempt_at, last_error, status (queued | running | done | dead)
```

Processing `orders/paid` is `process_shopify_order_paid(event_id)`:

1. Lock the `integration_events` row; if `status = processed` return.
2. Upsert `sales` by `shopify_order_id` (unique). If it exists, return.
3. For each Shopify line item, map `variant_id → products.shopify_variant_id`;
   unmapped lines go to the retry queue with a human-readable reason and the
   event is marked `failed` (nothing partial is committed).
4. Insert `sale_lines` and one `online_sale` movement per line; mark unique
   units `sold` and consignment items `sold`.
5. Mark the event `processed`.

All of that is one transaction. Delivering the webhook ten times yields one
sale, one set of movements.

Outbound: `publish_online` on a product enqueues a sync job; the service layer
(`src/lib/integrations/shopify/`) owns every Shopify API call. Nothing in a
component or route handler talks to Shopify directly.

## 14. Reporting views (schema `reporting`)

All views are plain SQL over source tables. None are maintained by hand.

| View | Purpose |
|---|---|
| `financial_lines` | Union of non-voided `work_order_line_items` (recognised at `work_orders.completed_at`) and `sale_lines` (recognised at `sales.recognized_at`): source, recognized_at, sale, cost, yield, cult_commons_share, ownership_type, product/service/category, mechanic. |
| `daily_summary` | One row per day: appointments, arrivals, no-shows, jobs by status transition that day, gross sales, COGS, yield, CC share, yield after CC, parts consumed, adjustments, consignment sales, new liabilities. |
| `work_order_activity` | Per job: check-in, start, completion, collection dates and durations; drives the board and overdue filters. |
| `work_order_totals` / `work_order_totals_staff` | Running totals per job; the staff variant includes cost and yield. |
| `stock_levels` | On-hand per product/location from the ledger. |
| `stock_reconciliation` | Ledger-derived vs cached balance when the cache exists. |
| `low_stock` | Products under `reorder_point`. |
| `consignor_ledger` / `consignor_item_ledger` | Owed, paid, outstanding. |
| `purchase_order_progress` | Ordered vs received per line. |
| `shopify_sync_status` | Per published product. |
| `public_items` | The only thing anon can read about inventory. |

Materialise `daily_summary` only if measured to be slow; refresh then runs
`after()` completion/sale mutations.

## 15. Row-level security matrix

`S` = active staff (any), `P(x)` = staff with permission x, `A` = admin,
`C` = authenticated customer on own rows, `anon` = anonymous. RPC = only via
security-definer function. Blank = no access.

| Table | select | insert | update | delete |
|---|---|---|---|---|
| staff | S (own row + names of others); A full; A or P(manage_staff) via `staff_roster()` | A; A or P(manage_staff) via `create_staff()` | A; RPC `set_staff_active` | — |
| staff_permissions | A, own | A / P(manage_staff) | same | same |
| customers | S; C own | S; C own on sign-up | S; C own (name/phone only) | — |
| bikes | S; C own | S; C own | S; C own (non-internal cols) | — |
| attachments | S; C where visibility ≠ internal and entity is own | S | S | S |
| shop_hours, closure_overrides, appointment_types | S; anon/C active+public rows | A | A | A |
| appointments | S; C own | RPC (`book_appointment`) | RPC / S | — |
| work_orders | S; C own (customer projection view) | S | S | — |
| work_order_assignments | S | RPC | RPC | — |
| work_order_events | S; C own, customer-visible types | RPC | — | — |
| services, categories | S; anon/C active+public | A / P(manage_inventory) | same | — |
| cult_commons_rates | P(view_costs) | A | — | — |
| work_order_line_items | S (cost cols via view only); C own sale cols | RPC | RPC (void) | — |
| products | S; anon/C via `public_items` only | P(manage_inventory) | P(manage_inventory) | — |
| inventory_units | S (cost col gated) | RPC | RPC | — |
| inventory_movements | S (cost col gated) | RPC | — | — |
| sales, sale_lines, sale_refunds | P(view_financial_reports) or P(view_costs) | RPC | RPC | — |
| consignors, consignment_items, charges | S; values gated | P(manage_consignments) | same | — |
| consignment_settlements, settlement_lines | P(manage_consignments) | RPC | — | — |
| suppliers, purchase_orders, lines | S | P(manage_purchasing) | same | — |
| purchase_receipts, receipt_lines | S | RPC | — | — |
| label_templates, printer_profiles | S | A | A | A |
| print_jobs | S | S | S | — |
| integration_events, retry queue, sync | A | service role only | service role / RPC | — |
| reporting.* financial views | P(view_financial_reports) | — | — | — |
| reporting.public_items | everyone | — | — | — |

Column-level gating of cost/yield for staff without `view_costs` is done with
views (`*_staff` views include the columns; base tables revoke `select` on
those columns from `authenticated` via column grants). Customers never read
`internal_notes`, costs, yield, consignor or Cult Commons data; this is tested
(see TESTING.md).

## 16. RPC catalogue (security definer, in `public`)

Each RPC begins with `private.require_permission(...)` or `private.is_staff()`
as appropriate, runs in a single transaction, locks the rows it mutates, and
returns the created/affected row. Idempotent ones accept an idempotency key or
rely on a unique index and return the existing row on replay.

Business errors an RPC raises on purpose use SQLSTATE `P0001` with `MESSAGE`
set to a stable snake_case code (for example `staff_email_mismatch`) and
`DETAIL` set to an explanation. `src/lib/db-errors.ts` maps known codes to
user-facing messages; unknown codes become a generic error. Authorization
failures are `42501`, missing rows `P0002`, the last-admin guard `55000`.
Unique (`23505`) and check (`23514`) violations are mapped by constraint name.

| RPC | Guard | Effects |
|---|---|---|
| `book_appointment(type_id, starts_at, customer_id, bike_id, note)` | C own / S | Capacity + hours check under advisory lock; insert. |
| `check_in_appointment(appointment_id, bike_id)` | S | Status → checked_in; creates work order; links. |
| `create_work_order(customer_id, bike_id, intake, lead_mechanic_id, appointment_id)` | S | Job number from sequence; `checked_in` event; lead assignment. |
| `assign_staff(work_order_id, staff_id, role)` / `unassign_staff(...)` | S | Assignment rows + `assignment_changed` event; keeps `lead_mechanic_id` in sync. |
| `set_work_order_status(work_order_id, status, note)` | S | Transition rules, timestamps, events. |
| `add_service_line(work_order_id, service_id, quantity, overrides)` | S | Snapshots price/cost/rate; `line_added` event. |
| `add_manual_line(work_order_id, description, qty, price, cost)` | S (cost requires P(view_costs)) | As above. |
| `add_inventory_line(work_order_id, product_id, unit_id, quantity, location_id)` | S | Snapshots; locks unit/stock; inserts line + `job_consumption` movement; unit → `held`/`sold` per D6; events. Replay = no-op by unique index. |
| `void_line(line_id, reason)` | S | Sets `voided_*`; inserts `reversal` movement linked by `reversal_of_id`; unit back to `available`; events. Replay = no-op. |
| `adjust_stock(product_id, location_id, delta, movement_type, reason, unit_cost)` | P(adjust_stock) | Manual movement with mandatory reason. |
| `transfer_stock(product_id, from, to, qty, reason)` | P(manage_inventory) | Paired movements with `transfer_group_id`. |
| `create_unique_unit(product_id, location_id, ownership, cost, consignment)` | P(manage_inventory) | Unit + `consignment_received`/`stock_adjustment` movement. |
| `set_publication_status(product_id, status)` | P(manage_inventory) | State-machine check; enqueues Shopify sync if linked. |
| `record_retail_sale(lines[], customer_id, recognized_at, idempotency_key)` | S | Sale + lines + movements; unit/consignment → sold. |
| `restock_unit(unit_id, location_id, reason)` | P(adjust_stock) | `return` movement; unit → available; product status back from `sold`. |
| `create_consignment_item(...)` | P(manage_consignments) | Item + unit + movement. |
| `return_consignment_item(item_id, reason)` | P(manage_consignments) | `consignment_returned` movement; unit → returned. |
| `record_settlement(consignor_id, amount, paid_at, allocations[], reference)` | P(manage_consignments) | Settlement + lines; overallocation check. |
| `receive_purchase(po_id, idempotency_key, lines[])` | P(manage_purchasing) | §10. |
| `process_shopify_order_paid(event_id)` | service role | §13. |
| `process_shopify_refund(event_id)` | service role | `sale_refunds`; no stock. |
| `grant_permission` / `revoke_permission` / `set_staff_active` | A or P(manage_staff) | Permission rows (`granted_by` = caller); grant/revoke are replay-safe. Nobody deactivates themselves; only an admin changes an admin's status. |
| `my_staff_profile()` | authenticated | Caller's staff row + effective permissions (admin → all; inactive → none); zero rows for non-staff. |
| `create_staff(auth_user_id, display_name, email, role)` | A or P(manage_staff); only A creates `admin` | Links an existing Auth login (created server-side with the service-role admin API) to a new active staff row. Email must equal the login's email (`P0001 staff_email_mismatch`); duplicate email → 23505 `staff_email_key`. |
| `staff_roster()` | A or P(manage_staff) | Every staff row with its *granted* permissions, for Staff settings (a manage_staff holder could otherwise grant but not see permissions, §15). |
| `staff_directory()` | S | `id, display_name, role, active` of every staff member: how staff see colleagues' names (§15) without reading the `staff` table. |

## 17. Sequences and short IDs

`private.next_short_id(prefix text) returns text` reads a per-prefix sequence
(`private.seq_short_id_b`, `private.seq_short_id_j`, …, `maxvalue 999999 no
cycle`, so exhaustion raises rather than truncating) and zero-pads to six
digits. Unknown prefixes raise SQLSTATE 22023. Sequences
are never reset. The UUID is the primary key everywhere; short IDs are for
humans and QR codes.

## 18. Seed data (`supabase/seed.sql`)

Realistic and deterministic (fixed UUIDs so tests can reference them):
3 staff (1 admin, 2 mechanics with differing permissions), 6 customers with
10 bikes, shop hours Tue–Sun, 4 appointment types, 8 services, 2 locations,
12 quantity products with stock, 3 unique shop-owned bikes, 2 consigned bikes
(one sold, unsettled), 2 suppliers, 1 PO partially received, 9 work orders
spread across statuses and the last 10 days, settlements, and a Cult Commons
rate row. The seed is applied to the local database and to a fresh preview
project; never to production.
