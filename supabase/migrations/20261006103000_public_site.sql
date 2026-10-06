-- The public site's backend additions (Phase 11; PLAN D120-D125, ADR-023;
-- DATA-MODEL.md §2, §3, §15, §16). The public site (repo bicii) is a second
-- client of this database: it reads and writes only through the my_*
-- RPCs, the anonymous projections and the objects below, and holds no
-- business rule of its own (SPEC §18).
--
-- Rules encoded here:
--   * claim_my_customer (D121, D122): a signed-in login with a confirmed
--     email is linked to the ONE non-archived customers row with the same
--     email (case-insensitive) and no login yet. Several such rows: nothing
--     is linked (P0001 customer_link_ambiguous; staff resolve it). None: no
--     row is made unless the caller asks for one (create_if_missing, the
--     first booking) and gives a first name. A login already linked keeps
--     its row whatever either email says now; an archived row is never
--     linked or reopened (customer_archived). Linking never overwrites what
--     staff recorded. Concurrent claims for one address serialise on an
--     advisory lock, so two calls cannot create two rows.
--   * bookable_slots (D123): the bookable starts of up to 31 shop days for
--     one type, by calling private.available_slots_at for each day with the
--     caller's staff flag, exactly as available_slots does for one day
--     (D37's notice, horizon and type rules stay there). Everyone may call
--     it, as available_slots (D37: the public site must not revoke anon).
--   * Customer photos (D124): a signed-in customer may SELECT the
--     media-internal objects behind exactly the attachments
--     my_bike_attachments and my_work_order_attachments return to them, so
--     their own session can mint short-lived signed URLs. Nothing else in
--     the bucket, never a listing of it, never consignment or product
--     photos, and anonymous callers nothing.

-- ---------------------------------------------------------------------------
-- claim_my_customer
-- ---------------------------------------------------------------------------
create function public.claim_my_customer(
  create_if_missing boolean default false,
  first_name text default null,
  last_name text default null,
  phone text default null
)
returns setof public.customer_profile
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  login_email text;
  confirmed_at timestamptz;
  linked public.customers;
  candidates uuid[];
  clean_first text := nullif(pg_catalog.btrim(coalesce(claim_my_customer.first_name, '')), '');
  clean_last text := nullif(pg_catalog.btrim(coalesce(claim_my_customer.last_name, '')), '');
  clean_phone text := nullif(pg_catalog.btrim(coalesce(claim_my_customer.phone, '')), '');
  result_id uuid;
begin
  if me is null then
    raise exception 'sign-in required' using errcode = '42501';
  end if;

  select u.email::text, u.email_confirmed_at
  into login_email, confirmed_at
  from auth.users u
  where u.id = me;
  if login_email is null or confirmed_at is null then
    raise exception using
      errcode = 'P0001',
      message = 'customer_email_unconfirmed',
      detail = 'Only a login whose email address has been confirmed with a code can claim a customer record.';
  end if;

  -- One claim per address at a time: a second call waits, then sees the
  -- first one's link or row.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bicii.customers.claim.' || pg_catalog.lower(login_email), 0)
  );

  select c.* into linked
  from public.customers c
  where c.auth_user_id = me
  for update;
  if linked.id is not null then
    if linked.archived_at is not null then
      raise exception using
        errcode = 'P0001',
        message = 'customer_archived',
        detail = 'This login belongs to an archived customer record; the shop reopens it.';
    end if;
    return query
      select c.id, c.first_name, c.last_name, c.display_name, c.email::text, c.phone, c.created_at
      from public.customers c
      where c.id = linked.id;
    return;
  end if;

  select coalesce(pg_catalog.array_agg(m.id order by m.id), '{}')
  into candidates
  from (
    select c.id
    from public.customers c
    -- citext's own operator: with an empty search_path a bare `=` would
    -- compare as text, case-sensitively.
    where c.email operator(extensions.=) login_email::extensions.citext
      and c.auth_user_id is null
      and c.archived_at is null
    for update
  ) m;

  if pg_catalog.cardinality(candidates) > 1 then
    raise exception using
      errcode = 'P0001',
      message = 'customer_link_ambiguous',
      detail = 'More than one customer record has this email address; the shop links the right one.';
  end if;

  if pg_catalog.cardinality(candidates) = 1 then
    update public.customers c
    set auth_user_id = me
    where c.id = candidates[1]
    returning c.id into result_id;
  elsif claim_my_customer.create_if_missing then
    if clean_first is null then
      raise exception using
        errcode = 'P0001',
        message = 'customer_name_required',
        detail = 'A first name is needed to create a customer record.';
    end if;
    if pg_catalog.char_length(clean_first) > 100
       or pg_catalog.char_length(coalesce(clean_last, '')) > 100 then
      raise exception using
        errcode = 'P0001',
        message = 'customer_name_too_long',
        detail = 'First and last names are at most 100 characters each.';
    end if;
    if pg_catalog.char_length(coalesce(clean_phone, '')) > 40 then
      raise exception using
        errcode = 'P0001',
        message = 'customer_phone_too_long',
        detail = 'A phone number is at most 40 characters.';
    end if;
    insert into public.customers (auth_user_id, first_name, last_name, email, phone)
    values (me, clean_first, clean_last, login_email, clean_phone)
    returning id into result_id;
  else
    return;
  end if;

  return query
    select c.id, c.first_name, c.last_name, c.display_name, c.email::text, c.phone, c.created_at
    from public.customers c
    where c.id = result_id;
end;
$$;
comment on function public.claim_my_customer(boolean, text, text, text) is
  'Signed-in login: link to the one unlinked customer record with its confirmed email, or create one (create_if_missing, first booking); returns the customer-safe profile or nothing (D121, D122).';

-- ---------------------------------------------------------------------------
-- bookable_slots
-- ---------------------------------------------------------------------------
create function public.bookable_slots(from_day date, to_day date, appointment_type_id uuid)
returns table (slot_day date, slot_start timestamptz, slot_end timestamptz)
language plpgsql
stable
security definer
set search_path = ''
set jit = off
as $$
declare
  staff boolean := private.is_staff();
  as_of timestamptz := pg_catalog.now();
begin
  if bookable_slots.from_day is null
     or bookable_slots.to_day is null
     or bookable_slots.appointment_type_id is null then
    raise exception 'from_day, to_day and appointment_type_id are required' using errcode = '22004';
  end if;
  if bookable_slots.to_day < bookable_slots.from_day then
    raise exception using
      errcode = 'P0001',
      message = 'slot_range_invalid',
      detail = 'to_day is before from_day.';
  end if;
  if bookable_slots.to_day - bookable_slots.from_day > 30 then
    raise exception using
      errcode = 'P0001',
      message = 'slot_range_too_long',
      detail = 'Ask for at most 31 days at a time.';
  end if;
  return query
    select d.day, s.slot_start, s.slot_end
    from (
      select (bookable_slots.from_day + g.i) as day
      from pg_catalog.generate_series(0, bookable_slots.to_day - bookable_slots.from_day) as g(i)
    ) d
    cross join lateral private.available_slots_at(d.day, bookable_slots.appointment_type_id, as_of, staff) s
    order by s.slot_start;
end;
$$;
comment on function public.bookable_slots(date, date, uuid) is
  'Everyone: bookable starts for one type over up to 31 shop days (D123); the same rules as available_slots (D37, D38).';

-- ---------------------------------------------------------------------------
-- Customer photos in media-internal
-- ---------------------------------------------------------------------------

-- True when the caller is a customer and `object_name` in media-internal is
-- the file of a customer- or public-visible photo of one of their current,
-- non-archived bikes (D12, as my_bike_attachments) or of one of their jobs
-- that is not cancelled (D17, D19, as my_work_order_attachments).
create function private.customer_can_read_media(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.attachments a
    where a.storage_bucket = 'media-internal'
      and a.storage_path = customer_can_read_media.object_name
      and a.visibility in ('customer', 'public')
      and (
        (a.entity_type = 'bike' and exists (
          select 1 from public.bikes b
          where b.id = a.entity_id
            and b.customer_id = private.current_customer_id()
            and b.archived_at is null
        ))
        or (a.entity_type = 'work_order' and exists (
          select 1 from public.work_orders w
          where w.id = a.entity_id
            and w.customer_id = private.current_customer_id()
            and w.status <> 'cancelled'
        ))
      )
  );
$$;
comment on function private.customer_can_read_media(text) is
  'Storage policy predicate: the caller''s own customer-visible bike and job photos in media-internal (D124).';

create policy media_internal_select_customer on storage.objects
  for select to authenticated
  using (bucket_id = 'media-internal' and private.customer_can_read_media(name));

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function
  public.claim_my_customer(boolean, text, text, text),
  public.bookable_slots(date, date, uuid),
  private.customer_can_read_media(text)
from public, anon, authenticated, service_role;

grant execute on function public.claim_my_customer(boolean, text, text, text) to authenticated;
grant execute on function public.bookable_slots(date, date, uuid) to anon, authenticated;
-- A storage policy runs as the caller.
grant execute on function private.customer_can_read_media(text) to authenticated;
