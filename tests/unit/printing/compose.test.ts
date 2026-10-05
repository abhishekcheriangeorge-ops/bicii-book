import { describe, expect, it } from "vitest";

import { composeLabel, MIN_TEXT_MM, type LabelDrawing } from "@/lib/printing/compose";
import { textWidthMm } from "@/lib/printing/metrics";
import { labelLayoutSchema } from "@/lib/printing/schemas";
import { SAMPLE_CONTENT } from "@/lib/printing/samples";
import type { LabelContent, LabelKind } from "@/lib/printing/types";

import { DEFAULT_LAYOUTS } from "../../fixtures/label-layouts";

const template = (kind: LabelKind, widthMm = 58, heightMm = 40) => ({
  widthMm,
  heightMm,
  layout: labelLayoutSchema.parse(DEFAULT_LAYOUTS[kind]),
});

const variants = (base: LabelContent): [string, LabelContent][] => [
  ["sample", base],
  ["short", { ...base, name: "Tube", identity: [], sku: null, serialNumber: null }],
  ["120-char name", { ...base, name: "Extraordinarily long name ".repeat(5).slice(0, 120) }],
  [
    "3 identity lines",
    { ...base, identity: ["Size 54 · Red", "Lightly used, new tyres and bar tape", "Brand X"] },
  ],
  ["null price", { ...base, price: null }],
  ["price 0.00", { ...base, price: "0.00" }],
  ["null sku", { ...base, sku: null }],
  [
    "everything long",
    {
      ...base,
      name: "W".repeat(120),
      identity: ["W".repeat(80), "W".repeat(80), "W".repeat(80)],
      sku: "W".repeat(40),
      serialNumber: "W".repeat(40),
      price: "9999999.99",
    },
  ],
];

function expectInside(d: LabelDrawing) {
  const eps = 1e-6;
  expect(d.qr.xMm).toBeGreaterThanOrEqual(-eps);
  expect(d.qr.yMm).toBeGreaterThanOrEqual(-eps);
  expect(d.qr.xMm + d.qr.sideMm).toBeLessThanOrEqual(d.widthMm + eps);
  expect(d.qr.yMm + d.qr.sideMm).toBeLessThanOrEqual(d.heightMm + eps);
  for (const t of d.texts) {
    expect(t.xMm).toBeGreaterThanOrEqual(-eps);
    expect(t.xMm + textWidthMm(t.text, t.font, t.sizeMm)).toBeLessThanOrEqual(d.widthMm + eps);
    // The glyph box: ascent above the baseline, descent below.
    expect(t.baselineMm - t.sizeMm).toBeGreaterThanOrEqual(-eps);
    expect(t.baselineMm + 0.25 * t.sizeMm).toBeLessThanOrEqual(d.heightMm + eps);
    // Text never overlaps the QR square.
    const overlapsX = t.xMm < d.qr.xMm + d.qr.sideMm && t.xMm + t.widthMm > d.qr.xMm;
    expect(overlapsX).toBe(false);
  }
}

describe("composeLabel", () => {
  for (const kind of ["product", "unit", "bike"] as const) {
    for (const [name, content] of variants(SAMPLE_CONTENT[kind])) {
      it(`${kind} / ${name}: inside the label, short ID always, price iff not null`, () => {
        const d = composeLabel(template(kind), content);
        expectInside(d);
        const fields = new Set(d.texts.map((t) => t.field));
        const layoutFields = DEFAULT_LAYOUTS[kind].fields as readonly string[];
        expect(d.texts.filter((t) => t.field === "short_id").map((t) => t.text)).toEqual([
          content.shortId,
        ]);
        expect(fields.has("price")).toBe(layoutFields.includes("price") && content.price !== null);
        for (const f of fields) expect(layoutFields).toContain(f);
        expect(d.linkUri).toBe(content.qrPayload);
      });
    }
  }

  it("prints a 0.00 price as $0.00 and a null price not at all (D24 amended, D58)", () => {
    const zero = composeLabel(template("product"), { ...SAMPLE_CONTENT.product, price: "0.00" });
    expect(zero.texts.find((t) => t.field === "price")?.text).toBe("$0.00");
    const none = composeLabel(template("product"), { ...SAMPLE_CONTENT.product, price: null });
    expect(none.texts.some((t) => t.field === "price")).toBe(false);
    expect(none.texts.some((t) => t.text.includes("$"))).toBe(false);
  });

  it("skips empty fields without a gap", () => {
    const d = composeLabel(template("unit"), { ...SAMPLE_CONTENT.unit, identity: [] });
    expect(d.texts.some((t) => t.field === "identity")).toBe(false);
  });

  it("puts the QR on the right when asked", () => {
    const layout = labelLayoutSchema.parse({ ...DEFAULT_LAYOUTS.product, qr_position: "right" });
    const d = composeLabel({ widthMm: 58, heightMm: 40, layout }, SAMPLE_CONTENT.product);
    expect(d.qr.xMm).toBeCloseTo(58 - 2 - 28, 6);
    expectInside(d);
  });

  it("drops serial, SKU and identity before the name and never the short ID or price", () => {
    const layout = labelLayoutSchema.parse({
      version: 1,
      qr_mm: 11,
      padding_mm: 2,
      qr_position: "left",
      name_lines: 3,
      text_mm: 3,
      fields: ["name", "identity", "price", "serial_number", "short_id", "sku"],
    });
    const content = {
      ...SAMPLE_CONTENT.unit,
      sku: "SKU-1",
      identity: ["One", "Two", "Three"],
    };
    const d = composeLabel({ widthMm: 40, heightMm: 15, layout }, content);
    expectInside(d);
    const fields = d.texts.map((t) => t.field);
    expect(fields).toContain("short_id");
    expect(fields).toContain("price");
    expect(fields).not.toContain("serial_number");
    expect(fields).not.toContain("sku");
    for (const t of d.texts) expect(t.sizeMm).toBeGreaterThan(0);
  });

  it("scales text down together, not below 1.8 mm when that fits", () => {
    const layout = labelLayoutSchema.parse({
      ...DEFAULT_LAYOUTS.product,
      qr_mm: 20,
      text_mm: 6,
      padding_mm: 1,
    });
    const d = composeLabel({ widthMm: 60, heightMm: 22, layout }, SAMPLE_CONTENT.product);
    expectInside(d);
    for (const t of d.texts) {
      if (t.field !== "short_id" && t.field !== "price") {
        expect(t.sizeMm).toBeGreaterThanOrEqual(MIN_TEXT_MM - 1e-9);
      }
    }
  });

  it("carries the printer offsets for the renderers", () => {
    const d = composeLabel(template("bike"), SAMPLE_CONTENT.bike, {
      offsetXMm: 1.5,
      offsetYMm: -2,
    });
    expect(d.offsetXMm).toBe(1.5);
    expect(d.offsetYMm).toBe(-2);
    expectInside(d);
  });
});
