import type { Metadata } from "next";

import {
  EditLocationButton,
  LocationActiveSwitch,
  NewLocationButton,
} from "@/components/domain/location-controls";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { BoxIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { hasPermission } from "@/lib/auth/permissions";
import { requireStaff } from "@/lib/auth/session";
import { listLocations } from "@/lib/domain/inventory";
import { LOCATION_KIND_LABELS } from "@/lib/inventory";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Locations" };

/**
 * Stock locations (SPEC §11, §12): every staff member sees where stock is
 * kept and which location is the default (the active one with the lowest
 * sort order, then name: where new stock and parts come from unless staff
 * choose). manage_inventory adds, renames and reorders locations in a
 * sheet and switches them on or off at once; one still holding stock
 * cannot be switched off (location_has_stock). Nothing is ever deleted.
 */
export default async function LocationsSettingsPage() {
  const staff = await requireStaff();
  const manage = hasPermission(staff, "manage_inventory");
  const { locations, defaultLocationId } = await listLocations(await createClient());

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Locations"
        description="Where stock is kept. New stock and parts come from the default location unless someone chooses another."
        actions={manage ? <NewLocationButton /> : null}
      />
      {locations.length === 0 ? (
        <EmptyState
          icon={<BoxIcon />}
          title="No locations yet"
          description={
            manage
              ? "Add the places stock is kept: the shop floor, the workshop store."
              : "Ask someone with inventory access to add one."
          }
        />
      ) : (
        <ul
          aria-label="Locations"
          className="divide-y divide-hairline rounded-2xl border border-hairline bg-card"
        >
          {locations.map((l) => (
            <li
              key={l.id}
              aria-label={l.name}
              className="flex min-h-16 flex-wrap items-center gap-3 px-4 py-3"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className={l.active ? "font-medium" : "font-medium text-dust-500"}>
                    {l.name}
                  </span>
                  {l.id === defaultLocationId ? <Badge tone="done">Default</Badge> : null}
                  {!l.active ? <Badge>Inactive</Badge> : null}
                </span>
                <span className="text-sm text-dust-500">
                  {LOCATION_KIND_LABELS[l.kind]} · Sort order {l.sortOrder}
                </span>
              </span>
              {manage ? (
                <span className="flex items-center gap-2">
                  <LocationActiveSwitch location={l} />
                  <EditLocationButton location={l} />
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-dust-700">
        A location holding stock can&apos;t be switched off; move or adjust its stock to zero first.
      </p>
    </>
  );
}
