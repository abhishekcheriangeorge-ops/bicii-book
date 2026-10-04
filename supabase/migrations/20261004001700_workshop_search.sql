-- Jobs in the global staff search (SPEC §7.2 "Filters: ... job number",
-- §20 "Global staff search should quickly find customer, bike, job ...";
-- DATA-MODEL.md §16 staff_search; PLAN D9).
--
-- Adds the `work_order` kind the way 20261004001100_staff_search.sql
-- prescribes: a private.search_work_orders function with the staff_search
-- row shape, and staff_search replaced (identical signature) with one more
-- UNION ALL branch and one more known kind.
--
-- Matching: the job number, ignoring case, spaces and dashes.
--   1.0  exact job number ("J-000004", "j000004", "J 000004")
--   0.6  the job number contains q (at least 3 letters or digits, e.g.
--        "000004" or "0004")
-- Every status is searchable, cancelled and collected jobs included. Jobs
-- are never archived, so with archived = true (the Archived lists) the
-- search returns no jobs.
--
-- Hit: title = the bike (brand model variant), subtitle = the customer's
-- label · the first 80 characters of the requested work, short_id = the job
-- number. Staff only (staff_search requires active staff); nothing here is
-- a cost.

create function private.search_work_orders(q text, max_results integer, archived boolean)
returns table (kind text, id uuid, title text, subtitle text, short_id text, rank real)
language sql
stable
set search_path = ''
as $$
  with input as (
    select private.search_key(q) as key
  ),
  -- The exact branch uses the job_number unique index.
  matched as (
    select w.id
    from public.work_orders w, input i
    where i.key is not null
      and w.job_number = pg_catalog.substr(i.key, 1, 1) || '-' || pg_catalog.substr(i.key, 2)
    union
    select w.id
    from public.work_orders w, input i
    where pg_catalog.length(i.key) >= 3
      and pg_catalog.replace(w.job_number, '-', '') like '%' || i.key || '%'
  )
  select
    'work_order'::text,
    w.id,
    b.brand || ' ' || b.model || coalesce(' ' || b.variant, ''),
    nullif(pg_catalog.concat_ws(
      ' · ',
      private.customer_label(c.first_name, c.last_name, c.display_name, c.email::text, c.phone),
      pg_catalog.left(w.requested_work, 80)
    ), ''),
    w.job_number,
    greatest(
      case when w.job_number = pg_catalog.substr(i.key, 1, 1) || '-' || pg_catalog.substr(i.key, 2)
        then 1.0 end,
      case when pg_catalog.length(i.key) >= 3
            and pg_catalog.replace(w.job_number, '-', '') like '%' || i.key || '%' then 0.6 end
    )::real
  from matched m
  join public.work_orders w on w.id = m.id
  join public.bikes b on b.id = w.bike_id
  join public.customers c on c.id = w.customer_id
  cross join input i
  where not search_work_orders.archived
  order by 6 desc, 3, 2
  limit max_results;
$$;

-- Active staff. Blank q returns nothing; kinds null means every kind and
-- an unknown kind raises 22023; max_results is clamped to 1..100; archived
-- true searches archived records only (customers and bikes; jobs are never
-- archived). Phase 3 adds the `work_order` kind.
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
  known constant text[] := array['customer', 'bike', 'work_order'];
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
    ) h
    order by h.rank desc, h.kind, h.title, h.id
    limit n;
end;
$$;

comment on function public.staff_search(text, text[], integer, boolean) is
  'Active staff: global search across customers, bikes and jobs (later phases add kinds); exact short ID, serial and job number first; archived=true searches archived records.';

revoke all on function private.search_work_orders(text, integer, boolean)
  from public, anon, authenticated, service_role;

-- create or replace keeps the existing privileges; restated so this file
-- reads complete on its own.
revoke all on function public.staff_search(text, text[], integer, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.staff_search(text, text[], integer, boolean) to authenticated;
