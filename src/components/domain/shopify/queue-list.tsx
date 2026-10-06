"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ChevronRightIcon } from "@/components/ui/icons";
import { RowList } from "@/components/ui/row-list";
import { Sheet } from "@/components/ui/sheet";
import { StatusPill } from "@/components/ui/status-pill";
import type { QueueRow } from "@/lib/domain/shopify";
import {
  attemptText,
  jobClosed,
  jobKindLabel,
  jobStatusLabel,
  jobStatusTone,
  jobTitle,
} from "@/lib/shopify";

import { JobPanel } from "./job-panel";

/**
 * The queue's rows (SPEC §26): the kind ("Order", "Refund", "Product
 * sync"), the subject, the human reason on at most two lines, "Attempt 3
 * of 8 · next try 2:05 pm" (Singapore time) and the status as a pill with
 * words. Tapping a row opens its sheet with the full reason and what can
 * be done (JobPanel). `?job=<id>` (Today's exception row) opens that job's
 * sheet; closing it drops the parameter.
 *
 * The sheet holds only the open job's id and reads the row from the
 * server's rows on every render, so after a Retry or a link (each ends in
 * refresh()) it shows the job's new status, attempts, reason and lines.
 * It closes itself when the job it was opened on closes (done or
 * dismissed) or leaves the view.
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
  const [opened, setOpened] = useState<{ id: string; wasOpen: boolean } | null>(
    deepLinkJob ? { id: deepLinkJob.id, wasOpen: !jobClosed(deepLinkJob.status) } : null,
  );
  const [busy, setBusy] = useState(false);
  const open: QueueRow | null = opened
    ? (rows.find((r) => r.id === opened.id) ?? (deepLinkJob?.id === opened.id ? deepLinkJob : null))
    : null;

  const close = () => {
    setOpened(null);
    setBusy(false);
  };

  // The job left the view, or closed while its sheet was open (a retry
  // that ended "Closed without recording"): close the sheet during render
  // (React's "adjusting state when a prop changes"), never on a stale row.
  if (opened !== null && (open === null || (opened.wasOpen && jobClosed(open.status)))) {
    close();
  }

  // No sheet open: drop ?job= so a reload does not reopen it.
  const hasJobParam = params.has("job");
  useEffect(() => {
    if (opened !== null || !hasJobParam) return;
    const next = new URLSearchParams(params);
    next.delete("job");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [opened, hasJobParam, params, pathname, router]);

  return (
    <>
      {rows.length > 0 ? (
        <RowList label="Queue">
          {rows.map((r) => (
            <li key={r.id} className="group/row">
              <button
                type="button"
                onClick={() => setOpened({ id: r.id, wasOpen: !jobClosed(r.status) })}
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
        dismissible={!busy}
        title={open ? jobTitle(open.kind, open.topic, open.subject) : "Queue item"}
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
            <JobPanel
              key={open.id}
              job={open}
              inSheet
              showOpenEvent
              onDone={close}
              onBusyChange={setBusy}
            />
          </div>
        ) : null}
      </Sheet>
    </>
  );
}
