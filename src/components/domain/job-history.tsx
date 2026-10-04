import { ChevronRightIcon } from "@/components/ui/icons";
import { RowLink, RowList } from "@/components/ui/row-list";
import { StatusPill } from "@/components/ui/status-pill";
import { formatDate } from "@/lib/dates";
import type { HistoryJob } from "@/lib/domain/workshop";
import { STATUS_LABELS, statusTone } from "@/lib/workshop";

import { ShortId } from "./short-id";

/**
 * A bike's or customer's jobs, newest first (SPEC §21 "service history"):
 * J- number, status, the dates it has (checked in, completed, collected),
 * the first line of the requested work and the lead; each row opens the
 * job. With `showBike` (customer page) each row names the bike too.
 */
export function JobHistoryList({
  label,
  jobs,
  showBike = false,
}: {
  label: string;
  jobs: HistoryJob[];
  showBike?: boolean;
}) {
  return (
    <RowList label={label}>
      {jobs.map((job) => (
        <RowLink key={job.id} href={`/jobs/${job.id}`}>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2">
              <ShortId value={job.jobNumber} />
              <StatusPill status={statusTone(job.status)}>{STATUS_LABELS[job.status]}</StatusPill>
            </span>
            {showBike ? <span className="truncate font-medium">{job.bikeTitle}</span> : null}
            <span className={showBike ? "truncate text-sm text-dust-700" : "truncate font-medium"}>
              {job.summary}
            </span>
            <span className="text-sm text-dust-500">
              {[
                `Checked in ${formatDate(job.checkedInAt)}`,
                job.completedAt ? `completed ${formatDate(job.completedAt)}` : null,
                job.collectedAt ? `collected ${formatDate(job.collectedAt)}` : null,
                job.leadName ? `lead ${job.leadName}` : "no lead",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
          <ChevronRightIcon className="size-5 shrink-0 text-dust-500" />
        </RowLink>
      ))}
    </RowList>
  );
}
