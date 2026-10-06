import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ReconciliationScope } from "@/components/domain/reports/reconciliation-scope";
import {
  StockReconciliationList,
  UnitReconciliationList,
} from "@/components/domain/reports/reconciliation-sections";
import { ExportLink, ReportSection } from "@/components/domain/reports/report-sections";
import { SectionLoader, SectionSkeleton } from "@/components/domain/today/section-loader";
import { CloseIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { hasPermission } from "@/lib/auth/permissions";
import { requireStaff } from "@/lib/auth/session";
import {
  getProductLabel,
  getStockReconciliation,
  getUnitReconciliation,
} from "@/lib/domain/reconciliation";
import {
  RECONCILIATION_MAX_ROWS,
  parseReconciliationParams,
  reconciliationExportParams,
  reconciliationHref,
} from "@/lib/reconciliation";
import { exportHref } from "@/lib/report-exports";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Stock reconciliation" };

const cappedNote = (n: number) =>
  n >= RECONCILIATION_MAX_ROWS ? (
    <p className="text-sm text-dust-500">
      Showing the first {RECONCILIATION_MAX_ROWS.toLocaleString("en-SG")}. Choose a product to see
      the rest.
    </p>
  ) : null;

/**
 * Stock reconciliation (Phase 9 step 4; SPEC §12, §26; PLAN D106;
 * ADR-022): the movement ledger is the stock, and this page checks the
 * records that summarise it (each unique item's status and location, unit
 * counts per product and location) against it. Read only (D106): rows
 * open the product or unit, and adjust_stock holders get a link to the
 * product page's Adjust stock, the guarded fix. State is in the URL:
 * `all=1` (Everything; default Problems only) and `product=<uuid>`.
 *
 * No loading.tsx under /reports (DESIGN "Loading"): requireStaff() first,
 * then each section streams in its own Suspense boundary.
 */
export default async function ReconciliationPage({
  searchParams,
}: PageProps<"/reports/reconciliation">) {
  const staff = await requireStaff();
  const params = parseReconciliationParams(await searchParams);
  const canAdjust = hasPermission(staff, "adjust_stock");
  const supabase = await createClient();
  const query = { onlyIssues: !params.all, productId: params.productId };
  const product = params.productId ? await getProductLabel(supabase, params.productId) : null;
  const exportParams = reconciliationExportParams(params);
  const suspenseKey = `${params.all ? "all" : "issues"}:${params.productId ?? ""}`;

  return (
    <>
      <PageHeader
        title="Stock reconciliation"
        description="Stock on hand is always the sum of the movement ledger. This page checks the records that summarise it — each unique item's status and location — against that ledger."
      />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <ReconciliationScope all={params.all} productId={params.productId} />
        {params.productId ? (
          <Link
            href={reconciliationHref({ all: params.all })}
            aria-label={`Remove the product filter${product ? `: ${product.shortId} ${product.name}` : ""}`}
            className="inline-flex min-h-12 items-center gap-2 rounded-full border-2 border-ink bg-ink px-4 text-sm font-semibold text-paper"
          >
            {product ? `${product.shortId} · ${product.name}` : "One product"}
            <CloseIcon className="size-4" />
          </Link>
        ) : null}
      </div>

      <Suspense key={`stock:${suspenseKey}`} fallback={<SectionSkeleton rows={4} />}>
        <SectionLoader
          name="stock-reconciliation"
          load={() => getStockReconciliation(supabase, query)}
        >
          {(rows) => {
            const negative = rows.filter((r) => r.issue === "negative_on_hand");
            const others = rows.filter((r) => r.issue !== "negative_on_hand");
            return (
              <>
                {negative.length > 0 ? (
                  <ReportSection
                    id="reconciliation-negative"
                    title="Stock below zero"
                    description="A job part may take stock below zero, so this is allowed but needs a count: adjust stock with a reason, or receive what is missing."
                  >
                    <StockReconciliationList
                      rows={negative}
                      canAdjust={canAdjust}
                      caption="Stock below zero"
                      empty="Nothing is below zero"
                    />
                  </ReportSection>
                ) : null}
                <ReportSection
                  id="reconciliation-products"
                  title="Products by location"
                  description="The ledger's on hand, and for unique products the items in stock there."
                  actions={
                    <ExportLink
                      href={exportHref("stock", exportParams)}
                      name="products by location"
                    />
                  }
                >
                  <StockReconciliationList
                    rows={others}
                    canAdjust={canAdjust}
                    caption="Products by location"
                    empty={
                      params.all
                        ? "No stock has moved yet"
                        : "Every product reconciles with the ledger"
                    }
                  />
                  {cappedNote(rows.length)}
                </ReportSection>
              </>
            );
          }}
        </SectionLoader>
      </Suspense>

      <Suspense key={`units:${suspenseKey}`} fallback={<SectionSkeleton rows={6} />}>
        <ReportSection
          id="reconciliation-units"
          title="Unique items"
          description="Each item's status and location against what its last movement says happened."
          actions={<ExportLink href={exportHref("units", exportParams)} name="unique items" />}
          className="pb-4"
        >
          <SectionLoader
            name="unit-reconciliation"
            load={() => getUnitReconciliation(supabase, query)}
          >
            {(rows) => (
              <>
                <UnitReconciliationList
                  rows={rows}
                  canAdjust={canAdjust}
                  caption="Unique items"
                  empty={
                    params.all ? "No unique items yet" : "Every item reconciles with the ledger"
                  }
                />
                {cappedNote(rows.length)}
              </>
            )}
          </SectionLoader>
        </ReportSection>
      </Suspense>
    </>
  );
}
