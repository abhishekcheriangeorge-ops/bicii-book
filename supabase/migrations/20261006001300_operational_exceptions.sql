-- Operational exceptions, extended (SPEC §13, §19.1, §23, §26; DATA-MODEL.md
-- §6, §9, §14, §15, §16; PLAN D20, D30, D34 EXCEPTIONS, D46, D48, D86 (Phase
-- 10), D104, D106 STOCK-RECONCILIATION, D107 UNSETTLED-CONSIGNMENT-ALERT,
-- D108 EXCEPTION-VISIBILITY; record ADR-022).
--
-- There is ONE exceptions surface: reporting.operational_exceptions and
-- public.operational_exceptions(max_rows). This migration extends both; it
-- creates no enum of kinds, no composite type, no second view and no
-- second RPC for the list. Exceptions are computed live, never stored or
-- dismissed, and clear when their cause is fixed.
--
-- Changes:
--   * shop_settings.consignment_settlement_alert_days (D107; default 30,
--     1..365), written only by public.set_consignment_settlement_alert_days
--     (admin). authenticated keeps table-level SELECT only (no UPDATE);
--     the existing triggers stamp updated_by/updated_at and write the
--     schedule history.
--   * reporting.operational_exceptions: Phase 5's nine columns first, in
--     order, unchanged (kind, severity, entity_type, entity_id,
--     entity_label, subject_label, days, quantity, since), then appended:
--     issue, short_id, title, detail, amount, currency. Every Phase 5
--     branch keeps its rows and values; it fills issue (negative_on_hand
--     for negative_stock, else the kind), short_id (job number or P-/U-
--     ID), title (= entity_label), detail (= subject_label), and NULL
--     amount and currency.
--   * currency_mismatch (D104) also covers sale lines: every line of a
--     sale that is not voided (and not of the reserved source work_order)
--     whose currency is not private.shop_currency(), entity_type 'sale' -
--     exactly the lines the period reports exclude and count on the sale
--     basis (excluded_foreign_line_count).
--   * unit_state_mismatch (danger, D106): one row per
--     reporting.unit_reconciliation issue (entity_type inventory_unit) and
--     per reporting.stock_reconciliation issue unit_count_mismatch or
--     unique_movement_without_unit (entity_type product). Never for
--     negative_on_hand (Phase 5's negative_stock already is that row), and
--     not for a unit whose issue is held_without_open_job while Phase 5's
--     unit_hold_stale lists it: one row per problem, Phase 5's kind wins.
--   * unsettled_consignment (warning, D107): a consignment item with
--     outstanding > 0 (reporting.consignor_item_ledger, D46) whose latest
--     sale (last_sale_at) is more than N shop days ago.
--   * integration_failed: the rows of private.integration_exceptions().
--   * D108: private.exception_visible(kind) is the one visibility rule, used
--     by the list, the counts (public.report_exception_counts) and
--     today_dashboard.exceptions_now alike, so the three agree per caller.
--
-- Phase 10 merge (RISKS R-058). Phase 10 (feat/p10-shopify, migration
-- 20261004004000_shopify_order_processing, which sorts BEFORE this file)
-- creates private.integration_exceptions() with Phase 5's nine columns and
-- the real body (needs_attention jobs, admins only, D86), and adds its
-- branch to the nine-column view. This file applies cleanly in both merge
-- orders:
--   * on this branch (no Phase 10), the DO block below creates a
--     placeholder with EXACTLY Phase 10's signature and nine-column shape
--     that returns no rows;
--   * after Phase 10's 20261004004000, the function already exists, the DO
--     block leaves Phase 10's body in place, and the view below replaces
--     Phase 10's nine-column view with these fifteen columns, mapping the
--     appended columns of the integration rows itself.

-- ---------------------------------------------------------------------------
-- D107: the threshold setting
-- ---------------------------------------------------------------------------
alter table public.shop_settings
  add column consignment_settlement_alert_days integer not null default 30,
  add constraint shop_settings_consignment_settlement_alert_days_check
    check (consignment_settlement_alert_days between 1 and 365);

comment on column public.shop_settings.consignment_settlement_alert_days is
  'D107: a consignment item with money outstanding is an unsettled_consignment exception once its latest sale is more than this many shop days ago (1..365, default 30). Written only by set_consignment_settlement_alert_days (admin); recorded in schedule_events.';

create function public.set_consignment_settlement_alert_days(p_days integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_days integer;
begin
  perform private.require_admin();

  if set_consignment_settlement_alert_days.p_days is null
     or set_consignment_settlement_alert_days.p_days not between 1 and 365 then
    raise exception using
      errcode = 'P0001',
      message = 'alert_days_out_of_range',
      detail = 'The settlement alert is between 1 and 365 days after the latest sale.';
  end if;

  select s.consignment_settlement_alert_days into current_days
  from public.shop_settings s
  where s.id = 1
  for update;

  if current_days = set_consignment_settlement_alert_days.p_days then
    return current_days;
  end if;

  update public.shop_settings s
  set consignment_settlement_alert_days = set_consignment_settlement_alert_days.p_days
  where s.id = 1;
  return set_consignment_settlement_alert_days.p_days;
end;
$$;

comment on function public.set_consignment_settlement_alert_days(integer) is
  'Admin (D107): set shop_settings.consignment_settlement_alert_days (1..365, else alert_days_out_of_range). The current value again changes nothing and writes no history; a change is recorded in schedule_events by the shop_settings triggers. Returns the value in force.';

-- ---------------------------------------------------------------------------
-- The Phase 10 extension point (created only if absent; see the header)
-- ---------------------------------------------------------------------------
do $do$
begin
  if pg_catalog.to_regprocedure('private.integration_exceptions()') is null then
    create function private.integration_exceptions()
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
    language sql
    stable
    security definer
    set search_path = ''
    as $fn$
      select 'integration_failed'::text,
             'danger'::text,
             'integration_job'::text,
             null::uuid,
             null::text,
             null::text,
             null::integer,
             null::integer,
             null::timestamptz
      where false
        and private.is_admin();
    $fn$;

    comment on function private.integration_exceptions() is
      'Placeholder (Phase 9, 20261006001300): no rows. Phase 10 (20261004004000_shopify_order_processing, on feat/p10-shopify) defines the real body with this same signature (integration_failed rows, admins only, D86); after integration that body is kept, because this placeholder is created only when the function is absent.';
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- reporting.operational_exceptions: Phase 5's nine columns, then six more.
-- ---------------------------------------------------------------------------
create or replace view reporting.operational_exceptions
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
         a.checked_in_at as since,
         'overdue_job'::text as issue,
         a.job_number::text as short_id,
         a.job_number::text as title,
         pg_catalog.concat_ws(
           ' · ',
           private.customer_label(c.first_name, c.last_name, c.display_name, c.email::text, c.phone),
           b.brand || ' ' || b.model || coalesce(' ' || b.variant, '')
         )::text as detail,
         null::numeric as amount,
         null::text as currency
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
         a.completed_at,
         'uncollected_job'::text,
         a.job_number::text,
         a.job_number::text,
         pg_catalog.concat_ws(
           ' · ',
           private.customer_label(c.first_name, c.last_name, c.display_name, c.email::text, c.phone),
           b.brand || ' ' || b.model || coalesce(' ' || b.variant, '')
         )::text,
         null::numeric,
         null::text
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
         sl.last_movement_at,
         'negative_on_hand'::text,
         p.short_id::text,
         p.short_id::text,
         (p.name || ' · ' || loc.name)::text,
         null::numeric,
         null::text
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
         h.since,
         'unit_hold_stale'::text,
         u.short_id::text,
         u.short_id::text,
         p.name::text,
         null::numeric,
         null::text
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
         wo.completed_at,
         'currency_mismatch'::text,
         wo.job_number::text,
         wo.job_number::text,
         (l.description_snapshot || ' · ' || l.currency)::text,
         null::numeric,
         null::text
  from public.work_order_line_items l
  join public.work_orders wo on wo.id = l.work_order_id
  where wo.completed_at is not null
    and l.voided_at is null
    -- Phase 5's predicate, with the shop currency read once per query
    -- (an initplan) instead of once per line; the rows are the same.
    and l.currency::text <> (select private.shop_currency())

  union all

  -- D104: sale lines in another currency (the sale-basis exclusions of the
  -- period reports; same filter as reporting.financial_lines' sale branch).
  select 'currency_mismatch'::text,
         'danger'::text,
         'sale'::text,
         sa.id,
         sa.sale_number::text,
         (sl.description_snapshot || ' · ' || sl.currency)::text,
         null::integer,
         null::integer,
         sa.recognized_at,
         'currency_mismatch'::text,
         sa.sale_number::text,
         sa.sale_number::text,
         (sl.description_snapshot || ' · ' || sl.currency)::text,
         null::numeric,
         null::text
  from public.sale_lines sl
  join public.sales sa on sa.id = sl.sale_id
  where sa.status <> 'voided'
    and sa.source <> 'work_order'
    and sl.currency::text <> (select private.shop_currency())

  union all

  -- D106: a unit whose cached state disagrees with its ledger. A held unit
  -- that Phase 5's unit_hold_stale already lists is not repeated.
  select 'unit_state_mismatch'::text,
         'danger'::text,
         'inventory_unit'::text,
         ur.unit_id,
         ur.unit_short_id,
         p.name::text,
         (private.shop_today() - private.shop_day(ur.last_movement_at))::integer,
         null::integer,
         ur.last_movement_at,
         ur.issue,
         ur.unit_short_id,
         ur.unit_short_id,
         ur.issue_detail,
         null::numeric,
         null::text
  from reporting.unit_reconciliation ur
  join public.products p on p.id = ur.product_id
  where ur.issue is not null
    and not (
      ur.issue = 'held_without_open_job'
      and ur.status = 'held_for_customer'
      and not exists (
        select 1
        from public.work_order_line_items li
        join public.work_orders wo on wo.id = li.work_order_id
        where li.source_inventory_unit_id = ur.unit_id
          and li.voided_at is null
          and li.line_type = 'inventory'
          and private.work_order_status_is_open(wo.status)
      )
    )

  union all

  -- D106: a unique product whose ledger and units disagree at a location
  -- (negative_on_hand is Phase 5's negative_stock row, never repeated).
  select 'unit_state_mismatch'::text,
         'danger'::text,
         'product'::text,
         p.id,
         p.short_id::text,
         (p.name || ' · ' || loc.name)::text,
         null::integer,
         sr.ledger_on_hand,
         sr.last_movement_at,
         sr.issue,
         p.short_id::text,
         p.short_id::text,
         case sr.issue
           when 'unit_count_mismatch' then
             pg_catalog.format(
               'The ledger has %s at %s; %s of its units there are in stock.',
               sr.ledger_on_hand, loc.name, sr.units_in_stock
             )
           else
             pg_catalog.format('A movement of this unique product at %s names no unit.', loc.name)
         end::text,
         null::numeric,
         null::text
  from reporting.stock_reconciliation sr
  join public.products p on p.id = sr.product_id
  join public.locations loc on loc.id = sr.location_id
  where sr.issue in ('unit_count_mismatch', 'unique_movement_without_unit')

  union all

  -- D107: money owed to a consignor for longer than the threshold.
  select 'unsettled_consignment'::text,
         'warning'::text,
         'consignment_item'::text,
         il.consignment_item_id,
         il.short_id,
         (cn.display_name || ' · ' || p.name)::text,
         (private.shop_today() - private.shop_day(il.last_sale_at))::integer,
         null::integer,
         il.last_sale_at,
         'unsettled_consignment'::text,
         il.short_id,
         (il.short_id || ' · ' || cn.display_name)::text,
         pg_catalog.format(
           '%s %s outstanding to %s; last sold %s shop days ago.',
           il.currency, il.outstanding, cn.display_name,
           private.shop_today() - private.shop_day(il.last_sale_at)
         )::text,
         il.outstanding,
         il.currency
  from reporting.consignor_item_ledger il
  join public.consignors cn on cn.id = il.consignor_id
  join public.products p on p.id = il.product_id
  where il.outstanding > 0
    and private.shop_today() - private.shop_day(il.last_sale_at) > coalesce(
      (select s.consignment_settlement_alert_days from public.shop_settings s where s.id = 1), 30
    )

  union all

  -- Phase 10 (D86): admins only; no rows on this branch.
  select ie.kind, ie.severity, ie.entity_type, ie.entity_id, ie.entity_label, ie.subject_label, ie.days,
         ie.quantity, ie.since,
         ie.kind, null::text, ie.entity_label, ie.subject_label, null::numeric, null::text
  from private.integration_exceptions() ie;

comment on view reporting.operational_exceptions is
  'Operational exceptions (D34, extended by Phase 9 D106-D108). Columns: Phase 5''s nine (kind, severity, entity_type, entity_id, entity_label, subject_label, days, quantity, since), then issue, short_id, title, detail, amount, currency. Kinds: overdue_job (D20: open and now() - checked_in_at > 7 days; 7 = OVERDUE_AFTER_DAYS in src/lib/workshop.ts), uncollected_job (completed or ready >= 7 shop days), negative_stock (issue negative_on_hand), unit_hold_stale (held unit with no live line on an open job), currency_mismatch (a would-be-recognised workshop line or a sale line not in the shop currency, D104), unit_state_mismatch (D106: unit_reconciliation issues, and stock_reconciliation unit_count_mismatch / unique_movement_without_unit; never negative_on_hand, never a held unit unit_hold_stale lists), unsettled_consignment (D107: outstanding > 0 and the latest sale more than shop_settings.consignment_settlement_alert_days shop days ago), integration_failed (private.integration_exceptions(), Phase 10, admins only). Rows are not filtered per caller here: the RPCs apply private.exception_visible(kind) (D108). Computed live, never stored. No API grants.';

revoke all on table reporting.operational_exceptions from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- D108: who sees which exception
-- ---------------------------------------------------------------------------
create function private.exception_visible(p_kind text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case exception_visible.p_kind
    when 'unsettled_consignment' then private.can_view_consignment_money()
    when 'integration_failed' then private.is_admin()
    else private.is_staff()
  end;
$$;

comment on function private.exception_visible(text) is
  'D108 EXCEPTION-VISIBILITY: unsettled_consignment needs consignment money access (private.can_view_consignment_money(): manage_consignments or view_costs, D48); integration_failed is admins only (private.is_admin(), D86); every other kind (Phase 5''s and unit_state_mismatch) any active staff member. The one rule for public.operational_exceptions, public.report_exception_counts and today_dashboard.exceptions_now.';

-- ---------------------------------------------------------------------------
-- public.operational_exceptions(max_rows): same name, argument, default,
-- ordering and clamp; the nine columns, then the six appended ones.
-- ---------------------------------------------------------------------------
drop function public.operational_exceptions(integer);

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
  since timestamptz,
  issue text,
  short_id text,
  title text,
  detail text,
  amount numeric,
  currency text
)
language plpgsql
stable
security definer
set search_path = ''
-- The view is a wide UNION the planner prices high enough to JIT-compile
-- on every call; compiling costs more than it saves at the shop's volume
-- (scripts/bench/report-volume.sql, DATA-MODEL §14).
set jit = off
as $$
begin
  perform private.require_staff();

  return query
    with oe as materialized (
      select o.* from reporting.operational_exceptions o
    ),
    visible as (
      select k.kind from (select distinct oe.kind from oe) k where private.exception_visible(k.kind)
    )
    select oe.kind, oe.severity, oe.entity_type, oe.entity_id, oe.entity_label, oe.subject_label,
           oe.days, oe.quantity, oe.since,
           oe.issue, oe.short_id, oe.title, oe.detail, oe.amount, oe.currency
    from oe
    where oe.kind in (select v.kind from visible v)
    order by (oe.severity = 'danger') desc, oe.since asc nulls last, oe.kind, oe.entity_label, oe.entity_id
    limit greatest(1, least(coalesce(operational_exceptions.max_rows, 50), 200));
end;
$$;

comment on function public.operational_exceptions(integer) is
  'Active staff: operational exceptions (D34, extended D106-D108) the caller may see (private.exception_visible, D108), danger first, then oldest; max_rows clamped to 1..200. Phase 5''s nine columns, then issue, short_id, title, detail, amount and currency (amount: unsettled_consignment''s outstanding).';

-- ---------------------------------------------------------------------------
-- public.report_exception_counts(): the same rows, counted per kind.
-- ---------------------------------------------------------------------------
create function public.report_exception_counts()
returns table (
  kind text,
  severity text,
  count integer
)
language plpgsql
stable
security definer
set search_path = ''
-- The view is a wide UNION the planner prices high enough to JIT-compile
-- on every call; compiling costs more than it saves at the shop's volume
-- (scripts/bench/report-volume.sql, DATA-MODEL §14).
set jit = off
as $$
begin
  perform private.require_staff();

  return query
    with oe as materialized (
      select o.kind, o.severity from reporting.operational_exceptions o
    ),
    visible as (
      select k.kind from (select distinct oe.kind from oe) k where private.exception_visible(k.kind)
    )
    select oe.kind, oe.severity, count(*)::integer
    from oe
    where oe.kind in (select v.kind from visible v)
    group by oe.kind, oe.severity
    order by (oe.severity = 'danger') desc, oe.kind;
end;
$$;

comment on function public.report_exception_counts() is
  'Active staff: how many operational exceptions of each kind and severity the caller may see (private.exception_visible, D108); the sum equals the rows public.operational_exceptions would return without its cap. Danger first, then kind.';

-- ---------------------------------------------------------------------------
-- public.today_dashboard: Phase 5's function with ONE change, the
-- exceptions_now count filtered by private.exception_visible (D108), so it
-- equals the length of public.operational_exceptions(200) for each caller
-- (below the cap). Same signature, return type, attributes and grants.
-- ---------------------------------------------------------------------------
create or replace function public.today_dashboard(on_day date default null)
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
    -- D108: only the kinds this caller may see (the visibility of each kind
    -- is decided once, by private.exception_visible).
    with oe as materialized (
      select o.kind from reporting.operational_exceptions o
    )
    select count(*)::integer into snap_exceptions
    from oe
    where oe.kind in (
      select k.kind from (select distinct x.kind from oe x) k where private.exception_visible(k.kind)
    );
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
  'Active staff: one row for on_day (null = today; a future day raises report_range_invalid): the daily summary (gated by D30) plus, for today only, the current job snapshot grouped as BOARD_GROUPS, overdue (D20), low stock and the exceptions the caller may see (D31, D108: private.exception_visible), and the day''s cost-pending entries (D14; NULL without view_financial_reports).';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function
  private.integration_exceptions(),
  private.exception_visible(text),
  public.set_consignment_settlement_alert_days(integer),
  public.operational_exceptions(integer),
  public.report_exception_counts(),
  public.today_dashboard(date)
from public, anon, authenticated, service_role;

grant execute on function
  public.set_consignment_settlement_alert_days(integer),
  public.operational_exceptions(integer),
  public.report_exception_counts(),
  public.today_dashboard(date)
to authenticated;
