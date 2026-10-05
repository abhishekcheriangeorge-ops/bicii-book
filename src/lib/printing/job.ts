import type { LabelKind, PrintStatus } from "./types";

/**
 * The print job status machine (PLAN D59; private.print_job_transition_allowed):
 * queued -> rendered, printed or failed; rendered -> printed or failed;
 * printed and failed are final. tests/fixtures/print-transitions.ts drives
 * both sides.
 */
const ALLOWED: Readonly<Record<PrintStatus, readonly PrintStatus[]>> = {
  queued: ["rendered", "printed", "failed"],
  rendered: ["printed", "failed"],
  printed: [],
  failed: [],
};

export function canTransition(from: PrintStatus, to: PrintStatus): boolean {
  return ALLOWED[from].includes(to);
}

/** Only open jobs are rendered for printing (print view controls, PDF route; D59). */
export function isPrintable(status: PrintStatus): boolean {
  return status === "queued" || status === "rendered";
}

const LABELS: Record<PrintStatus, string> = {
  queued: "Not printed yet",
  rendered: "Sent — confirm",
  printed: "Printed",
  failed: "Failed",
};

/** The status tones of DESIGN.md (StatusPill). */
export type PrintTone = "waiting" | "progress" | "done" | "danger";

const TONES: Record<PrintStatus, PrintTone> = {
  queued: "waiting",
  rendered: "progress",
  printed: "done",
  failed: "danger",
};

export function printStatusLabel(status: PrintStatus): string {
  return LABELS[status];
}

export function printStatusTone(status: PrintStatus): PrintTone {
  return TONES[status];
}

/** D56: one job prints 1–500 labels of a counted product, 1–10 of a unit or bike. */
export function maxLabelQuantity(kind: LabelKind): number {
  return kind === "product" ? 500 : 10;
}

export const LABEL_KIND_NAMES: Record<LabelKind, string> = {
  product: "Product",
  unit: "Unit",
  bike: "Bike tag",
};
