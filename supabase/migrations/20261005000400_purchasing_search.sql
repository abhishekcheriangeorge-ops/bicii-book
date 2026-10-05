-- Suppliers and purchase orders in the global staff search (SPEC §14, §20
-- "Global staff search should quickly find ..."; DATA-MODEL.md §16
-- staff_search; PLAN D9).
--
-- MERGE: this definition must contain every staff_search branch on the
-- merged line. It replaces public.staff_search with this branch's latest
-- body (20261004002200_inventory_search.sql) plus two kinds. The parallel
-- track also replaces staff_search (its consignment kinds) in a 20261004…
-- migration; this 20261005… file runs after it, so on the merged line it
-- would silently drop that track's branches unless they are copied in here
-- (both the UNION ALL branches and the `known` entries). The DB test
-- "staff_search knows every SEARCH_KINDS entry" (tests/db/staff-search.test.ts)
-- fails the merge when a kind the app asks for is missing.
--
-- Adds the `supplier` and `purchase_order` kinds the way
-- 20261004001100_staff_search.sql prescribes: a private.search_<kind>
-- function each with the staff_search row shape, and staff_search replaced
-- (identical signature) with two more UNION ALL branches and two more known
-- kinds.
--
--   supplier        exact email or exact phone number               0.95
--                   q's phone digits inside the phone number        0.6
--                   every word of q in name/contact/email/account   0.5-0.9
--   purchase_order  exact PO number ("PO-000002", "po 000002",
--                   "PO000002")                                     1.0
--                   exact supplier reference (ignoring case, spaces
--                   and punctuation)                                0.95
--                   PO number contains the key (>= 3 characters)    0.6
--                   every word of q in the supplier's search text   0.4-0.8
--
-- Hits: a supplier's title is its name and its subtitle
-- "contact · phone · email". A PO's title is its supplier's name, its
-- short_id the PO number, and its subtitle "status · expected 12 Oct 2026 ·
-- R of N received" (the expected part only when there is a date, the
-- received part only when the PO has lines). Archived suppliers are left
-- out, or searched alone with archived = true. POs have no archive: with
-- archived = true there are no PO hits; cancelled and received POs are
-- found normally. Staff only; nothing here is a cost (D60 D-PO-COSTS).

create function private.search_suppliers(q text, max_results integer, archived boolean)
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
      private.search_phone_digits(q) as digits
    from (select private.search_terms(q) as terms) s
  ),
  -- Each branch can use its own trigram index.
  matched as (
    select su.id
    from public.suppliers su, input i
    where pg_catalog.cardinality(i.terms) > 0
      and su.search_text like i.anchor
      and su.search_text like all (i.patterns)
    union
    select su.id
    from public.suppliers su, input i
    where i.digits is not null
      and su.phone_digits like '%' || i.digits || '%'
  )
  select
    'supplier'::text,
    su.id,
    su.name,
    nullif(pg_catalog.concat_ws(' · ', su.contact_name, su.phone, su.email::text), ''),
    null::text,
    greatest(
      case when pg_catalog.lower(su.email::text) = i.lq then 0.95 end,
      case when pg_catalog.length(i.digits) >= 8
            and (su.phone_digits = i.digits or su.phone_digits = '65' || i.digits) then 0.95 end,
      case when i.digits is not null and su.phone_digits like '%' || i.digits || '%' then 0.6 end,
      case when pg_catalog.cardinality(i.terms) > 0 and su.search_text like all (i.patterns)
        then 0.5 + 0.4 * extensions.word_similarity(i.lq, su.search_text) end
    )::real
  from matched m
  join public.suppliers su on su.id = m.id
  cross join input i
  where (su.archived_at is not null) = search_suppliers.archived
  order by 6 desc, 3, 2
  limit max_results;
$$;

-- The supplier reference compared as search keys are (ignoring case, spaces
-- and punctuation); private.search_key is immutable.
create index purchase_orders_supplier_reference_key_idx
  on public.purchase_orders (private.search_key(supplier_reference))
  where supplier_reference is not null;

create function private.search_purchase_orders(q text, max_results integer, archived boolean)
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
      -- Upper-cased letters and digits only: 'po 000002' and 'PO-000002'
      -- are both PO000002.
      private.search_key(q) as key
    from (select private.search_terms(q) as terms) s
  ),
  -- Each branch can use its own index (po_number unique, the supplier
  -- reference key, the supplier's search_text trigram).
  matched as (
    select po.id
    from public.purchase_orders po, input i
    where i.key ~ '^PO[0-9]{6}$'
      and po.po_number = 'PO-' || pg_catalog.substr(i.key, 3)
    union
    select po.id
    from public.purchase_orders po, input i
    where i.key is not null
      and po.supplier_reference is not null
      and private.search_key(po.supplier_reference) = i.key
    union
    select po.id
    from public.purchase_orders po, input i
    where pg_catalog.length(i.key) >= 3
      and pg_catalog.replace(po.po_number, '-', '') like '%' || i.key || '%'
    union
    select po.id
    from public.suppliers su
    join public.purchase_orders po on po.supplier_id = su.id
    cross join input i
    where pg_catalog.cardinality(i.terms) > 0
      and su.search_text like i.anchor
      and su.search_text like all (i.patterns)
  )
  select
    'purchase_order'::text,
    po.id,
    su.name,
    pg_catalog.concat_ws(
      ' · ',
      case po.status
        when 'draft' then 'Draft'
        when 'submitted' then 'Submitted'
        when 'partially_received' then 'Partially received'
        when 'received' then 'Received'
        when 'cancelled' then 'Cancelled'
      end,
      'expected ' || pg_catalog.to_char(po.expected_at, 'FMDD Mon YYYY'),
      case when q_.ordered > 0 then q_.received || ' of ' || q_.ordered || ' received' end
    ),
    po.po_number,
    greatest(
      case when pg_catalog.replace(po.po_number, '-', '') = i.key then 1.0 end,
      case when po.supplier_reference is not null
            and private.search_key(po.supplier_reference) = i.key then 0.95 end,
      case when pg_catalog.length(i.key) >= 3
            and pg_catalog.replace(po.po_number, '-', '') like '%' || i.key || '%' then 0.6 end,
      case when pg_catalog.cardinality(i.terms) > 0 and su.search_text like all (i.patterns)
        then 0.4 + 0.4 * extensions.word_similarity(i.lq, su.search_text) end
    )::real
  from matched m
  join public.purchase_orders po on po.id = m.id
  join public.suppliers su on su.id = po.supplier_id
  cross join input i
  cross join lateral (
    select coalesce(sum(l.quantity_ordered), 0)::integer as ordered,
           coalesce((
             select sum(rl.quantity_received)
             from public.purchase_receipt_lines rl
             join public.purchase_order_lines l2 on l2.id = rl.purchase_order_line_id
             where l2.purchase_order_id = po.id
           ), 0)::integer as received
    from public.purchase_order_lines l
    where l.purchase_order_id = po.id
  ) q_
  -- POs are never archived.
  where not search_purchase_orders.archived
  order by 6 desc, 5 desc, 2
  limit max_results;
$$;

-- Active staff. Blank q returns nothing; kinds null means every kind and
-- an unknown kind raises 22023; max_results is clamped to 1..100; archived
-- true searches archived records only (customers, bikes, products, units,
-- suppliers; jobs and purchase orders are never archived). Phase 3 added
-- `work_order`; Phase 4 `product` and `inventory_unit`; Phase 7 adds
-- `supplier` and `purchase_order`.
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
  known constant text[] := array[
    'customer', 'bike', 'work_order', 'product', 'inventory_unit', 'supplier', 'purchase_order'
  ];
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
      union all
      select * from private.search_suppliers(term, n, coalesce(staff_search.archived, false))
      where staff_search.kinds is null or 'supplier' = any (staff_search.kinds)
      union all
      select * from private.search_purchase_orders(term, n, coalesce(staff_search.archived, false))
      where staff_search.kinds is null or 'purchase_order' = any (staff_search.kinds)
    ) h
    order by h.rank desc, h.kind, h.title, h.id
    limit n;
end;
$$;

comment on function public.staff_search(text, text[], integer, boolean) is
  'Active staff: global search across customers, bikes, jobs, products, units, suppliers and purchase orders (later phases add kinds); exact short ID, serial, SKU, job and PO number first; archived=true searches archived records. MERGE: must contain every staff_search branch on the merged line.';

revoke all on function
  private.search_suppliers(text, integer, boolean),
  private.search_purchase_orders(text, integer, boolean)
from public, anon, authenticated, service_role;

-- create or replace keeps the existing privileges; restated so this file
-- reads complete on its own.
revoke all on function public.staff_search(text, text[], integer, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.staff_search(text, text[], integer, boolean) to authenticated;
