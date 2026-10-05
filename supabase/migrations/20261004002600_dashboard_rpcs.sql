-- Read RPCs for the Today dashboard and the financial reports (SPEC §4.2,
-- §19.1, §19.2, §22, §23; DATA-MODEL.md §14, §15, §16; PLAN D1, D14, D20,
-- D30 FIN-ACCESS, D31 TODAY-TILES, D32 RECOGNITION, D33 SIGNIFICANT-ADJ,
-- D34 EXCEPTIONS, D35 SHOP-TZ).
--
-- This phase only READS: no table, no mutating RPC, no change to a Phase 3
-- or Phase 4 function. The Phase 5 reporting views are granted to no API
-- role; these security definer functions are the app's only way to them.
--
-- Rules for every RPC here:
--   * The guard comes first (private.require_staff() or
--     private.require_permission(...), 42501 otherwise), then the work.
--   * Columns are selected from the views BY NAME (never `*`), so columns
--     later phases append to a view never change an RPC's result, and the
--     daily_summary placeholders are passed through un-coalesced: Phases 2
--     and 6 only replace the views.
--   * D30 FIN-ACCESS: fin := has_permission('view_financial_reports');
--     costs := fin and has_permission('view_costs'). Financial rows and
--     money need fin; every cost-derived figure (COGS, unit cost, yield,
--     Cult Commons share and rate, BICII yield after CC, losses, value at
--     cost, consignor liability) also needs costs and is NULL otherwise.
--     Operational counts (jobs, parts, adjustments and whether one is
--     significant, low stock, exceptions) are visible to all active staff.
--     work_order_yield (the job yield panel) and stock_adjustments_on's
--     value_at_cost need view_costs alone (job costing, SPEC §4.2).
--   * Day ranges are inclusive on both ends; a bad range raises P0001
--     report_range_invalid.
--   * No input parameter shares a name with an output column (PL/pgSQL
--     refuses that), and every column reference is qualified.
--   * Results carry numeric, integer, bigint, boolean, date, timestamptz,
--     interval, uuid, text, the job status enum or arrays of these; never
--     a float.

-- ---------------------------------------------------------------------------
-- daily_summary(from_day, to_day): the 27 reporting.daily_summary columns.
-- ---------------------------------------------------------------------------
create function public.daily_summary(from_day date default null, to_day date default null)
returns table (
  day date,
  jobs_checked_in integer,
  jobs_started integer,
  jobs_completed integer,
  jobs_ready_for_collection integer,
  jobs_collected integer,
  jobs_cancelled integer,
  currency text,
  lines_recognised integer,
  gross_sales numeric,
  cogs numeric,
  yield_total numeric,
  cult_commons_share numeric,
  bicii_yield_after_cc numeric,
  loss_lines integer,
  loss_total numeric,
  parts_consumed_qty integer,
  parts_consumed_lines integer,
  parts_returned_qty integer,
  stock_adjustments integer,
  significant_stock_adjustments integer,
  appointments_scheduled integer,
  appointments_arrived integer,
  appointments_no_show integer,
  consignment_sales integer,
  consignment_sales_total numeric,
  new_consignor_liability numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  fin boolean;
  costs boolean;
  first_day date;
  last_day date;
begin
  perform private.require_staff();
  fin := private.has_permission('view_financial_reports');
  costs := fin and private.has_permission('view_costs');

  first_day := coalesce(daily_summary.from_day, daily_summary.to_day, private.shop_today());
  last_day := coalesce(daily_summary.to_day, daily_summary.from_day, private.shop_today());
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
      detail = 'A daily summary covers at most 366 days.';
  end if;

  return query
    select
      g.d,
      coalesce(ds.jobs_checked_in, 0)::integer,
      coalesce(ds.jobs_started, 0)::integer,
      coalesce(ds.jobs_completed, 0)::integer,
      coalesce(ds.jobs_ready_for_collection, 0)::integer,
      coalesce(ds.jobs_collected, 0)::integer,
      coalesce(ds.jobs_cancelled, 0)::integer,
      case when fin then coalesce(ds.currency, private.shop_currency()) end::text,
      case when fin then coalesce(ds.lines_recognised, 0) end::integer,
      case when fin then coalesce(ds.gross_sales, 0) end::numeric,
      case when costs then coalesce(ds.cogs, 0) end::numeric,
      case when costs then coalesce(ds.yield_total, 0) end::numeric,
      case when costs then coalesce(ds.cult_commons_share, 0) end::numeric,
      case when costs then coalesce(ds.bicii_yield_after_cc, 0) end::numeric,
      case when costs then coalesce(ds.loss_lines, 0) end::integer,
      case when costs then coalesce(ds.loss_total, 0) end::numeric,
      coalesce(ds.parts_consumed_qty, 0)::integer,
      coalesce(ds.parts_consumed_lines, 0)::integer,
      coalesce(ds.parts_returned_qty, 0)::integer,
      coalesce(ds.stock_adjustments, 0)::integer,
      coalesce(ds.significant_stock_adjustments, 0)::integer,
      -- Placeholders: passed through (Phase 2 / Phase 6 replace the view).
      ds.appointments_scheduled::integer,
      ds.appointments_arrived::integer,
      ds.appointments_no_show::integer,
      case when fin then ds.consignment_sales end::integer,
      case when fin then ds.consignment_sales_total end::numeric,
      case when costs then ds.new_consignor_liability end::numeric
    from (
      select gs.ts::date as d
      from pg_catalog.generate_series(first_day::timestamp, last_day::timestamp, interval '1 day') gs(ts)
    ) g
    left join reporting.daily_summary ds on ds.day = g.d
    order by g.d;
end;
$$;

comment on function public.daily_summary(date, date) is
  'Active staff: one zero-filled row per shop day from from_day to to_day inclusive (null bound = the other; both null = today; at most 366 days, else report_range_invalid). Money needs view_financial_reports, cost-derived figures also view_costs; NULL otherwise (D30).';

-- ---------------------------------------------------------------------------
-- today_dashboard(on_day): flows for the day, the current snapshot (D31).
-- ---------------------------------------------------------------------------
create function public.today_dashboard(on_day date default null)
returns table (
  day date,
  is_today boolean,
  generated_at timestamptz,
  can_see_financials boolean,
  can_see_costs boolean,
  jobs_checked_in integer,
  jobs_started integer,
  jobs_completed integer,
  jobs_ready_for_collection integer,
  jobs_collected integer,
  jobs_cancelled integer,
  currency text,
  lines_recognised integer,
  gross_sales numeric,
  cogs numeric,
  yield_total numeric,
  cult_commons_share numeric,
  bicii_yield_after_cc numeric,
  loss_lines integer,
  loss_total numeric,
  parts_consumed_qty integer,
  parts_consumed_lines integer,
  parts_returned_qty integer,
  stock_adjustments integer,
  significant_stock_adjustments integer,
  appointments_scheduled integer,
  appointments_arrived integer,
  appointments_no_show integer,
  consignment_sales integer,
  consignment_sales_total numeric,
  new_consignor_liability numeric,
  received_now integer,
  waiting_now integer,
  ready_to_start_now integer,
  in_progress_now integer,
  awaiting_collection_now integer,
  open_jobs_now integer,
  overdue_now integer,
  low_stock_now integer,
  exceptions_now integer,
  cost_pending_lines integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  fin boolean;
  costs boolean;
  today date;
  d date;
  snap_received integer;
  snap_waiting integer;
  snap_ready integer;
  snap_in_progress integer;
  snap_awaiting integer;
  snap_open integer;
  snap_overdue integer;
  snap_low_stock integer;
  snap_exceptions integer;
  pending integer;
begin
  perform private.require_staff();
  fin := private.has_permission('view_financial_reports');
  costs := fin and private.has_permission('view_costs');
  today := private.shop_today();
  d := coalesce(today_dashboard.on_day, today);
  if d > today then
    raise exception using
      errcode = 'P0001',
      message = 'report_range_invalid',
      detail = 'The dashboard shows today or an earlier day.';
  end if;

  -- D31: the current snapshot, from status, for today only (grouped as
  -- BOARD_GROUPS in src/lib/workshop.ts).
  if d = today then
    select
      (count(*) filter (where wo.status in ('received', 'diagnosing')))::integer,
      (count(*) filter (where wo.status in ('awaiting_customer', 'awaiting_parts', 'paused')))::integer,
      (count(*) filter (where wo.status = 'ready_to_start'))::integer,
      (count(*) filter (where wo.status = 'in_progress'))::integer,
      (count(*) filter (where wo.status in ('completed', 'ready_for_collection')))::integer,
      (count(*) filter (where private.work_order_status_is_open(wo.status)))::integer
    into snap_received, snap_waiting, snap_ready, snap_in_progress, snap_awaiting, snap_open
    from public.work_orders wo;

    select count(*)::integer into snap_overdue from reporting.work_order_activity wa where wa.is_overdue;
    select count(*)::integer into snap_low_stock from reporting.low_stock ls;
    select count(*)::integer into snap_exceptions from reporting.operational_exceptions oe;
  end if;

  if fin then
    select count(*)::integer into pending
    from reporting.financial_lines fl
    where fl.recognized_at >= private.shop_day_start(d)
      and fl.recognized_at < private.shop_day_start(d + 1)
      and fl.currency = private.shop_currency()
      and fl.cost_pending;
  end if;

  return query
    select
      d,
      d = today,
      pg_catalog.now(),
      fin,
      costs,
      s.jobs_checked_in,
      s.jobs_started,
      s.jobs_completed,
      s.jobs_ready_for_collection,
      s.jobs_collected,
      s.jobs_cancelled,
      s.currency,
      s.lines_recognised,
      s.gross_sales,
      s.cogs,
      s.yield_total,
      s.cult_commons_share,
      s.bicii_yield_after_cc,
      s.loss_lines,
      s.loss_total,
      s.parts_consumed_qty,
      s.parts_consumed_lines,
      s.parts_returned_qty,
      s.stock_adjustments,
      s.significant_stock_adjustments,
      s.appointments_scheduled,
      s.appointments_arrived,
      s.appointments_no_show,
      s.consignment_sales,
      s.consignment_sales_total,
      s.new_consignor_liability,
      snap_received,
      snap_waiting,
      snap_ready,
      snap_in_progress,
      snap_awaiting,
      snap_open,
      snap_overdue,
      snap_low_stock,
      snap_exceptions,
      pending
    from public.daily_summary(d, d) s;
end;
$$;

comment on function public.today_dashboard(date) is
  'Active staff: one row for on_day (null = today; a future day raises report_range_invalid): the daily summary (gated by D30) plus, for today only, the current job snapshot grouped as BOARD_GROUPS, overdue (D20), low stock and exceptions (D31), and the day''s cost-pending entries (D14; NULL without view_financial_reports).';

-- ---------------------------------------------------------------------------
-- work_order_activity_on(on_day): the jobs behind the day's flows.
-- ---------------------------------------------------------------------------
create function public.work_order_activity_on(on_day date default null)
returns table (
  work_order_id uuid,
  job_number text,
  status public.work_order_status,
  customer_id uuid,
  customer_label text,
  bike_id uuid,
  bike_title text,
  lead_mechanic_name text,
  checked_in_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  ready_for_collection_at timestamptz,
  collected_at timestamptz,
  cancelled_at timestamptz,
  checked_in_on_day boolean,
  started_on_day boolean,
  completed_on_day boolean,
  ready_on_day boolean,
  collected_on_day boolean,
  cancelled_on_day boolean,
  is_open boolean,
  is_overdue boolean,
  age_days integer,
  sale_total numeric,
  currency text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d date;
begin
  perform private.require_staff();
  d := coalesce(work_order_activity_on.on_day, private.shop_today());

  return query
    select
      wa.work_order_id,
      wa.job_number,
      wa.status,
      wa.customer_id,
      private.customer_label(c.first_name, c.last_name, c.display_name, c.email::text, c.phone),
      wa.bike_id,
      (b.brand || ' ' || b.model || coalesce(' ' || b.variant, ''))::text,
      st.display_name::text,
      wa.checked_in_at,
      wa.started_at,
      wa.completed_at,
      wa.ready_for_collection_at,
      wa.collected_at,
      wa.cancelled_at,
      coalesce(wa.checked_in_day = d, false),
      coalesce(wa.started_day = d, false),
      coalesce(wa.completed_day = d, false),
      coalesce(wa.ready_day = d, false),
      coalesce(wa.collected_day = d, false),
      coalesce(wa.cancelled_day = d, false),
      wa.is_open,
      wa.is_overdue,
      wa.age_days,
      coalesce(t.sale_total, 0)::numeric,
      wa.currency
    from reporting.work_order_activity wa
    join public.customers c on c.id = wa.customer_id
    join public.bikes b on b.id = wa.bike_id
    left join public.staff st on st.id = wa.lead_mechanic_id
    left join public.work_order_totals t on t.work_order_id = wa.work_order_id
    where d in (wa.checked_in_day, wa.started_day, wa.completed_day, wa.ready_day, wa.collected_day,
                wa.cancelled_day)
    order by wa.job_number;
end;
$$;

comment on function public.work_order_activity_on(date) is
  'Active staff: the jobs with at least one current stamp on on_day (null = today), with which stamps fall that day (D31), open/overdue (D20), age and sale total (sale only), by job number.';

-- ---------------------------------------------------------------------------
-- stock_adjustments_on(on_day): manual stock changes of a shop day (D33).
-- ---------------------------------------------------------------------------
create function public.stock_adjustments_on(on_day date default null)
returns table (
  movement_id bigint,
  created_at timestamptz,
  movement_type text,
  product_id uuid,
  product_short_id text,
  product_name text,
  inventory_unit_id uuid,
  unit_short_id text,
  location_name text,
  quantity_delta integer,
  reason text,
  actor_name text,
  significant boolean,
  value_at_cost numeric,
  currency text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d date;
  costs boolean;
begin
  perform private.require_staff();
  costs := private.has_permission('view_costs');
  d := coalesce(stock_adjustments_on.on_day, private.shop_today());

  return query
    select
      m.id,
      m.created_at,
      m.movement_type::text,
      m.product_id,
      p.short_id::text,
      p.name::text,
      m.inventory_unit_id,
      u.short_id::text,
      loc.name::text,
      m.quantity_delta,
      m.reason,
      st.display_name::text,
      private.is_significant_adjustment(
        m.movement_type, m.quantity_delta, m.inventory_unit_id is not null, uc.unit_cost
      ),
      case when costs then (pg_catalog.abs(m.quantity_delta) * uc.unit_cost)::numeric end,
      m.currency::text
    from public.inventory_movements m
    join public.products p on p.id = m.product_id
    join public.locations loc on loc.id = m.location_id
    left join public.inventory_units u on u.id = m.inventory_unit_id
    left join public.staff st on st.id = m.created_by
    cross join lateral (
      select coalesce(m.unit_cost_snapshot, p.default_direct_cost, 0)::numeric as unit_cost
    ) uc
    where m.movement_type in ('stock_adjustment', 'damaged')
      and m.created_at >= private.shop_day_start(d)
      and m.created_at < private.shop_day_start(d + 1)
    order by m.created_at desc, m.id desc;
end;
$$;

comment on function public.stock_adjustments_on(date) is
  'Active staff: stock_adjustment and damaged movements of on_day (null = today), newest first, with actor, reason and the D33 significance flag; value_at_cost (|delta| x unit cost) needs view_costs (NULL otherwise, D30).';

-- ---------------------------------------------------------------------------
-- operational_exceptions(max_rows): D34, danger first, oldest first.
-- ---------------------------------------------------------------------------
create function public.operational_exceptions(max_rows integer default 50)
returns table (
  kind text,
  severity text,
  entity_type text,
  entity_id uuid,
  entity_label text,
  subject_label text,
  days integer,
  quantity integer,
  since timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff();

  return query
    select oe.kind, oe.severity, oe.entity_type, oe.entity_id, oe.entity_label, oe.subject_label,
           oe.days, oe.quantity, oe.since
    from reporting.operational_exceptions oe
    order by (oe.severity = 'danger') desc, oe.since asc nulls last, oe.kind, oe.entity_label, oe.entity_id
    limit greatest(1, least(coalesce(operational_exceptions.max_rows, 50), 200));
end;
$$;

comment on function public.operational_exceptions(integer) is
  'Active staff: operational exceptions (D34), danger first, then oldest; max_rows clamped to 1..200.';

-- ---------------------------------------------------------------------------
-- financial_lines(from_day, to_day): recognised entries (D32), gated (D30).
-- ---------------------------------------------------------------------------
create function public.financial_lines(from_day date, to_day date)
returns table (
  entry_key text,
  source text,
  entry_kind text,
  source_line_id uuid,
  document_id uuid,
  document_number text,
  channel text,
  recognized_at timestamptz,
  recognized_day date,
  line_type text,
  service_id uuid,
  product_id uuid,
  inventory_unit_id uuid,
  category_id uuid,
  ownership_type text,
  consignment_item_id uuid,
  customer_id uuid,
  bike_id uuid,
  lead_mechanic_id uuid,
  description text,
  quantity numeric,
  unit_sale_price numeric,
  unit_direct_cost numeric,
  cult_commons_rate numeric,
  sale_total numeric,
  cost_total numeric,
  yield_total numeric,
  cult_commons_share numeric,
  bicii_yield_after_cc numeric,
  is_loss boolean,
  currency text,
  cost_pending boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  costs boolean;
  first_day date;
  last_day date;
begin
  perform private.require_permission('view_financial_reports');
  costs := private.has_permission('view_costs');

  first_day := coalesce(financial_lines.from_day, financial_lines.to_day, private.shop_today());
  last_day := coalesce(financial_lines.to_day, financial_lines.from_day, private.shop_today());
  if first_day > last_day then
    raise exception using
      errcode = 'P0001',
      message = 'report_range_invalid',
      detail = 'The start day is after the end day.';
  end if;
  if last_day - first_day > 30 then
    raise exception using
      errcode = 'P0001',
      message = 'report_range_invalid',
      detail = 'Financial lines cover at most 31 days at a time.';
  end if;

  return query
    select
      fl.entry_key,
      fl.source,
      fl.entry_kind,
      fl.source_line_id,
      fl.document_id,
      fl.document_number,
      fl.channel,
      fl.recognized_at,
      fl.recognized_day,
      fl.line_type,
      fl.service_id,
      fl.product_id,
      fl.inventory_unit_id,
      fl.category_id,
      fl.ownership_type,
      fl.consignment_item_id,
      fl.customer_id,
      fl.bike_id,
      fl.lead_mechanic_id,
      fl.description,
      fl.quantity,
      fl.unit_sale_price,
      case when costs then fl.unit_direct_cost end,
      case when costs then fl.cult_commons_rate end,
      fl.sale_total,
      case when costs then fl.cost_total end,
      case when costs then fl.yield_total end,
      case when costs then fl.cult_commons_share end,
      case when costs then fl.bicii_yield_after_cc end,
      case when costs then fl.is_loss end,
      fl.currency,
      fl.cost_pending
    from reporting.financial_lines fl
    where fl.recognized_at >= private.shop_day_start(first_day)
      and fl.recognized_at < private.shop_day_start(last_day + 1)
    order by fl.recognized_at, fl.document_number, fl.source_line_id;
end;
$$;

comment on function public.financial_lines(date, date) is
  'view_financial_reports: recognised entries (D32) of from_day..to_day inclusive (at most 31 days, else report_range_invalid); cost-derived columns need view_costs, NULL otherwise (D30). Callers page with .range().';

-- ---------------------------------------------------------------------------
-- work_order_yield(target_work_order_id): the job yield panel (view_costs).
-- ---------------------------------------------------------------------------
create function public.work_order_yield(target_work_order_id uuid)
returns table (
  work_order_id uuid,
  job_number text,
  status public.work_order_status,
  currency text,
  line_count integer,
  sale_total numeric,
  cost_total numeric,
  yield_total numeric,
  cult_commons_share numeric,
  bicii_yield_after_cc numeric,
  loss_line_count integer,
  loss_total numeric,
  cult_commons_rates numeric[],
  recognized_at timestamptz,
  recognized_day date,
  cost_pending_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('view_costs');
  if not exists (select 1 from public.work_orders w where w.id = work_order_yield.target_work_order_id) then
    raise exception 'work order % not found', work_order_yield.target_work_order_id using errcode = 'P0002';
  end if;

  return query
    select
      wo.id,
      wo.job_number::text,
      wo.status,
      wo.currency::text,
      (count(li.id))::integer,
      coalesce(sum(li.sale_total), 0)::numeric,
      coalesce(sum(li.cost_total), 0)::numeric,
      coalesce(sum(li.yield_total), 0)::numeric,
      -- D1: the sum of the lines' own shares.
      coalesce(sum(li.cult_commons_share), 0)::numeric,
      coalesce(sum(li.yield_total - li.cult_commons_share), 0)::numeric,
      (count(li.id) filter (where li.yield_total < 0))::integer,
      coalesce(sum(li.yield_total) filter (where li.yield_total < 0), 0)::numeric,
      coalesce(
        array(
          select distinct r.cult_commons_rate_snapshot::numeric
          from public.work_order_line_items r
          where r.work_order_id = wo.id and r.voided_at is null
          order by 1
        ),
        '{}'::numeric[]
      ),
      wo.completed_at,
      private.shop_day(wo.completed_at),
      (count(li.id) filter (where li.cost_pending))::integer
    from public.work_orders wo
    left join public.work_order_line_items li on li.work_order_id = wo.id and li.voided_at is null
    where wo.id = work_order_yield.target_work_order_id
    group by wo.id;
end;
$$;

comment on function public.work_order_yield(uuid) is
  'view_costs: one job''s running economics over its live lines (sale, cost, yield, Cult Commons = sum of line shares (D1), BICII after CC, losses, snapshot rates, cost-pending count (D14)) and its recognition (completed_at and its shop day, D32; NULL while open, cancelled or reopened). Unknown job P0002.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function
  public.daily_summary(date, date),
  public.today_dashboard(date),
  public.work_order_activity_on(date),
  public.stock_adjustments_on(date),
  public.operational_exceptions(integer),
  public.financial_lines(date, date),
  public.work_order_yield(uuid)
from public, anon, authenticated, service_role;

grant execute on function
  public.daily_summary(date, date),
  public.today_dashboard(date),
  public.work_order_activity_on(date),
  public.stock_adjustments_on(date),
  public.operational_exceptions(integer),
  public.financial_lines(date, date),
  public.work_order_yield(uuid)
to authenticated;
