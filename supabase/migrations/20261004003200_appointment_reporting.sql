-- Appointment counts for Today and the reports (SPEC §19.1 "Daily
-- dashboard", §19.2; DATA-MODEL.md §14, §16; PLAN D30 FIN-ACCESS, D35
-- SHOP-TZ, D41 APPT-COUNTS). Phase 5's extension point: the three
-- appointment columns of reporting.daily_summary are filled here.
--
-- D41: appointment, arrival and no-show counts are by the appointment's
-- SCHEDULED shop-local date (private.shop_day(starts_at)) and its CURRENT
-- status, never by when staff tapped. booked = not cancelled; arrived =
-- currently arrived, checked_in or completed; no_shows = currently no_show.
-- Phase 9's activity report reads the same view.
--
-- Like Phase 5's views, reporting.appointment_daily is security_invoker
-- and granted to NO API role (it calls private.shop_day, which API roles
-- cannot execute); the app reads it through public.appointment_daily and
-- the daily_summary / today_dashboard RPCs, which select the view's
-- columns by name and are not changed here. Counts are operational (D30):
-- every active staff member sees them.

-- ---------------------------------------------------------------------------
-- reporting.appointment_daily: one row per shop day that has appointments.
-- ---------------------------------------------------------------------------
create view reporting.appointment_daily
with (security_invoker = true)
as
  select
    private.shop_day(a.starts_at) as day,
    (count(*) filter (where a.status <> 'cancelled'))::integer as booked,
    (count(*) filter (where a.status in ('booked', 'confirmed')))::integer as expected,
    (count(*) filter (where a.status in ('arrived', 'checked_in', 'completed')))::integer as arrived,
    (count(*) filter (where a.status in ('checked_in', 'completed')))::integer as checked_in,
    (count(*) filter (where a.status = 'no_show'))::integer as no_shows,
    (count(*) filter (where a.status = 'cancelled'))::integer as cancelled
  from public.appointments a
  group by private.shop_day(a.starts_at);

comment on view reporting.appointment_daily is
  'Appointments per scheduled shop day by current status (D41): booked (not cancelled), expected (booked or confirmed), arrived (arrived, checked_in or completed), checked_in (checked_in or completed), no_shows, cancelled. Days without appointments have no row. No API grants: read through public.appointment_daily (D30: operational, every active staff member).';

revoke all on table reporting.appointment_daily from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- public.appointment_daily(from_day, to_day): zero-filled, one row per day.
-- ---------------------------------------------------------------------------
create function public.appointment_daily(from_day date default null, to_day date default null)
returns table (
  day date,
  booked integer,
  expected integer,
  arrived integer,
  checked_in integer,
  no_shows integer,
  cancelled integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  first_day date;
  last_day date;
begin
  perform private.require_staff();

  -- The same range rules as public.daily_summary; future days are allowed
  -- (upcoming appointments).
  first_day := coalesce(appointment_daily.from_day, appointment_daily.to_day, private.shop_today());
  last_day := coalesce(appointment_daily.to_day, appointment_daily.from_day, private.shop_today());
  if first_day > last_day then
    raise exception using
      errcode = 'P0001',
      message = 'report_range_invalid',
      detail = 'The start day is after the end day.';
  end if;
  if last_day - first_day > 365 then
    raise exception using
      errcode = 'P0001',
      message = 'report_range_invalid',
      detail = 'Appointment counts cover at most 366 days.';
  end if;

  return query
    select
      g.d,
      coalesce(ad.booked, 0)::integer,
      coalesce(ad.expected, 0)::integer,
      coalesce(ad.arrived, 0)::integer,
      coalesce(ad.checked_in, 0)::integer,
      coalesce(ad.no_shows, 0)::integer,
      coalesce(ad.cancelled, 0)::integer
    from (
      select gs.ts::date as d
      from pg_catalog.generate_series(first_day::timestamp, last_day::timestamp, interval '1 day') gs(ts)
    ) g
    left join reporting.appointment_daily ad on ad.day = g.d
    order by g.d;
end;
$$;

comment on function public.appointment_daily(date, date) is
  'Active staff: appointments per scheduled shop day by current status (D41), zero-filled from from_day to to_day inclusive (null bound = the other; both null = today; at most 366 days, else report_range_invalid; future days allowed). Operational counts (D30).';

revoke all on function public.appointment_daily(date, date) from public, anon, authenticated, service_role;
grant execute on function public.appointment_daily(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- reporting.daily_summary: Phase 5's 27 columns (names, order, types)
-- unchanged; ONLY columns 22-24 are now filled (D41) and the series also
-- starts at the earliest appointment's shop day. It still ends at
-- private.shop_today(): today_dashboard never shows a future day, and
-- public.appointment_daily covers upcoming days. Consignment columns stay
-- NULL until Phase 6.
-- ---------------------------------------------------------------------------
create or replace view reporting.daily_summary
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
             -- Phase 2: a day with only appointments is in the series too.
             (select private.shop_day(min(a.starts_at)) from public.appointments a),
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
    -- D41 (Phase 2): by scheduled shop day and current status.
    coalesce(ad.booked, 0)::integer as appointments_scheduled,
    coalesce(ad.arrived, 0)::integer as appointments_arrived,
    coalesce(ad.no_shows, 0)::integer as appointments_no_show,
    null::integer as consignment_sales,
    null::numeric as consignment_sales_total,
    null::numeric as new_consignor_liability
  from days d
  left join job_flows j on j.day = d.day
  left join money mo on mo.day = d.day
  left join stock s on s.day = d.day
  left join reporting.appointment_daily ad on ad.day = d.day;

comment on view reporting.daily_summary is
  'One row per shop day (D35) from the earliest activity (check-in, recognised entry, stock movement or appointment) up to today, zero-filled: job flows by current stamp (D31), shop-currency money from financial_lines with Cult Commons = sum of entry shares (D1, D32), parts and adjustments from the ledger (significant per D33), and appointments_scheduled/arrived/no_show from reporting.appointment_daily by scheduled shop day and current status (D41). Columns 1-27 are fixed: Phase 6 fills consignment_sales, consignment_sales_total, new_consignor_liability; new measures are appended only after column 27. No API grants: read through public.daily_summary / today_dashboard (D30).';

revoke all on table reporting.daily_summary from public, anon, authenticated, service_role;
