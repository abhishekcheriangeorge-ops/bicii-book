-- Reorder suggestions from low stock, and a draft PO from them in one tap
-- (SPEC §11 "low-stock alerts", §14 "Purchase orders"; DATA-MODEL.md §10,
-- §16; PLAN D9, D24 (as amended), D60 D-PO-COSTS, D62 D-PO-SCOPE,
-- D66 D-REORDER).
--
-- Rules encoded here:
--   * D66 D-REORDER: suggested quantity = max(2 x reorder_point - on_hand -
--     on_order, 0) over Phase 4's reporting.low_stock products; on_order is
--     reporting.product_on_order (submitted and partially_received POs only,
--     never drafts). A selected product whose suggestion is 0 is ordered at
--     1. A draft line's cost is private.default_purchase_unit_cost: the
--     supplier's last cost, else the product's cost (0 included, D24 as
--     amended: only NULL is missing), else 0. Staff edit the draft before
--     submitting it.
--   * reorder_suggestions is for every active staff member and carries no
--     cost (D60). create_purchase_order_from_low_stock needs
--     manage_purchasing.
--   * create_purchase_order_from_low_stock is replay-safe by id with exactly
--     create_purchase_order's mechanism (row lock first, insert only when
--     absent, the primary-key unique_violation as the race fallback, never
--     ON CONFLICT: the BEFORE INSERT trigger would consume
--     private.seq_short_id_po on every replay). A replay adds no line.
--   * Lock order (the suppliers migration's header): it holds only the new
--     PO row (step 1); its lines are written under it (step 2); products and
--     stock are read without locks.

-- D66: max(2 x reorder_point - on_hand - on_order, 0); NULLs count as 0.
create function private.suggested_reorder_quantity(reorder_point integer, on_hand integer, on_order integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select greatest(
    2 * coalesce(suggested_reorder_quantity.reorder_point, 0)
      - coalesce(suggested_reorder_quantity.on_hand, 0)
      - coalesce(suggested_reorder_quantity.on_order, 0),
    0
  );
$$;

comment on function private.suggested_reorder_quantity(integer, integer, integer) is
  'D66 D-REORDER: max(2 x reorder_point - on_hand - on_order, 0), NULLs as 0.';

-- Active staff: the low-stock products with what is on order, the
-- suggestion, and their relationship to `supplier_id` (null: no supplier
-- chosen, so supplier_linked is false and supplier_sku null).
-- draft_po_numbers lists the draft POs (any supplier) already holding the
-- product, oldest number first; empty when none.
create function public.reorder_suggestions(supplier_id uuid default null)
returns table (
  product_id uuid,
  short_id text,
  sku text,
  name text,
  on_hand integer,
  reorder_point integer,
  on_order integer,
  suggested_quantity integer,
  supplier_linked boolean,
  preferred_supplier_id uuid,
  supplier_sku text,
  draft_po_numbers text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff();
  return query
    select ls.product_id,
           ls.short_id,
           ls.sku,
           ls.name,
           ls.on_hand,
           ls.reorder_point,
           coalesce(oo.quantity_on_order, 0)::integer,
           private.suggested_reorder_quantity(ls.reorder_point, ls.on_hand, coalesce(oo.quantity_on_order, 0)),
           (sp.supplier_id is not null),
           pref.supplier_id,
           sp.supplier_sku,
           coalesce((
             select pg_catalog.array_agg(po.po_number order by po.po_number)
             from public.purchase_orders po
             where po.status = 'draft'
               and exists (
                 select 1 from public.purchase_order_lines l
                 where l.purchase_order_id = po.id and l.product_id = ls.product_id
               )
           ), '{}'::text[])
    from reporting.low_stock ls
    left join reporting.product_on_order oo on oo.product_id = ls.product_id
    left join public.supplier_products sp
      on sp.product_id = ls.product_id and sp.supplier_id = reorder_suggestions.supplier_id
    left join public.supplier_products pref
      on pref.product_id = ls.product_id and pref.preferred
    order by 9 desc, 8 desc, 4, 1;
end;
$$;

comment on function public.reorder_suggestions(uuid) is
  'Active staff: low-stock products with on-order quantity, the D66 suggestion, the link to a supplier and draft POs already holding them. No costs.';

-- manage_purchasing: a draft PO for `supplier_id` with one line per distinct
-- selected product, in ascending product id order: quantity
-- max(suggestion, 1) computed now (capped at the line limit, 100000), cost
-- private.default_purchase_unit_cost. Each product passes
-- set_purchase_order_line's checks (quantity-tracked, shop-owned, active,
-- the PO's currency; once per PO). Replay by id returns the PO unchanged.
create function public.create_purchase_order_from_low_stock(
  id uuid,
  supplier_id uuid,
  product_ids uuid[]
)
returns public.purchase_orders
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  staff uuid := private.require_permission('manage_purchasing');
  existing public.purchase_orders;
  supplier_archived timestamptz;
  po public.purchase_orders;
  prod public.products;
  pid uuid;
  stock integer;
  incoming integer;
  qty integer;
  err_constraint text;
  err_state text;
  err_table text;
  err_schema text;
  err_column text;
  err_message text;
begin
  if create_purchase_order_from_low_stock.id is null or create_purchase_order_from_low_stock.supplier_id is null then
    raise exception 'id and supplier_id are required' using errcode = '22004';
  end if;
  if coalesce(pg_catalog.cardinality(create_purchase_order_from_low_stock.product_ids), 0) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'reorder_nothing_selected',
      detail = 'Choose at least one product to order.';
  end if;
  if pg_catalog.cardinality(create_purchase_order_from_low_stock.product_ids) > 100 then
    raise exception 'at most 100 products at a time' using errcode = '22023';
  end if;
  if pg_catalog.array_position(create_purchase_order_from_low_stock.product_ids, null) is not null then
    raise exception 'product_ids must not contain null' using errcode = '22004';
  end if;

  -- Replay: create_purchase_order's mechanism, nothing added.
  select o.* into existing from public.purchase_orders o where o.id = create_purchase_order_from_low_stock.id for update;
  if found then
    if existing.supplier_id = create_purchase_order_from_low_stock.supplier_id then
      return existing;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'purchase_order_conflict',
      detail = 'That order id is already used for an order with another supplier.';
  end if;

  select s.archived_at into supplier_archived
  from public.suppliers s where s.id = create_purchase_order_from_low_stock.supplier_id;
  if not found then
    raise exception 'supplier % not found', create_purchase_order_from_low_stock.supplier_id using errcode = 'P0002';
  end if;
  if supplier_archived is not null then
    raise exception using
      errcode = 'P0001',
      message = 'supplier_archived',
      detail = 'That supplier is archived; unarchive it first.';
  end if;

  begin
    insert into public.purchase_orders as o (id, supplier_id, currency, created_by)
    values (
      create_purchase_order_from_low_stock.id, create_purchase_order_from_low_stock.supplier_id,
      private.shop_currency()::char(3), staff
    )
    returning o.* into po;
  exception
    when unique_violation then
      get stacked diagnostics err_constraint = constraint_name;
      if err_constraint is distinct from 'purchase_orders_pkey' then
        raise;
      end if;
      select o.* into existing from public.purchase_orders o where o.id = create_purchase_order_from_low_stock.id for update;
      if existing.supplier_id = create_purchase_order_from_low_stock.supplier_id then
        return existing;
      end if;
      raise exception using
        errcode = 'P0001',
        message = 'purchase_order_conflict',
        detail = 'That order id is already used for an order with another supplier.';
  end;

  -- line_added events carry no reason.
  perform private.set_change_reason(null);
  for pid in
    select distinct u.p from pg_catalog.unnest(create_purchase_order_from_low_stock.product_ids) u(p) order by u.p
  loop
    select p.* into prod from public.products p where p.id = pid;
    if not found then
      raise exception 'product % not found', pid using errcode = 'P0002';
    end if;
    if prod.tracking_type <> 'quantity' then
      raise exception using
        errcode = 'P0001',
        message = 'purchase_line_unique_product',
        detail = 'Unique items are registered one by one in Stock, not ordered on a purchase order.';
    end if;
    if prod.ownership_type <> 'shop_owned' then
      raise exception using
        errcode = 'P0001',
        message = 'purchase_line_not_shop_owned',
        detail = 'Only shop-owned products are bought from suppliers.';
    end if;
    if not prod.active or prod.archived_at is not null then
      raise exception using
        errcode = 'P0001',
        message = 'purchase_line_product_inactive',
        detail = 'That product is inactive or archived.';
    end if;
    if prod.currency <> po.currency then
      raise exception using
        errcode = 'P0001',
        message = 'purchase_currency_mismatch',
        detail = pg_catalog.format('The product is priced in %s but the order is in %s.', prod.currency, po.currency);
    end if;
    -- Distinct ids on a new PO: a duplicate cannot happen, but the rule is
    -- set_purchase_order_line's and is kept for every writer.
    if exists (
      select 1 from public.purchase_order_lines l where l.purchase_order_id = po.id and l.product_id = prod.id
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'purchase_line_duplicate_product',
        detail = 'That product is already on this order; change its line instead.';
    end if;

    select ps.on_hand into stock from reporting.product_stock ps where ps.product_id = prod.id;
    select oo.quantity_on_order into incoming from reporting.product_on_order oo where oo.product_id = prod.id;
    qty := least(
      greatest(private.suggested_reorder_quantity(prod.reorder_point, stock, incoming), 1),
      100000
    );

    begin
      insert into public.purchase_order_lines (
        purchase_order_id, product_id, quantity_ordered, unit_cost, currency, created_by
      )
      values (
        po.id, prod.id, qty, private.default_purchase_unit_cost(po.supplier_id, prod.id), po.currency, staff
      );
    exception
      when check_violation or not_null_violation then
        get stacked diagnostics
          err_state = returned_sqlstate, err_constraint = constraint_name, err_table = table_name,
          err_schema = schema_name, err_column = column_name, err_message = message_text;
        perform private.raise_without_row(err_state, err_constraint, err_table, err_schema, err_column, err_message);
    end;
  end loop;

  return po;
end;
$$;

comment on function public.create_purchase_order_from_low_stock(uuid, uuid, uuid[]) is
  'manage_purchasing: a draft PO with one line per selected product (D66: max(suggestion, 1); supplier last cost, else product cost incl. 0, else 0); replay-safe by id.';

revoke all on function
  private.suggested_reorder_quantity(integer, integer, integer),
  public.reorder_suggestions(uuid),
  public.create_purchase_order_from_low_stock(uuid, uuid, uuid[])
from public, anon, authenticated, service_role;

grant execute on function
  public.reorder_suggestions(uuid),
  public.create_purchase_order_from_low_stock(uuid, uuid, uuid[])
to authenticated;
