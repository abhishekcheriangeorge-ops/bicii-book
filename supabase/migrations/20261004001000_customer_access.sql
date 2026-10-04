-- How customers reach their own data (SPEC §4 "Customer", §4.2, §18, §23
-- "Customers cannot read internal notes ..."; DATA-MODEL.md §15 "Customer
-- access pattern"; PLAN D8, D12).
--
-- The pattern every later phase follows (appointments, work orders,
-- service history):
--   * Staff and signed-in customers share the `authenticated` role, so a
--     column grant cannot hide internal_notes from customers while showing
--     it to staff, and RLS can only hide whole rows. Base tables are
--     therefore readable by ACTIVE STAFF ONLY (their RLS policies call
--     private.is_staff()); a customer selecting them gets zero rows.
--   * Customers read and write through these security-definer RPCs, which
--     resolve the caller with private.current_customer_id() (their
--     non-archived customers row) and return an explicit list of
--     customer-safe columns. Nothing staff-only (internal_notes, Shopify
--     and Auth links, search keys, costs) is ever in a customer projection.
--   * An RPC never takes a customer id from the caller: it is always the
--     caller's own. Asking for someone else's bike returns nothing, not an
--     error, so the RPCs reveal nothing about other customers' records.
--   * Anonymous visitors cannot call them (EXECUTE for authenticated only).
--   * Customer sign-up (creating and linking the customers row) arrives with
--     the public site's sign-in (Phase 11).

-- Raises 42501 unless the caller has a non-archived customers row.
create function private.require_customer()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  customer_id uuid := private.current_customer_id();
begin
  if customer_id is null then
    raise exception 'customer account required' using errcode = '42501';
  end if;
  return customer_id;
end;
$$;

-- What a customer may see of their own customers row.
create type public.customer_profile as (
  id uuid,
  first_name text,
  last_name text,
  display_name text,
  email text,
  phone text,
  created_at timestamptz
);
comment on type public.customer_profile is
  'Customer-safe projection of a customers row (no internal notes, no Auth or Shopify links).';

-- The caller's own customer profile; zero rows when they have none.
create function public.my_customer_profile()
returns setof public.customer_profile
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.first_name, c.last_name, c.display_name, c.email::text, c.phone, c.created_at
  from public.customers c
  where c.id = private.current_customer_id();
$$;

comment on function public.my_customer_profile() is
  'Signed-in customer: their own profile (customer-safe columns only).';

-- The caller edits their own name and phone. Null leaves a field as it is;
-- an empty string clears it. Email is the login's and is not edited here.
create function public.update_my_profile(
  first_name text default null,
  last_name text default null,
  display_name text default null,
  phone text default null
)
returns public.customer_profile
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_customer();
  result public.customer_profile;
begin
  update public.customers c
  set first_name = coalesce(update_my_profile.first_name, c.first_name),
      last_name = coalesce(update_my_profile.last_name, c.last_name),
      display_name = coalesce(update_my_profile.display_name, c.display_name),
      phone = coalesce(update_my_profile.phone, c.phone)
  where c.id = me
  returning c.id, c.first_name, c.last_name, c.display_name, c.email::text, c.phone, c.created_at
  into result;
  return result;
end;
$$;

comment on function public.update_my_profile(text, text, text, text) is
  'Signed-in customer: change their own name and phone (null keeps, empty clears).';

-- The caller's current, non-archived bikes. Previous owners stop seeing a
-- bike once it is transferred (PLAN D12).
create function public.my_bikes()
returns table (
  id uuid,
  short_id text,
  brand text,
  model text,
  variant text,
  frame_size text,
  colour text,
  serial_number text,
  description text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, b.short_id, b.brand, b.model, b.variant, b.frame_size, b.colour,
         b.serial_number, b.description, b.created_at
  from public.bikes b
  where b.customer_id = private.current_customer_id()
    and b.archived_at is null
  order by b.created_at, b.id;
$$;

comment on function public.my_bikes() is
  'Signed-in customer: their own current bikes (no internal notes).';

-- Photos of one of the caller's bikes that staff marked `customer` or
-- `public`; nothing for a bike that is not theirs. Media-internal objects
-- are then served through short-lived signed URLs minted by a server that
-- has checked this list (DATA-MODEL §2), never through a storage policy.
create function public.my_bike_attachments(bike_id uuid)
returns table (
  id uuid,
  storage_bucket text,
  storage_path text,
  media_type text,
  width integer,
  height integer,
  caption text,
  visibility public.attachment_visibility,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.storage_bucket, a.storage_path, a.media_type,
         a.width, a.height, a.caption, a.visibility, a.created_at
  from public.attachments a
  join public.bikes b on b.id = a.entity_id
  where a.entity_type = 'bike'
    and a.entity_id = my_bike_attachments.bike_id
    and a.visibility in ('customer', 'public')
    and b.customer_id = private.current_customer_id()
    and b.archived_at is null
  order by a.created_at, a.id;
$$;

comment on function public.my_bike_attachments(uuid) is
  'Signed-in customer: customer- and public-visible photos of one of their own bikes.';

revoke all on function private.require_customer() from public, anon, authenticated, service_role;

revoke all on function
  public.my_customer_profile(),
  public.update_my_profile(text, text, text, text),
  public.my_bikes(),
  public.my_bike_attachments(uuid)
from public, anon, authenticated, service_role;

grant execute on function
  public.my_customer_profile(),
  public.update_my_profile(text, text, text, text),
  public.my_bikes(),
  public.my_bike_attachments(uuid)
to authenticated;
