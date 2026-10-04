-- Bicycles and their ownership history (SPEC §2 "History over overwrites",
-- "Stable physical identity"; §5; DATA-MODEL.md §2, §15, §16, §17).
--
-- Rules encoded here:
--   * A bike is permanent. Its short ID (B-000123, printed on its QR label)
--     is assigned by the server from private.next_short_id('B') on insert,
--     for every writer, and never changes. Clients cannot supply it.
--   * bikes.customer_id is the CURRENT owner (null: shop-owned, consigned
--     or not yet known). Every owner change appends a bike_ownership_events
--     row with the actor and the reason, written by a trigger so no path
--     (RPC, seed, SQL editor) skips it: `registered` when a bike is created
--     with an owner, `transferred` for each later change. A transfer needs
--     a reason. The history is append-only.
--   * Signed-in users cannot change customer_id with a plain UPDATE (no
--     column grant): ownership moves only through transfer_bike_ownership,
--     which locks the bike, requires a reason, and is a no-op when the bike
--     already belongs to that customer.
--   * Archived customers cannot receive bikes; archived bikes are not
--     transferred (unarchive first). Archived rows stay readable.
--   * Customer access boundary (as for customers): base tables are for
--     active staff only; customers see their own bikes through my_bikes()
--     (customer access migration), which never returns internal_notes.
--   * inventory_unit_id is set when a bike is shop-owned or consigned; the
--     inventory_units table and this column's foreign key arrive in Phase 4.

-- ---------------------------------------------------------------------------
-- Reasons for audited changes. RPCs pass the reason to the history triggers
-- through this transaction-local setting and clear it straight after the
-- write (the staff history migration does the same for staff_events).
-- ---------------------------------------------------------------------------
create function private.set_change_reason(reason text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  cleaned text := nullif(pg_catalog.btrim(coalesce(reason, '')), '');
begin
  if cleaned is not null and pg_catalog.char_length(cleaned) > 500 then
    raise exception using
      errcode = 'P0001',
      message = 'reason_too_long',
      detail = 'Keep the reason under 500 characters.';
  end if;
  perform pg_catalog.set_config('app.change_reason', coalesce(cleaned, ''), true);
end;
$$;

create function private.change_reason()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(pg_catalog.current_setting('app.change_reason', true), '');
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create type public.bike_ownership_event_type as enum ('registered', 'transferred');

create table public.bikes (
  id uuid primary key default gen_random_uuid(),
  -- Always assigned by bikes_enforce_rules on insert (the '' default only
  -- makes the column optional for callers; any value given is replaced).
  short_id text not null default '' unique,
  -- Current owner; history in bike_ownership_events.
  customer_id uuid null references public.customers (id) on delete restrict,
  -- Phase 4 adds: references public.inventory_units (id).
  inventory_unit_id uuid null,
  brand text not null check (pg_catalog.char_length(brand) <= 100),
  model text not null check (pg_catalog.char_length(model) <= 100),
  variant text null check (pg_catalog.char_length(variant) <= 100),
  frame_size text null check (pg_catalog.char_length(frame_size) <= 40),
  colour text null check (pg_catalog.char_length(colour) <= 60),
  -- Indexed (serial_key), NOT unique: real-world duplicates exist.
  serial_number text null check (pg_catalog.char_length(serial_number) <= 100),
  description text null check (pg_catalog.char_length(description) <= 2000),
  -- Staff only. Never in a customer projection.
  internal_notes text null check (pg_catalog.char_length(internal_notes) <= 10000),
  -- Search keys (generated; never written directly).
  serial_key text generated always as (
    nullif(upper(regexp_replace(coalesce(serial_number, ''), '[^A-Za-z0-9]', '', 'g')), '')
  ) stored,
  search_text text generated always as (
    lower(brand || ' ' || model || ' ' || coalesce(variant, '') || ' ' || coalesce(colour, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  constraint bikes_short_id_format check (short_id ~ '^B-[0-9]{6}$')
);

comment on table public.bikes is
  'Permanent bicycles. customer_id is the current owner; ownership history is in bike_ownership_events.';
comment on column public.bikes.short_id is 'B-######, server-assigned from private.next_short_id(''B''); immutable.';
comment on column public.bikes.inventory_unit_id is
  'Set when shop-owned or consigned. Foreign key to inventory_units added in Phase 4.';
comment on column public.bikes.internal_notes is 'Staff only; never returned by a customer RPC.';
comment on column public.bikes.serial_key is
  'Generated: serial number upper-cased without spaces or punctuation, for exact and partial search.';
comment on column public.bikes.search_text is 'Generated: lower-cased brand, model, variant and colour, trigram-indexed.';

create index bikes_customer_id_idx on public.bikes (customer_id);
create index bikes_serial_key_idx on public.bikes (serial_key);
create index bikes_serial_key_trgm_idx on public.bikes using gin (serial_key extensions.gin_trgm_ops);
create index bikes_search_text_trgm_idx on public.bikes using gin (search_text extensions.gin_trgm_ops);

create trigger bikes_set_updated_at
  before update on public.bikes
  for each row execute function private.set_updated_at();

create table public.bike_ownership_events (
  id uuid primary key default gen_random_uuid(),
  bike_id uuid not null references public.bikes (id) on delete restrict,
  event_type public.bike_ownership_event_type not null,
  -- Null: the shop (or nobody yet).
  from_customer_id uuid null references public.customers (id) on delete restrict,
  to_customer_id uuid null references public.customers (id) on delete restrict,
  -- Required for transfers; optional for the initial registration.
  reason text null,
  -- Null when the change was made outside the app (seed, SQL editor).
  actor_staff_id uuid null references public.staff (id) on delete restrict,
  correlation_id text null,
  -- clock_timestamp(): several events in one transaction keep their order.
  created_at timestamptz not null default clock_timestamp(),
  constraint bike_ownership_events_registered_shape check (
    event_type <> 'registered' or (from_customer_id is null and to_customer_id is not null)
  ),
  constraint bike_ownership_events_transfer_changes_owner check (
    event_type <> 'transferred' or from_customer_id is distinct from to_customer_id
  ),
  constraint bike_ownership_events_transfer_has_reason check (
    event_type <> 'transferred' or reason is not null
  ),
  constraint bike_ownership_events_reason_check check (
    reason is null or (pg_catalog.btrim(reason) <> '' and pg_catalog.char_length(reason) <= 500)
  )
);
create index bike_ownership_events_bike_id_created_at_idx
  on public.bike_ownership_events (bike_id, created_at desc);
create index bike_ownership_events_from_customer_id_idx on public.bike_ownership_events (from_customer_id);
create index bike_ownership_events_to_customer_id_idx on public.bike_ownership_events (to_customer_id);
create index bike_ownership_events_actor_staff_id_idx on public.bike_ownership_events (actor_staff_id);

comment on table public.bike_ownership_events is
  'Append-only ownership history of each bike: who moved it from whom to whom, when and why. Written by triggers.';

-- ---------------------------------------------------------------------------
-- Rules every writer obeys (the owner included).
-- ---------------------------------------------------------------------------
create function private.bikes_enforce_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.brand := nullif(pg_catalog.btrim(new.brand), '');
  new.model := nullif(pg_catalog.btrim(new.model), '');
  new.variant := nullif(pg_catalog.btrim(new.variant), '');
  new.frame_size := nullif(pg_catalog.btrim(new.frame_size), '');
  new.colour := nullif(pg_catalog.btrim(new.colour), '');
  new.serial_number := nullif(pg_catalog.btrim(new.serial_number), '');
  new.description := nullif(pg_catalog.btrim(new.description), '');
  new.internal_notes := nullif(pg_catalog.btrim(new.internal_notes), '');

  if tg_op = 'INSERT' then
    -- Server-assigned, whatever the caller sent.
    new.short_id := private.next_short_id('B');
  else
    if new.short_id is distinct from old.short_id then
      raise exception using
        errcode = 'P0001',
        message = 'bike_short_id_immutable',
        detail = 'A bike keeps its short ID for life; it is printed on its label.';
    end if;
    if new.customer_id is distinct from old.customer_id then
      if old.archived_at is not null and new.archived_at is not null then
        raise exception using
          errcode = 'P0001',
          message = 'bike_archived',
          detail = 'Unarchive the bike before changing its owner.';
      end if;
      if private.change_reason() is null then
        raise exception using
          errcode = 'P0001',
          message = 'reason_required',
          detail = 'Say why the bike is changing owner.';
      end if;
    end if;
  end if;

  if new.customer_id is not null
     and (tg_op = 'INSERT' or new.customer_id is distinct from old.customer_id)
     and exists (
       select 1 from public.customers c
       where c.id = new.customer_id and c.archived_at is not null
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'customer_archived',
      detail = 'That customer is archived; unarchive them first.';
  end if;
  return new;
end;
$$;

create trigger bikes_enforce_rules
  before insert or update on public.bikes
  for each row execute function private.bikes_enforce_rules();

create function private.bikes_record_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.customer_id is not null then
      insert into public.bike_ownership_events
        (bike_id, event_type, from_customer_id, to_customer_id, reason, actor_staff_id, correlation_id)
      values
        (new.id, 'registered', null, new.customer_id, private.change_reason(),
         private.current_staff_id(), private.current_correlation_id());
    end if;
  elsif new.customer_id is distinct from old.customer_id then
    insert into public.bike_ownership_events
      (bike_id, event_type, from_customer_id, to_customer_id, reason, actor_staff_id, correlation_id)
    values
      (new.id, 'transferred', old.customer_id, new.customer_id, private.change_reason(),
       private.current_staff_id(), private.current_correlation_id());
  end if;
  return null;
end;
$$;

create trigger bikes_record_ownership
  after insert or update of customer_id on public.bikes
  for each row execute function private.bikes_record_ownership();

create function private.bike_ownership_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'bike_history_append_only',
    detail = 'Bike ownership history cannot be changed or deleted.';
end;
$$;

create trigger bike_ownership_events_append_only
  before update or delete on public.bike_ownership_events
  for each row execute function private.bike_ownership_events_append_only();

-- ---------------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------------

-- Active staff. Moves a bike to another customer (or to the shop, null)
-- with a mandatory reason; one `transferred` event with actor and reason.
-- Locks the bike row so concurrent transfers serialise. Replaying the
-- current owner changes nothing and records nothing.
create function public.transfer_bike_ownership(bike_id uuid, to_customer_id uuid, reason text)
returns public.bikes
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  cleaned text := nullif(pg_catalog.btrim(coalesce(transfer_bike_ownership.reason, '')), '');
  target public.bikes;
begin
  perform private.require_staff();

  if transfer_bike_ownership.bike_id is null then
    raise exception 'bike_id is required' using errcode = '22004';
  end if;
  if cleaned is null then
    raise exception using
      errcode = 'P0001',
      message = 'reason_required',
      detail = 'Say why the bike is changing owner.';
  end if;

  select b.* into target from public.bikes b where b.id = transfer_bike_ownership.bike_id for update;
  if not found then
    raise exception 'bike % not found', transfer_bike_ownership.bike_id using errcode = 'P0002';
  end if;
  if transfer_bike_ownership.to_customer_id is not null and not exists (
    select 1 from public.customers c where c.id = transfer_bike_ownership.to_customer_id
  ) then
    raise exception 'customer % not found', transfer_bike_ownership.to_customer_id using errcode = 'P0002';
  end if;
  if target.customer_id is not distinct from transfer_bike_ownership.to_customer_id then
    return target;
  end if;
  if target.archived_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'bike_archived',
      detail = 'Unarchive the bike before changing its owner.';
  end if;

  perform private.set_change_reason(cleaned);
  update public.bikes b
  set customer_id = transfer_bike_ownership.to_customer_id
  where b.id = target.id
  returning b.* into target;
  perform private.set_change_reason(null);
  return target;
end;
$$;

comment on function public.transfer_bike_ownership(uuid, uuid, text) is
  'Active staff: move a bike to another customer (null = the shop) with a reason; appends bike_ownership_events.';

revoke all on function
  private.set_change_reason(text),
  private.change_reason(),
  private.bikes_enforce_rules(),
  private.bikes_record_ownership(),
  private.bike_ownership_events_append_only()
from public, anon, authenticated, service_role;

revoke all on function public.transfer_bike_ownership(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.transfer_bike_ownership(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Grants and RLS: active staff only.
-- ---------------------------------------------------------------------------
alter table public.bikes enable row level security;
alter table public.bike_ownership_events enable row level security;

revoke all on table public.bikes from public, anon, authenticated, service_role;
revoke all on table public.bike_ownership_events from public, anon, authenticated, service_role;

grant select on table public.bikes to authenticated;
-- No short_id (server-assigned) and no inventory_unit_id (Phase 4 RPCs).
-- customer_id only on insert: later changes go through transfer_bike_ownership.
grant insert (
  id, customer_id, brand, model, variant, frame_size, colour, serial_number, description, internal_notes
) on table public.bikes to authenticated;
grant update (
  brand, model, variant, frame_size, colour, serial_number, description, internal_notes, archived_at
) on table public.bikes to authenticated;
grant select on table public.bike_ownership_events to authenticated;
-- Ownership events are written by the trigger only.

grant select on table public.bikes to service_role;
grant select on table public.bike_ownership_events to service_role;

create policy bikes_select_staff on public.bikes
  for select to authenticated
  using ((select private.is_staff()));

create policy bikes_insert_staff on public.bikes
  for insert to authenticated
  with check ((select private.is_staff()));

create policy bikes_update_staff on public.bikes
  for update to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

create policy bike_ownership_events_select_staff on public.bike_ownership_events
  for select to authenticated
  using ((select private.is_staff()));
