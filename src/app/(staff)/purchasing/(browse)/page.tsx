import type { Metadata } from "next";

import { LinkSegments } from "@/components/domain/workshop-board";
import { NewPurchaseOrderButton } from "@/components/domain/purchasing/purchase-order-sheet";
import { PurchaseOrderStatusPill } from "@/components/domain/purchasing/purchase-order-status-pill";
import { SearchField } from "@/components/domain/search-field";
import { ShortId } from "@/components/domain/short-id";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ChevronRightIcon, TruckIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink, RowList } from "@/components/ui/row-list";
import { requireStaff } from "@/lib/auth/session";
import { listPurchaseOrders } from "@/lib/domain/purchasing";
import {
  PURCHASE_ORDER_FILTERS,
  canManagePurchasing,
  formatExpected,
  isPurchaseOrderFilter,
  progressText,
  type PurchaseOrderFilter,
} from "@/lib/purchasing";
import { readQuery, withParam } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Purchasing" };

const EMPTY: Record<PurchaseOrderFilter, { title: string; description: string }> = {
  open: {
    title: "No open orders",
    description:
      "Orders you submit wait here until everything has arrived. Start one with New order.",
  },
  draft: {
    title: "No drafts",
    description: "A new order starts as a draft: add its lines, then submit it.",
  },
  closed: {
    title: "No closed orders yet",
    description: "Fully received and cancelled orders are listed here.",
  },
  all: {
    title: "No purchase orders yet",
    description: "Order stock from a supplier with New order.",
  },
};

/**
 * Purchase orders (SPEC §14, §21): search by PO number (however typed),
 * supplier or supplier reference; Open (submitted and partially received,
 * the default), Drafts, Closed and All as links keeping ?q= (a search
 * without a chosen filter looks at every order). Each row: PO number,
 * supplier, status, progress and the expected date or "Overdue"
 * (reporting.purchase_order_progress). New order for manage_purchasing.
 */
export default async function PurchasingPage({ searchParams }: PageProps<"/purchasing">) {
  const staff = await requireStaff();
  const params = await searchParams;
  const q = readQuery(params.q);
  const raw = Array.isArray(params.status) ? params.status[0] : params.status;
  const status: PurchaseOrderFilter = isPurchaseOrderFilter(raw) ? raw : q ? "all" : "open";
  const manage = canManagePurchasing(staff);
  const { items: orders, more } = await listPurchaseOrders(await createClient(), { q, status });

  const filters = (Object.keys(PURCHASE_ORDER_FILTERS) as PurchaseOrderFilter[]).map((key) => ({
    key,
    text: PURCHASE_ORDER_FILTERS[key].label,
    href: `/purchasing${withParam(new URLSearchParams({ status: key }), "q", q)}`,
    current: key === status,
  }));
  const label = PURCHASE_ORDER_FILTERS[status].label;
  const heading = q
    ? more
      ? `First ${orders.length} matches`
      : `${orders.length} ${orders.length === 1 ? "match" : "matches"}`
    : status === "all"
      ? "Newest first"
      : `${label} · newest first`;

  return (
    <>
      <PageHeader title="Purchasing" actions={manage ? <NewPurchaseOrderButton /> : null} />
      <div className="flex flex-col gap-3">
        <SearchField
          label="Search purchase orders"
          hint="PO number, supplier or the supplier's reference"
          placeholder="Search orders"
        />
        <LinkSegments label="Which orders" options={filters} />
      </div>
      <section aria-labelledby="po-results" className="flex flex-col gap-2">
        <h2 id="po-results" className="eyebrow text-dust-500">
          {heading}
        </h2>
        {more ? (
          <p className="text-sm text-dust-700">
            {q
              ? "There are more. Type more of the PO number or supplier to narrow it down."
              : "Showing the newest 30. Search by PO number or supplier to find an older one."}
          </p>
        ) : null}
        {orders.length === 0 ? (
          <EmptyState
            icon={<TruckIcon />}
            title={
              q
                ? `No ${status === "all" ? "" : `${label.toLowerCase()} `}order matches “${q}”`
                : EMPTY[status].title
            }
            description={
              q
                ? status === "all"
                  ? "Try the PO number (PO-000012), the supplier's name or their reference."
                  : "Try All, or the PO number, the supplier's name or their reference."
                : manage || status !== "open"
                  ? EMPTY[status].description
                  : "Orders submitted to suppliers wait here until everything has arrived."
            }
            action={manage && !q && status !== "closed" ? <NewPurchaseOrderButton /> : undefined}
          />
        ) : (
          <RowList label="Purchase orders">
            {orders.map((o) => (
              <RowLink key={o.id} href={`/purchasing/orders/${o.id}`}>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <ShortId value={o.poNumber} />
                    <span className="truncate font-medium">{o.supplier.name}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-sm text-dust-500">
                    <PurchaseOrderStatusPill status={o.status} />
                    <span className="tabular-nums">
                      {o.lineCount === 0 ? "No lines yet" : progressText(o)}
                    </span>
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1 text-sm">
                  {o.overdue ? (
                    <Badge tone="danger" emphasis="solid">
                      Overdue
                    </Badge>
                  ) : o.expectedAt && o.status !== "received" && o.status !== "cancelled" ? (
                    <span className="text-dust-700">Expected {formatExpected(o.expectedAt)}</span>
                  ) : null}
                </span>
                <ChevronRightIcon className="size-5 shrink-0 text-dust-500" />
              </RowLink>
            ))}
          </RowList>
        )}
      </section>
    </>
  );
}
