import DecimalBase from "decimal.js";

/**
 * Money helpers for display and previews.
 *
 * Authoritative arithmetic lives in Postgres (`money_amount` = numeric(12,2),
 * generated columns, views); see AGENTS.md and DATA-MODEL.md. This module
 * parses what staff type, formats what the database returns, and does preview
 * arithmetic (a running total before the RPC answers) in decimal, never in
 * binary floating point.
 *
 * Rounding is ROUND_HALF_UP (ties away from zero), matching Postgres
 * `round(numeric)` so a preview and the stored value agree.
 */
export const Decimal = DecimalBase.clone({
  precision: 40,
  rounding: DecimalBase.ROUND_HALF_UP,
  toExpNeg: -40,
  toExpPos: 40,
});
export type Decimal = InstanceType<typeof Decimal>;

export const DEFAULT_CURRENCY = "SGD";
export const DEFAULT_LOCALE = "en-SG";

/** ISO 4217 code, upper case, three letters. */
export type CurrencyCode = string;

/** Values accepted wherever an amount is read: DB strings, decimals, safe numbers. */
export type MoneyInput = string | number | Decimal;

const formatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(
  currency: CurrencyCode,
  locale: string,
  signDisplay?: "auto" | "always" | "exceptZero",
): Intl.NumberFormat {
  const key = `${locale}|${currency}|${signDisplay ?? "auto"}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      signDisplay: signDisplay ?? "auto",
    });
    formatters.set(key, f);
  }
  return f;
}

/** Number of minor-unit digits for a currency (2 for SGD, 0 for JPY). */
export function minorDigits(currency: CurrencyCode = DEFAULT_CURRENCY): number {
  return (
    currencyFormatter(normaliseCurrency(currency), DEFAULT_LOCALE).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

function normaliseCurrency(currency: CurrencyCode): CurrencyCode {
  const code = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new RangeError(`Invalid currency code: "${currency}"`);
  }
  return code;
}

/**
 * Converts a stored or computed amount to a Decimal. Numbers are accepted only
 * when finite and are read through their shortest string form, so `0.1`
 * becomes exactly 0.1, not 0.1000000000000000055511151231257827.
 */
export function toDecimal(value: MoneyInput): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RangeError(`Not a finite amount: ${value}`);
    return new Decimal(String(value));
  }
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new RangeError(`Not a decimal amount: "${value}"`);
  }
  return new Decimal(trimmed);
}

const prefixCache = new Map<string, string[]>();

/** Upper-cased code and symbols a person might type before an amount. */
function currencyPrefixes(currency: CurrencyCode): string[] {
  let prefixes = prefixCache.get(currency);
  if (!prefixes) {
    const symbols = new Set<string>([currency]);
    for (const currencyDisplay of ["symbol", "narrowSymbol"] as const) {
      const part = new Intl.NumberFormat(DEFAULT_LOCALE, {
        style: "currency",
        currency,
        currencyDisplay,
      })
        .formatToParts(1)
        .find((p) => p.type === "currency");
      if (part) symbols.add(part.value.toUpperCase());
    }
    // Singapore convention, not produced by Intl for en-SG
    if (currency === "SGD") symbols.add("S$");
    // Longest first so "S$" wins over "$"
    prefixes = [...symbols].sort((a, b) => b.length - a.length);
    prefixCache.set(currency, prefixes);
  }
  return prefixes;
}

export type ParseMoneyOptions = {
  currency?: CurrencyCode;
  /** Allow a leading minus sign (refunds, adjustments). Default false. */
  allowNegative?: boolean;
};

/**
 * Parses what a person typed into a money field. Accepts grouping commas,
 * surrounding whitespace and a leading currency symbol (`$`, `S$`, `SGD`).
 * Returns null for anything that is not an amount, and for more decimal
 * places than the currency has: 12.345 SGD is rejected rather than silently
 * rounded, because the person meant something specific.
 */
export function parseMoney(input: string, options: ParseMoneyOptions = {}): Decimal | null {
  const currency = normaliseCurrency(options.currency ?? DEFAULT_CURRENCY);
  let s = input.trim().replace(/[\s  ]/g, "");
  if (s === "") return null;

  let negative = false;
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  // Strip a leading code or symbol that belongs to this currency only:
  // "SGD 12", "S$12" and "$12" in an SGD field, but not "US$12".
  const prefix = currencyPrefixes(currency).find((p) => s.toUpperCase().startsWith(p));
  if (prefix) s = s.slice(prefix.length);
  if (s.startsWith("-")) {
    if (negative) return null;
    negative = true;
    s = s.slice(1);
  }
  if (negative && !options.allowNegative) return null;

  // Grouping commas only in valid positions (1,234,567.89); bare digits too.
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d*)?$/.test(s) && !/^\.\d+$/.test(s)) return null;
  s = s.replace(/,/g, "");
  if (s.endsWith(".")) s = s.slice(0, -1);
  if (s.startsWith(".")) s = `0${s}`;

  const fraction = s.split(".")[1] ?? "";
  if (fraction.length > minorDigits(currency)) return null;

  const value = new Decimal(s);
  return negative ? value.negated() : value;
}

/** Rounds to the currency's minor unit, ties away from zero (as Postgres). */
export function roundMoney(value: MoneyInput, currency: CurrencyCode = DEFAULT_CURRENCY): Decimal {
  return toDecimal(value).toDecimalPlaces(minorDigits(currency), Decimal.ROUND_HALF_UP);
}

export type FormatMoneyOptions = {
  locale?: string;
  /** "always" shows +/− (adjustment deltas); "exceptZero" hides the sign on 0. */
  signDisplay?: "auto" | "always" | "exceptZero";
};

/**
 * Formats an amount for display: `formatMoney("1234.5")` → "$1,234.50".
 * The currency is explicit (default SGD) because rows carry their own
 * `currency` column; pass it through rather than assuming.
 */
export function formatMoney(
  value: MoneyInput,
  currency: CurrencyCode = DEFAULT_CURRENCY,
  options: FormatMoneyOptions = {},
): string {
  const code = normaliseCurrency(currency);
  const fixed = roundMoney(value, code).toFixed(minorDigits(code));
  // Intl formats decimal strings exactly (ES2023 NumberFormat v3), so the
  // amount never passes through a float on its way to the screen.
  return currencyFormatter(code, options.locale ?? DEFAULT_LOCALE, options.signDisplay).format(
    fixed as `${number}`,
  );
}

/** Sum for previews (running totals before the database confirms). */
export function sumMoney(values: readonly MoneyInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(toDecimal(v)), new Decimal(0));
}

/** quantity × unit price, rounded to the currency's minor unit. */
export function lineTotal(
  quantity: MoneyInput,
  unitPrice: MoneyInput,
  currency: CurrencyCode = DEFAULT_CURRENCY,
): Decimal {
  return roundMoney(toDecimal(quantity).times(toDecimal(unitPrice)), currency);
}

/** Serialises for an RPC argument or form value: plain fixed-point string. */
export function toMoneyString(
  value: MoneyInput,
  currency: CurrencyCode = DEFAULT_CURRENCY,
): string {
  return roundMoney(value, currency).toFixed(minorDigits(currency));
}

/** A quantity for display, without trailing zeros: "2", "1.5", "0.25". */
export function formatQuantity(value: MoneyInput): string {
  return toDecimal(value).toFixed();
}
