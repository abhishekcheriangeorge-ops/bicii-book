"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { ChevronRightIcon } from "@/components/ui/icons";
import { RowList } from "@/components/ui/row-list";
import { Sheet } from "@/components/ui/sheet";
import { StatusPill } from "@/components/ui/status-pill";
import type { QueueRow } from "@/lib/domain/shopify";
import { attemptText, jobKindLabel, jobStatusLabel, jobStatusTone } from "@/lib/shopify";

import { JobPanel } from "./job-panel";

/**
 * The queue's rows (SPEC §26): the kind ("Order", "Refund", "Product
 * sync"), the subject, the human reason on at most two lines, "Attempt 3
 * of 8 · next try 2:05 pm" (Singapore time) and the status as a pill with
 * words. Tapping a row opens its sheet with the full reason and what can
 * be done (JobPanel). `?job=<id>` (Today's exception row) opens that job's
 * sheet; closing it drops the parameter.
 */
export function QueueList({
  rows,
  deepLinkJob,
}: {
  rows: readonly QueueRow[];
  /** The job named by ?job=, when it exists (it may be outside this view). */
  deepLinkJob: QueueRow | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState<QueueRow | null>(deepLinkJob);

  const close = () => {
    setOpen(null);
    if (params.has("job")) {
      const next = new URLSearchParams(params);
      next.delete("job");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  };

  return (
    <>
      {rows.length > 0 ? (
        <RowList label="Queue">
          {rows.map((r) => (
            <li key={r.id} className="group/row">
              <button
                type="button"
                onClick={() => setOpen(r)}
                className="flex min-h-16 w-full items-center gap-4 px-4 py-3 text-left focus-inset transition-colors group-first/row:rounded-t-[15px] group-last/row:rounded-b-[15px] hover:bg-dust-100"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="eyebrow text-dust-500">{jobKindLabel(r.kind, r.topic)}</span>
                    <span className="font-medium break-words">{r.subject}</span>
                    <StatusPill status={jobStatusTone(r.status)}>
                      {jobStatusLabel(r.status)}
                    </StatusPill>
                  </span>
                  {r.reason || r.resolutionReason ? (
                    <span className="line-clamp-2 text-sm break-words text-dust-700">
                      {r.status === "dismissed" && r.resolutionReason
                        ? `Dismissed: ${r.resolutionReason}`
                        : r.reason}
                    </span>
                  ) : null}
                  <span className="text-sm text-dust-500 tabular-nums">
                    {attemptText({
                      attempts: r.attempts,
                      maxAttempts: r.maxAttempts,
                      nextAttemptAt: r.nextAttemptAt,
                      status: r.status,
                    })}
                  </span>
                </span>
                <ChevronRightIcon className="size-5 shrink-0 text-dust-500" />
              </button>
            </li>
          ))}
        </RowList>
      ) : null}
      <Sheet
        open={open !== null}
        onOpenChange={(o) => {
          if (!o) close();
        }}
        title={open ? `${jobKindLabel(open.kind, open.topic)} ${open.subject}` : "Queue item"}
      >
        {open ? (
          <div className="flex flex-col gap-4">
            <p className="flex flex-wrap items-center gap-2">
              <StatusPill status={jobStatusTone(open.status)}>
                {jobStatusLabel(open.status)}
              </StatusPill>
              <span className="text-sm text-dust-500 tabular-nums">
                {attemptText({
                  attempts: open.attempts,
                  maxAttempts: open.maxAttempts,
                  nextAttemptAt: open.nextAttemptAt,
                  status: open.status,
                })}
              </span>
            </p>
            {open.reason ? (
              <p className="break-words whitespace-pre-line text-danger-deep">{open.reason}</p>
            ) : null}
            {open.status === "dismissed" && open.resolutionReason ? (
              <p className="break-words text-dust-700">Dismissed: {open.resolutionReason}</p>
            ) : null}
            <JobPanel job={open} inSheet showOpenEvent onDone={close} />
          </div>
        ) : null}
      </Sheet>
    </>
  );
}
