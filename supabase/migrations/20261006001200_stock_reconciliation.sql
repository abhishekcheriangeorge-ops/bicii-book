-- Stock reconciliation (SPEC §12 "Current stock must be derivable/
-- reconcilable from movements", §23, §26 "stock reconciliation tools";
-- DATA-MODEL.md §14, §15, §16; PLAN D6/D25, D7, D16, D23, D44, D46, D106
-- STOCK-RECONCILIATION; record ADR-022).
--
-- This migration only READS: nothing here changes stock, status or money,
-- and nothing is stored. There is no inventory_balances cache (D106): the
-- movement ledger sum (reporting.stock_levels) is the stock. A future cache
-- must be a trigger-maintained projection that these views also check.
--
-- What is compared (D106):
--   * Each unique unit's cached state (status, location_id, its consignment
--     item's status) with what its own movements say: the per-location
--     nets, the total net and the DISPOSITION of its latest non-transfer
--     movement (a transfer only moves the location).
--   * Each (product, location): the ledger on-hand with the units there
--     that should be in stock (unique products), and unique-product
--     movements that name no unit.
--
-- Phase 4's deferred trigger (private.assert_unit_consistent) already
-- refuses most unit drift at commit, so drift here means the triggers were
-- bypassed (owner SQL in replica mode, a restore, a hand fix) or a check the
-- trigger does not make failed (sale or job disposition versus status, a
-- hold without an open job, consignment item versus unit). Reconciliation
-- never fixes anything: the fix is an existing guarded flow (adjust stock
-- with a reason, restock, settle, void, return), reached by a link. An
-- issue that persists after the right fix is an RPC defect to report with
-- the unit's movement history.
--
-- Disposition (reporting.unit_ledger_disposition), from the unit's LATEST
-- non-transfer movement, ordered by created_at, id:
--   +1 of any type                                   in_stock
--   -1 retail_sale / online_sale                     sold_by_sale
--   -1 job_consumption, live line, job completed_at  sold_by_job
--   -1 job_consumption, live line, job open          held_by_job
--   -1 job_consumption, cancelled job, or a voided
--      line without its reversal                     held_on_closed_job
--   -1 consignment_returned                          returned
--   -1 damaged / stock_adjustment                    written_off
--   -1 of any other type (no RPC writes one)         unexplained_out
--   no movement                                      none
-- A refund writes no movement (D7): a refunded unit stays sold_by_sale until
-- restock_unit's +1 'return' makes it in_stock, whichever sale line still
-- references it.
--
-- Issues (reporting.unit_reconciliation): the FIRST failing check, in order:
--   1 ledger_out_of_range        total net not in {0, 1}, or a location's
--                                net not in {0, 1}
--   2 sale_without_sold_status   sold_by_sale / sold_by_job, status <> sold
--   3 sold_without_sale          status sold, disposition neither of those
--                                (or sold_at null)
--   4 held_without_open_job      status held_for_customer, disposition
--                                <> held_by_job
--   5 in_stock_without_ledger    expected on hand 1, net 0
--   6 ledger_without_stock_status expected on hand 0, net 1
--   7 location_mismatch          expected 1, ledger location <> location_id
--   8 consignment_status_mismatch item sold <-> unit sold; item returned <->
--                                unit returned_to_consignor; item active <->
--                                unit available, reserved or held
-- Product issues (reporting.stock_reconciliation), first failing:
--   negative_on_hand, unique_movement_without_unit, unit_count_mismatch.
--   A unitless movement on a unique product always also shifts the count,
--   so the root cause is named first.
--
-- Access: the views are granted to no API role; the two RPCs are security
-- definer for any active staff member (stock is staff-visible, D30), return
-- no cost column and are read-only.

-- ---------------------------------------------------------------------------
-- The on-hand a unit's status implies: assert_unit_consistent's own rule.
-- ---------------------------------------------------------------------------
create function private.unit_expected_on_hand(s public.unit_status)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when unit_expected_on_hand.s in ('available', 'reserved') then 1
    when unit_expected_on_hand.s is null then null
    else 0
  end;
$$;

comment on function private.unit_expected_on_hand(public.unit_status) is
  'D106: 1 for available and reserved, 0 for held_for_customer, sold, returned_to_consignor and written_off (held nets 0 because job_consumption is written on add, D6/D25). Exactly private.assert_unit_consistent''s rule (tests/db/stock-reconciliation.test.ts proves it for every value).';

-- ---------------------------------------------------------------------------
-- reporting.unit_ledger_disposition: what each unit's movements say.
-- ---------------------------------------------------------------------------
create view reporting.unit_ledger_disposition
with (security_invoker = true)
as
  select
    u.id as unit_id,
    coalesce(n.total_net, 0)::integer as ledger_on_hand,
    n.ledger_location_id,
    coalesce(n.location_nets, '{}'::jsonb) as location_nets,
    coalesce(n.location_out_of_range, false) as location_out_of_range,
    n.last_movement_at,
    d.disposition,
    case
      when d.disposition = 'sold_by_sale' then last.sale_number
      when last.movement_type = 'job_consumption' then last.job_number
    end as disposition_ref,
    last.id as disposition_movement_id
  from public.inventory_units u
  left join lateral (
    select
      sum(s.net)::integer as total_net,
      case when count(*) filter (where s.net = 1) = 1
           then (pg_catalog.array_agg(s.location_id) filter (where s.net = 1))[1] end as ledger_location_id,
      pg_catalog.jsonb_object_agg(s.location_id::text, s.net) as location_nets,
      bool_or(s.net not in (0, 1)) as location_out_of_range,
      max(s.last_at) as last_movement_at
    from (
      select m.location_id, sum(m.quantity_delta) as net, max(m.created_at) as last_at
      from public.inventory_movements m
      where m.inventory_unit_id = u.id
      group by m.location_id
    ) s
  ) n on true
  -- The latest non-transfer movement, with its job line or sale line (one
  -- row per unit, joined by key).
  left join lateral (
    select m.id,
           m.quantity_delta,
           m.movement_type,
           li.voided_at as line_voided_at,
           wo.completed_at as job_completed_at,
           wo.status as job_status,
           wo.job_number::text as job_number,
           sa.sale_number::text as sale_number
    from public.inventory_movements m
    left join public.work_order_line_items li
      on li.id = m.work_order_line_item_id and m.movement_type = 'job_consumption'
    left join public.work_orders wo on wo.id = li.work_order_id
    left join public.sale_lines sl
      on sl.id = m.sale_line_id and m.movement_type in ('retail_sale', 'online_sale')
    left join public.sales sa on sa.id = sl.sale_id
    where m.inventory_unit_id = u.id
      and m.movement_type <> 'transfer'
    order by m.created_at desc, m.id desc
    limit 1
  ) last on true
  cross join lateral (
    select case
      when last.id is null then 'none'
      when last.quantity_delta > 0 then 'in_stock'
      when last.movement_type in ('retail_sale', 'online_sale') then 'sold_by_sale'
      when last.movement_type = 'job_consumption' then
        case
          when last.line_voided_at is null and last.job_completed_at is not null then 'sold_by_job'
          when last.line_voided_at is null and private.work_order_status_is_open(last.job_status) then 'held_by_job'
          else 'held_on_closed_job'
        end
      when last.movement_type = 'consignment_returned' then 'returned'
      when last.movement_type in ('damaged', 'stock_adjustment') then 'written_off'
      else 'unexplained_out'
    end::text as disposition
  ) d;

comment on view reporting.unit_ledger_disposition is
  'D106: one row per unique unit from its own movements: per-location nets (location_nets), the total net (ledger_on_hand), the single location whose net is +1 (ledger_location_id, else NULL), whether a location nets outside {0, 1}, the last movement time, and the disposition of the LATEST non-transfer movement (created_at, id): in_stock (+1), sold_by_sale, sold_by_job (live line, job completed), held_by_job (live line, open job), held_on_closed_job (cancelled job, or a voided line without its reversal), returned, written_off, unexplained_out (any other -1) or none; disposition_ref = the S- or J- number. Derived, never stored; no API grant.';

-- ---------------------------------------------------------------------------
-- reporting.unit_reconciliation: one row per unit, the first failing check.
-- ---------------------------------------------------------------------------
create view reporting.unit_reconciliation
with (security_invoker = true)
as
  select
    u.id as unit_id,
    u.short_id::text as unit_short_id,
    u.product_id,
    u.status,
    u.location_id,
    d.ledger_on_hand,
    d.ledger_location_id,
    e.expected_on_hand,
    d.disposition,
    d.disposition_ref,
    d.last_movement_at,
    c.issue,
    case c.issue
      when 'ledger_out_of_range' then
        pg_catalog.format(
          'The ledger nets %s for this unit (by location: %s); a unit nets 0 or 1, at one location at most.',
          d.ledger_on_hand, d.location_nets::text
        )
      when 'sale_without_sold_status' then
        pg_catalog.format('Status %s; the ledger says %s.', u.status, ph.phrase)
      when 'sold_without_sale' then
        pg_catalog.format('Status sold; the ledger says %s.', ph.phrase)
      when 'held_without_open_job' then
        pg_catalog.format('Status held_for_customer; the ledger says %s.', ph.phrase)
      when 'in_stock_without_ledger' then
        pg_catalog.format('Status %s; the ledger has the unit nowhere (net 0, %s).', u.status, ph.phrase)
      when 'ledger_without_stock_status' then
        pg_catalog.format(
          'Status %s; the ledger still has the unit in stock at %s.', u.status,
          coalesce(lloc.name, 'an unknown location')
        )
      when 'location_mismatch' then
        pg_catalog.format(
          'The unit is recorded at %s; the ledger has it at %s.', loc.name,
          coalesce(lloc.name, 'no single location')
        )
      when 'consignment_status_mismatch' then
        pg_catalog.format('Consignment item %s is %s; the unit is %s.', ci.short_id, ci.status, u.status)
    end::text as issue_detail
  from public.inventory_units u
  join reporting.unit_ledger_disposition d on d.unit_id = u.id
  join public.locations loc on loc.id = u.location_id
  left join public.locations lloc on lloc.id = d.ledger_location_id
  left join public.consignment_items ci on ci.id = u.consignment_item_id and ci.inventory_unit_id = u.id
  cross join lateral (select private.unit_expected_on_hand(u.status) as expected_on_hand) e
  cross join lateral (
    select case d.disposition
      when 'in_stock' then 'in stock'
      when 'sold_by_sale' then 'sold by ' || coalesce(d.disposition_ref, 'a sale')
      when 'sold_by_job' then 'sold on ' || coalesce(d.disposition_ref, 'a job')
      when 'held_by_job' then 'held on ' || coalesce(d.disposition_ref, 'a job')
      when 'held_on_closed_job' then 'consumed on ' || coalesce(d.disposition_ref, 'a job') || ', which is closed or whose line is voided'
      when 'returned' then 'returned to its consignor'
      when 'written_off' then 'written off'
      when 'unexplained_out' then 'taken out of stock'
      else 'no movement'
    end::text as phrase
  ) ph
  cross join lateral (
    select case
      when d.ledger_on_hand not in (0, 1) or d.location_out_of_range then 'ledger_out_of_range'
      when d.disposition in ('sold_by_sale', 'sold_by_job') and u.status <> 'sold' then 'sale_without_sold_status'
      when u.status = 'sold' and (d.disposition not in ('sold_by_sale', 'sold_by_job') or u.sold_at is null)
        then 'sold_without_sale'
      when u.status = 'held_for_customer' and d.disposition <> 'held_by_job' then 'held_without_open_job'
      when e.expected_on_hand = 1 and d.ledger_on_hand = 0 then 'in_stock_without_ledger'
      when e.expected_on_hand = 0 and d.ledger_on_hand = 1 then 'ledger_without_stock_status'
      when e.expected_on_hand = 1 and d.ledger_location_id is distinct from u.location_id then 'location_mismatch'
      when ci.id is not null and not (
        case ci.status
          when 'sold' then u.status = 'sold'
          when 'returned' then u.status = 'returned_to_consignor'
          when 'active' then u.status in ('available', 'reserved', 'held_for_customer')
          else true
        end
      ) then 'consignment_status_mismatch'
    end::text as issue
  ) c;

comment on view reporting.unit_reconciliation is
  'D106: one row per unique unit: its cached status and location against reporting.unit_ledger_disposition, the on-hand its status implies (private.unit_expected_on_hand), and issue = the FIRST failing check (ledger_out_of_range, sale_without_sold_status, sold_without_sale, held_without_open_job, in_stock_without_ledger, ledger_without_stock_status, location_mismatch, consignment_status_mismatch; NULL when consistent) with issue_detail, one plain sentence. Read-only; no API grant: read through public.report_unit_reconciliation and the operational exceptions.';

-- ---------------------------------------------------------------------------
-- reporting.stock_reconciliation: one row per (product, location).
-- ---------------------------------------------------------------------------
create view reporting.stock_reconciliation
with (security_invoker = true)
as
  -- The ledger is summed once (reporting.stock_levels, materialised as a
  -- CTE because it is read twice).
  with sl as materialized (
    select l.product_id, l.location_id, l.on_hand, l.last_movement_at from reporting.stock_levels l
  ),
  pairs as (
    select sl.product_id, sl.location_id from sl
    union
    select u.product_id, u.location_id from public.inventory_units u
  )
  select
    pr.product_id,
    pr.location_id,
    p.tracking_type,
    coalesce(sl.on_hand, 0)::integer as ledger_on_hand,
    case when p.tracking_type = 'unique' then coalesce(uc.units_in_stock, 0) end::integer as units_in_stock,
    sl.last_movement_at,
    case
      when coalesce(sl.on_hand, 0) < 0 then 'negative_on_hand'
      when p.tracking_type = 'unique' and exists (
        select 1 from public.inventory_movements m
        where m.product_id = pr.product_id
          and m.location_id = pr.location_id
          and m.inventory_unit_id is null
      ) then 'unique_movement_without_unit'
      when p.tracking_type = 'unique' and coalesce(sl.on_hand, 0) <> coalesce(uc.units_in_stock, 0)
        then 'unit_count_mismatch'
    end::text as issue
  from pairs pr
  join public.products p on p.id = pr.product_id
  left join sl on sl.product_id = pr.product_id and sl.location_id = pr.location_id
  left join lateral (
    select count(*)::integer as units_in_stock
    from public.inventory_units u
    where u.product_id = pr.product_id
      and u.location_id = pr.location_id
      and private.unit_expected_on_hand(u.status) = 1
  ) uc on p.tracking_type = 'unique';

comment on view reporting.stock_reconciliation is
  'D106: one row per (product, location) with a movement or a unit: the ledger on-hand (reporting.stock_levels), for unique products the units there whose status implies on-hand 1 (units_in_stock; NULL for quantity products), and issue = negative_on_hand (ledger < 0), unique_movement_without_unit (a unique-product movement naming no unit) or unit_count_mismatch (unique: ledger <> units_in_stock), first failing; NULL when consistent. Read-only; no API grant: read through public.report_stock_reconciliation and the operational exceptions.';

-- ---------------------------------------------------------------------------
-- RPCs (any active staff member; read-only; no cost column)
-- ---------------------------------------------------------------------------
create function public.report_stock_reconciliation(
  p_only_issues boolean default true,
  p_product_id uuid default null,
  p_max_rows integer default 500
)
returns table (
  product_id uuid,
  product_short_id text,
  product_name text,
  tracking_type public.tracking_type,
  location_id uuid,
  location_name text,
  ledger_on_hand integer,
  units_in_stock integer,
  issue text
)
language plpgsql
stable
security definer
set search_path = ''
-- The views are wide joins the planner prices high enough to JIT-compile
-- on every call; compiling costs more than it saves at the shop's volume
-- (scripts/bench/report-volume.sql, DATA-MODEL §14).
set jit = off
as $$
begin
  perform private.require_staff();

  return query
    select
      sr.product_id,
      p.short_id::text,
      p.name::text,
      sr.tracking_type,
      sr.location_id,
      loc.name::text,
      sr.ledger_on_hand,
      sr.units_in_stock,
      sr.issue
    from reporting.stock_reconciliation sr
    join public.products p on p.id = sr.product_id
    join public.locations loc on loc.id = sr.location_id
    where (not coalesce(report_stock_reconciliation.p_only_issues, true) or sr.issue is not null)
      and (report_stock_reconciliation.p_product_id is null or sr.product_id = report_stock_reconciliation.p_product_id)
    order by (sr.issue is null), p.name, loc.name, sr.product_id, sr.location_id
    limit greatest(1, least(coalesce(report_stock_reconciliation.p_max_rows, 500), 1000));
end;
$$;

comment on function public.report_stock_reconciliation(boolean, uuid, integer) is
  'Active staff (D106): reporting.stock_reconciliation with product and location names, issues first, then product name and location name; p_only_issues (default true) keeps rows with an issue; p_product_id narrows to one product; p_max_rows clamped to 1..1000 (default 500). Read-only; no cost column.';

create function public.report_unit_reconciliation(
  p_only_issues boolean default true,
  p_product_id uuid default null,
  p_max_rows integer default 500
)
returns table (
  unit_id uuid,
  unit_short_id text,
  product_id uuid,
  product_name text,
  status public.unit_status,
  location_id uuid,
  location_name text,
  ledger_on_hand integer,
  ledger_location_id uuid,
  ledger_location_name text,
  expected_on_hand integer,
  disposition text,
  disposition_ref text,
  issue text,
  issue_detail text,
  last_movement_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
-- The views are wide joins the planner prices high enough to JIT-compile
-- on every call; compiling costs more than it saves at the shop's volume
-- (scripts/bench/report-volume.sql, DATA-MODEL §14).
set jit = off
as $$
begin
  perform private.require_staff();

  return query
    select
      ur.unit_id,
      ur.unit_short_id,
      ur.product_id,
      p.name::text,
      ur.status,
      ur.location_id,
      loc.name::text,
      ur.ledger_on_hand,
      ur.ledger_location_id,
      lloc.name::text,
      ur.expected_on_hand,
      ur.disposition,
      ur.disposition_ref,
      ur.issue,
      ur.issue_detail,
      ur.last_movement_at
    from reporting.unit_reconciliation ur
    join public.products p on p.id = ur.product_id
    join public.locations loc on loc.id = ur.location_id
    left join public.locations lloc on lloc.id = ur.ledger_location_id
    where (not coalesce(report_unit_reconciliation.p_only_issues, true) or ur.issue is not null)
      and (report_unit_reconciliation.p_product_id is null or ur.product_id = report_unit_reconciliation.p_product_id)
    order by (ur.issue is null), p.name, loc.name, ur.unit_short_id
    limit greatest(1, least(coalesce(report_unit_reconciliation.p_max_rows, 500), 1000));
end;
$$;

comment on function public.report_unit_reconciliation(boolean, uuid, integer) is
  'Active staff (D106): reporting.unit_reconciliation with product and location names, issues first, then product name, location name and unit short ID; p_only_issues (default true), p_product_id, p_max_rows clamped to 1..1000 (default 500). Read-only; no cost column. The fix is always an existing guarded flow, never automatic.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on table
  reporting.unit_ledger_disposition,
  reporting.unit_reconciliation,
  reporting.stock_reconciliation
from public, anon, authenticated, service_role;

revoke all on function
  private.unit_expected_on_hand(public.unit_status),
  public.report_stock_reconciliation(boolean, uuid, integer),
  public.report_unit_reconciliation(boolean, uuid, integer)
from public, anon, authenticated, service_role;

grant execute on function
  public.report_stock_reconciliation(boolean, uuid, integer),
  public.report_unit_reconciliation(boolean, uuid, integer)
to authenticated;
