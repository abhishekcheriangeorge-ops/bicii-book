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
- Money: domain `money_amount` = `numeric(12,2)`. Rates: domain
  `rate_fraction` = `numeric(5,4)` (0.3000 = 30%; tables add their own
  range checks). Both domains reject `NaN` (`check (value <> 'NaN')`):
  Postgres numeric accepts it, it poisons every sum, and it passes range
  checks because NaN sorts above every number. Every other numeric column
  uses a domain with the same check too (a meta test requires it), e.g.
  quantities on line items are domain `line_quantity` = `numeric(10,2)`
  (added with the first line-item table, Phase 3), with a check that
  inventory-backed lines are whole numbers. Quantities on stock
  are `integer`.
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
  -- current state only; history is in staff_events

permission_key enum:
  view_costs | manage_inventory | adjust_stock | manage_consignments |
  manage_purchasing | manage_staff | view_financial_reports

staff_events                           -- append-only history
  id uuid PK
  staff_id uuid not null -> staff(id) on delete restrict
  event_type staff_event_type not null
    -- created | details_changed | role_changed | deactivated |
    -- reactivated | permission_granted | permission_revoked
  permission permission_key null       -- set exactly for permission_* events
  actor_staff_id uuid null -> staff(id) -- null: changed outside the app (seed, SQL editor)
  payload jsonb not null default '{}'   -- what changed: {"role": {"from","to"}},
                                        -- a revoked grant's granted_by/granted_at,
                                        -- the created row's fields
  reason text null                      -- required for deactivated (by the RPC); ≤ 500 chars
  correlation_id text null              -- the request's x-request-id (ADR-001 A8)
  created_at timestamptz not null default clock_timestamp()
  index (staff_id, created_at desc), index (actor_staff_id)
```

Rules:

- `role = admin` implies every permission. `staff` has only the rows granted.
- An update can never leave the shop without an active admin (trigger
  `staff_keep_an_active_admin`, serialised with an advisory lock).
- "Staff" in any policy means `staff.active = true` for the calling
  `auth.uid()`. Deactivating a staff member revokes everything at once.
- History over overwrites (SPEC §2, §22): every insert or update of a
  `staff` row and every insert or delete of a `staff_permissions` row
  appends one `staff_events` row, written by triggers
  (`staff_record_history`, `staff_permissions_record_history`), so no path
  (RPC, seed, the RUNBOOK's first-admin SQL) skips it. A grant's actor is
  its `granted_by`; otherwise the actor is `private.current_staff_id()`. The
  reason reaches the trigger through a transaction-local setting the RPC
  sets and clears (`private.set_staff_event_reason`). Replays that change
  nothing append nothing. `staff_events` refuses UPDATE and DELETE for
  every role (`staff_history_append_only`); API roles have no grant on it
  and read it through `staff_history()`.
- Staff rows change only through RPCs: `authenticated` and `service_role`
  have no INSERT/UPDATE/DELETE on `staff` or `staff_permissions`. A BEFORE
  trigger (`staff_enforce_rules`) holds for every writer, the owner
  included: `staff.email` must equal the Auth login's email (P0001
  `staff_email_mismatch`), and a signed-in user never deactivates their
  own row (42501).
- Delegation ceiling (PLAN D11, `private.authorize_permission_change`):
  admins grant and revoke anything; a `manage_staff` holder who is not an
  admin only permissions they hold themselves, never `manage_staff`, never
  on their own row, never on an admin's row (42501).
- Helpers in `private`, all `security definer`, `stable`, with
  `search_path = ''`:
  - `private.current_staff_id() returns uuid`
  - `private.is_staff() returns boolean`
  - `private.is_admin() returns boolean`
  - `private.has_permission(permission_key) returns boolean`
  - `private.current_customer_id() returns uuid`: the caller's
    non-archived `customers` row (Phase 1); null for anonymous callers,
    staff without a customers row and archived customers. EXECUTE for
    `authenticated` only.
  - `private.require_permission(permission_key)` raises
    `insufficient_privilege` when the caller lacks it. Every privileged RPC
    calls this first.

Customers are not staff. A person can be both (a mechanic who owns a bike) by
having a `staff` row and a `customers` row pointing at the same
`auth_user_id`.

## 2. Customers, bikes, attachments

Phase 1 migrations: `…0600_customers`, `…0700_bikes`, `…0800_media_storage`,
`…0900_attachments`, `…1000_customer_access`, `…1100_staff_search`.

```
customers
  id uuid PK
  short_id text null unique             -- optional, for search; not printed, not assigned yet
  auth_user_id uuid null unique         -> auth.users on delete set null
  first_name, last_name text null       -- ≤ 100
  display_name text null                -- fallback: first + last, else email (private.customer_label)
  email citext null                     -- NOT a key; duplicates allowed
  phone text null
  internal_notes text null              -- staff only
  shopify_customer_id text null unique  -- durable Shopify link
  search_text text generated            -- lower(names + email), trigram GIN
  phone_digits text generated           -- digits of phone, trigram GIN
  created_at, updated_at, archived_at
  check customers_identifies_someone    -- a name, an email or a phone
  -- trigger: text trimmed, blanks stored as NULL

bikes
  id uuid PK
  short_id text not null unique         -- B-000123, printed on QR for bikes;
                                        -- assigned by trigger from next_short_id('B'), immutable
  customer_id uuid null -> customers    -- CURRENT owner; null = shop / unknown
  inventory_unit_id uuid null           -- the unit this shop bike is in stock as; FK -> inventory_units
                                        -- (Phase 4, unique), set by private.register_unit; no client grant
  brand text not null, model text not null
  variant, frame_size, colour text null
  serial_number text null               -- not unique (duplicates exist)
  description text null, internal_notes text null
  serial_key text generated             -- upper(serial) without punctuation; btree + trigram
  search_text text generated            -- lower(brand model variant colour); trigram
  created_at, updated_at, archived_at

bike_ownership_events                   -- append-only
  id, bike_id
  event_type bike_ownership_event_type  -- registered (created with an owner) | transferred
  from_customer_id null, to_customer_id null
  reason text                           -- required for transferred; ≤ 500
  actor_staff_id null, correlation_id, created_at (clock_timestamp)
  -- written by the bikes trigger; bikes.customer_id is the current owner

attachments
  id uuid PK                            -- chosen by the server before upload (it is in the path)
  entity_type attachment_entity not null  -- enum: bike | work_order | product |
                                          --   inventory_unit | customer | consignment_item
  entity_id uuid not null               -- validated by private.attachment_entity_exists
  storage_bucket text not null          -- 'media-public' iff visibility = public, else 'media-internal'
  storage_path text not null unique     -- {entity_type}/{entity_id}/{id}.{ext}, ext matches media_type
  media_type text not null              -- image/jpeg | png | webp | heic | heif
  byte_size integer                     -- from Storage's object metadata when present
  width, height integer null
  caption text null                     -- ≤ 500
  visibility attachment_visibility not null default 'internal'
                                          -- enum: internal | customer | public
  created_by uuid -> staff
  created_at, updated_at
  index (entity_type, entity_id, created_at)
  check: a `customer` entity's attachment is never `public` (PLAN D13),
         nor a `work_order` entity's (PLAN D19, Phase 3)

attachment_events                       -- append-only; outlives deleted attachments
  id, attachment_id (no FK), entity_type, entity_id
  event_type attachment_event_type      -- created | visibility_changed | caption_changed | deleted
  actor_staff_id null, payload jsonb, reason (required for deleted), correlation_id, created_at
```

Rules:

- History over overwrites. Every owner change of a bike appends a
  `bike_ownership_events` row from a trigger, so no writer skips it; an
  owner change without a reason raises `reason_required` for every writer
  (RPCs pass the reason through the transaction-local
  `private.set_change_reason`). `authenticated` has no column grant on
  `bikes.customer_id` after insert: transfers go through
  `transfer_bike_ownership`. Archived customers receive no bikes
  (`customer_archived`); archived bikes are not transferred
  (`bike_archived`).
- Attachments are created only by `record_attachment`, which checks the
  object is in `storage.objects` at the canonical path (it reads the table
  as the function owner, which bypasses RLS on hosted Supabase and
  locally), moved only by `set_attachment_visibility`, deleted only by
  `delete_attachment` (reason required, the deleted row is kept in the
  `deleted` event's payload; ids are never reused). Staff may edit a
  caption directly (recorded as `caption_changed`).
- Entity types grow by phase. `private.attachment_entity_exists` knows
  `customer`, `bike` and (Phase 3) `work_order`, returns null for the rest (`record_attachment`
  raises `attachment_entity_unsupported`); the migration that creates
  `work_orders`, `products`, `inventory_units` or `consignment_items` adds
  its branch with `create or replace`.
- Search: `pg_trgm` lives in `extensions` (as on hosted Supabase). The
  generated search columns use built-in immutable functions only, so the
  trigram indexes need no helper function.

Attachment storage: two Supabase Storage buckets, created by migration
(`insert … on conflict do nothing`), photos only (JPEG, PNG, WebP,
HEIC/HEIF) up to 20 MiB. `media-internal` is private; staff read it directly
and customers get short-lived signed URLs minted on a server for
`visibility = customer` rows they are entitled to (`my_bike_attachments`).
`media-public` is a public bucket: its files are served to anyone at their
public URL (`/object/public/…`, which Storage serves without RLS), and it
holds only rows with `visibility = public`. Changing visibility to or from
`public` moves the object between buckets: the server copies it to the
other bucket (same path), calls `set_attachment_visibility` with the new
location (which must exist), then removes the old object. A photo recorded
without width and height is an original the device could not decode and
uploaded as is (it may carry EXIF GPS), so it is never public
(`attachment_original_never_public`), like any photo on a customer record.
Storage policies on `storage.objects`:

- `media-internal`: select and insert for active staff. Nobody else, ever:
  not anon, not signed-in customers, not inactive staff. Customer access is
  only through signed URLs.
- `media-public`: select and insert for active staff only. No select for
  anon or customers: public URLs need none, and a select policy would let
  anyone list the bucket.
- Both: no update policy (nothing is overwritten: uploads never upsert, a
  move copies to a new bucket). Delete for active staff only of objects no
  attachment row points at (`private.attachment_object_referenced`; those
  policies are in the attachments migration), so a recorded photo leaves
  Storage only through `delete_attachment` (reason, history) or a move.

Storage and Postgres share no transaction, so a Storage cleanup can fail
after the database change (the old copy after a move, a deleted photo's
file) or a change can stop half-way. The server says so (`cleanupPending`,
"Finish" in the viewer repeats the change), and every time it shows a
record it removes that record's stray objects:
`attachment_stray_objects(entity_type, entity_id)` lists objects under the
record's folder that no row points at and are older than 10 minutes (not
part of a move still running); in `media-internal` only those whose
attachment id has history, or older than a day (an upload whose
`record_attachment` may still come). So `media-public` converges on public
photos only, whatever failed.

Object path: `{entity_type}/{entity_id}/{attachment_id}.{ext}`. Upload flow
(ADR-001 A7): the server picks the attachment id, mints a signed upload URL
for that exact path as the signed-in staff member, the phone uploads to it,
the server calls `record_attachment`.

## 3. Shop hours and appointments

Phase 2 migrations: `…2700_appointment_enum_values` (work_order_event_type
`appointment_linked`), `…2800_schedule`, `…2900_appointments`,
`…3000_appointment_customer_access` (step 1), `…3100_appointment_check_in`
(check-in, the `work_orders.appointment_id` foreign key and link triggers,
the completion trigger, D36, D40; §4) and `…3200_appointment_reporting`
(the appointment counts, D41; §14). Decisions: PLAN D2, D35, D36–D42.

```
shop_settings (single row: id smallint = 1, check shop_settings_singleton;
               inserted by the migration; never deleted: shop_settings_required)
  timezone text not null default 'Asia/Singapore'   -- fixed in the MVP (D35);
                                                    -- read via private.shop_timezone()
  default_currency text not null default 'SGD'      -- ^[A-Z]{3}$; private.shop_currency()
  intake_slot_minutes integer not null default 30   -- 5..240, divides 1440
  intake_capacity_units integer not null default 2  -- 1..50, per window (D2)
  booking_min_notice_minutes integer default 120    -- 0..10080 (D37)
  booking_horizon_days integer default 60           -- 1..365 (D37)
  customer_max_active_bookings integer default 3    -- 1..20 (D37)
  customer_cancel_cutoff_minutes integer default 120 -- 0..10080 (D37)
  public_site_url text null                         -- https?://…, ≤ 200; informational
                                                    -- until Phase 8 (D9 note)
  updated_at, updated_by -> staff                   -- updated_by = the caller's staff id

shop_hours
  id, weekday smallint (0=Sunday..6, as extract(dow)), opens_at time,
  closes_at time (≤ 24:00, after opens_at), active boolean, created_at, updated_at
  unique (weekday, opens_at)             -- several intervals per day
  no two intervals of one weekday overlap (trigger, shop_hours_overlap)

closure_overrides
  id, kind closure_kind (closed | custom_hours), starts_at, ends_at
  (≤ 366 days), opens_at/closes_at time (custom_hours only), reason text
  (1..200), created_by -> staff, created_at, updated_at
  exclude using gist (tstzrange(starts_at, ends_at)) where kind = custom_hours

appointment_types
  id, name (1..80, unique ignoring case), description (≤ 500),
  duration_minutes (5..480, multiple of 5), capacity_units (1..50),
  public boolean, active boolean, sort_order, created_at, updated_at
  -- never deleted (deactivate)

schedule_events (append-only; triggers on the four tables above)
  id bigint identity, entity (shop_settings | shop_hours | closure_override |
  appointment_type), entity_id uuid null (null for shop_settings),
  event_type (created | updated | deleted), payload jsonb (created/deleted:
  the row; updated: {"column": {"from","to"}} for changed columns only),
  reason (private.change_reason()), actor_staff_id, actor_user_id,
  correlation_id, created_at

appointments
  id uuid PK                               -- client-made: the idempotency key
  customer_id -> customers, bike_id null -> bikes, appointment_type_id -> appointment_types
  starts_at timestamptz, ends_at timestamptz -- snapshot: starts_at + duration (D38)
  capacity_units integer                   -- snapshot of the type (D38)
  status appointment_status default 'booked'
     -- booked | confirmed | arrived | checked_in | completed | cancelled | no_show
  source appointment_source                -- staff | customer ("Booked online")
  customer_note (≤ 1000; customers see it), internal_note (≤ 5000; staff only)
  confirmed_at, arrived_at, checked_in_at, completed_at, no_show_at,
  cancelled_at, cancellation_reason (≤ 500; staff only),
  cancelled_via appointment_source null    -- set exactly when cancelled (a channel)
  created_by_user_id -> auth.users, created_by_staff_id -> staff
  created_at, updated_at
  index (starts_at, ends_at) where status not in ('cancelled','no_show')

appointment_events (append-only; triggers)
  id bigint identity, appointment_id, event_type (booked | confirmed |
  arrived | checked_in | completed | cancelled | no_show | details_changed |
  work_order_linked), from_status, to_status, reason, payload jsonb,
  actor_staff_id, actor_user_id, correlation_id, created_at
  -- booked at created_at; a status event at its status stamp; a cancelled
  -- event's payload {"via"}; details_changed {"field": {"from","to"}} for
  -- bike_id, customer_note, internal_note; timelines order by (created_at, id)
```

**Time zone.** The shop's time zone is fixed at Asia/Singapore in the MVP
(D35, SPEC §24): `private.shop_timezone()` reads `shop_settings.timezone`
(fallback 'Asia/Singapore') and `private.shop_currency()` reads
`default_currency` (fallback 'SGD'); no RPC edits either. Every shop-day
computation goes through `private.shop_day()` / `shop_today()` /
`shop_day_start()`; a local wall-clock instant is
`(day + t) at time zone private.shop_timezone()` and the local time of an
instant `(ts at time zone private.shop_timezone())::time`.

**Open hours and closures (D38).** `private.shop_hours_ranges(day)` is the
open stretches of one shop-local date: the custom-hours override covering
the date if there is one (it replaces every weekly interval), else the
active weekly intervals of that weekday, merged (adjacent intervals form one
stretch; `day + time '24:00'` is the next midnight). `closed` overrides are
`[starts_at, ends_at)` (whole days or part of one day) and beat custom
hours; `custom_hours` rows always span whole shop-local days
(`save_closure_override` builds them) and never overlap each other.

**The slot grid and capacity (D2, D38).** Capacity windows are
`intake_slot_minutes` long and aligned to shop-local midnight
(`private.appointment_windows`). An appointment takes its `capacity_units`
in every window it overlaps; cancelled and no-show appointments take
nothing. A booking must start on the grid, lie wholly inside one open
stretch of one shop-local date, overlap no closed override and fit every
window: `private.appointment_slot_problem(starts_at, ends_at, units,
exclude_id)` returns the first code that fails, in the order
`appointment_slot_misaligned`, `appointment_outside_hours`,
`appointment_closed`, `appointment_capacity_exceeded` (or null).
`private.capacity_for_window(window_start, window_end)` returns
`intake_capacity_units` today; it is the D2 EXTENSION POINT (a later
migration replaces it to derive capacity from mechanic hours, leave and
skills) and nothing else reads `intake_capacity_units` for capacity.
`private.available_slots_at(day, type_id, as_of, for_staff)` lists the grid
starts of `day` that pass, with `remaining_units` (the least free capacity
over the overlapped windows before the booking); staff keep slots that
have not ended, everyone else only starts within the notice and horizon of
public active types (D37). Settings changes never move, shrink or cancel an
appointment: `ends_at` and `capacity_units` are snapshots (D38).

**Status machine (D39).** booked → confirmed | arrived | checked_in |
cancelled | no_show; confirmed → arrived | checked_in | cancelled |
no_show; arrived → checked_in | cancelled; no_show → arrived; checked_in →
completed. cancelled and completed are final. The trigger
`appointments_enforce_rules` enforces it for every writer, stamps the
status's `*_at` (a writer may provide an earlier business stamp), requires
`private.change_reason()` to cancel (it becomes `cancellation_reason`;
`cancelled_via` defaults to staff) and keeps customer, type, times, units,
source and creator immutable (`appointment_immutable`); the bike changes
only before check-in and must be the customer's and not archived. Staff
mark confirmed / arrived / no_show (`mark_appointment_status`; no_show only
after the start; no_show → arrived only on its own shop-local date, with a
capacity re-check), cancel with `cancel_appointment`, check in through
step 2's `check_in_appointment` (D40); completed follows the work order
(D36).

**Locks and keys.** Lock order, followed by every path so nothing
deadlocks: (a) the `shop_settings` row — FOR SHARE by appointment writers
that read settings, FOR UPDATE by the admin configuration RPCs (which
serialises configuration changes); (b) the per-customer advisory lock
`pg_advisory_xact_lock(hashtextextended('bicii.appointments.customer.' ||
customer_id, 0))` (`private.appointment_lock_customer`; customer
self-booking only; Phase 11 reuses it); (c) the per-day advisory lock
`hashtextextended('bicii.appointments.' || local_day, 0)`
(`private.appointment_lock_day`) and/or the appointment row FOR UPDATE —
`mark_appointment_status` takes the row, then the day lock; booking never
locks an appointment row; (d) step 2's check-in then takes the work order,
customer and bike row locks through Phase 3's path: `check_in_appointment`
holds the appointment row FOR UPDATE, then the existing work order FOR
UPDATE (when linking one), then the customer and the bike FOR SHARE (the
order `private.create_work_order` uses). The D36 completion trigger runs
under the job's row lock and then updates its appointment, but only an
appointment that is already checked in, for which check-in never locks a
work order (it returns the existing link), so no cycle forms. Bookings of one day
therefore serialise, so two bookings for the last unit cannot both succeed.
Every booking is idempotent on its client-made id (same customer, type and
start → the original row, even after the type was deactivated; otherwise
`appointment_conflict`); closures and types are saved by client-made ids
with `is_new` insert-or-replay semantics (`closure_conflict`,
`appointment_type_conflict`). Walk-ins never create an appointment.

Future-proofing (tables designed now, created when needed, no code paths in
MVP): `staff_working_hours`, `staff_leave`, `staff_skills`,
`appointment_types.required_skill`. Nothing in the booking RPC assumes a
mechanic.

## 4. Workshop

Phase 3 migrations: `…1200_workshop_catalog` (§5), `…1300_work_orders`,
`…1400_work_order_lines` (§5), `…1500_workshop_rpcs`.

```
work_orders                              -- written only through RPCs (§16)
  id uuid PK                             -- client-chosen: the check-in's idempotency key
  job_number text not null unique        -- J-000456: assigned on insert from next_short_id('J')
                                         --   whatever the caller sent (D9); immutable
  customer_id uuid not null -> customers
  bike_id uuid not null -> bikes
  appointment_id uuid null -> appointments (on delete restrict)
                                         -- unique where not null (work_orders_appointment_id_key);
                                         --   set once (insert, or null -> value), never changed or cleared;
                                         --   only to a checked_in appointment of the same customer and bike (D40)
  lead_mechanic_id uuid null -> staff    -- = the active lead assignment's staff_id (trigger-kept)
  status work_order_status not null default 'received'
     -- enum: received | diagnosing | awaiting_customer | awaiting_parts |
     --       ready_to_start | in_progress | paused | completed |
     --       ready_for_collection | collected | cancelled
  requested_work text not null           -- 1..2000
  intake_notes text null                 -- condition on arrival, ≤ 5000
  internal_notes text null               -- staff only, ≤ 10000
  completion_notes text null             -- ≤ 5000
  approval_flag boolean not null default false   -- optional internal flag (SPEC §7.1)
  approval_note text null                -- ≤ 500
  checked_in_at timestamptz not null default clock_timestamp()
  status_changed_at timestamptz not null -- time of the last status change (= checked_in_at at first)
  started_at, completed_at, ready_for_collection_at, collected_at timestamptz null
  cancelled_at timestamptz null, cancellation_reason text null (≤ 500)
  currency char(3) not null default 'SGD'
  created_by uuid -> staff, created_at, updated_at
  checks (named; every named check and unique index in the migrations is mapped in
    db-errors.ts, enforced by tests/unit/db-errors.test.ts): collected ⇔ collected_at; cancelled ⇔
    cancelled_at and cancellation_reason; completed/ready_for_collection/collected ⇔
    completed_at; ready_for_collection_at needs completed_at; ready_for_collection
    needs ready_for_collection_at; completed_at needs started_at; started_at,
    completed_at, status_changed_at ≥ checked_in_at; collected_at > completed_at
  index (status), (customer_id, checked_in_at desc), (bike_id, checked_in_at desc),
        (lead_mechanic_id), (checked_in_at), (completed_at), (collected_at)

work_order_assignments                   -- rows are closed, never edited or deleted
  id, work_order_id, staff_id, role assignment_role   -- enum: lead | additional
  assigned_by -> staff, assigned_at (clock_timestamp), unassigned_at null, unassigned_by null
  unique (work_order_id, staff_id) where unassigned_at is null      -- …_active_staff_key
  unique (work_order_id) where role = 'lead' and unassigned_at is null  -- …_one_lead_key

work_order_events  (append-only for every writer, the owner included)
  id bigint identity PK
  work_order_id uuid -> work_orders
  event_type work_order_event_type
     -- enum: checked_in | status_changed | completed | ready_for_collection |
     --       collected | cancelled | reopened | assignment_changed | note_added |
     --       diagnosis_added | details_changed | approval_flagged | photo_added |
     --       photo_removed | line_added | line_voided | stock_consumed | stock_reversed
  actor_staff_id uuid null -> staff (null = outside the app), actor_user_id uuid null (auth.uid())
  payload jsonb not null default '{}' (an object)
  correlation_id text null, created_at (clock_timestamp)
  index (work_order_id, created_at, id), (event_type, created_at), (actor_staff_id)
```

Status machine (D15, D16): `private.work_order_transition_rule(from, to)`
returns `allowed`, `reason_required` or null; `src/lib/workshop.ts`
(`transitionRule`) mirrors it and a database test compares all 121 pairs.

| From | Allowed | Reason required |
|---|---|---|
| received | diagnosing, awaiting_customer, awaiting_parts, ready_to_start, in_progress | cancelled |
| diagnosing | awaiting_customer, awaiting_parts, ready_to_start, in_progress | cancelled |
| awaiting_customer | diagnosing, awaiting_parts, ready_to_start, in_progress | cancelled |
| awaiting_parts | diagnosing, awaiting_customer, ready_to_start, in_progress | cancelled |
| ready_to_start | diagnosing, awaiting_customer, awaiting_parts, in_progress | cancelled |
| in_progress | diagnosing, awaiting_customer, awaiting_parts, paused, completed | cancelled |
| paused | diagnosing, awaiting_customer, awaiting_parts, in_progress, completed | cancelled |
| completed | ready_for_collection, collected | in_progress ("reopen") |
| ready_for_collection | collected | in_progress ("reopen") |
| collected, cancelled | — (final) | — |

The same status is not a transition: `set_work_order_status` returns the row
unchanged (a replay). Nothing returns to `received`. "Open" means before
completion (received … paused): only open jobs take or void lines (D15) or
can be cancelled (D16, and only with no live line). "Closed" means collected
or cancelled: assignments and the approval flag no longer change; details
and notes still may.

Stamps. `private.work_orders_enforce_rules` (BEFORE INSERT OR UPDATE, every
writer) derives them from `status_changed_at`, which it sets to
`clock_timestamp()` unless the writer moved it forward (backfills; moving it
back is 22023): entering `in_progress` sets `started_at` only if it is null
(never cleared); `completed` sets `completed_at`; `ready_for_collection`
sets `ready_for_collection_at`; `collected` sets `collected_at`;
`cancelled` sets `cancelled_at` and `cancellation_reason` (the reason).
A reopen (completed or ready_for_collection → in_progress) clears
`completed_at` and `ready_for_collection_at`. DEVIATION, owner to confirm
before Phase 5: reopen clears completion stamps, which deviates from
DATA-MODEL §4's original "stamps exactly once, never clearing an earlier
stamp" and moves D3 recognition to the final completion. Phase 4 returns
sold units to held_for_customer on reopen (whenever `completed_at` goes from
non-null to null every unit on a non-voided inventory line of the job goes
sold → held_for_customer; whenever `completed_at` goes from null to
non-null, including re-completion after a reopen, they go
held_for_customer → sold), with no stock movement (D6, D25). Phase 3 keeps
the reopen rule in `private.work_orders_enforce_rules` (BEFORE INSERT OR
UPDATE), commented as the Phase 4 extension point; Phase 4 resolved that
extension point with a separate trigger and left the function as it is:
`work_orders_sell_held_units`, SECURITY DEFINER, `AFTER UPDATE ON
work_orders FOR EACH ROW WHEN (old.completed_at is distinct from
new.completed_at)`. It has no column list on purpose: `completed_at` is set
and cleared by the BEFORE trigger and is never in an UPDATE's target list,
so an `UPDATE OF completed_at` trigger would never fire. Under the job lock
`set_work_order_status` already holds, it takes `private.lock_stock` per
product (ascending) and the units FOR UPDATE (ascending); on completion
(including re-completion) held_for_customer units become sold with
`sold_at = completed_at` (cause `job_completed`) and
`private.refresh_unique_publication` runs per product; on reopen it first locks the linked bikes of
those units FOR UPDATE (ascending, lock order step 4) and refuses with
`bike_with_customer` when a sold unit's bike now has a customer (D29: the
bike goes back to the shop first); otherwise sold units
with no sale line go back to held_for_customer, `sold_at` null (cause
`job_reopened`), with no movement and no publication change. Stamps never change without a status change, and `job_number`,
`customer_id`, `bike_id`, `currency`, `created_by`, `created_at` and
`checked_in_at` never change (`work_order_immutable`); `lead_mechanic_id`
may only become the active lead (so only the assignments trigger moves it).
`appointment_id` is linked at most once: it is set on insert
(`private.create_work_order`) or may go from null to a value exactly once on
update, and once set it never changes and is never cleared
(`work_order_immutable`, P3's rule in `work_orders_enforce_rules`, which
Phase 2 relies on and does not replace). Phase 2 (`…3100`, D40) adds the
foreign key, the partial unique index and three triggers: BEFORE INSERT OR
UPDATE OF appointment_id `work_orders_appointment_rules` (only when a value
is SET: the appointment must exist (P0002) and be `checked_in`
(`appointment_not_checked_in`) with the job's customer and bike
(`appointment_work_order_mismatch`), for every writer); AFTER INSERT OR
UPDATE OF appointment_id `work_orders_sync_appointment_link` (named to fire
after `work_orders_record_history`, so the job's `checked_in` comes first:
the appointment's `work_order_linked` event `{work_order_id, job_number,
created}` and the job's `appointment_linked` event `{appointment_id,
starts_at, appointment_type_name, created}`, both dated
`greatest(job.checked_in_at, appointment.checked_in_at)`, the check-in
instant; customers never see it, `my_work_order_timeline` whitelists event
types); and AFTER UPDATE OF status `work_orders_sync_appointment_completion`
(D36: when a linked job first reaches completed, ready_for_collection or
collected, a `checked_in` appointment becomes `completed` at the job's
`completed_at`, with the current staff member as actor; a reopen does not
reopen it, a cancelled job leaves it checked_in). `check_in_appointment`
(§16) creates the job through `private.create_work_order` or links an open,
unlinked job this way. An insert must be `received`
with no lead and no stamps; the customer and the bike must exist and not be
archived (`work_order_customer_archived`, `work_order_bike_archived`), and
the customer must own the bike or the bike must have no owner (D18,
`bike_owner_mismatch`). `completed_at` and `collected_at` are different
events and different timestamps (SPEC §23); reports use `completed_at` as
the job's recognition date (D3).

Timeline. Triggers write the events, so no writer skips them, through
`private.record_work_order_event(work_order_id, event_type, payload, at)`
(actor = `current_staff_id()`, `auth.uid()`, correlation from the request);
`created_at` is the row's own business timestamp, so backfills stay
consistent. One event per action:

| Event | When | Payload |
|---|---|---|
| `checked_in` | job inserted, at `checked_in_at` | `job_number, customer_id, bike_id, requested_work` |
| `status_changed` / `completed` / `ready_for_collection` / `collected` / `cancelled` / `reopened` | each status change, at `status_changed_at` (exactly one event, typed by the target; `reopened` for completed/ready → in_progress) | `from, to, note` (+ `started: true` when it stamped `started_at`) |
| `details_changed` | requested work or notes edited | `{field: {from, to}}` per changed field |
| `approval_flagged` | flag or note changed | `flagged, note` |
| `assignment_changed` | assignment inserted / closed, at `assigned_at` / `unassigned_at` | `action (assigned/unassigned), staff_id, role` |
| `note_added` / `diagnosis_added` | `add_work_order_note` | `note_id, body` (`note_id`, the client's key, unique: `work_order_events_note_id_key`) |
| `photo_added` / `photo_removed` | job attachment recorded (at its `created_at`) / deleted | `attachment_id, visibility` / `attachment_id, reason` |
| `line_added` / `line_voided` | line inserted (at `created_at`) / voided (at `voided_at`) | `line_id, line_type, description, quantity, unit_sale_price, sale_total, currency` / `line_id, description, quantity, sale_total, reason` |
| `stock_consumed` / `stock_reversed` | `add_inventory_line` / the `void_line` inventory branch (Phase 4) | `line_id, movement_id, product_id, product_short_id, inventory_unit_id, unit_short_id, location_id, location_name, quantity, on_hand_after` / `line_id, movement_id, reversal_of_id, product_short_id, unit_short_id, location_name, quantity, on_hand_after` |

Payloads never contain cost, yield, rate or Cult Commons values: every
staff member reads the timeline, with or without `view_costs` (a test walks
every key and value). DATA-MODEL originally said "status_changed plus the
specific event"; one event per status change is the as-built rule. Nothing
is written for no-ops (same status, unchanged details, an existing
assignment, a replayed check-in or line).

Assignments (D22): any active staff member assigns or unassigns anyone
active (`staff_inactive`) on a job that is not closed (`work_order_closed`).
A new lead closes the previous lead's row (they leave the job; not demoted);
switching someone's role closes their row and opens one in the new role.
The AFTER trigger keeps `work_orders.lead_mechanic_id` equal to the active
lead.

Photos (D19): `private.attachment_entity_exists` knows `work_order`. Photos
on a job are `internal` or `customer`, never `public`
(`attachment_work_order_never_public` from a trigger for
`record_attachment` and `set_attachment_visibility`; CHECK
`attachments_work_order_never_public` as the backstop).

Lock order. Every RPC that touches a work order and its lines locks the
`work_orders` row FOR UPDATE (`private.lock_work_order`, which raises P0002
when the job is absent and checks no status) before any of its line rows
FOR UPDATE, so concurrent calls on one job serialise in one order;
`private.require_open_work_order` takes the same lock and then refuses a job
that is not open (`work_order_locked`). The line triggers' FOR SHARE on the
job follows the same order for direct writers. Phase 4's
`add_inventory_line` and `void_line` replacement call
`private.lock_work_order`, then the replay lookup (so a replay after
completion returns the original), then `private.require_open_work_order`;
§7 extends the order to stock, units and products.

Customers (D17) never read these tables (staff-only RLS); they read their
own jobs through the `my_work_order*` RPCs (§15 "Customer job projection",
§16; migration `20261004001600_workshop_customer_access`). Staff find a job
by its number through `staff_search` (`work_order` kind, migration
`…1700_workshop_search`).

## 5. Services and line items

```
categories
  id, kind category_kind (service | product), name (1..80, trimmed), parent_id null
  (unused by MVP screens), sort_order, created_at, updated_at, archived_at
  unique (kind, lower(name)) where archived_at is null   -- categories_active_name_key

services                                 -- written only through RPCs (§16)
  id, name (1..120, trimmed), description (≤ 2000), category_id null -> categories
  (a service category: category_kind_mismatch),
  default_sale_price money_amount not null (≥ 0),
  default_direct_cost money_amount not null default 0 (≥ 0)   -- no column grant (view_costs)
  currency char(3) default 'SGD', active, public, sort_order
  created_at, updated_at, archived_at
  unique (lower(name)) where archived_at is null    -- services_active_name_key

services_staff (view)                    -- every column incl. the cost; rows only for view_costs

cult_commons_rates                       -- append-only except cancelling a future rate (D21)
  id, rate rate_fraction not null (0..1), effective_from timestamptz not null,
  created_by null -> staff, created_at (clock_timestamp),
  cancelled_at null, cancelled_by null -> staff
  unique (effective_from) where cancelled_at is null
  -- base row cc000000-…-000000000001: 0.3000 from 1970-01-01, in the migration (not the seed)

work_order_line_items                    -- immutable except voiding; never deleted
  id uuid PK                             -- client-chosen: the add's idempotency key
  work_order_id uuid -> work_orders
  line_type line_type not null           -- enum: service | inventory | manual
  source_service_id uuid null -> services
  source_product_id uuid null -> products            -- FK added in Phase 4
  source_inventory_unit_id uuid null -> inventory_units  -- FK added in Phase 4;
     -- partial unique index work_order_line_items_unit_once (live lines only)
  description_snapshot text not null     -- 1..300
  quantity line_quantity not null        -- numeric(10,2), NaN-free domain; 0 < q ≤ 9999
  unit_sale_price_snapshot money_amount not null (≥ 0)
  unit_direct_cost_snapshot money_amount not null (≥ 0)
  cost_pending boolean not null default false
                                         -- a manual line added with no cost (D14): the 0
                                         -- above is a placeholder; check cost_pending_shape
  cult_commons_rate_snapshot rate_fraction not null (0..1)
  currency char(3) not null              -- the job's
  -- generated, stored, typed money_amount (each expression written out:
  -- a generated column cannot reference another):
  sale_total         = round(q × price, 2)
  cost_total         = round(q × cost, 2)
  yield_total        = round(q × price, 2) − round(q × cost, 2)
  cult_commons_share = round(greatest(round(q × price, 2) − round(q × cost, 2), 0) × rate, 2)
  created_by, created_at (clock_timestamp)
  voided_at null, voided_by null, void_reason null (1..500; set together)
  checks: service lines name a service and nothing else; manual lines no source;
    inventory lines a product, whole quantities; a unique unit has quantity 1
  index (work_order_id, created_at), (source_service_id), (source_product_id)
```

The arithmetic lives in generated columns so no application code can produce
a different number (`src/lib/cult-commons.ts` copies it for previews only;
a shared fixture table runs through both). A line snapshots its economics
when it is added: the description (service name unless overridden), unit
sale price and cost (service defaults unless overridden, D14) and the Cult
Commons rate from `private.cult_commons_rate_at(clock_timestamp())` (the
non-cancelled row with the latest `effective_from` ≤ that time;
`cult_commons_rate_missing` if none). Editing, archiving or deactivating a
service, or scheduling a new rate, never changes an existing line. Lines are
listed by `created_at` (there is no `sort_order`).

Rates (D21): only admins schedule (`schedule_cult_commons_rate`, now or
later, `rate_backdated` otherwise) or cancel (`cancel_cult_commons_rate`,
only while `effective_from` is in the future, `cult_commons_rate_in_effect`
otherwise) a rate; for every writer the rows are append-only
(`cult_commons_rates_append_only`) except setting `cancelled_at`/
`cancelled_by` once on a rate that has not started.

Totals per work order: `work_order_totals` (security invoker: job, currency,
live `line_count`, `sale_total`) for every staff member;
`work_order_totals_staff` adds `cost_total`, `yield_total`,
`cult_commons_share` (Σ line shares, D1), `bicii_yield_after_cc =
yield_total − cult_commons_share` and `cost_pending_count` (live lines with
no cost entered, D14: while it is above 0 the cost-side figures count those
lines at 0 and are provisional; the job page says so, and later reports
must too); `work_order_line_items_staff` returns every line column. Both `_staff` views are security-barrier definer views
that return rows only when `private.has_permission('view_costs')`;
`authenticated` holds SELECT on `work_order_line_items` only for the sale
side (no unit cost, rate, cost, yield or Cult Commons columns; `cost_pending`
is granted, since it says only that a cost is missing) and on `services` for
every column except `default_direct_cost`. The security definer writers to
those two tables re-raise a check or not-null violation through
`private.raise_without_row` (§16): Postgres would otherwise put the whole
row, hidden columns included, in the error's DETAIL.

Cult Commons: `cult_commons_share = max(yield, 0) × rate` per line, where
`yield = sale − direct cost` and the consignor payout is direct cost.
Negative yield reports a loss and never produces a negative share, nor
offsets another line (D1).

Lines change only while the job is open (D15, `work_order_locked`), checked
by the BEFORE trigger for every writer (it locks the job `for share`), and
are voided with a reason (`void_line`); a job is not cancelled while it has
a live line (D16, `work_order_has_lines`, trigger
`private.work_orders_cancel_requires_no_lines`). That is the single
cancel-with-lines rule; it covers Phase 4's inventory lines too, so Phase 4
adds no separate parts rule or code. The line RPCs follow the lock order in
§4: the `work_orders` row FOR UPDATE (`private.lock_work_order`) before any
line row FOR UPDATE.

Deviations from this document's earlier draft, each for a reason:

- (a) Lines are immutable except voiding and have no `sort_order`; the
  earlier draft allowed `sort_order` and `description_snapshot` typo fixes.
  Void and re-add keeps the evidence and matches the Phase 4 stock ledger.
- (b) `add_service_line`, `add_manual_line`, `void_line` and the service
  RPCs return ids, not rows (§16 says RPCs return the affected row): rows
  carry cost columns, and an RPC result is not column-gated.
- (c) `work_orders` and `services` are written only through RPCs (§15's
  earlier "S" insert/update for work orders and "A / P(manage_inventory)"
  for services are stricter now).
- (d) The anonymous/customer services listing in §15 arrives with Phase 11
  through a separate customer-safe projection.
- (e) The Cult Commons base rate ships in the migration, not the seed.
- (f) A manual line added without a cost is stored with cost 0 and
  `cost_pending` (D14, owner to confirm), rather than a nullable cost, so
  the generated arithmetic stays one expression; it is corrected by voiding
  and re-adding it with the cost.

## 6. Catalog and inventory

Built in Phase 4 (`20261004001800_inventory.sql`). Money columns are
`money_amount`, quantities `integer`. Every table has RLS: staff read;
`manage_inventory` writes locations and products; customers and anonymous
visitors read nothing (the anonymous surface is `reporting.public_items`,
§11, built in `20261004002100_inventory_publication.sql`).

```
locations
  id uuid PK
  name text not null (≤ 80, trimmed, non-blank), constraint locations_name_key unique
  kind location_kind not null default 'shop_floor'
     -- enum: shop_floor | workshop | storage | offsite
  active boolean not null default true
  sort_order integer not null default 0
  created_at, updated_at
  -- The DEFAULT location is the active one with the lowest (sort_order,
  -- name); there is no flag. The migration inserts the one-shop bootstrap
  -- 'Shop floor' (1c000000-…-000000000001, sort 10), so a hosted database
  -- works without the seed (SPEC §11). Deactivating a location whose
  -- ledger on-hand is non-zero for any product raises location_has_stock.

products
  id uuid PK                               -- client-supplied by the form id
  short_id text not null unique            -- P-######, assigned by trigger, immutable
  sku text null (≤ 64)
  sku_key text generated                   -- upper(sku) without punctuation;
                                           -- unique index products_sku_key_unique
  name text not null (≤ 200), description text (≤ 5000), brand text (≤ 100)
  category_id uuid null -> categories      -- kind must be 'product' (category_kind_mismatch)
  tracking_type tracking_type not null     -- enum: quantity | unique; immutable
  ownership_type ownership_type not null default 'shop_owned'
     -- enum: shop_owned | consignment | customer_owned; not client-writable
  publication_status publication_status not null default 'draft'
     -- enum: draft | internal_only | public | sold | archived (§11, D26)
  public_slug text null unique             -- set at first publish, never changes
  default_sale_price money_amount null ≥ 0
  default_direct_cost money_amount null ≥ 0  -- no column grant: product_costs
  currency char(3) not null default 'SGD'
  reorder_point integer null ≥ 0           -- low stock: on_hand <= reorder_point
  shopify_product_id text null unique, shopify_variant_id text null unique  -- Phase 10
  active boolean not null default true
  search_text text generated (name, brand, sku; trigram index)
  created_by uuid null -> staff, created_at, updated_at, archived_at
  -- products_enforce_rules (definer, every writer): trims, assigns the
  -- short ID, keeps short_id and tracking_type immutable, enforces the
  -- publication machine and requirements (§11), assigns the slug, refuses
  -- archiving while public (product_published) or while any location's
  -- ledger is non-zero or a unit is available/reserved/held
  -- (product_has_stock).

inventory_units   (one row per physical unique item; created only by RPCs)
  id uuid PK
  short_id text not null unique            -- U-######, assigned by trigger, immutable
  product_id uuid not null -> products     -- unique-tracked (product_not_unique); immutable
  location_id uuid not null -> locations
  serial_number text null (≤ 100), serial_key generated (btree + trigram)
  condition text null (≤ 500)              -- PUBLIC once the product is published
  ownership_type ownership_type not null default 'shop_owned'
  consignment_item_id uuid null            -- no FK until Phase 6;
                                           -- required when ownership = consignment
  bike_id uuid null unique -> bikes        -- when the unit is a complete bike
  status unit_status not null default 'available'
     -- enum: available | reserved | sold | returned_to_consignor |
     --       written_off | held_for_customer
  sale_price money_amount null ≥ 0         -- overrides product default
  direct_cost money_amount null ≥ 0        -- no column grant: inventory_unit_costs
  sold_sale_line_id uuid null unique       -- no FK until Phase 6
  sold_at timestamptz null                 -- check (status = 'sold') = (sold_at is not null)
  internal_notes text (≤ 10000)
  created_by, created_at, updated_at, archived_at
  -- archived only when sold, written_off or returned_to_consignor (unit_in_stock)

product_events / inventory_unit_events   (append-only, written by triggers)
  id, product_id | unit_id, event_type, actor_staff_id, payload jsonb,
  reason (private.change_reason()), correlation_id, created_at
```

Unit status transitions (`private.unit_status_transition_allowed`,
mirrored in `src/lib/inventory.ts`; same-state pairs are false):

| From | To |
|---|---|
| available | reserved, held_for_customer, sold, returned_to_consignor, written_off |
| reserved | available, held_for_customer, sold |
| held_for_customer | available, sold |
| sold | available, held_for_customer (the latter only on a job reopen, D25) |
| written_off | available |
| returned_to_consignor | (none) |

History payloads are exact and never carry a cost (no cost column name or
value appears in any product, unit or work-order event, nor in any RPC
return). Product: `created {short_id, name, tracking_type,
publication_status}`, `details_changed {fields: [names]}` (names only),
`price_changed {from, to}`, `cost_changed {}`, `publication_changed {from,
to}`, `archived {}` / `unarchived {}`. Unit: `created {short_id,
product_id, location_id, status, ownership_type}`, `status_changed {from,
to}` merged with the event context (`{work_order_id, job_number, line_id}`
or `{work_order_id, job_number, cause: 'job_completed' | 'job_reopened'}`,
set through `private.set_event_context` and read by
`private.event_context()`), `moved {from_location_id, to_location_id}`,
`details_changed {fields}`, `price_changed {from, to}`, `cost_changed {}`,
`archived {}` / `unarchived {}`.

Cost gating uses Phase 3's mechanism: `authenticated` has no column grant on
`products.default_direct_cost`, `inventory_units.direct_cost` or
`inventory_movements.unit_cost_snapshot` (so `select *` fails; callers list
columns), and reads them through the definer `security_barrier` views
`product_costs`, `inventory_unit_costs` and `inventory_movement_costs`
(rows only for `view_costs`), which also give expected yield and expected
Cult Commons with exactly Phase 3's generated expression for quantity 1
(D1). `public.selling_prices` gives every active staff member the
effective selling price of each product (unit null) and unit. Direct API
writes of a cost column by a caller without `view_costs` are refused (42501)
whatever the value (an UPDATE naming the column is refused even when it
equals the stored cost, so the refusal is never an equality oracle on a
hidden cost) by two SECURITY INVOKER triggers, `products_cost_write_guard` and
`inventory_units_cost_write_guard` (invoker because inside a definer
function `current_user` is the owner; definer RPCs check `view_costs`
themselves). Definer writes to these tables re-raise check and not-null
violations without the row (`private.raise_without_row`).

Photos on stock (`product`, `inventory_unit`) are internal or public, never
customer (`attachment_stock_never_customer`, backstop CHECK
`attachments_stock_never_customer`; D13 extended, D19's pattern).

A shop bike linked to a unit that is available, reserved or
held_for_customer cannot be given to a customer or archived:
`bikes_guard_stock_link` (BEFORE UPDATE … WHEN customer_id or archived_at
changes) raises `bike_in_stock`. The other direction (D29): a unit whose
linked bike has a customer never goes back into stock; the reopen trigger
and `void_line` refuse with `bike_with_customer`, and
`private.assert_unit_consistent` is the backstop. `bikes.inventory_unit_id`
has its FK and a unique index; `private.register_unit` sets it.

`supplier_products` moved to Phase 7 (`suppliers` does not exist before).

Quantity products print one QR (`P-...`) any number of times. Unique units
print their own (`U-...`). A bulk unit that becomes special is
`split_unit_from_stock` (Phase 4, D28; §16): a `stock_adjustment` of −1
on the source plus a new draft unique product and its available unit at
the same location, both carrying the source's default direct cost, and the
unit's +1 `stock_adjustment`; both movements have request_id = the new
unit id.

## 7. Inventory movement ledger

```
inventory_movements  (append-only for every writer; inserted only through private.record_movement)
  id bigint identity PK
  product_id uuid not null -> products
  inventory_unit_id uuid null -> inventory_units
  location_id uuid not null -> locations
  quantity_delta integer not null check (<> 0 and |delta| <= 100000)
  movement_type movement_type not null
     -- enum: purchase_received | job_consumption | retail_sale | online_sale |
     --       stock_adjustment | damaged | return | consignment_received |
     --       consignment_returned | transfer | reversal
  work_order_id uuid null -> work_orders
  work_order_line_item_id uuid null -> work_order_line_items
  sale_line_id uuid null                   -- FK in Phase 6
  purchase_receipt_line_id uuid null       -- FK in Phase 7
  consignment_item_id uuid null            -- FK in Phase 6
  request_id uuid null                     -- the calling RPC's per-call key;
                                           -- a transfer's two rows share it
  reversal_of_id bigint null unique -> inventory_movements
  unit_cost_snapshot money_amount null ≥ 0 -- no column grant: inventory_movement_costs
  currency char(3) not null default 'SGD'  -- the product's
  reason text null                         -- non-blank, ≤ 500
  created_by uuid null -> staff, correlation_id text, created_at (clock_timestamp)
  check inventory_movements_unit_delta: inventory_unit_id is null or abs(quantity_delta) = 1
  check inventory_movements_reason_required: stock_adjustment/damaged need a reason
  check inventory_movements_reversal_shape: (type = reversal) = (reversal_of_id is not null)
  check inventory_movements_job_consumption_shape: job_consumption needs the job and line, delta < 0
  check inventory_movements_damaged_negative, inventory_movements_transfer_request
```

`request_id` replaces the original `transfer_group_id`: it is each call's
idempotency key, generated by the client for that one call. No RPC reuses
another entity's id or another call's key as its request_id, except that
`create_unique_unit` and `split_unit_from_stock` use the client's new unit
id, which is created for that one call.

The partial unique indexes are the idempotency guarantees. Phases 6, 7 and
10 rely on these exact predicates:

| Index | Predicate |
|---|---|
| `inventory_movements_job_consumption_once` | unique (work_order_line_item_id) where movement_type = 'job_consumption' |
| `inventory_movements_sale_line_once` | unique (sale_line_id) where movement_type in ('retail_sale','online_sale') |
| `inventory_movements_receipt_line_once` | unique (purchase_receipt_line_id) where movement_type = 'purchase_received' |
| `inventory_movements_request_once` | unique (request_id, product_id, location_id) where request_id is not null |
| `inventory_movements_reversal_of_id_key` | unique (reversal_of_id) |

Plus btree indexes on (product_id, location_id, id), (inventory_unit_id,
id), work_order_id, work_order_line_item_id, created_by and (id desc).

`inventory_movements_enforce_rules` (BEFORE INSERT) requires a unit for a
unique product and forbids one for a quantity product, checks the unit's
product, requires a reversal to undo exactly one non-reversal movement
(same product, unit, location, opposite delta; `movement_invalid`), and
fills created_by and correlation_id. UPDATE and DELETE raise
`movement_append_only` for every writer.

Stock on hand is `reporting.stock_levels` (§14): the sum of quantity_delta
per product and location. A cached `inventory_balances` table may be added
later as a projection; `reporting.stock_reconciliation` (Phase 9) compares
the two.

Unique-unit invariant, proved by the database: two DEFERRABLE INITIALLY
DEFERRED constraint triggers named `inventory_unit_ledger_consistent` (on
inventory_movements after insert of a unit row; on inventory_units after
insert or a change of status, location or bike) call
`private.assert_unit_consistent(unit_id)` at commit: while available or
reserved the unit's ledger nets to 1 at its own location and 0 elsewhere; in
every other status it nets to 0 at every location; a linked bike points
back and, while the unit is available, reserved or held_for_customer, has no
customer (D29). Otherwise `unit_ledger_inconsistent`. held_for_customer ↔ sold (job
completion and reopen, D25) needs no movement.

**Global lock order** (binding for Phase 4 and every later phase that
touches stock):

1. the work_orders row FOR UPDATE, always through `private.lock_work_order`
   (never FOR SHARE on a work order before FOR UPDATE in one transaction);
2. the work_order_line_items row FOR UPDATE;
3. `private.lock_stock(product_id)` (a transaction advisory lock); several
   products in ascending product_id;
4. the bikes row FOR UPDATE (`create_unique_unit`, before `register_unit`
   links the bike; `void_line` and the reopen branch of
   `work_orders_sell_held_units`, before the unit, for the D29 owner check);
   several bikes in ascending id;
5. the inventory_units row FOR UPDATE; several units in ascending id;
6. the products row FOR UPDATE (only `private.refresh_unique_publication`
   and `set_publication_status`, which takes `lock_stock(product)` first).

Every RPC takes its locks before its replay check and any other read;
functions that lock and then read stay VOLATILE.

Private extension points (security definer, no grants):

| Function | Contract |
|---|---|
| `private.record_movement(product, unit, location, delta, type, reason, unit_cost_snapshot, request_id, work_order_id, line_id, reversal_of_id)` | THE single insert path; currency from the product; refuses an inactive location except for a reversal |
| `private.register_unit(unit_id, product, location, ownership, serial, condition, sale_price, direct_cost, bike_id, consignment_item_id)` | THE single unit-creation path, plus the bike link; Phase 6 creates consigned units through it |
| `private.selling_price(product_id, unit_id)` | THE single selling-price source: unit.sale_price, else product.default_sale_price. Phase 6 replaces it to return the consignment asking price; Phase 8 labels and Phase 10 Shopify use it unchanged. EXECUTE for authenticated and anon, because the cost views and `reporting.public_items` call it as the caller (`create or replace` keeps the grants) |
| `private.lock_stock(product_id)` | the per-product stock lock |
| `private.stock_on_hand(product_id, location_id)` | ledger on-hand |
| `private.refresh_unique_publication(product_id)` | public → sold when no unit is in stock and one is sold; sold → public when a unit is available again (skips requirements). Every path that makes a unit available calls it after the unit change: `void_line`, `create_unique_unit` (a new unit on a sold product), and later restock paths |
| `private.publication_transition_allowed`, `private.unit_status_transition_allowed`, `private.publication_requirements_met` | the state machines and publication requirements |
| `private.set_event_context(jsonb)`, `private.event_context()` | transaction-local extra keys for unit history |

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
  quantity line_quantity not null check (quantity > 0)   -- numeric(10,2), NaN-free domain
  unit_sale_price_snapshot, unit_direct_cost_snapshot money_amount not null
  cult_commons_rate_snapshot rate_fraction not null
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
  `reporting.public_items` (built in Phase 4, `20261004002100_inventory_publication.sql`;
  below). Unknown or unpublished IDs are simply absent from it, so they
  404 identically and the URL space leaks nothing.
- `reporting.public_items` is the ONLY anonymous inventory surface (§15)
  and Phase 11's contract. A definer view `with (security_barrier)` that
  reads the staff-only tables as its owner and filters itself; SELECT for
  anon and authenticated. Columns, exactly and in this order: `kind`
  (`product` | `unit`), `short_id`, `slug` (the product's `public_slug`,
  also on unit rows), `name`, `description`, `brand`, `category` (the
  category's name), `condition` (null for products), `sale_price`,
  `currency`, `availability` (`available` | `sold_out` | `sold` |
  `unavailable`), `photos` (jsonb), `updated_at` (a unit row's is the later
  of the unit's and the product's). Never a cost, serial number, internal
  note, location, ownership, consignor or SKU.
  - Rows: products whose `publication_status` is `public` or `sold` and
    `archived_at` is null; units of such products that are not archived
    and not `written_off` or `returned_to_consignor`. A product archived
    after its sale (sold → archived) shows neither itself nor its units.
  - `sale_price` = `private.selling_price(product_id, null)` for a product
    row and `private.selling_price(product_id, unit_id)` for a unit row, so
    Phase 6's replacement (the consignment asking price) flows through.
    A view's functions run as the caller, so anon and authenticated have
    EXECUTE on `private.selling_price`; anon has no USAGE on `private`, so
    the view is its only way to it (meta test).
  - `availability`: a quantity product is `sold` if its publication is
    sold, else `available` when its ledger on-hand (all locations) is above
    zero, else `sold_out`; a unique product is `available` when any unit is
    available, else `sold` if its publication is sold, else `unavailable`
    (its units are on a job, reserved or written off); a unit is
    `available`, `sold`, or `unavailable` for any other status.
  - `photos`: an array of `{bucket, path, width, height, caption}` (from
    `storage_bucket`, `storage_path`, `width`, `height`, `caption`) built
    only from `visibility = 'public'` attachments. A product row has the
    product's photos, oldest first; a unit row has the unit's, then the
    product's, then its linked bike's, each oldest first, the bike's
    limited to those created before the earlier of `unit.sold_at` and the
    bike's first transfer to a customer at or after the unit's creation
    (`bike_ownership_events`; `infinity` when neither exists), so a photo
    taken after the bike passed to its buyer never appears, even if a later
    reopen and re-completion moved `sold_at` (D29).
- The Admin also answers `/q/{shortId}` for staff (Phase 4,
  `src/app/(staff)/q/[shortId]/page.tsx`), its only /q route: after
  `requireStaff()` it resolves the ID with `resolveShortId`
  (`src/lib/domain/scan.ts`; the prefix picks the table, read through RLS,
  archived records included) and redirects to the staff page
  (`hrefForRecord`: B → `/bikes/[id]`, J → `/jobs/[id]` by `job_number`,
  P → `/products/[id]`, U → `/units/[id]`); an unknown ID shows "No record
  with P-999999" with Scan again and Search. C- and S- (Phase 6) and PO-
  (Phase 7) return nothing until their phases extend `resolveShortId`;
  Phase 11 verifies every prefix resolves. Later phases extend that
  function, never add routes.
- The Admin scanner (`interpretScan`, `src/lib/scan.ts`) recognises the QR
  URL on every accepted public base (`scanBases()` in `src/lib/qr.ts`:
  today the environment's `NEXT_PUBLIC_PUBLIC_SITE_URL`, from Phase 8 also
  the database QR base), a `/q/{shortId}` URL on the Admin's own origin,
  or a bare short ID in any case, and opens `/q/{shortId}`. Anything else
  is shown as "Not a BICII label" and never followed.
- Publication state machine on `products.publication_status` (D26,
  `private.publication_transition_allowed`, mirrored in
  `src/lib/inventory.ts`): draft → internal_only, archived; internal_only →
  public, archived; public → internal_only, sold, archived; sold → public,
  archived; archived → internal_only. `sold` is entered only by a sale path
  (job completion; Phases 6 and 10) and only for unique products; `sold →
  public` is the system restore of `private.refresh_unique_publication`,
  which skips the requirements so a void is never blocked. Any other entry
  into `public` needs a selling price (`private.selling_price`), at least
  one `public` photo on the product, a unit or a unit's bike, and for a
  unique product an available unit (`publication_requires_price`,
  `publication_requires_photo`, `publication_requires_available_unit`);
  the products trigger enforces it for every writer. A new product starts
  draft or internal_only (`publication_initial_invalid`). `public_slug` is
  assigned at the first publish (name slug + `-` + lower(short_id), 'item'
  when the name has no letters or digits) and never changes
  (`product_slug_immutable`), through unpublish, rename and republish.
  Inventory rows are never public by default. By hand, publication changes
  only through `set_publication_status` (§16; authenticated has no column
  grant on `publication_status`), which adds D26's manual rules: `sold` is
  never chosen by hand, and a sold product leaves `sold` by hand only for
  `archived` (`publication_sold_by_sale`); its accepted targets equal
  `manualPublicationTargets` in `src/lib/inventory.ts` for every state
  (tested). A public unique product whose units are all written off stays
  public (showing `unavailable`) until staff unpublish it.

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

From Phase 4 the `reporting` schema is exposed to PostgREST
(`supabase/config.toml` `[api] schemas`, the devstack's `db-schemas`, type
generation with `--schema public,reporting`, RUNBOOK "Hosted Supabase"),
because `reporting.public_items` is the anonymous surface (§15).
`authenticated` has USAGE; `anon` has USAGE (never CREATE) for
`public_items` only, the one reporting view granted to it. The stock views
are security_invoker, so the base tables' staff-only RLS applies;
`public_items` is a definer view that filters itself (§11). `private` is
never exposed.

| View | Purpose |
|---|---|
| `financial_lines` | Built (Phase 5, D32 RECOGNITION). One row per recognised ENTRY, columns in this order: `entry_key` text ('wol:' ‖ line id, unique), `source` text, `entry_kind` text ('line'), `source_line_id` uuid, `document_id` uuid, `document_number` text, `channel` text, `recognized_at` timestamptz, `recognized_day` date (`private.shop_day`), `line_type` text, `service_id`, `product_id`, `inventory_unit_id`, `category_id` (the service's or product's), `ownership_type` text (inventory lines: the unit's, else the product's; null otherwise), `consignment_item_id` (null until P6), `customer_id`, `bike_id`, `lead_mechanic_id`, `description` text, `quantity`, `unit_sale_price`, `unit_direct_cost`, `cult_commons_rate`, `sale_total`, `cost_total`, `yield_total`, `cult_commons_share`, `bicii_yield_after_cc` (all plain numeric), `is_loss` boolean (yield < 0), `currency` text, `cost_pending` boolean. Pinned vocabulary: `source` ∈ ('work_order','sale'); `channel` ∈ ('workshop','retail','online'); `document_id` = work_orders.id or sales.id; `document_number` = the J- job number or the S- sale number; `entry_kind` = 'line'. Recognition (D3 as modified by D15, refined by D32): every non-voided line of a job with a current `completed_at` (completed, ready for collection or collected; never open or cancelled), on the shop day of that `completed_at`. Lines are frozen once completed, so the only correction is a reopen, which removes the whole job from its earlier day until it is completed again (past days can change; no reversal entries for workshop lines). Amounts come only from the line's snapshots and generated columns; each entry's Cult Commons is the line's own share (≥ 0, D1), so no negative Cult Commons payment arises; `cost_pending` lines (D14) are recognised at cost 0 and flagged. Phase 6 appends a `union all` branch from `sale_lines`/`sales` with every column in this order (source 'sale', channel from `sales.source`, `cost_pending` false); Phase 9 appends only genuinely new columns at the end, never synonyms. |
| `daily_summary` | Built (Phase 5). One row per shop day from the earliest activity day (check-in, recognised entry or movement; today when none) to `private.shop_today()`, zero-filled; columns fixed in this order: 1 `day`; 2–7 `jobs_checked_in`, `jobs_started`, `jobs_completed`, `jobs_ready_for_collection`, `jobs_collected`, `jobs_cancelled` (flows: jobs whose CURRENT stamp falls that day, D31); 8 `currency` (`private.shop_currency()`); 9 `lines_recognised`; 10–14 `gross_sales`, `cogs`, `yield_total`, `cult_commons_share` (Σ entry shares, D1), `bicii_yield_after_cc` (shop-currency `financial_lines` by `recognized_day`); 15 `loss_lines`, 16 `loss_total` (≤ 0); 17 `parts_consumed_qty`, 18 `parts_consumed_lines`, 19 `parts_returned_qty` (reversals of job consumptions); 20 `stock_adjustments`, 21 `significant_stock_adjustments` (D33); 22 `appointments_scheduled`, 23 `appointments_arrived`, 24 `appointments_no_show` (Built, Phase 2 `…3200`, D41: `appointment_daily`'s `booked`, `arrived` and `no_shows` of that day, 0 when none; the series also starts at the earliest appointment's shop day and still ends at `private.shop_today()`); placeholders, NULL now: 25 `consignment_sales`, 26 `consignment_sales_total`, 27 `new_consignor_liability` (Phase 6 fills them under these names). Integer counts and numeric money with explicit casts; Phase 9 appends new measures only after column 27. |
| `appointment_daily` | Built (Phase 2, D41 APPT-COUNTS). One row per shop day that has appointments, by SCHEDULED day (`private.shop_day(starts_at)`) and CURRENT status: `day`, `booked` (not cancelled), `expected` (booked or confirmed), `arrived` (arrived, checked_in or completed), `checked_in` (checked_in or completed), `no_shows`, `cancelled`, all integer. security_invoker, granted to no API role (it calls `private.shop_day`); read through `public.appointment_daily` (zero-filled) and daily_summary's columns 22–24. Phase 9's activity report reads it. |
| `work_order_activity` | Built (Phase 5). One row per job: `work_order_id`, `job_number`, `status` (enum), `customer_id`, `bike_id`, `lead_mechanic_id`, `appointment_id`, `currency` text; the CURRENT stamps `checked_in_at`, `started_at`, `completed_at`, `ready_for_collection_at`, `collected_at`, `cancelled_at` and their shop days `checked_in_day`, `started_day`, `completed_day`, `ready_day`, `collected_day`, `cancelled_day`; `is_open`; `is_overdue` (D20: open and `now() - checked_in_at > interval '7 days'`); `age_days` (open: today − check-in day; else completion or cancellation day − check-in day); `days_to_start`, `days_to_complete`; `days_awaiting_collection` (completed/ready: today − completion day; collected: collection day − completion day); `time_to_complete` interval. Integer days and intervals only. A reopened job's completion stamps are its latest ones (D15). |
| `operational_exceptions` | Built (Phase 5, D34). Columns in order: `kind`, `severity` ('danger' \| 'warning'), `entity_type` ('work_order', 'product', 'inventory_unit', 'work_order_line'), `entity_id`, `entity_label` (job number or P-/U- short ID), `subject_label` (customer · bike, or the product name, with the location for negative stock), `days`, `quantity`, `since`. Kinds: `overdue_job` (warning, which only orders it after danger rows: the UI shows Overdue in the danger tone, as everywhere else; exactly D20, 7 = `OVERDUE_AFTER_DAYS`, strictly more than 7 × 24 h), `uncollected_job` (warning; completed or ready, completed ≥ 7 shop days ago), `negative_stock` (danger; `stock_levels.on_hand < 0`, quantity = on-hand), `unit_hold_stale` (danger; a held_for_customer unit with no live inventory line on an open job; since = its last status change), `currency_mismatch` (danger; a would-be-recognised line not in the shop currency, excluded from totals). Kinds are text: Phase 6 (unit_state_mismatch, unsettled_consignment), Phase 9 (more kinds; columns `issue, short_id, title, detail, amount, currency` appended at the end) and Phase 10 (integration_failed) replace the view keeping these columns first. |
| `work_order_totals` / `work_order_totals_staff` | Running totals per job; the staff variant includes cost and yield. |
| `stock_levels` | Built (Phase 4): on-hand (`sum(quantity_delta)`) and `last_movement_at` per product and location from the ledger. security_invoker, SELECT to authenticated (staff rows only through RLS). |
| `product_stock` | Built (Phase 4): every product with on-hand across locations (0 when none), available and held units, `negative_locations` (locations below zero) and `below_reorder` (quantity product, reorder point set, on_hand <= reorder_point). security_invoker. |
| `stock_reconciliation` | Ledger-derived vs cached balance when the cache exists. |
| `low_stock` | Built (Phase 4): active, non-archived quantity products AT OR BELOW their reorder point (`on_hand <= reorder_point`), or below zero in total or at any location regardless of reorder point (D23); `shortfall = coalesce(reorder_point, 0) - on_hand`, largest first. security_invoker. |
| `consignor_ledger` / `consignor_item_ledger` | Owed, paid, outstanding. |
| `purchase_order_progress` | Ordered vs received per line. |
| `shopify_sync_status` | Per published product. |
| `public_items` | Built (Phase 4): the only thing anon can read about inventory, Phase 11's /q contract. Published (public or sold) products and their units with exactly `kind, short_id, slug, name, description, brand, category, condition, sale_price, currency, availability, photos, updated_at`; price from `private.selling_price`; public photos only. Definer view, security_barrier, SELECT for anon and authenticated. Rules in §11. |

Materialise `daily_summary` only if measured to be slow; refresh then runs
`after()` completion/sale mutations.

**Phase 5 reporting rules (PLAN D30–D35).**

- `financial_lines`, `daily_summary`, `work_order_activity` and
  `operational_exceptions` are security_invoker views that are granted to
  NO API role, although `reporting` is exposed (the explicit revoke is
  tested). The app reads them only through the §16 RPCs, plus Phase 4's
  granted `reporting.low_stock`.
- The RPCs select view columns BY NAME and pass the `daily_summary`
  placeholders through un-coalesced, so Phases 2 and 6 replace only the
  views (create or replace, same leading columns) and the RPC results
  follow.
- Shop days (D35): every day computation goes through
  `private.shop_day(ts)`, `private.shop_today()` and
  `private.shop_day_start(day)`, never `current_date` or `ts::date`. They
  read `private.shop_timezone()` ('Asia/Singapore') and totals use
  `private.shop_currency()` ('SGD'); Phase 2 replaces those two bodies with
  the same signatures to read `shop_settings` (timezone, default_currency)
  with these fallbacks. All five are `stable`, `language sql`, not
  definer, with no API grants. The TypeScript mirror is `SHOP_TIME_ZONE` /
  `shopDateKey` in `src/lib/dates.ts`.
- "Recognised once" needs no lock of its own: `set_work_order_status` takes
  the job FOR UPDATE (`private.lock_work_order`) before its same-status and
  transition checks, so concurrent completions serialise and a repeat
  returns the row unchanged with no event; `financial_lines` has one entry
  per live line of a job with a `completed_at`
  (`reporting-concurrency.test.ts`).
- Significant adjustment (D33) lives in one replaceable function,
  `private.is_significant_adjustment(movement_type, quantity_delta,
  is_unit, unit_cost)`: a `stock_adjustment` or `damaged` movement with
  |delta| ≥ 5, on a unique unit, or |delta| × unit cost ≥ 100.00 (unit
  cost = `unit_cost_snapshot`, else `products.default_direct_cost`, else 0).

## 15. Row-level security matrix

`S` = active staff (any), `P(x)` = staff with permission x, `A` = admin,
`C` = authenticated customer on own rows, `anon` = anonymous. RPC = only via
security-definer function. Blank = no access.

| Table | select | insert | update | delete |
|---|---|---|---|---|
| staff | S (own row + names of others); A full; A or P(manage_staff) via `staff_roster()` | RPC `create_staff` (A or P(manage_staff); only A creates A) | RPC `update_staff`, `set_staff_active` | — |
| staff_permissions | A, own | RPC `grant_permission` (A, or P(manage_staff) within D11) | — | RPC `revoke_permission` (same) |
| staff_events | A or P(manage_staff) via `staff_history()` | triggers only | never | never |
| customers | S; C own via `my_customer_profile()` | S (no `auth_user_id`, `shopify_customer_id`); C on sign-up via RPC (Phase 11) | S (same columns, `archived_at`); C own name/phone via `update_my_profile()` | — (archive) |
| bikes | S; C own current, non-archived via `my_bikes()` | S (no `short_id`: server-assigned) | S (no `short_id`, `customer_id`, `inventory_unit_id`); owner via RPC `transfer_bike_ownership` | — (archive) |
| bike_ownership_events | S | trigger only | never | never |
| attachments | S; C `customer`/`public` rows of own bikes via `my_bike_attachments()` and of own jobs via `my_work_order_attachments()` | RPC `record_attachment` (S) | S caption only; visibility via RPC `set_attachment_visibility` (S) | RPC `delete_attachment` (S, reason) |
| attachment_events | S | triggers only | never | never |
| storage `media-internal` | S | S | — | S, only objects no attachment points at |
| storage `media-public` | S (everyone else only by public URL; nobody lists it) | S | — | S, only objects no attachment points at |
| shop_settings | S; nobody else (anon/C read none of it) | — (one row, inserted by the migration) | RPC `update_shop_settings` (A) | never (`shop_settings_required`) |
| shop_hours | S; anon/C active weekly rows via `public_shop_hours()` | RPC `set_shop_hours` (A) | RPC `set_shop_hours` (A) | RPC `set_shop_hours` (A) |
| closure_overrides | S (anon/C: never listed; `available_slots` leaves closures out) | RPC `save_closure_override` (A) | RPC `save_closure_override` (A) | RPC `delete_closure_override` (A, reason) |
| appointment_types | S; anon/C active + public types (no capacity units) via `public_appointment_types()` | RPC `save_appointment_type` (A) | RPC `save_appointment_type` (A) | — (deactivate) |
| schedule_events | S | triggers only | never | never |
| appointments | S; C own via `my_appointments()` (D42 projection); anon/C bookable times via `available_slots()` (D37) | RPC `book_appointment` (S), `book_my_appointment` (C, D37) | RPC `mark_appointment_status`, `cancel_appointment`, `update_appointment`, `check_in_appointment` (S, D40); `cancel_my_appointment` (C, D37); completed only by the D36 work-order trigger | — |
| appointment_events | S | triggers only | never | never |
| work_orders | S; C own, not cancelled, via `my_work_orders()` (D17) | RPC `create_work_order` | RPC (`set_work_order_status`, `update_work_order`, `set_approval_flag`; `lead_mechanic_id` by the assignments trigger) | — |
| work_order_assignments | S | RPC `assign_staff` (S, D22) | RPC `unassign_staff` (closes the row) | — |
| work_order_events | S; C own job's check-in, customer-status changes and customer-visible photos via `my_work_order_timeline()` (D8, D17) | triggers and `add_work_order_note` only | never | never |
| categories | S | P(manage_inventory) (A included) | P(manage_inventory) | — (archive) |
| services | S, every column except `default_direct_cost`; P(view_costs) everything via `services_staff`; anon/C listing in Phase 11 through a separate projection | RPC `create_service` (P(manage_inventory); a cost needs P(view_costs)) | RPC `update_service`, `set_service_archived` (same) | — (archive) |
| cult_commons_rates | P(view_costs) | RPC `schedule_cult_commons_rate` (A) | RPC `cancel_cult_commons_rate` (A, future rates only) | never |
| work_order_line_items | S sale columns only; P(view_costs) everything via `work_order_line_items_staff`; C own job's live lines (description, quantity, unit price, total) via `my_work_order_lines()` | RPC `add_service_line`, `add_manual_line` (cost needs P(view_costs)) | RPC `void_line` (voided_* only) | never |
| work_order_totals / work_order_totals_staff (views) | S sale totals / P(view_costs) cost, yield, Cult Commons | — | — | — |
| locations | S | P(manage_inventory) (id, name, kind, active, sort_order) | P(manage_inventory) (name, kind, active, sort_order; `location_has_stock`) | — (deactivate) |
| products | S, every column except `default_direct_cost`; anon/C via `public_items` only | P(manage_inventory) (no short_id, publication, slug, ownership or Shopify ids; a cost needs P(view_costs): `products_cost_write_guard`); RPC `split_unit_from_stock` (P(adjust_stock) and P(manage_inventory)) | P(manage_inventory) (sku, name, description, brand, category, prices, reorder point, active, archived_at; cost guard as insert); publication via RPC `set_publication_status` | — (archive) |
| inventory_units | S, every column except `direct_cost` | RPC `create_unique_unit` (P(manage_inventory); cost needs P(view_costs)) | P(manage_inventory) serial, condition, prices, notes, archived_at (cost guard); status, location, bike, ownership only by RPCs and triggers | — (archive) |
| inventory_movements | S, every column except `unit_cost_snapshot` | RPCs only (`private.record_movement`) | never (`movement_append_only`) | never |
| product_events, inventory_unit_events | S | triggers only | never | never |
| product_costs, inventory_unit_costs, inventory_movement_costs (definer views) | P(view_costs): costs, expected yield and Cult Commons | — | — | — |
| selling_prices (definer view) | S: effective selling price per product and unit (`private.selling_price`) | — | — | — |
| reporting.stock_levels, product_stock, low_stock | S (security_invoker over staff-only RLS) | — | — | — |
| sales, sale_lines, sale_refunds | P(view_financial_reports) or P(view_costs) | RPC | RPC | — |
| consignors, consignment_items, charges | S; values gated | P(manage_consignments) | same | — |
| consignment_settlements, settlement_lines | P(manage_consignments) | RPC | — | — |
| suppliers, purchase_orders, lines | S | P(manage_purchasing) | same | — |
| purchase_receipts, receipt_lines | S | RPC | — | — |
| label_templates, printer_profiles | S | A | A | A |
| print_jobs | S | S | S | — |
| integration_events, retry queue, sync | A | service role only | service role / RPC | — |
| reporting.* financial views (financial_lines, daily_summary, work_order_activity, operational_exceptions) | no grants (not even SELECT to authenticated); via RPCs: S for counts; P(view_financial_reports) for money rows; cost columns P(view_costs) (FIN-ACCESS D30) | — | — | — |
| reporting.public_items | everyone: anon and authenticated (definer view, published rows and public columns only; the only anonymous inventory surface; anon has USAGE on `reporting` for it and EXECUTE on `private.selling_price`, which it calls) | — | — | — |

**Customer access pattern (Phase 1, binding for every later phase).** Staff
and signed-in customers share the `authenticated` role, so a column grant
cannot show `internal_notes` to staff and hide it from customers, and RLS
can only hide whole rows. Therefore "C own" never means a customer policy on
a base table. Base tables that hold anything staff-only (customers, bikes,
attachments, and later appointments, work orders, events, line items) have
RLS policies for active staff only (`private.is_staff()`); a customer
selecting them gets zero rows. Customers read and write through
`security definer` RPCs named `my_*` (or verbs on "my" data) that resolve
the caller with `private.current_customer_id()`, never accept a customer id
from the caller, and return an explicit list of customer-safe columns (a
named composite type or `returns table`). Asking for a record that is not
theirs returns nothing rather than an error. EXECUTE goes to `authenticated`
only; anonymous access is a separate, explicitly public projection
(`reporting.public_items`, public appointment types). Each such RPC is
listed in `tests/fixtures/api-surface.ts` and tested for: own rows only,
no staff-only column in the result keys, another customer's id returns
nothing, anon is refused (`customer-access.test.ts` is the template).

**Customer job projection (Phase 3, shown in Phase 11; PLAN D8, D17).**
The four `my_work_order*` RPCs follow the pattern above. Which jobs: those
where the caller is `work_orders.customer_id`, whoever owns the bike now (a
new owner does not see the previous owner's jobs; the previous owner keeps
theirs) and whether or not the bike was archived since; cancelled jobs are
hidden everywhere. What of them: a coarse `customer_job_status`
(`private.customer_job_status`: received/diagnosing/ready_to_start →
`received`, in_progress/paused → `in_progress`, the rest as they are,
cancelled → null), the bike's short ID and title, the check-in,
completion, ready and collection times, and the live lines' sale total;
lines show description, quantity, unit price and total only; the timeline
shows check-in, changes of the customer status and customer-visible photos
that still exist. Requested work, intake/internal/completion notes,
approval, assignments, actors, event payloads and every cost, yield, rate
or Cult Commons value are never returned. Job photos follow D17 (the job's
customer), not the bike-photo rule of D12.

Column-level gating of cost/yield for staff without `view_costs` is done with
views (`*_staff` views include the columns; base tables revoke `select` on
those columns from `authenticated` via column grants). Customers never read
`internal_notes`, costs, yield, consignor or Cult Commons data; this is tested
(see TESTING.md).

## 16. RPC catalogue (security definer, in `public`)

Each RPC begins with `private.require_permission(...)` or `private.is_staff()`
as appropriate, runs in a single transaction, locks the rows it mutates, and
returns the created/affected row (except where a row would carry cost columns
an RPC result cannot gate: the line and service RPCs return the id, §5
deviation (b)). Idempotent ones accept an idempotency key or rely on a unique
index and return the existing row on replay.

Business errors an RPC raises on purpose use SQLSTATE `P0001` with `MESSAGE`
set to a stable snake_case code (for example `staff_email_mismatch`) and
`DETAIL` set to an explanation. `src/lib/db-errors.ts` maps known codes to
user-facing messages; unknown codes become a generic error. Authorization
failures are `42501`, missing rows `P0002`, the last-admin guard `55000`.
Unique (`23505`) and check (`23514`) violations are mapped by constraint name.
A security definer function that writes a table with columns its callers
may not read (`services`, `work_order_line_items`) catches
`check_violation` and `not_null_violation` around the write and re-raises
them with `private.raise_without_row(sqlstate, constraint, table, schema,
column, message)`: same SQLSTATE, constraint and message, no DETAIL. The
DETAIL ("Failing row contains (…)") is built with the definer's privileges
and would print the hidden columns (costs) to any caller through PostgREST.

| RPC | Guard | Effects |
|---|---|---|
| `update_shop_settings(intake_slot_minutes = null, intake_capacity_units = null, booking_min_notice_minutes = null, booking_horizon_days = null, customer_max_active_bookings = null, customer_cancel_cutoff_minutes = null, public_site_url = null)` → `shop_settings` | A | Built (Phase 2). `shop_settings` FOR UPDATE; null keeps a field, `public_site_url` '' clears it; no time zone or currency parameter (D35); `shop_capacity_below_type` when an active type takes more units; checks 23514 by name; unchanged → the row, no event. Never moves appointments (D38). |
| `set_shop_hours(weekday smallint, intervals jsonb, active = true)` → `setof shop_hours` | A | Built (Phase 2). Replaces one weekday's rows atomically from a JSON array of 0..4 `{"opens_at","closes_at"}` ("HH:MM", closes_at up to "24:00"); weekday outside 0..6 or malformed JSON → 22023; an inverted interval → 23514 `shop_hours_interval_check`; overlaps → `shop_hours_overlap`; the same intervals and flag → the existing rows, no events. |
| `save_closure_override(closure_id, is_new, kind closure_kind, first_day date, last_day date, reason, from_time time = null, to_time time = null)` → `closure_overrides` | A | Built (Phase 2, D38). closed without times: whole days; closed with both times: part of one day; custom_hours: times required, whole days. `closure_invalid_range` (last before first, over 366 days, one time only, times on several days, start not before end), `reason_required`, 23514 `closure_overrides_reason_check` (> 200), `closure_custom_hours_overlap` (exclusion constraint as backstop, 23P01). is_new: insert, identical row → replay (no event), different row → `closure_conflict`; not is_new: P0002 when missing, else update (no event when unchanged). |
| `delete_closure_override(closure_id, reason)` → `closure_overrides` | A | Built (Phase 2). `reason_required` / `reason_too_long` first; deletes and returns the row (its `deleted` schedule event keeps the row and the reason); null when already gone. |
| `save_appointment_type(appointment_type_id, is_new, name, description, duration_minutes, capacity_units, public, active, sort_order = 0)` → `appointment_types` | A | Built (Phase 2). Same insert-or-replay semantics (`appointment_type_conflict`, P0002); an active type above the intake capacity → `appointment_type_capacity_too_large`; 23505 `appointment_types_name_key` (ignoring case); existing appointments keep their snapshot (D38). |
| `public_appointment_types()` → `id, name, description, duration_minutes` | everyone (anon, authenticated) | Built (Phase 2). Active and public types by sort_order, name; never capacity units. |
| `public_shop_hours()` → `weekday, opens_at, closes_at` | everyone | Built (Phase 2). Active weekly rows by weekday, opens_at; closures are not listed. |
| `available_slots(day date, appointment_type_id uuid)` → `slot_start, slot_end, remaining_units` | everyone (D37; Phase 11 must not revoke anon) | Built (Phase 2). `private.available_slots_at(day, type, now(), private.is_staff())`; `remaining_units` NULL for non-staff; null arguments → 22004. Phase 11's `bookable_slots` range wrapper calls `private.available_slots_at`. |
| `book_appointment(appointment_id, customer_id, appointment_type_id, starts_at timestamptz, bike_id = null, customer_note = null, internal_note = null)` → `appointments` | S | Built (Phase 2). `private.book_appointment_core(…, 'staff')`, in order: 22004 on nulls; `shop_settings` FOR SHARE; the day lock; replay by id (same customer, type and start → the row, no event; else `appointment_conflict`); P0002 / `appointment_type_unavailable` (inactive); P0002 / `customer_archived`; bike P0002 / `appointment_bike_archived` / `appointment_bike_not_owned`; `appointment_in_past` (ends_at ≤ now); `private.appointment_slot_problem` (misaligned, outside hours, closed, capacity); insert with the snapshots. |
| `mark_appointment_status(appointment_id, status, reason = null)` → `appointments` | S | Built (Phase 2, D39). `shop_settings` FOR SHARE, the row FOR UPDATE (P0002); targets confirmed / arrived / no_show only (`appointment_use_check_in`, `appointment_use_cancel`, `appointment_transition_invalid` for booked/completed); same status → replay; `appointment_transition_invalid`; `appointment_not_started`; no_show → arrived only on its own shop-local date, then the day lock and `appointment_capacity_exceeded`. One event with the optional reason. |
| `cancel_appointment(appointment_id, reason)` → `appointments` | S | Built (Phase 2). `reason_required` / `reason_too_long` first; the row FOR UPDATE (P0002); already cancelled → the row (no event); only booked, confirmed or arrived (`appointment_transition_invalid`); `cancelled_via` = staff. |
| `update_appointment(appointment_id, bike_id = null, clear_bike = false, customer_note = null, internal_note = null)` → `appointments` | S | Built (Phase 2). The row FOR UPDATE (P0002); null keeps, '' clears a note, `clear_bike` removes the bike; bike rules from the trigger (before check-in, the customer's, not archived); the customer's note only while not cancelled/completed/no_show (`appointment_immutable`); unchanged → no update, no event; one `details_changed` event otherwise. |
| `my_appointments(include_past = false)` → `setof my_appointment` | authenticated (C) | Built (Phase 2, D42; consumed by Phase 11). The caller's appointments not yet over, soonest first; `include_past` adds the past ones after them, latest first. Bike fields only while the bike is still theirs and not archived (D12). |
| `book_my_appointment(appointment_id, appointment_type_id, starts_at, bike_id = null, customer_note = null)` → `my_appointment` | C (42501 otherwise) | Built (Phase 2, D37). The booking core with the caller's customer id and source customer: active public types, `appointment_too_soon`, `appointment_too_far_ahead`, `appointment_customer_limit` (per-customer lock), then hours, closures, capacity; a bike that is not theirs (or unknown) → `appointment_bike_not_owned` with nothing about the bike. |
| `cancel_my_appointment(appointment_id, reason = null)` → `my_appointment` | C (42501 otherwise) | Built (Phase 2, D37). `reason_too_long`; `shop_settings` FOR SHARE; the caller's row FOR UPDATE, else NULL (no error); already cancelled → it (no event); booked/confirmed before `customer_cancel_cutoff_minutes` ahead of the start, else `appointment_not_cancellable`; reason defaults to 'Cancelled by the customer'; `cancelled_via` = customer. |
| `check_in_appointment(appointment_id uuid, bike_id uuid, work_order_id uuid, link_existing boolean = false, requested_work text = null, intake_notes text = null, lead_mechanic_id uuid = null)` → `appointment_check_in (appointment_id uuid, appointment_status appointment_status, work_order_id uuid, job_number text, created boolean)` | S | Built (Phase 2, D40). In order: 22004 on null ids; the appointment FOR UPDATE (P0002); checked_in or completed → its existing link with `created` false, whatever `work_order_id` was passed (replay, second device); not booked/confirmed/arrived → `appointment_transition_invalid`; `link_existing`: that job FOR UPDATE (P0002), same customer and bike, open (`private.work_order_status_is_open`) and unlinked, else `appointment_work_order_mismatch`; customer then bike FOR SHARE; bike P0002 / `appointment_bike_archived` / `appointment_bike_not_owned` (shop bikes too); the appointment → bike set, `checked_in` (stamps checked_in_at, arrived_at). New job: `private.create_work_order(actor, work_order_id, customer, bike, coalesce(nullif(btrim(requested_work), ''), customer_note), intake_notes, lead_mechanic_id, '{}', '[]', appointment_id)` (job number, `checked_in` event, D18, lead as for a walk-in; blank work and no note → `requested_work_required`), then `work_order_conflict` unless the returned job carries this appointment (an older job under that id). Existing job: `appointment_id` null → this appointment. Both link events from the triggers (§4). One transaction; `created` = not `link_existing`. |
| `appointment_daily(from_day date = null, to_day date = null)` → `day, booked, expected, arrived, checked_in, no_shows, cancelled` | S | Built (Phase 2, D41). Operational counts, no permission needed (D30). `reporting.appointment_daily` zero-filled one row per day; daily_summary's range rules (null bound = the other, both null = today, ≤ 366 days, else `report_range_invalid`); future days allowed (upcoming appointments). |
| `create_work_order(work_order_id, customer_id, bike_id, requested_work, intake_notes = null, lead_mechanic_id = null, additional_staff_ids uuid[] = '{}', services jsonb = '[]')` → `work_orders` | S | Calls `private.create_work_order(actor, …, appointment_id)`. Replay first: an existing id returns the row as it is now when customer and bike match (no check, assignment or line re-run, no number burned), else `work_order_conflict`. Then FOR SHARE on customer and bike (D18 against a concurrent transfer), insert (trigger: J- number, `work_order_customer_archived`, `work_order_bike_archived`, `bike_owner_mismatch`), lead, ≤ 10 distinct additional staff, ≤ 20 services `{line_id, service_id, quantity}` (malformed 22023) through `private.insert_service_line`. One transaction. `requested_work_required`; 22004 for missing ids. |
| `set_work_order_status(work_order_id, status, note = null)` → `work_orders` | S | Locks the job; same status → row unchanged (no event); `work_order_transition_invalid`; `reason_required` for cancel/reopen; `work_order_has_lines` when cancelling with live lines. Triggers stamp the time and write one event. |
| `update_work_order(work_order_id, requested_work = null, intake_notes = null, internal_notes = null, completion_notes = null)` → `work_orders` | S | Null keeps, '' clears (requested work cannot be cleared: `requested_work_required`); no-op when unchanged; one `details_changed` event. Any status. |
| `add_work_order_note(note_id, work_order_id, kind work_order_note_kind, body)` → `work_order_events` | S | Locks the job; replay by `note_id` first (same job → that event; else `note_conflict`); `note_added` / `diagnosis_added` with `{note_id, body}` (1..5000; `note_required`, `note_too_long`). Any status. |
| `set_approval_flag(work_order_id, flagged, note = null)` → `work_orders` | S | Internal flag (SPEC §7.1); note null keeps the stored one, '' clears it; `work_order_closed`; replay no-op; `approval_flagged` event. |
| `assign_staff(work_order_id, staff_id, role assignment_role = 'additional')` → `work_order_assignments` | S (D22) | Locks the job; `work_order_closed`; P0002 / `staff_inactive`; same role → the active row (no event); other role → close and reopen; a new lead closes the previous lead's row. Trigger syncs `lead_mechanic_id`, writes `assignment_changed`. |
| `unassign_staff(work_order_id, staff_id)` → `work_order_assignments` | S | Closes the active row and returns it; null when none (no event). `work_order_closed`. |
| `add_service_line(line_id, work_order_id, service_id, quantity line_quantity = 1, unit_sale_price = null, unit_direct_cost = null, description = null)` → `uuid` | S; a cost needs P(view_costs) (D14) | Locks the job, then `private.insert_service_line`: replay by line id first (same job, type and service → id; else `line_conflict`), then `work_order_locked`, P0002 / `service_unavailable`, snapshots (description, price, cost, `cult_commons_rate_at(now)`), insert. Returns the id only. |
| `add_manual_line(line_id, work_order_id, description, unit_sale_price, quantity line_quantity = 1, unit_direct_cost = null)` → `uuid` | S; a cost needs P(view_costs) (D14) | Same order (replay, `work_order_locked`); cost null → 0 with `cost_pending` (D14). Returns the id only. |
| `void_line(line_id, reason)` → `uuid` | S | `reason_required` / `reason_too_long`; locks the job, then the line; already voided → id (no event); `work_order_locked`. Sets `voided_*`; never deletes. Phase 4 replaced it (same signature, order and wrapper) with the inventory branch below. |
| `work_order_timeline(work_order_id, max_rows = 200)` | S | Events newest first with actor and (assignment events) subject display names; 1..2000 rows (the job page asks one more than it shows, to say older events exist). |
| `create_service(service_id, name, default_sale_price, description = null, category_id = null, default_direct_cost = null, is_active = true, is_public = false)` → `uuid` | P(manage_inventory); a cost needs P(view_costs) | Replay by id with the same name → id; else `service_conflict`; `category_kind_mismatch`; 23505 `services_active_name_key`. |
| `update_service(service_id, name, default_sale_price, description = null, category_id = null, is_active = true, is_public = false, default_direct_cost = null)` → `uuid` | same | Replaces every field; cost null keeps it. P0002. |
| `set_service_archived(service_id, archived)` → `uuid` | P(manage_inventory) | Replay-safe. |
| `schedule_cult_commons_rate(rate_id, rate, effective_from = null)` → `cult_commons_rates` | A | Replay by `rate_id` first (same rate → the row as it is now; else `rate_conflict`). Null = now; earlier than now → `rate_backdated` (D21); 23505 on a taken start time. |
| `cancel_cult_commons_rate(rate_id)` → `cult_commons_rates` | A | Only before it starts (`cult_commons_rate_in_effect`); replay returns the row. |
| `add_inventory_line(line_id, work_order_id, product_id, quantity integer = 1, location_id = null, inventory_unit_id = null, unit_sale_price money_amount = null)` → `inventory_line_result (line_id, movement_id, location_id, on_hand_after, replayed)` | S | Built (Phase 4). 22004 on null ids/quantity. Order: `private.lock_work_order` (P0002); `private.lock_stock(product)` and the unit FOR UPDATE (P0002); replay by line id before the open check (same job, inventory, product, unit, quantity → the line, its job_consumption movement and current on-hand, `replayed = true`; else `line_conflict`); `work_order_locked` (D15); `quantity_invalid` (1..999; unique: 1); P0002 / `product_archived` / `product_inactive`; `currency_mismatch`; `ownership_not_saleable` (product or unit not shop_owned, D27). Quantity: `unit_product_mismatch` if a unit is given; default location (lowest active sort_order, name) or `location_required`; `location_inactive`; on-hand may go negative (D23). Unique: `unit_required`, `unit_product_mismatch`, `unit_not_available`, `unit_location_mismatch`. `part_price_missing` / `part_cost_missing` (D24). Inserts the line (snapshots price, cost, rate; `cost_pending` false; description = name, or name · U-… · S/N …), the `job_consumption` movement (−quantity, cost snapshot), unit → held_for_customer and publication refresh, `stock_consumed`. Never returns a cost. |
| `void_line(line_id, reason)` inventory branch | S | Built (Phase 4, create or replace keeping Phase 3's signature, guard, reason rules, error order, effects, lock order and wrapper; `line_type_unsupported` is gone): already voided → id before the open check; `work_order_locked` (reopen first, D25); after `voided_*`: `lock_stock`, the unit's bike FOR UPDATE (if any), the unit FOR UPDATE, `bike_with_customer` when that bike has a customer (D29), one `reversal` of the line's job_consumption (`reversal_of_id`, same product, unit, location and cost snapshot; allowed at a location deactivated since), held unit → available, `refresh_unique_publication` (sold → public, no requirement check), `stock_reversed`. Concurrent voids serialise on the job; the unique `reversal_of_id` is the backstop. |
| `adjust_stock(request_id, product_id, location_id, quantity_delta integer, movement_type, reason, unit_cost money_amount = null)` → `table(movement_id bigint, on_hand integer)` | P(adjust_stock) | Built (Phase 4). `movement_type_not_manual` (only stock_adjustment ±, damaged −), `reason_required` / `reason_too_long`, `quantity_invalid`; a unit cost needs P(view_costs) (42501) and a positive delta (22023). `lock_stock`, then replay by request_id (same product, location, delta, type → that row; else `request_conflict`); P0002; `product_unit_tracked`; `product_archived`; `location_inactive`; `insufficient_stock` if a negative delta leaves the location below zero. Snapshot = unit_cost else the product default. Records actor and time (SPEC §23). |
| `transfer_stock(request_id, product_id, from_location_id, to_location_id, quantity integer, reason = null, inventory_unit_id = null)` → `table(movement_id bigint, location_id uuid, quantity_delta integer)` | P(manage_inventory) | Built (Phase 4). `transfer_same_location`; `lock_stock` and the unit FOR UPDATE; replay by request_id (both rows; else `request_conflict`); `location_inactive`; `product_archived`. Quantity: `quantity_invalid`, `insufficient_stock`. Unique: `unit_required`, quantity 1, `unit_not_available` (available or reserved only), `unit_location_mismatch`; moves `location_id` (unit `moved` event). Two `transfer` rows sharing request_id. |
| `create_unique_unit(unit_id, product_id, location_id, serial_number = null, condition = null, sale_price = null, direct_cost = null, bike_id = null, reason = null)` → `unique_unit_result (unit_id, short_id)` | P(manage_inventory); a cost needs P(view_costs) | Built (Phase 4). `lock_stock` before the replay (unit id exists with the same product → it; else `unit_conflict`); `product_not_unique`, `product_archived`, `product_inactive`, `location_inactive`; a bike is locked FOR UPDATE and must exist, not be archived (`bike_archived`), have no owner (`bike_has_owner`) and no unit (`bike_already_linked`). `private.register_unit` (shop_owned, D27), then a +1 `stock_adjustment` (reason default "Registered as a unique item", request_id = unit id), then `refresh_unique_publication` (a sold product with a new available unit is public again, D26). |
| `write_off_unit(request_id, unit_id, reason)` → `unit_status_result (unit_id, status)` | P(adjust_stock) | Built (Phase 4). `reason_required`; P0002; `lock_stock`, the unit FOR UPDATE; replay: a damaged movement with this request_id for this unit → current state, the key used for anything else → `request_conflict`; already written off → no-op; available or reserved → written_off plus a `damaged` −1; else `unit_not_available`. |
| `set_publication_status(product_id, status, reason = null)` → `publication_result (product_id, publication_status, public_slug)` | P(manage_inventory) | Built (Phase 4). 22004 on null ids; `reason_too_long` (> 500); `lock_stock(product)`, then the product FOR UPDATE (P0002). A target of `sold`, or leaving `sold` for anything but `archived` → `publication_sold_by_sale`. Same status → the row, no event. Otherwise the products trigger: `publication_transition_invalid`, `publication_requires_price` / `_photo` / `_available_unit`, slug at the first publish, `publication_changed {from, to}` with the reason. Phase 10 hooks the Shopify sync onto publication changes by trigger. |
| `split_unit_from_stock(new_product_id, unit_id, source_product_id, location_id, name, reason, serial_number = null, condition = null, sale_price = null)` → `split_unit_result (product_id, product_short_id, unit_id, unit_short_id)` | P(adjust_stock) and P(manage_inventory) | Built (Phase 4, D28). 22004 on null ids; `reason_required`, `reason_too_long` (> 480: the movements' reason is "Split to U-######: " + reason). `lock_stock(source)`, then replay (unit id on new_product_id → the same result; the unit id or new_product_id used otherwise → `unit_conflict`); P0002; `product_not_quantity`, `product_archived`, `ownership_not_saleable` (D27); P0002 / `location_inactive`; `insufficient_stock` (on-hand at the location < 1). Inserts a draft unique product (name; description, brand, category, currency from the source; price = sale_price else the source's; default cost = the source's), `private.register_unit` (shop_owned, cost = the source's default cost) and two `stock_adjustment` movements (−1 source, +1 unit) with the reason, cost snapshot and request_id = unit id. Writes the carried cost for a caller without P(view_costs) (definer path; the invoker cost-write guards still refuse that caller's direct writes); never returns a cost. 23514 checks re-raised without the row. |
| `daily_summary(from_day date = null, to_day date = null)` → table of the 27 `reporting.daily_summary` columns | S | Built (Phase 5). A null bound takes the other; both null = shop today; `report_range_invalid` when from > to or the range exceeds 366 days. One zero-filled row per day (`generate_series` left join the view), future and pre-history days as zero rows; placeholders passed through. D30: without view_financial_reports `currency`, `lines_recognised`, `gross_sales`, `consignment_sales`, `consignment_sales_total` and every cost column are NULL; with it but without view_costs `cogs`, `yield_total`, `cult_commons_share`, `bicii_yield_after_cc`, `loss_lines`, `loss_total`, `new_consignor_liability` are NULL. By day. |
| `today_dashboard(on_day date = null)` → `day, is_today, generated_at, can_see_financials, can_see_costs`, daily_summary columns 2–27, `received_now, waiting_now, ready_to_start_now, in_progress_now, awaiting_collection_now, open_jobs_now, overdue_now, low_stock_now, exceptions_now, cost_pending_lines` | S | Built (Phase 5). Null = today; a future day → `report_range_invalid`. Reads `public.daily_summary(d, d)` (gating in one place). The `*_now` snapshot (D31; BOARD_GROUPS: received+diagnosing, awaiting_customer+awaiting_parts+paused, ready_to_start, in_progress, completed+ready_for_collection, open, D20 overdue, `reporting.low_stock` rows, `operational_exceptions` rows) only when d is today, else NULL. `cost_pending_lines` = d's shop-currency entries with `cost_pending` (D14), NULL without view_financial_reports. |
| `work_order_activity_on(on_day date = null)` → `work_order_id, job_number, status, customer_id, customer_label, bike_id, bike_title, lead_mechanic_name, checked_in_at, started_at, completed_at, ready_for_collection_at, collected_at, cancelled_at, checked_in_on_day, started_on_day, completed_on_day, ready_on_day, collected_on_day, cancelled_on_day, is_open, is_overdue, age_days, sale_total, currency` | S | Built (Phase 5). Jobs with at least one current stamp on that shop day (null = today), by job number; `customer_label` = `private.customer_label`, `bike_title` = brand model variant (bikeTitle rule), `sale_total` sale only (`work_order_totals`). |
| `stock_adjustments_on(on_day date = null)` → `movement_id, created_at, movement_type, product_id, product_short_id, product_name, inventory_unit_id, unit_short_id, location_name, quantity_delta, reason, actor_name, significant, value_at_cost, currency` | S; value_at_cost P(view_costs) | Built (Phase 5). `stock_adjustment` and `damaged` movements of that shop day (null = today), newest first; `significant` per D33 for every staff member; `value_at_cost` = \|delta\| × coalesce(snapshot, product default, 0), NULL without view_costs (D30). |
| `operational_exceptions(max_rows integer = 50)` → `kind, severity, entity_type, entity_id, entity_label, subject_label, days, quantity, since` | S | Built (Phase 5, D34). Danger first, then oldest `since`; max_rows clamped to 1..200. Phase 9 drops and recreates it with appended columns. |
| `financial_lines(from_day date, to_day date)` → the 32 `reporting.financial_lines` columns in order | P(view_financial_reports) (42501 otherwise) | Built (Phase 5). Null bounds as daily_summary; at most 31 days inclusive (`report_range_invalid`); PostgREST returns ≤ 1000 rows, so callers page with `.range()`. Without view_costs `unit_direct_cost`, `cult_commons_rate`, `cost_total`, `yield_total`, `cult_commons_share`, `bicii_yield_after_cc`, `is_loss` are NULL. By recognized_at, document_number, source_line_id. |
| `work_order_yield(target_work_order_id uuid)` → `work_order_id, job_number, status, currency, line_count, sale_total, cost_total, yield_total, cult_commons_share, bicii_yield_after_cc, loss_line_count, loss_total, cult_commons_rates numeric[], recognized_at, recognized_day, cost_pending_count` | P(view_costs) (42501 otherwise) | Built (Phase 5). The job's live lines whether or not it is completed (running economics; equals `work_order_totals_staff`); rates = distinct snapshot rates ascending; recognized_at = `completed_at` (NULL while open, cancelled or reopened, D32). Unknown job P0002. |
| `record_retail_sale(lines[], customer_id, recognized_at, idempotency_key)` | S | Sale + lines + movements; unit/consignment → sold. |
| `restock_unit(unit_id, location_id, reason)` | P(adjust_stock) | `return` movement; unit → available; product status back from `sold`. |
| `create_consignment_item(...)` | P(manage_consignments) | Item + unit + movement. |
| `return_consignment_item(item_id, reason)` | P(manage_consignments) | `consignment_returned` movement; unit → returned. |
| `record_settlement(consignor_id, amount, paid_at, allocations[], reference)` | P(manage_consignments) | Settlement + lines; overallocation check. |
| `receive_purchase(po_id, idempotency_key, lines[])` | P(manage_purchasing) | §10. |
| `process_shopify_order_paid(event_id)` | service role | §13. |
| `process_shopify_refund(event_id)` | service role | `sale_refunds`; no stock. |
| `grant_permission(target_staff_id, permission)` / `revoke_permission(…)` | A, or P(manage_staff) within the D11 ceiling | Permission rows (`granted_by` = caller); replay-safe (no row change, no event). One `permission_granted` / `permission_revoked` event; the revoke event keeps the removed row's `granted_by`/`granted_at`. |
| `set_staff_active(target_staff_id, active, reason)` | A or P(manage_staff) | Deactivating needs a reason (P0001 `reason_required`; `reason_too_long` over 500). Nobody deactivates themselves; only an admin changes an admin's status; the last active admin stays (55000). One `deactivated`/`reactivated` event with the reason; replaying the current state is a no-op. |
| `update_staff(target_staff_id, display_name, role, reason)` | A or P(manage_staff); role changes A only | Null leaves a field as it is. Nobody changes their own role; only an admin renames an admin; the last active admin cannot be demoted (55000). `role_changed` / `details_changed` events. Email is not editable (it must stay the login's email). |
| `staff_history(target_staff_id, max_rows)` | A or P(manage_staff) | `staff_events` for one person, newest first, with the actor's display name (≤ 500 rows, default 100). |
| `my_staff_profile()` | authenticated | Caller's staff row + effective permissions (admin → all; inactive → none); zero rows for non-staff. |
| `create_staff(auth_user_id, display_name, email, role)` | A or P(manage_staff); only A creates `admin` | Links an existing Auth login (created server-side with the service-role admin API) to a new active staff row. Email must equal the login's email (`P0001 staff_email_mismatch`); duplicate email → 23505 `staff_email_key`. |
| `staff_roster()` | A or P(manage_staff) | Every staff row with its *granted* permissions, for Staff settings (a manage_staff holder could otherwise grant but not see permissions, §15). |
| `staff_directory()` | S | `id, display_name, role, active` of every staff member: how staff see colleagues' names (§15) without reading the `staff` table. |
| `transfer_bike_ownership(bike_id, to_customer_id, reason)` | S | `to_customer_id` null = the shop. Reason required (P0001 `reason_required`, `reason_too_long` over 500). Locks the bike; one `transferred` event with actor and reason (by trigger); replaying the current owner is a no-op. P0002 unknown bike/customer; `customer_archived`, `bike_archived`. Returns the bike. |
| `record_attachment(attachment_id, entity_type, entity_id, storage_bucket, storage_path, media_type, byte_size, width, height, caption, visibility)` | S | Entity must exist (P0002; `attachment_entity_unsupported` for types without a table yet); bucket must match visibility (`attachment_bucket_mismatch`); path must be `{entity_type}/{entity_id}/{attachment_id}.{ext}` with ext matching the type (`attachment_path_mismatch`); photo types only (`attachment_media_type_unsupported`); the object must be in `storage.objects` (`attachment_object_missing`) with a matching mimetype (`attachment_media_type_mismatch`); Storage's size wins. Replay returns the same row; an id used for another file (`attachment_conflict`) or deleted (`attachment_deleted`) is refused; customer records are never public (`attachment_customer_never_public`), nor is a photo without width and height (an undecoded original, `attachment_original_never_public`). `created` event. |
| `set_attachment_visibility(attachment_id, visibility, new_bucket, new_path)` | S | internal ↔ customer stays in `media-internal`; to/from `public` the object must already be at the new location (copied by the server). Never public for a customer record or an undecoded original (`attachment_original_never_public`). Locks the row; `visibility_changed` event; replay is a no-op. |
| `delete_attachment(attachment_id, reason)` | S | Reason required. Deletes the row, `deleted` event with actor, reason and the row as payload. Returns a set: the deleted row (the server then removes the object), or no row on replay (PostgREST: `[]`). |
| `attachment_stray_objects(entity_type, entity_id)` | S | Objects under `{entity_type}/{entity_id}/` in either photo bucket that no attachment points at and that are safe to remove now (older than 10 minutes; in `media-internal`, with history or older than a day), at most 100. The server removes them when it shows the record. |
| `staff_search(q, kinds, max_results, archived)` | S | Typed hits `(kind, id, title, subtitle, short_id, rank)` across customers (name words in any order, email, phone digits with or without +65), bikes (short ID and serial ignoring case/spaces/dashes, brand/model/variant/colour plus owner name) and, from Phase 3, jobs (`work_order`: job number ignoring case/spaces/dashes, exact 1.0, contains ≥ 3 characters 0.6; title the bike, subtitle the customer · the first 80 characters of the requested work, short_id the job number; every status) and, from Phase 4, products (`product`: exact P- ID or SKU key, i.e. upper-cased without punctuation, 1.0; SKU key containing q's key, ≥ 3 characters, 0.7; every word of q in name/brand/SKU 0.45 + 0.4 × word similarity; title the name, subtitle `SKU · brand · N in stock` with N the ledger on-hand across locations, or `Unique item`, plus `Inactive` for an inactive product, which is still found) and units (`inventory_unit`: exact U- ID or serial key 1.0; serial key containing q's key, ≥ 3 characters, 0.7; every word of q in the product's name 0.45 + 0.4 × word similarity; title the product's name, subtitle `status · location · S/N serial` with status Available, Reserved, On a job, Sold, Written off or Returned to consignor). Exact short ID, serial, SKU or job number rank 1.0, exact email/phone 0.95, fuzzy below. Archived rows excluded, or (`archived` true) searched alone with the same matching, for the Archived lists (jobs are never archived, so none then; a unit by its own `archived_at`); `kinds` null = all, unknown kind 22023; `max_results` clamped to 1..100 (callers ask for one more than they show, to know the list is cut off). Later phases add a `private.search_<kind>` function and a branch. |
| `my_customer_profile()` | authenticated (C) | The caller's own `customer_profile` (id, names, email, phone, created_at); zero rows for non-customers. |
| `update_my_profile(first_name, last_name, display_name, phone)` | C | Own row only; null keeps a field, '' clears it; 42501 without a customers row. |
| `my_bikes()` | authenticated (C) | The caller's current, non-archived bikes without internal notes. |
| `my_bike_attachments(bike_id)` | authenticated (C) | `customer`/`public` attachments of one of the caller's own bikes; empty for anyone else's. |
| `my_work_orders()` | authenticated (C) | The caller's jobs (not cancelled), newest first: `id, job_number, bike_id, bike_short_id, bike_title, status customer_job_status, checked_in_at, completed_at, ready_for_collection_at, collected_at, currency, sale_total` (live lines). D17: by `work_orders.customer_id`, whatever the bike's owner or archived state now. |
| `my_work_order_lines(work_order_id)` | authenticated (C) | Live lines of one of the caller's non-cancelled jobs, in `created_at` order: `id, description, quantity, unit_sale_price, sale_total, currency`. Empty for anyone else's job. |
| `my_work_order_timeline(work_order_id)` | authenticated (C) | Oldest first `id, kind, status, attachment_id, created_at`: `checked_in` (status `received`); `status` for a status_changed/completed/ready_for_collection/collected/reopened event whose customer status differs from the previous entry's; `photo` for a `photo_added` whose attachment still exists and is customer-visible. No actors, notes, payloads, lines, assignments or costs. |
| `my_work_order_attachments(work_order_id)` | authenticated (C) | `customer`/`public` attachments of one of the caller's non-cancelled jobs (job photos are never public, D19), same columns as `my_bike_attachments`. |

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
10 bikes, shop hours Tue–Sun, 4 appointment types, 9 appointments, 1 customer login, 9 services, 2 locations,
12 quantity products with stock, 3 unique shop-owned bikes, 2 consigned bikes
(one sold, unsettled), 2 suppliers, 1 PO partially received, 9 work orders
spread across statuses and the last 9 days, settlements. (The Cult Commons
base rate is not seed data: the workshop catalog migration ships it, D21.)
The seed is applied to the local database and to a fresh preview
project; never to production.

Phase 1 part (done): customers `c1000000-…-00000000000N` (`CUSTOMER` in
`tests/fixtures/ids.ts`; only Chloe Lim has a login, added in the Phase 2
part) and bikes
`b1000000-…-0000000000NN` (`BIKE`, short IDs `B-000001`…`B-000010` in insert
order, `BIKE_SHORT_ID`; Phase 4 adds B-000011…B-000013 and Phase 5
B-000014…B-000017), one shop bike without an owner and one bike
transferred between customers (two ownership events). No attachments.

Phase 3 part (done): service categories `ca000000-…-00000000000N`
(`CATEGORY`: Servicing, Wheels & tyres, Brakes, Builds, Labour, sort 1–5),
services `5e000000-…-0000000000NN` (`SERVICE`; SGD price / default direct
cost): Basic Service 80/0, Full Service 200/0, Wheel True 35/0 (per wheel),
Tyre Installation 15/0 (per tyre), Brake Bleed 45/8 (per brake),
Drivetrain Service 90/5, Bike Build 250/0, Custom Labour 60/0 (per hour,
not public) and Suspension Fork Service 120/25 (inactive, archived 30 days
ago). Nine jobs `f1000000-…-00000000000N` (`WORK_ORDER`, job numbers
`J-000001`…`J-000009` in insert order, `JOB_NUMBER`), lines
`f2000000-…-0000000000NN` (`LINE`, all at rate 0.3000) and assignments
`f3000000-…-0000000000NN`. Times are relative to the shop day the seed
runs: `pg_temp.seed_at(N, '10:00')` plus the same minute/hour offsets (one
base local time per job, all between 08:00 and 18:00 Singapore time; see
"Phase 5 part"); d = shop days before the reset day, h = hours:

| Job | Customer, bike | Status | What it demonstrates |
|---|---|---|---|
| J-000001 | Tan, Tarmac | collected | The full walk: checked in −9d, in progress −8d, completed −7d, ready −7d+1h, collected −6d; lead Marcus; Full Service + Brake Bleed ×2: sale 290.00, cost 16.00, yield 274.00, Cult Commons 82.20; intake and completion notes. |
| J-000002 | Priya, Domane | ready_for_collection | Money the E2E tests assert: Basic Service, Tyre Installation ×2 and a manual "Continental GP5000 700×28c tyre" ×2 at 95.00 (cost 62.00): sale 300.00, cost 124.00, yield 176.00, CC 52.80, BICII after CC 123.20; approval flag with one `approval_flagged` event (Asha, −5d+1h); lead Nur. |
| J-000003 | Hafiz, Brompton | completed | Started −1d 10:00, completed −1d 16:00, not yet ready; lead Marcus with Nur as additional staff; Drivetrain Service. |
| J-000004 | Chloe, Giant | in_progress | Diagnosing −3d+1h then in progress −1d (a received → diagnosing step the customer never sees); Wheel True ×2. |
| J-000005 | Chloe, Surly | awaiting_parts | A note (Nur, −5d−1h) before waiting for the customer's part; Custom Labour ×1.5. |
| J-000006 | Daniel, Cannondale | awaiting_customer | Phase 3's one overdue job (D20: open, checked in −8d; Phase 5's H7 is the other); a diagnosis (Marcus, −8d+2h); no lines. |
| J-000007 | Nurul, Bianchi | received | Just checked in, unassigned, no lines: checked in at seed time, after the Bianchi's sale from Daniel. |
| J-000008 | Tan, Brompton | cancelled | Cancelled an hour after check-in with a reason (hidden from the customer, D17). |
| J-000009 | Priya, Tern | diagnosing | A voided line: Asha quoted a bottom bracket (45.00, cost 28.00), Nur voided it at −1d+3h; live total 80.00. |

So that every seeded timeline reads true (`workshop-seed.test.ts`):
(a) intake/completion notes and the approval flag are given in the
`work_orders` INSERT (the insert trigger writes only `checked_in`), and the
backdated `note_added`, `diagnosis_added` and `approval_flagged` events are
inserted by hand with their own time and actor; those columns are never
updated in the seed (that would stamp an event at seed time); (b) before
each block of writes `request.jwt.claims` names the staff member acting,
so every trigger-written actor equals the row's own `created_by` /
`assigned_by` / `voided_by` (Asha checks in and assigns; Marcus and Nur
walk their own jobs' statuses; lines with a cost are added by Asha or
Marcus, D14); (c) each job is inserted `received` with an explicit
`checked_in_at`, gets its assignments and lines while open, then walks its
statuses one UPDATE at a time with an explicit `status_changed_at`, times
strictly increasing and no line change after completion; (d) J-000007's
`checked_in_at` is `clock_timestamp()` at its insert, after the Bianchi's
`transferred` event. Still no attachments. (The seeded bikes themselves are
registered at seed time, after the backdated check-ins; only the jobs'
timelines are backdated.)

Phase 4 part (done, step 1): the 'Shop floor' location
(`1c000000-…-000000000001`, sort 10) comes from the inventory migration's
one-shop bootstrap; the seed re-inserts it with `on conflict do nothing` and
adds 'Workshop store' (`…0002`, workshop, sort 20) (`LOCATION`). Product
categories `ca000000-…-000000000006`…`…012` (kind product: Brakes, Tyres &
tubes, Drivetrain, Cables & hoses, Care, Cockpit, Bikes; `PRODUCT_CATEGORY`).
Products `9a000000-…-0000000000NN` (`PRODUCT`, `PRODUCT_SHORT_ID`) are
inserted directly as the owner with `request.jwt.claims` naming the admin
(so `created_by` and the history name an actor), in order, giving
`P-000001`…`P-000016`, dated −30d 07:00. The opening stock and the units
are dated −30d (from 08:00, a minute apart): owner statements writing
exactly the rows `adjust_stock` and `create_unique_unit` write (same request
ids, quantities, movement type, reason, cost snapshot, currency, actor), so
they never show as today's adjustments; history events written by triggers
(product and unit `created`, the bikes' stock link) keep seed time. The
inventory job goes through the real RPCs as the admin, at seed time (today),
every request id used once.

| Short ID | Product | Price / cost | Reorder | On hand after the seed |
|---|---|---|---|---|
| P-000001 | Road disc brake pads, resin (pair) | 28.00 / 13.50 | 10 | 34 Shop floor |
| P-000002 | Grand Prix 5000 700x25c tyre | 89.00 / 52.00 | 4 | 12 Shop floor |
| P-000003 | Road inner tube 700x23-28c Presta 60mm | 9.00 / 3.80 | 20 | 40 Shop floor + 20 Workshop store |
| P-000004 | Marathon Racer 16x1.35 tyre | 55.00 / 30.00 | 3 | 6 Shop floor (one consumed by J-000010, then reversed) |
| P-000005 | Inner tube 16in Schrader | 14.00 / 6.00 | 6 | 14 Shop floor (15 opening, one on J-000010) |
| P-000006 | X11 11-speed chain | 45.00 / 24.00 | 5 | 8 Shop floor |
| P-000007 | 105 CS-R7000 11-34 cassette (draft) | 109.00 / 68.00 | 2 | 3 Shop floor |
| P-000008 | Pro brake cable kit | 35.00 / 16.00 | 4 | 2 Shop floor (low) |
| P-000009 | SM-BH90 hydraulic hose 1000mm | 28.00 / 12.00 | 5 | 1 Shop floor (low) |
| P-000010 | Dry chain lube 120ml | 16.00 / 7.00 | 6 | 18 Shop floor |
| P-000011 | DSP 3.2mm bar tape | 49.00 / 26.00 | 4 | 7 Shop floor |
| P-000012 | Tubeless sealant 237ml | 32.00 / 17.00 | 3 | 1 Shop floor + 1 Workshop store (low) |
| P-000013 | Colnago C64 Disc 52s (pre-owned), unique | 6800.00 / 4200.00 | — | unit U-000001 (bike B-000011) |
| P-000014 | Brompton C Line Explore (ex-demo), unique | 1950.00 / 1400.00 | — | unit U-000002 (bike B-000012) |
| P-000015 | Surly Bridge Club 27.5 M (new old stock), unique | 1650.00 / 1100.00 | — | unit U-000003 (bike B-000013) |
| P-000016 | X10 10-speed chain (discontinued), archived | 35.00 / 18.00 | — | none |

All are internal_only except P-000007 (draft); none is public and there are
no attachments. Opening stock is written as `adjust_stock` would, with request ids
`9c000000-…-0000000000NN` per product at its first location and
`9c000000-…-0000000001NN` for the Workshop store rows of P-000003 and
P-000012 ("Opening stock count"). Three shop bikes without an owner,
`b1000000-…-000000000011`…`…013` (`BIKE.shopColnago`, `shopBrompton`,
`shopSurly`; B-000011…B-000013), are in stock as units
`9b000000-…-00000000000N` (`UNIT`, U-000001…U-000003, written as
`create_unique_unit` would: shop-owned at the Shop floor, bike linked, a +1
'Registered as a unique item' movement at the unit's direct cost).
`reporting.low_stock` lists exactly P-000009, P-000008 and P-000012.

The inventory job `9e000000-…-000000000001` (`INVENTORY_JOB`, J-000010) is
Hafiz's Brompton (D18; his only other job, J-000003, is completed), lead
Asha, left `received`: line `9d000000-…-000000000001` is one Inner tube 16in
Schrader from the Shop floor (live), and line `…0002`, one Marathon Racer
tyre, was voided ("Customer brought their own tyre"), so the ledger shows a
`job_consumption` and its linked `reversal` (`SEED_LINE`). It is kept out of
`WORK_ORDER` / `JOB_NUMBER`, which list Phase 3's nine jobs.

Phase 5 part (done): **history relative to the reset day.** Every Phase 3,
4 and 5 timestamp is written through the session-temporary
`pg_temp.seed_at(days_ago integer, local_time time) returns timestamptz`,
defined before the first Phase 3 statement: for `days_ago > 0` it is
`((private.shop_today() - days_ago) + local_time) at time zone
'Asia/Singapore'`; for day 0 it maps `local_time` proportionally into the
part of today that has already passed (`shop_day_start(today) + (now() −
shop_day_start(today)) × local_time / 24 h`), so today's rows keep their
order and are never in the future at any time of day. The seed runs in one
session and one transaction (`now()` is the same everywhere); Singapore has
no DST, so `seed_at(n, t) − seed_at(m, t)` is exactly (m − n) × 24 h. Phase
3 keeps its day offsets (not moved to days 7–13, which would make every
open Phase 3 job overdue); J-000007 and J-000010 stay at seed time; Phase
4's opening stock and units are at day 30; trigger-written history events
keep their own (seed) time where the seed does not write them by hand.
No migration was needed: no Phase 3/4 trigger overwrites an owner's
timestamps.

Eleven jobs `d5000000-…-0000000000NN` (`REPORT_JOB`, J-000011…J-000021 in
insert order, `REPORT_JOB_NUMBER`), lines `d5100000-…` (`REPORT_LINE`, all at
rate 0.3000), assignments `d5200000-…`, written as Phase 3's are (owner
inserts, explicit times, claims naming whoever acts; a part from stock is
the line, one `job_consumption` movement at the line's time with −quantity
and cost snapshot = the line's unit cost, and a hand-written
`stock_consumed` event one second later). d = shop days before the reset
day; times are Singapore time. Four more customers' bikes
`b1000000-…-000000000014`…`17` (B-000014…B-000017: Chloe's Specialized
Diverge, Daniel's Canyon Endurace, Priya's Cervelo R5, Hafiz's Dahon Mu;
`BIKE.chloeDiverge`, `danielEndurace`, `priyaCervelo`, `hafizDahon`) are
inserted before H1 so that, as seed realism (the schema allows it), no
bike has two jobs open at once and none is collected while another job on
it is open (`reporting-seed.test.ts`). A bike awaiting collection may take
a newer job (J-000003 then J-000010; H6 then J-000009):

| Case | Job | Customer, bike, lead | Timeline | Lines (qty × sale / cost) → sale / cost / yield / CC / after CC |
|---|---|---|---|---|
| H1 service only (SPEC §10 ex. 1) | J-000011 | Tan, Brompton, Marcus | in d6 09:30, start d6 10:15, done d6 16:40, ready 16:45, collected d5 11:10 | Full Service 1 × 200.00 / 0.00 → 200 / 0 / 200 / 60.00 / 140.00 |
| H2 parts (ex. 2) | J-000012 | Chloe, Diverge (B-000014), Nur | in d5 10:00, start d5 13:00, done d4 15:30, ready 15:35, collected d3 10:20 | wheelset 1 × 800.00 / 400.00 → 800 / 400 / 400 / 120.00 / 280.00 |
| H3 combined (ex. 3) | J-000013 | Daniel, Endurace (B-000015), Marcus | in d4 09:45, start d4 11:00, done d3 17:10, ready 17:15, collected d2 12:00 | Full Service 200.00 + wheelset 800.00 / 400.00 → 1000 / 400 / 600 / 180.00 / 420.00 |
| H4 loss line (D1) | J-000014 | Tan, Tarmac, Marcus | in d3 10:30, start d3 14:00, done d2 15:00, ready 15:05, collected d1 09:40 | Wheel True 1 × 40.00 / 0.00 + tyre 1 × 20.00 / 35.00 (yield −15.00, CC 0) → 60 / 35 / 25 / 12.00 (not 7.50) / 13.00 |
| H5 rounding | J-000015 | Tan, Brompton, Nur (Asha prices) | in d2 10:00, start d2 15:00, done d1 14:00, ready 14:05 | manual 3 × 33.33 / 10.00 (CC 21.00) + 1 × 12.05 / 12.00 (CC 0.02, 0.015 half up) → 112.04 / 42.00 / 70.04 / 21.02 / 49.02 |
| H6 uncollected (D34) | J-000016 | Priya, Tern, Nur | in d12 09:00, start d11 10:00, done d9 16:00, ready d9 16:05 | Custom Labour 1 × 120.00 |
| H7 overdue (D20) | J-000017 | Priya, Cervelo R5 (B-000016), Marcus | in d11 11:00, start d10 10:00, awaiting parts d10 15:00 | Bike Build 1 × 150.00 (open, never recognised) |
| H8 cancelled (D16) | J-000018 | Hafiz, Dahon (B-000017), Nur | in d2 11:30, cancelled d2 12:15 "Customer declined the quote" | none |
| T1 in progress today | J-000019 | Daniel, Endurace, Marcus | in d0 09:00, start d0 09:30 | Drivetrain Service 1 × 90.00 / 10.00 (open) |
| T2 collected today | J-000020 | Chloe, Diverge, Marcus | in d1 17:00, start d0 09:15, done 11:30, ready 11:35, collected 12:10 | Drivetrain Service 1 × 120.00 / 0.00 + chain 1 × 45.00 / 22.00 → 165 / 22 / 143 / 42.90 / 100.10 |
| T3 received today (the anchor) | J-000021 | Chloe, Diverge (after T2's collection), Nur | in d0 13:00 | none |

Six quantity products `d5300000-…-00000000000N` (`REPORT_PRODUCT`,
`REPORT_PRODUCT_SHORT_ID`, P-000017…P-000022) in a new product category
'Wheels' (`ca000000-…-000000000013`, sort 8) and the existing ones, with
opening stock at the Shop floor at d30 08:30 (request ids
`d5400000-…-00000000000N`), so Phase 4's figures are untouched: Carbon disc
wheelset 700c, 45mm (Hunt, 849.00 / 400.00, reorder 1, 4 → 2 after H2, H3),
Corsa Pro 700x28c tyre (Vittoria, 95.00 / 35.00, reorder 2, 6 → 5), SLA-110
11-speed chain (YBN, 45.00 / 22.00, reorder 3, 10 → 9), Disc 34 RS brake
pads (SwissStop, 32.00 / 15.00, reorder 5, 20 → 19), Butyl inner
700x25-32c, Presta 48mm (Panaracer, 12.00 / 5.00, reorder 10, 30 → 24) and
CO2 cartridge 25g, threaded (Genuine Innovations, 6.00 / 3.00, no reorder
point, 10 → 12). None is low: `reporting.low_stock` still lists exactly
P-000008, P-000009 and P-000012. Stock adjustments by Asha (request ids
`d5400000-…-00000000001N`): A1 d2 11:00, brake pads −1 `stock_adjustment`
"Damaged packaging, written off" (not significant); A2 d1 16:30, inner −6
`damaged` "Water damage in storage" (significant, D33: ≥ 5 units; 30.00 at
cost); A3 d0 (08:30 scaled), CO2 +2 `stock_adjustment` "Recount found two in
the workshop drawer" (not significant). No open job is checked in on d7, so
which jobs are overdue never depends on the time of day the reset ran.

At the anchor the snapshot is received 4 (J-000007, J-000009, J-000010,
T3), waiting 3 (J-000005, J-000006, H7), ready to start 0, in progress 2
(J-000004, T1), awaiting collection 4 (J-000002, J-000003, H5, H6), open 9,
overdue 2 (J-000006, H7), low stock 3 and exceptions 3 (overdue J-000006 and
H7, uncollected H6). The per-day figures for d0…d6 (Phase 3/4 rows
included) are `SEED_DAYS` in `tests/fixtures/reporting.ts`, written by hand
together with `SPEC_EXAMPLE_JOBS`, `SEED_SNAPSHOT`, `SEED_EXCEPTIONS` and
`SEED_ADJUSTMENTS`; `tests/db/reporting-seed.test.ts` proves the views
reproduce them exactly.

**The anchor rule.** The seed is anchored to the shop day `db:reset` ran,
which need not be today (the DB test template is built once per run, an
existing database keeps its seed, a run can cross Singapore midnight).
Tests read the anchor from T3's check-in without the functions under test
(`seedToday()` in `tests/db/reporting-fixtures.ts`; `E2E_SEED_ANCHOR`, set
by `tests/e2e/global-setup.mts`, with `seedAnchor()` / `anchorDay(n)` in
`tests/e2e/helpers.ts`), count days back from it, and skip with a message
the assertions that need the anchor to be today. Reset (`npm run
db:reset`) to move the demo's "today".

Phase 2 part (done): **the schedule and appointments**, written as the
owner after every job exists (the owner bypasses the booking rules; the
triggers still enforce the status machine, stamps, bike ownership,
history and the work-order link), acting as Asha Admin (Marcus for
J-000014's completion, Chloe for her own bookings). IDs in
`tests/fixtures/ids.ts` (`SHOP_HOURS`, `APPOINTMENT_TYPE`, `CLOSURE`,
`APPOINTMENT`, `CUSTOMER_LOGIN`).

- Settings: slot 30, capacity 2, notice 120, horizon 60, limit 3, cancel
  cutoff 120 (D37's defaults), `public_site_url` `http://localhost:4000`
  (the local public site; D9 note).
- Weekly hours `e3000000-…-00000000000N`: Tue–Fri 10:00–19:00; Sat
  09:00–12:30 and 13:30–18:00; Sun 09:00–13:00; Monday one INACTIVE
  10:00–19:00 row (closed, hours remembered).
- Types `e1000000-…-00000000000N`: Service drop-off (30 min, 1 unit,
  public), Repair assessment (30, 1, public), Custom build consultation
  (60, 2, public), Warranty inspection (30, 1, staff-only).
- Closures `e4000000-…-00000000000N`: closed all day on the first
  Wednesday ≥ 7 days ahead ("Team at the Taipei Cycle show"); custom hours
  12:00–16:00 on the first Thursday ≥ 8 days ahead ("Short day for
  stocktake"); both within 14 days, whole shop-local days as
  `save_closure_override` stores them.
- Chloe Lim's customer login: Auth user
  `a0000000-…-000000000101` (chloe.lim@example.com, the local password),
  identity `a1000000-…-000000000101`, linked to `CUSTOMER.chloe`.
- Appointments `e2000000-…-00000000000N`, each inserted `booked` a day or
  more before its start and walked one update at a time with explicit
  stamps: (1) d3 10:00 Repair assessment, Tan's Tarmac, checked in at
  J-000014's check-in, linked to J-000014 (both link events dated then, so
  its timeline reads checked_in, appointment_linked, …) and completed at
  J-000014's completed_at (D36, D40); (2) d1 11:00 Daniel's Cannondale,
  no-show (11:20); (3) today 10:00 Priya's Domane, arrived; (4) today 10:30
  Hafiz's Brompton, confirmed (J-000010 is open on it); (5) today 15:00
  Chloe's Giant, booked online with a note; (6) today 16:00 Nurul's
  Bianchi, booked; (7) first Tue–Fri ≥ tomorrow 11:00 Tan's Brompton,
  confirmed; (8) first Tue–Fri ≥ 3 days ahead 10:00 Priya's Tern,
  cancelled by staff ("Customer travelling"); (9) first Tue–Fri ≥ 5 days
  ahead 14:00 Chloe's Surly, Custom build consultation booked online.
  Today's and yesterday's rows ignore the weekly hours on a Monday or
  Sunday; future rows avoid Mondays and the closures; nothing is more than
  14 days ahead (tests book on clear days ≥ 21 days ahead). Daniel has no
  upcoming booked/confirmed appointment; Chloe at most two upcoming online
  bookings; today at most three expected arrivals.
- D41 counts per seeded day (`SEED_DAYS`): d3 scheduled 1, arrived 1; d1
  scheduled 1, no-show 1; d0 scheduled 4, arrived 1; other days 0.
  `tests/db/appointment-seed.test.ts` proves the rest.
