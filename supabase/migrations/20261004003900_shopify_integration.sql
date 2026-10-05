-- Shopify integration, inbound storage: the integration schema, webhook
-- recording, the visible retry queue, the integration audit trail and the
-- Shopify columns' rules on earlier tables (SPEC §2 "Idempotent ...
-- mutations", §17, §23 "A duplicate Shopify webhook has one business
-- effect", §25, §26; DATA-MODEL.md §6, §8, §13, §15, §16; PLAN D7, D24
-- (amended), D80 SHOP-PRICE, D83 SHOP-LOCATION, D84 SHOP-PUBLISH, D85
-- SHOP-REFUND, D86 SHOP-ACCESS, D87 SHOP-RETRY, D88 SHOP-REJECTED, D89
-- SHOP-TAX-TEST; ADR-020).
--
-- Rules encoded here, for every writer (RPC, seed, SQL editor):
--   * Every inbound webhook is stored BEFORE any processing
--     (integration_events), by public.record_shopify_webhook only
--     (service_role). A valid delivery is deduplicated on (provider,
--     X-Shopify-Webhook-Id): a repeat only counts the delivery
--     (delivery_count, last_delivered_at) and never creates a second job.
--   * D88: a rejected delivery (bad or missing HMAC, secret or shop not
--     configured, wrong shop, missing headers, non-JSON) is evidence, not
--     input: its body is never stored (payload NULL, forced), only capped
--     headers (16 keys, 512 characters per value), its size and SHA-256;
--     it never occupies the dedupe key (the unique index is partial on
--     rejection_reason IS NULL), so a later valid delivery with the same
--     webhook id is accepted; one bad body is one row with a delivery
--     count. Rejected rows and the payloads of processed or skipped events
--     are removed only by the owner-only private.purge_integration_events
--     (at least 30 days old, run by hand; there is no purge cron in the
--     MVP); failed and pending events are never purged.
--   * Received webhooks are immutable (integration_events_guard, for every
--     role including the owner): only the processing columns change.
--   * D89: a test delivery (payload test = true, or header X-Shopify-Test:
--     true) is stored and skipped (outcome test_order; no job, sale or
--     movement) unless shopify_settings.accept_test_orders; an orders/paid
--     with source_name 'pos' is skipped (pos_order): in-store sales are
--     recorded in BICII. Topics other than orders/paid and refunds/create
--     are stored and skipped (topic_not_handled).
--   * The retry queue (integration_retry_queue, SPEC §26) holds one open
--     job per event and at most one queued and one running product sync per
--     product (partial unique indexes); claim_integration_jobs hands out
--     due jobs with FOR UPDATE SKIP LOCKED, so two workers never run the
--     same job. D87's backoff is private.integration_backoff.
--   * D84: products.shopify_product_id is no longer unique (several BICII
--     products may link to variants of one Shopify product; a recorded
--     DATA-MODEL §6 deviation); shopify_variant_id stays unique. Shopify
--     IDs are stored as GraphQL gids (gid://shopify/<Kind>/<n>), checked
--     on every column.
--   * D80: one Shopify line becomes one sale line per unit, or up to two
--     for an uneven quantity line (shopify_line_part 1 and 2): the
--     single-column unique on sale_lines.shopify_line_item_id is replaced
--     by sale_lines_shopify_line_part_key.
--   * D86: integration events, the queue and the audit trail (payloads hold
--     customer personal data) are readable by admins only; the Shopify
--     settings and sync rows by any active staff member; nothing by
--     customers or anonymous users. Every write is an RPC.
--
-- GLOBAL LOCK ORDER: the consignment migration's header. Nothing here takes
-- a stock, unit, item or product lock: record_shopify_webhook writes its
-- own event row (the request's idempotency row, lock order 0) and then the
-- event's job; claim_integration_jobs locks queue rows only. The order
-- processing migration (20261004004000) takes 0 (the event row, then the
-- order's advisory lock, then the sale header) -> 3 -> 5 -> 6 -> 7.

create type public.integration_event_status as enum ('pending', 'processed', 'skipped', 'failed', 'rejected');
create type public.integration_rejection_reason as enum (
  'hmac_invalid',
  'webhook_secret_missing',
  'shop_not_configured',
  'shop_domain_mismatch',
  'missing_headers',
  'body_not_json'
);
create type public.integration_job_kind as enum ('shopify_event', 'product_sync');
create type public.integration_job_status as enum ('queued', 'running', 'done', 'needs_attention', 'dismissed');
create type public.shopify_sync_status as enum ('not_synced', 'pending', 'synced', 'error', 'unpublished');
create type public.integration_audit_type as enum (
  'publish_online_changed',
  'sync_requested',
  'variant_linked',
  'customer_linked',
  'job_retried',
  'job_dismissed',
  'settings_changed'
);

comment on type public.integration_event_status is
  'pending (stored, its job queued) | processed | skipped (not a sale: test, POS, unhandled topic, dismissed, order not recorded) | failed (its job queued or needs_attention) | rejected (D88: evidence only).';
comment on type public.integration_rejection_reason is
  'Why a delivery was rejected before processing (D88).';
comment on type public.integration_job_kind is
  'shopify_event (process an inbound event) | product_sync (push one product, Phase 10 step 2).';
comment on type public.integration_job_status is
  'queued | running (claimed) | done | needs_attention (a person must act, D87) | dismissed (closed by an admin with a reason, or superseded).';
comment on type public.shopify_sync_status is
  'A product''s Shopify sync state (D84): not_synced | pending | synced | error | unpublished.';

-- ---------------------------------------------------------------------------
-- Helpers (private; EXECUTE revoked from every API role)
-- ---------------------------------------------------------------------------

-- A Shopify id as a gid: digits -> gid://shopify/<kind>/<digits>; a gid of
-- that kind -> itself; null -> null; anything else shopify_gid_invalid.
create function private.shopify_gid(kind text, value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := pg_catalog.btrim(shopify_gid.value);
begin
  if shopify_gid.kind is null or shopify_gid.kind not in (
    'Product', 'ProductVariant', 'InventoryItem', 'Location', 'Order', 'LineItem', 'Refund', 'Customer'
  ) then
    raise exception 'unknown Shopify id kind %', shopify_gid.kind using errcode = '22023';
  end if;
  if shopify_gid.value is null then
    return null;
  end if;
  if v ~ '^[0-9]{1,20}$' then
    return 'gid://shopify/' || shopify_gid.kind || '/' || v;
  end if;
  if v ~ ('^gid://shopify/' || shopify_gid.kind || '/[0-9]{1,20}$') then
    return v;
  end if;
  raise exception using
    errcode = 'P0001',
    message = 'shopify_gid_invalid',
    detail = pg_catalog.format('That is not a valid Shopify %s ID.', shopify_gid.kind);
end;
$$;

comment on function private.shopify_gid(text, text) is
  'A Shopify id (digits or a gid of the kind) as gid://shopify/<kind>/<digits>; null stays null; anything else shopify_gid_invalid. Kinds: Product, ProductVariant, InventoryItem, Location, Order, LineItem, Refund, Customer.';

-- The same, but NULL for anything malformed: for reading untrusted payloads
-- where a bad id must not raise (record time, unmapped-line reports).
create function private.shopify_gid_or_null(kind text, value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  return private.shopify_gid(shopify_gid_or_null.kind, shopify_gid_or_null.value);
exception
  when sqlstate 'P0001' then
    return null;
end;
$$;

-- D84: the handle of a Shopify product BICII creates (P-000123 ->
-- bicii-p-000123).
create function private.shopify_handle(short_id text)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'bicii-' || pg_catalog.lower(shopify_handle.short_id);
$$;

-- D87: 1 minute doubling, capped at 6 hours (attempts < 1 count as 1).
create function private.integration_backoff(attempts integer)
returns interval
language sql
immutable
set search_path = ''
as $$
  select least(
    interval '1 minute' * pg_catalog.power(2, least(greatest(coalesce(integration_backoff.attempts, 1), 1) - 1, 20)),
    interval '6 hours'
  );
$$;

-- The one "a reason is required" rule: the trimmed reason, or
-- reason_required / reason_too_long.
create function private.require_reason(reason text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  cleaned text := nullif(pg_catalog.btrim(coalesce(require_reason.reason, '')), '');
begin
  if cleaned is null then
    raise exception using
      errcode = 'P0001',
      message = 'reason_required',
      detail = 'Give a reason for this change.';
  end if;
  if pg_catalog.char_length(cleaned) > 500 then
    raise exception using
      errcode = 'P0001',
      message = 'reason_too_long',
      detail = 'Keep the reason under 500 characters.';
  end if;
  return cleaned;
end;
$$;

-- D80: split a line total over a quantity exactly. p = trunc(total / qty,
-- 2); when p x qty = total one row (qty, p); otherwise (qty - 1, p) and
-- (1, total - p x (qty - 1)), in that order (parts 1 and 2). Both prices
-- are >= 0 and the rows sum to total exactly. total must be a cent amount
-- >= 0 and qty >= 1 (22023 otherwise).
create function private.shopify_split_amount(total numeric, qty integer)
returns table (quantity integer, unit_price numeric)
language plpgsql
immutable
set search_path = ''
as $$
declare
  p numeric;
begin
  if shopify_split_amount.total is null or shopify_split_amount.qty is null
     or shopify_split_amount.total < 0 or shopify_split_amount.qty < 1
     or shopify_split_amount.total <> round(shopify_split_amount.total, 2) then
    raise exception 'split needs a cent amount >= 0 and a quantity >= 1' using errcode = '22023';
  end if;
  p := trunc(shopify_split_amount.total / shopify_split_amount.qty, 2);
  if p * shopify_split_amount.qty = shopify_split_amount.total then
    return query select shopify_split_amount.qty, p;
  else
    return query
      select shopify_split_amount.qty - 1, p
      union all
      select 1, shopify_split_amount.total - p * (shopify_split_amount.qty - 1);
  end if;
end;
$$;

-- D85: the money a refund line item attributes to its line, in shop money:
-- subtotal_set.shop_money.amount, else subtotal. For a tax-inclusive store
-- Shopify's subtotal is expected to include tax; this is on the RUNBOOK's
-- verify-before-go-live list (Phase 10 step 3). If a verified payload
-- shows otherwise, this helper (and only it) adds
-- total_tax_set.shop_money.amount.
create function private.shopify_refund_line_amount(refund_line_item jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (shopify_refund_line_amount.refund_line_item #>> '{subtotal_set,shop_money,amount}')::numeric,
    (shopify_refund_line_amount.refund_line_item ->> 'subtotal')::numeric
  );
$$;

-- ---------------------------------------------------------------------------
-- shopify_settings (single row; the seed inserts it, step 2's
-- set_shopify_settings is its only editor)
-- ---------------------------------------------------------------------------
create table public.shopify_settings (
  id smallint primary key default 1,
  -- D83: the one BICII location whose ledger is the online stock.
  online_location_id uuid not null references public.locations (id) on delete restrict,
  -- The mapped Shopify location; filled by the first sync.
  shopify_location_id text null,
  -- The storefront's address. Phase 11 reads it only through
  -- reporting.public_items.buy_online_url (D84, step 2).
  storefront_url text null,
  -- D89: false by default; true only in the dev/E2E seed.
  accept_test_orders boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.staff (id) on delete restrict,
  constraint shopify_settings_single_row check (id = 1),
  constraint shopify_settings_shopify_location_id_format check (
    shopify_location_id ~ '^gid://shopify/Location/[0-9]{1,20}$'
  ),
  constraint shopify_settings_storefront_url_check check (
    storefront_url ~ '^https://[^[:space:]]+$' and pg_catalog.char_length(storefront_url) <= 200
  )
);
create index shopify_settings_online_location_id_idx on public.shopify_settings (online_location_id);
create index shopify_settings_updated_by_idx on public.shopify_settings (updated_by);

comment on table public.shopify_settings is
  'Single row (id = 1): the online location (D83), the mapped Shopify location, the storefront address (D84) and whether test orders are recorded (D89). Seeded, never created by a migration; RPCs that need it raise shopify_settings_missing.';
comment on column public.shopify_settings.accept_test_orders is
  'D89: record Shopify test deliveries as sales. Default false; changed only by an admin with a reason and an audit row (step 2); true in the dev/E2E seed only.';

create trigger shopify_settings_set_updated_at
  before update on public.shopify_settings
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- shopify_product_sync (one row per product BICII publishes or links)
-- ---------------------------------------------------------------------------
create table public.shopify_product_sync (
  product_id uuid primary key references public.products (id) on delete restrict,
  publish_online boolean not null default false,
  sync_status public.shopify_sync_status not null default 'not_synced',
  -- D84: 'bicii' = a Shopify product BICII created (pushed in full);
  -- 'external' = a product made in Shopify that a variant is linked to
  -- (price and inventory only). Null until either happens.
  shopify_origin text null,
  shopify_inventory_item_id text null,
  -- D84: bicii-<short id>; only for BICII-created products.
  shopify_handle text null,
  last_pushed_at timestamptz null,
  last_checked_at timestamptz null,
  last_pushed_quantity integer null,
  last_pushed_price public.money_amount null,
  -- sha-256 (hex) of the last pushed payload, including the API version.
  desired_hash text null,
  api_version text null,
  last_error_code text null,
  last_error text null,
  publish_changed_by uuid null references public.staff (id) on delete restrict,
  publish_changed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shopify_product_sync_origin_check check (shopify_origin in ('bicii', 'external')),
  constraint shopify_product_sync_shopify_inventory_item_id_key unique (shopify_inventory_item_id),
  constraint shopify_product_sync_inventory_item_format check (
    shopify_inventory_item_id ~ '^gid://shopify/InventoryItem/[0-9]{1,20}$'
  ),
  constraint shopify_product_sync_handle_check check (
    shopify_handle ~ '^[a-z0-9][a-z0-9-]{0,99}$'
  ),
  constraint shopify_product_sync_external_no_handle check (
    shopify_origin is distinct from 'external' or shopify_handle is null
  ),
  constraint shopify_product_sync_last_pushed_quantity_check check (last_pushed_quantity >= 0),
  constraint shopify_product_sync_last_pushed_price_check check (last_pushed_price >= 0),
  constraint shopify_product_sync_desired_hash_check check (desired_hash ~ '^[0-9a-f]{64}$'),
  constraint shopify_product_sync_api_version_check check (pg_catalog.char_length(api_version) <= 20),
  constraint shopify_product_sync_last_error_code_check check (pg_catalog.char_length(last_error_code) <= 100),
  constraint shopify_product_sync_last_error_check check (pg_catalog.char_length(last_error) <= 1000),
  constraint shopify_product_sync_publish_changed_shape check (publish_changed_by is null or publish_changed_at is not null)
);
create index shopify_product_sync_publish_changed_by_idx on public.shopify_product_sync (publish_changed_by);
create index shopify_product_sync_status_idx on public.shopify_product_sync (sync_status);

comment on table public.shopify_product_sync is
  'Per product: Publish online, the sync state and what was last pushed (D81, D83, D84). The Shopify product and variant ids live ONLY on products.shopify_product_id / shopify_variant_id. Every write is an RPC (step 2) or the seed.';
comment on column public.shopify_product_sync.desired_hash is
  'sha-256 of the last pushed payload; the pinned Admin API version is part of it, so a version upgrade re-pushes every product once (D84). NULL = push on the next sync.';

create trigger shopify_product_sync_set_updated_at
  before update on public.shopify_product_sync
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- integration_events (every inbound webhook, stored before processing)
-- ---------------------------------------------------------------------------
create table public.integration_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'shopify',
  topic text not null,
  -- X-Shopify-Webhook-Id; 'missing:' || body_sha256 for a rejected delivery
  -- without one.
  external_event_id text not null,
  -- X-Shopify-Event-Id (shared by retries of one Shopify event).
  shopify_event_id text null,
  shop_domain text null,
  api_version text null,
  -- X-Shopify-Triggered-At (D80's second recognition fallback).
  triggered_at timestamptz null,
  -- '#1042' for an order; 'Refund <id> of order <order id>' for a refund.
  subject text null,
  -- orders/paid: the gid of the payload's id; refunds/create: of its
  -- order_id. Null when absent or malformed (never raises at record time).
  shopify_order_gid text null,
  -- D89: payload test = true, or header X-Shopify-Test: true.
  test_delivery boolean not null default false,
  -- NULL for a rejected delivery (D88) and after a purge.
  payload jsonb null,
  payload_purged_at timestamptz null,
  -- Capped (D88): at most 16 lower-cased keys, values <= 512 characters.
  headers jsonb not null default '{}',
  body_sha256 text not null,
  body_bytes integer not null,
  hmac_valid boolean not null,
  rejection_reason public.integration_rejection_reason null,
  received_at timestamptz not null default now(),
  delivery_count integer not null default 1,
  last_delivered_at timestamptz not null default now(),
  status public.integration_event_status not null default 'pending',
  -- Processing attempts (kept on failure).
  attempts integer not null default 0,
  processed_at timestamptz null,
  outcome text null,
  -- What processing decided: the sale and its lines, a refund's amounts,
  -- unmapped lines (admin only).
  result jsonb not null default '{}',
  last_error_code text null,
  -- The human message staff read.
  last_error text null,
  -- SQLSTATE and message of an unexpected error (admin only).
  last_error_detail text null,
  sale_id uuid null references public.sales (id) on delete restrict,
  correlation_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_events_provider_check check (provider = 'shopify'),
  constraint integration_events_topic_check check (
    pg_catalog.btrim(topic) <> '' and pg_catalog.char_length(topic) <= 100
  ),
  constraint integration_events_external_event_id_check check (
    pg_catalog.btrim(external_event_id) <> '' and pg_catalog.char_length(external_event_id) <= 200
  ),
  constraint integration_events_shopify_event_id_check check (pg_catalog.char_length(shopify_event_id) <= 200),
  constraint integration_events_shop_domain_check check (pg_catalog.char_length(shop_domain) <= 255),
  constraint integration_events_api_version_check check (pg_catalog.char_length(api_version) <= 20),
  constraint integration_events_subject_check check (pg_catalog.char_length(subject) <= 200),
  constraint integration_events_shopify_order_gid_check check (shopify_order_gid ~ '^gid://shopify/Order/[0-9]{1,20}$'),
  constraint integration_events_payload_object check (payload is null or pg_catalog.jsonb_typeof(payload) = 'object'),
  constraint integration_events_headers_object check (pg_catalog.jsonb_typeof(headers) = 'object'),
  constraint integration_events_result_object check (pg_catalog.jsonb_typeof(result) = 'object'),
  constraint integration_events_body_sha256_check check (body_sha256 ~ '^[0-9a-f]{64}$'),
  constraint integration_events_body_bytes_check check (body_bytes >= 0),
  constraint integration_events_delivery_count_check check (delivery_count >= 1),
  constraint integration_events_attempts_check check (attempts >= 0),
  constraint integration_events_outcome_check check (
    outcome in (
      'sale_recorded', 'duplicate_order', 'refund_recorded', 'duplicate_refund', 'no_money_refunded',
      'refund_not_allocated', 'topic_not_handled', 'test_order', 'pos_order', 'order_not_recorded', 'dismissed'
    )
  ),
  constraint integration_events_last_error_code_check check (pg_catalog.char_length(last_error_code) <= 100),
  constraint integration_events_last_error_check check (pg_catalog.char_length(last_error) <= 2000),
  constraint integration_events_last_error_detail_check check (pg_catalog.char_length(last_error_detail) <= 2000),
  constraint integration_events_correlation_id_check check (pg_catalog.char_length(correlation_id) <= 128),
  -- D88: a rejected row has a reason and no body; anything else was verified.
  constraint integration_events_rejected_shape check (
    (status = 'rejected') = (rejection_reason is not null)
    and (rejection_reason is null or payload is null)
    and (rejection_reason is not null or hmac_valid)
  ),
  constraint integration_events_payload_present check (
    payload is not null or rejection_reason is not null or payload_purged_at is not null
  ),
  constraint integration_events_processed_shape check (
    status not in ('processed', 'skipped') or processed_at is not null
  )
);
-- D88: an unauthenticated delivery never squats the dedupe key.
create unique index integration_events_external_id_key
  on public.integration_events (provider, external_event_id) where rejection_reason is null;
-- D88: one bad body is one row (with a delivery count).
create unique index integration_events_rejected_body_key
  on public.integration_events (rejection_reason, body_sha256) where rejection_reason is not null;
create index integration_events_status_received_idx on public.integration_events (status, received_at desc);
create index integration_events_topic_received_idx on public.integration_events (topic, received_at desc);
create index integration_events_subject_idx on public.integration_events (pg_catalog.lower(subject));
create index integration_events_sale_id_idx on public.integration_events (sale_id);
create index integration_events_shopify_event_id_idx on public.integration_events (shopify_event_id);
create index integration_events_order_topic_idx on public.integration_events (shopify_order_gid, topic);

comment on table public.integration_events is
  'Every inbound Shopify webhook, stored before processing (SPEC §17, §23). Valid deliveries are deduplicated on (provider, external_event_id); rejected ones are evidence only (D88). Immutable except the processing columns; admins only (D86: payloads hold customer personal data). Written by record_shopify_webhook and the processors.';
comment on column public.integration_events.payload is
  'The webhook body as received (D86: customer personal data, admins only). NULL for a rejected delivery and after private.purge_integration_events.';

create trigger integration_events_set_updated_at
  before update on public.integration_events
  for each row execute function private.set_updated_at();

-- Received webhooks are evidence (D88): only the processing columns change,
-- for every role including the owner. Under the purge setting (set only by
-- private.purge_integration_events) a rejected row may be deleted and a
-- payload cleared.
create function private.integration_events_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  purging boolean := coalesce(pg_catalog.current_setting('bicii.integration_purge', true), '') = 'on';
  mutable text[] := array[
    'status', 'attempts', 'processed_at', 'outcome', 'result', 'last_error_code', 'last_error', 'last_error_detail',
    'sale_id', 'delivery_count', 'last_delivered_at', 'updated_at'
  ];
begin
  if tg_op = 'DELETE' then
    if purging and old.status = 'rejected' then
      return old;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'integration_event_immutable',
      detail = 'A received webhook is kept as evidence; it cannot be deleted.';
  end if;
  if purging and new.payload is null then
    mutable := mutable || array['payload', 'payload_purged_at'];
  end if;
  if (pg_catalog.to_jsonb(new) - mutable) <> (pg_catalog.to_jsonb(old) - mutable) then
    raise exception using
      errcode = 'P0001',
      message = 'integration_event_immutable',
      detail = 'A received webhook cannot be changed; only its processing state moves.';
  end if;
  return new;
end;
$$;

create trigger integration_events_guard
  before update or delete on public.integration_events
  for each row execute function private.integration_events_guard();

-- ---------------------------------------------------------------------------
-- integration_retry_queue (the visible retry and error queue, SPEC §26)
-- ---------------------------------------------------------------------------
create table public.integration_retry_queue (
  id uuid primary key default gen_random_uuid(),
  kind public.integration_job_kind not null,
  integration_event_id uuid null references public.integration_events (id) on delete restrict,
  product_id uuid null references public.products (id) on delete restrict,
  status public.integration_job_status not null default 'queued',
  -- Claims so far (claim_integration_jobs adds one per claim).
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  next_attempt_at timestamptz not null default now(),
  -- When a worker claimed it; a running job locked more than 10 minutes ago
  -- is stale and may be reclaimed.
  locked_at timestamptz null,
  last_error_code text null,
  -- The human message (the event's, for a shopify_event job).
  last_error text null,
  last_retried_by uuid null references public.staff (id) on delete restrict,
  last_retried_at timestamptz null,
  resolved_at timestamptz null,
  resolved_by uuid null references public.staff (id) on delete restrict,
  resolution_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_retry_queue_kind_shape check (
    (kind = 'shopify_event' and integration_event_id is not null and product_id is null)
    or (kind = 'product_sync' and product_id is not null and integration_event_id is null)
  ),
  constraint integration_retry_queue_resolved_shape check (
    status not in ('done', 'dismissed') or resolved_at is not null
  ),
  constraint integration_retry_queue_dismiss_reason check (
    status <> 'dismissed' or resolved_by is null or resolution_reason is not null
  ),
  constraint integration_retry_queue_attempts_check check (attempts >= 0),
  constraint integration_retry_queue_max_attempts_check check (max_attempts between 1 and 50),
  constraint integration_retry_queue_last_error_code_check check (pg_catalog.char_length(last_error_code) <= 100),
  constraint integration_retry_queue_last_error_check check (pg_catalog.char_length(last_error) <= 2000),
  constraint integration_retry_queue_resolution_reason_check check (
    pg_catalog.btrim(resolution_reason) <> '' and pg_catalog.char_length(resolution_reason) <= 500
  )
);
-- One open job per event.
create unique index integration_retry_queue_event_open_key
  on public.integration_retry_queue (integration_event_id)
  where status in ('queued', 'running', 'needs_attention');
-- At most one queued and one running product sync per product.
create unique index integration_retry_queue_product_queued_key
  on public.integration_retry_queue (product_id)
  where kind = 'product_sync' and status = 'queued';
create unique index integration_retry_queue_product_running_key
  on public.integration_retry_queue (product_id)
  where kind = 'product_sync' and status = 'running';
create index integration_retry_queue_status_next_idx on public.integration_retry_queue (status, next_attempt_at);
create index integration_retry_queue_event_idx on public.integration_retry_queue (integration_event_id);
create index integration_retry_queue_product_idx on public.integration_retry_queue (product_id);
create index integration_retry_queue_last_retried_by_idx on public.integration_retry_queue (last_retried_by);
create index integration_retry_queue_resolved_by_idx on public.integration_retry_queue (resolved_by);

comment on table public.integration_retry_queue is
  'The visible retry and error queue (SPEC §26): one job per inbound event or product sync. Transient failures back off (D87, private.integration_backoff); business failures go to needs_attention with the human message; admins retry or dismiss with a reason (D86). Every write is an RPC.';

create trigger integration_retry_queue_set_updated_at
  before update on public.integration_retry_queue
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- integration_audit_events (append-only)
-- ---------------------------------------------------------------------------
create table public.integration_audit_events (
  id uuid primary key default gen_random_uuid(),
  event_type public.integration_audit_type not null,
  product_id uuid null references public.products (id) on delete restrict,
  customer_id uuid null references public.customers (id) on delete restrict,
  job_id uuid null references public.integration_retry_queue (id) on delete restrict,
  integration_event_id uuid null references public.integration_events (id) on delete restrict,
  actor_staff_id uuid null references public.staff (id) on delete restrict,
  reason text null,
  -- {from, to} and similar; never a cost.
  payload jsonb not null default '{}',
  correlation_id text null,
  created_at timestamptz not null default clock_timestamp(),
  constraint integration_audit_events_reason_check check (
    pg_catalog.btrim(reason) <> '' and pg_catalog.char_length(reason) <= 500
  ),
  constraint integration_audit_events_payload_object check (pg_catalog.jsonb_typeof(payload) = 'object'),
  constraint integration_audit_events_correlation_id_check check (pg_catalog.char_length(correlation_id) <= 128)
);
create index integration_audit_events_product_idx on public.integration_audit_events (product_id, created_at);
create index integration_audit_events_customer_idx on public.integration_audit_events (customer_id);
create index integration_audit_events_job_idx on public.integration_audit_events (job_id);
create index integration_audit_events_event_idx on public.integration_audit_events (integration_event_id);
create index integration_audit_events_actor_idx on public.integration_audit_events (actor_staff_id);

comment on table public.integration_audit_events is
  'Who changed what in the integration and why (publishing, sync requests, links, retries, dismissals, settings), with actor, reason and correlation id. Append-only; admins only (D86); written by the RPCs in the same transaction.';

create function private.integration_audit_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'integration_history_append_only',
    detail = 'Integration history cannot be changed or deleted.';
end;
$$;

create trigger integration_audit_events_append_only
  before update or delete on public.integration_audit_events
  for each row execute function private.integration_audit_events_append_only();

-- ---------------------------------------------------------------------------
-- Changes to earlier tables
-- ---------------------------------------------------------------------------
-- products (D84): gids; shopify_product_id no longer unique (several BICII
-- products may link variants of one Shopify product); the variant stays
-- unique. Still no UPDATE grant: links change only through RPCs.
alter table public.products
  add constraint products_shopify_product_id_format check (
    shopify_product_id ~ '^gid://shopify/Product/[0-9]{1,20}$'
  ),
  add constraint products_shopify_variant_id_format check (
    shopify_variant_id ~ '^gid://shopify/ProductVariant/[0-9]{1,20}$'
  ),
  drop constraint products_shopify_product_id_key;
create index products_shopify_product_id_idx on public.products (shopify_product_id);

-- customers (SPEC §17.2): the durable link is a Customer gid.
alter table public.customers
  add constraint customers_shopify_customer_id_format check (
    shopify_customer_id ~ '^gid://shopify/Customer/[0-9]{1,20}$'
  );

-- sales: the order's Shopify customer and the event that recorded it, both
-- written at insert only (sales_enforce_rules freezes every column but
-- status). An online sale always names its order; an in-store sale never
-- carries Shopify references.
alter table public.sales
  add column shopify_customer_id text null,
  add column integration_event_id uuid null references public.integration_events (id) on delete restrict,
  add constraint sales_shopify_order_id_format check (shopify_order_id ~ '^gid://shopify/Order/[0-9]{1,20}$'),
  add constraint sales_shopify_customer_id_format check (
    shopify_customer_id ~ '^gid://shopify/Customer/[0-9]{1,20}$'
  ),
  add constraint sales_shopify_shape check (
    (source = 'online_shopify' and shopify_order_id is not null)
    or (source <> 'online_shopify' and shopify_order_id is null and shopify_customer_id is null
        and integration_event_id is null)
  );
create index sales_shopify_customer_id_idx on public.sales (shopify_customer_id);
create index sales_integration_event_id_idx on public.sales (integration_event_id);

comment on column public.sales.shopify_customer_id is
  'The order''s Shopify customer (gid), written at insert. customer_id is set only when a BICII customer was already linked to it (D86); earlier online sales stay linked only through this column.';

-- sale_lines (D80): one sale line per unit, or two parts of an uneven
-- quantity line; the part needs a line id.
alter table public.sale_lines
  add column shopify_line_part smallint null,
  add constraint sale_lines_shopify_line_item_id_format check (
    shopify_line_item_id ~ '^gid://shopify/LineItem/[0-9]{1,20}$'
  ),
  add constraint sale_lines_shopify_line_part_check check (
    shopify_line_part is null or (shopify_line_part in (1, 2) and shopify_line_item_id is not null)
  ),
  drop constraint sale_lines_shopify_line_item_id_key;
create unique index sale_lines_shopify_line_part_key
  on public.sale_lines (shopify_line_item_id, inventory_unit_id, shopify_line_part) nulls not distinct
  where shopify_line_item_id is not null;

comment on column public.sale_lines.shopify_line_part is
  'D80: 1 and 2 when an uneven Shopify quantity line is split (qty - 1 at the truncated price, 1 absorbing the remainder); null otherwise. Written only at insert, by private.sell_line.';

-- sale_refunds (D85): the event that recorded a Shopify refund.
alter table public.sale_refunds
  add column integration_event_id uuid null references public.integration_events (id) on delete restrict,
  add constraint sale_refunds_shopify_refund_id_format check (
    shopify_refund_id ~ '^gid://shopify/Refund/[0-9]{1,20}$'
  );
create index sale_refunds_integration_event_id_idx on public.sale_refunds (integration_event_id);

comment on column public.sale_refunds.restocked is
  'Always false: a refund never moves stock (D7). Phase 6 writes false; Phase 10 writes false too and keeps Shopify''s restock claims in the event''s result (D85). Staff restock with restock_unit.';

-- ---------------------------------------------------------------------------
-- record_shopify_webhook (service_role): store one delivery, before any
-- processing. Returns the event, whether it already existed, its status
-- and the job this call created (null for a duplicate, a skip or a
-- rejection).
-- ---------------------------------------------------------------------------
create function public.record_shopify_webhook(
  topic text,
  webhook_id text,
  shopify_event_id text,
  shop_domain text,
  api_version text,
  triggered_at timestamptz,
  headers jsonb,
  payload jsonb,
  body_sha256 text,
  body_bytes integer,
  hmac_valid boolean,
  rejection_reason public.integration_rejection_reason,
  correlation_id text
)
returns table (event_id uuid, duplicate boolean, event_status public.integration_event_status, job_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
-- Arguments are always written qualified (record_shopify_webhook.x); a bare
-- name in the ON CONFLICT clauses is the column.
#variable_conflict use_column
declare
  raw_headers jsonb := coalesce(record_shopify_webhook.headers, '{}'::jsonb);
  capped jsonb;
  truncated boolean := false;
  is_rejected boolean;
  reason public.integration_rejection_reason;
  clean_topic text := nullif(pg_catalog.btrim(record_shopify_webhook.topic), '');
  external_id text := nullif(pg_catalog.btrim(record_shopify_webhook.webhook_id), '');
  derived_subject text;
  order_gid text;
  is_test boolean := false;
  accept_tests boolean;
  new_status public.integration_event_status := 'pending';
  new_outcome text;
  ev_id uuid;
  ev_status public.integration_event_status;
  inserted boolean;
  new_job uuid;
begin
  -- Shape (22004 / 22023).
  if record_shopify_webhook.body_sha256 is null or record_shopify_webhook.body_bytes is null
     or record_shopify_webhook.hmac_valid is null then
    raise exception 'body_sha256, body_bytes and hmac_valid are required' using errcode = '22004';
  end if;
  if record_shopify_webhook.body_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'body_sha256 must be 64 lower-case hex characters' using errcode = '22023';
  end if;
  if record_shopify_webhook.body_bytes < 0 then
    raise exception 'body_bytes must be >= 0' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(raw_headers) <> 'object' then
    raise exception 'headers must be a JSON object' using errcode = '22023';
  end if;

  -- D88: headers capped before storing: lower-cased keys, sorted, the
  -- first 16 kept, values cut to 512 characters, and a marker when
  -- anything was dropped or cut.
  with h as (
    select pg_catalog.lower(e.key) as k, coalesce(e.value, '') as v,
           row_number() over (partition by pg_catalog.lower(e.key) order by e.key) as dup
    from pg_catalog.jsonb_each_text(raw_headers) e
  ),
  u as (
    select h.k, h.v, row_number() over (order by h.k) as n
    from h
    where h.dup = 1
  )
  select coalesce(pg_catalog.jsonb_object_agg(u.k, pg_catalog.left(u.v, 512)) filter (where u.n <= 16), '{}'::jsonb),
         (select count(*) from h) > count(*) filter (where u.n <= 16)
           or coalesce(bool_or(pg_catalog.char_length(u.v) > 512) filter (where u.n <= 16), false)
  into capped, truncated
  from u;
  if coalesce(truncated, false) then
    capped := capped || '{"x-bicii-truncated": "true"}'::jsonb;
  end if;

  is_rejected := record_shopify_webhook.rejection_reason is not null or not record_shopify_webhook.hmac_valid;

  if is_rejected then
    -- Evidence only: never the body, never a job, never the dedupe key.
    reason := coalesce(record_shopify_webhook.rejection_reason, 'hmac_invalid');
    insert into public.integration_events as e (
      topic, external_event_id, shopify_event_id, shop_domain, api_version, triggered_at, payload, headers,
      body_sha256, body_bytes, hmac_valid, rejection_reason, status, correlation_id
    )
    values (
      pg_catalog.left(coalesce(clean_topic, 'unknown'), 100),
      pg_catalog.left(coalesce(external_id, 'missing:' || record_shopify_webhook.body_sha256), 200),
      pg_catalog.left(record_shopify_webhook.shopify_event_id, 200),
      pg_catalog.left(record_shopify_webhook.shop_domain, 255),
      pg_catalog.left(record_shopify_webhook.api_version, 20),
      record_shopify_webhook.triggered_at, null, capped, record_shopify_webhook.body_sha256,
      record_shopify_webhook.body_bytes, record_shopify_webhook.hmac_valid, reason, 'rejected',
      pg_catalog.left(record_shopify_webhook.correlation_id, 128)
    )
    on conflict (rejection_reason, body_sha256) where rejection_reason is not null
    do update set delivery_count = e.delivery_count + 1, last_delivered_at = pg_catalog.now()
    returning e.id, (e.xmax = 0) into ev_id, inserted;
    return query select ev_id, not inserted, 'rejected'::public.integration_event_status, null::uuid;
    return;
  end if;

  -- A verified delivery.
  if clean_topic is null or external_id is null then
    raise exception 'topic and webhook_id are required for a verified delivery' using errcode = '22004';
  end if;
  if pg_catalog.char_length(clean_topic) > 100 or pg_catalog.char_length(external_id) > 200
     or pg_catalog.char_length(record_shopify_webhook.shopify_event_id) > 200
     or pg_catalog.char_length(record_shopify_webhook.shop_domain) > 255
     or pg_catalog.char_length(record_shopify_webhook.api_version) > 20
     or pg_catalog.char_length(record_shopify_webhook.correlation_id) > 128 then
    raise exception 'a header value is too long' using errcode = '22023';
  end if;
  if record_shopify_webhook.payload is null or pg_catalog.jsonb_typeof(record_shopify_webhook.payload) <> 'object' then
    raise exception 'payload must be a JSON object' using errcode = '22023';
  end if;

  -- Derived for a new event (a duplicate keeps the stored values).
  if clean_topic = 'orders/paid' then
    derived_subject := coalesce(
      nullif(pg_catalog.btrim(record_shopify_webhook.payload ->> 'name'), ''),
      '#' || nullif(pg_catalog.btrim(record_shopify_webhook.payload ->> 'order_number'), ''),
      'Order ' || (record_shopify_webhook.payload ->> 'id')
    );
    order_gid := private.shopify_gid_or_null('Order', record_shopify_webhook.payload ->> 'id');
  elsif clean_topic = 'refunds/create' then
    derived_subject := 'Refund ' || coalesce(record_shopify_webhook.payload ->> 'id', '?') || ' of order '
      || coalesce(record_shopify_webhook.payload ->> 'order_id', '?');
    order_gid := private.shopify_gid_or_null('Order', record_shopify_webhook.payload ->> 'order_id');
  end if;
  derived_subject := pg_catalog.left(derived_subject, 200);
  is_test := coalesce(record_shopify_webhook.payload -> 'test' = 'true'::jsonb, false)
    or coalesce(record_shopify_webhook.payload ->> 'test', '') = 'true'
    or exists (
      select 1 from pg_catalog.jsonb_each_text(raw_headers) e
      where pg_catalog.lower(e.key) = 'x-shopify-test' and pg_catalog.lower(pg_catalog.btrim(e.value)) = 'true'
    );
  select s.accept_test_orders into accept_tests from public.shopify_settings s where s.id = 1;

  -- Skips, in order (no job; processed_at now).
  if clean_topic not in ('orders/paid', 'refunds/create') then
    new_status := 'skipped';
    new_outcome := 'topic_not_handled';
  elsif is_test and not coalesce(accept_tests, false) then
    new_status := 'skipped';
    new_outcome := 'test_order';
  elsif clean_topic = 'orders/paid' and record_shopify_webhook.payload ->> 'source_name' = 'pos' then
    new_status := 'skipped';
    new_outcome := 'pos_order';
  end if;

  insert into public.integration_events as e (
    topic, external_event_id, shopify_event_id, shop_domain, api_version, triggered_at, subject, shopify_order_gid,
    test_delivery, payload, headers, body_sha256, body_bytes, hmac_valid, status, outcome, processed_at,
    correlation_id
  )
  values (
    clean_topic, external_id, record_shopify_webhook.shopify_event_id, record_shopify_webhook.shop_domain,
    record_shopify_webhook.api_version, record_shopify_webhook.triggered_at, derived_subject, order_gid, is_test,
    record_shopify_webhook.payload, capped, record_shopify_webhook.body_sha256, record_shopify_webhook.body_bytes,
    true, new_status, new_outcome, case when new_status = 'skipped' then pg_catalog.now() end,
    record_shopify_webhook.correlation_id
  )
  on conflict (provider, external_event_id) where rejection_reason is null
  do update set delivery_count = e.delivery_count + 1, last_delivered_at = pg_catalog.now()
  returning e.id, e.status, (e.xmax = 0) into ev_id, ev_status, inserted;

  if inserted and ev_status = 'pending' then
    insert into public.integration_retry_queue as q (kind, integration_event_id)
    values ('shopify_event', ev_id)
    returning q.id into new_job;
  end if;
  return query select ev_id, not inserted, ev_status, new_job;
end;
$$;

comment on function public.record_shopify_webhook(
  text, text, text, text, text, timestamptz, jsonb, jsonb, text, integer, boolean,
  public.integration_rejection_reason, text
) is
  'service_role (the webhook route, Phase 10 step 3): store one delivery before any processing. Rejected deliveries (D88) are evidence (no body, no job, never the dedupe key; one row per bad body with a delivery count). A verified delivery is deduplicated on its webhook id (a repeat only counts the delivery); a new one is skipped (unhandled topic, test order unless accepted, POS order; D89) or gets a queued shopify_event job.';

-- ---------------------------------------------------------------------------
-- claim_integration_jobs (service_role): hand out due jobs. Two concurrent
-- claimers never get the same job (FOR UPDATE SKIP LOCKED), and a claim
-- never puts two running product syncs on one product.
-- ---------------------------------------------------------------------------
create function public.claim_integration_jobs(max_jobs integer, only_job_id uuid default null)
returns setof public.integration_retry_queue
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n integer := greatest(1, least(coalesce(claim_integration_jobs.max_jobs, 1), 50));
begin
  -- 1. A stalled product sync is superseded by a queued one of its product.
  update public.integration_retry_queue r
  set status = 'dismissed', resolved_at = pg_catalog.now(), resolved_by = null,
      resolution_reason = 'Superseded after a stalled run'
  where r.kind = 'product_sync' and r.status = 'running'
    and r.locked_at < pg_catalog.now() - interval '10 minutes'
    and exists (
      select 1 from public.integration_retry_queue q
      where q.kind = 'product_sync' and q.status = 'queued' and q.product_id = r.product_id
    );

  -- 2-4. Lock candidates (SKIP LOCKED cannot share a SELECT with a window
  -- function, so a second CTE keeps one per product), then claim.
  return query
    with candidates as (
      select r.id, r.kind, r.product_id, r.next_attempt_at, r.created_at
      from public.integration_retry_queue r
      where (
          (r.status = 'queued'
           and (r.next_attempt_at <= pg_catalog.now() or r.id = claim_integration_jobs.only_job_id))
          or (r.status = 'running' and r.locked_at < pg_catalog.now() - interval '10 minutes')
        )
        and (claim_integration_jobs.only_job_id is null or r.id = claim_integration_jobs.only_job_id)
        and not (
          r.kind = 'product_sync'
          and exists (
            select 1 from public.integration_retry_queue o
            where o.kind = 'product_sync' and o.status = 'running' and o.product_id = r.product_id
              and o.id <> r.id and o.locked_at >= pg_catalog.now() - interval '10 minutes'
          )
        )
      order by r.next_attempt_at, r.created_at
      limit 4 * n
      for update of r skip locked
    ),
    picked as (
      select c.id
      from (
        select c.id, c.kind, c.next_attempt_at, c.created_at,
               row_number() over (
                 partition by case when c.kind = 'product_sync' then c.product_id end,
                              case when c.kind = 'product_sync' then null else c.id end
                 order by c.next_attempt_at, c.created_at
               ) as rn
        from candidates c
      ) c
      where c.rn = 1
      order by c.next_attempt_at, c.created_at
      limit n
    )
    update public.integration_retry_queue r
    set status = 'running', locked_at = pg_catalog.now(), attempts = r.attempts + 1
    from picked p
    where r.id = p.id
    returning r.*;
end;
$$;

comment on function public.claim_integration_jobs(integer, uuid) is
  'service_role (the cron and the webhook route, step 3): claim up to max_jobs (1..50) due jobs (queued and due, or the one named by only_job_id even before it is due, or running and stale for 10 minutes), oldest due first, at most one product sync per product; each becomes running with attempts + 1. A stalled product sync with a queued successor is dismissed first.';

-- ---------------------------------------------------------------------------
-- private.purge_integration_events (D88): OWNER ONLY, run by hand (no API
-- role can execute it; there is no purge cron in the MVP).
-- ---------------------------------------------------------------------------
create function private.purge_integration_events(older_than interval)
returns table (rejected_deleted integer, payloads_purged integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  deleted integer;
  purged integer;
begin
  if purge_integration_events.older_than is null or purge_integration_events.older_than < interval '30 days' then
    raise exception 'integration events are kept at least 30 days' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('bicii.integration_purge', 'on', true);
  delete from public.integration_events e
  where e.status = 'rejected' and e.last_delivered_at < pg_catalog.now() - purge_integration_events.older_than;
  get diagnostics deleted = row_count;
  update public.integration_events e
  set payload = null, payload_purged_at = pg_catalog.now()
  where e.status in ('processed', 'skipped')
    and e.payload is not null
    and e.processed_at < pg_catalog.now() - purge_integration_events.older_than
    and not exists (
      select 1 from public.integration_retry_queue q
      where q.integration_event_id = e.id and q.status in ('queued', 'running', 'needs_attention')
    );
  get diagnostics purged = row_count;
  perform pg_catalog.set_config('bicii.integration_purge', 'off', true);
  return query select deleted, purged;
end;
$$;

comment on function private.purge_integration_events(interval) is
  'D88, owner only, by hand: delete rejected deliveries last delivered more than older_than ago (>= 30 days) and clear the payload of processed or skipped events processed before then (payload_purged_at). Never touches failed or pending events or events with an open job. No API role may execute it; no cron.';

-- ---------------------------------------------------------------------------
-- Privileges and RLS (DATA-MODEL §15; D86)
-- ---------------------------------------------------------------------------
revoke all on function
  private.shopify_gid(text, text),
  private.shopify_gid_or_null(text, text),
  private.shopify_handle(text),
  private.integration_backoff(integer),
  private.require_reason(text),
  private.shopify_split_amount(numeric, integer),
  private.shopify_refund_line_amount(jsonb),
  private.integration_events_guard(),
  private.integration_audit_events_append_only(),
  private.purge_integration_events(interval)
from public, anon, authenticated, service_role;

revoke all on function
  public.record_shopify_webhook(
    text, text, text, text, text, timestamptz, jsonb, jsonb, text, integer, boolean,
    public.integration_rejection_reason, text
  ),
  public.claim_integration_jobs(integer, uuid)
from public, anon, authenticated, service_role;

grant execute on function
  public.record_shopify_webhook(
    text, text, text, text, text, timestamptz, jsonb, jsonb, text, integer, boolean,
    public.integration_rejection_reason, text
  ),
  public.claim_integration_jobs(integer, uuid)
to service_role;

alter table public.shopify_settings enable row level security;
alter table public.shopify_product_sync enable row level security;
alter table public.integration_events enable row level security;
alter table public.integration_retry_queue enable row level security;
alter table public.integration_audit_events enable row level security;

revoke all on table public.shopify_settings from public, anon, authenticated, service_role;
revoke all on table public.shopify_product_sync from public, anon, authenticated, service_role;
revoke all on table public.integration_events from public, anon, authenticated, service_role;
revoke all on table public.integration_retry_queue from public, anon, authenticated, service_role;
revoke all on table public.integration_audit_events from public, anon, authenticated, service_role;

-- Read-only for the API; every write is an RPC.
grant select on table
  public.shopify_settings,
  public.shopify_product_sync,
  public.integration_events,
  public.integration_retry_queue,
  public.integration_audit_events
to authenticated, service_role;

-- Every active staff member sees the online location and a product's sync
-- status (D86).
create policy shopify_settings_select_staff on public.shopify_settings
  for select to authenticated
  using ((select private.is_staff()));

create policy shopify_product_sync_select_staff on public.shopify_product_sync
  for select to authenticated
  using ((select private.is_staff()));

-- Admins only: payloads, queue messages and the audit trail name customers
-- (D86).
create policy integration_events_select_admin on public.integration_events
  for select to authenticated
  using ((select private.is_admin()));

create policy integration_retry_queue_select_admin on public.integration_retry_queue
  for select to authenticated
  using ((select private.is_admin()));

create policy integration_audit_events_select_admin on public.integration_audit_events
  for select to authenticated
  using ((select private.is_admin()));

-- The new sale columns follow Phase 6's column grants (staff read sale
-- headers and lines; never a cost).
grant select (shopify_customer_id, integration_event_id) on table public.sales to authenticated;
grant select (shopify_line_part) on table public.sale_lines to authenticated;
