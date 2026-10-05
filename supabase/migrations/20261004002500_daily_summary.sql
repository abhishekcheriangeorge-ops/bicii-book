-- The daily summary and the operational exceptions (SPEC §12, §19.1 "Daily
-- dashboard", §19.2, §23 "Every manual stock adjustment records actor,
-- timestamp and reason"; DATA-MODEL.md §14; PLAN D1, D20, D23, D25, D31
-- TODAY-TILES, D32 RECOGNITION, D33 SIGNIFICANT-ADJ, D34 EXCEPTIONS, D35
-- SHOP-TZ).
--
-- `reporting` holds views only: everything here is derived from the source
-- records (work orders, reporting.financial_lines, the stock ledger) and
-- never stored (SPEC §19.2). Both views are security_invoker and granted to
-- NO API role; the app reads them through the Phase 5 RPCs, which gate
-- money by D30 FIN-ACCESS.

-- ---------------------------------------------------------------------------
-- D33 SIGNIFICANT-ADJ. The one place the rule lives; Phase 9 or shop
-- settings may replace it (create or replace, same signature).
-- ---------------------------------------------------------------------------
create function private.is_significant_adjustment(
  movement_type public.movement_type,
  quantity_delta integer,
  is_unit boolean,
  unit_cost numeric
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    is_significant_adjustment.movement_type in ('stock_adjustment', 'damaged')
    and (
      pg_catalog.abs(is_significant_adjustment.quantity_delta) >= 5
      or coalesce(is_significant_adjustment.is_unit, false)
      or pg_catalog.abs(is_significant_adjustment.quantity_delta)
           * coalesce(is_significant_adjustment.unit_cost, 0) >= 100.00
    ),
    false
  );
$$;

comment on function private.is_significant_adjustment(public.movement_type, integer, boolean, numeric) is
  'D33 SIGNIFICANT-ADJ: a stock_adjustment or damaged movement with |delta| >= 5, or on a unique unit, or |delta| x unit cost >= 100.00 (unit cost = snapshot, else the product default, else 0). False for every other movement type.';

revoke all on function private.is_significant_adjustment(public.movement_type, integer, boolean, numeric)
from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- reporting.daily_summary
-- ---------------------------------------------------------------------------
-- One row per shop day from the earliest activity day (work order check-in,
-- recognised entry or stock movement; today when there is none) up to
-- private.shop_today(), zero-filled.
--
-- Columns 1-27 are a contract: names, types and order never change.
--   * Job flows (D31): the jobs whose CURRENT stamp falls on that shop day.
--   * Money (D32): shop-currency financial_lines entries by recognized_day;
--     Cult Commons is the SUM of entry shares (D1), so it is never negative;
--     loss_total is the sum of loss entries' yield (<= 0).
--   * Parts and adjustments from the ledger by the movement's shop day;
--     significant per D33.
--   * Placeholders (NULL now):
--       22 appointments_scheduled, 23 appointments_arrived,
--       24 appointments_no_show: Phase 2 fills exactly these three by create
--       or replace of this view, from its reporting.appointment_daily:
--       non-cancelled appointments whose starts_at falls on that shop day;
--       of those, the ones whose CURRENT status is arrived, checked_in or
--       completed; and the ones whose CURRENT status is no_show. Phase 2
--       may extend the series end so future days with appointments appear.
--       25 consignment_sales, 26 consignment_sales_total,
--       27 new_consignor_liability: Phase 6 fills them under these names.
--   * Phase 9 may append new measures only AFTER column 27.
create view reporting.daily_summary
with (security_invoker = true)
as
  with
  job_flows as (
    select f.day,
           (count(*) filter (where f.kind = 'checked_in'))::integer as jobs_checked_in,
           (count(*) filter (where f.kind = 'started'))::integer as jobs_started,
           (count(*) filter (where f.kind = 'completed'))::integer as jobs_completed,
           (count(*) filter (where f.kind = 'ready_for_collection'))::integer as jobs_ready_for_collection,
           (count(*) filter (where f.kind = 'collected'))::integer as jobs_collected,
           (count(*) filter (where f.kind = 'cancelled'))::integer as jobs_cancelled
    from public.work_orders wo
    cross join lateral (
      values
        ('checked_in'::text, private.shop_day(wo.checked_in_at)),
        ('started', private.shop_day(wo.started_at)),
        ('completed', private.shop_day(wo.completed_at)),
        ('ready_for_collection', private.shop_day(wo.ready_for_collection_at)),
        ('collected', private.shop_day(wo.collected_at)),
        ('cancelled', private.shop_day(wo.cancelled_at))
    ) f(kind, day)
    where f.day is not null
    group by f.day
  ),
  money as (
    select fl.recognized_day as day,
           count(*)::integer as lines_recognised,
           sum(fl.sale_total)::numeric as gross_sales,
           sum(fl.cost_total)::numeric as cogs,
           sum(fl.yield_total)::numeric as yield_total,
           -- D1: the sum of the entries' own shares.
           sum(fl.cult_commons_share)::numeric as cult_commons_share,
           sum(fl.bicii_yield_after_cc)::numeric as bicii_yield_after_cc,
           (count(*) filter (where fl.is_loss))::integer as loss_lines,
           coalesce(sum(fl.yield_total) filter (where fl.is_loss), 0)::numeric as loss_total
    from reporting.financial_lines fl
    where fl.currency = private.shop_currency()
    group by fl.recognized_day
  ),
  stock as (
    select private.shop_day(m.created_at) as day,
           (-coalesce(sum(m.quantity_delta) filter (where m.movement_type = 'job_consumption'), 0))::integer
             as parts_consumed_qty,
           (count(distinct m.work_order_line_item_id) filter (where m.movement_type = 'job_consumption'))::integer
             as parts_consumed_lines,
           coalesce(
             sum(m.quantity_delta) filter (where m.movement_type = 'reversal' and o.movement_type = 'job_consumption'),
             0
           )::integer as parts_returned_qty,
           (count(*) filter (where m.movement_type in ('stock_adjustment', 'damaged')))::integer as stock_adjustments,
           (count(*) filter (
             where private.is_significant_adjustment(
               m.movement_type,
               m.quantity_delta,
               m.inventory_unit_id is not null,
               coalesce(m.unit_cost_snapshot, p.default_direct_cost, 0)::numeric
             )
           ))::integer as significant_stock_adjustments
    from public.inventory_movements m
    join public.products p on p.id = m.product_id
    left join public.inventory_movements o on o.id = m.reversal_of_id
    group by private.shop_day(m.created_at)
  ),
  bounds as (
    -- least() ignores nulls; today when there is no activity at all.
    select least(
             (select private.shop_day(min(wo.checked_in_at)) from public.work_orders wo),
             (select private.shop_day(min(fl.recognized_at)) from reporting.financial_lines fl),
             (select private.shop_day(min(m.created_at)) from public.inventory_movements m),
             private.shop_today()
           ) as first_day,
           private.shop_today() as last_day
  ),
  days as (
    select g.ts::date as day
    from bounds b
    cross join lateral pg_catalog.generate_series(
      b.first_day::timestamp, b.last_day::timestamp, interval '1 day'
    ) g(ts)
  )
  select
    d.day,
    coalesce(j.jobs_checked_in, 0)::integer as jobs_checked_in,
    coalesce(j.jobs_started, 0)::integer as jobs_started,
    coalesce(j.jobs_completed, 0)::integer as jobs_completed,
    coalesce(j.jobs_ready_for_collection, 0)::integer as jobs_ready_for_collection,
    coalesce(j.jobs_collected, 0)::integer as jobs_collected,
    coalesce(j.jobs_cancelled, 0)::integer as jobs_cancelled,
    private.shop_currency()::text as currency,
    coalesce(mo.lines_recognised, 0)::integer as lines_recognised,
    coalesce(mo.gross_sales, 0)::numeric as gross_sales,
    coalesce(mo.cogs, 0)::numeric as cogs,
    coalesce(mo.yield_total, 0)::numeric as yield_total,
    coalesce(mo.cult_commons_share, 0)::numeric as cult_commons_share,
    coalesce(mo.bicii_yield_after_cc, 0)::numeric as bicii_yield_after_cc,
    coalesce(mo.loss_lines, 0)::integer as loss_lines,
    coalesce(mo.loss_total, 0)::numeric as loss_total,
    coalesce(s.parts_consumed_qty, 0)::integer as parts_consumed_qty,
    coalesce(s.parts_consumed_lines, 0)::integer as parts_consumed_lines,
    coalesce(s.parts_returned_qty, 0)::integer as parts_returned_qty,
    coalesce(s.stock_adjustments, 0)::integer as stock_adjustments,
    coalesce(s.significant_stock_adjustments, 0)::integer as significant_stock_adjustments,
    null::integer as appointments_scheduled,
    null::integer as appointments_arrived,
    null::integer as appointments_no_show,
    null::integer as consignment_sales,
    null::numeric as consignment_sales_total,
    null::numeric as new_consignor_liability
  from days d
  left join job_flows j on j.day = d.day
  left join money mo on mo.day = d.day
  left join stock s on s.day = d.day;

comment on view reporting.daily_summary is
  'One row per shop day (D35) from the earliest activity up to today, zero-filled: job flows by current stamp (D31), shop-currency money from financial_lines with Cult Commons = sum of entry shares (D1, D32), parts and adjustments from the ledger (significant per D33). Columns 1-27 are fixed: Phase 2 fills appointments_scheduled/arrived/no_show (non-cancelled appointments starting that shop day; of those, current status arrived/checked_in/completed; current status no_show) by replacing this view and may extend the series end; Phase 6 fills consignment_sales, consignment_sales_total, new_consignor_liability; new measures are appended only after column 27. No API grants: read through public.daily_summary / today_dashboard (D30).';

-- ---------------------------------------------------------------------------
-- reporting.operational_exceptions (D34 EXCEPTIONS)
-- ---------------------------------------------------------------------------
-- Columns (in order; Phase 9 appends issue, short_id, title, detail,
-- amount, currency after them): kind, severity ('danger' | 'warning'),
-- entity_type ('work_order', 'product', 'inventory_unit',
-- 'work_order_line'), entity_id, entity_label, subject_label, days,
-- quantity, since.
--
-- Kinds (text; Phases 6, 9 and 10 append unit_state_mismatch,
-- unsettled_consignment, integration_failed ... by replacing the view with
-- these columns first):
--   overdue_job       D20 exactly: open and now() - checked_in_at >
--                     interval '7 days' (strictly; 7 must equal
--                     OVERDUE_AFTER_DAYS in src/lib/workshop.ts).
--   uncollected_job   completed or ready_for_collection, completed >= 7
--                     shop days ago.
--   negative_stock    a product/location with on-hand < 0 (D23).
--   unit_hold_stale   a held_for_customer unit with no live inventory line
--                     on an OPEN job (D6/D25).
--   currency_mismatch a line that would be recognised but is not in the
--                     shop currency (excluded from totals, D35).
create view reporting.operational_exceptions
with (security_invoker = true)
as
  select 'overdue_job'::text as kind,
         'warning'::text as severity,
         'work_order'::text as entity_type,
         a.work_order_id as entity_id,
         a.job_number as entity_label,
         pg_catalog.concat_ws(
           ' · ',
           private.customer_label(c.first_name, c.last_name, c.display_name, c.email::text, c.phone),
           b.brand || ' ' || b.model || coalesce(' ' || b.variant, '')
         )::text as subject_label,
         a.age_days as days,
         null::integer as quantity,
         a.checked_in_at as since
  from reporting.work_order_activity a
  join public.customers c on c.id = a.customer_id
  join public.bikes b on b.id = a.bike_id
  where a.is_overdue

  union all

  select 'uncollected_job'::text,
         'warning'::text,
         'work_order'::text,
         a.work_order_id,
         a.job_number,
         pg_catalog.concat_ws(
           ' · ',
           private.customer_label(c.first_name, c.last_name, c.display_name, c.email::text, c.phone),
           b.brand || ' ' || b.model || coalesce(' ' || b.variant, '')
         )::text,
         a.days_awaiting_collection,
         null::integer,
         a.completed_at
  from reporting.work_order_activity a
  join public.customers c on c.id = a.customer_id
  join public.bikes b on b.id = a.bike_id
  where a.status in ('completed', 'ready_for_collection')
    and a.days_awaiting_collection >= 7

  union all

  select 'negative_stock'::text,
         'danger'::text,
         'product'::text,
         p.id,
         p.short_id::text,
         (p.name || ' · ' || loc.name)::text,
         null::integer,
         sl.on_hand,
         sl.last_movement_at
  from reporting.stock_levels sl
  join public.products p on p.id = sl.product_id
  join public.locations loc on loc.id = sl.location_id
  where sl.on_hand < 0

  union all

  select 'unit_hold_stale'::text,
         'danger'::text,
         'inventory_unit'::text,
         u.id,
         u.short_id::text,
         p.name::text,
         (private.shop_today() - private.shop_day(h.since))::integer,
         null::integer,
         h.since
  from public.inventory_units u
  join public.products p on p.id = u.product_id
  cross join lateral (
    select coalesce(
             (select max(e.created_at)
                from public.inventory_unit_events e
               where e.unit_id = u.id and e.event_type = 'status_changed'),
             u.updated_at
           ) as since
  ) h
  where u.status = 'held_for_customer'
    and not exists (
      select 1
      from public.work_order_line_items li
      join public.work_orders wo on wo.id = li.work_order_id
      where li.source_inventory_unit_id = u.id
        and li.voided_at is null
        and li.line_type = 'inventory'
        and private.work_order_status_is_open(wo.status)
    )

  union all

  select 'currency_mismatch'::text,
         'danger'::text,
         'work_order_line'::text,
         l.id,
         wo.job_number::text,
         (l.description_snapshot || ' · ' || l.currency)::text,
         null::integer,
         null::integer,
         wo.completed_at
  from public.work_order_line_items l
  join public.work_orders wo on wo.id = l.work_order_id
  where wo.completed_at is not null
    and l.voided_at is null
    and l.currency::text <> private.shop_currency();

comment on view reporting.operational_exceptions is
  'Operational exceptions (D34): overdue_job (D20: open and now() - checked_in_at > 7 days; 7 = OVERDUE_AFTER_DAYS in src/lib/workshop.ts), uncollected_job (completed or ready >= 7 shop days), negative_stock, unit_hold_stale (held unit with no live line on an open job), currency_mismatch (would-be-recognised line not in the shop currency). Kinds are text; Phases 6, 9 and 10 append kinds (and Phase 9 columns at the end) by replacing the view. No API grants: read through public.operational_exceptions.';

revoke all on table reporting.daily_summary from public, anon, authenticated, service_role;
revoke all on table reporting.operational_exceptions from public, anon, authenticated, service_role;
