-- BICII Admin seed: the local demo dataset and the database test fixture
-- (DATA-MODEL.md §18, TESTING.md "Seed data").
--
-- Deterministic: every row has a fixed UUID, exported from
-- tests/fixtures/ids.ts, so tests never query by name. Applied to local and
-- preview databases only; NEVER to production.
--
-- Phase 0 contents: four staff with working Supabase Auth logins (the
-- manager since the staff roles, D90-D94). They have
-- no usable password (PLAN D10): sign in with a code emailed to the address,
-- which the devstack's mail catcher shows (docs/ENGINEERING.md, "Clean
-- checkout to running application", says how to read a code). The logins:
--   admin@bicii.test      role admin (implies every permission)
--   manager@bicii.test    role manager (every permission except manage_staff), no exceptions
--   mechanic1@bicii.test  role mechanic, view_costs as an exception
--   mechanic2@bicii.test  role mechanic, no exceptions
--
-- Phase 1 contents: six customers (only Chloe Lim has a login, added in
-- Phase 2; customer sign-up is Phase 11) and ten bikes, one of them a shop bike without an owner, so
-- bikes get the short IDs B-000001 .. B-000010 in insert order. One bike
-- changed hands, so its ownership history has two events. No attachments.
--
-- Phase 3 contents: five service categories, nine services (one archived,
-- one not public) and nine workshop jobs J-000001 .. J-000009 in insert
-- order, one in each interesting status, with assignments, lines (one
-- voided), notes, a diagnosis and an approval flag, dated over the nine
-- shop days before the reset day (pg_temp.seed_at, between 08:00 and 18:00
-- local time) so every job's timeline reads true (see the Phase 3 block).
-- Still no attachments. The Cult Commons base rate (0.3000) is not seed
-- data: the workshop catalog migration ships it.
--
-- Phase 4 contents: a second location (the inventory migration ships the
-- bootstrap 'Shop floor'), seven product categories, sixteen products
-- P-000001 .. P-000016 (twelve counted parts with opening stock, three
-- unique shop bikes, one archived), three shop bikes B-000011 .. B-000013
-- in stock as units U-000001 .. U-000003, and an open job J-000010 for
-- Hafiz's Brompton with one live part and one voided part (so the ledger
-- shows a consumption and a reversal). Three parts sit at or below their
-- reorder point. The opening stock and the units are dated 30 days back
-- (owner statements writing exactly what adjust_stock and
-- create_unique_unit write); the job goes through the real RPCs today.
--
-- Phase 5 contents: history relative to the shop day the seed runs
-- (Singapore time). pg_temp.seed_at(days_ago, local time), defined before
-- Phase 3, dates the Phase 3, 4 and 5 rows; Phase 3 keeps its day offsets.
-- Eleven more jobs J-000011 .. J-000021 (the SPEC §10 examples, a loss
-- line, a rounding case, an uncollected and an overdue job, a cancelled
-- one, and three jobs today), four more customers' bikes B-000014 ..
-- B-000017 (so no bike is worked on under two jobs at once, or collected
-- while another job on it is open), six products P-000017 .. P-000022 with
-- opening stock 30 days back, and three stock adjustments (one significant,
-- D33). Today and the daily summary reproduce tests/fixtures/reporting.ts
-- exactly.
--
-- Phase 2 contents: the shop's schedule (settings with D37's defaults and
-- public_site_url http://localhost:4000; Tuesday-Friday 10:00-19:00, a split
-- Saturday, a short Sunday, Mondays closed), four appointment types (one
-- staff-only), two closures within the next 14 days, Chloe Lim's customer
-- login (chloe.lim@example.com, no usable password either) and nine
-- appointments from 3 days ago to at most 14 days ahead, one in each
-- interesting status; Tan's is linked to J-000014 (D40) and completed with
-- it (D36). Today and the daily summary count them by D41.
--
-- Phase 6 contents (after Phase 5): three consignors (Kelvin Yeo, Daniel Ong,
-- Chloe Lim), four consignment items C-000001 .. C-000004 (two consigned
-- bikes, six jerseys and a crankset, on new products P-000023 .. P-000026
-- and units U-000004 .. U-000006), two charges with explicit bearers (D4),
-- four in-store sales S-000001 .. S-000004 on the Phase 5 fixture days
-- (one is SPEC §10's consignment example), one return to the consignor, a
-- reversed settlement and its replacement, and a refund. Written through
-- the RPCs; the ledgers reproduce tests/fixtures/ids.ts
-- EXPECTED_CONSIGNOR_LEDGER and EXPECTED_SALE.
--
-- Phase 7 contents (at the end): three suppliers (one archived), supplier
-- links on six Phase 4 products, and five purchase orders PO-000001 ..
-- PO-000005 in insert order: one received in full 9 days ago, SPEC §14's partial
-- receipt (ordered 20, received 18, 2 outstanding; overdue), one awaiting
-- delivery, one draft holding two low-stock products, and one cancelled.
-- Built through the purchasing RPCs as the admin, so the ledger, PO
-- history and last costs are real; created_at / submitted_at are
-- back-dated before receiving (D64 D-RECEIPT-TIME: the receipts carry
-- their back-dated received_at, their movements seed time). No products,
-- units, bikes or customers are created, every receipt cost equals the
-- product's current cost, and no receipt touches a low-stock product or a
-- product Phase 6 sells, so the Phase 4, 5 and 6 figures are unchanged
-- (see the Phase 7 block).

-- ---------------------------------------------------------------------------
-- Auth users (shape matches Supabase Auth v2.178). GoTrue scans the token
-- columns into Go strings, so they must be '' rather than NULL or sign-in
-- fails with "converting NULL to string is unsupported".
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, last_sign_in_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token,
  is_super_admin, is_sso_user, is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  u.id,
  'authenticated',
  'authenticated',
  u.email,
  -- What auth.admin.createUser writes for a login created without a
  -- password (Auth v2.178): the bcrypt hash of a random secret nobody knows.
  extensions.crypt(
    encode(extensions.gen_random_bytes(48), 'base64'), extensions.gen_salt('bf', 10)
  ),
  now(), null,
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  jsonb_build_object('display_name', u.display_name),
  now(), now(),
  '', '', '', '',
  '', '', '', '',
  false, false, false
from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'admin@bicii.test', 'Asha Admin'),
  ('a0000000-0000-4000-8000-000000000002'::uuid, 'mechanic1@bicii.test', 'Marcus Tan'),
  ('a0000000-0000-4000-8000-000000000003'::uuid, 'mechanic2@bicii.test', 'Nur Aisyah'),
  ('a0000000-0000-4000-8000-000000000004'::uuid, 'manager@bicii.test', 'Kavya Menon')
) as u (id, email, display_name);

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
  i.id,
  u.id::text,
  u.id,
  jsonb_build_object(
    'sub', u.id::text,
    'email', u.email,
    'email_verified', true,
    'phone_verified', false
  ),
  'email',
  null, now(), now()
from (values
  ('a1000000-0000-4000-8000-000000000001'::uuid, 'a0000000-0000-4000-8000-000000000001'::uuid),
  ('a1000000-0000-4000-8000-000000000002'::uuid, 'a0000000-0000-4000-8000-000000000002'::uuid),
  ('a1000000-0000-4000-8000-000000000003'::uuid, 'a0000000-0000-4000-8000-000000000003'::uuid),
  ('a1000000-0000-4000-8000-000000000004'::uuid, 'a0000000-0000-4000-8000-000000000004'::uuid)
) as i (id, user_id)
join auth.users u on u.id = i.user_id;

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
insert into public.staff (id, auth_user_id, display_name, email, role, active) values
  ('5a000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'Asha Admin', 'admin@bicii.test', 'admin', true),
  ('5a000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002',
   'Marcus Tan', 'mechanic1@bicii.test', 'mechanic', true),
  ('5a000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003',
   'Nur Aisyah', 'mechanic2@bicii.test', 'mechanic', true),
  ('5a000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000004',
   'Kavya Menon', 'manager@bicii.test', 'manager', true);

insert into public.staff_permissions (staff_id, permission, granted_by) values
  ('5a000000-0000-4000-8000-000000000002', 'view_costs', '5a000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------------------
-- Customers (Phase 1). Emails use the reserved example.com domain.
-- ---------------------------------------------------------------------------
insert into public.customers
  (id, first_name, last_name, display_name, email, phone, internal_notes)
values
  ('c1000000-0000-4000-8000-000000000001', 'Wei Ming', 'Tan', 'Tan Wei Ming',
   'weiming.tan@example.com', '+65 9123 4567',
   'Prefers WhatsApp. Rides with the Sunday Coast Road group.'),
  ('c1000000-0000-4000-8000-000000000002', 'Priya', 'Ramasamy', null,
   'priya.ramasamy@example.com', '+65 8234 5678', null),
  ('c1000000-0000-4000-8000-000000000003', 'Muhammad Hafiz', 'Rahman', 'Hafiz Rahman',
   'hafiz.rahman@example.com', '+65 9345 6789',
   'Commutes daily from Tampines; keep a spare 16-inch tube for him.'),
  ('c1000000-0000-4000-8000-000000000004', 'Chloe', 'Lim', null,
   'chloe.lim@example.com', '+65 8456 7890', null),
  ('c1000000-0000-4000-8000-000000000005', 'Daniel', 'Ong', null,
   'daniel.ong@example.com', '+65 9567 8901',
   'Call before any extra work over $100.'),
  ('c1000000-0000-4000-8000-000000000006', 'Nurul Huda', 'Ismail', null,
   null, '+65 8678 9012', null);

-- ---------------------------------------------------------------------------
-- Bikes (Phase 1). Short IDs are assigned by the database in this order;
-- ownership events (`registered`) are written by the bikes trigger.
-- ---------------------------------------------------------------------------
insert into public.bikes
  (id, customer_id, brand, model, variant, frame_size, colour, serial_number, description, internal_notes)
values
  ('b1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
   'Specialized', 'Tarmac SL7', 'Expert', '56', 'Gloss Red Tint', 'WSBC604123456N',
   'Road bike, Ultegra Di2, Roval C38 wheels.', 'Rear derailleur hanger replaced once.'),
  ('b1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001',
   'Brompton', 'C Line', 'Explore 6-speed', 'One size', 'Racing Green', '2203154321',
   'Folding commuter with front bag mount.', null),
  ('b1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000002',
   'Trek', 'Domane', 'SL 6', '54', 'Crimson', 'WTU291C1234K',
   'Endurance road bike.', null),
  ('b1000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000002',
   'Tern', 'Verge', 'D9', null, 'Black', 'TRN-19-0045821',
   'Folding bike kept at the office.', null),
  ('b1000000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-000000000003',
   'Brompton', 'P Line', 'Urban', 'One size', 'Storm Grey', '2306187766',
   'Titanium rear triangle.', 'Customer supplies his own chain lube.'),
  ('b1000000-0000-4000-8000-000000000006', 'c1000000-0000-4000-8000-000000000004',
   'Giant', 'TCR Advanced Pro', '1', 'M', 'Carbon / Blue', 'GT9K23456',
   null, null),
  ('b1000000-0000-4000-8000-000000000007', 'c1000000-0000-4000-8000-000000000004',
   'Surly', 'Long Haul Trucker', null, '52', 'Pea Lime Soup', null,
   'Touring build; serial number not legible.', null),
  ('b1000000-0000-4000-8000-000000000008', 'c1000000-0000-4000-8000-000000000005',
   'Cannondale', 'SuperSix EVO', 'Hi-Mod', '54', 'Black Magic', 'CDA12345678',
   null, 'Crash damage on the top tube inspected in March; no structural issue found.'),
  ('b1000000-0000-4000-8000-000000000009', 'c1000000-0000-4000-8000-000000000005',
   'Bianchi', 'Via Nirone 7', null, '53', 'Celeste', 'BIA-VN7-88213',
   'Aluminium road bike, Sora groupset.', null),
  ('b1000000-0000-4000-8000-000000000010', null,
   'Cervelo', 'Caledonia-5', null, '56', 'Five Black', 'CV-CAL5-0921',
   'Shop demo bike.', 'Demo fleet: check tyre pressure before each test ride.');

-- Daniel sold his Bianchi to Nurul: a `transferred` event with its reason.
select private.set_change_reason('Sold privately to Nurul Huda Ismail; both confirmed in the shop.');
update public.bikes
set customer_id = 'c1000000-0000-4000-8000-000000000006'
where id = 'b1000000-0000-4000-8000-000000000009';
select private.set_change_reason(null);

-- ===========================================================================
-- History relative to the reset day (DATA-MODEL.md §18 "Phase 5 part").
-- pg_temp.seed_at(days_ago, local_time) is the instant at `local_time`
-- Singapore time on the shop day `days_ago` days before the shop day the
-- seed runs (private.shop_today(), D35). Day 0 (today) is compressed into
-- the part of today that has already passed, in proportion, so today's
-- rows keep their order and are never in the future, whatever time the
-- reset runs. Session-temporary: it exists only while the seed runs (one
-- session, one transaction, so now() is the same in every statement).
-- Singapore has no DST, so seed_at(n, t) - seed_at(m, t) is exactly
-- (m - n) x 24 h for n, m > 0.
-- ===========================================================================
create function pg_temp.seed_at(days_ago integer, local_time time)
returns timestamptz
language sql
stable
as $$
  select case
    when days_ago > 0 then
      ((private.shop_today() - days_ago) + local_time) at time zone 'Asia/Singapore'
    else
      private.shop_day_start(private.shop_today())
        + (now() - private.shop_day_start(private.shop_today()))
          * (extract(epoch from local_time) / 86400)
  end;
$$;

-- ===========================================================================
-- Phase 3: workshop catalog and nine jobs (DATA-MODEL.md §18 "Phase 3
-- part"). Written directly as the owner; the triggers still enforce every
-- rule (status machine, D18 owner check, line locking, append-only
-- timeline) and write the timeline events.
--
-- So that every seeded timeline reads true:
--   (a) intake_notes, completion_notes, approval_flag and approval_note are
--       given in each work_orders INSERT (the insert trigger only writes
--       `checked_in`); the backdated note_added, diagnosis_added and
--       approval_flagged events are inserted by hand with their own
--       created_at and actor. Those columns are never UPDATEd here: an
--       update would write a details_changed / approval_flagged event
--       stamped at seed time.
--   (b) Before each block of writes request.jwt.claims names the staff
--       member acting, so the actor the triggers record always matches the
--       row's own created_by / assigned_by / voided_by. Asha Admin checks
--       jobs in and assigns at intake; Marcus Tan (view_costs) and Nur
--       Aisyah (no permissions) walk their own jobs' statuses and Nur voids
--       J-000009's bottom bracket line; lines that carry a cost are created
--       by Asha or Marcus (D14).
--   (c) Each job is inserted as `received` with an explicit checked_in_at,
--       then gets its assignments and lines (explicit times) while it is
--       open, then walks its statuses one UPDATE at a time with an explicit
--       status_changed_at. Every time is pg_temp.seed_at(days ago, local
--       time) plus the same minute/hour offsets as before: one base local
--       time per job (10:00), so every stamp keeps its exact hours after
--       check-in, and every time falls between 08:00 and 18:00 Singapore
--       time on a past shop day (J-000003 completes on day 1 at 16:00).
--       Times are strictly increasing per job, and no line or void comes
--       after a job's completion.
--   (d) J-000007 is checked in AFTER the Phase 1 Bianchi sale above (Daniel
--       -> Nurul, at seed time): its checked_in_at is clock_timestamp() at
--       its insert, so by the bike's ownership history Nurul already owns
--       the bike when it is checked in.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Service categories and services (Phase 3). Costs are staff-only
-- (services_staff, view_costs).
-- ---------------------------------------------------------------------------
insert into public.categories (id, kind, name, sort_order) values
  ('ca000000-0000-4000-8000-000000000001', 'service', 'Servicing', 1),
  ('ca000000-0000-4000-8000-000000000002', 'service', 'Wheels & tyres', 2),
  ('ca000000-0000-4000-8000-000000000003', 'service', 'Brakes', 3),
  ('ca000000-0000-4000-8000-000000000004', 'service', 'Builds', 4),
  ('ca000000-0000-4000-8000-000000000005', 'service', 'Labour', 5);

insert into public.services
  (id, name, description, category_id, default_sale_price, default_direct_cost, currency,
   active, public, sort_order, archived_at)
values
  ('5e000000-0000-4000-8000-000000000001', 'Basic Service',
   'Safety check, gear and brake adjustment, chain clean and lube.',
   'ca000000-0000-4000-8000-000000000001', 80.00, 0.00, 'SGD', true, true, 1, null),
  ('5e000000-0000-4000-8000-000000000002', 'Full Service',
   'Strip-down clean, bearing check, drivetrain degrease, gear and brake set-up.',
   'ca000000-0000-4000-8000-000000000001', 200.00, 0.00, 'SGD', true, true, 2, null),
  ('5e000000-0000-4000-8000-000000000003', 'Wheel True',
   'Per wheel.',
   'ca000000-0000-4000-8000-000000000002', 35.00, 0.00, 'SGD', true, true, 3, null),
  ('5e000000-0000-4000-8000-000000000004', 'Tyre Installation',
   'Per tyre, labour only.',
   'ca000000-0000-4000-8000-000000000002', 15.00, 0.00, 'SGD', true, true, 4, null),
  ('5e000000-0000-4000-8000-000000000005', 'Brake Bleed',
   'Per brake, includes fluid.',
   'ca000000-0000-4000-8000-000000000003', 45.00, 8.00, 'SGD', true, true, 5, null),
  ('5e000000-0000-4000-8000-000000000006', 'Drivetrain Service',
   'Chain, cassette and chainring deep clean, wear check and fresh lube.',
   'ca000000-0000-4000-8000-000000000001', 90.00, 5.00, 'SGD', true, true, 6, null),
  ('5e000000-0000-4000-8000-000000000007', 'Bike Build',
   'Full build from frame and parts, with set-up and a test ride.',
   'ca000000-0000-4000-8000-000000000004', 250.00, 0.00, 'SGD', true, true, 7, null),
  ('5e000000-0000-4000-8000-000000000008', 'Custom Labour',
   'Per hour.',
   'ca000000-0000-4000-8000-000000000005', 60.00, 0.00, 'SGD', true, false, 8, null),
  ('5e000000-0000-4000-8000-000000000009', 'Suspension Fork Service',
   'Lower-leg service with new seals and fork oil.',
   'ca000000-0000-4000-8000-000000000001', 120.00, 25.00, 'SGD', false, true, 9,
   pg_temp.seed_at(30, '09:00'));

-- ---------------------------------------------------------------------------
-- J-000001: Tan's Tarmac, collected. Lead Marcus. Sale 290.00, cost 16.00,
-- yield 274.00, Cult Commons 82.20.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

insert into public.work_orders
  (id, customer_id, bike_id, requested_work, intake_notes, completion_notes,
   checked_in_at, created_at, created_by)
values
  ('f1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
   'b1000000-0000-4000-8000-000000000001',
   'Full service before the Desaru ride; rear brake feels spongy.',
   'Light scratches on the top tube; rear tyre worn.',
   'Bled the rear brake twice; pads at 40%.',
   pg_temp.seed_at(9, '10:00'), pg_temp.seed_at(9, '10:00'),
   '5a000000-0000-4000-8000-000000000001');

insert into public.work_order_assignments (id, work_order_id, staff_id, role, assigned_by, assigned_at)
values
  ('f3000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
   '5a000000-0000-4000-8000-000000000002', 'lead', '5a000000-0000-4000-8000-000000000001',
   pg_temp.seed_at(9, '10:00') + interval '5 minutes');

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', false);

insert into public.work_order_line_items
  (id, work_order_id, line_type, source_service_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency,
   created_by, created_at)
values
  ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'service',
   '5e000000-0000-4000-8000-000000000002', 'Full Service', 1, 200.00, 0.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000002', pg_temp.seed_at(9, '10:00') + interval '10 minutes'),
  ('f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', 'service',
   '5e000000-0000-4000-8000-000000000005', 'Brake Bleed', 2, 45.00, 8.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000002', pg_temp.seed_at(9, '10:00') + interval '11 minutes');

update public.work_orders set status = 'in_progress', status_changed_at = pg_temp.seed_at(8, '10:00')
where id = 'f1000000-0000-4000-8000-000000000001';
update public.work_orders set status = 'completed', status_changed_at = pg_temp.seed_at(7, '10:00')
where id = 'f1000000-0000-4000-8000-000000000001';
update public.work_orders
set status = 'ready_for_collection', status_changed_at = pg_temp.seed_at(7, '10:00') + interval '1 hour'
where id = 'f1000000-0000-4000-8000-000000000001';
update public.work_orders set status = 'collected', status_changed_at = pg_temp.seed_at(6, '10:00')
where id = 'f1000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- J-000002: Priya's Domane, ready for collection. Lead Nur; Asha prices it
-- at intake and adds the tyres once the customer approves them. Sale 300.00,
-- cost 124.00, yield 176.00, Cult Commons 52.80, BICII after CC 123.20.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

insert into public.work_orders
  (id, customer_id, bike_id, requested_work, approval_flag, approval_note,
   checked_in_at, created_at, created_by)
values
  ('f1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002',
   'b1000000-0000-4000-8000-000000000003',
   'Basic service and new tyres.',
   true, 'Customer approved the GP5000 upgrade by phone.',
   pg_temp.seed_at(5, '10:00'), pg_temp.seed_at(5, '10:00'),
   '5a000000-0000-4000-8000-000000000001');

insert into public.work_order_assignments (id, work_order_id, staff_id, role, assigned_by, assigned_at)
values
  ('f3000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002',
   '5a000000-0000-4000-8000-000000000003', 'lead', '5a000000-0000-4000-8000-000000000001',
   pg_temp.seed_at(5, '10:00') + interval '5 minutes');

insert into public.work_order_line_items
  (id, work_order_id, line_type, source_service_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency,
   created_by, created_at)
values
  ('f2000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000002', 'service',
   '5e000000-0000-4000-8000-000000000001', 'Basic Service', 1, 80.00, 0.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000001', pg_temp.seed_at(5, '10:00') + interval '10 minutes'),
  ('f2000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000002', 'service',
   '5e000000-0000-4000-8000-000000000004', 'Tyre Installation', 2, 15.00, 0.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000001', pg_temp.seed_at(5, '10:00') + interval '11 minutes');

-- (a) The approval as it happened, an hour after check-in.
insert into public.work_order_events
  (work_order_id, event_type, actor_staff_id, actor_user_id, payload, created_at)
values
  ('f1000000-0000-4000-8000-000000000002', 'approval_flagged',
   '5a000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   jsonb_build_object('flagged', true, 'note', 'Customer approved the GP5000 upgrade by phone.'),
   pg_temp.seed_at(5, '10:00') + interval '1 hour');

insert into public.work_order_line_items
  (id, work_order_id, line_type, source_service_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency,
   created_by, created_at)
values
  ('f2000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000002', 'manual',
   null, 'Continental GP5000 700×28c tyre', 2, 95.00, 62.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000001', pg_temp.seed_at(5, '10:00') + interval '90 minutes');

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', false);

update public.work_orders set status = 'in_progress', status_changed_at = pg_temp.seed_at(4, '10:00')
where id = 'f1000000-0000-4000-8000-000000000002';
update public.work_orders set status = 'completed', status_changed_at = pg_temp.seed_at(1, '10:00')
where id = 'f1000000-0000-4000-8000-000000000002';
update public.work_orders
set status = 'ready_for_collection', status_changed_at = pg_temp.seed_at(1, '10:00') + interval '30 minutes'
where id = 'f1000000-0000-4000-8000-000000000002';

-- ---------------------------------------------------------------------------
-- J-000003: Hafiz's Brompton, completed yesterday at 16:00 (six hours
-- after work started). Lead Marcus, Nur helping.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

insert into public.work_orders
  (id, customer_id, bike_id, requested_work, checked_in_at, created_at, created_by)
values
  ('f1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000003',
   'b1000000-0000-4000-8000-000000000005',
   'Drivetrain noisy, chain skipping.',
   pg_temp.seed_at(2, '10:00'), pg_temp.seed_at(2, '10:00'),
   '5a000000-0000-4000-8000-000000000001');

insert into public.work_order_assignments (id, work_order_id, staff_id, role, assigned_by, assigned_at)
values
  ('f3000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000003',
   '5a000000-0000-4000-8000-000000000002', 'lead', '5a000000-0000-4000-8000-000000000001',
   pg_temp.seed_at(2, '10:00') + interval '5 minutes'),
  ('f3000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000003',
   '5a000000-0000-4000-8000-000000000003', 'additional', '5a000000-0000-4000-8000-000000000001',
   pg_temp.seed_at(2, '10:00') + interval '6 minutes');

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', false);

insert into public.work_order_line_items
  (id, work_order_id, line_type, source_service_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency,
   created_by, created_at)
values
  ('f2000000-0000-4000-8000-000000000006', 'f1000000-0000-4000-8000-000000000003', 'service',
   '5e000000-0000-4000-8000-000000000006', 'Drivetrain Service', 1, 90.00, 5.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000002', pg_temp.seed_at(2, '10:00') + interval '10 minutes');

update public.work_orders set status = 'in_progress', status_changed_at = pg_temp.seed_at(1, '10:00')
where id = 'f1000000-0000-4000-8000-000000000003';
update public.work_orders set status = 'completed', status_changed_at = pg_temp.seed_at(1, '16:00')
where id = 'f1000000-0000-4000-8000-000000000003';

-- ---------------------------------------------------------------------------
-- J-000004: Chloe's Giant, in progress. Lead Marcus.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

insert into public.work_orders
  (id, customer_id, bike_id, requested_work, checked_in_at, created_at, created_by)
values
  ('f1000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000004',
   'b1000000-0000-4000-8000-000000000006',
   'Both wheels out of true after a pothole.',
   pg_temp.seed_at(3, '10:00'), pg_temp.seed_at(3, '10:00'),
   '5a000000-0000-4000-8000-000000000001');

insert into public.work_order_assignments (id, work_order_id, staff_id, role, assigned_by, assigned_at)
values
  ('f3000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000004',
   '5a000000-0000-4000-8000-000000000002', 'lead', '5a000000-0000-4000-8000-000000000001',
   pg_temp.seed_at(3, '10:00') + interval '5 minutes');

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', false);

insert into public.work_order_line_items
  (id, work_order_id, line_type, source_service_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency,
   created_by, created_at)
values
  ('f2000000-0000-4000-8000-000000000007', 'f1000000-0000-4000-8000-000000000004', 'service',
   '5e000000-0000-4000-8000-000000000003', 'Wheel True', 2, 35.00, 0.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000002', pg_temp.seed_at(3, '10:00') + interval '10 minutes');

update public.work_orders
set status = 'diagnosing', status_changed_at = pg_temp.seed_at(3, '10:00') + interval '1 hour'
where id = 'f1000000-0000-4000-8000-000000000004';
update public.work_orders set status = 'in_progress', status_changed_at = pg_temp.seed_at(1, '10:00')
where id = 'f1000000-0000-4000-8000-000000000004';

-- ---------------------------------------------------------------------------
-- J-000005: Chloe's Surly, awaiting parts (the customer's shifter). Lead Nur.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

insert into public.work_orders
  (id, customer_id, bike_id, requested_work, checked_in_at, created_at, created_by)
values
  ('f1000000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-000000000004',
   'b1000000-0000-4000-8000-000000000007',
   'Replace worn 9-speed shifter; customer supplying the part.',
   pg_temp.seed_at(6, '10:00'), pg_temp.seed_at(6, '10:00'),
   '5a000000-0000-4000-8000-000000000001');

insert into public.work_order_assignments (id, work_order_id, staff_id, role, assigned_by, assigned_at)
values
  ('f3000000-0000-4000-8000-000000000006', 'f1000000-0000-4000-8000-000000000005',
   '5a000000-0000-4000-8000-000000000003', 'lead', '5a000000-0000-4000-8000-000000000001',
   pg_temp.seed_at(6, '10:00') + interval '5 minutes');

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', false);

insert into public.work_order_line_items
  (id, work_order_id, line_type, source_service_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency,
   created_by, created_at)
values
  ('f2000000-0000-4000-8000-000000000008', 'f1000000-0000-4000-8000-000000000005', 'service',
   '5e000000-0000-4000-8000-000000000008', 'Custom Labour', 1.5, 60.00, 0.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000003', pg_temp.seed_at(6, '10:00') + interval '10 minutes');

-- (a) Nur's note, an hour before the job waits for the part.
insert into public.work_order_events
  (work_order_id, event_type, actor_staff_id, actor_user_id, payload, created_at)
values
  ('f1000000-0000-4000-8000-000000000005', 'note_added',
   '5a000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003',
   jsonb_build_object('body', 'Waiting for the customer''s 9-speed shifter to arrive.'),
   pg_temp.seed_at(5, '10:00') - interval '1 hour');

update public.work_orders set status = 'awaiting_parts', status_changed_at = pg_temp.seed_at(5, '10:00')
where id = 'f1000000-0000-4000-8000-000000000005';

-- ---------------------------------------------------------------------------
-- J-000006: Daniel's Cannondale, awaiting the customer's go-ahead on a
-- quote. Checked in 8 days ago and still open: overdue (D20). Lead Marcus.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

insert into public.work_orders
  (id, customer_id, bike_id, requested_work, checked_in_at, created_at, created_by)
values
  ('f1000000-0000-4000-8000-000000000006', 'c1000000-0000-4000-8000-000000000005',
   'b1000000-0000-4000-8000-000000000008',
   'Shifting rough; check chain wear.',
   pg_temp.seed_at(8, '10:00'), pg_temp.seed_at(8, '10:00'),
   '5a000000-0000-4000-8000-000000000001');

insert into public.work_order_assignments (id, work_order_id, staff_id, role, assigned_by, assigned_at)
values
  ('f3000000-0000-4000-8000-000000000007', 'f1000000-0000-4000-8000-000000000006',
   '5a000000-0000-4000-8000-000000000002', 'lead', '5a000000-0000-4000-8000-000000000001',
   pg_temp.seed_at(8, '10:00') + interval '5 minutes');

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', false);

-- (a) Marcus's diagnosis.
insert into public.work_order_events
  (work_order_id, event_type, actor_staff_id, actor_user_id, payload, created_at)
values
  ('f1000000-0000-4000-8000-000000000006', 'diagnosis_added',
   '5a000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002',
   jsonb_build_object('body', 'Chain at 0.75% wear; cassette worn. Quoted new chain and cassette.'),
   pg_temp.seed_at(8, '10:00') + interval '2 hours');

update public.work_orders
set status = 'awaiting_customer', status_changed_at = pg_temp.seed_at(8, '10:00') + interval '3 hours'
where id = 'f1000000-0000-4000-8000-000000000006';

-- ---------------------------------------------------------------------------
-- J-000007: Nurul's Bianchi, just received, unassigned. (d) Checked in at
-- clock_timestamp(), after the Bianchi's sale to Nurul earlier in this seed.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

insert into public.work_orders
  (id, customer_id, bike_id, requested_work, checked_in_at, created_at, created_by)
values
  ('f1000000-0000-4000-8000-000000000007', 'c1000000-0000-4000-8000-000000000006',
   'b1000000-0000-4000-8000-000000000009',
   'Squeaky brakes.',
   clock_timestamp(), clock_timestamp(),
   '5a000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------------------
-- J-000008: Tan's Brompton, cancelled an hour after check-in. Lead Nur.
-- ---------------------------------------------------------------------------
insert into public.work_orders
  (id, customer_id, bike_id, requested_work, checked_in_at, created_at, created_by)
values
  ('f1000000-0000-4000-8000-000000000008', 'c1000000-0000-4000-8000-000000000001',
   'b1000000-0000-4000-8000-000000000002',
   'Gear cable replacement.',
   pg_temp.seed_at(4, '10:00'), pg_temp.seed_at(4, '10:00'),
   '5a000000-0000-4000-8000-000000000001');

insert into public.work_order_assignments (id, work_order_id, staff_id, role, assigned_by, assigned_at)
values
  ('f3000000-0000-4000-8000-000000000008', 'f1000000-0000-4000-8000-000000000008',
   '5a000000-0000-4000-8000-000000000003', 'lead', '5a000000-0000-4000-8000-000000000001',
   pg_temp.seed_at(4, '10:00') + interval '5 minutes');

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', false);

select private.set_change_reason('Customer will bring it back next month.');
update public.work_orders
set status = 'cancelled', status_changed_at = pg_temp.seed_at(4, '10:00') + interval '1 hour'
where id = 'f1000000-0000-4000-8000-000000000008';
select private.set_change_reason(null);

-- ---------------------------------------------------------------------------
-- J-000009: Priya's Tern, being diagnosed. Lead Nur; Asha quoted a bottom
-- bracket, which Nur voided once she found the frame takes a press-fit one.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

insert into public.work_orders
  (id, customer_id, bike_id, requested_work, checked_in_at, created_at, created_by)
values
  ('f1000000-0000-4000-8000-000000000009', 'c1000000-0000-4000-8000-000000000002',
   'b1000000-0000-4000-8000-000000000004',
   'Bottom bracket creak.',
   pg_temp.seed_at(1, '10:00'), pg_temp.seed_at(1, '10:00'),
   '5a000000-0000-4000-8000-000000000001');

insert into public.work_order_assignments (id, work_order_id, staff_id, role, assigned_by, assigned_at)
values
  ('f3000000-0000-4000-8000-000000000009', 'f1000000-0000-4000-8000-000000000009',
   '5a000000-0000-4000-8000-000000000003', 'lead', '5a000000-0000-4000-8000-000000000001',
   pg_temp.seed_at(1, '10:00') + interval '5 minutes');

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', false);

insert into public.work_order_line_items
  (id, work_order_id, line_type, source_service_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency,
   created_by, created_at)
values
  ('f2000000-0000-4000-8000-000000000009', 'f1000000-0000-4000-8000-000000000009', 'service',
   '5e000000-0000-4000-8000-000000000001', 'Basic Service', 1, 80.00, 0.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000003', pg_temp.seed_at(1, '10:00') + interval '10 minutes');

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

insert into public.work_order_line_items
  (id, work_order_id, line_type, source_service_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency,
   created_by, created_at)
values
  ('f2000000-0000-4000-8000-000000000010', 'f1000000-0000-4000-8000-000000000009', 'manual',
   null, 'Shimano BB-RS500 bottom bracket', 1, 45.00, 28.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000001', pg_temp.seed_at(1, '10:00') + interval '15 minutes');

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', false);

update public.work_orders
set status = 'diagnosing', status_changed_at = pg_temp.seed_at(1, '10:00') + interval '1 hour'
where id = 'f1000000-0000-4000-8000-000000000009';

update public.work_order_line_items
set voided_at = pg_temp.seed_at(1, '10:00') + interval '3 hours',
    voided_by = '5a000000-0000-4000-8000-000000000003',
    void_reason = 'Wrong part quoted; the frame takes a press-fit bracket.'
where id = 'f2000000-0000-4000-8000-000000000010';

select set_config('request.jwt.claims', '', false);

-- ===========================================================================
-- Phase 4: inventory (DATA-MODEL.md §18 "Phase 4 part"). Locations,
-- product categories and products are written directly as the owner with
-- request.jwt.claims naming the admin (so created_by and every history
-- event name an actor). The opening stock and the three units are dated
-- 30 days before the reset day (pg_temp.seed_at(30, ...)), so they never
-- count as today's stock adjustments: they are owner statements writing
-- exactly the rows public.adjust_stock and public.create_unique_unit write
-- (same request ids, quantities, types, reasons, cost snapshots, actor),
-- with an explicit created_at. The products and units are dated that day
-- too; trigger-written history (product and unit events, the bikes' stock
-- link) keeps seed time. The inventory job J-000010 still goes through
-- the real RPCs as the admin, at seed time (today). Every request id is
-- used once. Products get P-000001 .. P-000016, units U-000001 ..
-- U-000003, the shop bikes B-000011 .. B-000013 and the job J-000010, in
-- insert order on a fresh build.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

-- Locations. 'Shop floor' is the inventory migration's one-shop bootstrap.
insert into public.locations (id, name, kind, sort_order) values
  ('1c000000-0000-4000-8000-000000000001', 'Shop floor', 'shop_floor', 10)
on conflict (id) do nothing;
insert into public.locations (id, name, kind, sort_order) values
  ('1c000000-0000-4000-8000-000000000002', 'Workshop store', 'workshop', 20);

-- Product categories (kind 'product'; names are unique per kind, so
-- "Brakes" repeats the service category's name).
insert into public.categories (id, kind, name, sort_order) values
  ('ca000000-0000-4000-8000-000000000006', 'product', 'Brakes', 1),
  ('ca000000-0000-4000-8000-000000000007', 'product', 'Tyres & tubes', 2),
  ('ca000000-0000-4000-8000-000000000008', 'product', 'Drivetrain', 3),
  ('ca000000-0000-4000-8000-000000000009', 'product', 'Cables & hoses', 4),
  ('ca000000-0000-4000-8000-000000000010', 'product', 'Care', 5),
  ('ca000000-0000-4000-8000-000000000011', 'product', 'Cockpit', 6),
  ('ca000000-0000-4000-8000-000000000012', 'product', 'Bikes', 7);

-- Products, one INSERT each so the short IDs follow this order. SGD price /
-- default direct cost; publication internal_only except the cassette
-- (draft).
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description, created_at)
values ('9a000000-0000-4000-8000-000000000001', 'SHI-L05A-RF', 'Road disc brake pads, resin (pair)',
  'Shimano', 'ca000000-0000-4000-8000-000000000006', 'quantity', 'internal_only', 28.00, 13.50, 10,
  'L05A resin pads for Shimano road disc callipers. Quiet, good modulation.',
  pg_temp.seed_at(30, '07:00'));
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description, created_at)
values ('9a000000-0000-4000-8000-000000000002', 'CON-GP5K-25', 'Grand Prix 5000 700x25c tyre',
  'Continental', 'ca000000-0000-4000-8000-000000000007', 'quantity', 'internal_only', 89.00, 52.00, 4,
  'Folding clincher road tyre, BlackChili compound.',
  pg_temp.seed_at(30, '07:00'));
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description, created_at)
values ('9a000000-0000-4000-8000-000000000003', 'SCH-SV20-60', 'Road inner tube 700x23-28c Presta 60mm',
  'Schwalbe', 'ca000000-0000-4000-8000-000000000007', 'quantity', 'internal_only', 9.00, 3.80, 20,
  'SV20 tube with a 60 mm Presta valve for deep rims.',
  pg_temp.seed_at(30, '07:00'));
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description, created_at)
values ('9a000000-0000-4000-8000-000000000004', 'SCH-MR-16', 'Marathon Racer 16x1.35 tyre',
  'Schwalbe', 'ca000000-0000-4000-8000-000000000007', 'quantity', 'internal_only', 55.00, 30.00, 3,
  'Puncture-resistant 16-inch tyre for folding bikes.',
  pg_temp.seed_at(30, '07:00'));
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description, created_at)
values ('9a000000-0000-4000-8000-000000000005', 'BRO-QTUBE16', 'Inner tube 16in Schrader',
  'Brompton', 'ca000000-0000-4000-8000-000000000007', 'quantity', 'internal_only', 14.00, 6.00, 6,
  'Genuine Brompton 16-inch tube, Schrader valve.',
  pg_temp.seed_at(30, '07:00'));
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description, created_at)
values ('9a000000-0000-4000-8000-000000000006', 'KMC-X11-GY', 'X11 11-speed chain',
  'KMC', 'ca000000-0000-4000-8000-000000000008', 'quantity', 'internal_only', 45.00, 24.00, 5,
  '118 links with a MissingLink connector.',
  pg_temp.seed_at(30, '07:00'));
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description, created_at)
values ('9a000000-0000-4000-8000-000000000007', 'SHI-CSR7000-1134', '105 CS-R7000 11-34 cassette',
  'Shimano', 'ca000000-0000-4000-8000-000000000008', 'quantity', 'draft', 109.00, 68.00, 2,
  null,
  pg_temp.seed_at(30, '07:00'));
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description, created_at)
values ('9a000000-0000-4000-8000-000000000008', 'JAG-PRO-BRK', 'Pro brake cable kit',
  'Jagwire', 'ca000000-0000-4000-8000-000000000009', 'quantity', 'internal_only', 35.00, 16.00, 4,
  'Slick-polished cables with compressionless housing, road and MTB.',
  pg_temp.seed_at(30, '07:00'));
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description, created_at)
values ('9a000000-0000-4000-8000-000000000009', 'SHI-BH90-1000', 'SM-BH90 hydraulic hose 1000mm',
  'Shimano', 'ca000000-0000-4000-8000-000000000009', 'quantity', 'internal_only', 28.00, 12.00, 5,
  null,
  pg_temp.seed_at(30, '07:00'));
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description, created_at)
values ('9a000000-0000-4000-8000-000000000010', 'FL-DRY-120', 'Dry chain lube 120ml',
  'Finish Line', 'ca000000-0000-4000-8000-000000000010', 'quantity', 'internal_only', 16.00, 7.00, 6,
  'Teflon-fortified dry lube for dusty, dry rides.',
  pg_temp.seed_at(30, '07:00'));
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description, created_at)
values ('9a000000-0000-4000-8000-000000000011', 'LS-DSP32', 'DSP 3.2mm bar tape',
  'Lizard Skins', 'ca000000-0000-4000-8000-000000000011', 'quantity', 'internal_only', 49.00, 26.00, 4,
  null,
  pg_temp.seed_at(30, '07:00'));
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description, created_at)
values ('9a000000-0000-4000-8000-000000000012', 'OS-REG-237', 'Tubeless sealant 237ml',
  'Orange Seal', 'ca000000-0000-4000-8000-000000000007', 'quantity', 'internal_only', 32.00, 17.00, 3,
  null,
  pg_temp.seed_at(30, '07:00'));
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description, created_at)
values ('9a000000-0000-4000-8000-000000000013', null, 'Colnago C64 Disc 52s (pre-owned)',
  'Colnago', 'ca000000-0000-4000-8000-000000000012', 'unique', 'internal_only', 6800.00, 4200.00, null,
  'Lugged carbon road frame, Dura-Ace Di2 R9170, Fulcrum Racing Zero wheels.',
  pg_temp.seed_at(30, '07:00'));
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description, created_at)
values ('9a000000-0000-4000-8000-000000000014', null, 'Brompton C Line Explore (ex-demo)',
  'Brompton', 'ca000000-0000-4000-8000-000000000012', 'unique', 'internal_only', 1950.00, 1400.00, null,
  'Six-speed folding bike from the demo fleet, serviced and with new tyres.',
  pg_temp.seed_at(30, '07:00'));
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description, created_at)
values ('9a000000-0000-4000-8000-000000000015', null, 'Surly Bridge Club 27.5 M (new old stock)',
  'Surly', 'ca000000-0000-4000-8000-000000000012', 'unique', 'internal_only', 1650.00, 1100.00, null,
  'Steel all-road tourer, 27.5 x 2.4 tyres, unridden from 2022 stock.',
  pg_temp.seed_at(30, '07:00'));
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description, created_at)
values ('9a000000-0000-4000-8000-000000000016', 'KMC-X10-OLD', 'X10 10-speed chain (discontinued)',
  'KMC', 'ca000000-0000-4000-8000-000000000008', 'quantity', 'internal_only', 35.00, 18.00, null,
  'No longer stocked; kept for the jobs that used it.',
  pg_temp.seed_at(30, '07:00'));
-- Archived after it sold out (no stock): an `archived` event.
update public.products set archived_at = now() where id = '9a000000-0000-4000-8000-000000000016';

-- Three shop bikes (no owner), in stock as the unique units below.
insert into public.bikes
  (id, customer_id, brand, model, variant, frame_size, colour, serial_number, description, internal_notes)
values
  ('b1000000-0000-4000-8000-000000000011', null,
   'Colnago', 'C64 Disc', null, '52s', 'PJBK Black', 'COL-C64-11873',
   'Pre-owned; one careful owner.', 'Bought in from a trade-in in August.'),
  ('b1000000-0000-4000-8000-000000000012', null,
   'Brompton', 'C Line', 'Explore 6-speed', 'One size', 'Matcha Green', '2209183344',
   'Ex-demo folding bike.', null),
  ('b1000000-0000-4000-8000-000000000013', null,
   'Surly', 'Bridge Club', '27.5', 'M', 'Metallic Blue', 'SRY-BC-55102',
   'New old stock.', null);

-- Opening stock, 30 days before the reset day: what public.adjust_stock
-- writes for (request id, product, location, +qty, 'stock_adjustment',
-- 'Opening stock count') with no unit cost, i.e. one 'stock_adjustment'
-- movement whose cost snapshot is the product's default direct cost, in
-- the product's currency, by the admin. Request ids 9c…0NN per product at
-- its first location; 9c…1NN for the Workshop store rows of 03 and 12.
-- One minute apart from 08:00, in this order.
insert into public.inventory_movements
  (product_id, inventory_unit_id, location_id, quantity_delta, movement_type, reason,
   unit_cost_snapshot, request_id, currency, created_by, created_at)
select r.product_id, null, r.location_id, r.qty, 'stock_adjustment', 'Opening stock count',
       p.default_direct_cost, r.request_id, p.currency, '5a000000-0000-4000-8000-000000000001',
       pg_temp.seed_at(30, '08:00') + (r.ord - 1) * interval '1 minute'
from (values
  ('9c000000-0000-4000-8000-000000000001'::uuid, '9a000000-0000-4000-8000-000000000001'::uuid,
   '1c000000-0000-4000-8000-000000000001'::uuid, 34, 1),
  ('9c000000-0000-4000-8000-000000000002', '9a000000-0000-4000-8000-000000000002',
   '1c000000-0000-4000-8000-000000000001', 12, 2),
  ('9c000000-0000-4000-8000-000000000003', '9a000000-0000-4000-8000-000000000003',
   '1c000000-0000-4000-8000-000000000001', 40, 3),
  ('9c000000-0000-4000-8000-000000000103', '9a000000-0000-4000-8000-000000000003',
   '1c000000-0000-4000-8000-000000000002', 20, 4),
  ('9c000000-0000-4000-8000-000000000004', '9a000000-0000-4000-8000-000000000004',
   '1c000000-0000-4000-8000-000000000001', 6, 5),
  ('9c000000-0000-4000-8000-000000000005', '9a000000-0000-4000-8000-000000000005',
   '1c000000-0000-4000-8000-000000000001', 15, 6),
  ('9c000000-0000-4000-8000-000000000006', '9a000000-0000-4000-8000-000000000006',
   '1c000000-0000-4000-8000-000000000001', 8, 7),
  ('9c000000-0000-4000-8000-000000000007', '9a000000-0000-4000-8000-000000000007',
   '1c000000-0000-4000-8000-000000000001', 3, 8),
  ('9c000000-0000-4000-8000-000000000008', '9a000000-0000-4000-8000-000000000008',
   '1c000000-0000-4000-8000-000000000001', 2, 9),
  ('9c000000-0000-4000-8000-000000000009', '9a000000-0000-4000-8000-000000000009',
   '1c000000-0000-4000-8000-000000000001', 1, 10),
  ('9c000000-0000-4000-8000-000000000010', '9a000000-0000-4000-8000-000000000010',
   '1c000000-0000-4000-8000-000000000001', 18, 11),
  ('9c000000-0000-4000-8000-000000000011', '9a000000-0000-4000-8000-000000000011',
   '1c000000-0000-4000-8000-000000000001', 7, 12),
  ('9c000000-0000-4000-8000-000000000012', '9a000000-0000-4000-8000-000000000012',
   '1c000000-0000-4000-8000-000000000001', 1, 13),
  ('9c000000-0000-4000-8000-000000000112', '9a000000-0000-4000-8000-000000000012',
   '1c000000-0000-4000-8000-000000000002', 1, 14)
) as r (request_id, product_id, location_id, qty, ord)
join public.products p on p.id = r.product_id
order by r.ord;

-- The unique units (U-000001 .. U-000003), each linked to its shop bike,
-- right after the opening stock on the same day: what
-- public.create_unique_unit writes with no reason, one unit at a time in
-- this order: the shop-owned unit (no sale price), the bike's link to it
-- and its +1 'stock_adjustment' movement ('Registered as a unique item',
-- cost snapshot = the unit's direct cost, request id = the unit id). The
-- products stay internal_only, so no publication refresh applies.
select private.set_change_reason(null);

insert into public.inventory_units
  (id, product_id, location_id, ownership_type, serial_number, condition, sale_price, direct_cost,
   bike_id, created_at)
values ('9b000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000013',
  '1c000000-0000-4000-8000-000000000001', 'shop_owned', 'COL-C64-11873',
  'Excellent: light wear on the bar tape, new chain and cassette at 3,000 km.',
  null, 4200.00, 'b1000000-0000-4000-8000-000000000011', pg_temp.seed_at(30, '08:14'));
update public.bikes set inventory_unit_id = '9b000000-0000-4000-8000-000000000001'
where id = 'b1000000-0000-4000-8000-000000000011';
insert into public.inventory_movements
  (product_id, inventory_unit_id, location_id, quantity_delta, movement_type, reason,
   unit_cost_snapshot, request_id, currency, created_by, created_at)
values ('9a000000-0000-4000-8000-000000000013', '9b000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001', 1, 'stock_adjustment', 'Registered as a unique item',
  4200.00, '9b000000-0000-4000-8000-000000000001', 'SGD', '5a000000-0000-4000-8000-000000000001',
  pg_temp.seed_at(30, '08:14'));

insert into public.inventory_units
  (id, product_id, location_id, ownership_type, serial_number, condition, sale_price, direct_cost,
   bike_id, created_at)
values ('9b000000-0000-4000-8000-000000000002', '9a000000-0000-4000-8000-000000000014',
  '1c000000-0000-4000-8000-000000000001', 'shop_owned', '2209183344',
  'Very good: demo fleet, serviced, new Marathon Racer tyres.',
  null, 1400.00, 'b1000000-0000-4000-8000-000000000012', pg_temp.seed_at(30, '08:15'));
update public.bikes set inventory_unit_id = '9b000000-0000-4000-8000-000000000002'
where id = 'b1000000-0000-4000-8000-000000000012';
insert into public.inventory_movements
  (product_id, inventory_unit_id, location_id, quantity_delta, movement_type, reason,
   unit_cost_snapshot, request_id, currency, created_by, created_at)
values ('9a000000-0000-4000-8000-000000000014', '9b000000-0000-4000-8000-000000000002',
  '1c000000-0000-4000-8000-000000000001', 1, 'stock_adjustment', 'Registered as a unique item',
  1400.00, '9b000000-0000-4000-8000-000000000002', 'SGD', '5a000000-0000-4000-8000-000000000001',
  pg_temp.seed_at(30, '08:15'));

insert into public.inventory_units
  (id, product_id, location_id, ownership_type, serial_number, condition, sale_price, direct_cost,
   bike_id, created_at)
values ('9b000000-0000-4000-8000-000000000003', '9a000000-0000-4000-8000-000000000015',
  '1c000000-0000-4000-8000-000000000001', 'shop_owned', 'SRY-BC-55102',
  'New: unridden, small storage mark on the left chainstay.',
  null, 1100.00, 'b1000000-0000-4000-8000-000000000013', pg_temp.seed_at(30, '08:16'));
update public.bikes set inventory_unit_id = '9b000000-0000-4000-8000-000000000003'
where id = 'b1000000-0000-4000-8000-000000000013';
insert into public.inventory_movements
  (product_id, inventory_unit_id, location_id, quantity_delta, movement_type, reason,
   unit_cost_snapshot, request_id, currency, created_by, created_at)
values ('9a000000-0000-4000-8000-000000000015', '9b000000-0000-4000-8000-000000000003',
  '1c000000-0000-4000-8000-000000000001', 1, 'stock_adjustment', 'Registered as a unique item',
  1100.00, '9b000000-0000-4000-8000-000000000003', 'SGD', '5a000000-0000-4000-8000-000000000001',
  pg_temp.seed_at(30, '08:16'));

-- The inventory job (J-000010): Hafiz's own Brompton (D18; his other job,
-- J-000003, is completed), left open with a tube used and a tyre returned.
select public.create_work_order(
  '9e000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000003',
  'b1000000-0000-4000-8000-000000000005', 'Puncture on the rear; replace the tube.',
  null, '5a000000-0000-4000-8000-000000000001');
select public.add_inventory_line(
  '9d000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000001',
  '9a000000-0000-4000-8000-000000000005', 1, '1c000000-0000-4000-8000-000000000001');
select public.add_inventory_line(
  '9d000000-0000-4000-8000-000000000002', '9e000000-0000-4000-8000-000000000001',
  '9a000000-0000-4000-8000-000000000004', 1, '1c000000-0000-4000-8000-000000000001');
select public.void_line('9d000000-0000-4000-8000-000000000002', 'Customer brought their own tyre');

select set_config('request.jwt.claims', '', false);

-- ===========================================================================
-- Phase 5: a week of shop history for Today and the reports (DATA-MODEL.md
-- §18 "Phase 5 part"; fixtures in tests/fixtures/reporting.ts). Eleven
-- jobs J-000011 .. J-000021 in insert order: H1-H8 on past shop days, T1-T3
-- today, and three stock adjustments A1-A3, on six new products P-000017 ..
-- P-000022 (so Phase 4's on-hand figures stay as they were). Written as the
-- owner like Phase 3: each job inserted `received` with its check-in time,
-- assignments and lines (explicit times, rate snapshot 0.3000) while it is
-- open, then one status UPDATE at a time; request.jwt.claims names whoever
-- acts so trigger-written actors match. A part from stock is the line, one
-- job_consumption movement at the line's time (-quantity, cost snapshot =
-- the line's unit cost) and the stock_consumed event add_inventory_line
-- would write. Recognition (D32): a line counts on the shop day of its
-- job's completed_at; open and cancelled jobs never count. No open job is
-- checked in 7 days ago, so which jobs are overdue (D20) never depends on
-- the time of day the reset ran.
-- ===========================================================================
-- Product category for the wheelsets (kind 'product', sort 8).
insert into public.categories (id, kind, name, sort_order) values
  ('ca000000-0000-4000-8000-000000000013', 'product', 'Wheels', 8);

-- The Phase 5 products (P-000017 .. P-000022), quantity-tracked, internal
-- only, dated 30 days back like Phase 4's. Reorder points sit below their
-- final on-hand (or none), so reporting.low_stock still lists exactly
-- Phase 4's three. SGD price / default direct cost.
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description, created_at)
values ('d5300000-0000-4000-8000-000000000001', 'HNT-45CD-700', 'Carbon disc wheelset 700c, 45mm',
  'Hunt', 'ca000000-0000-4000-8000-000000000013', 'quantity', 'internal_only', 849.00, 400.00, 1,
  null, pg_temp.seed_at(30, '07:00'));
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description, created_at)
values ('d5300000-0000-4000-8000-000000000002', 'VIT-CPRO-28', 'Corsa Pro 700x28c tyre',
  'Vittoria', 'ca000000-0000-4000-8000-000000000007', 'quantity', 'internal_only', 95.00, 35.00, 2,
  null, pg_temp.seed_at(30, '07:00'));
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description, created_at)
values ('d5300000-0000-4000-8000-000000000003', 'YBN-SLA110', 'SLA-110 11-speed chain',
  'YBN', 'ca000000-0000-4000-8000-000000000008', 'quantity', 'internal_only', 45.00, 22.00, 3,
  null, pg_temp.seed_at(30, '07:00'));
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description, created_at)
values ('d5300000-0000-4000-8000-000000000004', 'SWS-D34RS', 'Disc 34 RS brake pads (pair)',
  'SwissStop', 'ca000000-0000-4000-8000-000000000006', 'quantity', 'internal_only', 32.00, 15.00, 5,
  null, pg_temp.seed_at(30, '07:00'));
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description, created_at)
values ('d5300000-0000-4000-8000-000000000005', 'PAN-RAIR-48', 'Butyl inner 700x25-32c, Presta 48mm',
  'Panaracer', 'ca000000-0000-4000-8000-000000000007', 'quantity', 'internal_only', 12.00, 5.00, 10,
  null, pg_temp.seed_at(30, '07:00'));
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description, created_at)
values ('d5300000-0000-4000-8000-000000000006', 'GI-CO2-25', 'CO2 cartridge 25g, threaded',
  'Genuine Innovations', 'ca000000-0000-4000-8000-000000000010', 'quantity', 'internal_only', 6.00, 3.00, null,
  null, pg_temp.seed_at(30, '07:00'));

-- Their opening stock at the Shop floor, written like Phase 4's (what
-- adjust_stock writes; request ids d54…0N), from 08:30 on day 30.
insert into public.inventory_movements
  (product_id, inventory_unit_id, location_id, quantity_delta, movement_type, reason,
   unit_cost_snapshot, request_id, currency, created_by, created_at)
select r.product_id, null, '1c000000-0000-4000-8000-000000000001', r.qty, 'stock_adjustment', 'Opening stock count',
       p.default_direct_cost, r.request_id, p.currency, '5a000000-0000-4000-8000-000000000001',
       pg_temp.seed_at(30, '08:30') + (r.ord - 1) * interval '1 minute'
from (values
  ('d5400000-0000-4000-8000-000000000001'::uuid, 'd5300000-0000-4000-8000-000000000001'::uuid, 4, 1),
  ('d5400000-0000-4000-8000-000000000002'::uuid, 'd5300000-0000-4000-8000-000000000002'::uuid, 6, 2),
  ('d5400000-0000-4000-8000-000000000003'::uuid, 'd5300000-0000-4000-8000-000000000003'::uuid, 10, 3),
  ('d5400000-0000-4000-8000-000000000004'::uuid, 'd5300000-0000-4000-8000-000000000004'::uuid, 20, 4),
  ('d5400000-0000-4000-8000-000000000005'::uuid, 'd5300000-0000-4000-8000-000000000005'::uuid, 30, 5),
  ('d5400000-0000-4000-8000-000000000006'::uuid, 'd5300000-0000-4000-8000-000000000006'::uuid, 10, 6)
) as r (request_id, product_id, qty, ord)
join public.products p on p.id = r.product_id
order by r.ord;

-- Four more customers' bikes (B-000014 .. B-000017), so no Phase 5 job
-- shares a bike with a job that is still being worked on, and no bike is
-- collected while another job on it is open (seed realism, checked in
-- tests/db/reporting-seed.test.ts; the system does not forbid it). Chloe's
-- Diverge carries H2, T2 and T3 in turn; Daniel's Endurace H3 then T1.
insert into public.bikes
  (id, customer_id, brand, model, variant, frame_size, colour, serial_number, description, internal_notes)
values
  ('b1000000-0000-4000-8000-000000000014', 'c1000000-0000-4000-8000-000000000004',
   'Specialized', 'Diverge', 'Comp Carbon', '54', 'Gloss Teal Tint', 'WSBC123009871D',
   'Gravel and touring build with rack mounts.', null),
  ('b1000000-0000-4000-8000-000000000015', 'c1000000-0000-4000-8000-000000000005',
   'Canyon', 'Endurace', 'CF 7', 'M', 'Stealth', 'CYN-EN7-30412',
   'Second road bike, kept for wet days.', null),
  ('b1000000-0000-4000-8000-000000000016', 'c1000000-0000-4000-8000-000000000002',
   'Cervelo', 'R5', null, '51', 'Five Black', 'CV-R5-77310',
   'Warranty replacement frame; build moved over from the cracked one.', null),
  ('b1000000-0000-4000-8000-000000000017', 'c1000000-0000-4000-8000-000000000003',
   'Dahon', 'Mu', 'D9', 'One size', 'Matte Silver', 'DHN-MU-40981',
   'Weekend folding bike.', null);

-- ---------------------------------------------------------------------------
-- H1 J-000011: Tan's Brompton, service only (SPEC §10 example 1), collected.
-- Lead Marcus. Sale 200.00, cost 0.00, yield 200.00, Cult Commons 60.00,
-- BICII after CC 140.00; recognised 6 days ago.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

insert into public.work_orders
  (id, customer_id, bike_id, requested_work, checked_in_at, created_at, created_by)
values
  ('d5000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
   'b1000000-0000-4000-8000-000000000002',
   'Full service; gears skip under load on the climbs.',
   pg_temp.seed_at(6, '09:30'), pg_temp.seed_at(6, '09:30'),
   '5a000000-0000-4000-8000-000000000001');

insert into public.work_order_assignments (id, work_order_id, staff_id, role, assigned_by, assigned_at)
values
  ('d5200000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000001',
   '5a000000-0000-4000-8000-000000000002', 'lead', '5a000000-0000-4000-8000-000000000001',
   pg_temp.seed_at(6, '09:35'));

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', false);
update public.work_orders set status = 'in_progress', status_changed_at = pg_temp.seed_at(6, '10:15')
where id = 'd5000000-0000-4000-8000-000000000001';

insert into public.work_order_line_items
  (id, work_order_id, line_type, source_service_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency,
   created_by, created_at)
values
  ('d5100000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000001', 'service',
   '5e000000-0000-4000-8000-000000000002', 'Full Service', 1, 200.00, 0.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000002', pg_temp.seed_at(6, '10:20'));
update public.work_orders set status = 'completed', status_changed_at = pg_temp.seed_at(6, '16:40')
where id = 'd5000000-0000-4000-8000-000000000001';
update public.work_orders set status = 'ready_for_collection', status_changed_at = pg_temp.seed_at(6, '16:45')
where id = 'd5000000-0000-4000-8000-000000000001';
update public.work_orders set status = 'collected', status_changed_at = pg_temp.seed_at(5, '11:10')
where id = 'd5000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- H2 J-000012: Chloe's Diverge, a part from stock (SPEC §10 example 2),
-- collected. Lead Nur. One wheelset at 800.00 (cost 400.00): yield 400.00,
-- Cult Commons 120.00, BICII after CC 280.00; recognised 4 days ago.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

insert into public.work_orders
  (id, customer_id, bike_id, requested_work, checked_in_at, created_at, created_by)
values
  ('d5000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000004',
   'b1000000-0000-4000-8000-000000000014',
   'New wheelset fitted; customer bringing the old one home.',
   pg_temp.seed_at(5, '10:00'), pg_temp.seed_at(5, '10:00'),
   '5a000000-0000-4000-8000-000000000001');

insert into public.work_order_assignments (id, work_order_id, staff_id, role, assigned_by, assigned_at)
values
  ('d5200000-0000-4000-8000-000000000002', 'd5000000-0000-4000-8000-000000000002',
   '5a000000-0000-4000-8000-000000000003', 'lead', '5a000000-0000-4000-8000-000000000001',
   pg_temp.seed_at(5, '10:05'));

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', false);
update public.work_orders set status = 'in_progress', status_changed_at = pg_temp.seed_at(5, '13:00')
where id = 'd5000000-0000-4000-8000-000000000002';

-- A part from stock: the line, its job_consumption movement at the line's
-- time and the stock_consumed event add_inventory_line writes (a second
-- later); 3 left at the Shop floor.
insert into public.work_order_line_items
  (id, work_order_id, line_type, source_product_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cost_pending, cult_commons_rate_snapshot,
   currency, created_by, created_at)
values
  ('d5100000-0000-4000-8000-000000000002', 'd5000000-0000-4000-8000-000000000002', 'inventory',
   'd5300000-0000-4000-8000-000000000001', 'Carbon disc wheelset 700c, 45mm', 1, 800.00, 400.00, false, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000003', pg_temp.seed_at(5, '13:30'));
with m as (
  insert into public.inventory_movements
    (product_id, location_id, quantity_delta, movement_type, unit_cost_snapshot, work_order_id,
     work_order_line_item_id, currency, created_by, created_at)
  values ('d5300000-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000001', -1, 'job_consumption', 400.00,
    'd5000000-0000-4000-8000-000000000002', 'd5100000-0000-4000-8000-000000000002', 'SGD', '5a000000-0000-4000-8000-000000000003', pg_temp.seed_at(5, '13:30'))
  returning id
)
insert into public.work_order_events
  (work_order_id, event_type, actor_staff_id, actor_user_id, payload, created_at)
select 'd5000000-0000-4000-8000-000000000002', 'stock_consumed', '5a000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003',
  jsonb_build_object(
    'line_id', 'd5100000-0000-4000-8000-000000000002'::uuid, 'movement_id', m.id,
    'product_id', 'd5300000-0000-4000-8000-000000000001'::uuid,
    'product_short_id', (select p.short_id from public.products p where p.id = 'd5300000-0000-4000-8000-000000000001'),
    'inventory_unit_id', null, 'unit_short_id', null,
    'location_id', '1c000000-0000-4000-8000-000000000001'::uuid, 'location_name', 'Shop floor',
    'quantity', 1, 'on_hand_after', 3),
  pg_temp.seed_at(5, '13:30:01')
from m;
update public.work_orders set status = 'completed', status_changed_at = pg_temp.seed_at(4, '15:30')
where id = 'd5000000-0000-4000-8000-000000000002';
update public.work_orders set status = 'ready_for_collection', status_changed_at = pg_temp.seed_at(4, '15:35')
where id = 'd5000000-0000-4000-8000-000000000002';
update public.work_orders set status = 'collected', status_changed_at = pg_temp.seed_at(3, '10:20')
where id = 'd5000000-0000-4000-8000-000000000002';

-- ---------------------------------------------------------------------------
-- H3 J-000013: Daniel's Endurace, service and a part (SPEC §10
-- example 3), collected. Lead Marcus. Full Service 200.00 + wheelset 800.00
-- (cost 400.00): sale 1000.00, yield 600.00, Cult Commons 180.00, BICII
-- after CC 420.00; recognised 3 days ago.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

insert into public.work_orders
  (id, customer_id, bike_id, requested_work, checked_in_at, created_at, created_by)
values
  ('d5000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000005',
   'b1000000-0000-4000-8000-000000000015',
   'Full service and a wheelset upgrade, approved by phone.',
   pg_temp.seed_at(4, '09:45'), pg_temp.seed_at(4, '09:45'),
   '5a000000-0000-4000-8000-000000000001');

insert into public.work_order_assignments (id, work_order_id, staff_id, role, assigned_by, assigned_at)
values
  ('d5200000-0000-4000-8000-000000000003', 'd5000000-0000-4000-8000-000000000003',
   '5a000000-0000-4000-8000-000000000002', 'lead', '5a000000-0000-4000-8000-000000000001',
   pg_temp.seed_at(4, '09:50'));

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', false);
update public.work_orders set status = 'in_progress', status_changed_at = pg_temp.seed_at(4, '11:00')
where id = 'd5000000-0000-4000-8000-000000000003';

insert into public.work_order_line_items
  (id, work_order_id, line_type, source_service_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency,
   created_by, created_at)
values
  ('d5100000-0000-4000-8000-000000000003', 'd5000000-0000-4000-8000-000000000003', 'service',
   '5e000000-0000-4000-8000-000000000002', 'Full Service', 1, 200.00, 0.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000002', pg_temp.seed_at(4, '11:05'));

-- A part from stock: the line, its job_consumption movement at the line's
-- time and the stock_consumed event add_inventory_line writes (a second
-- later); 2 left at the Shop floor.
insert into public.work_order_line_items
  (id, work_order_id, line_type, source_product_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cost_pending, cult_commons_rate_snapshot,
   currency, created_by, created_at)
values
  ('d5100000-0000-4000-8000-000000000004', 'd5000000-0000-4000-8000-000000000003', 'inventory',
   'd5300000-0000-4000-8000-000000000001', 'Carbon disc wheelset 700c, 45mm', 1, 800.00, 400.00, false, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000002', pg_temp.seed_at(4, '11:30'));
with m as (
  insert into public.inventory_movements
    (product_id, location_id, quantity_delta, movement_type, unit_cost_snapshot, work_order_id,
     work_order_line_item_id, currency, created_by, created_at)
  values ('d5300000-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000001', -1, 'job_consumption', 400.00,
    'd5000000-0000-4000-8000-000000000003', 'd5100000-0000-4000-8000-000000000004', 'SGD', '5a000000-0000-4000-8000-000000000002', pg_temp.seed_at(4, '11:30'))
  returning id
)
insert into public.work_order_events
  (work_order_id, event_type, actor_staff_id, actor_user_id, payload, created_at)
select 'd5000000-0000-4000-8000-000000000003', 'stock_consumed', '5a000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002',
  jsonb_build_object(
    'line_id', 'd5100000-0000-4000-8000-000000000004'::uuid, 'movement_id', m.id,
    'product_id', 'd5300000-0000-4000-8000-000000000001'::uuid,
    'product_short_id', (select p.short_id from public.products p where p.id = 'd5300000-0000-4000-8000-000000000001'),
    'inventory_unit_id', null, 'unit_short_id', null,
    'location_id', '1c000000-0000-4000-8000-000000000001'::uuid, 'location_name', 'Shop floor',
    'quantity', 1, 'on_hand_after', 2),
  pg_temp.seed_at(4, '11:30:01')
from m;
update public.work_orders set status = 'completed', status_changed_at = pg_temp.seed_at(3, '17:10')
where id = 'd5000000-0000-4000-8000-000000000003';
update public.work_orders set status = 'ready_for_collection', status_changed_at = pg_temp.seed_at(3, '17:15')
where id = 'd5000000-0000-4000-8000-000000000003';
update public.work_orders set status = 'collected', status_changed_at = pg_temp.seed_at(2, '12:00')
where id = 'd5000000-0000-4000-8000-000000000003';

-- ---------------------------------------------------------------------------
-- H4 J-000014: Tan's Tarmac, a loss line (D1), collected. Lead Marcus.
-- Wheel True 40.00 (yield 40.00, CC 12.00) and a tyre at a goodwill 20.00
-- against a 35.00 cost (yield -15.00, CC 0.00): sale 60.00, cost 35.00,
-- yield 25.00, Cult Commons 12.00 (not 7.50), BICII after CC 13.00;
-- recognised 2 days ago.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

insert into public.work_orders
  (id, customer_id, bike_id, requested_work, checked_in_at, created_at, created_by)
values
  ('d5000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000001',
   'b1000000-0000-4000-8000-000000000001',
   'Rear wheel wobbles; tyre cut on the sidewall.',
   pg_temp.seed_at(3, '10:30'), pg_temp.seed_at(3, '10:30'),
   '5a000000-0000-4000-8000-000000000001');

insert into public.work_order_assignments (id, work_order_id, staff_id, role, assigned_by, assigned_at)
values
  ('d5200000-0000-4000-8000-000000000004', 'd5000000-0000-4000-8000-000000000004',
   '5a000000-0000-4000-8000-000000000002', 'lead', '5a000000-0000-4000-8000-000000000001',
   pg_temp.seed_at(3, '10:35'));

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', false);
update public.work_orders set status = 'in_progress', status_changed_at = pg_temp.seed_at(3, '14:00')
where id = 'd5000000-0000-4000-8000-000000000004';

insert into public.work_order_line_items
  (id, work_order_id, line_type, source_service_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency,
   created_by, created_at)
values
  ('d5100000-0000-4000-8000-000000000005', 'd5000000-0000-4000-8000-000000000004', 'service',
   '5e000000-0000-4000-8000-000000000003', 'Wheel True', 1, 40.00, 0.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000002', pg_temp.seed_at(3, '14:10'));

-- A part from stock: the line, its job_consumption movement at the line's
-- time and the stock_consumed event add_inventory_line writes (a second
-- later); 5 left at the Shop floor.
insert into public.work_order_line_items
  (id, work_order_id, line_type, source_product_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cost_pending, cult_commons_rate_snapshot,
   currency, created_by, created_at)
values
  ('d5100000-0000-4000-8000-000000000006', 'd5000000-0000-4000-8000-000000000004', 'inventory',
   'd5300000-0000-4000-8000-000000000002', 'Corsa Pro 700x28c tyre', 1, 20.00, 35.00, false, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000002', pg_temp.seed_at(3, '14:30'));
with m as (
  insert into public.inventory_movements
    (product_id, location_id, quantity_delta, movement_type, unit_cost_snapshot, work_order_id,
     work_order_line_item_id, currency, created_by, created_at)
  values ('d5300000-0000-4000-8000-000000000002', '1c000000-0000-4000-8000-000000000001', -1, 'job_consumption', 35.00,
    'd5000000-0000-4000-8000-000000000004', 'd5100000-0000-4000-8000-000000000006', 'SGD', '5a000000-0000-4000-8000-000000000002', pg_temp.seed_at(3, '14:30'))
  returning id
)
insert into public.work_order_events
  (work_order_id, event_type, actor_staff_id, actor_user_id, payload, created_at)
select 'd5000000-0000-4000-8000-000000000004', 'stock_consumed', '5a000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002',
  jsonb_build_object(
    'line_id', 'd5100000-0000-4000-8000-000000000006'::uuid, 'movement_id', m.id,
    'product_id', 'd5300000-0000-4000-8000-000000000002'::uuid,
    'product_short_id', (select p.short_id from public.products p where p.id = 'd5300000-0000-4000-8000-000000000002'),
    'inventory_unit_id', null, 'unit_short_id', null,
    'location_id', '1c000000-0000-4000-8000-000000000001'::uuid, 'location_name', 'Shop floor',
    'quantity', 1, 'on_hand_after', 5),
  pg_temp.seed_at(3, '14:30:01')
from m;
update public.work_orders set status = 'completed', status_changed_at = pg_temp.seed_at(2, '15:00')
where id = 'd5000000-0000-4000-8000-000000000004';
update public.work_orders set status = 'ready_for_collection', status_changed_at = pg_temp.seed_at(2, '15:05')
where id = 'd5000000-0000-4000-8000-000000000004';
update public.work_orders set status = 'collected', status_changed_at = pg_temp.seed_at(1, '09:40')
where id = 'd5000000-0000-4000-8000-000000000004';

-- ---------------------------------------------------------------------------
-- H5 J-000015: Tan's Brompton, rounding, ready for collection. Lead Nur;
-- Asha prices the two manual lines. 3 x 33.33 (cost 10.00 each): yield
-- 69.99, CC 21.00; 1 x 12.05 (cost 12.00): yield 0.05, CC 0.02 (0.015
-- rounded half up). Sale 112.04, cost 42.00, yield 70.04, Cult Commons
-- 21.02, BICII after CC 49.02; recognised yesterday.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

insert into public.work_orders
  (id, customer_id, bike_id, requested_work, checked_in_at, created_at, created_by)
values
  ('d5000000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-000000000001',
   'b1000000-0000-4000-8000-000000000002',
   'Fit a rear rack and a bell.',
   pg_temp.seed_at(2, '10:00'), pg_temp.seed_at(2, '10:00'),
   '5a000000-0000-4000-8000-000000000001');

insert into public.work_order_assignments (id, work_order_id, staff_id, role, assigned_by, assigned_at)
values
  ('d5200000-0000-4000-8000-000000000005', 'd5000000-0000-4000-8000-000000000005',
   '5a000000-0000-4000-8000-000000000003', 'lead', '5a000000-0000-4000-8000-000000000001',
   pg_temp.seed_at(2, '10:05'));

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', false);
update public.work_orders set status = 'in_progress', status_changed_at = pg_temp.seed_at(2, '15:00')
where id = 'd5000000-0000-4000-8000-000000000005';

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

insert into public.work_order_line_items
  (id, work_order_id, line_type, source_service_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency,
   created_by, created_at)
values
  ('d5100000-0000-4000-8000-000000000007', 'd5000000-0000-4000-8000-000000000005', 'manual',
   null, 'Rear rack fitting kit', 3, 33.33, 10.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000001', pg_temp.seed_at(2, '15:10'));

insert into public.work_order_line_items
  (id, work_order_id, line_type, source_service_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency,
   created_by, created_at)
values
  ('d5100000-0000-4000-8000-000000000008', 'd5000000-0000-4000-8000-000000000005', 'manual',
   null, 'Bell, brass', 1, 12.05, 12.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000001', pg_temp.seed_at(2, '15:20'));

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', false);
update public.work_orders set status = 'completed', status_changed_at = pg_temp.seed_at(1, '14:00')
where id = 'd5000000-0000-4000-8000-000000000005';
update public.work_orders set status = 'ready_for_collection', status_changed_at = pg_temp.seed_at(1, '14:05')
where id = 'd5000000-0000-4000-8000-000000000005';

-- ---------------------------------------------------------------------------
-- H6 J-000016: Priya's Tern, ready for collection for 9 days: an
-- uncollected_job exception (D34). Lead Nur. Custom Labour 120.00.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

insert into public.work_orders
  (id, customer_id, bike_id, requested_work, checked_in_at, created_at, created_by)
values
  ('d5000000-0000-4000-8000-000000000006', 'c1000000-0000-4000-8000-000000000002',
   'b1000000-0000-4000-8000-000000000004',
   'Rear hub service and gear adjustment.',
   pg_temp.seed_at(12, '09:00'), pg_temp.seed_at(12, '09:00'),
   '5a000000-0000-4000-8000-000000000001');

insert into public.work_order_assignments (id, work_order_id, staff_id, role, assigned_by, assigned_at)
values
  ('d5200000-0000-4000-8000-000000000006', 'd5000000-0000-4000-8000-000000000006',
   '5a000000-0000-4000-8000-000000000003', 'lead', '5a000000-0000-4000-8000-000000000001',
   pg_temp.seed_at(12, '09:05'));

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', false);
update public.work_orders set status = 'in_progress', status_changed_at = pg_temp.seed_at(11, '10:00')
where id = 'd5000000-0000-4000-8000-000000000006';

insert into public.work_order_line_items
  (id, work_order_id, line_type, source_service_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency,
   created_by, created_at)
values
  ('d5100000-0000-4000-8000-000000000009', 'd5000000-0000-4000-8000-000000000006', 'service',
   '5e000000-0000-4000-8000-000000000008', 'Custom Labour', 1, 120.00, 0.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000003', pg_temp.seed_at(11, '10:05'));
update public.work_orders set status = 'completed', status_changed_at = pg_temp.seed_at(9, '16:00')
where id = 'd5000000-0000-4000-8000-000000000006';
update public.work_orders set status = 'ready_for_collection', status_changed_at = pg_temp.seed_at(9, '16:05')
where id = 'd5000000-0000-4000-8000-000000000006';

-- ---------------------------------------------------------------------------
-- H7 J-000017: Priya's Cervelo, waiting for parts since 10 days ago and
-- checked in 11 days ago: overdue (D20), never recognised. Lead Marcus.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

insert into public.work_orders
  (id, customer_id, bike_id, requested_work, checked_in_at, created_at, created_by)
values
  ('d5000000-0000-4000-8000-000000000007', 'c1000000-0000-4000-8000-000000000002',
   'b1000000-0000-4000-8000-000000000016',
   'Move the build onto the warranty frame; waiting for the headset.',
   pg_temp.seed_at(11, '11:00'), pg_temp.seed_at(11, '11:00'),
   '5a000000-0000-4000-8000-000000000001');

insert into public.work_order_assignments (id, work_order_id, staff_id, role, assigned_by, assigned_at)
values
  ('d5200000-0000-4000-8000-000000000007', 'd5000000-0000-4000-8000-000000000007',
   '5a000000-0000-4000-8000-000000000002', 'lead', '5a000000-0000-4000-8000-000000000001',
   pg_temp.seed_at(11, '11:05'));

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', false);
update public.work_orders set status = 'in_progress', status_changed_at = pg_temp.seed_at(10, '10:00')
where id = 'd5000000-0000-4000-8000-000000000007';

insert into public.work_order_line_items
  (id, work_order_id, line_type, source_service_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency,
   created_by, created_at)
values
  ('d5100000-0000-4000-8000-000000000010', 'd5000000-0000-4000-8000-000000000007', 'service',
   '5e000000-0000-4000-8000-000000000007', 'Bike Build', 1, 150.00, 0.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000002', pg_temp.seed_at(10, '10:05'));
update public.work_orders set status = 'awaiting_parts', status_changed_at = pg_temp.seed_at(10, '15:00')
where id = 'd5000000-0000-4000-8000-000000000007';

-- ---------------------------------------------------------------------------
-- H8 J-000018: Hafiz's Dahon, cancelled 45 minutes after check-in with
-- no lines (D16). Lead Nur.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

insert into public.work_orders
  (id, customer_id, bike_id, requested_work, checked_in_at, created_at, created_by)
values
  ('d5000000-0000-4000-8000-000000000008', 'c1000000-0000-4000-8000-000000000003',
   'b1000000-0000-4000-8000-000000000017',
   'Quote for a dynamo hub conversion.',
   pg_temp.seed_at(2, '11:30'), pg_temp.seed_at(2, '11:30'),
   '5a000000-0000-4000-8000-000000000001');

insert into public.work_order_assignments (id, work_order_id, staff_id, role, assigned_by, assigned_at)
values
  ('d5200000-0000-4000-8000-000000000008', 'd5000000-0000-4000-8000-000000000008',
   '5a000000-0000-4000-8000-000000000003', 'lead', '5a000000-0000-4000-8000-000000000001',
   pg_temp.seed_at(2, '11:35'));

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', false);

select private.set_change_reason('Customer declined the quote');
update public.work_orders set status = 'cancelled', status_changed_at = pg_temp.seed_at(2, '12:15')
where id = 'd5000000-0000-4000-8000-000000000008';
select private.set_change_reason(null);

-- ---------------------------------------------------------------------------
-- T1 J-000019: Daniel's Endurace, in progress today. Lead Marcus.
-- Drivetrain Service 90.00 (cost 10.00), open, so not recognised.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

insert into public.work_orders
  (id, customer_id, bike_id, requested_work, checked_in_at, created_at, created_by)
values
  ('d5000000-0000-4000-8000-000000000009', 'c1000000-0000-4000-8000-000000000005',
   'b1000000-0000-4000-8000-000000000015',
   'Drivetrain clean; chain noisy in the small cog.',
   pg_temp.seed_at(0, '09:00'), pg_temp.seed_at(0, '09:00'),
   '5a000000-0000-4000-8000-000000000001');

insert into public.work_order_assignments (id, work_order_id, staff_id, role, assigned_by, assigned_at)
values
  ('d5200000-0000-4000-8000-000000000009', 'd5000000-0000-4000-8000-000000000009',
   '5a000000-0000-4000-8000-000000000002', 'lead', '5a000000-0000-4000-8000-000000000001',
   pg_temp.seed_at(0, '09:05'));

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', false);
update public.work_orders set status = 'in_progress', status_changed_at = pg_temp.seed_at(0, '09:30')
where id = 'd5000000-0000-4000-8000-000000000009';

insert into public.work_order_line_items
  (id, work_order_id, line_type, source_service_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency,
   created_by, created_at)
values
  ('d5100000-0000-4000-8000-000000000011', 'd5000000-0000-4000-8000-000000000009', 'service',
   '5e000000-0000-4000-8000-000000000006', 'Drivetrain Service', 1, 90.00, 10.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000002', pg_temp.seed_at(0, '09:35'));

-- ---------------------------------------------------------------------------
-- T2 J-000020: Chloe's Diverge, checked in yesterday evening and collected
-- today. Lead Marcus. Drivetrain Service 120.00 (CC 36.00) and a chain at
-- 45.00 (cost 22.00, CC 6.90): sale 165.00, cost 22.00, yield 143.00, Cult
-- Commons 42.90, BICII after CC 100.10; recognised today.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

insert into public.work_orders
  (id, customer_id, bike_id, requested_work, checked_in_at, created_at, created_by)
values
  ('d5000000-0000-4000-8000-000000000010', 'c1000000-0000-4000-8000-000000000004',
   'b1000000-0000-4000-8000-000000000014',
   'Drivetrain service and a new chain before the tour.',
   pg_temp.seed_at(1, '17:00'), pg_temp.seed_at(1, '17:00'),
   '5a000000-0000-4000-8000-000000000001');

insert into public.work_order_assignments (id, work_order_id, staff_id, role, assigned_by, assigned_at)
values
  ('d5200000-0000-4000-8000-000000000010', 'd5000000-0000-4000-8000-000000000010',
   '5a000000-0000-4000-8000-000000000002', 'lead', '5a000000-0000-4000-8000-000000000001',
   pg_temp.seed_at(1, '17:05'));

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', false);
update public.work_orders set status = 'in_progress', status_changed_at = pg_temp.seed_at(0, '09:15')
where id = 'd5000000-0000-4000-8000-000000000010';

insert into public.work_order_line_items
  (id, work_order_id, line_type, source_service_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency,
   created_by, created_at)
values
  ('d5100000-0000-4000-8000-000000000012', 'd5000000-0000-4000-8000-000000000010', 'service',
   '5e000000-0000-4000-8000-000000000006', 'Drivetrain Service', 1, 120.00, 0.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000002', pg_temp.seed_at(0, '09:20'));

-- A part from stock: the line, its job_consumption movement at the line's
-- time and the stock_consumed event add_inventory_line writes (a second
-- later); 9 left at the Shop floor.
insert into public.work_order_line_items
  (id, work_order_id, line_type, source_product_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cost_pending, cult_commons_rate_snapshot,
   currency, created_by, created_at)
values
  ('d5100000-0000-4000-8000-000000000013', 'd5000000-0000-4000-8000-000000000010', 'inventory',
   'd5300000-0000-4000-8000-000000000003', 'SLA-110 11-speed chain', 1, 45.00, 22.00, false, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000002', pg_temp.seed_at(0, '10:00'));
with m as (
  insert into public.inventory_movements
    (product_id, location_id, quantity_delta, movement_type, unit_cost_snapshot, work_order_id,
     work_order_line_item_id, currency, created_by, created_at)
  values ('d5300000-0000-4000-8000-000000000003', '1c000000-0000-4000-8000-000000000001', -1, 'job_consumption', 22.00,
    'd5000000-0000-4000-8000-000000000010', 'd5100000-0000-4000-8000-000000000013', 'SGD', '5a000000-0000-4000-8000-000000000002', pg_temp.seed_at(0, '10:00'))
  returning id
)
insert into public.work_order_events
  (work_order_id, event_type, actor_staff_id, actor_user_id, payload, created_at)
select 'd5000000-0000-4000-8000-000000000010', 'stock_consumed', '5a000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002',
  jsonb_build_object(
    'line_id', 'd5100000-0000-4000-8000-000000000013'::uuid, 'movement_id', m.id,
    'product_id', 'd5300000-0000-4000-8000-000000000003'::uuid,
    'product_short_id', (select p.short_id from public.products p where p.id = 'd5300000-0000-4000-8000-000000000003'),
    'inventory_unit_id', null, 'unit_short_id', null,
    'location_id', '1c000000-0000-4000-8000-000000000001'::uuid, 'location_name', 'Shop floor',
    'quantity', 1, 'on_hand_after', 9),
  pg_temp.seed_at(0, '10:00:01')
from m;
update public.work_orders set status = 'completed', status_changed_at = pg_temp.seed_at(0, '11:30')
where id = 'd5000000-0000-4000-8000-000000000010';
update public.work_orders set status = 'ready_for_collection', status_changed_at = pg_temp.seed_at(0, '11:35')
where id = 'd5000000-0000-4000-8000-000000000010';
update public.work_orders set status = 'collected', status_changed_at = pg_temp.seed_at(0, '12:10')
where id = 'd5000000-0000-4000-8000-000000000010';

-- ---------------------------------------------------------------------------
-- T3 J-000021: Chloe's Diverge again, received today with no lines, after
-- T2 on it was collected (12:10): the brakes rub on the ride home. Lead
-- Nur. Its check-in is the seed's anchor (tests read the reset day from it).
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

insert into public.work_orders
  (id, customer_id, bike_id, requested_work, checked_in_at, created_at, created_by)
values
  ('d5000000-0000-4000-8000-000000000011', 'c1000000-0000-4000-8000-000000000004',
   'b1000000-0000-4000-8000-000000000014',
   'Brakes rubbing after the wheel change.',
   pg_temp.seed_at(0, '13:00'), pg_temp.seed_at(0, '13:00'),
   '5a000000-0000-4000-8000-000000000001');

insert into public.work_order_assignments (id, work_order_id, staff_id, role, assigned_by, assigned_at)
values
  ('d5200000-0000-4000-8000-000000000011', 'd5000000-0000-4000-8000-000000000011',
   '5a000000-0000-4000-8000-000000000003', 'lead', '5a000000-0000-4000-8000-000000000001',
   pg_temp.seed_at(0, '13:05'));

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

-- Stock adjustments by Asha (what adjust_stock writes: the reason, the
-- product's default cost as the snapshot), one each on the last three days:
-- A1, 2 days ago: not significant (1 x 15.00); 19 left.
-- A2, yesterday: significant (6 units, D33); 24 left.
-- A3, today: not significant (2 x 3.00); 12 left.
insert into public.inventory_movements
  (product_id, inventory_unit_id, location_id, quantity_delta, movement_type, reason,
   unit_cost_snapshot, request_id, currency, created_by, created_at)
values
  ('d5300000-0000-4000-8000-000000000004', null, '1c000000-0000-4000-8000-000000000001', -1, 'stock_adjustment', 'Damaged packaging, written off',
   15.00, 'd5400000-0000-4000-8000-000000000011', 'SGD', '5a000000-0000-4000-8000-000000000001', pg_temp.seed_at(2, '11:00')),
  ('d5300000-0000-4000-8000-000000000005', null, '1c000000-0000-4000-8000-000000000001', -6, 'damaged', 'Water damage in storage',
   5.00, 'd5400000-0000-4000-8000-000000000012', 'SGD', '5a000000-0000-4000-8000-000000000001', pg_temp.seed_at(1, '16:30')),
  ('d5300000-0000-4000-8000-000000000006', null, '1c000000-0000-4000-8000-000000000001', 2, 'stock_adjustment', 'Recount found two in the workshop drawer',
   3.00, 'd5400000-0000-4000-8000-000000000013', 'SGD', '5a000000-0000-4000-8000-000000000001', pg_temp.seed_at(0, '08:30'));

select set_config('request.jwt.claims', '', false);

-- ===========================================================================
-- Phase 2: the shop's schedule and appointments (DATA-MODEL.md §18 "Phase 2
-- part"; ids in tests/fixtures/ids.ts). Written as the owner after every
-- job exists. The owner may bypass the booking rules (notice, horizon, the
-- customer limit, hours, closures and capacity are RPC rules, D37, D38);
-- the appointments triggers still enforce the status machine, the stamps,
-- bike ownership and the history, and the work-order link triggers still
-- check the link (D40). Each appointment is inserted `booked` at its
-- created_at (a day or more before it starts), then walks its statuses one
-- UPDATE at a time with explicit stamps, so every history reads true.
-- request.jwt.claims names whoever acts (Asha, Marcus for J-000014's
-- completion, Chloe for her own online bookings).
--
-- Past rows use pg_temp.seed_at(days_ago, local time); today's and future
-- rows start at fixed shop-local times, ((shop_today() + n) + time) at
-- time zone shop_timezone(). Today's and yesterday's rows deliberately
-- ignore the weekly hours when that day is a Monday (closed) or Sunday.
-- Future rows fall on Tuesday-Friday, never on a seeded closure or short
-- day, and nothing is more than 14 days ahead (tests book on clear days at
-- least 21 days ahead). Daniel has no upcoming booked or confirmed
-- appointment; Chloe has at most two upcoming online bookings; today has
-- at most three expected (booked or confirmed) arrivals.
-- ===========================================================================

-- Shop-local instant at `local_time` on the shop day `days_ahead` from today.
create function pg_temp.seed_ahead(days_ahead integer, local_time time)
returns timestamptz
language sql
stable
as $$
  select ((private.shop_today() + days_ahead) + local_time) at time zone private.shop_timezone();
$$;

-- The first shop day at least `days_ahead` from today whose weekday
-- (0 = Sunday, as extract(dow)) is in `weekdays`.
create function pg_temp.seed_first_day(days_ahead integer, weekdays integer[])
returns date
language sql
stable
as $$
  select min(d)::date
  from generate_series(private.shop_today() + days_ahead, private.shop_today() + days_ahead + 6, interval '1 day') g(d)
  where extract(dow from d)::integer = any (weekdays);
$$;

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

-- Settings: D37's defaults, and the local public site (3000 is the Admin).
update public.shop_settings
set intake_slot_minutes = 30,
    intake_capacity_units = 2,
    booking_min_notice_minutes = 120,
    booking_horizon_days = 60,
    customer_max_active_bookings = 3,
    customer_cancel_cutoff_minutes = 120,
    public_site_url = 'http://localhost:4000',
    updated_by = '5a000000-0000-4000-8000-000000000001'
where id = 1;

-- Weekly hours (0 = Sunday): Tuesday-Friday 10:00-19:00, a split Saturday,
-- a short Sunday, and Monday closed with its usual hours remembered.
insert into public.shop_hours (id, weekday, opens_at, closes_at, active) values
  ('e3000000-0000-4000-8000-000000000001', 1, '10:00', '19:00', false),
  ('e3000000-0000-4000-8000-000000000002', 2, '10:00', '19:00', true),
  ('e3000000-0000-4000-8000-000000000003', 3, '10:00', '19:00', true),
  ('e3000000-0000-4000-8000-000000000004', 4, '10:00', '19:00', true),
  ('e3000000-0000-4000-8000-000000000005', 5, '10:00', '19:00', true),
  ('e3000000-0000-4000-8000-000000000006', 6, '09:00', '12:30', true),
  ('e3000000-0000-4000-8000-000000000007', 6, '13:30', '18:00', true),
  ('e3000000-0000-4000-8000-000000000008', 0, '09:00', '13:00', true);

-- Appointment types: three bookable online, one staff-only.
insert into public.appointment_types
  (id, name, description, duration_minutes, capacity_units, public, active, sort_order)
values
  ('e1000000-0000-4000-8000-000000000001', 'Service drop-off',
   'Leave your bike with us for a service; we confirm the work and price before starting.', 30, 1, true, true, 1),
  ('e1000000-0000-4000-8000-000000000002', 'Repair assessment',
   'A mechanic looks at the problem with you and quotes the repair.', 30, 1, true, true, 2),
  ('e1000000-0000-4000-8000-000000000003', 'Custom build consultation',
   'An hour with a builder to plan a new bike or a rebuild: fit, parts and budget.', 60, 2, true, true, 3),
  ('e1000000-0000-4000-8000-000000000004', 'Warranty inspection',
   'Manufacturer warranty claims; booked by the shop only.', 30, 1, false, true, 4);

-- Closures, with the whole-day rules save_closure_override uses: the shop
-- closed all day on the first Wednesday at least 7 days ahead, and short
-- hours on the first Thursday at least 8 days ahead (both within 14 days).
insert into public.closure_overrides
  (id, kind, starts_at, ends_at, opens_at, closes_at, reason, created_by, created_at)
values
  ('e4000000-0000-4000-8000-000000000001', 'closed',
   private.shop_day_start(pg_temp.seed_first_day(7, array[3])),
   private.shop_day_start(pg_temp.seed_first_day(7, array[3]) + 1),
   null, null, 'Team at the Taipei Cycle show', '5a000000-0000-4000-8000-000000000001',
   pg_temp.seed_at(6, '18:30')),
  ('e4000000-0000-4000-8000-000000000002', 'custom_hours',
   private.shop_day_start(pg_temp.seed_first_day(8, array[4])),
   private.shop_day_start(pg_temp.seed_first_day(8, array[4]) + 1),
   '12:00', '16:00', 'Short day for stocktake', '5a000000-0000-4000-8000-000000000001',
   pg_temp.seed_at(6, '18:35'));

-- Chloe Lim's customer login (the staff logins' shape, so no usable
-- password: PLAN D10; E2E journey 2 and the customer-access tests sign in as
-- her with an email code).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, last_sign_in_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token,
  is_super_admin, is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000'::uuid,
  'a0000000-0000-4000-8000-000000000101'::uuid,
  'authenticated',
  'authenticated',
  'chloe.lim@example.com',
  -- The bcrypt hash of a random secret nobody knows, as for the staff.
  extensions.crypt(
    encode(extensions.gen_random_bytes(48), 'base64'), extensions.gen_salt('bf', 10)
  ),
  now(), null,
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  jsonb_build_object('display_name', 'Chloe Lim'),
  now(), now(),
  '', '', '', '',
  '', '', '', '',
  false, false, false
);

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) values (
  'a1000000-0000-4000-8000-000000000101'::uuid,
  'a0000000-0000-4000-8000-000000000101',
  'a0000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'sub', 'a0000000-0000-4000-8000-000000000101',
    'email', 'chloe.lim@example.com',
    'email_verified', true,
    'phone_verified', false
  ),
  'email',
  null, now(), now()
);

update public.customers
set auth_user_id = 'a0000000-0000-4000-8000-000000000101'
where id = 'c1000000-0000-4000-8000-000000000004';

-- Appointments booked by staff (Asha), each `booked` at its created_at;
-- ends_at and capacity_units are the type's snapshot (D38).
insert into public.appointments
  (id, customer_id, bike_id, appointment_type_id, starts_at, ends_at, capacity_units, status, source,
   customer_note, internal_note, created_by_staff_id, created_at)
select r.id, r.customer_id, r.bike_id, r.type_id, r.starts_at,
       r.starts_at + make_interval(mins => t.duration_minutes), t.capacity_units, 'booked', 'staff',
       r.customer_note, r.internal_note, '5a000000-0000-4000-8000-000000000001', r.created_at
from (values
  -- Tan's Tarmac, 3 days ago 10:00: checked in as J-000014, completed with it.
  ('e2000000-0000-4000-8000-000000000001'::uuid, 'c1000000-0000-4000-8000-000000000001'::uuid,
   'b1000000-0000-4000-8000-000000000001'::uuid, 'e1000000-0000-4000-8000-000000000002'::uuid,
   pg_temp.seed_at(3, '10:00'), 'Rear wheel wobbles and the tyre has a cut.',
   'Booked by phone.', pg_temp.seed_at(5, '17:40')),
  -- Daniel's Cannondale, yesterday 11:00: a no-show.
  ('e2000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000005',
   'b1000000-0000-4000-8000-000000000008', 'e1000000-0000-4000-8000-000000000001',
   pg_temp.seed_at(1, '11:00'), 'Pre-race check before the weekend crit.',
   null, pg_temp.seed_at(4, '15:10')),
  -- Priya's Domane, today 10:00: arrived, not checked in yet.
  ('e2000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000002',
   'b1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000001',
   pg_temp.seed_ahead(0, '10:00'), 'Full service before a trip to Bintan.',
   null, pg_temp.seed_at(3, '12:00')),
  -- Hafiz's Brompton, today 10:30: confirmed (J-000010 is open on this bike).
  ('e2000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000003',
   'b1000000-0000-4000-8000-000000000005', 'e1000000-0000-4000-8000-000000000002',
   pg_temp.seed_ahead(0, '10:30'), 'Rear hub clicks when freewheeling.',
   'Confirmed by WhatsApp.', pg_temp.seed_at(2, '09:40')),
  -- Nurul's Bianchi, today 16:00: booked.
  ('e2000000-0000-4000-8000-000000000006', 'c1000000-0000-4000-8000-000000000006',
   'b1000000-0000-4000-8000-000000000009', 'e1000000-0000-4000-8000-000000000002',
   pg_temp.seed_ahead(0, '16:00'), 'Brake levers feel spongy.',
   'No email on file; call to remind.', pg_temp.seed_at(1, '10:05')),
  -- Tan's Brompton, the first Tuesday-Friday from tomorrow, 11:00: confirmed.
  ('e2000000-0000-4000-8000-000000000007', 'c1000000-0000-4000-8000-000000000001',
   'b1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001',
   (pg_temp.seed_first_day(1, array[2, 3, 4, 5]) + time '11:00') at time zone private.shop_timezone(),
   'Annual service.', null, pg_temp.seed_at(2, '16:00')),
  -- Priya's Tern, the first Tuesday-Friday at least 3 days ahead, 10:00:
  -- cancelled by the shop.
  ('e2000000-0000-4000-8000-000000000008', 'c1000000-0000-4000-8000-000000000002',
   'b1000000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-000000000002',
   (pg_temp.seed_first_day(3, array[2, 3, 4, 5]) + time '10:00') at time zone private.shop_timezone(),
   'Folding hinge is loose.', null, pg_temp.seed_at(4, '11:00'))
) as r (id, customer_id, bike_id, type_id, starts_at, customer_note, internal_note, created_at)
join public.appointment_types t on t.id = r.type_id;

-- Chloe's own online bookings (source customer, created by her login).
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000101","role":"authenticated"}', false);

insert into public.appointments
  (id, customer_id, bike_id, appointment_type_id, starts_at, ends_at, capacity_units, status, source,
   customer_note, created_by_user_id, created_at)
select r.id, 'c1000000-0000-4000-8000-000000000004', r.bike_id, r.type_id, r.starts_at,
       r.starts_at + make_interval(mins => t.duration_minutes), t.capacity_units, 'booked', 'customer',
       r.customer_note, 'a0000000-0000-4000-8000-000000000101', r.created_at
from (values
  -- Chloe's Giant, today 15:00.
  ('e2000000-0000-4000-8000-000000000005'::uuid, 'b1000000-0000-4000-8000-000000000006'::uuid,
   'e1000000-0000-4000-8000-000000000001'::uuid, pg_temp.seed_ahead(0, '15:00'),
   'Gears slip on the biggest cog; please check the chain too.', pg_temp.seed_at(1, '21:15')),
  -- Chloe's Surly, the first Tuesday-Friday at least 5 days ahead, 14:00.
  ('e2000000-0000-4000-8000-000000000009', 'b1000000-0000-4000-8000-000000000007',
   'e1000000-0000-4000-8000-000000000003',
   (pg_temp.seed_first_day(5, array[2, 3, 4, 5]) + time '14:00') at time zone private.shop_timezone(),
   'Planning a touring rebuild with dynamo lights.', pg_temp.seed_at(1, '21:30'))
) as r (id, bike_id, type_id, starts_at, customer_note, created_at)
join public.appointment_types t on t.id = r.type_id;

-- Status changes, one UPDATE each with its own stamp (the history event of
-- a status change is dated by that stamp).
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

update public.appointments set status = 'no_show', no_show_at = pg_temp.seed_at(1, '11:20')
where id = 'e2000000-0000-4000-8000-000000000002';
update public.appointments set status = 'arrived', arrived_at = pg_temp.seed_at(0, '09:55')
where id = 'e2000000-0000-4000-8000-000000000003';
update public.appointments set status = 'confirmed', confirmed_at = pg_temp.seed_at(1, '17:30')
where id = 'e2000000-0000-4000-8000-000000000004';
update public.appointments set status = 'confirmed', confirmed_at = pg_temp.seed_at(1, '09:30')
where id = 'e2000000-0000-4000-8000-000000000007';
select private.set_change_reason('Customer travelling');
update public.appointments set status = 'cancelled', cancelled_via = 'staff', cancelled_at = pg_temp.seed_at(1, '14:00')
where id = 'e2000000-0000-4000-8000-000000000008';
select private.set_change_reason(null);

-- Tan's appointment and J-000014 (D40, D36): checked in when J-000014 was
-- (Asha, 10:30 three days ago), then linked: the triggers check the link and
-- write the appointment's work_order_linked and the job's
-- appointment_linked events, dated at that check-in, so J-000014's timeline
-- reads checked_in, appointment_linked, ... as before. J-000014 was
-- completed (Marcus) before the link existed, so the D36 trigger never saw
-- it: the appointment completes here at the job's completed_at.
update public.appointments a
set status = 'checked_in',
    arrived_at = w.checked_in_at,
    checked_in_at = w.checked_in_at
from public.work_orders w
where a.id = 'e2000000-0000-4000-8000-000000000001'
  and w.id = 'd5000000-0000-4000-8000-000000000004';

update public.work_orders
set appointment_id = 'e2000000-0000-4000-8000-000000000001'
where id = 'd5000000-0000-4000-8000-000000000004';

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', false);
update public.appointments a
set status = 'completed', completed_at = w.completed_at
from public.work_orders w
where a.id = 'e2000000-0000-4000-8000-000000000001'
  and w.id = 'd5000000-0000-4000-8000-000000000004';

select set_config('request.jwt.claims', '', false);

-- ===========================================================================
-- Phase 6: consignment and sales (DATA-MODEL.md §18 "Phase 6 part";
-- fixtures in tests/fixtures/ids.ts EXPECTED_CONSIGNOR_LEDGER and
-- EXPECTED_SALE, and the consignment columns of tests/fixtures/reporting.ts).
-- Three consignors are inserted directly as the owner (like customers);
-- everything else goes through the real RPCs as the admin, so every rule
-- and trigger runs: four consignment items C-000001 .. C-000004 (products
-- P-000023 .. P-000026, units U-000004 .. U-000006 on a fresh build), two
-- charges with explicit bearers (D4), four retail sales S-000001 ..
-- S-000004 dated on the Phase 5 fixture days with
-- pg_temp.seed_at(days_ago, local_time), one return to the consignor, a
-- settlement that was reversed and the one that replaced it, and a refund.
-- Intake dates, sale recognised_at and settlement paid_at carry those
-- dates; ledger movements, charges, events and the refund carry seed time
-- (as the Phase 4 job does). Fixed-UUID prefixes: 6a consignors, 6b items,
-- 6c intake products, 6d intake units, 6e charges, 6f sales, 7a refunds,
-- 7b settlements, 7c reversals, 7e returns.
-- ===========================================================================
insert into public.consignors
  (id, customer_id, display_name, email, phone, payout_details, internal_notes, created_by)
values
  ('6a000000-0000-4000-8000-000000000001', null, 'Kelvin Yeo', null, '+65 9876 5432',
   'PayNow +65 9876 5432', null, '5a000000-0000-4000-8000-000000000001'),
  ('6a000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000005', 'Daniel Ong',
   'daniel.ong@example.com', '+65 9567 8901', 'PayNow +65 9567 8901', null,
   '5a000000-0000-4000-8000-000000000001'),
  ('6a000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000004', 'Chloe Lim',
   'chloe.lim@example.com', '+65 8456 7890', 'Bank transfer, details on the signed agreement',
   'Consigns kit after each season.', '5a000000-0000-4000-8000-000000000001');

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

-- Intake (create_consignment_item), in C- order. C-000001 Kelvin's Colnago
-- and C-000002 Daniel's Cervélo are unique (a new draft consignment product
-- and unit each); C-000003 is six of Chloe's jerseys on a new quantity
-- product; C-000004 Kelvin's crankset is unique.
select public.create_consignment_item(
  item_id => '6b000000-0000-4000-8000-000000000001',
  consignor_id => '6a000000-0000-4000-8000-000000000001',
  location_id => '1c000000-0000-4000-8000-000000000001',
  agreed_amount_owed => 2400.00, asking_price => 4200.00,
  product_name => 'Colnago C64 Disc (2019), 54 cm', brand => 'Colnago',
  category_id => 'ca000000-0000-4000-8000-000000000012', tracking_type => 'unique',
  serial_number => 'C64D-19-0412', condition => 'Very good; light wear on the drive-side chainstay',
  received_at => pg_temp.seed_at(20, '11:00'),
  new_product_id => '6c000000-0000-4000-8000-000000000001',
  new_unit_id => '6d000000-0000-4000-8000-000000000001');
select public.create_consignment_item(
  item_id => '6b000000-0000-4000-8000-000000000002',
  consignor_id => '6a000000-0000-4000-8000-000000000002',
  location_id => '1c000000-0000-4000-8000-000000000001',
  agreed_amount_owed => 500.00, asking_price => 1000.00,
  product_name => 'Cervélo R3 (2017), 56 cm', brand => 'Cervélo',
  category_id => 'ca000000-0000-4000-8000-000000000012', tracking_type => 'unique',
  serial_number => 'CV-R3-17-5521', received_at => pg_temp.seed_at(18, '14:30'),
  new_product_id => '6c000000-0000-4000-8000-000000000002',
  new_unit_id => '6d000000-0000-4000-8000-000000000002');
select public.create_consignment_item(
  item_id => '6b000000-0000-4000-8000-000000000003',
  consignor_id => '6a000000-0000-4000-8000-000000000003',
  location_id => '1c000000-0000-4000-8000-000000000001',
  agreed_amount_owed => 35.00, asking_price => 70.00,
  product_name => 'Rapha Pro Team jersey, size M (as new)', brand => 'Rapha',
  tracking_type => 'quantity', quantity => 6, received_at => pg_temp.seed_at(15, '10:15'),
  new_product_id => '6c000000-0000-4000-8000-000000000003');
select public.create_consignment_item(
  item_id => '6b000000-0000-4000-8000-000000000004',
  consignor_id => '6a000000-0000-4000-8000-000000000001',
  location_id => '1c000000-0000-4000-8000-000000000001',
  agreed_amount_owed => 300.00, asking_price => 520.00,
  product_name => 'Shimano Dura-Ace R9100 crankset, 172.5 mm', brand => 'Shimano',
  category_id => 'ca000000-0000-4000-8000-000000000008', tracking_type => 'unique',
  received_at => pg_temp.seed_at(12, '16:00'),
  new_product_id => '6c000000-0000-4000-8000-000000000004',
  new_unit_id => '6d000000-0000-4000-8000-000000000004');

-- Charges with an explicit bearer (D4): the shop pays for the Colnago's
-- service (its cost becomes 2520.00); Daniel pays for his tubeless
-- conversion (deducted from what he is owed).
select public.add_consignment_charge(
  '6e000000-0000-4000-8000-000000000001', '6b000000-0000-4000-8000-000000000001',
  'Full service and new bar tape before listing', 120.00, 'shop');
select public.add_consignment_charge(
  '6e000000-0000-4000-8000-000000000002', '6b000000-0000-4000-8000-000000000002',
  'Tubeless conversion requested by the consignor', 45.00, 'consignor');

-- Retail sales (record_retail_sale), in S- order:
--   S-000001 day 5, Priya: 2 jerseys from C-000003 at its asking price
--            (140.00 / cost 70.00 / yield 70.00 / Cult Commons 21.00).
--   S-000002 day 4, walk-in: 2 Brompton 16in tubes (P-000005, shop-owned,
--            14.00 / 6.00): 28.00 / 12.00 / 16.00 / 4.80.
--   S-000003 day 3, Hafiz: Daniel's Cervélo at its selling price, SPEC §10's
--            consignment example: 1000.00 / 500.00 / 500.00 / 150.00.
--   S-000004 today, walk-in: 1 jersey, FIFO from C-000003:
--            70.00 / 35.00 / 35.00 / 10.50.
select public.record_retail_sale(
  '6f000000-0000-4000-8000-000000000001',
  '[{"product_id": "6c000000-0000-4000-8000-000000000003",
     "location_id": "1c000000-0000-4000-8000-000000000001", "quantity": 2,
     "consignment_item_id": "6b000000-0000-4000-8000-000000000003"}]'::jsonb,
  'c1000000-0000-4000-8000-000000000002', pg_temp.seed_at(5, '11:20'));
select public.record_retail_sale(
  '6f000000-0000-4000-8000-000000000002',
  '[{"product_id": "9a000000-0000-4000-8000-000000000005",
     "location_id": "1c000000-0000-4000-8000-000000000001", "quantity": 2}]'::jsonb,
  null, pg_temp.seed_at(4, '15:05'));
select public.record_retail_sale(
  '6f000000-0000-4000-8000-000000000003',
  '[{"inventory_unit_id": "6d000000-0000-4000-8000-000000000002"}]'::jsonb,
  'c1000000-0000-4000-8000-000000000003', pg_temp.seed_at(3, '16:40'));
select public.record_retail_sale(
  '6f000000-0000-4000-8000-000000000004',
  '[{"product_id": "6c000000-0000-4000-8000-000000000003",
     "location_id": "1c000000-0000-4000-8000-000000000001", "quantity": 1}]'::jsonb,
  null, pg_temp.seed_at(0, '10:30'));

-- Kelvin takes his crankset back (C-000004 returned; its unit
-- returned_to_consignor and its product archived).
select public.return_consignment_item(
  '7e000000-0000-4000-8000-000000000001', '6b000000-0000-4000-8000-000000000004',
  'Consignor took it back for his own build.');

-- Chloe's settlements (D47): 30.00 recorded by mistake and reversed, then
-- the 40.00 actually transferred. Her ledger: liability 105.00 (3 jerseys
-- sold), paid 40.00, outstanding 65.00.
select public.record_settlement(
  '7b000000-0000-4000-8000-000000000001', '6a000000-0000-4000-8000-000000000003', 30.00,
  '[{"consignment_item_id": "6b000000-0000-4000-8000-000000000003", "amount": "30.00"}]'::jsonb,
  pg_temp.seed_at(3, '18:00'), 'PayNow 2991');
select public.reverse_settlement(
  '7c000000-0000-4000-8000-000000000001', '7b000000-0000-4000-8000-000000000001',
  'Wrong amount; the transfer was $40.');
select public.record_settlement(
  '7b000000-0000-4000-8000-000000000002', '6a000000-0000-4000-8000-000000000003', 40.00,
  '[{"consignment_item_id": "6b000000-0000-4000-8000-000000000003", "amount": "40.00"}]'::jsonb,
  pg_temp.seed_at(2, '12:00'), 'PayNow 3002');

-- A refund on S-000002 for one tube (financial only, D7/D49: S-000002 is
-- partially_refunded, its stock and lines unchanged).
select public.record_sale_refund(
  '7a000000-0000-4000-8000-000000000001', '6f000000-0000-4000-8000-000000000002', 14.00,
  'One tube had the wrong valve; refunded, customer kept it.');

select set_config('request.jwt.claims', '', false);

-- ===========================================================================
-- Phase 7: purchasing (DATA-MODEL.md §18 "Phase 7 part"; ids in
-- tests/fixtures/ids.ts SUPPLIER, PURCHASE_ORDER, PURCHASE_ORDER_LINE,
-- RECEIPT_KEY). Everything goes through the purchasing RPCs as Asha Admin
-- (request.jwt.claims), so PO history, the purchase_received movements and
-- the supplier last costs are what the app writes. Suppliers have no create
-- RPC (the app inserts them under RLS): they are inserted directly, dated
-- 20 days back. POs are created in this order, so they get PO-000001 ..
-- PO-000005 on a fresh build.
--
-- Chronology (D64 D-RECEIPT-TIME): after a PO is created and submitted
-- through the RPCs, and BEFORE it is received, its created_at and
-- submitted_at are back-dated with a plain UPDATE as the owner (those
-- columns write no PO event); receive_purchase then records the receipt
-- with its past received_at. The purchase_received movements keep seed
-- time (Phase 4's ledger is append-only and has no effective date; their
-- reason carries the delivery date), and the PO history rows keep record
-- time.
--
-- Fences on the earlier phases:
--   (1) every receipt's actual cost equals the product's current
--       default_direct_cost, so D63 D-LASTCOST changes no product cost and
--       writes no cost_changed event;
--   (2) receipts touch only cassette (P-000007), chainX11 (P-000006) and
--       chainLube (P-000010): not the low-stock cableKit, hydraulicHose and
--       sealant, and none of the products whose on-hand a test pins
--       (brakePads, gp5000Tyre, roadTube, bromptonTube, marathonRacer,
--       barTape); each stays above its reorder point, so reporting.low_stock,
--       Today's low-stock tile and tests/fixtures/reporting.ts are
--       unchanged;
--   (3) the draft PO-000004 holds cableKit and hydraulicHose, which no
--       receipt touches;
--   (4) Phase 5's daily summary and Today count only job_consumption,
--       reversal, stock_adjustment and damaged movements, never
--       purchase_received.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

-- Suppliers.
insert into public.suppliers
  (id, name, contact_name, email, phone, website, account_reference, notes, created_at)
values
  ('d7000000-0000-4000-8000-000000000001', 'Velo Parts Asia Pte Ltd', 'Kenneth Lim',
   'sales@veloparts.test', '+65 6123 4501', 'https://veloparts.test', 'BICII-0042',
   'Order by Thursday noon for Monday delivery.', pg_temp.seed_at(20, '09:00')),
  ('d7000000-0000-4000-8000-000000000002', 'Tropic Tyre & Tube Co', 'Siti Rahman',
   'orders@tropictyre.test', '+65 6234 5502', null, 'TT-1187',
   null, pg_temp.seed_at(20, '09:05')),
  ('d7000000-0000-4000-8000-000000000003', 'Old Spoke Trading', null,
   null, null, null, null,
   null, pg_temp.seed_at(20, '09:10'));
-- Old Spoke stopped trading: archived, with no POs.
update public.suppliers set archived_at = pg_temp.seed_at(15, '10:00')
where id = 'd7000000-0000-4000-8000-000000000003';

-- Supplier links (set_supplier_product). The GP5000 tyre comes from both,
-- preferred at Tropic Tyre; the low-stock sealant has no supplier yet.
select public.set_supplier_product('d7000000-0000-4000-8000-000000000001',
  '9a000000-0000-4000-8000-000000000007', 'VPA-CSR7000-1134', 5, true);
select public.set_supplier_product('d7000000-0000-4000-8000-000000000001',
  '9a000000-0000-4000-8000-000000000006', 'VPA-KMC-X11', 5, true);
select public.set_supplier_product('d7000000-0000-4000-8000-000000000001',
  '9a000000-0000-4000-8000-000000000010', 'VPA-FL-DRY120', 5, true);
select public.set_supplier_product('d7000000-0000-4000-8000-000000000001',
  '9a000000-0000-4000-8000-000000000008', 'VPA-JAG-PRO', 7, true);
select public.set_supplier_product('d7000000-0000-4000-8000-000000000001',
  '9a000000-0000-4000-8000-000000000009', 'VPA-BH90-1000', 7, true);
select public.set_supplier_product('d7000000-0000-4000-8000-000000000001',
  '9a000000-0000-4000-8000-000000000002', 'VPA-GP5K-25', 5, false);
select public.set_supplier_product('d7000000-0000-4000-8000-000000000002',
  '9a000000-0000-4000-8000-000000000002', 'TT-GP5000-25', 3, true);
select public.set_supplier_product('d7000000-0000-4000-8000-000000000002',
  '9a000000-0000-4000-8000-000000000003', 'TT-SV20-60', 3, true);

-- PO-000001 (Velo Parts): 4 x cassette at its cost 68.00. Created 12 days
-- ago, submitted 11, received in full at the Shop floor 9 days ago
-- (cassette 3 -> 7 on hand).
select public.create_purchase_order('d7100000-0000-4000-8000-000000000001',
  'd7000000-0000-4000-8000-000000000001', private.shop_today() - 9, 'SO-7702', null);
select public.set_purchase_order_line('d7200000-0000-4000-8000-000000000001',
  'd7100000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000007', 4, 68.00);
select public.submit_purchase_order('d7100000-0000-4000-8000-000000000001');
update public.purchase_orders
set created_at = pg_temp.seed_at(12, '10:00'), submitted_at = pg_temp.seed_at(11, '09:30')
where id = 'd7100000-0000-4000-8000-000000000001';
select public.receive_purchase('d7100000-0000-4000-8000-000000000001',
  'd7300000-0000-4000-8000-000000000001',
  '[{"purchase_order_line_id":"d7200000-0000-4000-8000-000000000001",
     "location_id":"1c000000-0000-4000-8000-000000000001","quantity_received":4}]'::jsonb,
  'DN-5402', pg_temp.seed_at(9, '14:00'), null);

-- PO-000002 (Velo Parts), SPEC §14's partial receipt: 20 x chainX11 at
-- 24.00 and 10 x chainLube at 7.00, expected yesterday. Created 6 days ago,
-- submitted 5; one delivery 3 days ago (delivery note DN-5531) brought 18
-- chains and 10 lubes. Partially received, 2 chains outstanding, overdue
-- (chainX11 8 -> 26, chainLube 18 -> 28 on hand).
select public.create_purchase_order('d7100000-0000-4000-8000-000000000002',
  'd7000000-0000-4000-8000-000000000001', private.shop_today() - 1, 'SO-7781', null);
select public.set_purchase_order_line('d7200000-0000-4000-8000-000000000002',
  'd7100000-0000-4000-8000-000000000002', '9a000000-0000-4000-8000-000000000006', 20, 24.00);
select public.set_purchase_order_line('d7200000-0000-4000-8000-000000000003',
  'd7100000-0000-4000-8000-000000000002', '9a000000-0000-4000-8000-000000000010', 10, 7.00);
select public.submit_purchase_order('d7100000-0000-4000-8000-000000000002');
update public.purchase_orders
set created_at = pg_temp.seed_at(6, '10:00'), submitted_at = pg_temp.seed_at(5, '09:30')
where id = 'd7100000-0000-4000-8000-000000000002';
select public.receive_purchase('d7100000-0000-4000-8000-000000000002',
  'd7300000-0000-4000-8000-000000000002',
  '[{"purchase_order_line_id":"d7200000-0000-4000-8000-000000000002",
     "location_id":"1c000000-0000-4000-8000-000000000001","quantity_received":18},
    {"purchase_order_line_id":"d7200000-0000-4000-8000-000000000003",
     "location_id":"1c000000-0000-4000-8000-000000000001","quantity_received":10}]'::jsonb,
  'DN-5531', pg_temp.seed_at(3, '11:30'), null);

-- PO-000003 (Tropic Tyre): 6 x gp5000Tyre at 52.00, created and submitted
-- 2 days ago, nothing received, expected in 3 days.
select public.create_purchase_order('d7100000-0000-4000-8000-000000000003',
  'd7000000-0000-4000-8000-000000000002', private.shop_today() + 3, null, null);
select public.set_purchase_order_line('d7200000-0000-4000-8000-000000000004',
  'd7100000-0000-4000-8000-000000000003', '9a000000-0000-4000-8000-000000000002', 6, 52.00);
select public.submit_purchase_order('d7100000-0000-4000-8000-000000000003');
update public.purchase_orders
set created_at = pg_temp.seed_at(2, '10:00'), submitted_at = pg_temp.seed_at(2, '10:20')
where id = 'd7100000-0000-4000-8000-000000000003';

-- PO-000004 (Velo Parts): a draft for two low-stock products, 6 x cableKit
-- at 16.00 and 9 x hydraulicHose at 12.00 (their D66 suggestions), so the
-- reorder screen shows them "In draft PO-000004". Created yesterday.
select public.create_purchase_order('d7100000-0000-4000-8000-000000000004',
  'd7000000-0000-4000-8000-000000000001', null, null, null);
select public.set_purchase_order_line('d7200000-0000-4000-8000-000000000005',
  'd7100000-0000-4000-8000-000000000004', '9a000000-0000-4000-8000-000000000008', 6, 16.00);
select public.set_purchase_order_line('d7200000-0000-4000-8000-000000000006',
  'd7100000-0000-4000-8000-000000000004', '9a000000-0000-4000-8000-000000000009', 9, 12.00);
update public.purchase_orders set created_at = pg_temp.seed_at(1, '09:00')
where id = 'd7100000-0000-4000-8000-000000000004';

-- PO-000005 (Tropic Tyre): 20 x roadTube at 3.80, created and submitted
-- yesterday, cancelled today (at seed time).
select public.create_purchase_order('d7100000-0000-4000-8000-000000000005',
  'd7000000-0000-4000-8000-000000000002', null, null, null);
select public.set_purchase_order_line('d7200000-0000-4000-8000-000000000007',
  'd7100000-0000-4000-8000-000000000005', '9a000000-0000-4000-8000-000000000003', 20, 3.80);
select public.submit_purchase_order('d7100000-0000-4000-8000-000000000005');
update public.purchase_orders
set created_at = pg_temp.seed_at(1, '15:00'), submitted_at = pg_temp.seed_at(1, '15:10')
where id = 'd7100000-0000-4000-8000-000000000005';
select public.cancel_purchase_order('d7100000-0000-4000-8000-000000000005',
  'Supplier out of stock until next quarter');

-- So that every seeded PO's History reads true next to its Details and
-- Receipts (as the workshop seed does for job timelines): the RPCs above
-- stamped each event at seed time, so move it to the moment it stands for.
-- created -> the PO's created_at; line_added -> a minute apart after it;
-- submitted -> submitted_at; received -> its receipt's received_at; the
-- status_changed that a receipt caused -> a second after that receipt; the
-- cancellation stays at seed time ("cancelled today"). The append-only
-- trigger is lifted for this one seed-only UPDATE and restored at once;
-- no app path can do this.
alter table public.purchase_order_events disable trigger purchase_order_events_append_only;
update public.purchase_order_events e
set created_at = t.at
from (
  select ev.id,
         case ev.event_type
           when 'created' then o.created_at
           when 'line_added' then o.created_at + pg_catalog.make_interval(mins => (
             pg_catalog.row_number() over (
               partition by ev.purchase_order_id, ev.event_type order by ev.created_at, ev.id))::int)
           when 'submitted' then o.submitted_at
           when 'received' then r.received_at
           when 'status_changed' then (
             select rr.received_at + interval '1 second'
             from public.purchase_order_events prev
             join public.purchase_receipts rr on rr.id = prev.purchase_receipt_id
             where prev.purchase_order_id = ev.purchase_order_id
               and prev.event_type = 'received'
               and prev.created_at <= ev.created_at
             order by prev.created_at desc
             limit 1)
         end as at
  from public.purchase_order_events ev
  join public.purchase_orders o on o.id = ev.purchase_order_id
  left join public.purchase_receipts r on r.id = ev.purchase_receipt_id
  where ev.purchase_order_id::text like 'd7100000-%'
) t
where e.id = t.id and t.at is not null;
alter table public.purchase_order_events enable trigger purchase_order_events_append_only;

select set_config('request.jwt.claims', '', false);

-- ===========================================================================
-- Phase 8: print jobs (DATA-MODEL.md §18 "Phase 8 part"). Five jobs on the
-- migration's built-in templates (1ab00000-…) and printer profiles
-- (a8000000-…), inserted as the owner with the content, template and
-- printer snapshots built exactly as create_print_job builds them
-- (private.label_content, so the QR payload is this seed's
-- public_site_url, http://localhost:4000). No product is published here:
-- a print job never needs one.
--   productPrinted   P-000011 bar tape x 10, browser, printed (Marcus),
--                    2 days ago, rendered +1 min, confirmed +2 min.
--   unitFailed       U-000001 Colnago (bike B-000011) x 1, PDF, failed
--                    "Label roll ran out halfway through" (Asha), yesterday.
--   unitReprint      the same unit x 1, PDF, reprint of unitFailed, printed
--                    (Asha), yesterday + 10 min.
--   bikeUnconfirmed  B-000001 Tan's Tarmac tag x 1, browser, rendered and
--                    not confirmed (Nur), today.
--   productQueued    P-000011 bar tape x 10, PDF, queued (Marcus), today;
--                    E2E renders and downloads it read-only, nothing changes
--                    its status.
-- ===========================================================================
create function pg_temp.seed_print_job(
  job_id uuid, kind public.label_kind, entity_id uuid, quantity integer, profile_id uuid,
  status public.print_status, requested_by uuid, status_changed_by uuid, created_at timestamptz,
  rendered_at timestamptz, completed_at timestamptz, error text default null, reprint_of_id uuid default null
)
returns void
language plpgsql
as $$
declare
  c jsonb := private.label_content(kind, entity_id);
  p public.printer_profiles;
  t public.label_templates;
begin
  select * into strict p from public.printer_profiles where id = profile_id;
  select * into strict t from public.label_templates where is_default and label_templates.kind = seed_print_job.kind;
  insert into public.print_jobs (
    id, label_kind, product_id, inventory_unit_id, bike_id, short_id, qr_payload, content, quantity,
    printer_profile_id, profile_snapshot, adapter, label_template_id, template_snapshot, status,
    rendered_at, completed_at, error, status_changed_by, reprint_of_id, requested_by, created_at, updated_at
  ) values (
    job_id, kind,
    case when kind = 'product' then entity_id end,
    case when kind = 'unit' then entity_id end,
    case when kind = 'bike' then entity_id end,
    c ->> 'short_id', c ->> 'qr_payload', c, quantity,
    p.id, jsonb_build_object('name', p.name, 'adapter', p.adapter, 'config', p.config), p.adapter,
    t.id, jsonb_build_object('name', t.name, 'kind', t.kind, 'width_mm', t.width_mm,
                             'height_mm', t.height_mm, 'layout', t.layout),
    status, rendered_at, completed_at, error, status_changed_by, reprint_of_id, requested_by,
    created_at, coalesce(completed_at, rendered_at, created_at)
  );
end;
$$;

select pg_temp.seed_print_job(
  'a9000000-0000-4000-8000-000000000001', 'product', '9a000000-0000-4000-8000-000000000011', 10,
  'a8000000-0000-4000-8000-000000000001', 'printed',
  '5a000000-0000-4000-8000-000000000002', '5a000000-0000-4000-8000-000000000002',
  pg_temp.seed_at(2, '11:00'), pg_temp.seed_at(2, '11:01'), pg_temp.seed_at(2, '11:02'));
select pg_temp.seed_print_job(
  'a9000000-0000-4000-8000-000000000002', 'unit', '9b000000-0000-4000-8000-000000000001', 1,
  'a8000000-0000-4000-8000-000000000002', 'failed',
  '5a000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000001',
  pg_temp.seed_at(1, '15:00'), pg_temp.seed_at(1, '15:01'), pg_temp.seed_at(1, '15:03'),
  'Label roll ran out halfway through');
select pg_temp.seed_print_job(
  'a9000000-0000-4000-8000-000000000003', 'unit', '9b000000-0000-4000-8000-000000000001', 1,
  'a8000000-0000-4000-8000-000000000002', 'printed',
  '5a000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000001',
  pg_temp.seed_at(1, '15:10'), pg_temp.seed_at(1, '15:11'), pg_temp.seed_at(1, '15:12'),
  null, 'a9000000-0000-4000-8000-000000000002');
select pg_temp.seed_print_job(
  'a9000000-0000-4000-8000-000000000004', 'bike', 'b1000000-0000-4000-8000-000000000001', 1,
  'a8000000-0000-4000-8000-000000000001', 'rendered',
  '5a000000-0000-4000-8000-000000000003', '5a000000-0000-4000-8000-000000000003',
  pg_temp.seed_at(0, '09:30'), least(pg_temp.seed_at(0, '09:30') + interval '1 minute', now()), null);
select pg_temp.seed_print_job(
  'a9000000-0000-4000-8000-000000000005', 'product', '9a000000-0000-4000-8000-000000000011', 10,
  'a8000000-0000-4000-8000-000000000002', 'queued',
  '5a000000-0000-4000-8000-000000000002', null,
  pg_temp.seed_at(0, '10:00'), null, null);
