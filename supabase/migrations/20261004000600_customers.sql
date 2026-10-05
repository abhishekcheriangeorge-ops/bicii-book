-- Customers (SPEC §4, §4.1, §4.2, §17.2; DATA-MODEL.md §1, §2, §15).
--
-- Rules encoded here:
--   * Customers are not staff. Email is never a key: duplicates are allowed
--     (citext, not unique). The durable links are auth_user_id (Supabase
--     login, Phase 11 sign-up) and shopify_customer_id (Phase 10), both
--     unique and nullable. Neither is writable by signed-in users: the
--     phases that link them add their own RPCs.
--   * Customer access boundary: staff and customers share the
--     `authenticated` role, so column grants cannot tell them apart and RLS
--     is row-level only. The base table is therefore readable and writable
--     by ACTIVE STAFF ONLY. A customer reads and edits their own row only
--     through security-definer RPCs that project customer-safe columns
--     (my_customer_profile, update_my_profile; see the customer access
--     migration). internal_notes never leaves the staff side.
--   * Soft delete only (archived_at); no DELETE for anyone through the API.
--   * Blank text is stored as NULL, and a row must identify somebody (a
--     name, an email or a phone).
--   * private.current_customer_id(): the caller's non-archived customers row.
--
-- Search: pg_trgm (in `extensions`, as hosted Supabase installs it) backs
-- staff_search with trigram GIN indexes on a lower-cased name/email column
-- and a digits-only phone column. Both are generated columns built from
-- built-in immutable functions only, so the indexes need no helper function
-- and work identically on hosted Supabase and plain Postgres.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  -- Optional human ID for search; not printed, not assigned yet.
  short_id text null unique,
  -- Set null, not restrict: deleting a login keeps the customer's history.
  auth_user_id uuid null unique references auth.users (id) on delete set null,
  first_name text null check (pg_catalog.char_length(first_name) <= 100),
  last_name text null check (pg_catalog.char_length(last_name) <= 100),
  -- Fallback when null: first + last, else email (customer_label()).
  display_name text null check (pg_catalog.char_length(display_name) <= 200),
  -- NOT a key: several customers may share an email (SPEC §4).
  email extensions.citext null check (
    pg_catalog.char_length(email::text) <= 320 and email::text ~ '^[^@[:space:]]+@[^@[:space:]]+$'
  ),
  phone text null check (pg_catalog.char_length(phone) <= 40),
  -- Staff only. Never in a customer projection.
  internal_notes text null check (pg_catalog.char_length(internal_notes) <= 10000),
  -- Durable Shopify link (SPEC §17.2): a matching email is a candidate, not proof.
  shopify_customer_id text null unique,
  -- Search keys (generated; never written directly).
  search_text text generated always as (
    lower(
      coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' ||
      coalesce(display_name, '') || ' ' || coalesce(email::text, '')
    )
  ) stored,
  phone_digits text generated always as (
    nullif(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), '')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  constraint customers_identifies_someone check (
    coalesce(first_name, last_name, display_name, email::text, phone) is not null
  )
);

comment on table public.customers is
  'Workshop customers. Staff read and write the table; customers reach their own row only through my_customer_profile / update_my_profile.';
comment on column public.customers.internal_notes is 'Staff only; never returned by a customer RPC.';
comment on column public.customers.search_text is 'Generated: lower-cased names and email, trigram-indexed for staff_search.';
comment on column public.customers.phone_digits is 'Generated: the phone number''s digits, trigram-indexed for staff_search.';

create index customers_search_text_trgm_idx on public.customers
  using gin (search_text extensions.gin_trgm_ops);
create index customers_phone_digits_trgm_idx on public.customers
  using gin (phone_digits extensions.gin_trgm_ops);
create index customers_email_idx on public.customers (email);

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function private.set_updated_at();

-- Trim text and store blanks as NULL, for every writer.
create function private.customers_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.first_name := nullif(pg_catalog.btrim(new.first_name), '');
  new.last_name := nullif(pg_catalog.btrim(new.last_name), '');
  new.display_name := nullif(pg_catalog.btrim(new.display_name), '');
  new.email := nullif(pg_catalog.btrim(new.email::text), '');
  new.phone := nullif(pg_catalog.btrim(new.phone), '');
  new.internal_notes := nullif(pg_catalog.btrim(new.internal_notes), '');
  new.shopify_customer_id := nullif(pg_catalog.btrim(new.shopify_customer_id), '');
  return new;
end;
$$;

create trigger customers_normalize
  before insert or update on public.customers
  for each row execute function private.customers_normalize();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The caller's customers row (non-archived), or null: anonymous callers,
-- staff without a customers row, archived customers. Stable and security
-- definer so it can read the table under RLS. EXECUTE for authenticated
-- only (a policy predicate, like is_staff()).
create function private.current_customer_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from public.customers c
  where c.auth_user_id = auth.uid()
    and c.archived_at is null;
$$;

-- The name to show for a customer: display_name, else first + last, else
-- email, else phone.
create function private.customer_label(
  first_name text,
  last_name text,
  display_name text,
  email text,
  phone text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    display_name,
    first_name || ' ' || last_name,
    first_name,
    last_name,
    email,
    phone,
    'Customer'
  );
$$;

revoke all on function
  private.customers_normalize(),
  private.current_customer_id(),
  private.customer_label(text, text, text, text, text)
from public, anon, authenticated, service_role;

grant execute on function private.current_customer_id() to authenticated;

-- ---------------------------------------------------------------------------
-- Grants and RLS: active staff only (see the access boundary above).
-- ---------------------------------------------------------------------------
alter table public.customers enable row level security;

revoke all on table public.customers from public, anon, authenticated, service_role;

grant select on table public.customers to authenticated;
-- `id` is insertable so the app can create idempotently with its own UUID.
grant insert (id, first_name, last_name, display_name, email, phone, internal_notes)
  on table public.customers to authenticated;
grant update (first_name, last_name, display_name, email, phone, internal_notes, archived_at)
  on table public.customers to authenticated;
grant select on table public.customers to service_role;

create policy customers_select_staff on public.customers
  for select to authenticated
  using ((select private.is_staff()));

create policy customers_insert_staff on public.customers
  for insert to authenticated
  with check ((select private.is_staff()));

create policy customers_update_staff on public.customers
  for update to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));
