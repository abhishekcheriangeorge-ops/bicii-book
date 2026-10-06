import Link from "next/link";

import { Button, ButtonLink } from "@/components/ui/button";
import { formatDateTime } from "@/lib/dates";
import { labelUnavailable } from "@/lib/printing/availability";
import { printHistoryPath, reprintPath } from "@/lib/printing/links";
import type { PrintJob } from "@/lib/printing/types";

/**
 * A finished print job on the print view (D59): what happened ("Printed
 * Mon, 5 Oct 2026, 10:02 by Marcus Tan" / "Failed: <reason>") and "Print
 * again", a link to the record that makes a NEW job (disabled, saying why,
 * when the record is archived). Never a Print or Open PDF control: a
 * finished job is history.
 */
export function PrintJobOutcome({
  job,
}: {
  job: Pick<
    PrintJob,
    | "id"
    | "kind"
    | "entityId"
    | "quantity"
    | "status"
    | "error"
    | "completedAt"
    | "statusChangedBy"
    | "entityArchived"
  >;
}) {
  const failed = job.status === "failed";
  return (
    <div
      role="status"
      className={
        failed
          ? "flex flex-col gap-3 rounded-2xl bg-danger-soft p-4 text-danger-deep"
          : "flex flex-col gap-3 rounded-2xl bg-done-soft p-4 text-done-deep"
      }
    >
      <p className="font-medium">
        {failed
          ? `Failed: ${job.error ?? "no reason given"}`
          : `Printed${job.completedAt ? ` ${formatDateTime(job.completedAt)}` : ""}${
              job.statusChangedBy ? ` by ${job.statusChangedBy.name}` : ""
            }`}
      </p>
      <p className="text-sm text-dust-700">
        This print job is finished. Print again makes a new job from the record, with today&apos;s
        label.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {job.entityArchived ? (
          <>
            <Button disabled>Print again</Button>
            <span className="text-sm text-dust-700">
              {labelUnavailable("label_entity_archived")?.message}
            </span>
          </>
        ) : (
          <ButtonLink href={reprintPath(job)}>Print again</ButtonLink>
        )}
        <Link
          href={printHistoryPath(job.id)}
          className="text-sm font-medium text-ink underline underline-offset-4"
        >
          Print history
        </Link>
      </div>
    </div>
  );
}
