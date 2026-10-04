import { describe, expect, it } from "vitest";
import {
  Decimal,
  formatMoney,
  lineTotal,
  minorDigits,
  parseMoney,
  roundMoney,
  sumMoney,
  toDecimal,
  toMoneyString,
} from "@/lib/money";

describe("formatMoney", () => {
  it("formats SGD by default in en-SG", () => {
    expect(formatMoney("1234.5")).toBe("$1,234.50");
    expect(formatMoney("0")).toBe("$0.00");
    expect(formatMoney("-89.9")).toBe("-$89.90");
  });

  it("takes an explicit currency", () => {
    expect(formatMoney("12", "USD")).toBe("US$12.00");
    expect(formatMoney("1200", "JPY")).toBe("JP¥1,200");
  });

  it("formats large numeric(12,2) values exactly, without float drift", () => {
    expect(formatMoney("9999999999.99")).toBe("$9,999,999,999.99");
    expect(formatMoney(new Decimal("1234567890.15"))).toBe("$1,234,567,890.15");
  });

  it("rounds half away from zero, as Postgres round(numeric) does", () => {
    expect(formatMoney("2.345")).toBe("$2.35");
    expect(formatMoney("-2.345")).toBe("-$2.35");
    expect(formatMoney("2.344")).toBe("$2.34");
  });

  it("shows an explicit sign for deltas when asked", () => {
    expect(formatMoney("5", "SGD", { signDisplay: "always" })).toBe("+$5.00");
  });

  it("rejects invalid currency codes", () => {
    expect(() => formatMoney("1", "dollars")).toThrow(RangeError);
  });
});

describe("parseMoney", () => {
  it("parses plain and grouped amounts", () => {
    expect(parseMoney("12")?.toString()).toBe("12");
    expect(parseMoney(" 1,234.50 ")?.toFixed(2)).toBe("1234.50");
    expect(parseMoney(".5")?.toString()).toBe("0.5");
    expect(parseMoney("7.")?.toString()).toBe("7");
  });

  it("accepts this currency's symbol or code, not another's", () => {
    expect(parseMoney("$12.30")?.toFixed(2)).toBe("12.30");
    expect(parseMoney("S$12.30")?.toFixed(2)).toBe("12.30");
    expect(parseMoney("SGD 12.30")?.toFixed(2)).toBe("12.30");
    expect(parseMoney("US$12.30")).toBeNull();
    expect(parseMoney("US$12.30", { currency: "USD" })?.toFixed(2)).toBe("12.30");
  });

  it("rejects more decimals than the currency has instead of rounding", () => {
    expect(parseMoney("12.345")).toBeNull();
    expect(parseMoney("12.5", { currency: "JPY" })).toBeNull();
  });

  it("rejects negatives unless allowed", () => {
    expect(parseMoney("-5")).toBeNull();
    expect(parseMoney("-5", { allowNegative: true })?.toString()).toBe("-5");
    expect(parseMoney("-$5", { allowNegative: true })?.toString()).toBe("-5");
    expect(parseMoney("$-5", { allowNegative: true })?.toString()).toBe("-5");
  });

  it("rejects junk", () => {
    for (const bad of ["", "   ", "abc", "1,23", "12,34.5", "1.2.3", "1e5", "NaN", "--5", "$"]) {
      expect(parseMoney(bad, { allowNegative: true }), bad).toBeNull();
    }
  });
});

describe("decimal arithmetic for previews", () => {
  it("never uses binary floating point", () => {
    // 0.1 + 0.2 = 0.30000000000000004 in float
    expect(sumMoney(["0.1", "0.2"]).toString()).toBe("0.3");
    expect(sumMoney([0.1, 0.2]).toString()).toBe("0.3");
    expect(sumMoney([]).toString()).toBe("0");
  });

  it("computes line totals rounded to the minor unit", () => {
    expect(lineTotal("3", "19.99").toFixed(2)).toBe("59.97");
    expect(lineTotal("1.5", "33.333").toFixed(2)).toBe("50.00");
    expect(lineTotal("2", "1000", "JPY").toString()).toBe("2000");
  });

  it("serialises to a fixed-point string for RPC arguments", () => {
    expect(toMoneyString("12")).toBe("12.00");
    expect(toMoneyString(new Decimal("1e2"))).toBe("100.00");
    expect(roundMoney("0.005").toFixed(2)).toBe("0.01");
  });

  it("refuses non-finite and non-decimal inputs", () => {
    expect(() => toDecimal(Number.NaN)).toThrow(RangeError);
    expect(() => toDecimal(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => toDecimal("12abc")).toThrow(RangeError);
  });

  it("knows minor digits per currency", () => {
    expect(minorDigits()).toBe(2);
    expect(minorDigits("JPY")).toBe(0);
  });
});
