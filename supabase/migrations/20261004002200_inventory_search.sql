-- Products and units in the global staff search (SPEC §11 "Search by SKU,
-- name, brand, short ID, serial", §20 "Global staff search should quickly
-- find ... product, unit ..."; DATA-MODEL.md §16 staff_search; PLAN D9).
--
-- Adds the `product` and `inventory_unit` kinds the way
-- 20261004001100_staff_search.sql prescribes: a private.search_<kind>
-- function each with the staff_search row shape, and staff_search replaced
-- (identical signature) with two more UNION ALL branches and two more known
-- kinds. Matching follows the bikes' rules (case-insensitive, LIKE
-- metacharacters literal, keys ignore case, spaces and punctuation).
--
--   product         exact short ID ("P-000001", "p000001")      1.0
--                   exact SKU ("shi l05a rf" = SHI-L05A-RF)      1.0
--                   SKU contains the key (>= 3 characters)       0.7
--                   every word of q in name/brand/SKU            0.45-0.85
--   inventory_unit  exact short ID ("U-000001")                  1.0
--                   exact serial number                          1.0
--                   serial contains the key (>= 3 characters)    0.7
--                   every word of q in the product's name        0.45-0.85
--
-- Hits: a product's title is its name and its subtitle
-- "SKU · brand · N in stock" ("Unique item" for a unique product; N is the
-- ledger on-hand across locations), with "Inactive" appended for an
-- inactive product (still found). A unit's title is its product's name and
-- its subtitle "status · location · S/N serial". Archived products and units
-- (their own archived_at) are left out, or searched alone with
-- archived = true. Staff only; nothing here is a cost.

create function private.search_products(q text, max_results integer, archived boolean)
returns table (kind text, id uuid, title text, subtitle text, short_id text, rank real)
language sql
stable
set search_path = ''
as $$
  with input as (
    select
      s.terms,
      private.contains_pattern(s.terms[1]) as anchor,
      array(select private.contains_pattern(t) from pg_catalog.unnest(s.terms) as t) as patterns,
      pg_catalog.lower(pg_catalog.btrim(q)) as lq,
      private.search_key(q) as key
    from (select private.search_terms(q) as terms) s
  ),
  -- Each branch can use its own index (short_id and sku_key unique,
  -- sku_key and search_text trigram).
  matched as (
    select p.id
    from public.products p, input i
    where i.key is not null
      and (p.short_id = pg_catalog.substr(i.key, 1, 1) || '-' || pg_catalog.substr(i.key, 2)
           or p.sku_key = i.key)
    union
    select p.id
    from public.products p, input i
    where pg_catalog.length(i.key) >= 3
      and p.sku_key like '%' || i.key || '%'
    union
    select p.id
    from public.products p, input i
    where pg_catalog.cardinality(i.terms) > 0
      and p.search_text like i.anchor
      and p.search_text like all (i.patterns)
  )
  select
    'product'::text,
    p.id,
    p.name,
    pg_catalog.concat_ws(
      ' · ',
      p.sku,
      p.brand,
      case
        when p.tracking_type = 'unique' then 'Unique item'
        else coalesce((
          select sum(mv.quantity_delta) from public.inventory_movements mv where mv.product_id = p.id
        ), 0)::text || ' in stock'
      end,
      case when not p.active then 'Inactive' end
    ),
    p.short_id,
    greatest(
      case when pg_catalog.replace(p.short_id, '-', '') = i.key then 1.0 end,
      case when p.sku_key = i.key then 1.0 end,
      case when pg_catalog.length(i.key) >= 3 and p.sku_key like '%' || i.key || '%' then 0.7 end,
      case when pg_catalog.cardinality(i.terms) > 0 and p.search_text like all (i.patterns)
        then 0.45 + 0.4 * extensions.word_similarity(i.lq, p.search_text) end
    )::real
  from matched m
  join public.products p on p.id = m.id
  cross join input i
  where (p.archived_at is not null) = search_products.archived
  order by 6 desc, 3, 2
  limit max_results;
$$;

create function private.search_units(q text, max_results integer, archived boolean)
returns table (kind text, id uuid, title text, subtitle text, short_id text, rank real)
language sql
stable
set search_path = ''
as $$
  with input as (
    select
      s.terms,
      private.contains_pattern(s.terms[1]) as anchor,
      array(select private.contains_pattern(t) from pg_catalog.unnest(s.terms) as t) as patterns,
      pg_catalog.lower(pg_catalog.btrim(q)) as lq,
      private.search_key(q) as key
    from (select private.search_terms(q) as terms) s
  ),
  matched as (
    select u.id
    from public.inventory_units u, input i
    where i.key is not null
      and (u.short_id = pg_catalog.substr(i.key, 1, 1) || '-' || pg_catalog.substr(i.key, 2)
           or u.serial_key = i.key)
    union
    select u.id
    from public.inventory_units u, input i
    where pg_catalog.length(i.key) >= 3
      and u.serial_key like '%' || i.key || '%'
    union
    select u.id
    from public.inventory_units u
    join public.products p on p.id = u.product_id
    cross join input i
    where pg_catalog.cardinality(i.terms) > 0
      and pg_catalog.lower(p.name) like i.anchor
      and pg_catalog.lower(p.name) like all (i.patterns)
  )
  select
    'inventory_unit'::text,
    u.id,
    p.name,
    pg_catalog.concat_ws(
      ' · ',
      case u.status
        when 'available' then 'Available'
        when 'reserved' then 'Reserved'
        when 'held_for_customer' then 'On a job'
        when 'sold' then 'Sold'
        when 'written_off' then 'Written off'
        when 'returned_to_consignor' then 'Returned to consignor'
      end,
      l.name,
      'S/N ' || u.serial_number
    ),
    u.short_id,
    greatest(
      case when pg_catalog.replace(u.short_id, '-', '') = i.key then 1.0 end,
      case when u.serial_key = i.key then 1.0 end,
      case when pg_catalog.length(i.key) >= 3 and u.serial_key like '%' || i.key || '%' then 0.7 end,
      case when pg_catalog.cardinality(i.terms) > 0 and pg_catalog.lower(p.name) like all (i.patterns)
        then 0.45 + 0.4 * extensions.word_similarity(i.lq, pg_catalog.lower(p.name)) end
    )::real
  from matched m
  join public.inventory_units u on u.id = m.id
  join public.products p on p.id = u.product_id
  join public.locations l on l.id = u.location_id
  cross join input i
  where (u.archived_at is not null) = search_units.archived
  order by 6 desc, 3, 2
  limit max_results;
$$;

-- Active staff. Blank q returns nothing; kinds null means every kind and
-- an unknown kind raises 22023; max_results is clamped to 1..100; archived
-- true searches archived records only (customers, bikes, products, units;
-- jobs are never archived). Phase 3 added `work_order`; Phase 4 adds
-- `product` and `inventory_unit`.
create or replace function public.staff_search(
  q text,
  kinds text[] default null,
  max_results integer default 20,
  archived boolean default false
)
returns table (kind text, id uuid, title text, subtitle text, short_id text, rank real)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  term text := pg_catalog.left(pg_catalog.btrim(coalesce(staff_search.q, '')), 200);
  n integer := greatest(1, least(coalesce(staff_search.max_results, 20), 100));
  known constant text[] := array['customer', 'bike', 'work_order', 'product', 'inventory_unit'];
begin
  perform private.require_staff();

  if staff_search.kinds is not null and exists (
    select 1 from pg_catalog.unnest(staff_search.kinds) as k(name)
    where k.name is null or not (k.name = any (known))
  ) then
    raise exception 'unknown search kind; expected some of %', known using errcode = '22023';
  end if;
  if term = '' then
    return;
  end if;

  return query
    select h.kind, h.id, h.title, h.subtitle, h.short_id, h.rank
    from (
      select * from private.search_customers(term, n, coalesce(staff_search.archived, false))
      where staff_search.kinds is null or 'customer' = any (staff_search.kinds)
      union all
      select * from private.search_bikes(term, n, coalesce(staff_search.archived, false))
      where staff_search.kinds is null or 'bike' = any (staff_search.kinds)
      union all
      select * from private.search_work_orders(term, n, coalesce(staff_search.archived, false))
      where staff_search.kinds is null or 'work_order' = any (staff_search.kinds)
      union all
      select * from private.search_products(term, n, coalesce(staff_search.archived, false))
      where staff_search.kinds is null or 'product' = any (staff_search.kinds)
      union all
      select * from private.search_units(term, n, coalesce(staff_search.archived, false))
      where staff_search.kinds is null or 'inventory_unit' = any (staff_search.kinds)
    ) h
    order by h.rank desc, h.kind, h.title, h.id
    limit n;
end;
$$;

comment on function public.staff_search(text, text[], integer, boolean) is
  'Active staff: global search across customers, bikes, jobs, products and units (later phases add kinds); exact short ID, serial, SKU and job number first; archived=true searches archived records.';

revoke all on function
  private.search_products(text, integer, boolean),
  private.search_units(text, integer, boolean)
from public, anon, authenticated, service_role;

-- create or replace keeps the existing privileges; restated so this file
-- reads complete on its own.
revoke all on function public.staff_search(text, text[], integer, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.staff_search(text, text[], integer, boolean) to authenticated;
