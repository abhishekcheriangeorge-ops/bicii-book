-- BICII Admin seed: the local demo dataset and the database test fixture
-- (DATA-MODEL.md §18, TESTING.md "Seed data").
--
-- Deterministic: every row has a fixed UUID, exported from
-- tests/fixtures/ids.ts, so tests never query by name. Applied to local and
-- preview databases only; NEVER to production.
--
-- Phase 0 contents: three staff with working Supabase Auth logins, all with
-- the local-only password `bicii-dev-password`:
--   admin@bicii.test      role admin (implies every permission)
--   mechanic1@bicii.test  role staff, view_costs
--   mechanic2@bicii.test  role staff, no permissions
--
-- Phase 1 contents: six customers (none has a login yet; customer sign-up
-- is Phase 11) and ten bikes, one of them a shop bike without an owner, so
-- bikes get the short IDs B-000001 .. B-000010 in insert order. One bike
-- changed hands, so its ownership history has two events. No attachments.
--
-- Phase 3 contents: five service categories, nine services (one archived,
-- one not public) and nine workshop jobs J-000001 .. J-000009 in insert
-- order, one in each interesting status, with assignments, lines (one
-- voided), notes, a diagnosis and an approval flag, backdated over the last
-- nine days so every job's timeline reads true (see the Phase 3 block).
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
-- reorder point. Stock, units and the job go through the real RPCs.

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
  extensions.crypt('bicii-dev-password', extensions.gen_salt('bf')),
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
  ('a0000000-0000-4000-8000-000000000003'::uuid, 'mechanic2@bicii.test', 'Nur Aisyah')
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
  ('a1000000-0000-4000-8000-000000000003'::uuid, 'a0000000-0000-4000-8000-000000000003'::uuid)
) as i (id, user_id)
join auth.users u on u.id = i.user_id;

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
insert into public.staff (id, auth_user_id, display_name, email, role, active) values
  ('5a000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'Asha Admin', 'admin@bicii.test', 'admin', true),
  ('5a000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002',
   'Marcus Tan', 'mechanic1@bicii.test', 'staff', true),
  ('5a000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003',
   'Nur Aisyah', 'mechanic2@bicii.test', 'staff', true);

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
--       status_changed_at. All times are offsets from now() (the seed runs
--       in one transaction), strictly increasing per job, and no line or
--       void comes after a job's completion.
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
   now() - interval '30 days');

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
   now() - interval '9 days', now() - interval '9 days',
   '5a000000-0000-4000-8000-000000000001');

insert into public.work_order_assignments (id, work_order_id, staff_id, role, assigned_by, assigned_at)
values
  ('f3000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
   '5a000000-0000-4000-8000-000000000002', 'lead', '5a000000-0000-4000-8000-000000000001',
   now() - interval '9 days' + interval '5 minutes');

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', false);

insert into public.work_order_line_items
  (id, work_order_id, line_type, source_service_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency,
   created_by, created_at)
values
  ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'service',
   '5e000000-0000-4000-8000-000000000002', 'Full Service', 1, 200.00, 0.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000002', now() - interval '9 days' + interval '10 minutes'),
  ('f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', 'service',
   '5e000000-0000-4000-8000-000000000005', 'Brake Bleed', 2, 45.00, 8.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000002', now() - interval '9 days' + interval '11 minutes');

update public.work_orders set status = 'in_progress', status_changed_at = now() - interval '8 days'
where id = 'f1000000-0000-4000-8000-000000000001';
update public.work_orders set status = 'completed', status_changed_at = now() - interval '7 days'
where id = 'f1000000-0000-4000-8000-000000000001';
update public.work_orders
set status = 'ready_for_collection', status_changed_at = now() - interval '7 days' + interval '1 hour'
where id = 'f1000000-0000-4000-8000-000000000001';
update public.work_orders set status = 'collected', status_changed_at = now() - interval '6 days'
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
   now() - interval '5 days', now() - interval '5 days',
   '5a000000-0000-4000-8000-000000000001');

insert into public.work_order_assignments (id, work_order_id, staff_id, role, assigned_by, assigned_at)
values
  ('f3000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002',
   '5a000000-0000-4000-8000-000000000003', 'lead', '5a000000-0000-4000-8000-000000000001',
   now() - interval '5 days' + interval '5 minutes');

insert into public.work_order_line_items
  (id, work_order_id, line_type, source_service_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency,
   created_by, created_at)
values
  ('f2000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000002', 'service',
   '5e000000-0000-4000-8000-000000000001', 'Basic Service', 1, 80.00, 0.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000001', now() - interval '5 days' + interval '10 minutes'),
  ('f2000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000002', 'service',
   '5e000000-0000-4000-8000-000000000004', 'Tyre Installation', 2, 15.00, 0.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000001', now() - interval '5 days' + interval '11 minutes');

-- (a) The approval as it happened, an hour after check-in.
insert into public.work_order_events
  (work_order_id, event_type, actor_staff_id, actor_user_id, payload, created_at)
values
  ('f1000000-0000-4000-8000-000000000002', 'approval_flagged',
   '5a000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   jsonb_build_object('flagged', true, 'note', 'Customer approved the GP5000 upgrade by phone.'),
   now() - interval '5 days' + interval '1 hour');

insert into public.work_order_line_items
  (id, work_order_id, line_type, source_service_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency,
   created_by, created_at)
values
  ('f2000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000002', 'manual',
   null, 'Continental GP5000 700×28c tyre', 2, 95.00, 62.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000001', now() - interval '5 days' + interval '90 minutes');

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', false);

update public.work_orders set status = 'in_progress', status_changed_at = now() - interval '4 days'
where id = 'f1000000-0000-4000-8000-000000000002';
update public.work_orders set status = 'completed', status_changed_at = now() - interval '1 day'
where id = 'f1000000-0000-4000-8000-000000000002';
update public.work_orders
set status = 'ready_for_collection', status_changed_at = now() - interval '1 day' + interval '30 minutes'
where id = 'f1000000-0000-4000-8000-000000000002';

-- ---------------------------------------------------------------------------
-- J-000003: Hafiz's Brompton, completed two hours ago. Lead Marcus,
-- Nur helping.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

insert into public.work_orders
  (id, customer_id, bike_id, requested_work, checked_in_at, created_at, created_by)
values
  ('f1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000003',
   'b1000000-0000-4000-8000-000000000005',
   'Drivetrain noisy, chain skipping.',
   now() - interval '2 days', now() - interval '2 days',
   '5a000000-0000-4000-8000-000000000001');

insert into public.work_order_assignments (id, work_order_id, staff_id, role, assigned_by, assigned_at)
values
  ('f3000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000003',
   '5a000000-0000-4000-8000-000000000002', 'lead', '5a000000-0000-4000-8000-000000000001',
   now() - interval '2 days' + interval '5 minutes'),
  ('f3000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000003',
   '5a000000-0000-4000-8000-000000000003', 'additional', '5a000000-0000-4000-8000-000000000001',
   now() - interval '2 days' + interval '6 minutes');

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', false);

insert into public.work_order_line_items
  (id, work_order_id, line_type, source_service_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency,
   created_by, created_at)
values
  ('f2000000-0000-4000-8000-000000000006', 'f1000000-0000-4000-8000-000000000003', 'service',
   '5e000000-0000-4000-8000-000000000006', 'Drivetrain Service', 1, 90.00, 5.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000002', now() - interval '2 days' + interval '10 minutes');

update public.work_orders set status = 'in_progress', status_changed_at = now() - interval '1 day'
where id = 'f1000000-0000-4000-8000-000000000003';
update public.work_orders set status = 'completed', status_changed_at = now() - interval '2 hours'
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
   now() - interval '3 days', now() - interval '3 days',
   '5a000000-0000-4000-8000-000000000001');

insert into public.work_order_assignments (id, work_order_id, staff_id, role, assigned_by, assigned_at)
values
  ('f3000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000004',
   '5a000000-0000-4000-8000-000000000002', 'lead', '5a000000-0000-4000-8000-000000000001',
   now() - interval '3 days' + interval '5 minutes');

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', false);

insert into public.work_order_line_items
  (id, work_order_id, line_type, source_service_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency,
   created_by, created_at)
values
  ('f2000000-0000-4000-8000-000000000007', 'f1000000-0000-4000-8000-000000000004', 'service',
   '5e000000-0000-4000-8000-000000000003', 'Wheel True', 2, 35.00, 0.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000002', now() - interval '3 days' + interval '10 minutes');

update public.work_orders
set status = 'diagnosing', status_changed_at = now() - interval '3 days' + interval '1 hour'
where id = 'f1000000-0000-4000-8000-000000000004';
update public.work_orders set status = 'in_progress', status_changed_at = now() - interval '1 day'
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
   now() - interval '6 days', now() - interval '6 days',
   '5a000000-0000-4000-8000-000000000001');

insert into public.work_order_assignments (id, work_order_id, staff_id, role, assigned_by, assigned_at)
values
  ('f3000000-0000-4000-8000-000000000006', 'f1000000-0000-4000-8000-000000000005',
   '5a000000-0000-4000-8000-000000000003', 'lead', '5a000000-0000-4000-8000-000000000001',
   now() - interval '6 days' + interval '5 minutes');

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', false);

insert into public.work_order_line_items
  (id, work_order_id, line_type, source_service_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency,
   created_by, created_at)
values
  ('f2000000-0000-4000-8000-000000000008', 'f1000000-0000-4000-8000-000000000005', 'service',
   '5e000000-0000-4000-8000-000000000008', 'Custom Labour', 1.5, 60.00, 0.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000003', now() - interval '6 days' + interval '10 minutes');

-- (a) Nur's note, an hour before the job waits for the part.
insert into public.work_order_events
  (work_order_id, event_type, actor_staff_id, actor_user_id, payload, created_at)
values
  ('f1000000-0000-4000-8000-000000000005', 'note_added',
   '5a000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003',
   jsonb_build_object('body', 'Waiting for the customer''s 9-speed shifter to arrive.'),
   now() - interval '5 days' - interval '1 hour');

update public.work_orders set status = 'awaiting_parts', status_changed_at = now() - interval '5 days'
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
   now() - interval '8 days', now() - interval '8 days',
   '5a000000-0000-4000-8000-000000000001');

insert into public.work_order_assignments (id, work_order_id, staff_id, role, assigned_by, assigned_at)
values
  ('f3000000-0000-4000-8000-000000000007', 'f1000000-0000-4000-8000-000000000006',
   '5a000000-0000-4000-8000-000000000002', 'lead', '5a000000-0000-4000-8000-000000000001',
   now() - interval '8 days' + interval '5 minutes');

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', false);

-- (a) Marcus's diagnosis.
insert into public.work_order_events
  (work_order_id, event_type, actor_staff_id, actor_user_id, payload, created_at)
values
  ('f1000000-0000-4000-8000-000000000006', 'diagnosis_added',
   '5a000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002',
   jsonb_build_object('body', 'Chain at 0.75% wear; cassette worn. Quoted new chain and cassette.'),
   now() - interval '8 days' + interval '2 hours');

update public.work_orders
set status = 'awaiting_customer', status_changed_at = now() - interval '8 days' + interval '3 hours'
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
   now() - interval '4 days', now() - interval '4 days',
   '5a000000-0000-4000-8000-000000000001');

insert into public.work_order_assignments (id, work_order_id, staff_id, role, assigned_by, assigned_at)
values
  ('f3000000-0000-4000-8000-000000000008', 'f1000000-0000-4000-8000-000000000008',
   '5a000000-0000-4000-8000-000000000003', 'lead', '5a000000-0000-4000-8000-000000000001',
   now() - interval '4 days' + interval '5 minutes');

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', false);

select private.set_change_reason('Customer will bring it back next month.');
update public.work_orders
set status = 'cancelled', status_changed_at = now() - interval '4 days' + interval '1 hour'
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
   now() - interval '1 day', now() - interval '1 day',
   '5a000000-0000-4000-8000-000000000001');

insert into public.work_order_assignments (id, work_order_id, staff_id, role, assigned_by, assigned_at)
values
  ('f3000000-0000-4000-8000-000000000009', 'f1000000-0000-4000-8000-000000000009',
   '5a000000-0000-4000-8000-000000000003', 'lead', '5a000000-0000-4000-8000-000000000001',
   now() - interval '1 day' + interval '5 minutes');

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', false);

insert into public.work_order_line_items
  (id, work_order_id, line_type, source_service_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency,
   created_by, created_at)
values
  ('f2000000-0000-4000-8000-000000000009', 'f1000000-0000-4000-8000-000000000009', 'service',
   '5e000000-0000-4000-8000-000000000001', 'Basic Service', 1, 80.00, 0.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000003', now() - interval '1 day' + interval '10 minutes');

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

insert into public.work_order_line_items
  (id, work_order_id, line_type, source_service_id, description_snapshot, quantity,
   unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency,
   created_by, created_at)
values
  ('f2000000-0000-4000-8000-000000000010', 'f1000000-0000-4000-8000-000000000009', 'manual',
   null, 'Shimano BB-RS500 bottom bracket', 1, 45.00, 28.00, 0.3000, 'SGD',
   '5a000000-0000-4000-8000-000000000001', now() - interval '1 day' + interval '15 minutes');

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', false);

update public.work_orders
set status = 'diagnosing', status_changed_at = now() - interval '1 day' + interval '1 hour'
where id = 'f1000000-0000-4000-8000-000000000009';

update public.work_order_line_items
set voided_at = now() - interval '1 day' + interval '3 hours',
    voided_by = '5a000000-0000-4000-8000-000000000003',
    void_reason = 'Wrong part quoted; the frame takes a press-fit bracket.'
where id = 'f2000000-0000-4000-8000-000000000010';

select set_config('request.jwt.claims', '', false);

-- ===========================================================================
-- Phase 4: inventory (DATA-MODEL.md §18 "Phase 4 part"). Locations,
-- product categories and products are written directly as the owner with
-- request.jwt.claims naming the admin (so created_by and every history
-- event name an actor); stock, units and the inventory job go through the
-- real RPCs as the admin, so every movement is what the app would write.
-- Every request id is used for exactly one call. Products get P-000001 ..
-- P-000016, units U-000001 .. U-000003, the shop bikes B-000011 ..
-- B-000013 and the job J-000010, in insert order on a fresh build.
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
   default_direct_cost, reorder_point, description)
values ('9a000000-0000-4000-8000-000000000001', 'SHI-L05A-RF', 'Road disc brake pads, resin (pair)',
  'Shimano', 'ca000000-0000-4000-8000-000000000006', 'quantity', 'internal_only', 28.00, 13.50, 10,
  'L05A resin pads for Shimano road disc callipers. Quiet, good modulation.');
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description)
values ('9a000000-0000-4000-8000-000000000002', 'CON-GP5K-25', 'Grand Prix 5000 700x25c tyre',
  'Continental', 'ca000000-0000-4000-8000-000000000007', 'quantity', 'internal_only', 89.00, 52.00, 4,
  'Folding clincher road tyre, BlackChili compound.');
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description)
values ('9a000000-0000-4000-8000-000000000003', 'SCH-SV20-60', 'Road inner tube 700x23-28c Presta 60mm',
  'Schwalbe', 'ca000000-0000-4000-8000-000000000007', 'quantity', 'internal_only', 9.00, 3.80, 20,
  'SV20 tube with a 60 mm Presta valve for deep rims.');
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description)
values ('9a000000-0000-4000-8000-000000000004', 'SCH-MR-16', 'Marathon Racer 16x1.35 tyre',
  'Schwalbe', 'ca000000-0000-4000-8000-000000000007', 'quantity', 'internal_only', 55.00, 30.00, 3,
  'Puncture-resistant 16-inch tyre for folding bikes.');
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description)
values ('9a000000-0000-4000-8000-000000000005', 'BRO-QTUBE16', 'Inner tube 16in Schrader',
  'Brompton', 'ca000000-0000-4000-8000-000000000007', 'quantity', 'internal_only', 14.00, 6.00, 6,
  'Genuine Brompton 16-inch tube, Schrader valve.');
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description)
values ('9a000000-0000-4000-8000-000000000006', 'KMC-X11-GY', 'X11 11-speed chain',
  'KMC', 'ca000000-0000-4000-8000-000000000008', 'quantity', 'internal_only', 45.00, 24.00, 5,
  '118 links with a MissingLink connector.');
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description)
values ('9a000000-0000-4000-8000-000000000007', 'SHI-CSR7000-1134', '105 CS-R7000 11-34 cassette',
  'Shimano', 'ca000000-0000-4000-8000-000000000008', 'quantity', 'draft', 109.00, 68.00, 2,
  null);
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description)
values ('9a000000-0000-4000-8000-000000000008', 'JAG-PRO-BRK', 'Pro brake cable kit',
  'Jagwire', 'ca000000-0000-4000-8000-000000000009', 'quantity', 'internal_only', 35.00, 16.00, 4,
  'Slick-polished cables with compressionless housing, road and MTB.');
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description)
values ('9a000000-0000-4000-8000-000000000009', 'SHI-BH90-1000', 'SM-BH90 hydraulic hose 1000mm',
  'Shimano', 'ca000000-0000-4000-8000-000000000009', 'quantity', 'internal_only', 28.00, 12.00, 5,
  null);
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description)
values ('9a000000-0000-4000-8000-000000000010', 'FL-DRY-120', 'Dry chain lube 120ml',
  'Finish Line', 'ca000000-0000-4000-8000-000000000010', 'quantity', 'internal_only', 16.00, 7.00, 6,
  'Teflon-fortified dry lube for dusty, dry rides.');
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description)
values ('9a000000-0000-4000-8000-000000000011', 'LS-DSP32', 'DSP 3.2mm bar tape',
  'Lizard Skins', 'ca000000-0000-4000-8000-000000000011', 'quantity', 'internal_only', 49.00, 26.00, 4,
  null);
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description)
values ('9a000000-0000-4000-8000-000000000012', 'OS-REG-237', 'Tubeless sealant 237ml',
  'Orange Seal', 'ca000000-0000-4000-8000-000000000007', 'quantity', 'internal_only', 32.00, 17.00, 3,
  null);
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description)
values ('9a000000-0000-4000-8000-000000000013', null, 'Colnago C64 Disc 52s (pre-owned)',
  'Colnago', 'ca000000-0000-4000-8000-000000000012', 'unique', 'internal_only', 6800.00, 4200.00, null,
  'Lugged carbon road frame, Dura-Ace Di2 R9170, Fulcrum Racing Zero wheels.');
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description)
values ('9a000000-0000-4000-8000-000000000014', null, 'Brompton C Line Explore (ex-demo)',
  'Brompton', 'ca000000-0000-4000-8000-000000000012', 'unique', 'internal_only', 1950.00, 1400.00, null,
  'Six-speed folding bike from the demo fleet, serviced and with new tyres.');
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description)
values ('9a000000-0000-4000-8000-000000000015', null, 'Surly Bridge Club 27.5 M (new old stock)',
  'Surly', 'ca000000-0000-4000-8000-000000000012', 'unique', 'internal_only', 1650.00, 1100.00, null,
  'Steel all-road tourer, 27.5 x 2.4 tyres, unridden from 2022 stock.');
insert into public.products
  (id, sku, name, brand, category_id, tracking_type, publication_status, default_sale_price,
   default_direct_cost, reorder_point, description)
values ('9a000000-0000-4000-8000-000000000016', 'KMC-X10-OLD', 'X10 10-speed chain (discontinued)',
  'KMC', 'ca000000-0000-4000-8000-000000000008', 'quantity', 'internal_only', 35.00, 18.00, null,
  'No longer stocked; kept for the jobs that used it.');
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

-- Opening stock through adjust_stock (request ids 9c…0NN per product at its
-- first location; 9c…1NN for the Workshop store rows of 03 and 12).
select public.adjust_stock(r.request_id, r.product_id, r.location_id, r.qty, 'stock_adjustment', 'Opening stock count')
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
order by r.ord;

-- The unique units, each linked to its shop bike (U-000001 .. U-000003).
select public.create_unique_unit(
  '9b000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000013',
  '1c000000-0000-4000-8000-000000000001', 'COL-C64-11873',
  'Excellent: light wear on the bar tape, new chain and cassette at 3,000 km.',
  null, 4200.00, 'b1000000-0000-4000-8000-000000000011');
select public.create_unique_unit(
  '9b000000-0000-4000-8000-000000000002', '9a000000-0000-4000-8000-000000000014',
  '1c000000-0000-4000-8000-000000000001', '2209183344',
  'Very good: demo fleet, serviced, new Marathon Racer tyres.',
  null, 1400.00, 'b1000000-0000-4000-8000-000000000012');
select public.create_unique_unit(
  '9b000000-0000-4000-8000-000000000003', '9a000000-0000-4000-8000-000000000015',
  '1c000000-0000-4000-8000-000000000001', 'SRY-BC-55102',
  'New: unridden, small storage mark on the left chainstay.',
  null, 1100.00, 'b1000000-0000-4000-8000-000000000013');

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
