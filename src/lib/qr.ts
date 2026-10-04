import "server-only";

import { getPublicEnv } from "@/lib/env";
import { qrPayload } from "@/lib/ids";

/**
 * The QR base: the one place the Admin decides what a label's URL starts
 * with (PLAN D9: the payload is exactly `{public_site_url}/q/{short_id}`).
 *
 * Phase 8 replaces the body with the database QR base
 * (shop_settings.public_site_url, as label_preview reads it) and adds that
 * base to scanBases(); every QR shown or scanned goes through here, so that
 * is a change in this file only. Async already, because Phase 8 reads it
 * from the database.
 */
export async function getQrBase(): Promise<string> {
  return getPublicEnv().NEXT_PUBLIC_PUBLIC_SITE_URL;
}

/** A record's QR URL, `{base}/q/{shortId}` (what its label encodes). */
export async function qrUrl(shortId: string): Promise<string> {
  return qrPayload(await getQrBase(), shortId);
}

/**
 * The public bases the scanner accepts as BICII labels (interpretScan,
 * src/lib/scan.ts). Phase 8 adds the database QR base here, keeping the
 * environment's so labels printed before a change still scan.
 */
export async function scanBases(): Promise<string[]> {
  return [await getQrBase()];
}
