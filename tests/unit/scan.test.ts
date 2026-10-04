import { describe, expect, it } from "vitest";

import { interpretScan, truncateScan } from "@/lib/scan";

const ctx = { publicBases: ["https://bicii.sg"], adminOrigin: "https://admin.bicii.sg" };

describe("interpretScan", () => {
  it("reads a bare short ID in any case and with spaces", () => {
    expect(interpretScan("P-000123", ctx)).toEqual({ kind: "record", shortId: "P-000123" });
    expect(interpretScan("  b-000001 ", ctx)).toEqual({ kind: "record", shortId: "B-000001" });
    expect(interpretScan("po-000034", ctx)).toEqual({ kind: "record", shortId: "PO-000034" });
  });

  it("reads the public QR URL of every accepted base", () => {
    expect(interpretScan("https://bicii.sg/q/U-000001", ctx)).toEqual({
      kind: "record",
      shortId: "U-000001",
    });
    expect(interpretScan("https://bicii.sg/q/u-000001/", ctx)).toEqual({
      kind: "record",
      shortId: "U-000001",
    });
    const two = { ...ctx, publicBases: ["https://old.bicii.sg", "https://bicii.sg/shop"] };
    expect(interpretScan("https://bicii.sg/shop/q/P-000002", two)).toEqual({
      kind: "record",
      shortId: "P-000002",
    });
    expect(interpretScan("https://old.bicii.sg/q/J-000004", two).kind).toBe("record");
  });

  it("reads a /q URL on the Admin's own origin", () => {
    expect(interpretScan("https://admin.bicii.sg/q/J-000010", ctx)).toEqual({
      kind: "record",
      shortId: "J-000010",
    });
    expect(
      interpretScan("https://admin.bicii.sg/q/J-000010", { ...ctx, adminOrigin: null }),
    ).toEqual({ kind: "foreign", text: "https://admin.bicii.sg/q/J-000010" });
  });

  it("treats other hosts and other paths as foreign, even with a short ID in them", () => {
    for (const raw of [
      "https://example.com/phish",
      "https://example.com/q/P-000001",
      "https://bicii.sg.evil.com/q/P-000001",
      "http://bicii.sg/q/P-000001",
      "https://bicii.sg/products/P-000001",
      "https://bicii.sg/q/P-00001",
      "https://bicii.sg/q/X-000001",
    ]) {
      expect(interpretScan(raw, ctx), raw).toEqual({ kind: "foreign", text: raw });
    }
  });

  it("never treats javascript:, data: or other schemes as a record", () => {
    for (const raw of [
      "javascript:alert(1)//https://bicii.sg/q/P-000001",
      "data:text/html,<a href=https://bicii.sg/q/P-000001>x</a>",
      "data:text/plain,P-000001",
      "file:///q/P-000001",
      "WIFI:S:shop;T:WPA;P:secret;;",
    ]) {
      expect(interpretScan(raw, ctx).kind, raw).toBe("foreign");
    }
  });

  it("treats empty input as foreign", () => {
    expect(interpretScan("", ctx).kind).toBe("foreign");
    expect(interpretScan("   ", ctx).kind).toBe("foreign");
  });
});

describe("truncateScan", () => {
  it("keeps short text and cuts long text with an ellipsis", () => {
    expect(truncateScan("https://example.com/phish")).toBe("https://example.com/phish");
    const long = `https://example.com/${"a".repeat(100)}`;
    expect(truncateScan(long)).toHaveLength(60);
    expect(truncateScan(long).endsWith("…")).toBe(true);
    expect(truncateScan("a\n\nb")).toBe("a b");
  });
});
