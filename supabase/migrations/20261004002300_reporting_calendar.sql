-- The shop-day calendar and the shop currency (SPEC §19, §24 "Store
-- timestamps with timezone; display in Singapore local time by default";
-- DATA-MODEL.md §14; PLAN D35 SHOP-TZ).
--
-- Rules encoded here:
--   * Every shop-day computation in SQL goes through private.shop_day(),
--     private.shop_today() or private.shop_day_start(): never current_date
--     and never `ts::date` without `at time zone`, because the UTC (or the
--     session's) date is wrong for eight hours of every Singapore day.
--   * The shop's time zone is Asia/Singapore and its currency SGD until
--     Phase 2 adds shop_settings. Phase 2 replaces the bodies of
--     private.shop_timezone() and private.shop_currency() (create or
--     replace, same signatures) to read shop_settings.timezone and
--     shop_settings.default_currency with these values as fallbacks.
--     Phases 7 and 9 call these functions and create no alternatives.
--   * Singapore has had no daylight saving since 1982, so a shop day is
--     always exactly 24 hours (private.shop_day_start(d + 1) -
--     private.shop_day_start(d) = 24 h).
--   * The TypeScript mirror is SHOP_TIME_ZONE / shopDateKey in
--     src/lib/dates.ts; the app lets the database decide which day is today.
--
-- All are `stable` (not immutable), because Phase 2's bodies read a table.
-- None of these is security definer: only definer RPCs and views owned by
-- the migration owner call them, so no API role holds EXECUTE.

-- D35: the shop's IANA time zone.
create function private.shop_timezone()
returns text
language sql
stable
set search_path = ''
as $$
  select 'Asia/Singapore'::text;
$$;

comment on function private.shop_timezone() is
  'D35 SHOP-TZ: the shop time zone. Phase 2 replaces the body (same signature) to read shop_settings.timezone with this fallback.';

-- D35: the shop's currency; totals sum this currency only.
create function private.shop_currency()
returns text
language sql
stable
set search_path = ''
as $$
  select 'SGD'::text;
$$;

comment on function private.shop_currency() is
  'D35 SHOP-TZ: the shop currency (report totals sum this currency only). Phase 2 replaces the body (same signature) to read shop_settings.default_currency with this fallback.';

-- D35: the shop day an instant falls on. Null in, null out.
create function private.shop_day("at" timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select (shop_day."at" at time zone private.shop_timezone())::date;
$$;

comment on function private.shop_day(timestamptz) is
  'D35 SHOP-TZ: the shop-local calendar day of an instant (null in, null out).';

-- D35: today in the shop.
create function private.shop_today()
returns date
language sql
stable
set search_path = ''
as $$
  select private.shop_day(pg_catalog.now());
$$;

comment on function private.shop_today() is
  'D35 SHOP-TZ: today''s shop-local calendar day (the transaction''s now()).';

-- D35: the instant a shop day starts (shop-local midnight).
create function private.shop_day_start(day date)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (shop_day_start.day::timestamp at time zone private.shop_timezone());
$$;

comment on function private.shop_day_start(date) is
  'D35 SHOP-TZ: the instant a shop day starts (shop-local midnight).';

revoke all on function
  private.shop_timezone(),
  private.shop_currency(),
  private.shop_day(timestamptz),
  private.shop_today(),
  private.shop_day_start(date)
from public, anon, authenticated, service_role;
