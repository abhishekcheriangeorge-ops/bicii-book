import Link from "next/link";

import { StatusPill } from "@/components/ui/status-pill";

import { CopyText } from "./copy-text";

/**
 * A record's "QR label URL" (PLAN D9, ADR-017): the URL its label encodes,
 * `{shop_settings.public_site_url}/q/{short id}`, from src/lib/qr.ts
 * (qrUrl), with Copy. Null when the shop's public website address is
 * missing or malformed: "QR address not set" (danger), because the
 * database prints no label then either; admins get a link to where it is
 * set. Server or client (it renders inside PublicationControls).
 */
export function QrLabelUrl({ value, isAdmin }: { value: string | null; isAdmin: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="font-display text-xs font-bold tracking-wide uppercase">QR label URL</h3>
      {value !== null ? (
        <CopyText value={value} label="QR label URL" />
      ) : (
        <p className="flex flex-wrap items-center gap-2 text-sm text-dust-700">
          <StatusPill status="danger">QR address not set</StatusPill>
          <span>
            Labels can&apos;t be printed until the shop&apos;s public website address is set.
            {isAdmin ? (
              <>
                {" "}
                <Link href="/settings" className="font-medium underline">
                  Set it in Settings
                </Link>
                .
              </>
            ) : (
              " Ask an admin to set it."
            )}
          </span>
        </p>
      )}
    </div>
  );
}
