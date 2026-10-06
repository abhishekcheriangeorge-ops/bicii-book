import type { LabelDocument } from "../document";
import type { PrinterAdapterId } from "../types";

/**
 * How labels reach paper (DATA-MODEL §12, ADR-017). Every adapter renders
 * the same LabelDocument (the job's snapshots through ./compose.ts):
 * browser -> a sheet for window.print(), pdf -> a PDF to open and print.
 * network_raw and bluetooth are Phase 12 (hardware) and unavailable.
 */
export interface PrinterAdapter<Output> {
  id: PrinterAdapterId;
  name: string;
  /** browser: the system print dialog; pdf: a file to open (Share -> Print on iOS). */
  delivery: "print-dialog" | "download";
  available: boolean;
  render(document: LabelDocument): Output;
}
