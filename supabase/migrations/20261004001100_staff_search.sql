-- Global staff search (SPEC §5 "Search by customer, brand/model, serial
-- number and BICII ID", §20; DATA-MODEL.md §16).
--
-- staff_search(q, kinds, max_results) returns typed hits
-- (kind, id, title, subtitle, short_id, rank) across every kind of record
-- staff look up. Phase 1 knows `customer` and `bike`; each later phase adds
-- its kind (work_order, product, inventory_unit, supplier, consignor, ...)
-- by writing a private.search_<kind>(q, max_results) function with the same
-- result columns and replacing staff_search with one more UNION ALL branch
-- and one more entry in its list of kinds.
--
-- Matching (all case-insensitive, LIKE metacharacters in q are literal):
--   customer  every word of q in first/last/display name or email; or q's
--             digits inside the phone number (q made only of digits and
--             phone punctuation, at least 3 digits; a leading +65 is
--             ignored).
--   bike      short ID or serial number, ignoring case, spaces and dashes
--             (exact or contained, at least 3 characters); or every word of
--             q in brand/model/variant/colour plus the owner's name.
-- Ranking (higher first; ties by kind, then title):
--   1.0        exact short ID or exact serial number
--   0.95       exact email or exact phone number
--   0.7 / 0.6  serial number / short ID contains q
--   0.5–0.9    customer name/email words, by trigram word similarity
--   0.45–0.85  bike words, by trigram word similarity
-- Archived customers and bikes are not returned.

-- Lower-cased words of q, longest first, at most 8.
create function private.search_terms(q text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(w.word order by pg_catalog.length(w.word) desc, w.word), '{}')
  from (
    select distinct t.word
    from pg_catalog.regexp_split_to_table(pg_catalog.lower(pg_catalog.btrim(coalesce(q, ''))), '\s+') as t(word)
    where t.word <> ''
    limit 8
  ) w;
$$;

-- q as a LIKE pattern matching it anywhere, with its own % _ \ literal.
create function private.contains_pattern(q text)
returns text
language sql
immutable
set search_path = ''
as $$
  select '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
$$;

-- q's digits when q looks like a phone number (digits and + ( ) - . and
-- spaces only) with at least 3 digits, without a leading Singapore country
-- code (65 followed by 8 digits); else null.
create function private.search_phone_digits(q text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when s.digits is null or pg_catalog.length(s.digits) < 3 then null
    when pg_catalog.length(s.digits) = 10 and s.digits like '65%' then pg_catalog.substr(s.digits, 3)
    else s.digits
  end
  from (
    select case
      when pg_catalog.btrim(coalesce(q, '')) ~ '^[-+0-9 ().]+$'
        then pg_catalog.regexp_replace(q, '[^0-9]', '', 'g')
    end as digits
  ) s;
$$;

-- q upper-cased without anything but letters and digits: how short IDs and
-- serial numbers are compared (bikes.serial_key is built the same way).
create function private.search_key(q text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(pg_catalog.upper(pg_catalog.regexp_replace(coalesce(q, ''), '[^A-Za-z0-9]', '', 'g')), '');
$$;

create function private.search_customers(q text, max_results integer)
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
    select c.id
    from public.customers c, input i
    where pg_catalog.cardinality(i.terms) > 0
      and c.search_text like i.anchor
      and c.search_text like all (i.patterns)
    union
    select c.id
    from public.customers c, input i
    where i.digits is not null
      and c.phone_digits like '%' || i.digits || '%'
  )
  select
    'customer'::text,
    c.id,
    private.customer_label(c.first_name, c.last_name, c.display_name, c.email::text, c.phone),
    nullif(pg_catalog.concat_ws(' · ', c.email::text, c.phone), ''),
    c.short_id,
    greatest(
      case when pg_catalog.lower(c.email::text) = i.lq then 0.95 end,
      case when pg_catalog.length(i.digits) >= 8
            and (c.phone_digits = i.digits or c.phone_digits = '65' || i.digits) then 0.95 end,
      case when i.digits is not null and c.phone_digits like '%' || i.digits || '%' then 0.6 end,
      case when pg_catalog.cardinality(i.terms) > 0 and c.search_text like all (i.patterns)
        then 0.5 + 0.4 * extensions.word_similarity(i.lq, c.search_text) end
    )::real
  from matched m
  join public.customers c on c.id = m.id
  cross join input i
  where c.archived_at is null
  order by 6 desc, 3, 2
  limit max_results;
$$;

create function private.search_bikes(q text, max_results integer)
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
  -- Each branch can use its own index; words may span bike and owner.
  matched as (
    select b.id
    from public.bikes b, input i
    where i.key is not null
      and (b.short_id = pg_catalog.substr(i.key, 1, 1) || '-' || pg_catalog.substr(i.key, 2)
           or b.serial_key = i.key)
    union
    select b.id
    from public.bikes b, input i
    where pg_catalog.length(i.key) >= 3
      and b.serial_key like '%' || i.key || '%'
    union
    select b.id
    from public.bikes b, input i
    where pg_catalog.length(i.key) >= 3
      and pg_catalog.replace(b.short_id, '-', '') like '%' || i.key || '%'
    union
    select b.id
    from public.bikes b
    left join public.customers c on c.id = b.customer_id
    cross join input i
    where pg_catalog.cardinality(i.terms) > 0
      and b.search_text like i.anchor
      and (b.search_text || ' ' || coalesce(c.search_text, '')) like all (i.patterns)
    union
    select b.id
    from public.customers c
    join public.bikes b on b.customer_id = c.id
    cross join input i
    where pg_catalog.cardinality(i.terms) > 0
      and c.search_text like i.anchor
      and (b.search_text || ' ' || c.search_text) like all (i.patterns)
  )
  select
    'bike'::text,
    b.id,
    b.brand || ' ' || b.model || coalesce(' ' || b.variant, ''),
    pg_catalog.concat_ws(
      ' · ',
      case
        when c.id is null then 'Shop bike'
        else private.customer_label(c.first_name, c.last_name, c.display_name, c.email::text, c.phone)
      end,
      b.colour,
      'S/N ' || b.serial_number
    ),
    b.short_id,
    greatest(
      case when pg_catalog.replace(b.short_id, '-', '') = i.key then 1.0 end,
      case when b.serial_key = i.key then 1.0 end,
      case when pg_catalog.length(i.key) >= 3 and b.serial_key like '%' || i.key || '%' then 0.7 end,
      case when pg_catalog.length(i.key) >= 3
            and pg_catalog.replace(b.short_id, '-', '') like '%' || i.key || '%' then 0.6 end,
      case when pg_catalog.cardinality(i.terms) > 0
            and (b.search_text || ' ' || coalesce(c.search_text, '')) like all (i.patterns)
        then 0.45 + 0.4 * extensions.word_similarity(i.lq, b.search_text || ' ' || coalesce(c.search_text, '')) end
    )::real
  from matched m
  join public.bikes b on b.id = m.id
  left join public.customers c on c.id = b.customer_id
  cross join input i
  where b.archived_at is null
  order by 6 desc, 3, 2
  limit max_results;
$$;

-- Active staff. Blank q returns nothing; kinds null means every kind and
-- an unknown kind raises 22023; max_results is clamped to 1..100.
create function public.staff_search(q text, kinds text[] default null, max_results integer default 20)
returns table (kind text, id uuid, title text, subtitle text, short_id text, rank real)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  term text := pg_catalog.left(pg_catalog.btrim(coalesce(staff_search.q, '')), 200);
  n integer := greatest(1, least(coalesce(staff_search.max_results, 20), 100));
  known constant text[] := array['customer', 'bike'];
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
      select * from private.search_customers(term, n)
      where staff_search.kinds is null or 'customer' = any (staff_search.kinds)
      union all
      select * from private.search_bikes(term, n)
      where staff_search.kinds is null or 'bike' = any (staff_search.kinds)
    ) h
    order by h.rank desc, h.kind, h.title, h.id
    limit n;
end;
$$;

comment on function public.staff_search(text, text[], integer) is
  'Active staff: global search across customers and bikes (later phases add kinds); exact short ID and serial first.';

revoke all on function
  private.search_terms(text),
  private.contains_pattern(text),
  private.search_phone_digits(text),
  private.search_key(text),
  private.search_customers(text, integer),
  private.search_bikes(text, integer)
from public, anon, authenticated, service_role;

revoke all on function public.staff_search(text, text[], integer)
  from public, anon, authenticated, service_role;
grant execute on function public.staff_search(text, text[], integer) to authenticated;
