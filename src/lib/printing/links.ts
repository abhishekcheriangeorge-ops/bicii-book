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

export function printViewPath(jobId: string): string {
  return `/print/labels/${jobId}`;
}

export function pdfPath(jobId: string): string {
  return `/api/labels/${jobId}/pdf`;
}

export function printHistoryPath(jobId?: string): string {
  return jobId ? `/labels/${jobId}` : "/labels";
}
