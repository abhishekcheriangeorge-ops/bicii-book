import { describe, expect, it } from "vitest";

import {
  labelContentSchema,
  labelLayoutProblem,
  labelLayoutSchema,
  labelTemplateInputSchema,
  printerConfigSchema,
  toDbConfig,
  toDbLayout,
} from "@/lib/printing/schemas";
import { LABEL_FIELD_ORDER } from "@/lib/printing/types";

import { DEFAULT_LAYOUTS, LAYOUT_CASES } from "../../fixtures/label-layouts";

// Parity with private.label_layout_problem: tests/db/labels.test.ts runs
// the same cases through the database.
describe("labelLayoutProblem (parity with the database)", () => {
  for (const c of LAYOUT_CASES) {
    it(`${c.valid ? "accepts" : "refuses"} ${c.name}`, () => {
      const problem = labelLayoutProblem(c.layout, c.widthMm, c.heightMm);
      if (c.valid) {
        expect(problem).toBeNull();
      } else {
        expect(problem).not.toBeNull();
        expect(problem).toContain(c.problemIncludes ?? "");
      }
    });
  }

  it("needs a width and a height", () => {
    expect(labelLayoutProblem(DEFAULT_LAYOUTS.product, null, 40)).toBe(
      "The label needs a width and a height.",
    );
  });
});

describe("labelLayoutSchema", () => {
  it("parses the built-in layouts to camelCase and back", () => {
    for (const layout of Object.values(DEFAULT_LAYOUTS)) {
      const parsed = labelLayoutSchema.parse(layout);
      expect(parsed.qrMm).toBe(28);
      expect(parsed.nameLines).toBe(2);
      expect(toDbLayout(parsed)).toEqual({ ...layout, fields: [...layout.fields] });
    }
  });

  it("is strict", () => {
    expect(labelLayoutSchema.safeParse({ ...DEFAULT_LAYOUTS.product, colour: "red" }).success).toBe(
      false,
    );
  });
});

describe("labelTemplateInputSchema", () => {
  const input = {
    name: " Shelf 70 × 40 ",
    kind: "product",
    widthMm: "70",
    heightMm: "40",
    layout: {
      qrMm: "28",
      paddingMm: "2",
      qrPosition: "right",
      fields: ["sku", "short_id", "name"],
      nameLines: "2",
      textMm: "3",
    },
  };

  it("accepts a valid template, keeping the canonical field order", () => {
    const parsed = labelTemplateInputSchema.parse(input);
    expect(parsed.name).toBe("Shelf 70 × 40");
    expect(parsed.layout.fields).toEqual(["name", "short_id", "sku"]);
    expect(parsed.layout.fields).toEqual(
      LABEL_FIELD_ORDER.filter((f) => parsed.layout.fields.includes(f)),
    );
  });

  it("reports the database's sentence on layout", () => {
    const result = labelTemplateInputSchema.safeParse({
      ...input,
      widthMm: "40",
      layout: { ...input.layout, qrMm: "30" },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.find((i) => i.path[0] === "layout")?.message).toContain(
      "at least 15 mm",
    );
  });

  it("checks the size like the table does", () => {
    expect(labelTemplateInputSchema.safeParse({ ...input, widthMm: "19" }).success).toBe(false);
    expect(labelTemplateInputSchema.safeParse({ ...input, heightMm: "40.25" }).success).toBe(false);
    expect(labelTemplateInputSchema.safeParse({ ...input, name: "  " }).success).toBe(false);
  });
});

describe("printerConfigSchema", () => {
  it("parses offsets and is strict", () => {
    expect(printerConfigSchema.parse({})).toEqual({});
    expect(printerConfigSchema.parse({ offset_x_mm: 1.5, offset_y_mm: -2 })).toEqual({
      offsetXMm: 1.5,
      offsetYMm: -2,
    });
    expect(printerConfigSchema.safeParse({ offset_x_mm: 6 }).success).toBe(false);
    expect(printerConfigSchema.safeParse({ speed: 3 }).success).toBe(false);
    expect(toDbConfig({ offsetXMm: 1, offsetYMm: 0 })).toEqual({ offset_x_mm: 1 });
  });
});

describe("labelContentSchema", () => {
  const content = {
    kind: "product",
    short_id: "P-000011",
    qr_payload: "http://localhost:4000/q/P-000011",
    name: "Bar tape",
    price: "0.00",
    currency: "SGD",
    sku: null,
    identity: ["Supacaz"],
    serial_number: null,
  };

  it("parses label content to camelCase, keeping a 0.00 price (D24 amended)", () => {
    expect(labelContentSchema.parse(content)).toEqual({
      kind: "product",
      shortId: "P-000011",
      qrPayload: "http://localhost:4000/q/P-000011",
      name: "Bar tape",
      price: "0.00",
      currency: "SGD",
      sku: null,
      identity: ["Supacaz"],
      serialNumber: null,
    });
  });

  it("refuses any key outside the label text rule (a cost never reaches a label)", () => {
    expect(labelContentSchema.safeParse({ ...content, cost: "12.00" }).success).toBe(false);
    expect(labelContentSchema.safeParse({ ...content, consignor: "Kelvin" }).success).toBe(false);
  });

  it("refuses a payload that is not for the short ID", () => {
    expect(
      labelContentSchema.safeParse({ ...content, qr_payload: "http://localhost:4000/q/P-000012" })
        .success,
    ).toBe(false);
  });
});
