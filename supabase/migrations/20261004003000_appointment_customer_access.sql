-- Customers and their own appointments: the contract the public site
-- (Phase 11) consumes (SPEC §4, §4.2, §6 "Customer signs in -> chooses
-- appointment type -> chooses available slot -> books", §23; DATA-MODEL.md
-- §15 "Customer access pattern", §16; PLAN D8, D12, D37, D42).
--
-- Rules encoded here (the customer access pattern, binding):
--   * The caller is always private.require_customer() /
--     private.current_customer_id(); no RPC accepts a customer id.
--     EXECUTE for authenticated only; anonymous visitors read only
--     public_appointment_types, public_shop_hours and available_slots.
--   * What a customer sees of an appointment (D42) is exactly
--     public.my_appointment: type name, times, status, their bike (short ID
--     and brand + model) only while it is still theirs and not archived
--     (D12; otherwise all three bike fields are NULL), their own note,
--     cancelled_at, cancelled_via (a channel, never a person) and whether
--     they may cancel online. Never internal_note, cancellation_reason,
--     capacity units, source or who acted (D8). One private projection
--     serves the three RPCs so the rule cannot drift.
--   * Booking and cancelling follow D37 (final; Phase 11 defines no rules
--     of its own): book_my_appointment goes through the shared booking core
--     with source = 'customer' (active public types, notice, horizon, the
--     per-customer limit under the per-customer lock, hours, closures,
--     capacity); a customer may cancel their own booked or confirmed
--     appointment, whoever booked it, until customer_cancel_cutoff_minutes
--     before its start (after that they contact the shop).
--   * Someone else's appointment id returns NULL (no error, nothing
--     revealed).
--   * Reschedule = cancel + rebook (no reschedule RPC); no notifications in
--     the MVP.

create type public.my_appointment as (
  id uuid,
  appointment_type_id uuid,
  appointment_type_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.appointment_status,
  bike_id uuid,
  bike_short_id text,
  bike_title text,
  customer_note text,
  cancelled_at timestamptz,
  cancelled_via public.appointment_source,
  created_at timestamptz,
  can_cancel boolean
);

comment on type public.my_appointment is
  'D42: what a customer sees of their own appointment. Bike fields only while the bike is still theirs and not archived (D12). Never internal notes, the cancellation reason, units, source or actors (D8).';

-- The single customer projection (D42, D12). Called by the my_* RPCs, as the
-- owner, with the caller's identity still in auth.uid().
create function private.project_my_appointment(appt public.appointments)
returns public.my_appointment
language sql
stable
security definer
set search_path = ''
as $$
  select row(
    appt.id,
    appt.appointment_type_id,
    t.name,
    appt.starts_at,
    appt.ends_at,
    appt.status,
    b.id,
    b.short_id,
    case when b.id is not null then b.brand || ' ' || b.model end,
    appt.customer_note,
    appt.cancelled_at,
    appt.cancelled_via,
    appt.created_at,
    appt.status in ('booked', 'confirmed')
      and pg_catalog.now() < appt.starts_at - pg_catalog.make_interval(mins => s.customer_cancel_cutoff_minutes)
  )::public.my_appointment
  from public.appointment_types t
  cross join public.shop_settings s
  left join public.bikes b
    on b.id = appt.bike_id
   and b.customer_id = private.current_customer_id()
   and b.archived_at is null
  where t.id = appt.appointment_type_id
    and s.id = 1;
$$;

-- The caller's appointments. include_past = false: those not yet over
-- (ends_at > now()), soonest first. true: all of them, upcoming first
-- (soonest first), then past ones (latest first). Nothing for non-customers.
create function public.my_appointments(include_past boolean default false)
returns setof public.my_appointment
language sql
stable
security definer
set search_path = ''
as $$
  select p.*
  from public.appointments a
  cross join lateral private.project_my_appointment(a) p
  where a.customer_id = private.current_customer_id()
    and (coalesce(my_appointments.include_past, false) or a.ends_at > pg_catalog.now())
  order by (a.ends_at > pg_catalog.now()) desc,
           case when a.ends_at > pg_catalog.now() then a.starts_at end asc,
           a.starts_at desc,
           a.id;
$$;

comment on function public.my_appointments(boolean) is
  'Signed-in customer: their own appointments (D42), upcoming first; include_past adds the past ones, latest first.';

-- The caller books for themselves (source = customer; D37). A bike that is
-- not theirs is appointment_bike_not_owned, with nothing about the bike.
create function public.book_my_appointment(
  appointment_id uuid,
  appointment_type_id uuid,
  starts_at timestamptz,
  bike_id uuid default null,
  customer_note text default null
)
returns public.my_appointment
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_customer();
  booked public.appointments;
begin
  booked := private.book_appointment_core(
    book_my_appointment.appointment_id, me, book_my_appointment.appointment_type_id,
    book_my_appointment.starts_at, book_my_appointment.bike_id, book_my_appointment.customer_note,
    null, 'customer');
  return private.project_my_appointment(booked);
end;
$$;

comment on function public.book_my_appointment(uuid, uuid, timestamptz, uuid, text) is
  'Signed-in customer: book for themselves under a client-made id (replay-safe), D37 rules; returns their projection (D42).';

-- The caller cancels their own booked or confirmed appointment (whoever
-- booked it) until customer_cancel_cutoff_minutes before it starts (D37).
-- Someone else's or an unknown id: NULL. Already cancelled: returned, no
-- event. The reason is optional ('Cancelled by the customer').
create function public.cancel_my_appointment(appointment_id uuid, reason text default null)
returns public.my_appointment
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_customer();
  cleaned text := nullif(pg_catalog.btrim(coalesce(cancel_my_appointment.reason, '')), '');
  cutoff integer;
  appt public.appointments;
  result public.appointments;
begin
  if cleaned is not null and pg_catalog.char_length(cleaned) > 500 then
    raise exception using
      errcode = 'P0001',
      message = 'reason_too_long',
      detail = 'Keep the reason under 500 characters.';
  end if;

  select s.customer_cancel_cutoff_minutes into cutoff from public.shop_settings s where s.id = 1 for share;
  select a.* into appt
  from public.appointments a
  where a.id = cancel_my_appointment.appointment_id
    and a.customer_id = me
  for update;
  if appt.id is null then
    return null;
  end if;
  if appt.status = 'cancelled' then
    return private.project_my_appointment(appt);
  end if;
  if appt.status not in ('booked', 'confirmed')
     or pg_catalog.now() >= appt.starts_at - pg_catalog.make_interval(mins => cutoff) then
    raise exception using
      errcode = 'P0001',
      message = 'appointment_not_cancellable',
      detail = 'This appointment can no longer be cancelled online; contact the shop.';
  end if;

  perform private.set_change_reason(coalesce(cleaned, 'Cancelled by the customer'));
  update public.appointments a
  set status = 'cancelled', cancelled_via = 'customer'
  where a.id = appt.id
  returning a.* into result;
  perform private.set_change_reason(null);
  return private.project_my_appointment(result);
end;
$$;

comment on function public.cancel_my_appointment(uuid, text) is
  'Signed-in customer: cancel their own booked/confirmed appointment before the cutoff (D37); NULL for anyone else''s.';

revoke all on function private.project_my_appointment(public.appointments)
  from public, anon, authenticated, service_role;

revoke all on function
  public.my_appointments(boolean),
  public.book_my_appointment(uuid, uuid, timestamptz, uuid, text),
  public.cancel_my_appointment(uuid, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.my_appointments(boolean),
  public.book_my_appointment(uuid, uuid, timestamptz, uuid, text),
  public.cancel_my_appointment(uuid, text)
to authenticated;
