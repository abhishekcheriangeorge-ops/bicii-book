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
