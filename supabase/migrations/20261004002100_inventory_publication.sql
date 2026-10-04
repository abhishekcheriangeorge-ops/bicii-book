-- Publication, the anonymous public projection and bulk-to-unique splits
-- (SPEC §2 "Stable physical identity", §11, §12, §15, §23, §25; DATA-MODEL.md
-- §11, §14, §15, §16; PLAN D9, D13, D26 PUBLICATION-MACHINE,
-- D27 SHOP-OWNED-ONLY, D28 SPLIT-COST).
--
-- Rules encoded here:
--   * Publication changes by hand only through set_publication_status
--     (manage_inventory; authenticated has no column grant on
--     products.publication_status). The products trigger (inventory
--     migration) still decides every transition and requirement for every
--     writer; this RPC adds the manual-only rules of D26: 'sold' is never
--     chosen by hand (a sale sets it), and a sold product leaves 'sold' by
--     hand only for 'archived' (sold -> public is the system restore of
--     private.refresh_unique_publication when a unit returns to stock).
--   * reporting.public_items is the ONLY anonymous inventory surface and
--     the contract for Phase 11's public /q/{short_id} page (D9). It shows
--     products whose publication is public or sold (and their units), only
--     public columns and only `public` photos; unknown and unpublished short
--     IDs are simply absent, so they 404 identically. Never a cost, serial
--     number, internal note, location, ownership, consignor or SKU.
--   * The price on the public page is private.selling_price, the single
--     selling-price source (Phase 6 replaces it for consignment asking
--     prices; labels and Shopify use it unchanged).
--   * split_unit_from_stock turns one counted item into a new draft unique
--     product and unit at the same location, carrying the source's default
--     direct cost (D28), with one stock_adjustment on each side.
--   * Lock order (inventory migration header): lock_stock(product) before
--     the products row FOR UPDATE; locks before the replay check.

-- The narrow results (never a cost). A composite type rather than `returns
-- table`: the output columns would clash with the arguments of the same
-- names (product_id, unit_id) in PL/pgSQL, as in Step 1's unit RPCs.
create type public.publication_result as (
  product_id uuid,
  publication_status public.publication_status,
  public_slug text
);

create type public.split_unit_result as (
  product_id uuid,
  product_short_id text,
  unit_id uuid,
  unit_short_id text
);

-- ---------------------------------------------------------------------------
-- set_publication_status (D26)
-- ---------------------------------------------------------------------------
-- Phase 10 hooks the Shopify product sync onto publication changes with a
-- trigger on products (publication_status), so every path that changes it
-- (this RPC, sales, refresh_unique_publication) is synced; nothing here.
create function public.set_publication_status(
  product_id uuid,
  status public.publication_status,
  reason text default null
)
returns public.publication_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  cleaned text := nullif(pg_catalog.btrim(coalesce(set_publication_status.reason, '')), '');
  current_status public.publication_status;
  result public.publication_result;
  err_state text;
  err_constraint text;
  err_table text;
  err_schema text;
  err_column text;
  err_message text;
begin
  perform private.require_permission('manage_inventory');
  if set_publication_status.product_id is null or set_publication_status.status is null then
    raise exception 'product_id and status are required' using errcode = '22004';
  end if;
  if cleaned is not null and pg_catalog.char_length(cleaned) > 500 then
    raise exception using
      errcode = 'P0001',
      message = 'reason_too_long',
      detail = 'Keep the reason under 500 characters.';
  end if;

  -- Lock order step 3 (so a publish never interleaves with a part being
  -- added or a unit being written off), then step 6, the product row.
  perform private.lock_stock(set_publication_status.product_id);
  select p.publication_status into current_status
  from public.products p
  where p.id = set_publication_status.product_id
  for update;
  if not found then
    raise exception 'product % not found', set_publication_status.product_id using errcode = 'P0002';
  end if;

  -- 'sold' is set by a sale only, and only a sale's reversal or a restock
  -- takes a product out of 'sold' (back to public); by hand it can only be
  -- archived. A manual 'sold' is refused even when the product is already
  -- sold: it is never a choice staff make.
  if set_publication_status.status = 'sold'
     or (current_status = 'sold' and set_publication_status.status <> 'archived') then
    raise exception using
      errcode = 'P0001',
      message = 'publication_sold_by_sale',
      detail = 'A sold item changes status only through a sale or its reversal; it can be archived.';
  end if;

  if current_status <> set_publication_status.status then
    perform private.set_change_reason(cleaned);
    begin
      -- The products trigger checks the transition
      -- (publication_transition_invalid) and the requirements for entering
      -- public (publication_requires_price / _photo / _available_unit),
      -- assigns the slug at the first publish, and records
      -- publication_changed {from, to} with the reason.
      update public.products p
      set publication_status = set_publication_status.status
      where p.id = set_publication_status.product_id;
    exception
      when check_violation or not_null_violation then
        get stacked diagnostics
          err_state = returned_sqlstate, err_constraint = constraint_name, err_table = table_name,
          err_schema = schema_name, err_column = column_name, err_message = message_text;
        perform private.raise_without_row(err_state, err_constraint, err_table, err_schema, err_column, err_message);
    end;
    perform private.set_change_reason(null);
  end if;

  select p.id, p.publication_status, p.public_slug into result
  from public.products p
  where p.id = set_publication_status.product_id;
  return result;
end;
$$;

comment on function public.set_publication_status(uuid, public.publication_status, text) is
  'manage_inventory: move a product through the publication machine (D26) by hand; never to sold, and from sold only to archived; same status is a no-op.';

-- ---------------------------------------------------------------------------
-- split_unit_from_stock (D28 SPLIT-COST)
-- ---------------------------------------------------------------------------
-- One counted item becomes a unique item, with no separate machinery (SPEC
-- §11): the source loses one at the location (a stock_adjustment with the
-- reason), a new draft unique product is created with one available
-- shop-owned unit there (D27), and the unit's direct cost is the source's
-- default direct cost. The client's new unit id is this call's key: both
-- movements carry it as request_id, and a replay returns the same pair.
--
-- The definer writes the carried cost for a caller without view_costs; the
-- invoker cost-write guards do not fire for definer paths, on purpose: the
-- cost is the one already on the source, and the caller never sees it.
create function public.split_unit_from_stock(
  new_product_id uuid,
  unit_id uuid,
  source_product_id uuid,
  location_id uuid,
  name text,
  reason text,
  serial_number text default null,
  condition text default null,
  sale_price public.money_amount default null
)
returns public.split_unit_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  cleaned text := nullif(pg_catalog.btrim(coalesce(split_unit_from_stock.reason, '')), '');
  movement_reason text;
  existing public.inventory_units;
  source public.products;
  loc_active boolean;
  created_product public.products;
  created_unit public.inventory_units;
  result public.split_unit_result;
  err_state text;
  err_constraint text;
  err_table text;
  err_schema text;
  err_column text;
  err_message text;
begin
  perform private.require_permission('adjust_stock');
  perform private.require_permission('manage_inventory');
  if split_unit_from_stock.new_product_id is null or split_unit_from_stock.unit_id is null
     or split_unit_from_stock.source_product_id is null or split_unit_from_stock.location_id is null then
    raise exception 'new_product_id, unit_id, source_product_id and location_id are required'
      using errcode = '22004';
  end if;
  if cleaned is null then
    raise exception using
      errcode = 'P0001',
      message = 'reason_required',
      detail = 'Say why the item is being split from stock.';
  end if;
  -- The movements' reason is 'Split to U-######: ' (19 characters) plus
  -- this, within the ledger's 500.
  if pg_catalog.char_length(cleaned) > 480 then
    raise exception using
      errcode = 'P0001',
      message = 'reason_too_long',
      detail = 'Keep the reason under 480 characters.';
  end if;

  perform private.lock_stock(split_unit_from_stock.source_product_id);

  -- Replay: the same unit id on the same new product returns the pair; the
  -- ids used for anything else are unit_conflict.
  select u.* into existing from public.inventory_units u where u.id = split_unit_from_stock.unit_id;
  if found then
    if existing.product_id = split_unit_from_stock.new_product_id then
      select p.* into created_product from public.products p where p.id = existing.product_id;
      result := row(created_product.id, created_product.short_id, existing.id, existing.short_id);
      return result;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'unit_conflict',
      detail = 'That unit id is already used for another unit.';
  end if;
  if exists (select 1 from public.products p where p.id = split_unit_from_stock.new_product_id) then
    raise exception using
      errcode = 'P0001',
      message = 'unit_conflict',
      detail = 'That product id is already used for another product.';
  end if;

  select p.* into source from public.products p where p.id = split_unit_from_stock.source_product_id;
  if not found then
    raise exception 'product % not found', split_unit_from_stock.source_product_id using errcode = 'P0002';
  end if;
  if source.tracking_type <> 'quantity' then
    raise exception using
      errcode = 'P0001',
      message = 'product_not_quantity',
      detail = 'Only stock counted by quantity can be split into a unique item.';
  end if;
  if source.archived_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'product_archived',
      detail = 'That product is archived; unarchive it first.';
  end if;
  if source.ownership_type <> 'shop_owned' then
    raise exception using
      errcode = 'P0001',
      message = 'ownership_not_saleable',
      detail = 'Only shop-owned stock can be split into a unique item.';
  end if;
  select l.active into loc_active from public.locations l where l.id = split_unit_from_stock.location_id;
  if not found then
    raise exception 'location % not found', split_unit_from_stock.location_id using errcode = 'P0002';
  end if;
  if not loc_active then
    raise exception using
      errcode = 'P0001',
      message = 'location_inactive',
      detail = 'That location is inactive; choose another or reactivate it.';
  end if;
  if private.stock_on_hand(source.id, split_unit_from_stock.location_id) < 1 then
    raise exception using
      errcode = 'P0001',
      message = 'insufficient_stock',
      detail = 'There is none of that item at that location to split.';
  end if;

  perform private.set_change_reason(cleaned);
  begin
    insert into public.products as p (
      id, name, description, brand, category_id, tracking_type, publication_status,
      default_sale_price, default_direct_cost, currency
    )
    values (
      split_unit_from_stock.new_product_id, split_unit_from_stock.name, source.description, source.brand,
      source.category_id, 'unique', 'draft',
      coalesce(split_unit_from_stock.sale_price, source.default_sale_price), source.default_direct_cost,
      source.currency
    )
    returning p.* into created_product;
  exception
    when check_violation or not_null_violation then
      get stacked diagnostics
        err_state = returned_sqlstate, err_constraint = constraint_name, err_table = table_name,
        err_schema = schema_name, err_column = column_name, err_message = message_text;
      perform private.raise_without_row(err_state, err_constraint, err_table, err_schema, err_column, err_message);
  end;

  created_unit := private.register_unit(
    split_unit_from_stock.unit_id, created_product.id, split_unit_from_stock.location_id, 'shop_owned',
    split_unit_from_stock.serial_number, split_unit_from_stock.condition, null,
    source.default_direct_cost, null, null
  );

  movement_reason := 'Split to ' || created_unit.short_id || ': ' || cleaned;
  perform private.record_movement(
    source.id, null, split_unit_from_stock.location_id, -1, 'stock_adjustment', movement_reason,
    source.default_direct_cost, created_unit.id, null, null, null
  );
  perform private.record_movement(
    created_product.id, created_unit.id, split_unit_from_stock.location_id, 1, 'stock_adjustment',
    movement_reason, source.default_direct_cost, created_unit.id, null, null, null
  );
  perform private.set_change_reason(null);

  result := row(created_product.id, created_product.short_id, created_unit.id, created_unit.short_id);
  return result;
end;
$$;

comment on function public.split_unit_from_stock(
  uuid, uuid, uuid, uuid, text, text, text, text, public.money_amount
) is 'adjust_stock and manage_inventory: take one counted item out of stock as a new draft unique product and unit at the same location, carrying the source''s default cost (D28); replay-safe by unit id.';

-- ---------------------------------------------------------------------------
-- reporting.public_items: the only anonymous inventory surface (Phase 11's
-- /q contract, D9; DATA-MODEL §11, §15).
-- ---------------------------------------------------------------------------
-- A definer view (security_invoker off): it reads the staff-only tables as
-- its owner and does its own filtering, and security_barrier keeps a
-- caller's predicates from running before that filtering. Columns are an
-- explicit public list. private.selling_price is called as the caller (a
-- view's functions always are), so anon and authenticated have EXECUTE on
-- it; neither can reach it directly (`private` is not exposed, and anon has
-- no USAGE on it).
create view reporting.public_items
with (security_barrier)
as
  with visible_products as (
    select p.*
    from public.products p
    where p.publication_status in ('public', 'sold') and p.archived_at is null
  )
  select 'product'::text as kind,
         p.short_id,
         p.public_slug as slug,
         p.name,
         p.description,
         p.brand,
         c.name as category,
         null::text as condition,
         private.selling_price(p.id, null) as sale_price,
         p.currency::text as currency,
         (case
            when p.tracking_type = 'quantity' then
              case
                when p.publication_status = 'sold' then 'sold'
                when coalesce((
                       select sum(m.quantity_delta) from public.inventory_movements m where m.product_id = p.id
                     ), 0) > 0 then 'available'
                else 'sold_out'
              end
            else
              case
                when exists (
                  select 1 from public.inventory_units u
                  where u.product_id = p.id and u.status = 'available' and u.archived_at is null
                ) then 'available'
                when p.publication_status = 'sold' then 'sold'
                else 'unavailable'
              end
          end)::text as availability,
         coalesce((
           select pg_catalog.jsonb_agg(
                    pg_catalog.jsonb_build_object(
                      'bucket', a.storage_bucket, 'path', a.storage_path, 'width', a.width,
                      'height', a.height, 'caption', a.caption
                    )
                    order by a.created_at, a.id
                  )
           from public.attachments a
           where a.entity_type = 'product' and a.entity_id = p.id and a.visibility = 'public'
         ), '[]'::jsonb) as photos,
         p.updated_at
  from visible_products p
  left join public.categories c on c.id = p.category_id
  union all
  select 'unit'::text,
         u.short_id,
         p.public_slug,
         p.name,
         p.description,
         p.brand,
         c.name,
         u.condition,
         private.selling_price(p.id, u.id),
         p.currency::text,
         (case u.status when 'available' then 'available' when 'sold' then 'sold' else 'unavailable' end)::text,
         -- The unit's photos, then the product's, then the linked bike's
         -- taken before the unit was sold (a photo taken after the bike
         -- passed to its buyer never appears).
         coalesce((
           select pg_catalog.jsonb_agg(
                    pg_catalog.jsonb_build_object(
                      'bucket', ph.storage_bucket, 'path', ph.storage_path, 'width', ph.width,
                      'height', ph.height, 'caption', ph.caption
                    )
                    order by ph.source_order, ph.created_at, ph.id
                  )
           from (
             select a.*, 1 as source_order
             from public.attachments a
             where a.entity_type = 'inventory_unit' and a.entity_id = u.id and a.visibility = 'public'
             union all
             select a.*, 2
             from public.attachments a
             where a.entity_type = 'product' and a.entity_id = p.id and a.visibility = 'public'
             union all
             select a.*, 3
             from public.attachments a
             where u.bike_id is not null
               and a.entity_type = 'bike' and a.entity_id = u.bike_id and a.visibility = 'public'
               and a.created_at < coalesce(u.sold_at, 'infinity'::timestamptz)
           ) ph
         ), '[]'::jsonb),
         greatest(u.updated_at, p.updated_at)
  from visible_products p
  join public.inventory_units u on u.product_id = p.id
  left join public.categories c on c.id = p.category_id
  where u.archived_at is null
    and u.status not in ('written_off', 'returned_to_consignor');

comment on view reporting.public_items is
  'The only anonymous inventory surface (Phase 11 /q/{short_id}, D9): published (public or sold) products and their units, public columns and public photos only; sale_price is private.selling_price. Unknown and unpublished short IDs are absent.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function
  public.set_publication_status(uuid, public.publication_status, text),
  public.split_unit_from_stock(uuid, uuid, uuid, uuid, text, text, text, text, public.money_amount)
from public, anon, authenticated, service_role;

grant execute on function
  public.set_publication_status(uuid, public.publication_status, text),
  public.split_unit_from_stock(uuid, uuid, uuid, uuid, text, text, text, text, public.money_amount)
to authenticated;

-- public_items calls it as the caller (see the view's comment). anon has no
-- USAGE on `private`, so a direct call is refused; the view is its only
-- way in. Phase 6's create or replace keeps this grant.
grant execute on function private.selling_price(uuid, uuid) to anon;

-- anon reaches `reporting` for public_items only: every other reporting view
-- has no anon grant (tests/fixtures/api-surface.ts ANON_RELATIONS).
grant usage on schema reporting to anon;

revoke all on table reporting.public_items from public, anon, authenticated, service_role;
grant select on table reporting.public_items to anon, authenticated;
