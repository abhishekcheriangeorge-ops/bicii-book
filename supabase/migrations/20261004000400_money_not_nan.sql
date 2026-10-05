-- Money and rates never hold NaN (DATA-MODEL.md conventions).
--
-- Postgres `numeric` accepts 'NaN' even with a typmod, and PostgREST passes
-- the JSON string "NaN" straight through to a numeric RPC argument. NaN
-- then spreads through every sum and product (`qty * price`, yield,
-- `greatest(yield, 0) * rate`), and because Postgres sorts NaN above every
-- number it also satisfies range checks such as `amount > 0` or
-- `rate between 0 and 1`. So the domains reject it at the type: every money
-- column and every rate column is safe without each RPC remembering to.
-- NULL still passes (nullable columns decide that themselves).
--
-- A meta test (tests/db/meta.test.ts) requires every numeric column of a
-- table in the app schemas to use a domain, and every numeric domain to
-- carry such a check.

alter domain public.money_amount
  add constraint money_amount_not_nan check (value <> 'NaN'::numeric);

-- Rates (Cult Commons and any later percentage) are fractions with four
-- decimals: 0.3000 = 30%. Range checks (0..1) belong to the tables that
-- use the domain; the domain only guarantees a real number.
create domain public.rate_fraction as numeric(5, 4)
  constraint rate_fraction_not_nan check (value <> 'NaN'::numeric);
comment on domain public.rate_fraction is
  'A rate as a fraction (0.3000 = 30%). Never NaN; tables add their own range checks.';
