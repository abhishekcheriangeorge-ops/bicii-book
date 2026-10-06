-- Period reporting: date bases, report lines and the period RPCs (SPEC
-- §19.2 "Reports must distinguish operational dates ... Do not create
-- manually maintained report totals as a second truth", §23, §24;
-- DATA-MODEL.md §14, §15, §16; PLAN D1, D30 FIN-ACCESS, D32 RECOGNITION,
-- D35 SHOP-TZ, D100 REPORT-BASES, D101 REPORT-RESTATEMENT, D102
-- REPORT-REFUNDS, D103 REPORT-MECHANIC, D104 REPORT-CURRENCY; record
-- ADR-022).
--
-- This migration only READS source records: nothing here changes stock,
-- money, settlements or unit status, and nothing is stored (SPEC §19.2).
-- Every Phase 5 and Phase 6 object keeps its name, columns and results:
-- reporting.daily_summary, public.daily_summary and public.today_dashboard
-- are unchanged, and new measures exist only in the RPCs below.
--
-- Rules encoded here:
--   * D100: four date bases. `sale` (the default) is exactly
--     reporting.financial_lines: workshop lines on their job's CURRENT
--     completed_at (D3/D15/D32), retail and online sale lines on the sale's
--     recognized_at. `check_in`, `completion` and `collection` cover
--     workshop lines only, dated by their job's checked_in_at,
--     completed_at or collected_at; check_in includes work in progress.
--     Cancelled jobs carry no money (D16). Days are shop days (D35), weeks
--     ISO (Monday), months calendar months; a range is at most 731 days.
--   * D101: reports reflect the current source records. A reopen, a
--     back-dated sale or a back-dated receipt restates past days; there is
--     no period close and no stored total.
--   * D102: refunds are their own figure (refunds_total, by
--     sale_refunds.created_at, shop currency, sale basis only); gross,
--     cost, yield and Cult Commons are never netted, and Cult Commons is
--     not clawed back. Build default for owner question 12.
--   * D103: mechanic attribution is the job's CURRENT lead mechanic;
--     'unassigned' without a lead, 'not_workshop' for retail and online.
--   * D104: totals are in private.shop_currency() only; lines in another
--     currency are excluded and counted (excluded_foreign_line_count).
--   * D1: Cult Commons is always the SUM of the lines' own shares, never 30%
--     of an aggregated yield; yield_after_cc = Σ yield - Σ share.
--   * D30 FIN-ACCESS: the financial RPCs need view_financial_reports;
--     every cost-derived column is NULL without view_costs. Gross figures
--     and counts are always returned. The activity RPCs are for any active
--     staff member and return no money.
--   * Shop days: each RPC computes its half-open instant range once
--     (private.shop_day_start(p_from) .. private.shop_day_start(p_to + 1)),
--     filters the raw timestamptz columns with it (index-friendly) and
--     buckets only after filtering, inline with
--     `(ts at time zone v_tz)::date`, which is private.shop_day's own
--     definition with the time zone read once (the bench in
--     scripts/bench/report-volume.sql measured the per-row helper call;
--     DATA-MODEL §14).

-- ---------------------------------------------------------------------------
-- Vocabulary
-- ---------------------------------------------------------------------------
create type public.report_date_basis as enum ('sale', 'check_in', 'completion', 'collection');
comment on type public.report_date_basis is
  'D100 REPORT-BASES: which date a report counts a line on. sale = reporting.financial_lines (workshop at the job''s current completed_at, sales at recognized_at); check_in / completion / collection = workshop lines by their job''s stamp (check_in includes work in progress).';

create type public.report_grain as enum ('day', 'week', 'month');
comment on type public.report_grain is
  'D100: series buckets: shop days (D35), ISO weeks starting Monday, calendar months.';

create type public.report_dimension as enum (
  'job', 'product', 'category', 'service', 'mechanic', 'ownership', 'channel'
);
comment on type public.report_dimension is
  'Breakdown dimensions of the period reports. channel matches financial_lines.channel (workshop | retail | online); there is no source dimension (financial_lines.source means work_order versus sale).';

-- ---------------------------------------------------------------------------
-- reporting.financial_lines: the Phase 6 definition with ONE change, the
-- explicit exclusion of 'work_order' sales in the sale branch.
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
  where sa.status <> 'voided'
    -- Phase 9: a 'work_order' sale is reserved and never written (no RPC
    -- inserts one). If one existed, its lines would double-count the job's
    -- own work_order_line_items, which the work-order branch already
    -- recognises. Any NEW sale_source value reaches the channel CASE above
    -- without an arm (a NULL channel), which the channel-partition test in
    -- tests/db/period-reports.test.ts catches.
    and sa.source <> 'work_order';

comment on view reporting.financial_lines is
  'One row per recognised revenue entry: every live line of a job with a current completed_at, on that shop day (D32), and every line of a sale that is not voided (and not of the reserved source work_order), at the sale''s recognized_at (D35); amounts from the line snapshots only; Cult Commons per entry = the line''s share (>= 0, D1); cost_pending flagged (D14); refunds not subtracted and restocked lines kept (D49, D102). Vocabulary: source work_order|sale, channel workshop|retail|online, document_id = work_orders.id|sales.id, document_number = J-|S- number, entry_kind line, entry_key wol:|sl: + line id. No API grants: read through public.financial_lines / daily_summary and the Phase 9 report RPCs (D30).';

revoke all on table reporting.financial_lines from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- reporting.report_lines: every non-voided line that carries money on any
-- basis (D100). Branch 1 is reporting.financial_lines (so the sale basis is
-- financial_lines by construction) with its job's stamps; branch 2 is the
-- work in progress: the live lines of jobs not completed and not cancelled,
-- with the same expressions as financial_lines' work-order branch and no
-- recognition. A job reopened under D15 is back in branch 2 until it is
-- completed again (D32).
-- ---------------------------------------------------------------------------
create view reporting.report_lines
with (security_invoker = true)
as
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
    fl.unit_direct_cost,
    fl.cult_commons_rate,
    fl.sale_total,
    fl.cost_total,
    fl.yield_total,
    fl.cult_commons_share,
    fl.bicii_yield_after_cc,
    fl.is_loss,
    fl.currency,
    fl.cost_pending,
    wo.checked_in_at,
    wo.completed_at,
    wo.collected_at,
    true as recognised
  from reporting.financial_lines fl
  left join public.work_orders wo on fl.source = 'work_order' and wo.id = fl.document_id
  union all
  select
    ('wol:' || l.id::text)::text as entry_key,
    'work_order'::text as source,
    'line'::text as entry_kind,
    l.id as source_line_id,
    wo.id as document_id,
    wo.job_number::text as document_number,
    'workshop'::text as channel,
    null::timestamptz as recognized_at,
    null::date as recognized_day,
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
    l.cost_pending,
    wo.checked_in_at,
    wo.completed_at,
    wo.collected_at,
    false as recognised
  from public.work_order_line_items l
  join public.work_orders wo on wo.id = l.work_order_id
  left join public.services s on s.id = l.source_service_id
  left join public.products p on p.id = l.source_product_id
  left join public.inventory_units u on u.id = l.source_inventory_unit_id
  where wo.completed_at is null
    and wo.status <> 'cancelled'
    and l.voided_at is null;

comment on view reporting.report_lines is
  'D100: every non-voided line that carries money on any date basis: reporting.financial_lines (recognised = true) with its job''s checked_in_at, completed_at and collected_at, plus the live lines of jobs neither completed nor cancelled (work in progress, recognised = false, recognized_at NULL). Same columns as financial_lines, then checked_in_at, completed_at, collected_at, recognised. No API grants: read through the Phase 9 report RPCs (D30).';

revoke all on table reporting.report_lines from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Argument guards (P0001 report_range_invalid, reused from Phase 5;
-- report_range_too_long and report_key_invalid, new).
-- ---------------------------------------------------------------------------
create function private.report_require_range(p_from date, p_to date)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_from is null or p_to is null then
    raise exception using
      errcode = 'P0001',
      message = 'report_range_invalid',
      detail = 'A report needs a start day and an end day.';
  end if;
  if p_to < p_from then
    raise exception using
      errcode = 'P0001',
      message = 'report_range_invalid',
      detail = 'The start day is after the end day.';
  end if;
  if p_to - p_from > 730 then
    raise exception using
      errcode = 'P0001',
      message = 'report_range_too_long',
      detail = 'A report covers at most 731 days.';
  end if;
end;
$$;

comment on function private.report_require_range(date, date) is
  'D100: a report range needs both days, start <= end (report_range_invalid) and at most 731 days (report_range_too_long).';

-- The pseudo keys of each dimension (every other key is a uuid, except for
-- ownership and channel, whose keys are all pseudo keys).
create function private.report_key_valid(p_dimension public.report_dimension, p_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_key is null or p_dimension is null then false
    when p_dimension = 'ownership' then p_key in ('shop_owned', 'consignment', 'customer_owned', 'service')
    when p_dimension = 'channel' then p_key in ('workshop', 'retail', 'online')
    when p_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then true
    when p_dimension = 'product' then p_key = 'none'
    when p_dimension = 'category' then p_key = 'none'
    when p_dimension = 'service' then p_key in ('products', 'manual')
    when p_dimension = 'mechanic' then p_key in ('unassigned', 'not_workshop')
    else false
  end;
$$;

comment on function private.report_key_valid(public.report_dimension, text) is
  'True when p_key is a lowercase uuid (job, product, category, service, mechanic) or one of the dimension''s pseudo keys: product none; category none; service products | manual; mechanic unassigned | not_workshop; ownership shop_owned | consignment | customer_owned | service; channel workshop | retail | online.';

-- ---------------------------------------------------------------------------
-- private.report_rows: the lines a basis counts in [p_from, p_to], shop
-- currency (or, p_foreign, every other currency), each with its basis_at.
-- One query per basis; the keyset cursor and an optional limit go INSIDE
-- each query, so a page never materialises the whole range.
-- ---------------------------------------------------------------------------
create function private.report_rows(
  p_from date,
  p_to date,
  p_basis public.report_date_basis,
  p_after_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default null,
  p_foreign boolean default false
)
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
  cost_pending boolean,
  checked_in_at timestamptz,
  completed_at timestamptz,
  collected_at timestamptz,
  recognised boolean,
  basis_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start timestamptz := private.shop_day_start(p_from);
  v_end timestamptz := private.shop_day_start(p_to + 1);
  v_currency text := private.shop_currency();
  v_tz text := private.shop_timezone();
  v_basis public.report_date_basis := coalesce(p_basis, 'sale');
  -- Page bounds (only with p_limit): the basis instant of the p_limit-th
  -- newest job (sale) that has a counted line and lies before the cursor.
  -- Each such document has at least one line after the cursor, so no line
  -- older than that instant can be on the page; the bound lets each
  -- per-basis query read a few documents through the stamp's index instead
  -- of the whole range. Without p_limit (or with fewer documents) the
  -- bound is the range start.
  v_before timestamptz := least(coalesce(p_after_at, v_end), v_end);
  v_t_wo timestamptz;
  v_t_sa timestamptz;
begin
  if p_limit is not null and p_limit > 0 then
    if v_basis in ('sale', 'completion') then
      select wo.completed_at into v_t_wo
      from public.work_orders wo
      where wo.completed_at >= v_start and wo.completed_at < v_before
        and exists (
          select 1 from public.work_order_line_items l
          where l.work_order_id = wo.id and l.voided_at is null
            and (l.currency::text = v_currency) is distinct from p_foreign
        )
      order by wo.completed_at desc
      offset p_limit - 1 limit 1;
    elsif v_basis = 'collection' then
      select wo.collected_at into v_t_wo
      from public.work_orders wo
      where wo.collected_at >= v_start and wo.collected_at < v_before
        and exists (
          select 1 from public.work_order_line_items l
          where l.work_order_id = wo.id and l.voided_at is null
            and (l.currency::text = v_currency) is distinct from p_foreign
        )
      order by wo.collected_at desc
      offset p_limit - 1 limit 1;
    else
      select wo.checked_in_at into v_t_wo
      from public.work_orders wo
      where wo.checked_in_at >= v_start and wo.checked_in_at < v_before
        and wo.status <> 'cancelled'
        and exists (
          select 1 from public.work_order_line_items l
          where l.work_order_id = wo.id and l.voided_at is null
            and (l.currency::text = v_currency) is distinct from p_foreign
        )
      order by wo.checked_in_at desc
      offset p_limit - 1 limit 1;
    end if;
    if v_basis = 'sale' then
      select sa.recognized_at into v_t_sa
      from public.sales sa
      where sa.recognized_at >= v_start and sa.recognized_at < v_before
        and sa.status <> 'voided' and sa.source <> 'work_order'
        and exists (
          select 1 from public.sale_lines sl
          where sl.sale_id = sa.id and (sl.currency::text = v_currency) is distinct from p_foreign
        )
      order by sa.recognized_at desc
      offset p_limit - 1 limit 1;
    end if;
  end if;
  v_t_wo := coalesce(v_t_wo, v_start);
  v_t_sa := coalesce(v_t_sa, v_start);

  if v_basis = 'sale' then
    return query
      select rl.entry_key, rl.source, rl.entry_kind, rl.source_line_id, rl.document_id, rl.document_number,
             rl.channel, rl.recognized_at, (rl.recognized_at at time zone v_tz)::date, rl.line_type,
             rl.service_id, rl.product_id, rl.inventory_unit_id, rl.category_id, rl.ownership_type,
             rl.consignment_item_id, rl.customer_id, rl.bike_id, rl.lead_mechanic_id, rl.description,
             rl.quantity, rl.unit_sale_price, rl.unit_direct_cost, rl.cult_commons_rate, rl.sale_total,
             rl.cost_total, rl.yield_total, rl.cult_commons_share, rl.bicii_yield_after_cc, rl.is_loss,
             rl.currency, rl.cost_pending, rl.checked_in_at, rl.completed_at, rl.collected_at,
             rl.recognised, rl.recognized_at
      from reporting.report_lines rl
      where rl.recognised
        and rl.recognized_at >= v_start
        and rl.recognized_at < v_end
        and (rl.currency = v_currency) is distinct from p_foreign
        and (rl.source <> 'work_order' or rl.recognized_at >= v_t_wo)
        and (rl.source <> 'sale' or rl.recognized_at >= v_t_sa)
        and (p_after_at is null or (rl.recognized_at, rl.source_line_id) < (p_after_at, p_after_id))
      order by rl.recognized_at desc, rl.source_line_id desc
      limit p_limit;
  elsif v_basis = 'completion' then
    -- A workshop line's recognized_at IS its job's current completed_at.
    return query
      select rl.entry_key, rl.source, rl.entry_kind, rl.source_line_id, rl.document_id, rl.document_number,
             rl.channel, rl.recognized_at, (rl.recognized_at at time zone v_tz)::date, rl.line_type,
             rl.service_id, rl.product_id, rl.inventory_unit_id, rl.category_id, rl.ownership_type,
             rl.consignment_item_id, rl.customer_id, rl.bike_id, rl.lead_mechanic_id, rl.description,
             rl.quantity, rl.unit_sale_price, rl.unit_direct_cost, rl.cult_commons_rate, rl.sale_total,
             rl.cost_total, rl.yield_total, rl.cult_commons_share, rl.bicii_yield_after_cc, rl.is_loss,
             rl.currency, rl.cost_pending, rl.checked_in_at, rl.completed_at, rl.collected_at,
             rl.recognised, rl.recognized_at
      from reporting.report_lines rl
      where rl.source = 'work_order'
        and rl.recognised
        and rl.recognized_at >= v_start
        and rl.recognized_at < v_end
        and (rl.currency = v_currency) is distinct from p_foreign
        and rl.recognized_at >= v_t_wo
        and (p_after_at is null or (rl.recognized_at, rl.source_line_id) < (p_after_at, p_after_id))
      order by rl.recognized_at desc, rl.source_line_id desc
      limit p_limit;
  elsif v_basis = 'collection' then
    return query
      select rl.entry_key, rl.source, rl.entry_kind, rl.source_line_id, rl.document_id, rl.document_number,
             rl.channel, rl.recognized_at, (rl.recognized_at at time zone v_tz)::date, rl.line_type,
             rl.service_id, rl.product_id, rl.inventory_unit_id, rl.category_id, rl.ownership_type,
             rl.consignment_item_id, rl.customer_id, rl.bike_id, rl.lead_mechanic_id, rl.description,
             rl.quantity, rl.unit_sale_price, rl.unit_direct_cost, rl.cult_commons_rate, rl.sale_total,
             rl.cost_total, rl.yield_total, rl.cult_commons_share, rl.bicii_yield_after_cc, rl.is_loss,
             rl.currency, rl.cost_pending, rl.checked_in_at, rl.completed_at, rl.collected_at,
             rl.recognised, rl.collected_at
      from reporting.report_lines rl
      where rl.source = 'work_order'
        and rl.collected_at >= v_start
        and rl.collected_at < v_end
        and (rl.currency = v_currency) is distinct from p_foreign
        and rl.collected_at >= v_t_wo
        and (p_after_at is null or (rl.collected_at, rl.source_line_id) < (p_after_at, p_after_id))
      order by rl.collected_at desc, rl.source_line_id desc
      limit p_limit;
  else
    -- check_in: both branches (work in progress included).
    return query
      select rl.entry_key, rl.source, rl.entry_kind, rl.source_line_id, rl.document_id, rl.document_number,
             rl.channel, rl.recognized_at, (rl.recognized_at at time zone v_tz)::date, rl.line_type,
             rl.service_id, rl.product_id, rl.inventory_unit_id, rl.category_id, rl.ownership_type,
             rl.consignment_item_id, rl.customer_id, rl.bike_id, rl.lead_mechanic_id, rl.description,
             rl.quantity, rl.unit_sale_price, rl.unit_direct_cost, rl.cult_commons_rate, rl.sale_total,
             rl.cost_total, rl.yield_total, rl.cult_commons_share, rl.bicii_yield_after_cc, rl.is_loss,
             rl.currency, rl.cost_pending, rl.checked_in_at, rl.completed_at, rl.collected_at,
             rl.recognised, rl.checked_in_at
      from reporting.report_lines rl
      where rl.source = 'work_order'
        and rl.checked_in_at >= v_start
        and rl.checked_in_at < v_end
        and (rl.currency = v_currency) is distinct from p_foreign
        and rl.checked_in_at >= v_t_wo
        and (p_after_at is null or (rl.checked_in_at, rl.source_line_id) < (p_after_at, p_after_id))
      order by rl.checked_in_at desc, rl.source_line_id desc
      limit p_limit;
  end if;
end;
$$;

comment on function private.report_rows(date, date, public.report_date_basis, timestamptz, uuid, integer, boolean) is
  'D100/D104: the report_lines a basis counts in the shop days p_from..p_to (no range check: callers check), in the shop currency (p_foreign: in any other), newest basis_at first; the keyset cursor (basis_at, source_line_id) < (p_after_at, p_after_id) and p_limit apply inside each per-basis query, with p_limit also bounding the instants read (the p_limit-th newest document with a counted line before the cursor). basis_at = recognized_at (sale, completion), collected_at or checked_in_at.';

create function private.report_foreign_rows(p_from date, p_to date, p_basis public.report_date_basis)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from private.report_rows(p_from, p_to, p_basis, null, null, null, true);
$$;

comment on function private.report_foreign_rows(date, date, public.report_date_basis) is
  'D104: how many lines the basis would count in p_from..p_to in a currency other than the shop''s (excluded from every total; raised as currency_mismatch).';

-- The group key of a report row in a dimension (inline CASE kept in one
-- place for the breakdown and the line items).
create function private.report_key(
  p_dimension public.report_dimension,
  p_source text,
  p_document_id uuid,
  p_product_id uuid,
  p_category_id uuid,
  p_service_id uuid,
  p_line_type text,
  p_lead_mechanic_id uuid,
  p_ownership_type text,
  p_channel text
)
returns text
language sql
immutable
as $$
  select case p_dimension
    when 'job' then p_document_id::text
    when 'product' then coalesce(p_product_id::text, 'none')
    when 'category' then coalesce(p_category_id::text, 'none')
    when 'service' then
      case
        when p_service_id is not null then p_service_id::text
        when p_line_type = 'manual' then 'manual'
        else 'products'
      end
    when 'mechanic' then
      case when p_source = 'sale' then 'not_workshop' else coalesce(p_lead_mechanic_id::text, 'unassigned') end
    when 'ownership' then
      case when p_line_type in ('service', 'manual') then 'service' else p_ownership_type end
    when 'channel' then p_channel
  end;
$$;

comment on function private.report_key(public.report_dimension, text, uuid, uuid, uuid, uuid, text, uuid, text, text) is
  'The breakdown group of a report line: job document_id; product product_id (none: service and manual lines); category category_id (none); service service_id (products: inventory and sale lines, manual: custom lines); mechanic the current lead (unassigned; not_workshop for retail and online, D103); ownership shop_owned | consignment | customer_owned (service: service and manual lines); channel workshop | retail | online. Pure CASE without SET so the planner inlines it.';

-- ---------------------------------------------------------------------------
-- (a) report_period_summary
-- ---------------------------------------------------------------------------
create function public.report_period_summary(
  p_from date,
  p_to date,
  p_basis public.report_date_basis default 'sale'
)
returns table (
  basis public.report_date_basis,
  from_date date,
  to_date date,
  currency text,
  line_count integer,
  job_count integer,
  sale_count integer,
  loss_line_count integer,
  sale_total numeric,
  cost_total numeric,
  yield_total numeric,
  cult_commons_share numeric,
  yield_after_cc numeric,
  cost_pending_lines integer,
  refunds_total numeric,
  refund_count integer,
  consignment_sales integer,
  consignment_sales_total numeric,
  new_consignor_liability numeric,
  settlements_paid_total numeric,
  purchases_received_total numeric,
  excluded_foreign_line_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_costs boolean;
  v_basis public.report_date_basis;
  v_start timestamptz;
  v_end timestamptz;
  v_currency text;
  v_sale boolean;
begin
  perform private.require_permission('view_financial_reports');
  v_costs := private.has_permission('view_costs');
  perform private.report_require_range(p_from, p_to);
  v_basis := coalesce(p_basis, 'sale');
  v_sale := v_basis = 'sale';
  v_start := private.shop_day_start(p_from);
  v_end := private.shop_day_start(p_to + 1);
  v_currency := private.shop_currency();

  return query
    with r as materialized (
      select * from private.report_rows(p_from, p_to, v_basis)
    ),
    agg as (
      select
        count(*)::integer as line_count,
        (count(distinct r.document_id) filter (where r.source = 'work_order'))::integer as job_count,
        (count(distinct r.document_id) filter (where r.source = 'sale'))::integer as sale_count,
        (count(*) filter (where r.is_loss))::integer as loss_line_count,
        coalesce(sum(r.sale_total), 0.00)::numeric as sale_total,
        coalesce(sum(r.cost_total), 0.00)::numeric as cost_total,
        coalesce(sum(r.yield_total), 0.00)::numeric as yield_total,
        -- D1: the sum of the lines' own shares.
        coalesce(sum(r.cult_commons_share), 0.00)::numeric as cult_commons_share,
        (count(*) filter (where r.cost_pending))::integer as cost_pending_lines
      from r
    ),
    cons as (
      select
        (count(distinct r.document_id))::integer as consignment_sales,
        coalesce(sum(r.sale_total), 0.00)::numeric as consignment_sales_total,
        coalesce(
          sum(round(r.quantity * coalesce(sl.consignor_payout_snapshot, li.consignor_payout_snapshot), 2)), 0.00
        )::numeric as new_consignor_liability
      from r
      left join public.sale_lines sl on r.source = 'sale' and sl.id = r.source_line_id
      left join public.work_order_line_items li on r.source = 'work_order' and li.id = r.source_line_id
      where r.consignment_item_id is not null
    )
    select
      v_basis,
      p_from,
      p_to,
      v_currency,
      a.line_count,
      a.job_count,
      a.sale_count,
      case when v_costs then a.loss_line_count end,
      a.sale_total,
      case when v_costs then a.cost_total end,
      case when v_costs then a.yield_total end,
      case when v_costs then a.cult_commons_share end,
      case when v_costs then a.yield_total - a.cult_commons_share end,
      a.cost_pending_lines,
      -- D102: refunds recorded in the range, beside gross, never netted.
      case when v_sale then (
        select coalesce(sum(rf.amount), 0.00)::numeric
        from public.sale_refunds rf
        where rf.created_at >= v_start and rf.created_at < v_end and rf.currency::text = v_currency
      ) end,
      case when v_sale then (
        select count(*)::integer
        from public.sale_refunds rf
        where rf.created_at >= v_start and rf.created_at < v_end and rf.currency::text = v_currency
      ) end,
      case when v_sale then c.consignment_sales end,
      case when v_sale then c.consignment_sales_total end,
      case when v_sale and v_costs then c.new_consignor_liability end,
      -- D46, D47: settlements paid in the range that are not reversed.
      case when v_sale and v_costs then (
        select coalesce(sum(cs.amount), 0.00)::numeric
        from public.consignment_settlements cs
        where cs.paid_at >= v_start and cs.paid_at < v_end
          and cs.currency::text = v_currency
          and not exists (
            select 1 from public.consignment_settlement_reversals x where x.settlement_id = cs.id
          )
      ) end,
      -- D105: purchases received in the range at their actual cost.
      case when v_sale and v_costs then (
        select coalesce(sum(prl.received_total), 0.00)::numeric
        from public.purchase_receipts pr
        join public.purchase_receipt_lines prl on prl.purchase_receipt_id = pr.id
        where pr.received_at >= v_start and pr.received_at < v_end
          and prl.currency::text = v_currency
      ) end,
      private.report_foreign_rows(p_from, p_to, v_basis)
    from agg a
    cross join cons c;
end;
$$;

comment on function public.report_period_summary(date, date, public.report_date_basis) is
  'view_financial_reports: one row of period totals for shop days p_from..p_to on a date basis (D100; null = sale): line, job and sale counts, gross sale_total, cost-pending lines and the foreign-currency exclusions (D104) for every caller; loss_line_count, cost_total, yield_total, cult_commons_share (Σ line shares, D1) and yield_after_cc need view_costs (NULL otherwise, D30). Sale basis only (NULL otherwise): refunds_total and refund_count (D102, by sale_refunds.created_at, never netted), consignment_sales and consignment_sales_total, and (view_costs) new_consignor_liability, settlements_paid_total (not reversed) and purchases_received_total (D105). report_range_invalid / report_range_too_long.';

-- ---------------------------------------------------------------------------
-- (b) report_period_series
-- ---------------------------------------------------------------------------
create function public.report_period_series(
  p_from date,
  p_to date,
  p_basis public.report_date_basis default 'sale',
  p_grain public.report_grain default 'day'
)
returns table (
  bucket_start date,
  bucket_end date,
  partial boolean,
  line_count integer,
  job_count integer,
  sale_count integer,
  sale_total numeric,
  cost_total numeric,
  yield_total numeric,
  cult_commons_share numeric,
  yield_after_cc numeric,
  loss_line_count integer,
  refunds_total numeric,
  consignment_sales integer,
  consignment_sales_total numeric,
  new_consignor_liability numeric,
  settlements_paid_total numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_costs boolean;
  v_basis public.report_date_basis;
  v_grain text;
  v_step interval;
  v_start timestamptz;
  v_end timestamptz;
  v_currency text;
  v_tz text;
  v_sale boolean;
begin
  perform private.require_permission('view_financial_reports');
  v_costs := private.has_permission('view_costs');
  perform private.report_require_range(p_from, p_to);
  v_basis := coalesce(p_basis, 'sale');
  v_sale := v_basis = 'sale';
  v_grain := coalesce(p_grain, 'day')::text;
  v_step := ('1 ' || v_grain)::interval;
  v_start := private.shop_day_start(p_from);
  v_end := private.shop_day_start(p_to + 1);
  v_currency := private.shop_currency();
  v_tz := private.shop_timezone();

  return query
    with buckets as (
      select g.ts::date as raw_start, (g.ts + v_step - interval '1 day')::date as raw_end
      from pg_catalog.generate_series(
        pg_catalog.date_trunc(v_grain, p_from::timestamp), p_to::timestamp, v_step
      ) g(ts)
    ),
    r as materialized (
      select
        pg_catalog.date_trunc(v_grain, (x.basis_at at time zone v_tz)::date::timestamp)::date as b,
        x.*
      from private.report_rows(p_from, p_to, v_basis) x
    ),
    agg as (
      select
        r.b,
        count(*)::integer as line_count,
        (count(distinct r.document_id) filter (where r.source = 'work_order'))::integer as job_count,
        (count(distinct r.document_id) filter (where r.source = 'sale'))::integer as sale_count,
        sum(r.sale_total)::numeric as sale_total,
        sum(r.cost_total)::numeric as cost_total,
        sum(r.yield_total)::numeric as yield_total,
        sum(r.cult_commons_share)::numeric as cult_commons_share,
        (count(*) filter (where r.is_loss))::integer as loss_line_count
      from r
      group by r.b
    ),
    cons as (
      select
        r.b,
        (count(distinct r.document_id))::integer as consignment_sales,
        sum(r.sale_total)::numeric as consignment_sales_total,
        sum(round(r.quantity * coalesce(sl.consignor_payout_snapshot, li.consignor_payout_snapshot), 2))::numeric
          as new_consignor_liability
      from r
      left join public.sale_lines sl on r.source = 'sale' and sl.id = r.source_line_id
      left join public.work_order_line_items li on r.source = 'work_order' and li.id = r.source_line_id
      where r.consignment_item_id is not null
      group by r.b
    ),
    refunds as (
      select
        pg_catalog.date_trunc(v_grain, (rf.created_at at time zone v_tz)::date::timestamp)::date as b,
        sum(rf.amount)::numeric as refunds_total
      from public.sale_refunds rf
      where v_sale and rf.created_at >= v_start and rf.created_at < v_end and rf.currency::text = v_currency
      group by 1
    ),
    settlements as (
      select
        pg_catalog.date_trunc(v_grain, (cs.paid_at at time zone v_tz)::date::timestamp)::date as b,
        sum(cs.amount)::numeric as settlements_paid_total
      from public.consignment_settlements cs
      where v_sale and v_costs
        and cs.paid_at >= v_start and cs.paid_at < v_end
        and cs.currency::text = v_currency
        and not exists (
          select 1 from public.consignment_settlement_reversals x where x.settlement_id = cs.id
        )
      group by 1
    )
    select
      greatest(bk.raw_start, p_from),
      least(bk.raw_end, p_to),
      (bk.raw_start < p_from or bk.raw_end > p_to),
      coalesce(a.line_count, 0),
      coalesce(a.job_count, 0),
      coalesce(a.sale_count, 0),
      coalesce(a.sale_total, 0.00)::numeric,
      case when v_costs then coalesce(a.cost_total, 0.00) end::numeric,
      case when v_costs then coalesce(a.yield_total, 0.00) end::numeric,
      case when v_costs then coalesce(a.cult_commons_share, 0.00) end::numeric,
      case when v_costs then coalesce(a.yield_total, 0.00) - coalesce(a.cult_commons_share, 0.00) end::numeric,
      case when v_costs then coalesce(a.loss_line_count, 0) end::integer,
      case when v_sale then coalesce(rf.refunds_total, 0.00) end::numeric,
      case when v_sale then coalesce(c.consignment_sales, 0) end::integer,
      case when v_sale then coalesce(c.consignment_sales_total, 0.00) end::numeric,
      case when v_sale and v_costs then coalesce(c.new_consignor_liability, 0.00) end::numeric,
      case when v_sale and v_costs then coalesce(st.settlements_paid_total, 0.00) end::numeric
    from buckets bk
    left join agg a on a.b = bk.raw_start
    left join cons c on c.b = bk.raw_start
    left join refunds rf on rf.b = bk.raw_start
    left join settlements st on st.b = bk.raw_start
    order by bk.raw_start;
end;
$$;

comment on function public.report_period_series(date, date, public.report_date_basis, public.report_grain) is
  'view_financial_reports: one row per day, ISO week or month bucket overlapping p_from..p_to (zeros when empty; bucket_start/bucket_end clipped to the range, partial when clipped), with report_period_summary''s definitions per bucket; cost-derived columns need view_costs (NULL otherwise, D30); refunds and consignment and settlement figures on the sale basis only. At most 731 days, so at most 731 rows.';

-- ---------------------------------------------------------------------------
-- (c) report_breakdown
-- ---------------------------------------------------------------------------
create function public.report_breakdown(
  p_from date,
  p_to date,
  p_basis public.report_date_basis default 'sale',
  p_dimension public.report_dimension default 'job',
  p_max_rows integer default 200,
  p_key text default null,
  p_after_sale_total numeric default null,
  p_after_key text default null
)
returns table (
  key text,
  entity_type text,
  entity_id uuid,
  label text,
  detail text,
  line_count integer,
  job_count integer,
  sale_count integer,
  quantity numeric,
  sale_total numeric,
  cost_total numeric,
  yield_total numeric,
  cult_commons_share numeric,
  yield_after_cc numeric,
  first_at timestamptz,
  last_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_costs boolean;
  v_basis public.report_date_basis;
  v_dimension public.report_dimension;
  v_max integer;
begin
  perform private.require_permission('view_financial_reports');
  v_costs := private.has_permission('view_costs');
  perform private.report_require_range(p_from, p_to);
  v_basis := coalesce(p_basis, 'sale');
  v_dimension := coalesce(p_dimension, 'job');
  if (p_after_sale_total is null) <> (p_after_key is null)
     or (p_after_key is not null and p_key is not null)
     or (p_key is not null and not private.report_key_valid(v_dimension, p_key)) then
    raise exception using
      errcode = 'P0001',
      message = 'report_key_invalid',
      detail = 'The breakdown key or cursor does not fit the dimension.';
  end if;
  v_max := greatest(1, least(coalesce(p_max_rows, 200), 500));

  return query
    with g as (
      select
        private.report_key(
          v_dimension, r.source, r.document_id, r.product_id, r.category_id, r.service_id, r.line_type,
          r.lead_mechanic_id, r.ownership_type, r.channel
        ) as k,
        min(r.source) as src,
        count(*)::integer as line_count,
        (count(distinct r.document_id) filter (where r.source = 'work_order'))::integer as job_count,
        (count(distinct r.document_id) filter (where r.source = 'sale'))::integer as sale_count,
        sum(r.quantity)::numeric as quantity,
        sum(r.sale_total)::numeric as sale_total,
        sum(r.cost_total)::numeric as cost_total,
        sum(r.yield_total)::numeric as yield_total,
        sum(r.cult_commons_share)::numeric as cult_commons_share,
        min(r.basis_at) as first_at,
        max(r.basis_at) as last_at
      from private.report_rows(p_from, p_to, v_basis) r
      group by 1
    ),
    page as (
      select
        g.*,
        case when g.k ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then g.k::uuid end as eid
      from g
      where (p_key is null or g.k = p_key)
        and (
          p_after_key is null
          or g.sale_total < p_after_sale_total
          or (g.sale_total = p_after_sale_total and g.k collate "C" > p_after_key collate "C")
        )
      order by g.sale_total desc, g.k collate "C" asc
      limit v_max
    )
    select
      pg.k,
      case
        when v_dimension = 'job' then pg.src
        when pg.eid is null then null
        when v_dimension = 'mechanic' then 'staff'
        else v_dimension::text
      end,
      pg.eid,
      (case v_dimension
         when 'job' then coalesce(wo.job_number, sa.sale_number)
         when 'product' then coalesce(p.name, 'Services and labour')
         when 'category' then coalesce(cat.name, 'Uncategorised')
         when 'service' then
           case pg.k when 'products' then 'Parts and products' when 'manual' then 'Custom lines' else s.name end
         when 'mechanic' then
           case pg.k when 'unassigned' then 'Unassigned' when 'not_workshop' then 'Not workshop' else st.display_name end
         when 'ownership' then
           case pg.k
             when 'shop_owned' then 'Shop-owned stock'
             when 'consignment' then 'Consignment'
             when 'customer_owned' then 'Customer-owned'
             else 'Services and labour'
           end
         when 'channel' then
           case pg.k when 'workshop' then 'Workshop' when 'retail' then 'Retail' else 'Online' end
       end)::text,
      (case v_dimension
         when 'job' then
           case
             when wo.id is not null then pg_catalog.concat_ws(
               ' · ',
               private.customer_label(c.first_name, c.last_name, c.display_name, c.email::text, c.phone),
               b.brand || ' ' || b.model || coalesce(' ' || b.variant, '')
             )
             when sa.source = 'online_shopify' then 'Online order ' || coalesce(sa.shopify_order_name, '')
             else 'Retail sale'
           end
         when 'product' then nullif(pg_catalog.concat_ws(' · ', p.short_id, p.sku), '')
         when 'category' then
           case cat.kind when 'service' then 'Service category' when 'product' then 'Product category' end
         when 'mechanic' then case when st.id is not null and not st.active then 'No longer active' end
       end)::text,
      pg.line_count,
      pg.job_count,
      pg.sale_count,
      case when v_dimension = 'product' then pg.quantity end,
      pg.sale_total,
      case when v_costs then pg.cost_total end,
      case when v_costs then pg.yield_total end,
      case when v_costs then pg.cult_commons_share end,
      case when v_costs then pg.yield_total - pg.cult_commons_share end,
      pg.first_at,
      pg.last_at
    from page pg
    left join public.work_orders wo on v_dimension = 'job' and wo.id = pg.eid
    left join public.customers c on c.id = wo.customer_id
    left join public.bikes b on b.id = wo.bike_id
    left join public.sales sa on v_dimension = 'job' and sa.id = pg.eid
    left join public.products p on v_dimension = 'product' and p.id = pg.eid
    left join public.categories cat on v_dimension = 'category' and cat.id = pg.eid
    left join public.services s on v_dimension = 'service' and s.id = pg.eid
    left join public.staff st on v_dimension = 'mechanic' and st.id = pg.eid
    order by pg.sale_total desc, pg.k collate "C" asc;
end;
$$;

comment on function public.report_breakdown(date, date, public.report_date_basis, public.report_dimension, integer, text, numeric, text) is
  'view_financial_reports: the period''s lines grouped by a dimension (private.report_key; every line in exactly one group), ordered sale_total desc, key asc (collation C), which is also the keyset: (p_after_sale_total, p_after_key) returns the groups after it; p_key returns that one group (drill-down header). p_max_rows clamped 1..500 (ask for one more than shown). Labels by name, archived and inactive included (SPEC §23); quantity = Σ quantity for the product dimension only; cost-derived columns need view_costs (NULL otherwise, D30). report_key_invalid for a key that fits no dimension value, half a cursor, or a cursor with p_key.';

-- ---------------------------------------------------------------------------
-- (d) report_line_items
-- ---------------------------------------------------------------------------
create function public.report_line_items(
  p_from date,
  p_to date,
  p_basis public.report_date_basis default 'sale',
  p_dimension public.report_dimension default null,
  p_key text default null,
  p_max_rows integer default 100,
  p_after_at timestamptz default null,
  p_after_id uuid default null
)
returns table (
  source_line_id uuid,
  source text,
  channel text,
  basis_at timestamptz,
  document_id uuid,
  document_number text,
  line_type text,
  description text,
  quantity numeric,
  unit_sale_price numeric,
  sale_total numeric,
  cost_total numeric,
  yield_total numeric,
  cult_commons_share numeric,
  cost_pending boolean,
  ownership_type text,
  category_name text,
  mechanic_name text,
  currency text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_costs boolean;
  v_basis public.report_date_basis;
  v_max integer;
begin
  perform private.require_permission('view_financial_reports');
  v_costs := private.has_permission('view_costs');
  perform private.report_require_range(p_from, p_to);
  v_basis := coalesce(p_basis, 'sale');
  if (p_dimension is null) <> (p_key is null)
     or (p_key is not null and not private.report_key_valid(p_dimension, p_key))
     or (p_after_at is null) <> (p_after_id is null) then
    raise exception using
      errcode = 'P0001',
      message = 'report_key_invalid',
      detail = 'The dimension, key or cursor of the line list does not fit.';
  end if;
  v_max := greatest(1, least(coalesce(p_max_rows, 100), 1000));

  return query
    select
      r.source_line_id,
      r.source,
      r.channel,
      r.basis_at,
      r.document_id,
      r.document_number,
      r.line_type,
      r.description,
      r.quantity,
      r.unit_sale_price,
      r.sale_total,
      case when v_costs then r.cost_total end,
      case when v_costs then r.yield_total end,
      case when v_costs then r.cult_commons_share end,
      r.cost_pending,
      r.ownership_type,
      cat.name::text,
      st.display_name::text,
      r.currency
    from private.report_rows(
      p_from, p_to, v_basis, p_after_at, p_after_id,
      -- Without a key filter the page limit goes into the per-basis query.
      case when p_dimension is null then v_max end
    ) r
    left join public.categories cat on cat.id = r.category_id
    left join public.staff st on st.id = r.lead_mechanic_id
    where p_dimension is null
       or private.report_key(
            p_dimension, r.source, r.document_id, r.product_id, r.category_id, r.service_id, r.line_type,
            r.lead_mechanic_id, r.ownership_type, r.channel
          ) = p_key
    order by r.basis_at desc, r.source_line_id desc
    limit v_max;
end;
$$;

comment on function public.report_line_items(date, date, public.report_date_basis, public.report_dimension, text, integer, timestamptz, uuid) is
  'view_financial_reports: the lines a basis counts in p_from..p_to (optionally one breakdown group: p_dimension and p_key together), newest basis_at first; keyset (p_after_at, p_after_id) = the last row''s (basis_at, source_line_id); p_max_rows clamped 1..1000. cost_total, yield_total and cult_commons_share need view_costs (NULL otherwise, D30); a 0.00 price or cost is a known value (D24 amended). report_key_invalid for half a dimension/key pair, a key that fits no dimension value, or half a cursor.';

-- ---------------------------------------------------------------------------
-- (e) report_activity (any active staff, no money)
-- ---------------------------------------------------------------------------
create function public.report_activity(p_from date, p_to date)
returns table (
  jobs_checked_in integer,
  jobs_started integer,
  jobs_completed integer,
  jobs_ready_for_collection integer,
  jobs_collected integer,
  jobs_cancelled integer,
  jobs_open_at_end integer,
  median_hours_to_complete numeric,
  median_hours_to_collect numeric,
  appointments_scheduled integer,
  appointments_arrived integer,
  appointments_no_show integer,
  appointments_cancelled integer,
  parts_consumed_qty integer,
  parts_consumed_lines integer,
  parts_returned_qty integer,
  stock_adjustments integer,
  significant_stock_adjustments integer,
  purchase_receipts integer,
  purchase_units_received integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
begin
  perform private.require_staff();
  perform private.report_require_range(p_from, p_to);
  v_start := private.shop_day_start(p_from);
  v_end := private.shop_day_start(p_to + 1);

  return query
    select
      (select count(*)::integer from public.work_orders wo
        where wo.checked_in_at >= v_start and wo.checked_in_at < v_end),
      (select count(*)::integer from public.work_orders wo
        where wo.started_at >= v_start and wo.started_at < v_end),
      (select count(*)::integer from public.work_orders wo
        where wo.completed_at >= v_start and wo.completed_at < v_end),
      (select count(*)::integer from public.work_orders wo
        where wo.ready_for_collection_at >= v_start and wo.ready_for_collection_at < v_end),
      (select count(*)::integer from public.work_orders wo
        where wo.collected_at >= v_start and wo.collected_at < v_end),
      (select count(*)::integer from public.work_orders wo
        where wo.cancelled_at >= v_start and wo.cancelled_at < v_end),
      (select count(*)::integer from public.work_orders wo
        where wo.checked_in_at < v_end
          and (wo.completed_at is null or wo.completed_at >= v_end)
          and (wo.cancelled_at is null or wo.cancelled_at >= v_end)),
      (select round((extract(epoch from percentile_cont(0.5) within group (
                order by wo.completed_at - wo.checked_in_at)) / 3600)::numeric, 1)
         from public.work_orders wo
        where wo.completed_at >= v_start and wo.completed_at < v_end),
      (select round((extract(epoch from percentile_cont(0.5) within group (
                order by wo.collected_at - wo.completed_at)) / 3600)::numeric, 1)
         from public.work_orders wo
        where wo.collected_at >= v_start and wo.collected_at < v_end),
      -- D41: by scheduled shop day and current status (= daily_summary).
      ap.booked,
      ap.arrived,
      ap.no_shows,
      ap.cancelled,
      st.parts_consumed_qty,
      st.parts_consumed_lines,
      st.parts_returned_qty,
      st.stock_adjustments,
      st.significant_stock_adjustments,
      (select count(*)::integer from public.purchase_receipts pr
        where pr.received_at >= v_start and pr.received_at < v_end),
      (select coalesce(sum(prl.quantity_received), 0)::integer
         from public.purchase_receipts pr
         join public.purchase_receipt_lines prl on prl.purchase_receipt_id = pr.id
        where pr.received_at >= v_start and pr.received_at < v_end)
    from (
      select coalesce(sum(ad.booked), 0)::integer as booked,
             coalesce(sum(ad.arrived), 0)::integer as arrived,
             coalesce(sum(ad.no_shows), 0)::integer as no_shows,
             coalesce(sum(ad.cancelled), 0)::integer as cancelled
      from reporting.appointment_daily ad
      where ad.day >= p_from and ad.day <= p_to
    ) ap
    cross join (
      -- daily_summary's exact definitions (D33), by the movement's instant.
      select
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
      where m.created_at >= v_start and m.created_at < v_end
    ) st;
end;
$$;

comment on function public.report_activity(date, date) is
  'Active staff (no money): job flows in shop days p_from..p_to by each job''s own current stamps (D31, D100), jobs open at the range end, median hours check-in to completion and completion to collection, appointments by scheduled day and current status (D41), parts and stock adjustments with daily_summary''s definitions (D33), and purchase receipts and units by received_at (D105). report_range_invalid / report_range_too_long.';

-- ---------------------------------------------------------------------------
-- (f) report_activity_by_mechanic (any active staff, no money)
-- ---------------------------------------------------------------------------
create function public.report_activity_by_mechanic(p_from date, p_to date)
returns table (
  staff_id uuid,
  display_name text,
  active boolean,
  jobs_checked_in integer,
  jobs_completed integer,
  jobs_collected integer,
  jobs_open_now integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
begin
  perform private.require_staff();
  perform private.report_require_range(p_from, p_to);
  v_start := private.shop_day_start(p_from);
  v_end := private.shop_day_start(p_to + 1);

  return query
    with g as (
      select
        wo.lead_mechanic_id as sid,
        (count(*) filter (where wo.checked_in_at >= v_start and wo.checked_in_at < v_end))::integer as ci,
        (count(*) filter (where wo.completed_at >= v_start and wo.completed_at < v_end))::integer as co,
        (count(*) filter (where wo.collected_at >= v_start and wo.collected_at < v_end))::integer as cl,
        (count(*) filter (where private.work_order_status_is_open(wo.status)))::integer as op
      from public.work_orders wo
      where (wo.checked_in_at >= v_start and wo.checked_in_at < v_end)
         or (wo.completed_at >= v_start and wo.completed_at < v_end)
         or (wo.collected_at >= v_start and wo.collected_at < v_end)
         or private.work_order_status_is_open(wo.status)
      group by wo.lead_mechanic_id
    )
    select
      g.sid,
      coalesce(st.display_name, 'Unassigned')::text,
      st.active,
      g.ci,
      g.co,
      g.cl,
      g.op
    from g
    left join public.staff st on st.id = g.sid
    where g.ci + g.co + g.cl + g.op > 0
    order by g.co desc, coalesce(st.display_name, 'Unassigned') collate "C", g.sid;
end;
$$;

comment on function public.report_activity_by_mechanic(date, date) is
  'Active staff (no money): per current lead mechanic (D103; staff_id NULL = Unassigned, inactive staff by name), the jobs checked in, completed and collected in shop days p_from..p_to and the jobs open now; all-zero rows omitted; by jobs_completed desc, then name.';

-- ---------------------------------------------------------------------------
-- Period-report indexes (only where no valid index has the column first).
-- ---------------------------------------------------------------------------
-- Checked against pg_index on 2026-10-06: none of these columns leads a
-- valid, unconditional index (appointments_active_range_idx is partial).
create index work_orders_cancelled_at_idx on public.work_orders (cancelled_at)
  where cancelled_at is not null;
create index sale_refunds_created_at_idx on public.sale_refunds (created_at);
create index consignment_settlements_paid_at_idx on public.consignment_settlements (paid_at);
create index inventory_movements_created_at_idx on public.inventory_movements (created_at);
create index purchase_receipts_received_at_idx on public.purchase_receipts (received_at);
create index appointments_starts_at_idx on public.appointments (starts_at);

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function
  private.report_require_range(date, date),
  private.report_key_valid(public.report_dimension, text),
  private.report_rows(date, date, public.report_date_basis, timestamptz, uuid, integer, boolean),
  private.report_foreign_rows(date, date, public.report_date_basis),
  private.report_key(public.report_dimension, text, uuid, uuid, uuid, uuid, text, uuid, text, text),
  public.report_period_summary(date, date, public.report_date_basis),
  public.report_period_series(date, date, public.report_date_basis, public.report_grain),
  public.report_breakdown(date, date, public.report_date_basis, public.report_dimension, integer, text, numeric, text),
  public.report_line_items(date, date, public.report_date_basis, public.report_dimension, text, integer, timestamptz, uuid),
  public.report_activity(date, date),
  public.report_activity_by_mechanic(date, date)
from public, anon, authenticated, service_role;

grant execute on function
  public.report_period_summary(date, date, public.report_date_basis),
  public.report_period_series(date, date, public.report_date_basis, public.report_grain),
  public.report_breakdown(date, date, public.report_date_basis, public.report_dimension, integer, text, numeric, text),
  public.report_line_items(date, date, public.report_date_basis, public.report_dimension, text, integer, timestamptz, uuid),
  public.report_activity(date, date),
  public.report_activity_by_mechanic(date, date)
to authenticated;
