-- Suppliers and the products each one supplies (SPEC §14 "Suppliers",
-- "multiple supplier relationships per product"; DATA-MODEL.md §6, §10,
-- §15, §16; PLAN D5, D60 D-PO-COSTS, D61 D-PO-CANCEL, D62 D-PO-SCOPE).
--
-- Rules encoded here, for every writer:
--   * Suppliers are staff data: every active staff member reads them; only
--     manage_purchasing writes them (insert and update are column grants;
--     the app creates idempotently with its own UUID, as for customers).
--     Soft delete only (archived_at); no DELETE for anyone. An active
--     supplier name is unique regardless of case.
--   * Blank text is stored as NULL; the name is trimmed but never nulled, so
--     suppliers_name_check explains a blank name.
--   * supplier_products links a supplier to a product (several suppliers per
--     product, at most one preferred). It is written only through
--     set_supplier_product / remove_supplier_product and by receive_purchase
--     (the last cost and last received time, D63 D-LASTCOST). A link is a
--     relationship, not history: removing it needs no reason.
--   * D60 D-PO-COSTS: purchase costs (supplier_products.last_unit_cost here)
--     are visible to staff holding view_costs OR manage_purchasing, through
--     private.can_view_purchase_costs(). authenticated has no column grant on
--     last_unit_cost; it is read through the definer view
--     supplier_products_staff, which filters its rows itself.
--
-- GLOBAL PURCHASING LOCK ORDER (extends the inventory migration's order and
-- DATA-MODEL §7; never take a later lock and then an earlier one):
--   1. the purchase_orders row FOR UPDATE;
--   2. that PO's purchase_order_lines, read or changed only under the PO lock;
--   3. private.lock_stock(product_id) for every product a receipt touches, in
--      ascending product_id order, BEFORE any receipt line or movement is
--      inserted (Phase 4's step 3);
--   4. the products rows, updated (cost) in ascending id order (Phase 4's
--      step 6: the products row lock is the last inventory lock);
--   5. supplier_products rows, in ascending product_id order.
-- set_supplier_product, which holds no PO, locks the products row FOR NO KEY
-- UPDATE and then supplier_products (steps 4 then 5). Purchasing RPCs never
-- lock work orders, bikes or units.

-- ---------------------------------------------------------------------------
-- D60 D-PO-COSTS: who sees purchase costs. Security definer so RLS policies
-- and definer views can call it as the caller; EXECUTE to authenticated only.
-- ---------------------------------------------------------------------------
create function private.can_view_purchase_costs()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission('view_costs') or private.has_permission('manage_purchasing');
$$;

comment on function private.can_view_purchase_costs() is
  'D60 D-PO-COSTS: purchase costs are visible to view_costs OR manage_purchasing (purchasing surfaces only).';

-- ---------------------------------------------------------------------------
-- suppliers
-- ---------------------------------------------------------------------------
create table public.suppliers (
  -- Client-supplied by the app's form id (the create's idempotency key).
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text null,
  email extensions.citext null,
  phone text null,
  website text null,
  -- BICII's account number at the supplier.
  account_reference text null,
  notes text null,
  search_text text generated always as (
    lower(
      name || ' ' || coalesce(contact_name, '') || ' ' || coalesce(email::text, '') || ' ' ||
      coalesce(account_reference, '')
    )
  ) stored,
  phone_digits text generated always as (
    nullif(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), '')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The soft delete; there is no `active` column.
  archived_at timestamptz null,
  constraint suppliers_name_check check (
    pg_catalog.btrim(name) <> '' and pg_catalog.char_length(name) <= 200
  ),
  constraint suppliers_contact_name_check check (pg_catalog.char_length(contact_name) <= 200),
  constraint suppliers_email_check check (
    pg_catalog.char_length(email::text) <= 320 and email::text ~ '^[^@[:space:]]+@[^@[:space:]]+$'
  ),
  constraint suppliers_phone_check check (pg_catalog.char_length(phone) <= 40),
  constraint suppliers_website_check check (
    pg_catalog.char_length(website) <= 300 and website ~* '^https?://[^[:space:]]+$'
  ),
  constraint suppliers_account_reference_check check (pg_catalog.char_length(account_reference) <= 100),
  constraint suppliers_notes_check check (pg_catalog.char_length(notes) <= 10000)
);

create unique index suppliers_name_active_key on public.suppliers (lower(name)) where archived_at is null;
create index suppliers_search_text_trgm_idx on public.suppliers using gin (search_text extensions.gin_trgm_ops);
create index suppliers_phone_digits_trgm_idx on public.suppliers using gin (phone_digits extensions.gin_trgm_ops);

comment on table public.suppliers is
  'Suppliers (SPEC §14). Staff read; manage_purchasing writes. Soft delete via archived_at; an active name is unique.';
comment on column public.suppliers.account_reference is 'BICII''s account number at the supplier.';
comment on column public.suppliers.search_text is 'Generated: lower-cased name, contact, email and account reference (trigram-indexed).';
comment on column public.suppliers.phone_digits is 'Generated: the phone number''s digits (trigram-indexed).';

create trigger suppliers_set_updated_at
  before update on public.suppliers
  for each row execute function private.set_updated_at();

-- Trim text and store blanks as NULL, for every writer. The name is trimmed
-- but not nulled: a blank name fails suppliers_name_check, which says why.
create function private.suppliers_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := pg_catalog.btrim(new.name);
  new.contact_name := nullif(pg_catalog.btrim(new.contact_name), '');
  new.email := nullif(pg_catalog.btrim(new.email::text), '');
  new.phone := nullif(pg_catalog.btrim(new.phone), '');
  new.website := nullif(pg_catalog.btrim(new.website), '');
  new.account_reference := nullif(pg_catalog.btrim(new.account_reference), '');
  new.notes := nullif(pg_catalog.btrim(new.notes), '');
  return new;
end;
$$;

create trigger suppliers_normalize
  before insert or update on public.suppliers
  for each row execute function private.suppliers_normalize();

-- ---------------------------------------------------------------------------
-- supplier_products (several suppliers per product; at most one preferred)
-- ---------------------------------------------------------------------------
create table public.supplier_products (
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  supplier_sku text null,
  lead_days integer null,
  preferred boolean not null default false,
  -- Written only by receive_purchase (D63 D-LASTCOST). Purchase cost (D60):
  -- no column grant to authenticated; read through supplier_products_staff.
  last_unit_cost public.money_amount null,
  -- No default: set_supplier_product inserts the product's currency,
  -- receive_purchase writes the PO's.
  currency char(3) not null,
  last_received_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (supplier_id, product_id),
  constraint supplier_products_supplier_sku_check check (pg_catalog.char_length(supplier_sku) <= 100),
  constraint supplier_products_lead_days_check check (lead_days between 0 and 365),
  constraint supplier_products_last_unit_cost_check check (last_unit_cost >= 0),
  constraint supplier_products_currency_check check (currency ~ '^[A-Z]{3}$')
);

create unique index supplier_products_one_preferred on public.supplier_products (product_id) where preferred;
create index supplier_products_product_id_idx on public.supplier_products (product_id);

comment on table public.supplier_products is
  'Which suppliers supply a product (SPEC §14). Written only through set_supplier_product / remove_supplier_product and receive_purchase.';
comment on column public.supplier_products.last_unit_cost is
  'D63 D-LASTCOST: the latest actual unit cost received from this supplier (by receipt received_at). Purchase cost (D60): read through supplier_products_staff.';

create trigger supplier_products_set_updated_at
  before update on public.supplier_products
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- The costed view (D60). A definer view (it reads last_unit_cost, which
-- authenticated cannot select), security_barrier, filtered in its WHERE
-- clause by private.can_view_purchase_costs(): it filters rows itself.
-- ---------------------------------------------------------------------------
create view public.supplier_products_staff
with (security_barrier)
as
  select sp.supplier_id, sp.product_id, sp.last_unit_cost, sp.currency, sp.last_received_at
  from public.supplier_products sp
  where (select private.can_view_purchase_costs());

comment on view public.supplier_products_staff is
  'D60 D-PO-COSTS: supplier last costs, for view_costs or manage_purchasing only (the view filters its rows itself).';

-- ---------------------------------------------------------------------------
-- RPCs (manage_purchasing)
-- ---------------------------------------------------------------------------

-- Links a supplier to a product, or changes the link's SKU, lead time and
-- preference (never its last cost). Lock order: the products row (step 4),
-- which serialises concurrent preference changes for one product even when
-- no link exists yet, then supplier_products (step 5).
create function public.set_supplier_product(
  supplier_id uuid,
  product_id uuid,
  supplier_sku text default null,
  lead_days integer default null,
  preferred boolean default false
)
returns public.supplier_products
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  product_currency char(3);
  supplier_archived timestamptz;
  result public.supplier_products;
begin
  perform private.require_permission('manage_purchasing');
  if set_supplier_product.supplier_id is null or set_supplier_product.product_id is null then
    raise exception 'supplier_id and product_id are required' using errcode = '22004';
  end if;

  select p.currency into product_currency
  from public.products p
  where p.id = set_supplier_product.product_id
  for no key update;
  if not found then
    raise exception 'product % not found', set_supplier_product.product_id using errcode = 'P0002';
  end if;

  select s.archived_at into supplier_archived
  from public.suppliers s
  where s.id = set_supplier_product.supplier_id;
  if not found then
    raise exception 'supplier % not found', set_supplier_product.supplier_id using errcode = 'P0002';
  end if;
  if supplier_archived is not null then
    raise exception using
      errcode = 'P0001',
      message = 'supplier_archived',
      detail = 'That supplier is archived; unarchive it first.';
  end if;

  if coalesce(set_supplier_product.preferred, false) then
    update public.supplier_products sp
    set preferred = false
    where sp.product_id = set_supplier_product.product_id
      and sp.preferred
      and sp.supplier_id <> set_supplier_product.supplier_id;
  end if;

  insert into public.supplier_products as sp (supplier_id, product_id, supplier_sku, lead_days, preferred, currency)
  values (
    set_supplier_product.supplier_id, set_supplier_product.product_id,
    nullif(pg_catalog.btrim(set_supplier_product.supplier_sku), ''), set_supplier_product.lead_days,
    coalesce(set_supplier_product.preferred, false), product_currency
  )
  on conflict on constraint supplier_products_pkey do update
  set supplier_sku = excluded.supplier_sku,
      lead_days = excluded.lead_days,
      preferred = excluded.preferred
  returning sp.* into result;
  return result;
end;
$$;

comment on function public.set_supplier_product(uuid, uuid, text, integer, boolean) is
  'manage_purchasing: link a supplier to a product (SKU, lead days, preferred; at most one preferred per product). Never changes the last cost.';

-- Removes a link; returns the removed row, or nothing when it was already gone.
create function public.remove_supplier_product(supplier_id uuid, product_id uuid)
returns setof public.supplier_products
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('manage_purchasing');
  if remove_supplier_product.supplier_id is null or remove_supplier_product.product_id is null then
    raise exception 'supplier_id and product_id are required' using errcode = '22004';
  end if;
  return query
    delete from public.supplier_products sp
    where sp.supplier_id = remove_supplier_product.supplier_id
      and sp.product_id = remove_supplier_product.product_id
    returning sp.*;
end;
$$;

comment on function public.remove_supplier_product(uuid, uuid) is
  'manage_purchasing: remove a supplier-product link; returns it, or no row on a replay.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function
  private.can_view_purchase_costs(),
  private.suppliers_normalize(),
  public.set_supplier_product(uuid, uuid, text, integer, boolean),
  public.remove_supplier_product(uuid, uuid)
from public, anon, authenticated, service_role;

-- Called as the caller by RLS policies and the definer views' WHERE clauses.
grant execute on function private.can_view_purchase_costs() to authenticated;

grant execute on function
  public.set_supplier_product(uuid, uuid, text, integer, boolean),
  public.remove_supplier_product(uuid, uuid)
to authenticated;

alter table public.suppliers enable row level security;
alter table public.supplier_products enable row level security;

revoke all on table public.suppliers from public, anon, authenticated, service_role;
revoke all on table public.supplier_products from public, anon, authenticated, service_role;
revoke all on table public.supplier_products_staff from public, anon, authenticated, service_role;

grant select on table public.suppliers to authenticated, service_role;
grant insert (id, name, contact_name, email, phone, website, account_reference, notes)
  on table public.suppliers to authenticated;
grant update (name, contact_name, email, phone, website, account_reference, notes, archived_at)
  on table public.suppliers to authenticated;

-- Every column except last_unit_cost (D60). Writes go through the RPCs.
grant select (
  supplier_id, product_id, supplier_sku, lead_days, preferred, currency, last_received_at,
  created_at, updated_at
) on table public.supplier_products to authenticated;
grant select on table public.supplier_products to service_role;

grant select on table public.supplier_products_staff to authenticated;

create policy suppliers_select_staff on public.suppliers
  for select to authenticated
  using ((select private.is_staff()));

create policy suppliers_insert_manage_purchasing on public.suppliers
  for insert to authenticated
  with check ((select private.has_permission('manage_purchasing')));

create policy suppliers_update_manage_purchasing on public.suppliers
  for update to authenticated
  using ((select private.has_permission('manage_purchasing')))
  with check ((select private.has_permission('manage_purchasing')));

create policy supplier_products_select_staff on public.supplier_products
  for select to authenticated
  using ((select private.is_staff()));
