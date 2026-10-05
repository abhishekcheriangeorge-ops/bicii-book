-- Consignment settlements, their reversals and the consignor ledgers (SPEC
-- §2, §13, §23 "Consignment sale liability and consignment settlement are
-- separate facts", "Consignment outstanding balance and partial
-- settlements", "Settlement allocations cannot exceed the amount owed
-- without an explicit override"; DATA-MODEL.md §9, §15, §16; PLAN D4, D44
-- CONS-JOB-PART, D46 CONS-RESTOCK, D47 SETTLEMENT-RULES, D48 SALES-ACCESS).
--
-- Rules encoded here, for every writer:
--   * Liability (what is owed for what sold) and settlement (what was paid)
--     are separate facts. Owed, paid and outstanding are derived in
--     reporting.consignor_item_ledger, never stored:
--       owed        = liability - non-voided consignor-borne charges (D4)
--       paid        = Σ amount_applied of settlements that are not reversed
--       outstanding = owed - paid
--     Money already paid stays paid, so outstanding can go negative (a
--     restock after a settlement, D46): the consignor owes the shop. It is
--     never a credit and is never recovered automatically.
--   * A settlement's amount equals the sum of its allocations (each > 0,
--     one per item, every item the consignor's). An allocation may exceed
--     the item's max(outstanding, 0) only with an override reason (D47).
--   * Settlements, their lines and reversals are append-only: a mistake is
--     corrected by reversing the whole settlement with a reason; the
--     settlement and its lines stay, the ledger stops counting them.
--   * A consignor is archived only with no active item
--     (consignor_has_open_items) and an outstanding of exactly 0
--     (consignor_has_balance, D47).
--   * Access (D48): settlements, lines and reversals are readable with
--     consignment money access (manage_consignments or view_costs) and
--     written only by the manage_consignments RPCs. Customers and anonymous
--     users read none of it.
--
-- Lock order (the consignment migration's header): record_settlement
-- inserts its header first (0, the idempotency row), then the consignor FOR
-- SHARE (0b), then its items FOR UPDATE in id order (6). reverse_settlement
-- locks the settlement row, then the consignor FOR SHARE. Archiving a
-- consignor is an UPDATE of its row (0b) whose trigger takes the
-- consignor's items FOR SHARE (6), so a concurrent sale, restock or job
-- completion of one of its items finishes first and the archive checks see
-- it.
--
-- The request fingerprint of a settlement is md5 of the canonical JSON
--   {"amount": "200.00", "paid_at": "...Z"|null,
--    "allocations": [{item, amount, override} ... sorted by item id],
--    "reference": trimmed|null, "notes": trimmed|null}
-- (amounts cast to money_amount and back to text, so "200" and "200.00"
-- match; allocations in any order match; paid_at as the caller gave it, in
-- UTC, NULL staying NULL).

-- ---------------------------------------------------------------------------
-- consignment_settlements, settlement_lines, consignment_settlement_reversals
-- ---------------------------------------------------------------------------
create table public.consignment_settlements (
  -- Client-supplied: the settlement's idempotency key.
  id uuid primary key,
  consignor_id uuid not null references public.consignors (id) on delete restrict,
  amount public.money_amount not null,
  currency char(3) not null,
  paid_at timestamptz not null,
  reference text null,
  notes text null,
  -- The request's fingerprint (idempotency); never shown.
  request_fingerprint text null,
  created_by uuid null references public.staff (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint consignment_settlements_amount_check check (amount > 0),
  constraint consignment_settlements_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint consignment_settlements_reference_check check (pg_catalog.char_length(reference) <= 200),
  constraint consignment_settlements_notes_check check (pg_catalog.char_length(notes) <= 2000)
);
create index consignment_settlements_consignor_paid_idx on public.consignment_settlements (consignor_id, paid_at desc);
create index consignment_settlements_created_by_idx on public.consignment_settlements (created_by);

comment on table public.consignment_settlements is
  'Money paid to a consignor (D47): amount = Σ its allocations. Append-only; corrected by a whole-settlement reversal (consignment_settlement_reversals). manage_consignments or view_costs read it (D48).';

create table public.settlement_lines (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.consignment_settlements (id) on delete restrict,
  consignment_item_id uuid not null references public.consignment_items (id) on delete restrict,
  amount_applied public.money_amount not null,
  -- Why this allocation exceeds the item's outstanding (D47).
  override_reason text null,
  created_at timestamptz not null default clock_timestamp(),
  constraint settlement_lines_settlement_item_key unique (settlement_id, consignment_item_id),
  constraint settlement_lines_amount_applied_check check (amount_applied > 0),
  constraint settlement_lines_override_reason_check check (
    override_reason is null
    or (pg_catalog.btrim(override_reason) <> '' and pg_catalog.char_length(override_reason) <= 500)
  )
);
create index settlement_lines_consignment_item_id_idx on public.settlement_lines (consignment_item_id);

comment on table public.settlement_lines is
  'A settlement''s allocation to one consignment item (> 0); above the item''s outstanding only with an override reason (D47). Append-only.';

create table public.consignment_settlement_reversals (
  -- Client-supplied: the reversal's idempotency key.
  id uuid primary key,
  settlement_id uuid not null unique references public.consignment_settlements (id) on delete restrict,
  reason text not null,
  created_by uuid null references public.staff (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint consignment_settlement_reversals_reason_check check (
    pg_catalog.btrim(reason) <> '' and pg_catalog.char_length(reason) <= 500
  )
);
create index consignment_settlement_reversals_created_by_idx on public.consignment_settlement_reversals (created_by);

comment on table public.consignment_settlement_reversals is
  'The whole-settlement correction (D47): the settlement and its lines stay, the ledger stops counting them. At most one per settlement; append-only.';

-- Append-only, for every writer. Inserts are trimmed and stamped.
create function private.settlements_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if tg_table_name = 'consignment_settlements' then
      new.reference := nullif(pg_catalog.btrim(new.reference), '');
      new.notes := nullif(pg_catalog.btrim(new.notes), '');
      new.created_by := coalesce(new.created_by, private.current_staff_id());
    elsif tg_table_name = 'settlement_lines' then
      new.override_reason := nullif(pg_catalog.btrim(new.override_reason), '');
    else
      new.reason := pg_catalog.btrim(new.reason);
      new.created_by := coalesce(new.created_by, private.current_staff_id());
    end if;
    return new;
  end if;
  raise exception using
    errcode = 'P0001',
    message = 'settlement_immutable',
    detail = 'A settlement cannot be edited or deleted; reverse it with a reason and record a new one.';
end;
$$;

create trigger settlement_immutable
  before insert or update or delete on public.consignment_settlements
  for each row execute function private.settlements_immutable();
create trigger settlement_immutable
  before insert or update or delete on public.settlement_lines
  for each row execute function private.settlements_immutable();
create trigger settlement_immutable
  before insert or update or delete on public.consignment_settlement_reversals
  for each row execute function private.settlements_immutable();

-- ---------------------------------------------------------------------------
-- The ledgers (security_invoker, granted to no API role; the RPCs read them
-- as their owner). Nothing here is stored.
-- ---------------------------------------------------------------------------
create view reporting.consignor_item_ledger
with (security_invoker = true)
as
  select pos.consignment_item_id,
         pos.consignor_id,
         pos.product_id,
         pos.inventory_unit_id,
         pos.quantity,
         pos.sold_qty,
         pos.restocked_qty,
         pos.job_held_qty,
         pos.job_sold_qty,
         pos.returned_qty,
         pos.remaining_qty,
         pos.owed_qty,
         pos.liability,
         pos.last_sale_at,
         pos.last_returned_at,
         pos.consignor_charges,
         pos.shop_charges,
         i.short_id::text as short_id,
         i.status,
         i.received_at,
         i.sold_at,
         i.returned_at,
         i.return_reason,
         i.agreed_amount_owed::numeric as agreed_amount_owed,
         i.asking_price::numeric as asking_price,
         i.currency::text as currency,
         (pos.liability - pos.consignor_charges)::numeric as owed,
         coalesce(st.paid, 0.00)::numeric as paid,
         (pos.liability - pos.consignor_charges - coalesce(st.paid, 0.00))::numeric as outstanding,
         st.last_settlement_at
  from reporting.consignment_item_position pos
  join public.consignment_items i on i.id = pos.consignment_item_id
  left join lateral (
    select sum(sl.amount_applied) as paid,
           max(s.paid_at) as last_settlement_at
    from public.settlement_lines sl
    join public.consignment_settlements s on s.id = sl.settlement_id
    where sl.consignment_item_id = i.id
      and not exists (
        select 1 from public.consignment_settlement_reversals r where r.settlement_id = s.id
      )
  ) st on true;

comment on view reporting.consignor_item_ledger is
  'Per consignment item: its position (reporting.consignment_item_position) and terms, owed = liability - consignor charges, paid = Σ allocations of settlements not reversed, outstanding = owed - paid (negative = the consignor owes the shop, D46), last settlement. Derived, never stored; no API grant.';

create view reporting.consignor_ledger
with (security_invoker = true)
as
  select c.id as consignor_id,
         c.display_name,
         c.customer_id,
         c.archived_at,
         private.shop_currency()::text as currency,
         count(il.consignment_item_id)::integer as items_total,
         (count(il.consignment_item_id) filter (where il.status = 'active'))::integer as active_items,
         (count(il.consignment_item_id) filter (where il.outstanding > 0))::integer as awaiting_settlement_items,
         (count(il.consignment_item_id) filter (where il.status = 'returned'))::integer as returned_items,
         (count(il.consignment_item_id) filter (where il.status = 'sold'))::integer as sold_items,
         coalesce(sum(il.liability), 0.00)::numeric as liability,
         coalesce(sum(il.consignor_charges), 0.00)::numeric as consignor_charges,
         coalesce(sum(il.owed), 0.00)::numeric as owed,
         coalesce(sum(il.paid), 0.00)::numeric as paid,
         coalesce(sum(il.outstanding), 0.00)::numeric as outstanding,
         max(il.last_sale_at) as last_sale_at,
         max(il.last_settlement_at) as last_settlement_at
  from public.consignors c
  left join reporting.consignor_item_ledger il on il.consignor_id = c.id
  group by c.id;

comment on view reporting.consignor_ledger is
  'Per consignor: item counts (active, awaiting settlement = outstanding > 0, returned, sold) and the sums of its items'' liability, consignor charges, owed, paid and outstanding (equal to the sum of reporting.consignor_item_ledger rows). Derived; no API grant.';

revoke all on table reporting.consignor_item_ledger from public, anon, authenticated, service_role;
revoke all on table reporting.consignor_ledger from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- consignors: the step-1 rules plus D47's balance rule (same trigger).
-- ---------------------------------------------------------------------------
create or replace function private.consignors_enforce_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  balance numeric;
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, private.current_staff_id());
  end if;
  if new.customer_id is not null
     and (tg_op = 'INSERT' or new.customer_id is distinct from old.customer_id)
     and exists (
       select 1 from public.customers c where c.id = new.customer_id and c.archived_at is not null
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'customer_archived',
      detail = 'That customer is archived; unarchive them before linking a consignor.';
  end if;
  if tg_op = 'UPDATE' and old.archived_at is null and new.archived_at is not null then
    -- Lock order 6 after this row (0b): a sale, restock or completion of one
    -- of its items in flight finishes first; the reads below then see it.
    perform 1 from public.consignment_items i where i.consignor_id = new.id order by i.id for share;
    if exists (
      select 1 from public.consignment_items i where i.consignor_id = new.id and i.status = 'active'
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'consignor_has_open_items',
        detail = 'This consignor still has items with the shop; sell or return them before archiving.';
    end if;
    select l.outstanding into balance from reporting.consignor_ledger l where l.consignor_id = new.id;
    if coalesce(balance, 0) > 0 then
      raise exception using
        errcode = 'P0001',
        message = 'consignor_has_balance',
        detail = pg_catalog.format(
          'This consignor is still owed %s; settle it before archiving.',
          pg_catalog.to_char(balance, 'FM999,999,990.00')
        );
    elsif coalesce(balance, 0) < 0 then
      raise exception using
        errcode = 'P0001',
        message = 'consignor_has_balance',
        detail = pg_catalog.format(
          'Overpaid %s (the consignor owes the shop). It clears with a later sale, by voiding a consignor charge or by reversing a settlement; archive once the balance is 0.',
          pg_catalog.to_char(-balance, 'FM999,999,990.00')
        );
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Result type and the request fingerprint.
-- ---------------------------------------------------------------------------
create type public.settlement_result as (
  settlement_id uuid,
  consignor_id uuid,
  amount numeric,
  paid_at timestamptz,
  replayed boolean
);

create function private.settlement_request_fingerprint(
  amount public.money_amount,
  paid_at timestamptz,
  allocations jsonb,
  reference text,
  notes text
)
returns text
language sql
stable
set search_path = ''
as $$
  select pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'amount', settlement_request_fingerprint.amount::text,
      'paid_at', pg_catalog.to_char(
        settlement_request_fingerprint.paid_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ),
      'allocations', coalesce((
        select pg_catalog.jsonb_agg(x.allocation order by x.item)
        from (
          select (a.v ->> 'consignment_item_id')::uuid as item,
                 pg_catalog.jsonb_build_object(
                   'item', (a.v ->> 'consignment_item_id')::uuid,
                   'amount', ((a.v ->> 'amount')::public.money_amount)::text,
                   'override', nullif(pg_catalog.btrim(a.v ->> 'override_reason'), '')
                 ) as allocation
          from pg_catalog.jsonb_array_elements(settlement_request_fingerprint.allocations) as a(v)
        ) x
      ), '[]'::jsonb),
      'reference', nullif(pg_catalog.btrim(settlement_request_fingerprint.reference), ''),
      'notes', nullif(pg_catalog.btrim(settlement_request_fingerprint.notes), '')
    )::text
  );
$$;

-- ---------------------------------------------------------------------------
-- record_settlement (manage_consignments, D47). (1) Shape; (2) the header
-- insert (lock order 0): a replay with the same fingerprint returns the
-- settlement even after the outstanding changed; (3) the consignor FOR
-- SHARE (0b) and the items FOR UPDATE (6); (4) per allocation, the item's
-- outstanding read in a new statement and the override rule.
-- allocations: [{"consignment_item_id": uuid, "amount": numeric,
--                "override_reason"?: text}, ...]
-- ---------------------------------------------------------------------------
create function public.record_settlement(
  settlement_id uuid,
  consignor_id uuid,
  amount public.money_amount,
  allocations jsonb,
  paid_at timestamptz default null,
  reference text default null,
  notes text default null
)
returns public.settlement_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_permission('manage_consignments');
  fingerprint text;
  header public.consignment_settlements;
  consignor_archived timestamptz;
  allocation record;
  total numeric;
  item_outstanding numeric;
  item_short_id text;
  result public.settlement_result;
  err_state text;
  err_constraint text;
  err_table text;
  err_schema text;
  err_column text;
  err_message text;
begin
  -- (1) Shape.
  if record_settlement.settlement_id is null or record_settlement.consignor_id is null
     or record_settlement.amount is null then
    raise exception 'settlement_id, consignor_id and amount are required' using errcode = '22004';
  end if;
  if not exists (select 1 from public.consignors c where c.id = record_settlement.consignor_id) then
    raise exception 'consignor % not found', record_settlement.consignor_id using errcode = 'P0002';
  end if;
  if record_settlement.paid_at > pg_catalog.now() + interval '5 minutes' then
    raise exception using
      errcode = 'P0001',
      message = 'settlement_paid_in_future',
      detail = 'A settlement cannot be dated in the future.';
  end if;
  if record_settlement.allocations is null or pg_catalog.jsonb_typeof(record_settlement.allocations) <> 'array'
     or pg_catalog.jsonb_array_length(record_settlement.allocations) = 0
     or exists (
       select 1 from pg_catalog.jsonb_array_elements(record_settlement.allocations) a(v)
       where pg_catalog.jsonb_typeof(a.v) <> 'object'
          or (a.v ->> 'consignment_item_id') is null
          or (a.v ->> 'amount') is null
          or (a.v ->> 'amount')::public.money_amount <= 0
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'settlement_allocations_required',
      detail = 'Allocate the payment to the consignor''s items, each with an amount above zero.';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(record_settlement.allocations) a(v)
    group by (a.v ->> 'consignment_item_id')::uuid
    having count(*) > 1
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'settlement_duplicate_item',
      detail = 'Each item takes one allocation per settlement.';
  end if;
  for allocation in
    select (a.v ->> 'consignment_item_id')::uuid as item_id, i.id as found_id, i.consignor_id
    from pg_catalog.jsonb_array_elements(record_settlement.allocations) a(v)
    left join public.consignment_items i on i.id = (a.v ->> 'consignment_item_id')::uuid
  loop
    if allocation.found_id is null then
      raise exception 'consignment item % not found', allocation.item_id using errcode = 'P0002';
    end if;
    if allocation.consignor_id <> record_settlement.consignor_id then
      raise exception using
        errcode = 'P0001',
        message = 'settlement_item_wrong_consignor',
        detail = 'Every allocated item must be this consignor''s.';
    end if;
  end loop;
  select sum((a.v ->> 'amount')::public.money_amount) into total
  from pg_catalog.jsonb_array_elements(record_settlement.allocations) a(v);
  if total <> record_settlement.amount then
    raise exception using
      errcode = 'P0001',
      message = 'settlement_allocation_mismatch',
      detail = pg_catalog.format(
        'The allocations add up to %s, not %s.', pg_catalog.to_char(total, 'FM999,999,990.00'),
        pg_catalog.to_char(record_settlement.amount, 'FM999,999,990.00')
      );
  end if;
  fingerprint := private.settlement_request_fingerprint(
    record_settlement.amount, record_settlement.paid_at, record_settlement.allocations,
    record_settlement.reference, record_settlement.notes
  );

  -- (2) Idempotency: the request's own row (lock order 0).
  begin
    insert into public.consignment_settlements as s (
      id, consignor_id, amount, currency, paid_at, reference, notes, request_fingerprint, created_by
    )
    values (
      record_settlement.settlement_id, record_settlement.consignor_id, record_settlement.amount,
      private.shop_currency(), coalesce(record_settlement.paid_at, pg_catalog.now()), record_settlement.reference,
      record_settlement.notes, fingerprint, actor
    )
    on conflict (id) do nothing
    returning s.* into header;
  exception
    when check_violation or not_null_violation then
      get stacked diagnostics
        err_state = returned_sqlstate, err_constraint = constraint_name, err_table = table_name,
        err_schema = schema_name, err_column = column_name, err_message = message_text;
      perform private.raise_without_row(err_state, err_constraint, err_table, err_schema, err_column, err_message);
  end;
  if header.id is null then
    select s.* into header from public.consignment_settlements s where s.id = record_settlement.settlement_id;
    if header.request_fingerprint is not distinct from fingerprint
       and header.consignor_id = record_settlement.consignor_id then
      result := row(header.id, header.consignor_id, header.amount, header.paid_at, true);
      return result;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'settlement_conflict',
      detail = 'That settlement id is already used for another settlement.';
  end if;

  -- (3) Locks: the consignor (0b), then the items in id order (6).
  select c.archived_at into consignor_archived
  from public.consignors c where c.id = record_settlement.consignor_id
  for share;
  if consignor_archived is not null then
    raise exception using
      errcode = 'P0001',
      message = 'consignor_archived',
      detail = 'That consignor is archived; unarchive them first.';
  end if;
  perform 1
  from public.consignment_items i
  where i.id in (
    select (a.v ->> 'consignment_item_id')::uuid from pg_catalog.jsonb_array_elements(record_settlement.allocations) a(v)
  )
  order by i.id
  for update;

  -- (4) The allocations, each against the item's outstanding now (D47).
  for allocation in
    select (a.v ->> 'consignment_item_id')::uuid as item_id,
           (a.v ->> 'amount')::public.money_amount as amount,
           nullif(pg_catalog.btrim(a.v ->> 'override_reason'), '') as override_reason
    from pg_catalog.jsonb_array_elements(record_settlement.allocations) a(v)
    order by 1
  loop
    select l.outstanding, l.short_id into item_outstanding, item_short_id
    from reporting.consignor_item_ledger l where l.consignment_item_id = allocation.item_id;
    if allocation.amount > greatest(item_outstanding, 0) and allocation.override_reason is null then
      raise exception using
        errcode = 'P0001',
        message = 'settlement_exceeds_outstanding',
        detail = pg_catalog.format(
          '%s has %s outstanding; paying more needs an override reason.', item_short_id,
          pg_catalog.to_char(item_outstanding, 'FM999,999,990.00')
        );
    end if;
    begin
      insert into public.settlement_lines (settlement_id, consignment_item_id, amount_applied, override_reason)
      values (header.id, allocation.item_id, allocation.amount, allocation.override_reason);
    exception
      when check_violation or not_null_violation then
        get stacked diagnostics
          err_state = returned_sqlstate, err_constraint = constraint_name, err_table = table_name,
          err_schema = schema_name, err_column = column_name, err_message = message_text;
        perform private.raise_without_row(err_state, err_constraint, err_table, err_schema, err_column, err_message);
    end;
  end loop;

  result := row(header.id, header.consignor_id, header.amount, header.paid_at, false);
  return result;
end;
$$;

comment on function public.record_settlement(uuid, uuid, public.money_amount, jsonb, timestamptz, text, text) is
  'manage_consignments (D47): record money paid to a consignor, allocated to their items (Σ = amount; above an item''s outstanding only with an override reason); replay-safe by settlement id with a request fingerprint.';

-- ---------------------------------------------------------------------------
-- reverse_settlement (manage_consignments, D47): the whole settlement, with
-- a reason; replay-safe by reversal id.
-- ---------------------------------------------------------------------------
create function public.reverse_settlement(reversal_id uuid, settlement_id uuid, reason text)
returns public.consignment_settlement_reversals
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_permission('manage_consignments');
  cleaned text := nullif(pg_catalog.btrim(coalesce(reverse_settlement.reason, '')), '');
  existing public.consignment_settlement_reversals;
  header public.consignment_settlements;
  consignor_archived timestamptz;
  inserted public.consignment_settlement_reversals;
  err_state text;
  err_constraint text;
  err_table text;
  err_schema text;
  err_column text;
  err_message text;
begin
  if reverse_settlement.reversal_id is null or reverse_settlement.settlement_id is null then
    raise exception 'reversal_id and settlement_id are required' using errcode = '22004';
  end if;
  if cleaned is null then
    raise exception using
      errcode = 'P0001',
      message = 'reason_required',
      detail = 'Say why the settlement is being reversed.';
  end if;
  if pg_catalog.char_length(cleaned) > 500 then
    raise exception using
      errcode = 'P0001',
      message = 'reason_too_long',
      detail = 'Keep the reason under 500 characters.';
  end if;

  select r.* into existing from public.consignment_settlement_reversals r where r.id = reverse_settlement.reversal_id;
  if found then
    if existing.settlement_id = reverse_settlement.settlement_id then
      return existing;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'settlement_reversal_conflict',
      detail = 'That reversal id is already used for another settlement.';
  end if;

  select s.* into header from public.consignment_settlements s where s.id = reverse_settlement.settlement_id for update;
  if not found then
    raise exception 'settlement % not found', reverse_settlement.settlement_id using errcode = 'P0002';
  end if;
  -- The consignor FOR SHARE: an archive waits, then sees the balance.
  select c.archived_at into consignor_archived from public.consignors c where c.id = header.consignor_id for share;
  select r.* into existing from public.consignment_settlement_reversals r where r.settlement_id = header.id;
  if found then
    if existing.id = reverse_settlement.reversal_id then
      return existing;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'settlement_already_reversed',
      detail = 'That settlement has already been reversed.';
  end if;
  if consignor_archived is not null then
    raise exception using
      errcode = 'P0001',
      message = 'consignor_archived',
      detail = 'That consignor is archived; unarchive them first.';
  end if;

  begin
    insert into public.consignment_settlement_reversals as r (id, settlement_id, reason, created_by)
    values (reverse_settlement.reversal_id, header.id, cleaned, actor)
    returning r.* into inserted;
  exception
    when check_violation or not_null_violation then
      get stacked diagnostics
        err_state = returned_sqlstate, err_constraint = constraint_name, err_table = table_name,
        err_schema = schema_name, err_column = column_name, err_message = message_text;
      perform private.raise_without_row(err_state, err_constraint, err_table, err_schema, err_column, err_message);
  end;
  return inserted;
end;
$$;

comment on function public.reverse_settlement(uuid, uuid, text) is
  'manage_consignments (D47): reverse a whole settlement with a reason (it and its lines stay; the ledger stops counting them); replay-safe by reversal id.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function
  private.settlements_immutable(),
  private.consignors_enforce_rules(),
  private.settlement_request_fingerprint(public.money_amount, timestamptz, jsonb, text, text)
from public, anon, authenticated, service_role;

revoke all on function
  public.record_settlement(uuid, uuid, public.money_amount, jsonb, timestamptz, text, text),
  public.reverse_settlement(uuid, uuid, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.record_settlement(uuid, uuid, public.money_amount, jsonb, timestamptz, text, text),
  public.reverse_settlement(uuid, uuid, text)
to authenticated;

alter table public.consignment_settlements enable row level security;
alter table public.settlement_lines enable row level security;
alter table public.consignment_settlement_reversals enable row level security;

revoke all on table public.consignment_settlements from public, anon, authenticated, service_role;
revoke all on table public.settlement_lines from public, anon, authenticated, service_role;
revoke all on table public.consignment_settlement_reversals from public, anon, authenticated, service_role;

-- Every column except the request fingerprint; written only by the RPCs.
grant select (
  id, consignor_id, amount, currency, paid_at, reference, notes, created_by, created_at
) on table public.consignment_settlements to authenticated;
grant select on table public.consignment_settlements to service_role;
grant select on table public.settlement_lines to authenticated, service_role;
grant select on table public.consignment_settlement_reversals to authenticated, service_role;

create policy consignment_settlements_select_money on public.consignment_settlements
  for select to authenticated
  using ((select private.is_staff()) and (select private.can_view_consignment_money()));

create policy settlement_lines_select_money on public.settlement_lines
  for select to authenticated
  using ((select private.is_staff()) and (select private.can_view_consignment_money()));

create policy consignment_settlement_reversals_select_money on public.consignment_settlement_reversals
  for select to authenticated
  using ((select private.is_staff()) and (select private.can_view_consignment_money()));
