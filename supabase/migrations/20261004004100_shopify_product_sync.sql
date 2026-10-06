-- Shopify integration, outbound: the one online price, the product-sync
-- queue writers, the staff publish / sync / settings RPCs, the service-role
-- sync state and result RPCs, the sync status view and the Buy-online link
-- of reporting.public_items (SPEC §17, §25, §26; DATA-MODEL.md §13, §14,
-- §15, §16; PLAN D24 (amended), D26, D45, D58, D81 SHOP-UNIQUE, D83
-- SHOP-LOCATION, D84 SHOP-PUBLISH, D86 SHOP-ACCESS, D87 SHOP-RETRY, D89
-- SHOP-TAX-TEST; ADR-020).
--
-- Rules encoded here, for every writer:
--   * D81/D84: private.shopify_online_price is THE online price: Phase 4's
--     private.selling_price (D58) for the oldest available, non-customer-
--     owned, non-archived unit at the online location of a unique product,
--     or for no unit (the FIFO consignment item of a consigned quantity
--     product, D45, else the default). The publish check, the sync state
--     and so Shopify all read it; nothing reads default_sale_price for an
--     online price. 0 is a price; only NULL is missing (D24 as amended).
--   * D84: Publish online needs a public, unarchived, not customer-owned
--     product with an online price. A product only linked to a variant of
--     a Shopify-made product (link_shopify_variant) is never queued until
--     it is published: private.enqueue_product_sync returns NULL unless the
--     sync row is published, was pushed before, or has a push running.
--   * Every change that can alter what Shopify shows (stock movements,
--     product fields, units, consignment asking prices, public product
--     photos, the online location) queues ONE product_sync job per product
--     (the one-queued-per-product index) and marks the product pending; a
--     new change supersedes a sync job that needs attention.
--   * D83: the service layer (step 3) reads public.product_sync_state and
--     reports public.record_product_sync_result; BICII's ledger is the
--     stock truth; a deferral (an online order in flight, or Shopify's
--     count moved) re-queues the job two minutes out without consuming an
--     attempt. D87: a retriable failure backs off, else needs attention.
--   * D86: manage_inventory publishes, asks for a sync and gets back only
--     the id of the job it created or reused (non-admins never read the
--     queue); admins change the settings (accept_test_orders only with a
--     reason, D89); every staff action writes one integration_audit_events
--     row; any active staff member reads reporting.shopify_sync_status (the
--     job columns are NULL for non-admins: the queue's RLS hides them).
--   * D84: reporting.public_items gains buy_online_url, the single
--     Buy-online rule Phase 11 reads: storefront_url || '/products/' ||
--     handle only for an available row of a published, synced,
--     BICII-created Shopify product while the storefront is set; never a
--     Shopify id, sync state, cost or payload.
--
-- GLOBAL LOCK ORDER (the consignment migration's header, extended):
--   ... 7 products FOR UPDATE; then
--   8  NEW: shopify_product_sync rows (ascending product id when several),
--      then integration_retry_queue rows of those products.
--   shopify_settings FOR UPDATE, when taken (set_shopify_settings,
--   record_product_sync_result filling the Shopify location), comes before
--   7. The enqueue triggers are DEFERRED constraint triggers: they run at
--   commit, after every lock of the business path (a sale writes its
--   movements before refresh_unique_publication locks the product, so an
--   immediate trigger taking the sync row there would invert 7 and 8 and
--   deadlock against a product edit or set_publish_online). Inside one
--   transaction the queued job is therefore visible only after commit or
--   SET CONSTRAINTS ALL IMMEDIATE (the tests' flush).

-- ---------------------------------------------------------------------------
-- Result types (a `returns table` cannot reuse an argument's name)
-- ---------------------------------------------------------------------------
create type public.shopify_publish_result as (
  product_id uuid,
  publish_online boolean,
  sync_status public.shopify_sync_status,
  job_id uuid
);

comment on type public.shopify_publish_result is
  'set_publish_online: the product, its Publish online flag, its sync status and the queued product_sync job this call created or reused (NULL when nothing was queued). The app runs exactly that job (D86).';

create type public.shopify_product_sync_state as (
  product_id uuid,
  short_id text,
  sku text,
  name text,
  description text,
  brand text,
  tracking_type public.tracking_type,
  ownership_type public.ownership_type,
  publication_status public.publication_status,
  active boolean,
  archived boolean,
  sale_price public.money_amount,
  currency char(3),
  publish_online boolean,
  effective_online boolean,
  available_quantity integer,
  unit_price_conflicts text[],
  public_photo_paths text[],
  handle text,
  shopify_origin text,
  shopify_product_id text,
  shopify_variant_id text,
  shopify_inventory_item_id text,
  shopify_location_id text,
  online_location_name text,
  last_desired_hash text,
  last_pushed_quantity integer,
  orders_in_flight boolean,
  sync_status public.shopify_sync_status
);

comment on type public.shopify_product_sync_state is
  'product_sync_state (service role): everything the sync worker needs to build a product''s desired Shopify state (D81, D83, D84). Never a cost.';

-- ---------------------------------------------------------------------------
-- Helpers (private; EXECUTE revoked from every API role)
-- ---------------------------------------------------------------------------

-- D81/D84: THE online price. A unique product: private.selling_price for
-- its oldest available, non-customer-owned, non-archived unit at the online
-- location (selling_price(product, null) when there is none); a quantity
-- product: selling_price(product, null) (the FIFO consignment item's
-- asking price for a consigned product, D45, else the default). NULL only
-- when no price is known (D24 as amended).
create function private.shopify_online_price(product_id uuid)
returns public.money_amount
language sql
stable
security definer
set search_path = ''
as $$
  select private.selling_price(
    p.id,
    case when p.tracking_type = 'unique' then (
      select u.id
      from public.inventory_units u
      where u.product_id = p.id
        and u.location_id = (select s.online_location_id from public.shopify_settings s where s.id = 1)
        and u.status = 'available'
        and u.ownership_type <> 'customer_owned'
        and u.archived_at is null
      order by u.created_at, u.id
      limit 1
    ) end
  )
  from public.products p
  where p.id = shopify_online_price.product_id;
$$;

comment on function private.shopify_online_price(uuid) is
  'D81/D84: the one online price = private.selling_price (D58) for the oldest available, non-customer-owned, non-archived unit at the online location of a unique product, or for no unit (quantity products: the FIFO consignment item, D45, else the default). The publish check, product_sync_state and so Shopify use it. NULL = no price; 0 is a price (D24).';

-- D84: whether a product should be live in Shopify now. A unique product
-- that sold out (publication 'sold', D26) stays effective and is pushed at
-- quantity 0.
create function private.shopify_effective_online(prod public.products, publish_online boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(shopify_effective_online.publish_online, false)
    and (shopify_effective_online.prod).active
    and (shopify_effective_online.prod).archived_at is null
    and (shopify_effective_online.prod).ownership_type <> 'customer_owned'
    and (
      (shopify_effective_online.prod).publication_status = 'public'
      or ((shopify_effective_online.prod).tracking_type = 'unique'
          and (shopify_effective_online.prod).publication_status = 'sold')
    );
$$;

-- Queue one product sync (D84, D87). NULL unless the product has a sync
-- row that is published, was pushed before, or has a push running (a
-- product only linked to a Shopify-made product's variant is never pushed
-- until published). Otherwise: supersede its needs_attention sync jobs,
-- queue a job (or keep the queued one: one queued per product), mark the
-- row pending and return the queued job's id. Lock order 8: the sync row,
-- then the product's queue rows.
create function private.enqueue_product_sync(product_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  sync public.shopify_product_sync;
  queued uuid;
begin
  if enqueue_product_sync.product_id is null then
    return null;
  end if;
  select s.* into sync
  from public.shopify_product_sync s
  where s.product_id = enqueue_product_sync.product_id
  for update;
  if not found then
    return null;
  end if;
  if not (
    sync.publish_online
    or sync.last_pushed_at is not null
    or exists (
      select 1 from public.integration_retry_queue q
      where q.kind = 'product_sync' and q.product_id = sync.product_id and q.status = 'running'
    )
  ) then
    return null;
  end if;

  update public.integration_retry_queue q
  set status = 'dismissed', resolved_at = pg_catalog.now(), resolved_by = null, locked_at = null,
      resolution_reason = 'Superseded by a newer change'
  where q.kind = 'product_sync' and q.product_id = sync.product_id and q.status = 'needs_attention';

  insert into public.integration_retry_queue as q (kind, product_id)
  values ('product_sync', sync.product_id)
  on conflict (product_id) where kind = 'product_sync' and status = 'queued' do nothing
  returning q.id into queued;
  if queued is null then
    select q.id into queued
    from public.integration_retry_queue q
    where q.kind = 'product_sync' and q.product_id = sync.product_id and q.status = 'queued';
  end if;

  if sync.sync_status <> 'pending' then
    update public.shopify_product_sync s set sync_status = 'pending' where s.product_id = sync.product_id;
  end if;
  return queued;
end;
$$;

comment on function private.enqueue_product_sync(uuid) is
  'D84/D87: queue one product_sync job for a product whose sync row is published, was pushed before or has a push running (NULL otherwise: link-only products are never queued); supersedes its needs_attention sync jobs, keeps one queued job per product, marks the row pending and returns the queued job id. Called by the RPCs and the deferred enqueue triggers; no API role may execute it.';

-- ---------------------------------------------------------------------------
-- product_sync_state (service role): the input of one product sync.
-- ---------------------------------------------------------------------------
create function public.product_sync_state(product_id uuid)
returns public.shopify_product_sync_state
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  prod public.products;
  sync public.shopify_product_sync;
  settings public.shopify_settings;
  r public.shopify_product_sync_state;
begin
  if product_sync_state.product_id is null then
    raise exception 'product_id is required' using errcode = '22004';
  end if;
  select p.* into prod from public.products p where p.id = product_sync_state.product_id;
  if not found then
    raise exception 'product % not found', product_sync_state.product_id using errcode = 'P0002';
  end if;
  select s.* into settings from public.shopify_settings s where s.id = 1;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'shopify_settings_missing',
      detail = 'Shopify settings are missing. Ask an admin to set the online location.';
  end if;
  select s.* into sync from public.shopify_product_sync s where s.product_id = prod.id;

  r.product_id := prod.id;
  r.short_id := prod.short_id;
  r.sku := prod.sku;
  r.name := prod.name;
  r.description := prod.description;
  r.brand := prod.brand;
  r.tracking_type := prod.tracking_type;
  r.ownership_type := prod.ownership_type;
  r.publication_status := prod.publication_status;
  r.active := prod.active;
  r.archived := prod.archived_at is not null;
  r.sale_price := private.shopify_online_price(prod.id);
  r.currency := prod.currency;
  r.publish_online := coalesce(sync.publish_online, false);
  r.effective_online := private.shopify_effective_online(prod, sync.publish_online);

  if prod.tracking_type = 'unique' then
    -- D81: the units an online order can take, oldest first.
    select count(*)::integer,
           coalesce(
             pg_catalog.array_agg(u.short_id order by u.created_at, u.id)
               filter (where private.selling_price(prod.id, u.id) is distinct from r.sale_price),
             '{}'
           )
    into r.available_quantity, r.unit_price_conflicts
    from public.inventory_units u
    where u.product_id = prod.id
      and u.location_id = settings.online_location_id
      and u.status = 'available'
      and u.ownership_type <> 'customer_owned'
      and u.archived_at is null;
  else
    r.available_quantity := greatest(private.stock_on_hand(prod.id, settings.online_location_id), 0);
    r.unit_price_conflicts := '{}';
  end if;

  select coalesce(pg_catalog.array_agg(a.storage_path order by a.created_at, a.id), '{}')
  into r.public_photo_paths
  from public.attachments a
  where a.entity_type = 'product' and a.entity_id = prod.id and a.visibility = 'public'
    and a.storage_bucket = 'media-public';

  r.handle := case when sync.shopify_origin = 'external' then null else private.shopify_handle(prod.short_id) end;
  r.shopify_origin := sync.shopify_origin;
  r.shopify_product_id := prod.shopify_product_id;
  r.shopify_variant_id := prod.shopify_variant_id;
  r.shopify_inventory_item_id := sync.shopify_inventory_item_id;
  r.shopify_location_id := settings.shopify_location_id;
  select l.name into r.online_location_name from public.locations l where l.id = settings.online_location_id;
  r.last_desired_hash := sync.desired_hash;
  r.last_pushed_quantity := sync.last_pushed_quantity;
  -- D83: an online order may be about to take stock BICII has not recorded.
  r.orders_in_flight := exists (
    select 1
    from public.integration_events e
    where e.topic = 'orders/paid'
      and e.received_at > pg_catalog.now() - interval '10 minutes'
      and (
        e.status = 'pending'
        or (e.status = 'failed' and exists (
          select 1 from public.integration_retry_queue q
          where q.integration_event_id = e.id and q.status in ('queued', 'running')
        ))
      )
  );
  r.sync_status := coalesce(sync.sync_status, 'not_synced');
  return r;
end;
$$;

comment on function public.product_sync_state(uuid) is
  'service_role (the sync worker, step 3): a product''s desired Shopify state. sale_price = private.shopify_online_price (D81: a consigned item at its asking price, like its label and public page); effective_online (D84: published, public or a sold-out unique product, active, not archived, not customer-owned); available_quantity at the online location floored at 0 (D83: the ledger for quantity products, available non-customer-owned units for unique ones); unit_price_conflicts (units whose own selling price differs: sync refuses, D81); public photo paths oldest first; handle bicii-<short id> unless the Shopify product was made in Shopify; orders_in_flight (an orders/paid event of the last 10 minutes pending, or failed with its job queued or running). P0002 unknown product; shopify_settings_missing.';

-- ---------------------------------------------------------------------------
-- record_product_sync_result (service role): what one sync did.
-- ---------------------------------------------------------------------------
create function public.record_product_sync_result(
  product_id uuid,
  job_id uuid,
  outcome text,
  shopify_product_id text,
  shopify_variant_id text,
  shopify_inventory_item_id text,
  shopify_location_id text,
  pushed_quantity integer,
  pushed_price public.money_amount,
  desired_hash text,
  api_version text,
  error_code text,
  error_message text,
  retriable boolean
)
returns public.shopify_product_sync
language plpgsql
volatile
security definer
set search_path = ''
as $$
-- Arguments are always written qualified (record_product_sync_result.x);
-- a bare name is the column.
#variable_conflict use_column
declare
  prod public.products;
  sync public.shopify_product_sync;
  job public.integration_retry_queue;
  has_job boolean := false;
  product_gid text;
  variant_gid text;
  item_gid text;
  location_gid text;
  origin text;
  successor uuid;
  settled public.shopify_sync_status;
  clean_message text := nullif(pg_catalog.btrim(record_product_sync_result.error_message), '');
  clean_code text := nullif(pg_catalog.btrim(record_product_sync_result.error_code), '');
begin
  if record_product_sync_result.product_id is null or record_product_sync_result.outcome is null then
    raise exception 'product_id and outcome are required' using errcode = '22004';
  end if;
  if record_product_sync_result.outcome not in ('pushed', 'unchanged', 'deferred', 'failed') then
    raise exception 'unknown sync outcome %', record_product_sync_result.outcome using errcode = '22023';
  end if;
  if record_product_sync_result.outcome = 'failed' and clean_message is null then
    raise exception 'a failed sync needs its human message' using errcode = '22004';
  end if;

  -- Lock order: the settings row (only when filling the Shopify location),
  -- the product (7), its sync row (8), then the job.
  if record_product_sync_result.outcome = 'pushed' then
    product_gid := private.shopify_gid('Product', record_product_sync_result.shopify_product_id);
    variant_gid := private.shopify_gid('ProductVariant', record_product_sync_result.shopify_variant_id);
    item_gid := private.shopify_gid('InventoryItem', record_product_sync_result.shopify_inventory_item_id);
    location_gid := private.shopify_gid('Location', record_product_sync_result.shopify_location_id);
    if product_gid is null or variant_gid is null or record_product_sync_result.pushed_quantity is null then
      raise exception 'a push needs the Shopify product and variant and the pushed quantity' using errcode = '22004';
    end if;
    if location_gid is not null then
      update public.shopify_settings s
      set shopify_location_id = location_gid
      where s.id = 1 and s.shopify_location_id is null;
    end if;
  end if;

  select p.* into prod from public.products p where p.id = record_product_sync_result.product_id for update;
  if not found then
    raise exception 'product % not found', record_product_sync_result.product_id using errcode = 'P0002';
  end if;
  select s.* into sync from public.shopify_product_sync s where s.product_id = prod.id for update;
  if not found then
    raise exception 'product % has no Shopify sync record', prod.id using errcode = 'P0002';
  end if;
  if record_product_sync_result.job_id is not null then
    select q.* into job from public.integration_retry_queue q where q.id = record_product_sync_result.job_id for update;
    if not found then
      raise exception 'integration job % not found', record_product_sync_result.job_id using errcode = 'P0002';
    end if;
    if job.kind <> 'product_sync' or job.product_id <> prod.id then
      raise exception 'job % is not a sync of product %', job.id, prod.id using errcode = '22023';
    end if;
    -- A job closed meanwhile (dismissed, superseded) is left as it is.
    has_job := job.status in ('queued', 'running', 'needs_attention');
  end if;
  select q.id into successor
  from public.integration_retry_queue q
  where q.kind = 'product_sync' and q.product_id = prod.id and q.status = 'queued'
    and q.id is distinct from record_product_sync_result.job_id;

  if record_product_sync_result.outcome = 'pushed' then
    if (prod.shopify_product_id is not null and prod.shopify_product_id <> product_gid)
       or (prod.shopify_variant_id is not null and prod.shopify_variant_id <> variant_gid) then
      raise exception using
        errcode = 'P0001',
        message = 'shopify_ids_conflict',
        detail = 'This product is already linked to a different Shopify product.';
    end if;
    origin := coalesce(sync.shopify_origin, 'bicii');
    -- A Shopify product BICII created belongs to this one product (D84).
    if origin = 'bicii' and exists (
      select 1 from public.products o where o.shopify_product_id = product_gid and o.id <> prod.id
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'shopify_ids_conflict',
        detail = 'That Shopify product belongs to another BICII product.';
    end if;
    if prod.shopify_product_id is null or prod.shopify_variant_id is null then
      perform private.set_change_reason('Created in Shopify by the BICII sync');
      -- Another product's variant raises products_shopify_variant_id_key.
      update public.products p
      set shopify_product_id = product_gid, shopify_variant_id = variant_gid
      where p.id = prod.id;
      perform private.set_change_reason(null);
    end if;
    update public.shopify_product_sync s
    set shopify_origin = origin,
        shopify_inventory_item_id = coalesce(item_gid, s.shopify_inventory_item_id),
        shopify_handle = case when origin = 'bicii' then private.shopify_handle(prod.short_id) end,
        last_pushed_at = pg_catalog.now(),
        last_checked_at = pg_catalog.now(),
        last_pushed_quantity = record_product_sync_result.pushed_quantity,
        last_pushed_price = record_product_sync_result.pushed_price,
        desired_hash = record_product_sync_result.desired_hash,
        api_version = record_product_sync_result.api_version,
        last_error_code = null,
        last_error = null
    where s.product_id = prod.id
    returning s.* into sync;
  elsif record_product_sync_result.outcome = 'unchanged' then
    update public.shopify_product_sync s
    set last_checked_at = pg_catalog.now(), last_error_code = null, last_error = null
    where s.product_id = prod.id
    returning s.* into sync;
  end if;

  if record_product_sync_result.outcome in ('pushed', 'unchanged') then
    settled := case
      when successor is not null then 'pending'
      when private.shopify_effective_online(prod, sync.publish_online) then 'synced'
      when sync.last_pushed_at is null then 'not_synced'
      else 'unpublished'
    end;
    update public.shopify_product_sync s set sync_status = settled where s.product_id = prod.id
    returning s.* into sync;
    if has_job then
      update public.integration_retry_queue q
      set status = 'done', resolved_at = pg_catalog.now(), locked_at = null,
          last_error_code = null, last_error = null
      where q.id = job.id;
    end if;
    -- A later successful sync resolves an older one that needed attention.
    update public.integration_retry_queue q
    set status = 'dismissed', resolved_at = pg_catalog.now(), resolved_by = null, locked_at = null,
        resolution_reason = 'Resolved by a later sync'
    where q.kind = 'product_sync' and q.product_id = prod.id and q.status = 'needs_attention'
      and q.id is distinct from record_product_sync_result.job_id;

  elsif record_product_sync_result.outcome = 'deferred' then
    -- D83: wait two minutes for the order webhook; a deferral consumes no
    -- attempt. A newer queued job of the product takes the wait instead.
    if has_job then
      if successor is not null then
        update public.integration_retry_queue q
        set status = 'dismissed', resolved_at = pg_catalog.now(), resolved_by = null, locked_at = null,
            resolution_reason = 'Superseded by a newer change'
        where q.id = job.id;
        update public.integration_retry_queue q
        set next_attempt_at = greatest(q.next_attempt_at, pg_catalog.now() + interval '2 minutes')
        where q.id = successor;
      else
        update public.integration_retry_queue q
        set status = 'queued', locked_at = null,
            next_attempt_at = pg_catalog.now() + interval '2 minutes',
            attempts = greatest(q.attempts - 1, 0),
            last_error_code = pg_catalog.left(clean_code, 100),
            last_error = pg_catalog.left(clean_message, 2000)
        where q.id = job.id;
      end if;
    end if;

  else
    -- 'failed' (D87).
    update public.shopify_product_sync s
    set sync_status = 'error', last_checked_at = pg_catalog.now(),
        last_error_code = pg_catalog.left(coalesce(clean_code, 'shopify_sync_failed'), 100),
        last_error = pg_catalog.left(clean_message, 1000)
    where s.product_id = prod.id
    returning s.* into sync;
    if has_job then
      if coalesce(record_product_sync_result.retriable, false) and job.attempts < job.max_attempts then
        if successor is not null then
          update public.integration_retry_queue q
          set status = 'dismissed', resolved_at = pg_catalog.now(), resolved_by = null, locked_at = null,
              resolution_reason = 'Superseded by a newer change'
          where q.id = job.id;
          update public.integration_retry_queue q
          set next_attempt_at = greatest(q.next_attempt_at, pg_catalog.now() + private.integration_backoff(job.attempts))
          where q.id = successor;
        else
          update public.integration_retry_queue q
          set status = 'queued', locked_at = null,
              next_attempt_at = pg_catalog.now() + private.integration_backoff(job.attempts),
              last_error_code = pg_catalog.left(coalesce(clean_code, 'shopify_sync_failed'), 100),
              last_error = pg_catalog.left(clean_message, 2000)
          where q.id = job.id;
        end if;
      else
        update public.integration_retry_queue q
        set status = 'needs_attention', locked_at = null, next_attempt_at = pg_catalog.now(),
            last_error_code = pg_catalog.left(coalesce(clean_code, 'shopify_sync_failed'), 100),
            last_error = pg_catalog.left(clean_message, 2000)
        where q.id = job.id;
      end if;
    end if;
  end if;

  return sync;
end;
$$;

comment on function public.record_product_sync_result(
  uuid, uuid, text, text, text, text, text, integer, public.money_amount, text, text, text, text, boolean
) is
  'service_role (the sync worker, step 3): record one sync. pushed: the Shopify product and variant ids are stored on products when missing (origin bicii; reason "Created in Shopify by the BICII sync"; different ids, or a BICII-created Shopify product another product carries -> shopify_ids_conflict), the inventory item, handle (bicii only), pushed quantity, price, hash and API version on the sync row, errors cleared, the Shopify location filled when missing, the job done. unchanged: checked now, errors cleared, job done. Both settle the status: pending when another sync is queued, else synced when effectively online, not_synced when never pushed, unpublished otherwise; and close older needs_attention syncs. deferred (D83): the job re-queued 2 minutes out without consuming an attempt. failed (D87): status error with the human message; the job re-queued with backoff when retriable and attempts remain, else needs_attention. A queued successor takes over a re-queue. job_id may be null; an unknown outcome is 22023.';

-- ---------------------------------------------------------------------------
-- set_publish_online (manage_inventory, D84, D86)
-- ---------------------------------------------------------------------------
create function public.set_publish_online(product_id uuid, publish boolean)
returns public.shopify_publish_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  actor uuid := private.require_permission('manage_inventory');
  prod public.products;
  sync public.shopify_product_sync;
  was boolean;
  queued uuid;
  result public.shopify_publish_result;
begin
  if set_publish_online.product_id is null or set_publish_online.publish is null then
    raise exception 'product_id and publish are required' using errcode = '22004';
  end if;
  select p.* into prod from public.products p where p.id = set_publish_online.product_id for update;
  if not found then
    raise exception 'product % not found', set_publish_online.product_id using errcode = 'P0002';
  end if;
  if set_publish_online.publish then
    if prod.archived_at is not null then
      raise exception using
        errcode = 'P0001',
        message = 'shopify_product_archived',
        detail = 'Unarchive the product before publishing it online.';
    end if;
    if prod.ownership_type = 'customer_owned' then
      raise exception using
        errcode = 'P0001',
        message = 'shopify_not_saleable',
        detail = 'Customer-owned items cannot be sold online.';
    end if;
    if prod.publication_status <> 'public' then
      raise exception using
        errcode = 'P0001',
        message = 'shopify_requires_public',
        detail = 'Make the product public before publishing it online.';
    end if;
    -- D24 as amended: 0 is a price; only NULL is missing.
    if private.shopify_online_price(prod.id) is null then
      raise exception using
        errcode = 'P0001',
        message = 'shopify_price_missing',
        detail = 'Set a sale price before publishing it online.';
    end if;
  end if;

  select s.* into sync from public.shopify_product_sync s where s.product_id = prod.id for update;
  was := coalesce(sync.publish_online, false);
  if was = set_publish_online.publish then
    -- A replay: nothing queued, nothing audited.
    result := row(prod.id, was, coalesce(sync.sync_status, 'not_synced'), null::uuid);
    return result;
  end if;

  -- Never sets shopify_handle: only a push of a BICII-created product does.
  insert into public.shopify_product_sync as s (product_id, publish_online, publish_changed_by, publish_changed_at)
  values (prod.id, set_publish_online.publish, actor, pg_catalog.now())
  on conflict (product_id) do update
    set publish_online = excluded.publish_online,
        publish_changed_by = excluded.publish_changed_by,
        publish_changed_at = excluded.publish_changed_at
  returning s.* into sync;

  queued := private.enqueue_product_sync(prod.id);
  if queued is null then
    -- Unpublished before it ever reached Shopify: nothing to push.
    update public.integration_retry_queue q
    set status = 'dismissed', resolved_at = pg_catalog.now(), resolved_by = actor, locked_at = null,
        resolution_reason = 'Unpublished before the first sync'
    where q.kind = 'product_sync' and q.product_id = prod.id and q.status in ('queued', 'needs_attention');
    update public.shopify_product_sync s set sync_status = 'not_synced' where s.product_id = prod.id
    returning s.* into sync;
  else
    select s.* into sync from public.shopify_product_sync s where s.product_id = prod.id;
  end if;

  insert into public.integration_audit_events (
    event_type, product_id, job_id, actor_staff_id, payload, correlation_id
  )
  values (
    'publish_online_changed', prod.id, queued, actor,
    pg_catalog.jsonb_build_object('from', was, 'to', set_publish_online.publish),
    private.current_correlation_id()
  );
  result := row(prod.id, sync.publish_online, sync.sync_status, queued);
  return result;
end;
$$;

comment on function public.set_publish_online(uuid, boolean) is
  'manage_inventory (D86): turn Publish online on or off (D84). Publishing needs an unarchived (shopify_product_archived), not customer-owned (shopify_not_saleable), public (shopify_requires_public) product with an online price (shopify_price_missing; 0 is a price, D24). Same value: the current state, job_id NULL, no audit. Otherwise queues the product''s sync and returns its job id (the app runs exactly that job); unpublishing a product never pushed is not_synced with no job. Audited (publish_online_changed {from, to}).';

-- ---------------------------------------------------------------------------
-- request_product_sync (manage_inventory, "Sync now")
-- ---------------------------------------------------------------------------
create function public.request_product_sync(product_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  actor uuid := private.require_permission('manage_inventory');
  sync public.shopify_product_sync;
  queued uuid;
begin
  if request_product_sync.product_id is null then
    raise exception 'product_id is required' using errcode = '22004';
  end if;
  if not exists (select 1 from public.products p where p.id = request_product_sync.product_id) then
    raise exception 'product % not found', request_product_sync.product_id using errcode = 'P0002';
  end if;
  select s.* into sync
  from public.shopify_product_sync s
  where s.product_id = request_product_sync.product_id
  for update;
  if not found or not (sync.publish_online or sync.last_pushed_at is not null) then
    raise exception using
      errcode = 'P0001',
      message = 'shopify_not_published',
      detail = 'Publish the product online first.';
  end if;
  -- Sync now pushes in full: the next run does not skip on an equal hash.
  update public.shopify_product_sync s set desired_hash = null where s.product_id = sync.product_id;
  queued := private.enqueue_product_sync(sync.product_id);
  update public.integration_retry_queue q
  set next_attempt_at = pg_catalog.now()
  where q.id = queued and q.next_attempt_at > pg_catalog.now();
  insert into public.integration_audit_events (
    event_type, product_id, job_id, actor_staff_id, payload, correlation_id
  )
  values ('sync_requested', sync.product_id, queued, actor, '{}'::jsonb, private.current_correlation_id());
  return queued;
end;
$$;

comment on function public.request_product_sync(uuid) is
  'manage_inventory (D86): Sync now. Needs a published or previously pushed product (shopify_not_published); clears desired_hash so the next run pushes in full, queues (or reuses) the product''s sync job due now and returns its id (the app runs exactly that job). Audited (sync_requested).';

-- ---------------------------------------------------------------------------
-- set_shopify_settings (admin): the only editor of the settings row.
-- ---------------------------------------------------------------------------
create function public.set_shopify_settings(
  online_location_id uuid,
  storefront_url text,
  accept_test_orders boolean,
  reason text
)
returns public.shopify_settings
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  actor uuid := private.require_admin();
  settings public.shopify_settings;
  existed boolean;
  loc public.locations;
  url text := pg_catalog.rtrim(nullif(pg_catalog.btrim(set_shopify_settings.storefront_url), ''), '/');
  cleaned text := nullif(pg_catalog.btrim(coalesce(set_shopify_settings.reason, '')), '');
  before jsonb;
begin
  if set_shopify_settings.online_location_id is null or set_shopify_settings.accept_test_orders is null then
    raise exception 'online_location_id and accept_test_orders are required' using errcode = '22004';
  end if;
  select s.* into settings from public.shopify_settings s where s.id = 1 for update;
  existed := found;
  select l.* into loc from public.locations l where l.id = set_shopify_settings.online_location_id;
  if not found then
    raise exception 'location % not found', set_shopify_settings.online_location_id using errcode = 'P0002';
  end if;
  if not loc.active and (not existed or settings.online_location_id <> loc.id) then
    raise exception using
      errcode = 'P0001',
      message = 'location_inactive',
      detail = 'That location is inactive. Choose another or reactivate it.';
  end if;
  if existed
     and settings.online_location_id = loc.id
     and settings.storefront_url is not distinct from url
     and settings.accept_test_orders = set_shopify_settings.accept_test_orders then
    return settings;
  end if;
  -- D89: recording test orders is changed only with a reason.
  if (existed and settings.accept_test_orders <> set_shopify_settings.accept_test_orders)
     or (not existed and set_shopify_settings.accept_test_orders) then
    cleaned := private.require_reason(cleaned);
  elsif cleaned is not null then
    cleaned := private.require_reason(cleaned);
  end if;

  if existed then
    before := pg_catalog.jsonb_build_object(
      'online_location_id', settings.online_location_id,
      'storefront_url', settings.storefront_url,
      'accept_test_orders', settings.accept_test_orders
    );
    -- A new online location queues every published product (the trigger).
    update public.shopify_settings s
    set online_location_id = loc.id, storefront_url = url,
        accept_test_orders = set_shopify_settings.accept_test_orders, updated_by = actor
    where s.id = 1
    returning s.* into settings;
  else
    insert into public.shopify_settings as s (id, online_location_id, storefront_url, accept_test_orders, updated_by)
    values (1, loc.id, url, set_shopify_settings.accept_test_orders, actor)
    returning s.* into settings;
  end if;

  insert into public.integration_audit_events (event_type, actor_staff_id, reason, payload, correlation_id)
  values (
    'settings_changed', actor, cleaned,
    pg_catalog.jsonb_build_object(
      'from', before,
      'to', pg_catalog.jsonb_build_object(
        'online_location_id', settings.online_location_id,
        'storefront_url', settings.storefront_url,
        'accept_test_orders', settings.accept_test_orders
      )
    ),
    private.current_correlation_id()
  );
  return settings;
end;
$$;

comment on function public.set_shopify_settings(uuid, text, boolean, text) is
  'Admins (D86): set the online location (D83; must exist, P0002, and be active when it changes, location_inactive), the storefront address (D84; https or NULL, trailing slashes trimmed; the only editor of storefront_url) and whether test orders are recorded (D89: a change needs a reason, reason_required). Creates the row when absent. Same values: unchanged, no audit. A new online location queues every published or pushed product. Audited (settings_changed {from, to}).';

-- ---------------------------------------------------------------------------
-- Enqueue triggers (D84). Deferred to commit: see the lock order above.
-- ---------------------------------------------------------------------------
create function private.shopify_enqueue_product_change()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'inventory_movements' then
    perform private.enqueue_product_sync(new.product_id);
  elsif tg_table_name = 'products' then
    perform private.enqueue_product_sync(new.id);
  elsif tg_table_name = 'inventory_units' then
    perform private.enqueue_product_sync(new.product_id);
  elsif tg_table_name = 'consignment_items' then
    perform private.enqueue_product_sync(new.product_id);
  elsif tg_table_name = 'attachments' then
    if tg_op in ('UPDATE', 'DELETE') and old.entity_type = 'product' then
      perform private.enqueue_product_sync(old.entity_id);
    end if;
    if tg_op in ('INSERT', 'UPDATE') and new.entity_type = 'product'
       and (tg_op = 'INSERT' or new.entity_id is distinct from old.entity_id) then
      perform private.enqueue_product_sync(new.entity_id);
    end if;
  end if;
  return null;
end;
$$;

comment on function private.shopify_enqueue_product_change() is
  'Deferred enqueue trigger (D84): queues the product sync of the product a stock movement, product edit, unit change, consignment asking-price change or public product photo touches. private.enqueue_product_sync ignores products that are not published or pushed.';

-- Every stock change (the ledger is the online stock, D83).
create constraint trigger inventory_movements_enqueue_shopify_sync
  after insert on public.inventory_movements
  deferrable initially deferred
  for each row
  execute function private.shopify_enqueue_product_change();

-- What Shopify shows of the product (title, description, vendor, SKU,
-- price, status).
create constraint trigger products_enqueue_shopify_sync
  after update of name, description, brand, sku, default_sale_price, publication_status, active, archived_at
  on public.products
  deferrable initially deferred
  for each row
  when (
    (old.name, old.description, old.brand, old.sku, old.default_sale_price, old.publication_status, old.active,
     old.archived_at)
    is distinct from
    (new.name, new.description, new.brand, new.sku, new.default_sale_price, new.publication_status, new.active,
     new.archived_at)
  )
  execute function private.shopify_enqueue_product_change();

-- A unique product's online quantity and price (D81).
create constraint trigger inventory_units_enqueue_shopify_sync_insert
  after insert on public.inventory_units
  deferrable initially deferred
  for each row
  execute function private.shopify_enqueue_product_change();

create constraint trigger inventory_units_enqueue_shopify_sync_update
  after update of status, location_id, sale_price, ownership_type, archived_at on public.inventory_units
  deferrable initially deferred
  for each row
  when (
    (old.status, old.location_id, old.sale_price, old.ownership_type, old.archived_at)
    is distinct from
    (new.status, new.location_id, new.sale_price, new.ownership_type, new.archived_at)
  )
  execute function private.shopify_enqueue_product_change();

-- A consigned item's asking price is its online price (D45, D58).
create constraint trigger consignment_items_enqueue_shopify_sync
  after update of asking_price on public.consignment_items
  deferrable initially deferred
  for each row
  when (old.asking_price is distinct from new.asking_price)
  execute function private.shopify_enqueue_product_change();

-- Public product photos are pushed as media (D84).
create constraint trigger attachments_enqueue_shopify_sync_insert
  after insert on public.attachments
  deferrable initially deferred
  for each row
  when (new.entity_type = 'product' and new.visibility = 'public')
  execute function private.shopify_enqueue_product_change();

create constraint trigger attachments_enqueue_shopify_sync_delete
  after delete on public.attachments
  deferrable initially deferred
  for each row
  when (old.entity_type = 'product' and old.visibility = 'public')
  execute function private.shopify_enqueue_product_change();

create constraint trigger attachments_enqueue_shopify_sync_update
  after update of visibility, entity_type, entity_id on public.attachments
  deferrable initially deferred
  for each row
  when (
    (old.entity_type = 'product' or new.entity_type = 'product')
    and (old.visibility, old.entity_type, old.entity_id) is distinct from (new.visibility, new.entity_type, new.entity_id)
  )
  execute function private.shopify_enqueue_product_change();

-- A new online location changes every published product's stock (D83).
-- Immediate: set_shopify_settings holds the settings row, then takes the
-- sync rows in product order (lock order 8).
create function private.shopify_settings_enqueue_all()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.enqueue_product_sync(s.product_id)
  from public.shopify_product_sync s
  where s.publish_online or s.last_pushed_at is not null
  order by s.product_id;
  return null;
end;
$$;

create trigger shopify_settings_enqueue_all
  after update of online_location_id on public.shopify_settings
  for each row
  when (old.online_location_id is distinct from new.online_location_id)
  execute function private.shopify_settings_enqueue_all();

-- ---------------------------------------------------------------------------
-- reporting.shopify_sync_status (any active staff member, D86)
-- ---------------------------------------------------------------------------
create view reporting.shopify_sync_status
with (security_invoker = true)
as
  select s.product_id,
         p.short_id,
         p.name,
         p.tracking_type,
         p.publication_status,
         s.publish_online,
         s.shopify_origin,
         s.sync_status,
         s.last_pushed_at,
         s.last_pushed_quantity,
         s.last_error_code,
         s.last_error,
         p.shopify_product_id,
         p.shopify_variant_id,
         j.id as open_job_id,
         j.status as open_job_status,
         j.next_attempt_at as open_job_next_attempt_at
  from public.shopify_product_sync s
  join public.products p on p.id = s.product_id
  left join lateral (
    select q.id, q.status, q.next_attempt_at
    from public.integration_retry_queue q
    where q.kind = 'product_sync' and q.product_id = s.product_id
      and q.status in ('running', 'queued', 'needs_attention')
    order by case q.status when 'running' then 0 when 'queued' then 1 else 2 end, q.created_at desc
    limit 1
  ) j on true;

comment on view reporting.shopify_sync_status is
  'One row per product with a Shopify sync row: Publish online, origin, sync status, what was last pushed, the last error and the Shopify ids, plus its open sync job (running, else queued, else needs_attention). security_invoker: active staff read the rows (D86); the job columns are NULL for non-admins because the queue''s RLS hides it; customers and anonymous users read nothing.';

-- ---------------------------------------------------------------------------
-- reporting.public_items: + buy_online_url (D84), appended to both
-- branches. Every other column, its order, the filters, security_barrier
-- and the definer mode are unchanged; it reads shopify_product_sync and
-- shopify_settings as its owner, like the other staff-only tables.
-- ---------------------------------------------------------------------------
create or replace view reporting.public_items
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
         av.availability,
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
         p.updated_at,
         -- D84: the link only when the price this row shows is the price
         -- Shopify charges: private.shopify_online_price, inlined (it is
         -- not granted to the API roles): a unique product's row shows the
         -- product price, Shopify sells its oldest unit at the online
         -- location at that unit's price (D81).
         (case
            when av.availability = 'available' and ps.publish_online and ps.sync_status = 'synced'
                 and ps.shopify_origin = 'bicii' and ps.shopify_handle is not null
                 and ss.storefront_url is not null
                 and (p.tracking_type = 'quantity'
                      or private.selling_price(p.id, null) is not distinct from private.selling_price(p.id, ou.id))
              then ss.storefront_url || '/products/' || ps.shopify_handle
          end)::text as buy_online_url
  from visible_products p
  left join public.categories c on c.id = p.category_id
  cross join lateral (
    select (case
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
            end)::text as availability
  ) av
  left join public.shopify_product_sync ps on ps.product_id = p.id
  left join public.shopify_settings ss on ss.id = 1
  -- The unit an online order takes (D81; as private.shopify_online_price).
  left join lateral (
    select o.id
    from public.inventory_units o
    where p.tracking_type = 'unique'
      and o.product_id = p.id
      and o.location_id = ss.online_location_id
      and o.status = 'available'
      and o.ownership_type <> 'customer_owned'
      and o.archived_at is null
    order by o.created_at, o.id
    limit 1
  ) ou on true
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
         uav.availability,
         -- The unit's photos, then the product's, then the linked bike's
         -- taken before the unit was sold and before the bike first passed
         -- to a customer after the unit was registered (a photo taken after
         -- the bike passed to its buyer never appears, even if a reopen or a
         -- re-completion later moved sold_at; D29).
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
               and a.created_at < coalesce(
                     least(
                       u.sold_at,
                       (select pg_catalog.min(e.created_at)
                        from public.bike_ownership_events e
                        where e.bike_id = u.bike_id and e.to_customer_id is not null
                          and e.created_at >= u.created_at)
                     ),
                     'infinity'::timestamptz
                   )
           ) ph
         ), '[]'::jsonb),
         greatest(u.updated_at, p.updated_at),
         -- D84: the link only on the unit an online order takes (D81: the
         -- oldest available, non-customer-owned, non-archived unit at the
         -- online location), so the page, its price and the unit sold agree.
         (case
            when uav.availability = 'available' and ps.publish_online and ps.sync_status = 'synced'
                 and ps.shopify_origin = 'bicii' and ps.shopify_handle is not null
                 and ss.storefront_url is not null
                 and u.id = ou.id
              then ss.storefront_url || '/products/' || ps.shopify_handle
          end)::text
  from visible_products p
  join public.inventory_units u on u.product_id = p.id
  left join public.categories c on c.id = p.category_id
  cross join lateral (
    select (case u.status when 'available' then 'available' when 'sold' then 'sold' else 'unavailable' end)::text
      as availability
  ) uav
  left join public.shopify_product_sync ps on ps.product_id = p.id
  left join public.shopify_settings ss on ss.id = 1
  -- The unit an online order takes (D81; as private.shopify_online_price).
  left join lateral (
    select o.id
    from public.inventory_units o
    where p.tracking_type = 'unique'
      and o.product_id = p.id
      and o.location_id = ss.online_location_id
      and o.status = 'available'
      and o.ownership_type <> 'customer_owned'
      and o.archived_at is null
    order by o.created_at, o.id
    limit 1
  ) ou on true
  where u.archived_at is null
    and u.status not in ('written_off', 'returned_to_consignor');

comment on view reporting.public_items is
  'The only anonymous inventory surface (Phase 11 /q/{short_id}, D9): published (public or sold) products and their units, public columns and public photos only; sale_price is private.selling_price. buy_online_url (D84, Phase 10; the single Buy-online rule Phase 11 reads) = shopify_settings.storefront_url || ''/products/'' || the BICII-created Shopify handle, only when the row''s own availability is available, the product is published online, synced, BICII-created (an external-origin product has no handle) and the storefront is set; and the row is what Shopify sells: a unit row only for the unit an online order takes (the oldest available, non-customer-owned, non-archived unit at the online location, D81), a product row only when its sale_price is not distinct from private.shopify_online_price; otherwise NULL. Never a Shopify id, sync state, cost or payload. Unknown and unpublished short IDs are absent.';

revoke all on table reporting.public_items from public, anon, authenticated, service_role;
grant select on table reporting.public_items to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function
  private.shopify_online_price(uuid),
  private.shopify_effective_online(public.products, boolean),
  private.enqueue_product_sync(uuid),
  private.shopify_enqueue_product_change(),
  private.shopify_settings_enqueue_all()
from public, anon, authenticated, service_role;

revoke all on function
  public.product_sync_state(uuid),
  public.record_product_sync_result(
    uuid, uuid, text, text, text, text, text, integer, public.money_amount, text, text, text, text, boolean
  ),
  public.set_publish_online(uuid, boolean),
  public.request_product_sync(uuid),
  public.set_shopify_settings(uuid, text, boolean, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.product_sync_state(uuid),
  public.record_product_sync_result(
    uuid, uuid, text, text, text, text, text, integer, public.money_amount, text, text, text, text, boolean
  )
to service_role;

grant execute on function
  public.set_publish_online(uuid, boolean),
  public.request_product_sync(uuid),
  public.set_shopify_settings(uuid, text, boolean, text)
to authenticated;

revoke all on table reporting.shopify_sync_status from public, anon, authenticated, service_role;
grant select on table reporting.shopify_sync_status to authenticated;
