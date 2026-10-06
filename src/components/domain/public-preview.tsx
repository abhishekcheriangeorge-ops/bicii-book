import type { PublicPreview } from "@/lib/domain/inventory";
import { publicAvailabilityLabel } from "@/lib/inventory";
import { formatMoney } from "@/lib/money";

/** The panel's anchor on a product or unit page (the Labels card links to it). */
export const PUBLIC_PREVIEW_ID = "what-the-public-sees";

/**
 * "What the public sees" (server or client): the record's
 * reporting.public_items row, the only thing an anonymous scan of its QR
 * label can show (D9, D26): name, price, availability, condition for a
 * unit and how many public photos. Without a row: not public, and an
 * anonymous scan shows nothing. Read-only everywhere.
 */
export function PublicPreviewPanel({
  preview,
  id = PUBLIC_PREVIEW_ID,
}: {
  preview: PublicPreview | null;
  /** The in-page anchor the Labels card's "What the public sees" link jumps to. */
  id?: string;
}) {
  return (
    <section
      id={id}
      aria-label="What the public sees"
      className="flex scroll-mt-24 flex-col gap-2 rounded-xl bg-sunken p-3"
    >
      <h3 className="font-display text-xs font-bold tracking-wide uppercase">
        What the public sees
      </h3>
      {preview ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-dust-500">Name</dt>
          <dd className="font-medium break-words">{preview.name}</dd>
          <dt className="text-dust-500">Price</dt>
          <dd className="tabular-nums">
            {preview.salePrice === null
              ? "No price"
              : formatMoney(preview.salePrice, preview.currency)}
          </dd>
          <dt className="text-dust-500">Availability</dt>
          <dd>{publicAvailabilityLabel(preview.availability)}</dd>
          {preview.kind === "unit" ? (
            <>
              <dt className="text-dust-500">Condition</dt>
              <dd className="whitespace-pre-line">{preview.condition ?? "Not given"}</dd>
            </>
          ) : null}
          <dt className="text-dust-500">Photos</dt>
          <dd>
            {preview.photoCount === 1 ? "1 public photo" : `${preview.photoCount} public photos`}
          </dd>
        </dl>
      ) : (
        <p className="text-sm text-dust-700">Not public. Anonymous scans show nothing.</p>
      )}
    </section>
  );
}
