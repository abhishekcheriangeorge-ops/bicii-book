-- Job line items and their totals (SPEC §2 "Financial snapshots", §9, §10
-- "Cult Commons rule", §23 "Historical line price/cost/yield snapshots do
-- not change with catalog edits", "Customers cannot read ... costs, yield
-- ... or Cult Commons data"; DATA-MODEL.md §5, §15; PLAN D1, D14, D15, D16).
--
-- Rules encoded here, for every writer:
--   * A line snapshots its economics when it is added: description, unit
--     sale price, unit direct cost and the Cult Commons rate in force
--     (private.cult_commons_rate_at). The arithmetic is in generated
--     columns, so no application code can produce a different number:
--       sale  = round(q * price, 2)        cost = round(q * unit cost, 2)
--       yield = sale - cost
--       cult_commons_share = round(max(yield, 0) * rate, 2)
--     per line (D1): a loss-making line contributes 0 and never offsets
--     another line; a job's Cult Commons is the sum of its lines'.
--   * Lines are evidence: immutable once added, except voiding (voided_at,
--     voided_by, void_reason, set once). Never deleted, never un-voided, no
--     description edits: void and re-add, which also matches the Phase 4
--     stock ledger. Lines are added or voided only while the job is open,
--     i.e. before it is completed (D15); reopen first.
--   * A job is not cancelled while it has a line that is not voided (D16).
--   * Cost gating (SPEC §4.2): authenticated may read the sale side of a
--     line only; costs, rate, yield and Cult Commons are read through the
--     *_staff views, which return rows only to holders of view_costs.
--   * source_product_id and source_inventory_unit_id get their foreign keys
--     in Phase 4, together with add_inventory_line and the void reversal.

create domain public.line_quantity as numeric(10, 2)
  constraint line_quantity_not_nan check (value <> 'NaN'::numeric);
comment on domain public.line_quantity is
  'Quantity on a job line (2 decimals, e.g. 1.5 hours). Never NaN; inventory lines are whole numbers.';

create type public.line_type as enum ('service', 'inventory', 'manual');

create table public.work_order_line_items (
  -- Client-supplied: the idempotency key of the add.
  id uuid primary key,
  work_order_id uuid not null references public.work_orders (id) on delete restrict,
  line_type public.line_type not null,
  source_service_id uuid null references public.services (id) on delete restrict,
  -- Phase 4 adds: references public.products (id).
  source_product_id uuid null,
  -- Phase 4 adds: references public.inventory_units (id).
  source_inventory_unit_id uuid null,
  description_snapshot text not null,
  quantity public.line_quantity not null,
  unit_sale_price_snapshot public.money_amount not null,
  unit_direct_cost_snapshot public.money_amount not null,
  cult_commons_rate_snapshot public.rate_fraction not null,
  currency char(3) not null,
  -- Generated (SPEC §10, D1). Postgres forbids a generated column that
  -- references another, so each expression is written out in full.
  sale_total public.money_amount generated always as (
    round(quantity * unit_sale_price_snapshot, 2)
  ) stored,
  cost_total public.money_amount generated always as (
    round(quantity * unit_direct_cost_snapshot, 2)
  ) stored,
  yield_total public.money_amount generated always as (
    round(quantity * unit_sale_price_snapshot, 2) - round(quantity * unit_direct_cost_snapshot, 2)
  ) stored,
  cult_commons_share public.money_amount generated always as (
    round(
      greatest(
        round(quantity * unit_sale_price_snapshot, 2) - round(quantity * unit_direct_cost_snapshot, 2),
        0
      ) * cult_commons_rate_snapshot,
      2
    )
  ) stored,
  -- Null only for rows created outside the app.
  created_by uuid null references public.staff (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  voided_at timestamptz null,
  voided_by uuid null references public.staff (id) on delete restrict,
  void_reason text null,
  constraint work_order_line_items_description_check check (
    pg_catalog.btrim(description_snapshot) <> '' and pg_catalog.char_length(description_snapshot) <= 300
  ),
  constraint work_order_line_items_quantity_check check (quantity > 0 and quantity <= 9999),
  constraint work_order_line_items_unit_sale_price_check check (unit_sale_price_snapshot >= 0),
  constraint work_order_line_items_unit_direct_cost_check check (unit_direct_cost_snapshot >= 0),
  constraint work_order_line_items_rate_check check (
    cult_commons_rate_snapshot >= 0 and cult_commons_rate_snapshot <= 1
  ),
  constraint work_order_line_items_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint work_order_line_items_void_shape check ((voided_at is null) = (void_reason is null)),
  constraint work_order_line_items_void_reason_check check (
    void_reason is null or (pg_catalog.btrim(void_reason) <> '' and pg_catalog.char_length(void_reason) <= 500)
  ),
  constraint work_order_line_items_service_source check (
    line_type <> 'service'
    or (source_service_id is not null and source_product_id is null and source_inventory_unit_id is null)
  ),
  constraint work_order_line_items_manual_source check (
    line_type <> 'manual'
    or (source_service_id is null and source_product_id is null and source_inventory_unit_id is null)
  ),
  constraint work_order_line_items_inventory_source check (
    line_type <> 'inventory'
    or (source_product_id is not null and source_service_id is null and quantity = trunc(quantity))
  ),
  constraint work_order_line_items_unit_quantity check (source_inventory_unit_id is null or quantity = 1)
);
create index work_order_line_items_work_order_idx on public.work_order_line_items (work_order_id, created_at);
create index work_order_line_items_source_service_id_idx on public.work_order_line_items (source_service_id);
create index work_order_line_items_source_product_id_idx on public.work_order_line_items (source_product_id);
create index work_order_line_items_created_by_idx on public.work_order_line_items (created_by);
create index work_order_line_items_voided_by_idx on public.work_order_line_items (voided_by);

comment on table public.work_order_line_items is
  'Job lines with snapshotted economics and generated totals (SPEC §10). Immutable except voiding; never deleted. Listed by created_at.';
comment on column public.work_order_line_items.cult_commons_share is
  'round(max(yield, 0) x snapshotted rate, 2), per line (D1).';

-- ---------------------------------------------------------------------------
-- Rules every writer obeys, and the timeline.
-- ---------------------------------------------------------------------------
create function private.work_order_line_items_enforce_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  wo_status public.work_order_status;
  wo_currency char(3);
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = 'P0001',
      message = 'line_immutable',
      detail = 'Lines are kept as evidence; void the line instead.';
  end if;

  if tg_op = 'INSERT' then
    select w.status, w.currency into wo_status, wo_currency
    from public.work_orders w where w.id = new.work_order_id
    for share;
    if not found then
      raise exception 'work order % not found', new.work_order_id using errcode = 'P0002';
    end if;
    if not private.work_order_status_is_open(wo_status) then
      raise exception using
        errcode = 'P0001',
        message = 'work_order_locked',
        detail = 'This job is completed or closed; reopen it to change its lines.';
    end if;
    new.currency := wo_currency;
    new.description_snapshot := pg_catalog.btrim(new.description_snapshot);
    new.void_reason := nullif(pg_catalog.btrim(new.void_reason), '');
    if new.voided_at is not null or new.voided_by is not null or new.void_reason is not null then
      raise exception using
        errcode = 'P0001',
        message = 'line_immutable',
        detail = 'A line is added first and voided afterwards.';
    end if;
    return new;
  end if;

  -- UPDATE: only voiding, once.
  new.void_reason := nullif(pg_catalog.btrim(new.void_reason), '');
  if old.voided_at is not null
     or new.voided_at is null
     or old.voided_by is not null
     or new.id is distinct from old.id
     or new.work_order_id is distinct from old.work_order_id
     or new.line_type is distinct from old.line_type
     or new.source_service_id is distinct from old.source_service_id
     or new.source_product_id is distinct from old.source_product_id
     or new.source_inventory_unit_id is distinct from old.source_inventory_unit_id
     or new.description_snapshot is distinct from old.description_snapshot
     or new.quantity is distinct from old.quantity
     or new.unit_sale_price_snapshot is distinct from old.unit_sale_price_snapshot
     or new.unit_direct_cost_snapshot is distinct from old.unit_direct_cost_snapshot
     or new.cult_commons_rate_snapshot is distinct from old.cult_commons_rate_snapshot
     or new.currency is distinct from old.currency
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = 'P0001',
      message = 'line_immutable',
      detail = 'A line cannot be edited, only voided once; void it and add a new one.';
  end if;

  select w.status into wo_status from public.work_orders w where w.id = new.work_order_id for share;
  if not private.work_order_status_is_open(wo_status) then
    raise exception using
      errcode = 'P0001',
      message = 'work_order_locked',
      detail = 'This job is completed or closed; reopen it to change its lines.';
  end if;
  return new;
end;
$$;

create trigger work_order_line_items_enforce_rules
  before insert or update or delete on public.work_order_line_items
  for each row execute function private.work_order_line_items_enforce_rules();

-- line_added / line_voided. Sale side only: never cost, yield or Cult Commons.
create function private.work_order_line_items_record_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.record_work_order_event(
      new.work_order_id, 'line_added',
      pg_catalog.jsonb_build_object(
        'line_id', new.id,
        'line_type', new.line_type,
        'description', new.description_snapshot,
        'quantity', new.quantity,
        'unit_sale_price', new.unit_sale_price_snapshot,
        'sale_total', new.sale_total,
        'currency', new.currency
      ),
      new.created_at
    );
  elsif old.voided_at is null and new.voided_at is not null then
    perform private.record_work_order_event(
      new.work_order_id, 'line_voided',
      pg_catalog.jsonb_build_object(
        'line_id', new.id,
        'description', new.description_snapshot,
        'quantity', new.quantity,
        'sale_total', new.sale_total,
        'reason', new.void_reason
      ),
      new.voided_at
    );
  end if;
  return null;
end;
$$;

create trigger work_order_line_items_record_history
  after insert or update on public.work_order_line_items
  for each row execute function private.work_order_line_items_record_history();

-- D16: void the lines (Phase 4: which writes the stock reversals) before
-- cancelling a job.
create function private.work_orders_cancel_requires_no_lines()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled'
     and exists (
       select 1 from public.work_order_line_items li
       where li.work_order_id = new.id and li.voided_at is null
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'work_order_has_lines',
      detail = 'Void the job''s lines before cancelling it.';
  end if;
  return new;
end;
$$;

create trigger work_orders_cancel_requires_no_lines
  before update of status on public.work_orders
  for each row execute function private.work_orders_cancel_requires_no_lines();

-- ---------------------------------------------------------------------------
-- Totals. Sale side for every staff member (runs as the caller, so RLS
-- applies); costs, yield and Cult Commons only for view_costs (definer
-- views gated in their WHERE clause).
-- ---------------------------------------------------------------------------
create view public.work_order_totals
with (security_invoker = true)
as
  select w.id as work_order_id,
         w.currency,
         (count(li.id) filter (where li.voided_at is null))::integer as line_count,
         coalesce(sum(li.sale_total) filter (where li.voided_at is null), 0)::public.money_amount as sale_total
  from public.work_orders w
  left join public.work_order_line_items li on li.work_order_id = w.id
  group by w.id, w.currency;

comment on view public.work_order_totals is
  'Per job: number of live lines and their sale total. No cost columns: costs are in work_order_totals_staff.';

create view public.work_order_totals_staff
with (security_barrier)
as
  select t.work_order_id, t.currency, t.line_count, t.sale_total, t.cost_total, t.yield_total,
         t.cult_commons_share,
         (t.yield_total - t.cult_commons_share)::public.money_amount as bicii_yield_after_cc
  from (
    select w.id as work_order_id,
           w.currency,
           (count(li.id) filter (where li.voided_at is null))::integer as line_count,
           coalesce(sum(li.sale_total) filter (where li.voided_at is null), 0)::public.money_amount as sale_total,
           coalesce(sum(li.cost_total) filter (where li.voided_at is null), 0)::public.money_amount as cost_total,
           coalesce(sum(li.yield_total) filter (where li.voided_at is null), 0)::public.money_amount as yield_total,
           -- D1: the job's Cult Commons is the sum of its lines' shares.
           coalesce(sum(li.cult_commons_share) filter (where li.voided_at is null), 0)::public.money_amount
             as cult_commons_share
    from public.work_orders w
    left join public.work_order_line_items li on li.work_order_id = w.id
    group by w.id, w.currency
  ) t
  where (select private.has_permission('view_costs'));

comment on view public.work_order_totals_staff is
  'Per job: sale, cost, yield, Cult Commons (sum of line shares, D1) and BICII yield after CC, for view_costs only.';

create view public.work_order_line_items_staff
with (security_barrier)
as
  select li.id, li.work_order_id, li.line_type, li.source_service_id, li.source_product_id,
         li.source_inventory_unit_id, li.description_snapshot, li.quantity,
         li.unit_sale_price_snapshot, li.unit_direct_cost_snapshot, li.cult_commons_rate_snapshot,
         li.currency, li.sale_total, li.cost_total, li.yield_total, li.cult_commons_share,
         li.created_by, li.created_at, li.voided_at, li.voided_by, li.void_reason
  from public.work_order_line_items li
  where (select private.has_permission('view_costs'));

comment on view public.work_order_line_items_staff is
  'Every line column including cost, rate, yield and Cult Commons, for view_costs only.';

-- ---------------------------------------------------------------------------
-- Privileges. Writes only through the workshop RPCs.
-- ---------------------------------------------------------------------------
revoke all on function
  private.work_order_line_items_enforce_rules(),
  private.work_order_line_items_record_history(),
  private.work_orders_cancel_requires_no_lines()
from public, anon, authenticated, service_role;

alter table public.work_order_line_items enable row level security;

revoke all on table public.work_order_line_items from public, anon, authenticated, service_role;
revoke all on table public.work_order_totals from public, anon, authenticated, service_role;
revoke all on table public.work_order_totals_staff from public, anon, authenticated, service_role;
revoke all on table public.work_order_line_items_staff from public, anon, authenticated, service_role;

-- The sale side only (no unit cost, rate, cost, yield or Cult Commons).
grant select (
  id, work_order_id, line_type, source_service_id, source_product_id, source_inventory_unit_id,
  description_snapshot, quantity, unit_sale_price_snapshot, currency, sale_total,
  created_by, created_at, voided_at, voided_by, void_reason
) on table public.work_order_line_items to authenticated;
grant select on table public.work_order_line_items to service_role;

grant select on table public.work_order_totals to authenticated;
grant select on table public.work_order_totals_staff to authenticated;
grant select on table public.work_order_line_items_staff to authenticated;

create policy work_order_line_items_select_staff on public.work_order_line_items
  for select to authenticated
  using ((select private.is_staff()));
