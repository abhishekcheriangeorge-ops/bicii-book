import { composeLabel, type LabelDrawing } from "./compose";
import type { PrintJob } from "./types";

/**
 * What a renderer prints for a job: one drawing, `copies` times. Built
 * ONLY from the job's snapshots (template, content, printer config), never
 * from the current record, template or printer, so a reprint of history
 * and the PDF of an open job show exactly what the job captured.
 */
export type LabelDocument = { job: PrintJob; drawing: LabelDrawing; copies: number };

export function buildLabelDocument(job: PrintJob): LabelDocument {
  return {
    job,
    drawing: composeLabel(job.template, job.content, job.profile.config),
    copies: job.quantity,
  };
}
