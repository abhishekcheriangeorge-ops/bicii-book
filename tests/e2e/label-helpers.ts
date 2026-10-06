import type { Page } from "@playwright/test";
import { PDFArray, PDFDict, PDFName, PDFString, type PDFDocument } from "pdf-lib";

import { SHOP } from "../fixtures/ids";

/**
 * Label assertions shared by the Phase 8 specs and the journeys that print
 * (print-view.spec.ts, labels.spec.ts, inventory.spec.ts journey 3,
 * consignment-journey.spec.ts journey 4). Payloads are compared by exact
 * equality against the DATABASE QR base (shop_settings.public_site_url,
 * SHOP.publicSiteUrl; PLAN D9, ADR-017), never the environment's scan-only
 * base.
 */

/** The database QR base every label encodes, without a trailing slash. */
export const QR_BASE = SHOP.publicSiteUrl.replace(/\/+$/, "");

/** The exact QR payload of a label for `shortId` (private.qr_payload). */
export const qrPayloadFor = (shortId: string) => `${QR_BASE}/q/${shortId}`;

/** The data-qr-payload of every `[data-label]` on the print view, in order. */
export async function labelPayloads(page: Page): Promise<(string | null)[]> {
  return page
    .locator("[data-label]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-qr-payload")));
}

/** The URI of every link annotation in a label PDF, page by page. */
export function pdfLinkUris(pdf: PDFDocument): string[] {
  return pdf.getPages().flatMap((page) => {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    return (annots?.asArray() ?? []).map((ref) =>
      pdf.context
        .lookup(ref, PDFDict)
        .lookup(PDFName.of("A"), PDFDict)
        .lookup(PDFName.of("URI"), PDFString)
        .decodeText(),
    );
  });
}
