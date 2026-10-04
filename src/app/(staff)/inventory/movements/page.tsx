import type { Metadata } from "next";

import { MovementList } from "@/components/domain/movement-list";
import { ActiveFilterChips, GroupChips, LinkSegments } from "@/components/domain/workshop-board";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { BoxIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { hasPermission } from "@/lib/auth/permissions";
import { requireStaff } from "@/lib/auth/session";
import { listLocations, listMovements, productLabel } from "@/lib/domain/inventory";
import { MOVEMENT_FILTERS, isMovementFilter, type MovementFilter } from "@/lib/inventory";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

export const metadata: Metadata = { title: "Stock movements" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Every stock movement, newest first (SPEC §12, §23: the ledger, never
 * edited; corrections are linked reversals). Filters live in the URL: a
 * product (?product=, a removable chip with its name), a location
 * (?location=) and the kind (?type= Jobs, Adjustments, Transfers). Each
 * row: time (Singapore), what, the product, the signed quantity, where,
 * who, why, the job and the reversal links; the unit cost only for
 * view_costs holders. "Load more" pages back with ?before=<id>.
 */
export default async function MovementsPage({ searchParams }: PageProps<"/inventory/movements">) {
  const staff = await requireStaff();
  const params = await searchParams;
  const productId = isUuid(first(params.product)) ? first(params.product) : null;
  const locationId = isUuid(first(params.location)) ? first(params.location) : null;
  const typeParam = first(params.type);
  const type: MovementFilter = isMovementFilter(typeParam) ? typeParam : "all";
  const beforeParam = first(params.before);
  const before = /^\d{1,15}$/.test(beforeParam) ? Number(beforeParam) : undefined;
  const viewCosts = hasPermission(staff, "view_costs");
  const supabase = await createClient();
  const [page, locations, product] = await Promise.all([
    listMovements(
      supabase,
      {
        productId: productId ?? undefined,
        locationId: locationId ?? undefined,
        types: MOVEMENT_FILTERS[type].types,
        before,
      },
      { viewCosts },
    ),
    listLocations(supabase),
    productId ? productLabel(supabase, productId) : Promise.resolve(null),
  ]);

  /** This page's URL with `changes` applied (null removes); paging always restarts. */
  const href = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams();
    const current: Record<string, string | null> = {
      product: productId,
      location: locationId,
      type: type === "all" ? null : type,
    };
    for (const [k, v] of Object.entries({ ...current, ...changes })) if (v) next.set(k, v);
    const s = next.toString();
    return `/inventory/movements${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Stock movements"
        description="Every change to stock, newest first. Nothing is edited or deleted: a correction is a reversal linked to the original."
        actions={
          <ButtonLink href="/inventory" variant="outline">
            Inventory
          </ButtonLink>
        }
      />
      <div className="flex flex-col gap-3">
        <ActiveFilterChips
          chips={
            productId
              ? [
                  {
                    key: "product",
                    text: product ? `${product.name} (${product.shortId})` : "Unknown product",
                    removeHref: href({ product: null }),
                  },
                ]
              : []
          }
          clearHref={href({ product: null, location: null, type: null })}
        />
        <LinkSegments
          label="Location"
          options={[
            {
              key: "all",
              text: "All locations",
              href: href({ location: null }),
              current: !locationId,
            },
            ...locations.locations.map((l) => ({
              key: l.id,
              text: l.active ? l.name : `${l.name} (inactive)`,
              href: href({ location: l.id }),
              current: l.id === locationId,
            })),
          ]}
        />
        <GroupChips
          label="Kind of movement"
          options={(Object.keys(MOVEMENT_FILTERS) as MovementFilter[]).map((key) => ({
            key,
            text: MOVEMENT_FILTERS[key].label,
            href: href({ type: key === "all" ? null : key }),
            current: key === type,
          }))}
        />
      </div>
      <section aria-labelledby="movement-results" className="flex flex-col gap-3">
        <h2 id="movement-results" className="eyebrow text-dust-500">
          {before !== undefined ? `Before #${before}` : "Newest first"}
        </h2>
        {page.items.length === 0 ? (
          <EmptyState
            icon={<BoxIcon />}
            title="No movements"
            description={
              productId || locationId || type !== "all"
                ? "Nothing matches these filters. Remove one to see more."
                : "Opening stock, parts used on jobs, adjustments and transfers appear here."
            }
          />
        ) : (
          <div className="rounded-2xl border border-hairline bg-card p-4">
            <MovementList movements={page.items} />
          </div>
        )}
        {page.nextBefore !== null ? (
          <div>
            <ButtonLink
              href={`${href({})}${href({}).includes("?") ? "&" : "?"}before=${page.nextBefore}`}
              variant="outline"
            >
              Load more
            </ButtonLink>
          </div>
        ) : null}
      </section>
    </>
  );
}
