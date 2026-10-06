import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { PrintJobConfirm } from "@/components/domain/print-job-controls";
import { ShortId } from "@/components/domain/short-id";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { requireStaff } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";
import { getPrintJob } from "@/lib/domain/labels";
import { labelUnavailable } from "@/lib/printing/availability";
import { buildLabelDocument } from "@/lib/printing/document";
import {
  LABEL_KIND_NAMES,
  PRINTER_TYPE_NAMES,
  isPrintable,
  printStatusLabel,
  printStatusTone,
} from "@/lib/printing/job";
import { LabelSvg } from "@/lib/printing/label-svg";
import { printViewPath, recordPath, reprintPath } from "@/lib/printing/links";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

export const metadata: Metadata = { title: "Print job" };

/**
 * One print job (SPEC §16; PLAN D58, D59): the label exactly as the job
 * captured it (its snapshot, for every status), and its details: quantity,
 * printer, size, who asked and when, when it was sent and finished, what
 * went wrong, and the job it reprints. An open job offers its print view
 * and the confirmation; every job offers Print again (a new job from the
 * record), unless the record is archived.
 */
export default async function PrintJobPage({ params }: PageProps<"/labels/[jobId]">) {
  await requireStaff();
  const { jobId } = await params;
  if (!isUuid(jobId)) notFound();
  const job = await getPrintJob(await createClient(), jobId);
  if (!job) notFound();
  const { drawing } = buildLabelDocument(job);
  const record = recordPath(job.kind, job.entityId);
  const open = isPrintable(job.status);

  const details: [string, ReactNode][] = [
    ["Quantity", `${job.quantity} ${job.quantity === 1 ? "label" : "labels"}`],
    // The name and the type apart: the built-in printers' names already say
    // their type ("This device (browser print)", "PDF download").
    ["Printer", job.profile.name],
    ["Printer type", PRINTER_TYPE_NAMES[job.adapter]],
    ["Label size", `${job.template.widthMm} × ${job.template.heightMm} mm · ${job.template.name}`],
    ["Requested by", job.requestedBy.name],
    ["Requested at", formatDateTime(job.createdAt)],
    ["Sent at", job.renderedAt ? formatDateTime(job.renderedAt) : "Not sent yet"],
  ];
  if (job.completedAt) {
    details.push([
      "Finished at",
      `${formatDateTime(job.completedAt)}${job.statusChangedBy ? ` by ${job.statusChangedBy.name}` : ""}`,
    ]);
  }
  if (job.error) details.push(["What went wrong", job.error]);
  if (job.reprintOfId) {
    details.push([
      "Reprint of",
      <Link key="reprint" href={`/labels/${job.reprintOfId}`} className="font-medium underline">
        An earlier print job
      </Link>,
    ]);
  }

  return (
    <>
      <header className="flex flex-col gap-3 pt-6 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={record} className="underline-offset-2 hover:underline">
            <ShortId value={job.shortId} large />
          </Link>
          <StatusPill status={printStatusTone(job.status)}>
            {printStatusLabel(job.status)}
          </StatusPill>
        </div>
        <h1 className="text-3xl break-words sm:text-4xl">{job.content.name}</h1>
        <p className="text-sm text-dust-500">
          {LABEL_KIND_NAMES[job.kind]} label ·{" "}
          <Link href="/labels" className="underline underline-offset-4">
            Print history
          </Link>
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Label">
          <p className="mb-3 text-sm text-dust-700">
            Exactly what this job prints, as it was when the job started.
          </p>
          <div className="max-w-full overflow-x-auto">
            <LabelSvg
              drawing={drawing}
              className="h-auto max-w-full rounded-md bg-white shadow-sm ring-1 ring-hairline"
            />
          </div>
        </Card>

        <Card title="Details">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {details.map(([term, value]) => (
              <div key={term} className="contents">
                <dt className="text-dust-500">{term}</dt>
                <dd className="break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <Card title={open ? "Print" : "Reprint"}>
        <div className="flex flex-col gap-4">
          {open ? (
            <>
              <div>
                <ButtonLink href={printViewPath(job.id)} variant="solid">
                  Open print view
                </ButtonLink>
              </div>
              <PrintJobConfirm
                jobId={job.id}
                quantity={job.quantity}
                shortId={job.shortId}
                recordHref={record}
                autoFocus={false}
              />
            </>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            {job.entityArchived ? (
              <>
                <Button variant="outline" disabled>
                  Print again
                </Button>
                <span className="text-sm text-dust-700">
                  {labelUnavailable("label_entity_archived")?.message}
                </span>
              </>
            ) : (
              <ButtonLink href={reprintPath(job)} variant="outline">
                Print again
              </ButtonLink>
            )}
          </div>
        </div>
      </Card>
    </>
  );
}
