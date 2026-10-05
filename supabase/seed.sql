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
