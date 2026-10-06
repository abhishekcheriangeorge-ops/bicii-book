import type { Metadata } from "next";

import { ShortId } from "@/components/domain/short-id";
import { LinkSegments } from "@/components/domain/workshop-board";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { BoxIcon, ChevronRightIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink, RowList } from "@/components/ui/row-list";
import { StatusPill } from "@/components/ui/status-pill";
import { requireAdmin } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";
import { listSyncedProducts } from "@/lib/domain/shopify";
import { PRODUCT_FILTERS, readProductFilter, syncStatusLabel, syncStatusTone } from "@/lib/shopify";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Shopify products" };

/**
 * Products BICII publishes or links to Shopify (admins; D84, D86): All,
 * Errors, Pending. Each row: name and P- number, the sync status, when it
 * last synced and the quantity Shopify was given, the error reason, and
 * "Shopify-made" for a product linked to one made in Shopify (price and
 * stock only). Tapping opens the product, where Sync now lives.
 */
export default async function ShopifyProductsPage({
  searchParams,
}: PageProps<"/shopify/products">) {
  await requireAdmin();
  const filter = readProductFilter((await searchParams).filter);
  const { items, more } = await listSyncedProducts(await createClient(), { filter });

  return (
    <>
      <PageHeader eyebrow="Shopify" title="Products" description="What BICII sends to Shopify." />
      <div className="mb-4">
        <LinkSegments
          label="Sync status"
          options={PRODUCT_FILTERS.map((f) => ({
            key: f.key,
            text: f.label,
            href: f.key === "all" ? "/shopify/products" : `/shopify/products?filter=${f.key}`,
            current: filter === f.key,
          }))}
        />
      </div>
      {more ? (
        <p className="mb-2 text-sm text-dust-700">Showing the first {items.length}.</p>
      ) : null}
      {items.length === 0 ? (
        <EmptyState
          icon={<BoxIcon className="size-6" />}
          title={filter === "all" ? "No product is online yet" : "Nothing here"}
          description="Switch on Publish online on a product's page to sell it on Shopify."
        />
      ) : (
        <RowList label="Products on Shopify">
          {items.map((p) => (
            <RowLink key={p.productId} href={`/products/${p.productId}`}>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <ShortId value={p.shortId} />
                  <StatusPill status={syncStatusTone(p.syncStatus)}>
                    {syncStatusLabel(p.syncStatus)}
                  </StatusPill>
                  {p.origin === "external" ? <Badge>Shopify-made</Badge> : null}
                  {!p.publishOnline ? <Badge>Not published</Badge> : null}
                </span>
                <span className="font-medium break-words">{p.name}</span>
                <span className="text-sm text-dust-500 tabular-nums">
                  {p.lastPushedAt ? `Synced ${formatDateTime(p.lastPushedAt)}` : "Never synced"}
                  {p.lastPushedQuantity !== null ? ` · quantity ${p.lastPushedQuantity}` : ""}
                </span>
                {p.syncStatus === "error" && p.lastError ? (
                  <span className="line-clamp-2 text-sm text-danger-deep">{p.lastError}</span>
                ) : null}
              </span>
              <ChevronRightIcon className="size-5 shrink-0 text-dust-500" />
            </RowLink>
          ))}
        </RowList>
      )}
    </>
  );
}
