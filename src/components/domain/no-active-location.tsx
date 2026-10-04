import Link from "next/link";

/**
 * The empty state of every place that needs a stock location when none is
 * active (location_required): says so and links to Settings → Locations,
 * where manage_inventory holders add or reactivate one.
 */
export function NoActiveLocation() {
  return (
    <>
      No active stock location. Ask someone with inventory access to add one in{" "}
      <Link
        href="/settings/locations"
        className="font-medium text-ink underline underline-offset-2"
      >
        Settings → Locations
      </Link>
      .
    </>
  );
}
