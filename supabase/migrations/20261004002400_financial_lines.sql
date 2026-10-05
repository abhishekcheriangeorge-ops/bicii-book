-- Recognised revenue entries and per-job activity (SPEC §10, §19, §19.2
-- "Reports must distinguish operational dates ... Do not create manually
-- maintained report totals as a second truth", §23, §24; DATA-MODEL.md §14;
-- PLAN D1, D3, D14, D15, D20, D32 RECOGNITION, D35 SHOP-TZ).
--
-- `reporting` holds views only. These are derived data over the source
-- records and never a second source of truth: nothing here is stored.
--
-- Rules encoded here:
--   * Recognition (D3 as modified by D15, refined by D32): a workshop line
--     is recognised when it is not voided and its job has a completed_at,
--     on the shop day of the job's CURRENT work_orders.completed_at. Jobs
--     that are completed, ready for collection or collected count; open and
--     cancelled jobs never do (a cancelled job has no live line, D16).
--     Phase 3 freezes a job's lines once it is completed, so the only
--     correction is a reopen: it clears completed_at and so removes the
--     whole job from its earlier completion day until it is completed again,
--     when its then-current live lines are recognised on the new day. Past
--     days can change after a reopen; there are no reversal entries for
--     workshop lines. Phase 9 restates periods the same way.
--   * Amounts come ONLY from the line's snapshots and generated columns
--     (SPEC §23 "Historical line price/cost/yield snapshots do not change
--     with catalog edits"), never from the catalog. Each entry's Cult
--     Commons share is the line's own share (>= 0, D1), so a job's or a
--     day's Cult Commons is the SUM of entry shares and never negative
--     (SPEC §10); a loss line has is_loss and share 0.
--   * cost_pending lines (D14) are recognised as stored (cost 0) and
--     flagged, never excluded or estimated.
--   * "Recognised once": one entry per live line of a job with a
--     completed_at. set_work_order_status locks the job FOR UPDATE
--     (private.lock_work_order) before its same-status and transition
--     checks, so concurrent completions serialise and a repeat is a no-op.
--   * Both views are security_invoker and granted to NO API role, even
--     though `reporting` is exposed: the app reads them only through the
--     Phase 5 RPCs (dashboard migration), which gate money (D30 FIN-ACCESS).
--
-- Pinned vocabulary of reporting.financial_lines (DATA-MODEL §14):
--   source        'work_order' | 'sale'
--   channel       'workshop' | 'retail' | 'online'
--   document_id   work_orders.id | sales.id
--   document_number  the J- job number | the S- sale number
--   entry_kind    'line' for every entry now
-- Columns use text (not enums) wherever later phases add values, and plain
-- numeric (domains cast away), so `create or replace view` can append a
-- `union all` branch with identical types.
--
-- How later phases extend these views:
--   * Phase 6 appends a `union all` branch to financial_lines with EVERY
--     column in this order (shape below).
--   * Phase 9 appends only genuinely new columns at the END, never synonyms
--     of existing ones: line_id -> source_line_id, source -> channel,
--     work_order_id / sale_id -> document_id, ownership -> ownership_type,
--     mechanic_staff_id -> lead_mechanic_id.

create view reporting.financial_lines
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
    null::uuid as consignment_item_id,
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
    and l.voided_at is null;

-- Phase 6 branch (shape only; every column in the order above):
--   union all
--   select 'sl:' || sl.id::text, 'sale', 'line', sl.id, sa.id, sa.sale_number,
--          case sa.source when 'retail' then 'retail' when 'online_shopify' then 'online' end,
--          sa.recognized_at, private.shop_day(sa.recognized_at),
--          'inventory', null::uuid, sl.product_id, sl.inventory_unit_id, p.category_id,
--          coalesce(u.ownership_type, p.ownership_type)::text, sl.consignment_item_id,
--          sa.customer_id, null::uuid /* bike */, null::uuid /* lead_mechanic_id */,
--          sl.description, sl.quantity, sl.unit_sale_price, sl.unit_direct_cost,
--          sl.cult_commons_rate, sl.sale_total, sl.cost_total, sl.yield_total,
--          sl.cult_commons_share, sl.yield_total - sl.cult_commons_share,
--          sl.yield_total < 0, sl.currency::text, false /* cost_pending */
--   from public.sale_lines sl join public.sales sa on sa.id = sl.sale_id ...
-- Refunds (sale_refunds) are financial only and stay out of stock (D7).

comment on view reporting.financial_lines is
  'One row per recognised revenue entry (D32 RECOGNITION): every live line of a job with a current completed_at, on that shop day; amounts from the line snapshots only; Cult Commons per entry = the line''s share (>= 0, D1); cost_pending flagged (D14). Vocabulary: source work_order|sale, channel workshop|retail|online, document_id = work_orders.id|sales.id, document_number = J-|S- number, entry_kind line. No API grants: read through public.financial_lines / daily_summary (D30).';

create view reporting.work_order_activity
with (security_invoker = true)
as
  select
    a.work_order_id,
    a.job_number,
    a.status,
    a.customer_id,
    a.bike_id,
    a.lead_mechanic_id,
    a.appointment_id,
    a.currency,
    a.checked_in_at,
    a.started_at,
    a.completed_at,
    a.ready_for_collection_at,
    a.collected_at,
    a.cancelled_at,
    a.checked_in_day,
    a.started_day,
    a.completed_day,
    a.ready_day,
    a.collected_day,
    a.cancelled_day,
    a.is_open,
    -- D20: open and more than 7 x 24 hours since check-in (strictly).
    (a.is_open and pg_catalog.now() - a.checked_in_at > interval '7 days') as is_overdue,
    (case
       when a.is_open then private.shop_today() - a.checked_in_day
       else coalesce(a.completed_day, a.cancelled_day) - a.checked_in_day
     end)::integer as age_days,
    (a.started_day - a.checked_in_day)::integer as days_to_start,
    (a.completed_day - a.checked_in_day)::integer as days_to_complete,
    (case
       when a.status in ('completed', 'ready_for_collection') then private.shop_today() - a.completed_day
       when a.status = 'collected' then a.collected_day - a.completed_day
     end)::integer as days_awaiting_collection,
    (a.completed_at - a.checked_in_at) as time_to_complete
  from (
    select
      wo.id as work_order_id,
      wo.job_number::text as job_number,
      wo.status,
      wo.customer_id,
      wo.bike_id,
      wo.lead_mechanic_id,
      wo.appointment_id,
      wo.currency::text as currency,
      wo.checked_in_at,
      wo.started_at,
      wo.completed_at,
      wo.ready_for_collection_at,
      wo.collected_at,
      wo.cancelled_at,
      private.shop_day(wo.checked_in_at) as checked_in_day,
      private.shop_day(wo.started_at) as started_day,
      private.shop_day(wo.completed_at) as completed_day,
      private.shop_day(wo.ready_for_collection_at) as ready_day,
      private.shop_day(wo.collected_at) as collected_day,
      private.shop_day(wo.cancelled_at) as cancelled_day,
      private.work_order_status_is_open(wo.status) as is_open
    from public.work_orders wo
  ) a;

comment on view reporting.work_order_activity is
  'One row per job: its current stamps and their shop days (D35), open/overdue (D20: open and now() - checked_in_at > 7 days), age and durations in whole shop days, time to complete. A reopened job''s completion stamps are its latest ones (D15). No API grants: read through public.work_order_activity_on and today_dashboard.';

revoke all on table reporting.financial_lines from public, anon, authenticated, service_role;
revoke all on table reporting.work_order_activity from public, anon, authenticated, service_role;
