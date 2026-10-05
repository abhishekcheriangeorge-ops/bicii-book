import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PrintJobControls } from "@/components/domain/print-job-controls";
import { PrintJobOutcome } from "@/components/domain/print-job-outcome";
import { ShortId } from "@/components/domain/short-id";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { StatusPill } from "@/components/ui/status-pill";
import { requireStaff } from "@/lib/auth/session";
import { getPrintJob } from "@/lib/domain/labels";
import { LabelSheet } from "@/lib/printing/adapters/browser";
import { buildLabelDocument } from "@/lib/printing/document";
import { isPrintable, printStatusLabel, printStatusTone } from "@/lib/printing/job";
import { pdfPath, recordPath } from "@/lib/printing/links";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

export const metadata: Metadata = { title: "Print labels" };

/**
 * The print view of one job (SPEC §15, §16; PLAN D56, D59; DATA-MODEL §12).
 * The sheet is rendered from the job's snapshots only (buildLabelDocument):
 * on screen the labels in a grid with "1 of 10" captions; printed, exactly
 * one label per page of the template's size (@page from the snapshot).
 *
 * Open jobs (queued, rendered) get PrintJobControls: Print (browser
 * printer) or Open PDF (PDF printer), then the confirmation. Finished jobs
 * (printed, failed) are history: an outcome banner and "Print again" (a
 * new job from the record page, D59); their sheet does not print.
 */
export default async function PrintLabelsPage({ params }: PageProps<"/print/labels/[jobId]">) {
  await requireStaff();
  const { jobId } = await params;
  if (!isUuid(jobId)) notFound();
  const job = await getPrintJob(await createClient(), jobId);
  if (!job) notFound();

  const document = buildLabelDocument(job);
  const printable = isPrintable(job.status);
  const w = job.template.widthMm;
  const h = job.template.heightMm;
  const record = recordPath(job.kind, job.entityId);
  const pageCss = `@page { size: ${w.toFixed(1)}mm ${h.toFixed(1)}mm; margin: 0; }
@media print { html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; } }`;

  return (
    <>
      <style>{pageCss}</style>
      <header
        data-print-toolbar=""
        className="gutter sticky top-0 z-10 flex flex-col gap-3 border-b border-hairline bg-paper/95 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3 backdrop-blur print:hidden"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link
            href={record}
            className="inline-flex min-h-tap items-center gap-1 text-sm font-semibold underline-offset-4 hover:underline"
          >
            <ChevronLeftIcon className="size-5" />
            Back to {job.shortId}
          </Link>
          <StatusPill status={printStatusTone(job.status)}>
            {printStatusLabel(job.status)}
          </StatusPill>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ShortId value={job.shortId} />
          <h1 className="min-w-0 text-xl break-words">{job.content.name}</h1>
        </div>
        <p className="text-sm text-dust-700 tabular-nums">
          {job.quantity} {job.quantity === 1 ? "label" : "labels"} · {job.profile.name} · {w} × {h}{" "}
          mm
        </p>
        {printable ? (
          <PrintJobControls
            jobId={job.id}
            status={job.status as "queued" | "rendered"}
            adapter={job.adapter === "pdf" ? "pdf" : "browser"}
            quantity={job.quantity}
            pdfHref={pdfPath(job.id)}
            widthMm={w}
            heightMm={h}
            shortId={job.shortId}
            recordHref={record}
          />
        ) : (
          <PrintJobOutcome job={job} />
        )}
      </header>

      <main id="main" className="gutter flex flex-1 flex-col py-6 print:p-0">
        <div className={printable ? undefined : "print:hidden"}>
          <LabelSheet document={document} />
        </div>
        {printable ? null : (
          <p className="hidden print:block">
            This print job is finished. Print again from {job.shortId} to make a new job.
          </p>
        )}
      </main>
    </>
  );
}
