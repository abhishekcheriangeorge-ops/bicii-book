import { formatMoney } from "@/lib/money";

import { fitLines, textWidthMm, toWinAnsi, type LabelFont } from "./metrics";
import { qrMatrix, type QrMatrix } from "./qr";
import type { LabelContent, LabelField, LabelLayout, PrinterConfig } from "./types";

/**
 * THE label layout engine (DATA-MODEL §12): one LabelDrawing in
 * millimetres that the SVG (./label-svg.tsx) and the PDF
 * (./adapters/pdf.ts) both draw, so the screen, the browser print and the
 * PDF are the same label.
 *
 * - The QR square (side qrMm, quiet zone inside) is vertically centred, at
 *   x = padding (left) or width - padding - qrMm (right). It encodes
 *   exactly content.qrPayload, the database's payload.
 * - The text column beside it is width - qrMm - 3 x padding wide; the
 *   layout's fields stack top-down in layout order (line height 1.2 x
 *   size), vertically centred: name bold 1.15 x textMm on up to nameLines
 *   lines; price bold 1.4 x (formatMoney: "0.00" prints $0.00, D24
 *   amended; a null price draws nothing, D58); short ID monospace bold;
 *   SKU, identity lines (at most 3) and serial number regular 0.85 x.
 *   Missing fields are skipped without a gap. Only layout.fields are drawn.
 *   Long text wraps and ends with "…"; the short ID and the price are never
 *   cut: they shrink to the column's width instead.
 * - Too tall: drop the serial number, then the SKU, then identity lines
 *   (last first), then the name goes to one line; never the short ID or
 *   the price. Then all text scales down together, not below 1.8 mm unless
 *   nothing else fits. Before offsets nothing lies outside the label.
 * - The printer offsets are carried for the renderers, which translate by
 *   them and clip to the label.
 */

export type LabelText = {
  field: LabelField;
  xMm: number;
  baselineMm: number;
  sizeMm: number;
  font: LabelFont;
  text: string;
  /** The text's advance width (standard-font metrics), for bounds checks. */
  widthMm: number;
};

export type LabelDrawing = {
  widthMm: number;
  heightMm: number;
  qr: { xMm: number; yMm: number; sideMm: number; matrix: QrMatrix };
  texts: LabelText[];
  /** The URI behind the QR (PDF link annotation): content.qrPayload. */
  linkUri: string;
  /** "Label: {name}, {price}, {short id}" (the SVG's accessible name), untruncated. */
  accessibleName: string;
  offsetXMm: number;
  offsetYMm: number;
};

export type ComposableTemplate = {
  widthMm: number;
  heightMm: number;
  layout: LabelLayout;
};

export const MIN_TEXT_MM = 1.8;
const LINE_HEIGHT = 1.2;
/** Baseline below the top of a line box, as a share of the size. */
const BASELINE = 0.92;
const MAX_IDENTITY_LINES = 3;

type FieldSpec = { field: LabelField; font: LabelFont; size: number; lines: string[] };

type Plan = {
  serial: boolean;
  sku: boolean;
  identity: number;
  nameLines: number;
};

/** The raw text of each field (before fitting), null when there is nothing to print. */
function fieldTexts(content: LabelContent): Record<LabelField, string[] | null> {
  const nonEmpty = (s: string | null) => (s !== null && s.trim() !== "" ? s.trim() : null);
  const sku = nonEmpty(content.sku);
  const serial = nonEmpty(content.serialNumber);
  const identity = content.identity
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_IDENTITY_LINES);
  return {
    name: nonEmpty(content.name) ? [content.name.trim()] : null,
    price: content.price === null ? null : [formatMoney(content.price, content.currency)],
    short_id: [content.shortId],
    sku: sku ? [`SKU ${sku}`] : null,
    identity: identity.length > 0 ? identity : null,
    serial_number: serial ? [`S/N ${serial}`] : null,
  };
}

const FACTORS: Record<LabelField, { font: LabelFont; factor: number }> = {
  name: { font: "bold", factor: 1.15 },
  price: { font: "bold", factor: 1.4 },
  short_id: { font: "mono", factor: 1 },
  sku: { font: "regular", factor: 0.85 },
  identity: { font: "regular", factor: 0.85 },
  serial_number: { font: "regular", factor: 0.85 },
};

export function composeLabel(
  template: ComposableTemplate,
  content: LabelContent,
  config: PrinterConfig = {},
): LabelDrawing {
  const { widthMm: w, heightMm: h, layout } = template;
  const pad = layout.paddingMm;
  const qrSide = layout.qrMm;
  const qrX = layout.qrPosition === "left" ? pad : w - pad - qrSide;
  const qrY = (h - qrSide) / 2;
  const colX = layout.qrPosition === "left" ? pad * 2 + qrSide : pad;
  const colW = Math.max(w - qrSide - 3 * pad, 0);
  const availH = Math.max(h - 2 * pad, 0);
  const raw = fieldTexts(content);

  const sizeOf = (field: LabelField, scale: number, clamp: boolean) => {
    const s = FACTORS[field].factor * layout.textMm * scale;
    return clamp ? Math.max(s, Math.min(MIN_TEXT_MM, FACTORS[field].factor * layout.textMm)) : s;
  };

  const build = (plan: Plan, scale: number, clamp: boolean): FieldSpec[] => {
    const specs: FieldSpec[] = [];
    for (const field of layout.fields) {
      const texts = raw[field];
      if (!texts) continue;
      if (field === "serial_number" && !plan.serial) continue;
      if (field === "sku" && !plan.sku) continue;
      const { font } = FACTORS[field];
      let size = sizeOf(field, scale, clamp);
      let lines: string[];
      if (field === "name") {
        lines = fitLines(texts[0], font, size, colW, plan.nameLines);
      } else if (field === "identity") {
        lines = texts.slice(0, plan.identity).flatMap((t) => fitLines(t, font, size, colW, 1));
      } else if (field === "short_id" || field === "price") {
        // Never cut: the short ID and the price shrink to the column instead.
        const text = toWinAnsi(texts[0]);
        const width = textWidthMm(text, font, size);
        if (width > colW && width > 0) size = (size * colW) / width;
        lines = [text];
      } else {
        lines = fitLines(texts[0], font, size, colW, 1);
      }
      if (lines.length > 0) specs.push({ field, font, size, lines });
    }
    return specs;
  };

  const heightOf = (specs: FieldSpec[]) =>
    specs.reduce((sum, s) => sum + s.lines.length * LINE_HEIGHT * s.size, 0);

  const plan: Plan = {
    serial: true,
    sku: true,
    identity: MAX_IDENTITY_LINES,
    nameLines: layout.nameLines,
  };
  const fitsAt = (scale: number, clamp: boolean) =>
    heightOf(build(plan, scale, clamp)) <= availH + 1e-9;

  // 1. Drop optional lines, least important first.
  const drops: (() => boolean)[] = [
    () => (plan.serial ? ((plan.serial = false), true) : false),
    () => (plan.sku ? ((plan.sku = false), true) : false),
    ...Array.from(
      { length: MAX_IDENTITY_LINES },
      () => () => (plan.identity > 0 ? ((plan.identity -= 1), true) : false),
    ),
    () => (plan.nameLines > 1 ? ((plan.nameLines = 1), true) : false),
  ];
  for (const drop of drops) {
    if (fitsAt(1, false)) break;
    drop();
  }

  // 2. Scale all text down together (not below 1.8 mm), else whatever fits.
  let scale = 1;
  let clamp = false;
  if (!fitsAt(1, false)) {
    const total = heightOf(build(plan, 1, false));
    scale = total > 0 ? availH / total : 1;
    clamp = true;
    // A smaller size may wrap the name differently; shrink until it fits.
    for (let i = 0; i < 20 && !fitsAt(scale, true); i++) scale *= 0.97;
    if (!fitsAt(scale, true)) {
      clamp = false;
      for (let i = 0; i < 40 && !fitsAt(scale, false); i++) scale *= 0.95;
    }
  }

  const specs = build(plan, scale, clamp);
  const total = heightOf(specs);
  let top = pad + Math.max((availH - total) / 2, 0);
  const texts: LabelText[] = [];
  for (const spec of specs) {
    const size = spec.size;
    for (const line of spec.lines) {
      texts.push({
        field: spec.field,
        xMm: colX,
        baselineMm: top + BASELINE * size,
        sizeMm: size,
        font: spec.font,
        text: line,
        widthMm: textWidthMm(line, spec.font, size),
      });
      top += LINE_HEIGHT * size;
    }
  }

  return {
    widthMm: w,
    heightMm: h,
    qr: { xMm: qrX, yMm: qrY, sideMm: qrSide, matrix: qrMatrix(content.qrPayload) },
    texts,
    linkUri: content.qrPayload,
    accessibleName: `Label: ${[
      content.name.trim(),
      raw.price ? raw.price[0] : null,
      content.shortId,
    ]
      .filter(Boolean)
      .join(", ")}`,
    offsetXMm: config.offsetXMm ?? 0,
    offsetYMm: config.offsetYMm ?? 0,
  };
}
