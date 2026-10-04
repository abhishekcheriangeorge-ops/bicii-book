/**
 * The publication and unit-status state machines, mirrored from the
 * database (PLAN D25 SOLD-AT-COMPLETION, D26 PUBLICATION-MACHINE;
 * DATA-MODEL §6, §11). The database is authoritative:
 * private.publication_transition_allowed and
 * private.unit_status_transition_allowed decide in the products and
 * inventory_units triggers, and tests/db/inventory-catalog.test.ts compares
 * these tables with them pair by pair. The app uses this copy to offer only
 * the moves the database will accept. Pure.
 */
import { Constants, type Database } from "@/lib/database.types";

export type PublicationStatus = Database["public"]["Enums"]["publication_status"];
export type UnitStatus = Database["public"]["Enums"]["unit_status"];
export type TrackingType = Database["public"]["Enums"]["tracking_type"];

export const PUBLICATION_STATUSES: readonly PublicationStatus[] =
  Constants.public.Enums.publication_status;
export const UNIT_STATUSES: readonly UnitStatus[] = Constants.public.Enums.unit_status;

/**
 * Every allowed publication move (D26). `sold` is entered only by a sale
 * (job completion; Phases 6 and 10), never by hand, and only for unique
 * products; `sold → public` is the system restore when a sold unit returns
 * to stock.
 */
export const PUBLICATION_TRANSITIONS: Readonly<
  Record<PublicationStatus, readonly PublicationStatus[]>
> = {
  draft: ["internal_only", "archived"],
  internal_only: ["public", "archived"],
  public: ["internal_only", "sold", "archived"],
  sold: ["public", "archived"],
  archived: ["internal_only"],
};

/**
 * Every allowed unit status move. `sold → held_for_customer` happens only
 * when the unit's job is reopened (D25).
 */
export const UNIT_STATUS_TRANSITIONS: Readonly<Record<UnitStatus, readonly UnitStatus[]>> = {
  available: ["reserved", "held_for_customer", "sold", "returned_to_consignor", "written_off"],
  reserved: ["available", "held_for_customer", "sold"],
  held_for_customer: ["available", "sold"],
  sold: ["available", "held_for_customer"],
  written_off: ["available"],
  returned_to_consignor: [],
};

/** Whether a product may move from `from` to `to` (same status: false, a replay). */
export function canChangePublication(from: PublicationStatus, to: PublicationStatus): boolean {
  return PUBLICATION_TRANSITIONS[from].includes(to);
}

/** Whether a unit may move from `from` to `to` (same status: false, a replay). */
export function canChangeUnitStatus(from: UnitStatus, to: UnitStatus): boolean {
  return UNIT_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * The publication targets staff may choose by hand (Step 2's
 * set_publication_status): never `sold` (sales set it), from `sold` only
 * `archived` (the way back to public is a returned unit), and no `public`
 * for a unique product without an available unit.
 */
export function manualPublicationTargets(
  from: PublicationStatus,
  { trackingType, availableUnits }: { trackingType: TrackingType; availableUnits: number },
): PublicationStatus[] {
  if (from === "sold") return ["archived"];
  return PUBLICATION_TRANSITIONS[from].filter(
    (to) => to !== "sold" && !(to === "public" && trackingType === "unique" && availableUnits < 1),
  );
}
