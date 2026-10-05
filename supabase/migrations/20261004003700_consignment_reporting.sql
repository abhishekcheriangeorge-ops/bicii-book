-- Sales and consignment in the reports, the Phase 6 read RPCs and three
-- staff_search kinds (SPEC §10, §13, §19.1, §19.2, §20, §23; DATA-MODEL.md
-- §9, §14, §16; PLAN D1, D30 FIN-ACCESS, D32 RECOGNITION, D35 SHOP-TZ, D44
-- CONS-JOB-PART, D45 CONS-QTY-FIFO, D46 CONS-RESTOCK, D47
-- SETTLEMENT-RULES, D48 SALES-ACCESS, D49 RETAIL-REFUND).
--
-- Rules encoded here:
--   * reporting.financial_lines gains the sale branch Phase 5 left in its
--     comment, with every column, name, type and order unchanged: one entry
--     per line of a sale that is not voided, recognised at the sale's
--     recognized_at on its shop day (D35), amounts from the line's
--     snapshots only (D1). Refunds are not subtracted and restocked lines
--     stay (D49: Phase 9's refund-reporting row decides netting). The
--     work-order branch now carries a consigned part's consignment_item_id
--     (D44: its cost already includes the consignor payout).
--   * reporting.daily_summary keeps its 27 columns and fills the three
--     consignment placeholders (25-27) under their names, positions and
--     types, zero-filled like every other measure, from financial_lines
--     entries with a consignment item in the shop currency:
--       consignment_sales        distinct documents (sales and completed
--                                jobs) with a consigned entry that day
--       consignment_sales_total  Σ those entries' sale_total
--       new_consignor_liability  Σ round(quantity x the source line's
--                                consignor_payout_snapshot, 2)
--     Retail money already reaches the money columns through
--     financial_lines, so Phase 5's reconcile invariants still hold.
--     public.daily_summary and public.today_dashboard are unchanged: they
--     select these columns by name and gate them (D30).
--   * The read RPCs are stable security definer functions for active staff
--     (consignor_payout_details: manage_consignments). Money they would
--     reveal is returned as NULL, never omitted and never an error: sale
--     cost, yield, Cult Commons, rate (private.can_view_sale_costs(),
--     view_costs) and consignment money (agreed amount, liability, charges,
--     owed, paid, outstanding, payout snapshot:
--     private.can_view_consignment_money(), manage_consignments or
--     view_costs). Counts, quantities, prices and sale totals are for every
--     active staff member (D48).
--   * staff_search gains `consignor`, `consignment_item` and `sale`, each a
--     private.search_<kind>(q, max_results, archived) with the established
--     row shape; every earlier branch is kept.

-- ---------------------------------------------------------------------------
-- reporting.financial_lines: the work-order branch (consignment_item_id
-- now the line's) and the sale branch.
-- ---------------------------------------------------------------------------
create or replace view reporting.financial_lines
with (security_invoker = true)
as
  select
    ('wol:' || l.id::text)::text as entry_key,
    'work_order'::text as source,
    'line'::text as entry_kind,
    l.id as source_line_id,
    wo.id as document_id,
    wo.job_number::text as document_number,
    'workshop'::text as channel,
    wo.completed_at as recognized_at,
    private.shop_day(wo.completed_at) as recognized_day,
    l.line_type::text as line_type,
    l.source_service_id as service_id,
    l.source_product_id as product_id,
    l.source_inventory_unit_id as inventory_unit_id,
    coalesce(s.category_id, p.category_id) as category_id,
    case when l.line_type = 'inventory' then coalesce(u.ownership_type, p.ownership_type)::text end
      as ownership_type,
    l.consignment_item_id as consignment_item_id,
    wo.customer_id,
    wo.bike_id,
    wo.lead_mechanic_id,
    l.description_snapshot::text as description,
    l.quantity::numeric as quantity,
    l.unit_sale_price_snapshot::numeric as unit_sale_price,
    l.unit_direct_cost_snapshot::numeric as unit_direct_cost,
    l.cult_commons_rate_snapshot::numeric as cult_commons_rate,
    l.sale_total::numeric as sale_total,
    l.cost_total::numeric as cost_total,
    l.yield_total::numeric as yield_total,
    l.cult_commons_share::numeric as cult_commons_share,
    (l.yield_total - l.cult_commons_share)::numeric as bicii_yield_after_cc,
    (l.yield_total < 0) as is_loss,
    l.currency::text as currency,
    l.cost_pending
  from public.work_order_line_items l
  join public.work_orders wo on wo.id = l.work_order_id
  left join public.services s on s.id = l.source_service_id
  left join public.products p on p.id = l.source_product_id
  left join public.inventory_units u on u.id = l.source_inventory_unit_id
  where wo.completed_at is not null
    and l.voided_at is null
  union all
  select
    ('sl:' || sl.id::text)::text as entry_key,
    'sale'::text as source,
    'line'::text as entry_kind,
    sl.id as source_line_id,
    sa.id as document_id,
    sa.sale_number::text as document_number,
    (case sa.source when 'retail' then 'retail' when 'online_shopify' then 'online' end)::text as channel,
    sa.recognized_at as recognized_at,
    private.shop_day(sa.recognized_at) as recognized_day,
    'inventory'::text as line_type,
    null::uuid as service_id,
    sl.product_id as product_id,
    sl.inventory_unit_id as inventory_unit_id,
    p.category_id as category_id,
    coalesce(u.ownership_type, p.ownership_type)::text as ownership_type,
    sl.consignment_item_id as consignment_item_id,
    sa.customer_id,
    null::uuid as bike_id,
    null::uuid as lead_mechanic_id,
    sl.description_snapshot::text as description,
    sl.quantity::numeric as quantity,
    sl.unit_sale_price_snapshot::numeric as unit_sale_price,
    sl.unit_direct_cost_snapshot::numeric as unit_direct_cost,
    sl.cult_commons_rate_snapshot::numeric as cult_commons_rate,
    sl.sale_total::numeric as sale_total,
    sl.cost_total::numeric as cost_total,
    sl.yield_total::numeric as yield_total,
    sl.cult_commons_share::numeric as cult_commons_share,
    (sl.yield_total - sl.cult_commons_share)::numeric as bicii_yield_after_cc,
    (sl.yield_total < 0) as is_loss,
    sl.currency::text as currency,
    false as cost_pending
  from public.sale_lines sl
  join public.sales sa on sa.id = sl.sale_id
  join public.products p on p.id = sl.product_id
  left join public.inventory_units u on u.id = sl.inventory_unit_id
  where sa.status <> 'voided';

comment on view reporting.financial_lines is
  'One row per recognised revenue entry: every live line of a job with a current completed_at, on that shop day (D32), and every line of a sale that is not voided, at the sale''s recognized_at (D35); amounts from the line snapshots only; Cult Commons per entry = the line''s share (>= 0, D1); cost_pending flagged (D14); refunds not subtracted and restocked lines kept (D49). Vocabulary: source work_order|sale, channel workshop|retail|online, document_id = work_orders.id|sales.id, document_number = J-|S- number, entry_kind line, entry_key wol:|sl: + line id. No API grants: read through public.financial_lines / daily_summary (D30).';

revoke all on table reporting.financial_lines from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- reporting.daily_summary: the Phase 2 definition (every CTE, the
-- appointment columns, the bounds) with columns 25-27 filled.
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
  -- Phase 6: the recognised entries that sold consigned stock (D44, D46),
  -- with their source line's payout snapshot.
  consignment as (
    select fl.recognized_day as day,
           (count(distinct fl.document_id))::integer as consignment_sales,
           sum(fl.sale_total)::numeric as consignment_sales_total,
           sum(round(fl.quantity * coalesce(sl.consignor_payout_snapshot, li.consignor_payout_snapshot), 2))::numeric
             as new_consignor_liability
    from reporting.financial_lines fl
    left join public.sale_lines sl on fl.source = 'sale' and sl.id = fl.source_line_id
    left join public.work_order_line_items li on fl.source = 'work_order' and li.id = fl.source_line_id
    where fl.consignment_item_id is not null
      and fl.currency = private.shop_currency()
    group by fl.recognized_day
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
    -- Phase 6 (D44, D46): consigned stock sold that day, by recognition.
    coalesce(c.consignment_sales, 0)::integer as consignment_sales,
    coalesce(c.consignment_sales_total, 0)::numeric as consignment_sales_total,
    coalesce(c.new_consignor_liability, 0)::numeric as new_consignor_liability
  from days d
  left join job_flows j on j.day = d.day
  left join money mo on mo.day = d.day
  left join stock s on s.day = d.day
  left join reporting.appointment_daily ad on ad.day = d.day
  left join consignment c on c.day = d.day;

comment on view reporting.daily_summary is
  'One row per shop day (D35) from the earliest activity (check-in, recognised entry, stock movement or appointment) up to today, zero-filled: job flows by current stamp (D31), shop-currency money from financial_lines (workshop lines and sales) with Cult Commons = sum of entry shares (D1, D32), parts and adjustments from the ledger (significant per D33), appointments by scheduled shop day and current status (D41), and consignment_sales (distinct documents with a consigned entry), consignment_sales_total and new_consignor_liability (Σ quantity x payout snapshot) from the consigned entries (Phase 6). Columns 1-27 are fixed; new measures are appended only after column 27. No API grants: read through public.daily_summary / today_dashboard (D30).';

revoke all on table reporting.daily_summary from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- list_consignors (active staff): counts for everyone, money gated (D48).
-- q matches every word of the name or email, or the phone digits (with or
-- without +65), like private.search_customers; include_archived true lists
-- archived consignors only (Phase 1's list-filter rule).
-- ---------------------------------------------------------------------------
create function public.list_consignors(
  q text default null,
  include_archived boolean default false,
  max_rows integer default 50
)
returns table (
  id uuid,
  display_name text,
  customer_id uuid,
  customer_label text,
  email text,
  phone text,
  archived_at timestamptz,
  active_items integer,
  awaiting_settlement_items integer,
  returned_items integer,
  owed numeric,
  paid numeric,
  outstanding numeric,
  last_sale_at timestamptz,
  last_settlement_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  show_money boolean;
  term text := pg_catalog.left(pg_catalog.btrim(coalesce(list_consignors.q, '')), 200);
  terms text[];
  patterns text[];
  digits text;
begin
  perform private.require_staff();
  show_money := private.can_view_consignment_money();
  terms := private.search_terms(term);
  patterns := array(select private.contains_pattern(t) from pg_catalog.unnest(terms) as t);
  digits := private.search_phone_digits(term);

  return query
    select
      c.id,
      c.display_name,
      c.customer_id,
      case when cu.id is not null then
        private.customer_label(cu.first_name, cu.last_name, cu.display_name, cu.email::text, cu.phone)
      end,
      c.email::text,
      c.phone,
      c.archived_at,
      l.active_items,
      l.awaiting_settlement_items,
      l.returned_items,
      case when show_money then l.owed end,
      case when show_money then l.paid end,
      case when show_money then l.outstanding end,
      l.last_sale_at,
      l.last_settlement_at
    from public.consignors c
    join reporting.consignor_ledger l on l.consignor_id = c.id
    left join public.customers cu on cu.id = c.customer_id
    where (c.archived_at is not null) = coalesce(list_consignors.include_archived, false)
      and (
        term = ''
        or (pg_catalog.cardinality(terms) > 0 and c.search_text like all (patterns))
        or (digits is not null and c.phone_digits like '%' || digits || '%')
      )
    order by c.display_name, c.id
    limit greatest(1, least(coalesce(list_consignors.max_rows, 50), 200));
end;
$$;

comment on function public.list_consignors(text, boolean, integer) is
  'Active staff: consignors (archived ones only with include_archived) by name, with item counts; owed, paid and outstanding need manage_consignments or view_costs and are NULL otherwise (D48). q: every word of name or email, or phone digits with or without +65. max_rows clamped to 1..200.';

-- ---------------------------------------------------------------------------
-- consignor_statement (active staff): one consignor's items, or one item.
-- The arguments are target_* because the result has consignor_id and
-- item_id columns (PL/pgSQL refuses an argument named like an output).
-- ---------------------------------------------------------------------------
create function public.consignor_statement(
  target_consignor_id uuid default null,
  target_item_id uuid default null
)
returns table (
  item_id uuid,
  short_id text,
  consignor_id uuid,
  consignor_name text,
  status public.consignment_status,
  quantity integer,
  sold_qty integer,
  restocked_qty integer,
  job_held_qty integer,
  job_sold_qty integer,
  returned_qty integer,
  remaining_qty integer,
  received_at timestamptz,
  sold_at timestamptz,
  returned_at timestamptz,
  return_reason text,
  asking_price numeric,
  last_sale_at timestamptz,
  last_settlement_at timestamptz,
  product_id uuid,
  product_short_id text,
  product_name text,
  inventory_unit_id uuid,
  unit_short_id text,
  unit_status public.unit_status,
  bike_id uuid,
  bike_short_id text,
  agreed_amount_owed numeric,
  liability numeric,
  consignor_charges numeric,
  shop_charges numeric,
  owed numeric,
  paid numeric,
  outstanding numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  show_money boolean;
begin
  perform private.require_staff();
  if (consignor_statement.target_consignor_id is null) = (consignor_statement.target_item_id is null) then
    raise exception 'give exactly one of target_consignor_id and target_item_id' using errcode = '22023';
  end if;
  show_money := private.can_view_consignment_money();

  return query
    select
      il.consignment_item_id,
      il.short_id,
      il.consignor_id,
      c.display_name,
      il.status,
      il.quantity,
      il.sold_qty,
      il.restocked_qty,
      il.job_held_qty,
      il.job_sold_qty,
      il.returned_qty,
      il.remaining_qty,
      il.received_at,
      il.sold_at,
      il.returned_at,
      il.return_reason,
      il.asking_price,
      il.last_sale_at,
      il.last_settlement_at,
      il.product_id,
      p.short_id::text,
      p.name,
      il.inventory_unit_id,
      u.short_id::text,
      u.status,
      u.bike_id,
      b.short_id::text,
      case when show_money then il.agreed_amount_owed end,
      case when show_money then il.liability end,
      case when show_money then il.consignor_charges end,
      case when show_money then il.shop_charges end,
      case when show_money then il.owed end,
      case when show_money then il.paid end,
      case when show_money then il.outstanding end
    from reporting.consignor_item_ledger il
    join public.consignors c on c.id = il.consignor_id
    join public.products p on p.id = il.product_id
    left join public.inventory_units u on u.id = il.inventory_unit_id
    left join public.bikes b on b.id = u.bike_id
    where (consignor_statement.target_consignor_id is null or il.consignor_id = consignor_statement.target_consignor_id)
      and (consignor_statement.target_item_id is null or il.consignment_item_id = consignor_statement.target_item_id)
    order by (il.status = 'active') desc, il.last_sale_at desc nulls last, il.received_at desc, il.short_id;
end;
$$;

comment on function public.consignor_statement(uuid, uuid) is
  'Active staff: the item ledger of one consignor (target_consignor_id) or one item (target_item_id), exactly one of them (22023 otherwise); active items first, then latest sale, then latest intake. Quantities, dates and asking price for everyone; agreed amount, liability, charges, owed, paid and outstanding need manage_consignments or view_costs (NULL otherwise, D48).';

-- ---------------------------------------------------------------------------
-- consignor_payout_details (manage_consignments only, D48).
-- ---------------------------------------------------------------------------
create function public.consignor_payout_details(consignor_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  details text;
begin
  perform private.require_permission('manage_consignments');
  select c.payout_details into details from public.consignors c where c.id = consignor_payout_details.consignor_id;
  if not found then
    raise exception 'consignor % not found', consignor_payout_details.consignor_id using errcode = 'P0002';
  end if;
  return details;
end;
$$;

comment on function public.consignor_payout_details(uuid) is
  'manage_consignments: a consignor''s bank or PayNow details (D48); P0002 for an unknown consignor.';

-- ---------------------------------------------------------------------------
-- list_sales (active staff): the Sales list, newest first. Totals and
-- refunds for everyone; cost, yield and Cult Commons need view_costs (D48).
-- [from_at, to_at); q: the sale number ignoring case and dash (exact or
-- contained), customer name words or line description words.
-- ---------------------------------------------------------------------------
create function public.list_sales(
  from_at timestamptz default null,
  to_at timestamptz default null,
  q text default null,
  max_rows integer default 50
)
returns table (
  id uuid,
  sale_number text,
  source public.sale_source,
  status public.sale_status,
  recognized_at timestamptz,
  customer_id uuid,
  customer_label text,
  line_count integer,
  first_description text,
  has_consignment boolean,
  restocked_lines integer,
  sale_total numeric,
  refunded_total numeric,
  cost_total numeric,
  yield_total numeric,
  cult_commons_share numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  costs boolean;
  term text := pg_catalog.left(pg_catalog.btrim(coalesce(list_sales.q, '')), 200);
  terms text[];
  patterns text[];
  key text;
begin
  perform private.require_staff();
  costs := private.can_view_sale_costs();
  terms := private.search_terms(term);
  patterns := array(select private.contains_pattern(t) from pg_catalog.unnest(terms) as t);
  key := private.search_key(term);

  return query
    select
      sa.id,
      sa.sale_number,
      sa.source,
      sa.status,
      sa.recognized_at,
      sa.customer_id,
      case when cu.id is not null then
        private.customer_label(cu.first_name, cu.last_name, cu.display_name, cu.email::text, cu.phone)
      end,
      agg.line_count,
      agg.first_description,
      agg.has_consignment,
      agg.restocked_lines,
      agg.sale_total,
      coalesce(rf.refunded, 0.00)::numeric,
      case when costs then agg.cost_total end,
      case when costs then agg.yield_total end,
      case when costs then agg.cult_commons_share end
    from public.sales sa
    left join public.customers cu on cu.id = sa.customer_id
    cross join lateral (
      select count(*)::integer as line_count,
             (pg_catalog.array_agg(sl.description_snapshot::text order by sl.line_number))[1] as first_description,
             coalesce(bool_or(sl.consignment_item_id is not null), false) as has_consignment,
             (count(*) filter (where sl.restocked_at is not null))::integer as restocked_lines,
             coalesce(sum(sl.sale_total), 0.00)::numeric as sale_total,
             coalesce(sum(sl.cost_total), 0.00)::numeric as cost_total,
             coalesce(sum(sl.yield_total), 0.00)::numeric as yield_total,
             coalesce(sum(sl.cult_commons_share), 0.00)::numeric as cult_commons_share
      from public.sale_lines sl
      where sl.sale_id = sa.id
    ) agg
    left join lateral (
      select sum(r.amount) as refunded from public.sale_refunds r where r.sale_id = sa.id
    ) rf on true
    where sa.status <> 'voided'
      and (list_sales.from_at is null or sa.recognized_at >= list_sales.from_at)
      and (list_sales.to_at is null or sa.recognized_at < list_sales.to_at)
      and (
        term = ''
        or (key is not null and pg_catalog.replace(sa.sale_number, '-', '') like '%' || key || '%')
        or (pg_catalog.cardinality(terms) > 0 and cu.search_text like all (patterns))
        or (pg_catalog.cardinality(terms) > 0 and exists (
          select 1 from public.sale_lines d
          where d.sale_id = sa.id and pg_catalog.lower(d.description_snapshot) like all (patterns)
        ))
      )
    order by sa.recognized_at desc, sa.id
    limit greatest(1, least(coalesce(list_sales.max_rows, 50), 200));
end;
$$;

comment on function public.list_sales(timestamptz, timestamptz, text, integer) is
  'Active staff: sales recognised in [from_at, to_at) (open bounds allowed), voided excluded, newest first; line count, first line, consignment and restock flags, total and refunds for everyone; cost, yield and Cult Commons need view_costs (NULL otherwise, D48). q: sale number (case and dash ignored, exact or contained), customer name words or line description words. max_rows clamped to 1..200.';

-- ---------------------------------------------------------------------------
-- sale_lines_detail (active staff): a sale's lines in line order. Prices
-- and totals for everyone; cost, yield, rate and Cult Commons need
-- view_costs; the payout snapshot needs consignment money access (D48).
-- An unknown sale returns no rows.
-- ---------------------------------------------------------------------------
create function public.sale_lines_detail(sale_id uuid)
returns table (
  id uuid,
  line_number integer,
  description_snapshot text,
  quantity numeric,
  unit_sale_price_snapshot numeric,
  sale_total numeric,
  restocked_at timestamptz,
  restocked_by_name text,
  product_id uuid,
  product_short_id text,
  inventory_unit_id uuid,
  unit_short_id text,
  unit_status public.unit_status,
  unit_sold_sale_line_id uuid,
  unit_ownership_type public.ownership_type,
  bike_id uuid,
  bike_short_id text,
  consignment_item_id uuid,
  consignment_short_id text,
  consignor_id uuid,
  consignor_name text,
  unit_direct_cost_snapshot numeric,
  cost_total numeric,
  yield_total numeric,
  cult_commons_rate_snapshot numeric,
  cult_commons_share numeric,
  consignor_payout_snapshot numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  costs boolean;
  show_money boolean;
begin
  perform private.require_staff();
  costs := private.can_view_sale_costs();
  show_money := private.can_view_consignment_money();

  return query
    select
      sl.id,
      sl.line_number::integer,
      sl.description_snapshot,
      sl.quantity::numeric,
      sl.unit_sale_price_snapshot::numeric,
      sl.sale_total::numeric,
      sl.restocked_at,
      st.display_name::text,
      sl.product_id,
      p.short_id::text,
      sl.inventory_unit_id,
      u.short_id::text,
      u.status,
      u.sold_sale_line_id,
      u.ownership_type,
      u.bike_id,
      b.short_id::text,
      sl.consignment_item_id,
      ci.short_id::text,
      ci.consignor_id,
      c.display_name,
      case when costs then sl.unit_direct_cost_snapshot::numeric end,
      case when costs then sl.cost_total::numeric end,
      case when costs then sl.yield_total::numeric end,
      case when costs then sl.cult_commons_rate_snapshot::numeric end,
      case when costs then sl.cult_commons_share::numeric end,
      case when show_money then sl.consignor_payout_snapshot::numeric end
    from public.sale_lines sl
    join public.products p on p.id = sl.product_id
    left join public.inventory_units u on u.id = sl.inventory_unit_id
    left join public.bikes b on b.id = u.bike_id
    left join public.consignment_items ci on ci.id = sl.consignment_item_id
    left join public.consignors c on c.id = ci.consignor_id
    left join public.staff st on st.id = sl.restocked_by
    where sl.sale_id = sale_lines_detail.sale_id
    order by sl.line_number;
end;
$$;

comment on function public.sale_lines_detail(uuid) is
  'Active staff: one sale''s lines in line order with their unit, bike and consignment; cost, yield, rate and Cult Commons need view_costs; the consignor payout snapshot needs manage_consignments or view_costs (NULL otherwise, D48). Unknown sale: no rows.';

-- ---------------------------------------------------------------------------
-- saleable_stock (active staff): what the sale sheet can sell.
--   unit     available shop-owned and consigned units (consigned: item
--            active), unit_price = private.selling_price(product, unit)
--   product  shop-owned active quantity products, one row per location
--            with on-hand > 0, unit_price = private.selling_price(product)
--   product  consigned quantity products, one row per (location with
--            on-hand > 0, active item with remaining > 0), on_hand =
--            least(location on-hand, remaining), unit_price = the item's
--            asking price, else the product default (D45: equal to
--            selling_price for the FIFO head)
-- Rank: exact U-/P-/C- ID, SKU or serial 1.0; an ID containing q (>= 3
-- characters) 0.6; every word of q in name/brand (and consignor name)
-- 0.45 + 0.4 x word similarity (Phase 4's rule). Blank q returns nothing;
-- max_results clamped to 1..50.
-- ---------------------------------------------------------------------------
create function public.saleable_stock(q text, max_results integer default 20)
returns table (
  kind text,
  product_id uuid,
  product_short_id text,
  inventory_unit_id uuid,
  unit_short_id text,
  title text,
  subtitle text,
  location_id uuid,
  location_name text,
  on_hand integer,
  unit_price numeric,
  ownership_type public.ownership_type,
  consignment_item_id uuid,
  consignment_short_id text,
  consignor_name text,
  rank real
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  term text := pg_catalog.left(pg_catalog.btrim(coalesce(saleable_stock.q, '')), 200);
  n integer := greatest(1, least(coalesce(saleable_stock.max_results, 20), 50));
  terms text[];
  patterns text[];
  lq text;
  key text;
begin
  perform private.require_staff();
  if term = '' then
    return;
  end if;
  terms := private.search_terms(term);
  patterns := array(select private.contains_pattern(t) from pg_catalog.unnest(terms) as t);
  lq := pg_catalog.lower(term);
  key := private.search_key(term);

  return query
    with
    stock as (
      select m.product_id, m.location_id, sum(m.quantity_delta)::integer as qty
      from public.inventory_movements m
      join public.products p on p.id = m.product_id
      where p.tracking_type = 'quantity'
      group by m.product_id, m.location_id
      having sum(m.quantity_delta) > 0
    ),
    candidates as (
      select 'unit'::text as c_kind, p.id as c_product_id, p.short_id::text as c_product_short_id,
             u.id as c_unit_id, u.short_id::text as c_unit_short_id, p.name::text as c_title,
             pg_catalog.concat_ws(
               ' · ', u.short_id, 'S/N ' || u.serial_number, l.name,
               case when ci.id is not null then ci.short_id || ' · consigned by ' || c.display_name end
             ) as c_subtitle,
             u.location_id as c_location_id, l.name::text as c_location_name, 1 as c_on_hand,
             private.selling_price(p.id, u.id)::numeric as c_unit_price, u.ownership_type as c_ownership,
             ci.id as c_item_id, ci.short_id::text as c_item_short_id, c.display_name::text as c_consignor,
             pg_catalog.lower(p.name || ' ' || coalesce(p.brand, '') || ' ' || coalesce(c.display_name, ''))
               as c_words,
             array[u.short_id, p.short_id, ci.short_id]::text[] as c_ids,
             p.sku_key as c_sku_key, u.serial_key as c_serial_key
      from public.inventory_units u
      join public.products p on p.id = u.product_id
      join public.locations l on l.id = u.location_id
      left join public.consignment_items ci on ci.id = u.consignment_item_id
      left join public.consignors c on c.id = ci.consignor_id
      where u.status = 'available' and u.archived_at is null and u.ownership_type <> 'customer_owned'
        and (ci.id is null or ci.status = 'active')
      union all
      select 'product', p.id, p.short_id::text, null::uuid, null::text, p.name::text,
             pg_catalog.concat_ws(' · ', p.short_id, p.sku, s.qty::text || ' at ' || l.name),
             s.location_id, l.name::text, s.qty, private.selling_price(p.id, null)::numeric, p.ownership_type,
             null::uuid, null::text, null::text,
             pg_catalog.lower(p.name || ' ' || coalesce(p.brand, '')),
             array[p.short_id]::text[], p.sku_key, null::text
      from public.products p
      join stock s on s.product_id = p.id
      join public.locations l on l.id = s.location_id
      where p.tracking_type = 'quantity' and p.ownership_type = 'shop_owned' and p.active and p.archived_at is null
      union all
      select 'product', p.id, p.short_id::text, null::uuid, null::text, p.name::text,
             pg_catalog.concat_ws(
               ' · ', p.short_id, ci.short_id || ' · consigned by ' || c.display_name,
               least(s.qty, pos.remaining_qty)::text || ' at ' || l.name
             ),
             s.location_id, l.name::text, least(s.qty, pos.remaining_qty),
             coalesce(ci.asking_price, p.default_sale_price)::numeric, p.ownership_type,
             ci.id, ci.short_id::text, c.display_name::text,
             pg_catalog.lower(p.name || ' ' || coalesce(p.brand, '') || ' ' || c.display_name),
             array[p.short_id, ci.short_id]::text[], p.sku_key, null::text
      from public.products p
      join stock s on s.product_id = p.id
      join public.locations l on l.id = s.location_id
      join public.consignment_items ci on ci.product_id = p.id and ci.status = 'active'
      join reporting.consignment_item_position pos on pos.consignment_item_id = ci.id and pos.remaining_qty > 0
      join public.consignors c on c.id = ci.consignor_id
      where p.tracking_type = 'quantity' and p.ownership_type = 'consignment' and p.active and p.archived_at is null
    ),
    ranked as (
      select cd.*,
             greatest(
               case when key is not null and (
                      exists (select 1 from pg_catalog.unnest(cd.c_ids) x(sid) where pg_catalog.replace(x.sid, '-', '') = key)
                      or cd.c_sku_key = key or cd.c_serial_key = key
                    ) then 1.0 end,
               case when pg_catalog.length(key) >= 3 and exists (
                      select 1 from pg_catalog.unnest(cd.c_ids) x(sid)
                      where pg_catalog.replace(x.sid, '-', '') like '%' || key || '%'
                    ) then 0.6 end,
               case when pg_catalog.cardinality(terms) > 0 and cd.c_words like all (patterns)
                 then 0.45 + 0.4 * extensions.word_similarity(lq, cd.c_words) end
             )::real as c_rank
      from candidates cd
    )
    select r.c_kind, r.c_product_id, r.c_product_short_id, r.c_unit_id, r.c_unit_short_id, r.c_title, r.c_subtitle,
           r.c_location_id, r.c_location_name, r.c_on_hand, r.c_unit_price, r.c_ownership, r.c_item_id,
           r.c_item_short_id, r.c_consignor, r.c_rank
    from ranked r
    where r.c_rank is not null
    order by r.c_rank desc, r.c_title, r.c_kind, r.c_unit_short_id, r.c_location_name, r.c_item_short_id
    limit n;
end;
$$;

comment on function public.saleable_stock(text, integer) is
  'Active staff: available units (shop-owned and consigned) and quantity stock per location (consigned: per active item with stock left, at its asking price) matching q, for the sale sheet; unit_price is the single selling price (D45). Exact U-/P-/C- ID, SKU or serial first. No cost.';

-- ---------------------------------------------------------------------------
-- staff_search kinds (Phase 6): consignors, consignment items and sales,
-- in the style of private.search_units / search_work_orders.
--   consignor         every word of q in name/email (0.5-0.9), phone digits
--                     contained (0.6), exact email or phone (0.95); archived
--                     consignors only with archived = true
--   consignment_item  exact C- ID (1.0), C- ID containing q (>= 3, 0.6),
--                     every word of q in the product's name/brand and the
--                     consignor's name (0.45-0.85); never archived
--   sale              exact S- number (1.0), number containing q (>= 3,
--                     0.6); never archived; voided sales are left out
-- Nothing here is a cost.
-- ---------------------------------------------------------------------------
create function private.search_consignors(q text, max_results integer, archived boolean)
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
  matched as (
    select c.id
    from public.consignors c, input i
    where pg_catalog.cardinality(i.terms) > 0
      and c.search_text like i.anchor
      and c.search_text like all (i.patterns)
    union
    select c.id
    from public.consignors c, input i
    where i.digits is not null
      and c.phone_digits like '%' || i.digits || '%'
  )
  select
    'consignor'::text,
    c.id,
    c.display_name,
    nullif(pg_catalog.concat_ws(' · ', c.email::text, c.phone), ''),
    null::text,
    greatest(
      case when pg_catalog.lower(c.email::text) = i.lq then 0.95 end,
      case when pg_catalog.length(i.digits) >= 8
            and (c.phone_digits = i.digits or c.phone_digits = '65' || i.digits) then 0.95 end,
      case when i.digits is not null and c.phone_digits like '%' || i.digits || '%' then 0.6 end,
      case when pg_catalog.cardinality(i.terms) > 0 and c.search_text like all (i.patterns)
        then 0.5 + 0.4 * extensions.word_similarity(i.lq, c.search_text) end
    )::real
  from matched m
  join public.consignors c on c.id = m.id
  cross join input i
  where (c.archived_at is not null) = search_consignors.archived
  order by 6 desc, 3, 2
  limit max_results;
$$;

create function private.search_consignment_items(q text, max_results integer, archived boolean)
returns table (kind text, id uuid, title text, subtitle text, short_id text, rank real)
language sql
stable
set search_path = ''
as $$
  with input as (
    select
      s.terms,
      array(select private.contains_pattern(t) from pg_catalog.unnest(s.terms) as t) as patterns,
      pg_catalog.lower(pg_catalog.btrim(q)) as lq,
      private.search_key(q) as key
    from (select private.search_terms(q) as terms) s
  ),
  matched as (
    select ci.id
    from public.consignment_items ci, input i
    where i.key is not null
      and ci.short_id = pg_catalog.substr(i.key, 1, 1) || '-' || pg_catalog.substr(i.key, 2)
    union
    select ci.id
    from public.consignment_items ci, input i
    where pg_catalog.length(i.key) >= 3
      and pg_catalog.replace(ci.short_id, '-', '') like '%' || i.key || '%'
    union
    select ci.id
    from public.consignment_items ci
    join public.products p on p.id = ci.product_id
    join public.consignors c on c.id = ci.consignor_id
    cross join input i
    where pg_catalog.cardinality(i.terms) > 0
      and pg_catalog.lower(p.name || ' ' || coalesce(p.brand, '') || ' ' || c.display_name) like all (i.patterns)
  )
  select
    'consignment_item'::text,
    ci.id,
    p.name,
    pg_catalog.concat_ws(
      ' · ',
      c.display_name,
      case ci.status
        when 'active' then 'Active'
        when 'sold' then 'Sold'
        when 'returned' then 'Returned'
        when 'withdrawn' then 'Withdrawn'
      end,
      coalesce(u.short_id, 'Qty ' || ci.quantity::text)
    ),
    ci.short_id,
    greatest(
      case when ci.short_id = pg_catalog.substr(i.key, 1, 1) || '-' || pg_catalog.substr(i.key, 2) then 1.0 end,
      case when pg_catalog.length(i.key) >= 3
            and pg_catalog.replace(ci.short_id, '-', '') like '%' || i.key || '%' then 0.6 end,
      case when pg_catalog.cardinality(i.terms) > 0
            and pg_catalog.lower(p.name || ' ' || coalesce(p.brand, '') || ' ' || c.display_name) like all (i.patterns)
        then 0.45 + 0.4 * extensions.word_similarity(
          i.lq, pg_catalog.lower(p.name || ' ' || coalesce(p.brand, '') || ' ' || c.display_name)
        ) end
    )::real
  from matched m
  join public.consignment_items ci on ci.id = m.id
  join public.products p on p.id = ci.product_id
  join public.consignors c on c.id = ci.consignor_id
  left join public.inventory_units u on u.id = ci.inventory_unit_id
  cross join input i
  where not search_consignment_items.archived
  order by 6 desc, 3, 2
  limit max_results;
$$;

create function private.search_sales(q text, max_results integer, archived boolean)
returns table (kind text, id uuid, title text, subtitle text, short_id text, rank real)
language sql
stable
set search_path = ''
as $$
  with input as (
    select private.search_key(q) as key
  ),
  matched as (
    select sa.id
    from public.sales sa, input i
    where i.key is not null
      and sa.sale_number = pg_catalog.substr(i.key, 1, 1) || '-' || pg_catalog.substr(i.key, 2)
    union
    select sa.id
    from public.sales sa, input i
    where pg_catalog.length(i.key) >= 3
      and pg_catalog.replace(sa.sale_number, '-', '') like '%' || i.key || '%'
  )
  select
    'sale'::text,
    sa.id,
    sa.sale_number || ' · $' || pg_catalog.to_char(
      coalesce((select sum(sl.sale_total) from public.sale_lines sl where sl.sale_id = sa.id), 0),
      'FM999,999,990.00'
    ),
    pg_catalog.concat_ws(
      ' · ',
      case when cu.id is null then 'Walk-in'
        else private.customer_label(cu.first_name, cu.last_name, cu.display_name, cu.email::text, cu.phone)
      end,
      pg_catalog.to_char(private.shop_day(sa.recognized_at), 'FMDD Mon YYYY')
    ),
    sa.sale_number,
    greatest(
      case when sa.sale_number = pg_catalog.substr(i.key, 1, 1) || '-' || pg_catalog.substr(i.key, 2) then 1.0 end,
      case when pg_catalog.length(i.key) >= 3
            and pg_catalog.replace(sa.sale_number, '-', '') like '%' || i.key || '%' then 0.6 end
    )::real
  from matched m
  join public.sales sa on sa.id = m.id
  left join public.customers cu on cu.id = sa.customer_id
  cross join input i
  where not search_sales.archived
    and sa.status <> 'voided'
  order by 6 desc, 3, 2
  limit max_results;
$$;

-- Active staff. Blank q returns nothing; kinds null means every kind and
-- an unknown kind raises 22023; max_results is clamped to 1..100; archived
-- true searches archived records only (customers, bikes, products, units,
-- consignors; jobs, consignment items and sales are never archived).
-- Phase 3 added `work_order`, Phase 4 `product` and `inventory_unit`;
-- Phase 6 adds `consignor`, `consignment_item` and `sale`.
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
    'customer', 'bike', 'work_order', 'product', 'inventory_unit', 'consignor', 'consignment_item', 'sale'
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
      select * from private.search_consignors(term, n, coalesce(staff_search.archived, false))
      where staff_search.kinds is null or 'consignor' = any (staff_search.kinds)
      union all
      select * from private.search_consignment_items(term, n, coalesce(staff_search.archived, false))
      where staff_search.kinds is null or 'consignment_item' = any (staff_search.kinds)
      union all
      select * from private.search_sales(term, n, coalesce(staff_search.archived, false))
      where staff_search.kinds is null or 'sale' = any (staff_search.kinds)
    ) h
    order by h.rank desc, h.kind, h.title, h.id
    limit n;
end;
$$;

comment on function public.staff_search(text, text[], integer, boolean) is
  'Active staff: global search across customers, bikes, jobs, products, units, consignors, consignment items and sales (later phases add kinds); exact short ID, serial, SKU, job and sale number first; archived=true searches archived records.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function
  private.search_consignors(text, integer, boolean),
  private.search_consignment_items(text, integer, boolean),
  private.search_sales(text, integer, boolean)
from public, anon, authenticated, service_role;

revoke all on function
  public.list_consignors(text, boolean, integer),
  public.consignor_statement(uuid, uuid),
  public.consignor_payout_details(uuid),
  public.list_sales(timestamptz, timestamptz, text, integer),
  public.sale_lines_detail(uuid),
  public.saleable_stock(text, integer),
  public.staff_search(text, text[], integer, boolean)
from public, anon, authenticated, service_role;

grant execute on function
  public.list_consignors(text, boolean, integer),
  public.consignor_statement(uuid, uuid),
  public.consignor_payout_details(uuid),
  public.list_sales(timestamptz, timestamptz, text, integer),
  public.sale_lines_detail(uuid),
  public.saleable_stock(text, integer),
  public.staff_search(text, text[], integer, boolean)
to authenticated;
