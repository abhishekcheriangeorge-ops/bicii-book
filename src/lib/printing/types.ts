/**
 * Label printing types (SPEC §15, §16, §31; DATA-MODEL §12; PLAN D9,
 * D56–D59; ADR-017). camelCase mirrors of the database's snake_case jsonb,
 * parsed by ./schemas.ts at the boundary. Pure and isomorphic.
 */

export type LabelKind = "product" | "unit" | "bike";

export const LABEL_KINDS = ["product", "unit", "bike"] as const satisfies readonly LabelKind[];

export type LabelField = "name" | "price" | "short_id" | "sku" | "identity" | "serial_number";

/**
 * The canonical field order (DATA-MODEL §12): the template editor lists
 * fields in this order and the built-in templates use it.
 */
export const LABEL_FIELD_ORDER = [
  "name",
  "identity",
  "price",
  "serial_number",
  "short_id",
  "sku",
] as const satisfies readonly LabelField[];

/** Layout v1 (private.label_layout_problem). */
export type LabelLayout = {
  version: 1;
  qrMm: number;
  paddingMm: number;
  qrPosition: "left" | "right";
  fields: LabelField[];
  nameLines: 1 | 2 | 3;
  textMm: number;
};

export type LabelTemplate = {
  id: string;
  name: string;
  kind: LabelKind;
  widthMm: number;
  heightMm: number;
  layout: LabelLayout;
  isDefault: boolean;
  active: boolean;
};

/**
 * What one label prints (private.label_content; print_jobs.content). Only
 * public fields and identifiers: never a cost, consignor, ownership, owner
 * name or note (labelContentSchema is strict).
 */
export type LabelContent = {
  kind: LabelKind;
  shortId: string;
  /** The database-computed QR payload (D9): the QR encodes exactly this. */
  qrPayload: string;
  name: string;
  /** private.selling_price with 2 decimals; null prints no price (D58, D24 amended). */
  price: string | null;
  currency: string;
  sku: string | null;
  /** Brand, a bike's "Size · colour" line, a unit's condition; at most a few lines. */
  identity: string[];
  serialNumber: string | null;
};

export type PrinterAdapterId = "browser" | "pdf" | "network_raw" | "bluetooth";

/** Printer config v1 (private.printer_config_problem). */
export type PrinterConfig = {
  offsetXMm?: number;
  offsetYMm?: number;
};

export type PrinterProfile = {
  id: string;
  name: string;
  adapter: PrinterAdapterId;
  config: PrinterConfig;
  isDefault: boolean;
  active: boolean;
  sortOrder: number;
};

export type PrintStatus = "queued" | "rendered" | "printed" | "failed";

/**
 * One print job as the screens and renderers see it. Everything a renderer
 * uses (content, template, profile config) is the job's snapshot, never the
 * current record, template or printer.
 */
export type PrintJob = {
  id: string;
  kind: LabelKind;
  entityId: string;
  /** The record (or a unit's product) is archived: no new labels (Print again disabled). */
  entityArchived: boolean;
  shortId: string;
  qrPayload: string;
  content: LabelContent;
  quantity: number;
  adapter: PrinterAdapterId;
  profile: { id: string; name: string; config: PrinterConfig };
  template: {
    id: string;
    name: string;
    widthMm: number;
    heightMm: number;
    layout: LabelLayout;
  };
  status: PrintStatus;
  error: string | null;
  requestedBy: { id: string; name: string };
  /** Who last changed the status (marked printed or failed), when known. */
  statusChangedBy: { id: string; name: string } | null;
  createdAt: string;
  renderedAt: string | null;
  completedAt: string | null;
  reprintOfId: string | null;
};
