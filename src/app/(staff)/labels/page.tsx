import type { Metadata } from "next";

import { SearchField } from "@/components/domain/search-field";
import { ShortId } from "@/components/domain/short-id";
import { LinkSegments } from "@/components/domain/workshop-board";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { BikeIcon, BoxIcon, ChevronRightIcon, PrinterIcon, TagIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink, RowList } from "@/components/ui/row-list";
import { StatusPill } from "@/components/ui/status-pill";
import { requireStaff } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";
import {
  decodeCursor,
  encodeCursor,
  listPrintJobs,
  type PrintJobFilter,
} from "@/lib/domain/labels";
import { printStatusLabel, printStatusTone } from "@/lib/printing/job";
import type { LabelKind } from "@/lib/printing/types";
import { readQuery, withParam } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Labels" };

const FILTERS: { key: PrintJobFilter; text: string }[] = [
  { key: "all", text: "All" },
  { key: "open", text: "To confirm" },
  { key: "failed", text: "Failed" },
];

const KIND_ICONS: Record<LabelKind, typeof BoxIcon> = {
  product: BoxIcon,
  unit: TagIcon,
  bike: BikeIcon,
};

const readFilter = (v: string | string[] | undefined): PrintJobFilter => {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "open" || s === "failed" ? s : "all";
};

/**
 * Print history (SPEC §16; PLAN D59): every print job, newest first. All,
 * To confirm (queued or rendered: sent but not confirmed) and Failed, as
 * links that keep the search; search by short ID (exact) or the label's
 * name. Each row: what was labelled, how many, the printer, who and when,
 * and the status. "Show more" continues after the last row.
 */
export default async function LabelsPage({ searchParams }: PageProps<"/labels">) {
  await requireStaff();
  const params = await searchParams;
  const q = readQuery(params.q);
  const filter = readFilter(params.status);
  const before = decodeCursor(Array.isArray(params.before) ? params.before[0] : params.before);
  const { items, more, next } = await listPrintJobs(await createClient(), { filter, q, before });
  const base = (f: PrintJobFilter) => withParam(f === "all" ? "" : `status=${f}`, "q", q);

  return (
    <>
      <PageHeader title="Labels" description="Every label print, newest first." />
      <div className="flex flex-col gap-3">
        <SearchField label="Search labels" hint="Short ID or name" placeholder="Short ID or name" />
        <LinkSegments
          label="Show print jobs"
          options={FILTERS.map((f) => ({
            key: f.key,
            text: f.text,
            href: `/labels${base(f.key)}`,
            current: filter === f.key,
          }))}
        />
      </div>
      <section aria-labelledby="label-results" className="flex flex-col gap-2">
        <h2 id="label-results" className="eyebrow text-dust-500">
          {q
            ? `${items.length}${more ? "+" : ""} ${items.length === 1 ? "match" : "matches"}`
            : (FILTERS.find((f) => f.key === filter)?.text ?? "All")}
          {before ? " (older)" : ""}
        </h2>
        {items.length === 0 ? (
          <EmptyState
            icon={<PrinterIcon />}
            title={
              q
                ? `No labels match “${q}”`
                : filter === "open"
                  ? "Nothing to confirm"
                  : filter === "failed"
                    ? "No failed prints"
                    : "No labels printed yet"
            }
            description={
              q
                ? "Try the P-, U- or B- number on the label, or part of the name."
                : "Open a product, unit or bike and tap Print label."
            }
          />
        ) : (
          <RowList label="Print jobs">
            {items.map((j) => {
              const Icon = KIND_ICONS[j.kind];
              return (
                <RowLink key={j.id} href={`/labels/${j.id}`}>
                  <Icon aria-hidden="true" className="size-6 shrink-0 text-dust-500" />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <ShortId value={j.shortId} />
                      <StatusPill status={printStatusTone(j.status)}>
                        {printStatusLabel(j.status)}
                      </StatusPill>
                    </span>
                    <span className="font-medium break-words">{j.name}</span>
                    <span className="text-sm text-dust-500">
                      {j.quantity} × · {j.printerName} · {j.requestedBy} ·{" "}
                      <time dateTime={j.createdAt}>{formatDateTime(j.createdAt)}</time>
                    </span>
                    {j.status === "failed" && j.error ? (
                      <span className="text-sm text-danger-deep">{j.error}</span>
                    ) : null}
                  </span>
                  <ChevronRightIcon className="size-5 shrink-0 text-dust-500" />
                </RowLink>
              );
            })}
          </RowList>
        )}
        {more && next ? (
          <div>
            <ButtonLink
              href={`/labels${withParam(base(filter), "before", encodeCursor(next))}`}
              variant="outline"
            >
              Show more
            </ButtonLink>
          </div>
        ) : null}
      </section>
    </>
  );
}
