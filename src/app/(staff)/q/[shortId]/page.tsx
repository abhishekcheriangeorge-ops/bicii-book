import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { StatusScreen } from "@/components/shell/status-screen";
import { ButtonLink } from "@/components/ui/button";
import { requireStaff } from "@/lib/auth/session";
import { resolveShortId } from "@/lib/domain/scan";
import { parseShortId } from "@/lib/ids";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Open label" };

/**
 * The Admin's answer to a scanned or typed short ID (PLAN D9): staff
 * opening `/q/P-000123` (any case) land on the record; a code that matches
 * nothing says so, with Scan again and Search. The QR payload is the
 * public site's `{public_site_url}/q/{short_id}`; this route serves the
 * same path on the Admin's own origin for staff (the scanner, the header
 * search and anyone pasting a label URL here).
 *
 * The only Admin /q route: later phases extend resolveShortId
 * (src/lib/domain/scan.ts), never add routes. No loading.tsx here: a
 * loading boundary would commit the response (200) before the redirect
 * runs, turning a real 307 into a client-side hop (DESIGN.md "Loading").
 */
export default async function ShortIdPage({ params }: PageProps<"/q/[shortId]">) {
  await requireStaff();
  const { shortId: raw } = await params;
  const code = safeDecode(raw);
  const parsed = parseShortId(code);
  const target = parsed ? await resolveShortId(await createClient(), parsed.shortId) : null;
  if (target) redirect(target.href);

  const shown = parsed?.shortId ?? code.trim().slice(0, 40);
  return (
    <StatusScreen
      code="Not found"
      title={parsed ? `No record with ${shown}` : "That is not a BICII code"}
      actions={
        <>
          <ButtonLink href="/scan">Scan again</ButtonLink>
          <ButtonLink href={`/search?q=${encodeURIComponent(shown)}`} variant="outline">
            Search
          </ButtonLink>
        </>
      }
    >
      <p>
        {parsed
          ? "Nothing in the Admin has this number. Check the label, or search for the item by name or serial number."
          : "BICII codes look like P-000123 or B-000045. Check the label, or search for the item by name or serial number."}
      </p>
    </StatusScreen>
  );
}

/** Params may arrive still percent-encoded; a malformed escape is kept as typed. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
