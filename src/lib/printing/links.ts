import type { LabelKind, PrintJob } from "./types";

/** Where each label kind's record opens in the Admin. */
export function recordPath(kind: LabelKind, entityId: string): string {
  switch (kind) {
    case "product":
      return `/products/${entityId}`;
    case "unit":
      return `/units/${entityId}`;
    case "bike":
      return `/bikes/${entityId}`;
  }
}

/**
 * "Print again" (D59): back to the record with the print sheet preset from
 * this job (a NEW job, linked by reprint_of_id, with a fresh preview).
 */
export function reprintPath(job: Pick<PrintJob, "kind" | "entityId" | "quantity" | "id">): string {
  return `${recordPath(job.kind, job.entityId)}?print=1&qty=${job.quantity}&reprint=${job.id}`;
}

/**
 * "Print N labels" from somewhere else (the purchase order's receipts,
 * R-029): the record with the print sheet open at that count. The sheet
 * caps a job at D56's limit and says how many remain.
 */
export function printLabelsPath(kind: LabelKind, entityId: string, quantity: number): string {
  return `${recordPath(kind, entityId)}?print=1&qty=${quantity}`;
}

export function printViewPath(jobId: string): string {
  return `/print/labels/${jobId}`;
}

export function pdfPath(jobId: string): string {
  return `/api/labels/${jobId}/pdf`;
}

export function printHistoryPath(jobId?: string): string {
  return jobId ? `/labels/${jobId}` : "/labels";
}
