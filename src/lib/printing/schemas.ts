import { z } from "zod";

import { Decimal } from "@/lib/money";

import {
  LABEL_FIELD_ORDER,
  LABEL_KINDS,
  type LabelContent,
  type LabelField,
  type LabelLayout,
  type PrinterConfig,
} from "./types";

/**
 * zod schemas for the label jsonb (DATA-MODEL §12), parsing the database's
 * snake_case into the camelCase types of ./types.ts at the boundary, and
 * the template and printer inputs of the settings screens, with the
 * database's exact rules and sentences (private.label_layout_problem,
 * private.printer_config_problem) so an admin sees the problem before the
 * database refuses. The database stays the authority.
 */

const FIELD_NAMES = LABEL_FIELD_ORDER as readonly string[];
const LAYOUT_KEYS = [
  "version",
  "qr_mm",
  "padding_mm",
  "qr_position",
  "fields",
  "name_lines",
  "text_mm",
] as const;
const NUMERIC_KEYS = ["version", "qr_mm", "padding_mm", "name_lines", "text_mm"] as const;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** jsonb orders an object's keys by length, then bytewise (so does jsonb_object_keys). */
function jsonbKeyOrder(keys: string[]): string[] {
  const bytes = (s: string) => new TextEncoder().encode(s);
  return [...keys].sort((a, b) => {
    const ba = bytes(a);
    const bb = bytes(b);
    if (ba.length !== bb.length) return ba.length - bb.length;
    for (let i = 0; i < ba.length; i++) if (ba[i] !== bb[i]) return ba[i] - bb[i];
    return 0;
  });
}

/**
 * Mirrors private.label_layout_problem exactly: null when the layout (the
 * database's snake_case jsonb) fits a widthMm x heightMm label, else the
 * same one-sentence problem the database reports. Tested for parity with
 * the database on tests/fixtures/label-layouts.ts.
 */
export function labelLayoutProblem(
  layout: unknown,
  widthMm: number | null,
  heightMm: number | null,
): string | null {
  if (!isObject(layout)) return "The layout must be a JSON object.";
  if (widthMm === null || heightMm === null || !Number.isFinite(widthMm + heightMm)) {
    return "The label needs a width and a height.";
  }
  for (const k of jsonbKeyOrder(Object.keys(layout))) {
    if (!(LAYOUT_KEYS as readonly string[]).includes(k)) return `Unknown layout setting "${k}".`;
  }
  for (const k of LAYOUT_KEYS) {
    if (!(k in layout)) return `The layout is missing "${k}".`;
  }
  for (const k of NUMERIC_KEYS) {
    const v = layout[k];
    if (typeof v !== "number" || !Number.isFinite(v)) return `"${k}" must be a number.`;
  }
  const num = (k: (typeof NUMERIC_KEYS)[number]) => new Decimal(String(layout[k] as number));
  if (!num("version").eq(1)) return "Only layout version 1 is supported.";

  const qr = num("qr_mm");
  const pad = num("padding_mm");
  const lines = num("name_lines");
  const txt = num("text_mm");

  if (pad.lt(0.5) || pad.gt(6)) return "The margin is 0.5 to 6 mm.";
  if (layout.qr_position !== "left" && layout.qr_position !== "right") {
    return "The QR code goes on the left or the right.";
  }
  if (!lines.isInteger() || lines.lt(1) || lines.gt(3)) return "The name takes 1 to 3 lines.";
  if (txt.lt(1.8) || txt.gt(6)) return "The text size is 1.8 to 6 mm.";

  const fields = layout.fields;
  if (!Array.isArray(fields) || fields.length < 1 || fields.length > 6) {
    return "The fields must be a list of 1 to 6 fields.";
  }
  const seen: string[] = [];
  for (const f of fields) {
    if (typeof f !== "string") return "Each field must be a field name.";
    if (!FIELD_NAMES.includes(f)) return `Unknown field "${f}".`;
    if (seen.includes(f)) return `The field "${f}" is listed twice.`;
    seen.push(f);
  }
  if (!seen.includes("short_id")) return "Every label must show its short ID.";

  if (qr.lt(10)) return "The QR code must be at least 10 mm to scan.";
  const w = new Decimal(String(widthMm));
  const h = new Decimal(String(heightMm));
  const maxQr = Decimal.min(w, h).minus(pad.times(2));
  if (qr.gt(maxQr)) {
    return `The QR code does not fit: at most ${Decimal.max(maxQr, 0).toFixed(1)} mm on this label.`;
  }
  if (w.minus(qr).minus(pad.times(3)).lt(15)) {
    return "The text beside the QR code needs at least 15 mm: make the QR code smaller or the label wider.";
  }
  return null;
}

/** A stored layout (already valid in the database): strict shape, to camelCase. */
export const labelLayoutSchema = z
  .strictObject({
    version: z.literal(1),
    qr_mm: z.number(),
    padding_mm: z.number(),
    qr_position: z.enum(["left", "right"]),
    fields: z.array(z.enum(LABEL_FIELD_ORDER)).min(1).max(6),
    name_lines: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    text_mm: z.number(),
  })
  .transform((l): LabelLayout => ({
    version: 1,
    qrMm: l.qr_mm,
    paddingMm: l.padding_mm,
    qrPosition: l.qr_position,
    fields: l.fields,
    nameLines: l.name_lines,
    textMm: l.text_mm,
  }));

/** camelCase layout -> the database's jsonb. */
export function toDbLayout(layout: LabelLayout): Record<string, unknown> {
  return {
    version: layout.version,
    qr_mm: layout.qrMm,
    padding_mm: layout.paddingMm,
    qr_position: layout.qrPosition,
    fields: [...layout.fields],
    name_lines: layout.nameLines,
    text_mm: layout.textMm,
  };
}

const PRINT_OFFSET = z
  .number({ error: "Print offsets are numbers from -5 to 5 mm." })
  .min(-5, { error: "Print offsets are numbers from -5 to 5 mm." })
  .max(5, { error: "Print offsets are numbers from -5 to 5 mm." });

/** Printer config v1 jsonb (private.printer_config_problem), to camelCase. */
export const printerConfigSchema = z
  .strictObject({ offset_x_mm: PRINT_OFFSET.optional(), offset_y_mm: PRINT_OFFSET.optional() })
  .transform((c): PrinterConfig => ({
    ...(c.offset_x_mm !== undefined ? { offsetXMm: c.offset_x_mm } : {}),
    ...(c.offset_y_mm !== undefined ? { offsetYMm: c.offset_y_mm } : {}),
  }));

/** camelCase printer config -> the database's jsonb (zero offsets are left out). */
export function toDbConfig(config: PrinterConfig): Record<string, number> {
  const out: Record<string, number> = {};
  if (config.offsetXMm) out.offset_x_mm = config.offsetXMm;
  if (config.offsetYMm) out.offset_y_mm = config.offsetYMm;
  return out;
}

/**
 * print_jobs.content / label_preview (private.label_content). Strict: an
 * unknown key (a `cost`, a consignor) fails, so a database regression can
 * never reach a label.
 */
export const labelContentSchema = z
  .strictObject({
    kind: z.enum(LABEL_KINDS),
    short_id: z.string().regex(/^(B|P|U)-\d{6}$/),
    qr_payload: z.string().regex(/^https?:\/\/[^?#\s]+\/q\/(B|P|U)-\d{6}$/),
    name: z.string(),
    price: z
      .string()
      .regex(/^-?\d+\.\d{2}$/)
      .nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    sku: z.string().nullable(),
    identity: z.array(z.string()).max(6),
    serial_number: z.string().nullable(),
  })
  .refine((c) => c.qr_payload.endsWith(`/q/${c.short_id}`), {
    error: "The QR payload does not match the short ID.",
  })
  .transform((c): LabelContent => ({
    kind: c.kind,
    shortId: c.short_id,
    qrPayload: c.qr_payload,
    name: c.name,
    price: c.price,
    currency: c.currency,
    sku: c.sku,
    identity: c.identity,
    serialNumber: c.serial_number,
  }));

const oneDecimal = (label: string, min: number, max: number) =>
  z.coerce
    .number({ error: `Enter the ${label} in millimetres.` })
    .refine((v) => Number.isFinite(v), { error: `Enter the ${label} in millimetres.` })
    .refine((v) => v >= min && v <= max, { error: `The ${label} is ${min} to ${max} mm.` })
    .refine((v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9, {
      error: `Use at most one decimal for the ${label}.`,
    });

/** The template editor's layout: camelCase, checked as a whole by labelLayoutProblem. */
export const labelLayoutInputSchema = z.object({
  version: z.literal(1).default(1),
  qrMm: z.coerce.number({ error: "Enter the QR size in millimetres." }),
  paddingMm: z.coerce.number({ error: "Enter the margin in millimetres." }),
  qrPosition: z.enum(["left", "right"], { error: "The QR code goes on the left or the right." }),
  fields: z
    .array(z.enum(LABEL_FIELD_ORDER, { error: "Unknown field." }))
    .min(1, { error: "Choose at least one field." })
    // The editor keeps the canonical order (DATA-MODEL §12).
    .transform((fs) => LABEL_FIELD_ORDER.filter((f) => fs.includes(f)) as LabelField[]),
  nameLines: z.coerce
    .number()
    .refine((v): v is 1 | 2 | 3 => v === 1 || v === 2 || v === 3, {
      error: "The name takes 1 to 3 lines.",
    })
    .transform((v) => v as 1 | 2 | 3),
  textMm: z.coerce.number({ error: "Enter the text size in millimetres." }),
});

/**
 * A template as the settings screen submits it: name, kind, size and
 * layout validated together with the database's rules (the size checks of
 * label_templates and private.label_layout_problem's sentence on `layout`).
 */
export const labelTemplateInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { error: "Give the template a name." })
      .max(80, { error: "Keep the name under 80 characters." }),
    kind: z.enum(LABEL_KINDS, { error: "Choose what the template labels." }),
    widthMm: oneDecimal("width", 20, 150),
    heightMm: oneDecimal("height", 15, 150),
    layout: labelLayoutInputSchema,
    active: z.boolean().default(true),
  })
  .superRefine((t, ctx) => {
    const problem = labelLayoutProblem(toDbLayout(t.layout), t.widthMm, t.heightMm);
    if (problem) ctx.addIssue({ code: "custom", path: ["layout"], message: problem });
  });

export type LabelTemplateInput = z.output<typeof labelTemplateInputSchema>;

/** A printer as the settings screen submits it (browser and pdf only until Phase 12). */
export const printerProfileInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: "Give the printer a name." })
    .max(80, { error: "Keep the name under 80 characters." }),
  adapter: z.enum(["browser", "pdf"], { error: "Choose browser print or PDF." }),
  config: z.object({
    offsetXMm: PRINT_OFFSET.optional(),
    offsetYMm: PRINT_OFFSET.optional(),
  }),
  active: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(-1000).max(1000).default(0),
});

export type PrinterProfileInput = z.output<typeof printerProfileInputSchema>;
