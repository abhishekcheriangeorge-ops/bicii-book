-- The Admin's own sign-in limits on /login (PLAN D72; D70, D10).
--
-- Why: the login Server Actions call Supabase Auth from the Admin's server,
-- so Auth's per-IP limits count the server's address, one bucket shared by
-- every staff member and every visitor. The Admin therefore counts each
-- code request and each code verification itself, per client address and
-- per email, BEFORE asking Auth, and refuses past its limits
-- (src/lib/auth/sign-in-limits.ts holds the limits).
--
-- Rules encoded here:
--   * private.sign_in_attempts holds one counter per bucket and fixed
--     window. Bucket keys are opaque strings built by the app from SHA-256
--     digests of the client address and of the email: no address or email
--     is stored in clear.
--   * public.note_sign_in_attempt(buckets, window_seconds) adds one to each
--     bucket in the current window and returns the counts, atomically
--     (insert ... on conflict do update), so concurrent attempts on any
--     number of server instances are all counted. It deletes counters
--     older than a day as it goes.
--   * Only the service role may call it (the Admin's server, through
--     src/lib/admin/sign-in-throttle.ts). anon and authenticated may not:
--     a caller who could name any bucket could fill other people's.
--   * Nobody reads or writes the table directly; RLS is on with no policy.

create table private.sign_in_attempts (
  bucket text not null check (pg_catalog.char_length(bucket) between 1 and 200),
  window_start timestamptz not null,
  hits integer not null check (hits > 0),
  primary key (bucket, window_start)
);

comment on table private.sign_in_attempts is
  'Sign-in attempt counters per bucket (hashed client address or email) and fixed window (PLAN D72). Written only by public.note_sign_in_attempt.';

create index sign_in_attempts_window_start_idx on private.sign_in_attempts (window_start);

alter table private.sign_in_attempts enable row level security;

revoke all on table private.sign_in_attempts from public, anon, authenticated, service_role;

create function public.note_sign_in_attempt(buckets text[], window_seconds integer)
returns table (bucket_key text, hit_count integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_window timestamptz;
begin
  if buckets is null
     or pg_catalog.cardinality(buckets) not between 1 and 8
     or pg_catalog.array_position(buckets, null) is not null
     or exists (
       select 1 from pg_catalog.unnest(buckets) as b(key)
       where pg_catalog.char_length(b.key) not between 1 and 200
     ) then
    raise exception 'buckets must be 1 to 8 keys of 1 to 200 characters'
      using errcode = '22023';
  end if;
  if window_seconds is null or window_seconds not between 60 and 3600 then
    raise exception 'window_seconds must be between 60 and 3600'
      using errcode = '22023';
  end if;

  current_window := pg_catalog.to_timestamp(
    (pg_catalog.floor(extract(epoch from pg_catalog.now()) / window_seconds) * window_seconds)::double precision
  );

  delete from private.sign_in_attempts a
  where a.window_start < pg_catalog.now() - interval '1 day';

  return query
    insert into private.sign_in_attempts as a (bucket, window_start, hits)
    select distinct b.key, current_window, 1
    from pg_catalog.unnest(buckets) as b(key)
    on conflict (bucket, window_start) do update set hits = a.hits + 1
    returning a.bucket, a.hits;
end;
$$;

comment on function public.note_sign_in_attempt(text[], integer) is
  'Counts one sign-in attempt in each bucket for the current fixed window and returns the counts (PLAN D72). Service role only.';

revoke all on function public.note_sign_in_attempt(text[], integer) from public, anon, authenticated;
grant execute on function public.note_sign_in_attempt(text[], integer) to service_role;
