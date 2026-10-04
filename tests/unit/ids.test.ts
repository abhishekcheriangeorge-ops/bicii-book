import { describe, expect, it } from "vitest";
import {
  formatShortId,
  isShortId,
  parseScan,
  parseShortId,
  qrPayload,
  SHORT_ID_KINDS,
} from "@/lib/ids";

describe("formatShortId", () => {
  it("zero-pads to six digits", () => {
    expect(formatShortId("J", 456)).toBe("J-000456");
    expect(formatShortId("PO", 34)).toBe("PO-000034");
    expect(formatShortId("B", 999999)).toBe("B-999999");
  });

  it("rejects values that do not fit the format", () => {
    expect(() => formatShortId("J", 0)).toThrow(RangeError);
    expect(() => formatShortId("J", 1_000_000)).toThrow(RangeError);
    expect(() => formatShortId("J", 1.5)).toThrow(RangeError);
  });
});

describe("parseShortId", () => {
  it("maps every prefix to its kind", () => {
    const expected = {
      B: "bike",
      J: "work_order",
      P: "product",
      U: "inventory_unit",
      C: "consignment_item",
      PO: "purchase_order",
      S: "sale",
    };
    expect(SHORT_ID_KINDS).toEqual(expected);
    for (const [prefix, kind] of Object.entries(expected)) {
      expect(parseShortId(`${prefix}-000123`)).toEqual({ kind, shortId: `${prefix}-000123` });
    }
  });

  it("distinguishes PO- from P-", () => {
    expect(parseShortId("PO-000001")?.kind).toBe("purchase_order");
    expect(parseShortId("P-000001")?.kind).toBe("product");
  });

  it("normalises case and whitespace", () => {
    expect(parseShortId("  j-000456 ")).toEqual({ kind: "work_order", shortId: "J-000456" });
  });

  it("rejects malformed IDs", () => {
    for (const bad of ["J-45", "J-0004567", "J000456", "X-000456", "J-00045a", "", "PO000001"]) {
      expect(parseShortId(bad), bad).toBeNull();
      expect(isShortId(bad)).toBe(false);
    }
  });
});

describe("qrPayload", () => {
  it("is exactly {base}/q/{shortId}", () => {
    expect(qrPayload("https://bicii.sg", "U-000012")).toBe("https://bicii.sg/q/U-000012");
    expect(qrPayload("https://bicii.sg/", "u-000012")).toBe("https://bicii.sg/q/U-000012");
  });

  it("refuses to encode a non-ID", () => {
    expect(() => qrPayload("https://bicii.sg", "hello")).toThrow(RangeError);
  });
});

describe("parseScan", () => {
  it("accepts a bare short ID", () => {
    expect(parseScan("B-000123")).toEqual({ kind: "bike", shortId: "B-000123" });
  });

  it("accepts a full QR URL", () => {
    expect(parseScan("https://bicii.sg/q/P-000789")).toEqual({
      kind: "product",
      shortId: "P-000789",
    });
    expect(parseScan("https://bicii.sg/q/P-000789/")).toEqual({
      kind: "product",
      shortId: "P-000789",
    });
    expect(parseScan("  http://localhost:3000/q/c-000056\n")).toEqual({
      kind: "consignment_item",
      shortId: "C-000056",
    });
  });

  it("round-trips what qrPayload produces", () => {
    const url = qrPayload("https://bicii.vercel.app", "PO-000034");
    expect(parseScan(url)).toEqual({ kind: "purchase_order", shortId: "PO-000034" });
  });

  it("restricts URLs to the configured base when given", () => {
    const base = "https://bicii.sg";
    expect(parseScan("https://bicii.sg/q/J-000001", { base })?.shortId).toBe("J-000001");
    expect(parseScan("https://evil.example/q/J-000001", { base })).toBeNull();
    expect(parseScan("J-000001", { base })?.shortId).toBe("J-000001");
  });

  it("supports a base with a path prefix", () => {
    const base = "https://example.com/shop/";
    expect(parseScan("https://example.com/shop/q/U-000002", { base })?.shortId).toBe("U-000002");
    expect(parseScan("https://example.com/q/U-000002", { base })).toBeNull();
  });

  it("rejects anything else", () => {
    for (const bad of [
      "",
      "hello",
      "https://bicii.sg/products/P-000789",
      "https://bicii.sg/q/",
      "https://bicii.sg/q/P-789",
      "https://bicii.sg/q/P-000789/extra",
      "ftp://bicii.sg/q/P-000789",
      "javascript:alert(1)//q/P-000789",
      "https://bicii.sg/q/%E0%A4%A",
    ]) {
      expect(parseScan(bad), bad).toBeNull();
    }
  });
});
