-- Stock reporting views, and the reporting schema exposed to the Data API
-- (SPEC §12 "Current stock must be derivable/reconcilable from movements",
-- §19; DATA-MODEL.md §7, §14, §15; PLAN D23 NEG-CONSUMPTION, D26).
--
-- Rules encoded here:
--   * Stock is derived from the ledger, never cached: on-hand is
--     sum(quantity_delta) per product and location.
--   * Low stock means on-hand AT OR BELOW reorder_point ("<=", so a product
--     sitting exactly at its reorder point is flagged), or any negative
--     on-hand (total or at any one location, D23) whether or not the
--     product has a reorder point.
--   * The views run as the caller (security_invoker), so the base tables'
--     staff-only RLS applies: customers and anonymous visitors read nothing.
--     None of them names a cost column.
--   * `reporting` is now an exposed API schema (supabase/config.toml, the
--     devstack's PostgREST, type generation, RUNBOOK): DATA-MODEL §15 names
--     reporting.public_items as the anonymous surface (Step 2 builds it and
--     grants anon USAGE with it). authenticated gets USAGE now, for these
--     views. `private` stays unexposed.

grant usage on schema reporting to authenticated;

create view reporting.stock_levels
with (security_invoker = true)
as
  select m.product_id,
         m.location_id,
         sum(m.quantity_delta)::integer as on_hand,
         max(m.created_at) as last_movement_at
  from public.inventory_movements m
  group by m.product_id, m.location_id;

comment on view reporting.stock_levels is
  'On-hand per product and location: the sum of the ledger (SPEC §12).';

create view reporting.product_stock
with (security_invoker = true)
as
  select p.id as product_id,
         p.short_id,
         p.name,
         p.sku,
         p.tracking_type,
         p.reorder_point,
         p.active,
         p.archived_at,
         coalesce(s.on_hand, 0)::integer as on_hand,
         coalesce(u.available_units, 0)::integer as available_units,
         coalesce(u.held_units, 0)::integer as held_units,
         coalesce(s.negative_locations, 0)::integer as negative_locations,
         (p.tracking_type = 'quantity' and p.reorder_point is not null
           and coalesce(s.on_hand, 0) <= p.reorder_point) as below_reorder
  from public.products p
  left join (
    select l.product_id,
           sum(l.on_hand)::integer as on_hand,
           count(*) filter (where l.on_hand < 0)::integer as negative_locations
    from reporting.stock_levels l
    group by l.product_id
  ) s on s.product_id = p.id
  left join (
    select iu.product_id,
           count(*) filter (where iu.status = 'available')::integer as available_units,
           count(*) filter (where iu.status = 'held_for_customer')::integer as held_units
    from public.inventory_units iu
    group by iu.product_id
  ) u on u.product_id = p.id;

comment on view reporting.product_stock is
  'Every product with its on-hand across locations, available and held units, locations below zero and whether it is at or below its reorder point.';

create view reporting.low_stock
with (security_invoker = true)
as
  select ps.product_id,
         ps.short_id,
         ps.name,
         ps.sku,
         ps.on_hand,
         ps.reorder_point,
         ps.negative_locations,
         (coalesce(ps.reorder_point, 0) - ps.on_hand)::integer as shortfall
  from reporting.product_stock ps
  where ps.tracking_type = 'quantity'
    and ps.active
    and ps.archived_at is null
    and (
      (ps.reorder_point is not null and ps.on_hand <= ps.reorder_point)
      or ps.on_hand < 0
      or ps.negative_locations > 0
    )
  order by shortfall desc, ps.short_id;

comment on view reporting.low_stock is
  'Active quantity products at or below their reorder point (on_hand <= reorder_point), or below zero anywhere (D23), largest shortfall first.';

revoke all on table reporting.stock_levels from public, anon, authenticated, service_role;
revoke all on table reporting.product_stock from public, anon, authenticated, service_role;
revoke all on table reporting.low_stock from public, anon, authenticated, service_role;

grant select on table reporting.stock_levels to authenticated;
grant select on table reporting.product_stock to authenticated;
grant select on table reporting.low_stock to authenticated;
