/**
 * How a bike is named on screen. Mirrors private.search_bikes, which builds
 * staff_search titles and subtitles the same way, so a bike reads the same
 * in a list, in search and on its own page. Pure.
 */

export type BikeName = {
  brand: string;
  model: string;
  variant?: string | null;
};

/** "Specialized Tarmac SL7 Expert" */
export function bikeTitle(b: BikeName): string {
  return [b.brand, b.model, b.variant]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(" ");
}

/** "Gloss Red Tint · S/N WSBC604123456N", or null when neither is known. */
export function bikeDetails(b: {
  colour?: string | null;
  serialNumber?: string | null;
}): string | null {
  const serial = b.serialNumber?.trim();
  return (
    [b.colour?.trim() || null, serial ? `S/N ${serial}` : null].filter(Boolean).join(" · ") || null
  );
}

/** "Tan Wei Ming · Gloss Red Tint · S/N WSBC604123456N"; "Shop bike" when nobody owns it. */
export function bikeSubtitle(b: {
  ownerLabel: string | null;
  colour?: string | null;
  serialNumber?: string | null;
}): string {
  return [b.ownerLabel ?? "Shop bike", bikeDetails(b)].filter(Boolean).join(" · ");
}
