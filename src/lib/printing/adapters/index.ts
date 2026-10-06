import "server-only";

import type { PrinterAdapterId } from "../types";
import { browserAdapter } from "./browser";
import { pdfAdapter } from "./pdf";

/** A printer type that needs the hardware adapter (network_raw, bluetooth). */
export class AdapterUnavailableError extends Error {
  constructor(readonly adapter: PrinterAdapterId) {
    super(`The ${adapter} printer needs the hardware adapter, Phase 12.`);
    this.name = "AdapterUnavailableError";
  }
}

export function getAdapter(id: "browser"): typeof browserAdapter;
export function getAdapter(id: "pdf"): typeof pdfAdapter;
export function getAdapter(id: PrinterAdapterId): typeof browserAdapter | typeof pdfAdapter;
export function getAdapter(id: PrinterAdapterId) {
  switch (id) {
    case "browser":
      return browserAdapter;
    case "pdf":
      return pdfAdapter;
    default:
      throw new AdapterUnavailableError(id);
  }
}
