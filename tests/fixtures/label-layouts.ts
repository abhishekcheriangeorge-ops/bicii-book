/**
 * Label layout v1 cases (DATA-MODEL §12): whether a layout fits a label of
 * widthMm x heightMm, and for invalid ones a fragment of the sentence
 * private.label_layout_problem returns. Shared by tests/db/labels.test.ts
 * and the Phase 8 step 2 zod schema's parity test, so the database and the
 * template editor accept exactly the same layouts.
 */
export type LayoutCase = {
  name: string;
  widthMm: number;
  heightMm: number;
  layout: unknown;
  valid: boolean;
  problemIncludes?: string;
};

const base = {
  version: 1,
  qr_mm: 28,
  padding_mm: 2,
  qr_position: "left",
  name_lines: 2,
  text_mm: 3,
};

/** The built-in templates' layouts (the migration's rows), canonical field order. */
export const DEFAULT_LAYOUTS = {
  product: { ...base, fields: ["name", "price", "short_id", "sku"] },
  unit: { ...base, fields: ["name", "identity", "price", "short_id"] },
  bike: { ...base, fields: ["name", "identity", "serial_number", "short_id"] },
} as const;

export const LAYOUT_CASES: readonly LayoutCase[] = [
  {
    name: "product default",
    widthMm: 58,
    heightMm: 40,
    layout: DEFAULT_LAYOUTS.product,
    valid: true,
  },
  { name: "unit default", widthMm: 58, heightMm: 40, layout: DEFAULT_LAYOUTS.unit, valid: true },
  { name: "bike default", widthMm: 58, heightMm: 40, layout: DEFAULT_LAYOUTS.bike, valid: true },
  {
    name: "QR on the right, every field",
    widthMm: 70,
    heightMm: 40,
    layout: {
      ...base,
      qr_position: "right",
      fields: ["name", "identity", "price", "serial_number", "short_id", "sku"],
    },
    valid: true,
  },
  {
    name: "unknown field cost",
    widthMm: 58,
    heightMm: 40,
    layout: { ...base, fields: ["name", "cost", "short_id"] },
    valid: false,
    problemIncludes: 'Unknown field "cost"',
  },
  {
    name: "missing short_id",
    widthMm: 58,
    heightMm: 40,
    layout: { ...base, fields: ["name", "price"] },
    valid: false,
    problemIncludes: "short ID",
  },
  {
    name: "duplicate field",
    widthMm: 58,
    heightMm: 40,
    layout: { ...base, fields: ["name", "name", "short_id"] },
    valid: false,
    problemIncludes: "listed twice",
  },
  {
    name: "QR 37 mm on 58 x 40 with a 2 mm margin",
    widthMm: 58,
    heightMm: 40,
    layout: { ...DEFAULT_LAYOUTS.product, qr_mm: 37 },
    valid: false,
    problemIncludes: "at most 36.0 mm",
  },
  {
    name: "text column under 15 mm",
    widthMm: 40,
    heightMm: 40,
    layout: { ...DEFAULT_LAYOUTS.product, qr_mm: 30 },
    valid: false,
    problemIncludes: "at least 15 mm",
  },
  {
    name: "QR under 10 mm",
    widthMm: 58,
    heightMm: 40,
    layout: { ...DEFAULT_LAYOUTS.product, qr_mm: 9 },
    valid: false,
    problemIncludes: "at least 10 mm",
  },
  {
    name: "name_lines 4",
    widthMm: 58,
    heightMm: 40,
    layout: { ...DEFAULT_LAYOUTS.product, name_lines: 4 },
    valid: false,
    problemIncludes: "1 to 3 lines",
  },
  {
    name: "text_mm 1.5",
    widthMm: 58,
    heightMm: 40,
    layout: { ...DEFAULT_LAYOUTS.product, text_mm: 1.5 },
    valid: false,
    problemIncludes: "text size",
  },
  {
    name: "extra key colour",
    widthMm: 58,
    heightMm: 40,
    layout: { ...DEFAULT_LAYOUTS.product, colour: "red" },
    valid: false,
    problemIncludes: 'Unknown layout setting "colour"',
  },
  {
    name: "version 2",
    widthMm: 58,
    heightMm: 40,
    layout: { ...DEFAULT_LAYOUTS.product, version: 2 },
    valid: false,
    problemIncludes: "version 1",
  },
  {
    name: "fields not an array",
    widthMm: 58,
    heightMm: 40,
    layout: { ...base, fields: "name,short_id" },
    valid: false,
    problemIncludes: "list of 1 to 6 fields",
  },
  {
    name: "padding 0",
    widthMm: 58,
    heightMm: 40,
    layout: { ...DEFAULT_LAYOUTS.product, padding_mm: 0 },
    valid: false,
    problemIncludes: "margin",
  },
  {
    name: "qr_mm as a string",
    widthMm: 58,
    heightMm: 40,
    layout: { ...DEFAULT_LAYOUTS.product, qr_mm: "28" },
    valid: false,
    problemIncludes: '"qr_mm" must be a number',
  },
  {
    name: "missing text_mm",
    widthMm: 58,
    heightMm: 40,
    layout: {
      version: 1,
      qr_mm: 28,
      padding_mm: 2,
      qr_position: "left",
      name_lines: 2,
      fields: ["short_id"],
    },
    valid: false,
    problemIncludes: 'missing "text_mm"',
  },
  {
    name: "QR position top",
    widthMm: 58,
    heightMm: 40,
    layout: { ...DEFAULT_LAYOUTS.product, qr_position: "top" },
    valid: false,
    problemIncludes: "left or the right",
  },
  {
    name: "not an object",
    widthMm: 58,
    heightMm: 40,
    layout: ["short_id"],
    valid: false,
    problemIncludes: "JSON object",
  },
];
