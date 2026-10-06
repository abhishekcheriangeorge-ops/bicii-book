-- Stock value at cost NOW (SPEC §12, §19.2; DATA-MODEL.md §14, §16; PLAN
-- D5, D24 as amended, D30 FIN-ACCESS, D34, D35, D48, D63, D105
-- REPORT-PURCHASES-STOCK-VALUE; record ADR-022).
--
-- A read: nothing is stored or changed. One row per ownership type
-- ('shop_owned', 'consignment', 'customer_owned').
--
-- Valuation (D105):
--   * Quantity products: Σ over (product, location) of max(ledger on-hand,
--     0) from reporting.stock_levels. A location below zero is NOT valued
--     (it is already the negative_stock exception, D34), so it counts 0.
--     Valued at products.default_direct_cost, the LAST cost (D5, D63), not
--     the cost of the units on hand (RISKS R-056).
--   * Unique units with status available or reserved: their own
--     inventory_units.direct_cost, else the product's default_direct_cost.
--   * A NULL cost is not valued: the product or unit is counted in
--     uncosted_items instead (D24 as amended). 0 is a known cost: valued at
--     0.00 and not counted as uncosted. A product in another currency than
--     private.shop_currency() is not valued either and counts as uncosted
--     (D104: totals are in the shop currency only).
--   * Only shop-owned stock is valued. Consigned and customer-owned stock is
--     counted, never valued: it is not the shop's asset, and consignment
--     money follows D48.
--   * Access: the rows need view_financial_reports; value_at_cost also needs
--     view_costs (NULL otherwise, D30), and is NULL on the consignment and
--     customer_owned rows for everyone.

create function public.report_stock_value()
returns table (
  ownership_type text,
  quantity_on_hand integer,
  units_in_stock integer,
  uncosted_items integer,
  value_at_cost numeric,
  currency text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_costs boolean;
  v_currency text;
begin
  perform private.require_permission('view_financial_reports');
  v_costs := private.has_permission('view_costs');
  v_currency := private.shop_currency();

  return query
    with qty as (
      -- Quantity products with stock on hand, positive locations only.
      select
        p.id,
        p.ownership_type::text as own,
        sum(sl.on_hand)::integer as on_hand,
        case when p.currency::text = v_currency then p.default_direct_cost::numeric end as cost
      from reporting.stock_levels sl
      join public.products p on p.id = sl.product_id
      where p.tracking_type = 'quantity'
        and sl.on_hand > 0
      group by p.id
    ),
    units as (
      select
        u.id,
        u.ownership_type::text as own,
        case when p.currency::text = v_currency
             then coalesce(u.direct_cost, p.default_direct_cost)::numeric end as cost
      from public.inventory_units u
      join public.products p on p.id = u.product_id
      where u.status in ('available', 'reserved')
    ),
    kinds(own, sort) as (
      values ('shop_owned'::text, 1), ('consignment', 2), ('customer_owned', 3)
    )
    select
      k.own,
      coalesce((select sum(q.on_hand) from qty q where q.own = k.own), 0)::integer,
      (select count(*) from units u where u.own = k.own)::integer,
      ((select count(*) from qty q where q.own = k.own and q.cost is null)
       + (select count(*) from units u where u.own = k.own and u.cost is null))::integer,
      case when v_costs and k.own = 'shop_owned' then
        (coalesce((select sum(q.on_hand * q.cost) from qty q where q.own = k.own), 0.00)
         + coalesce((select sum(u.cost) from units u where u.own = k.own), 0.00))::numeric
      end,
      v_currency
    from kinds k
    order by k.sort;
end;
$$;

comment on function public.report_stock_value() is
  'view_financial_reports: stock NOW per ownership type (D105): quantity on hand (positive locations of quantity products), unique units available or reserved, and items without a known cost (NULL, or a product in another currency); value_at_cost (shop-owned only; last cost for quantity products, unit cost else the product default for units; 0 is valued, NULL is not) needs view_costs (NULL otherwise, D30) and is NULL for consigned and customer-owned stock.';

revoke all on function public.report_stock_value() from public, anon, authenticated, service_role;
grant execute on function public.report_stock_value() to authenticated;
