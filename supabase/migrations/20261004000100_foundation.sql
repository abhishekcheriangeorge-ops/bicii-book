-- Foundation: extensions, schemas, money domain, shared trigger function,
-- human short IDs and request correlation (DATA-MODEL.md conventions, §17;
-- ADR-001 A8).
--
-- Privilege convention for every migration in this repo: never rely on
-- Supabase's default privileges. Hosted Supabase grants ALL on new objects in
-- `public` to anon/authenticated/service_role; plain Postgres grants EXECUTE
-- on every new function to PUBLIC. Each object therefore gets an explicit
-- `revoke all ... from public, anon, authenticated, service_role` followed by
-- exactly the grants it needs, so behaviour is identical everywhere.

-- ---------------------------------------------------------------------------
-- Extensions live in `extensions`, as on hosted Supabase. Always reference
-- their objects schema-qualified (extensions.crypt, extensions.citext, ...).
-- ---------------------------------------------------------------------------
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- New functions created by this role are not executable by PUBLIC unless a
-- migration grants it. (Global default: per-schema defaults cannot revoke.)
alter default privileges revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- Schemas.
--   public    tables, RPCs and views exposed through the Data API.
--   private   security-definer helpers; never in the API's exposed schemas.
--             Nothing in it is granted by default. RLS policy expressions run
--             as the caller, so the staff migration grants `authenticated`
--             USAGE plus EXECUTE on the handful of predicate helpers that
--             policies call — and nothing else.
--   reporting views only (DATA-MODEL §14); grants per view.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

create schema if not exists reporting;
revoke all on schema reporting from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Money: every amount is numeric(12,2). Never real/double precision (a meta
-- test enforces this for every column whose name looks like money).
-- ---------------------------------------------------------------------------
create domain public.money_amount as numeric(12, 2);
comment on domain public.money_amount is
  'Money in the row''s currency (default SGD). Authoritative arithmetic happens in Postgres.';

-- ---------------------------------------------------------------------------
-- updated_at maintenance. Not an audit log: auditable facts get their own
-- event or ledger rows.
-- ---------------------------------------------------------------------------
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.set_updated_at() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Human short IDs (DATA-MODEL §17, PLAN D9): prefix + '-' + six digits.
-- One sequence per prefix; never reset, never reused. maxvalue 999999 and
-- no cycle, so exhaustion raises instead of silently truncating or wrapping.
-- ---------------------------------------------------------------------------
create sequence private.seq_short_id_b minvalue 1 maxvalue 999999 no cycle;
create sequence private.seq_short_id_j minvalue 1 maxvalue 999999 no cycle;
create sequence private.seq_short_id_p minvalue 1 maxvalue 999999 no cycle;
create sequence private.seq_short_id_u minvalue 1 maxvalue 999999 no cycle;
create sequence private.seq_short_id_c minvalue 1 maxvalue 999999 no cycle;
create sequence private.seq_short_id_po minvalue 1 maxvalue 999999 no cycle;
create sequence private.seq_short_id_s minvalue 1 maxvalue 999999 no cycle;

revoke all on sequence
  private.seq_short_id_b, private.seq_short_id_j, private.seq_short_id_p,
  private.seq_short_id_u, private.seq_short_id_c, private.seq_short_id_po,
  private.seq_short_id_s
from public, anon, authenticated, service_role;

-- Called only from security-definer RPCs (which run as the owner), so no
-- role is granted EXECUTE.
create function private.next_short_id(prefix text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n bigint;
begin
  case prefix
    when 'B' then n := nextval('private.seq_short_id_b');
    when 'J' then n := nextval('private.seq_short_id_j');
    when 'P' then n := nextval('private.seq_short_id_p');
    when 'U' then n := nextval('private.seq_short_id_u');
    when 'C' then n := nextval('private.seq_short_id_c');
    when 'PO' then n := nextval('private.seq_short_id_po');
    when 'S' then n := nextval('private.seq_short_id_s');
    else
      raise exception 'unknown short id prefix: %', coalesce(prefix, '(null)')
        using errcode = '22023';
  end case;
  return prefix || '-' || pg_catalog.lpad(n::text, 6, '0');
end;
$$;
revoke all on function private.next_short_id(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Request correlation (ADR-001 A8). RPCs call set_correlation_id() first with
-- the x-request-id the DAL passes in; event and integration rows read it back
-- with current_correlation_id(). Transaction-local.
-- ---------------------------------------------------------------------------
create function private.set_correlation_id(correlation_id text)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_catalog.set_config('app.correlation_id', coalesce(correlation_id, ''), true);
$$;
revoke all on function private.set_correlation_id(text) from public, anon, authenticated, service_role;

create function private.current_correlation_id()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(pg_catalog.current_setting('app.correlation_id', true), '');
$$;
revoke all on function private.current_correlation_id() from public, anon, authenticated, service_role;
