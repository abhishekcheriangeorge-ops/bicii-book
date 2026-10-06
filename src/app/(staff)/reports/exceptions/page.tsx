import type { Metadata } from "next";
import { Suspense } from "react";

import { AlertDaysControl } from "@/components/domain/reports/alert-days-control";
import { ExportLink } from "@/components/domain/reports/report-sections";
import { ExceptionList, type ExceptionRowAction } from "@/components/domain/today/exception-list";
import { SectionLoader, SectionSkeleton } from "@/components/domain/today/section-loader";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { CheckIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { requireStaff } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";
import {
  getConsignmentAlertDays,
  getExceptionCounts,
  getUnitProductIds,
} from "@/lib/domain/reconciliation";
import { getOperationalExceptions } from "@/lib/domain/reports";
import {
  EXCEPTIONS_MAX_ROWS,
  EXCEPTION_SECTIONS,
  alertDaysLabel,
  exceptionTotal,
  exceptionsCappedNote,
  groupExceptions,
  reconciliationHref,
  type ExceptionCount,
} from "@/lib/reconciliation";
import type { OperationalException } from "@/lib/reports";
import { exportHref } from "@/lib/report-exports";
import { createClient, type ServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Exceptions" };

/** Kinds whose rows also link to stock reconciliation for their product. */
const STOCK_KINDS: ReadonlySet<string> = new Set([
  "negative_stock",
  "unit_state_mismatch",
  "unit_hold_stale",
]);

/**
 * Exceptions (Phase 9 step 4; SPEC §19.1, §22, §26; PLAN D34, D106–D108):
 * every operational exception the caller may see (D108 decides per kind,
 * in the database), grouped by what is wrong, most serious first. Read
 * only: each row opens its record, where the guarded fix lives (D106).
 *
 * No loading.tsx under /reports (DESIGN "Loading"): requireStaff() runs
 * first, then each part streams in its own Suspense boundary. The admin
 * sees the unsettled-consignment threshold with Change (D107); everyone
 * else sees it as text.
 */
export default async function ExceptionsPage() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const admin = staff.role === "admin";

  return (
    <>
      <PageHeader
        title="Exceptions"
        description="Things the records say cannot be right, or that need someone's attention. They clear themselves when the cause is fixed."
        actions={<ExportLink href={exportHref("exceptions", {})} name="exceptions" />}
      />
      <Suspense fallback={<SectionSkeleton rows={1} />}>
        <SectionLoader name="alert-days" load={() => getConsignmentAlertDays(supabase)}>
          {(days) =>
            admin ? (
              <AlertDaysControl days={days} />
            ) : (
              <p className="text-sm">{alertDaysLabel(days)}</p>
            )
          }
        </SectionLoader>
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={6} />}>
        <SectionLoader name="exceptions" load={() => loadExceptions(supabase)}>
          {(data) => <ExceptionSections {...data} />}
        </SectionLoader>
      </Suspense>
    </>
  );
}

async function loadExceptions(supabase: ServerSupabase) {
  const [rows, counts] = await Promise.all([
    getOperationalExceptions(supabase, EXCEPTIONS_MAX_ROWS),
    getExceptionCounts(supabase),
  ]);
  const unitIds = rows
    .filter((r) => r.entityType === "inventory_unit" && STOCK_KINDS.has(r.kind))
    .map((r) => r.entityId);
  const unitProducts = await getUnitProductIds(supabase, unitIds);
  return { rows, counts, unitProducts, checkedAt: new Date().toISOString() };
}

function ExceptionSections({
  rows,
  counts,
  unitProducts,
  checkedAt,
}: {
  rows: OperationalException[];
  counts: ExceptionCount[];
  unitProducts: Map<string, string>;
  checkedAt: string;
}) {
  const total = Math.max(exceptionTotal(counts), rows.length);
  if (rows.length === 0) {
    return (
      <EmptyState
        tone="done"
        icon={<CheckIcon className="size-6" />}
        title="No exceptions"
        description={
          <>
            Checked <time dateTime={checkedAt}>{formatDateTime(checkedAt)}</time>. Nothing needs
            attention that you can see.
          </>
        }
      />
    );
  }
  const capped = exceptionsCappedNote(rows.length, total);
  const action = (row: OperationalException): ExceptionRowAction | null => {
    if (!STOCK_KINDS.has(row.kind)) return null;
    const productId =
      row.entityType === "product"
        ? row.entityId
        : row.entityType === "inventory_unit"
          ? unitProducts.get(row.entityId)
          : undefined;
    return productId
      ? {
          href: reconciliationHref({ all: true, productId }),
          label: "Open stock reconciliation",
        }
      : null;
  };
  const countOf = (kinds: readonly string[], listed: number) => {
    const n = counts.filter((c) => kinds.includes(c.kind)).reduce((a, c) => a + c.count, 0);
    return Math.max(n, listed);
  };
  const known = EXCEPTION_SECTIONS.map((s) => [s.id, s.kinds as readonly string[]] as const);
  return (
    <div className="flex flex-col gap-8 pb-4">
      <p className="text-sm text-dust-500 tabular-nums">
        {total === 1 ? "1 exception" : `${total} exceptions`}, checked{" "}
        <time dateTime={checkedAt}>{formatDateTime(checkedAt)}</time>.{capped ? ` ${capped}` : null}
      </p>
      {groupExceptions(rows).map((section) => {
        const kinds = known.find(([id]) => id === section.id)?.[1] ?? [];
        const headingId = `exceptions-${section.id}`;
        return (
          <section key={section.id} aria-labelledby={headingId} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={headingId} className="text-2xl leading-tight">
                {section.title}
              </h2>
              <Badge tone="neutral">{countOf(kinds, section.rows.length)}</Badge>
            </div>
            {section.id === "negative" ? (
              <p className="text-sm text-dust-500">
                A job part may take stock below zero. Count the shelf and adjust stock with a
                reason, or receive the stock that is missing.
              </p>
            ) : null}
            <ExceptionList rows={section.rows} label={section.title} detailed action={action} />
          </section>
        );
      })}
    </div>
  );
}
