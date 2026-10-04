import type { Metadata } from "next";

import { ShortId } from "@/components/domain/short-id";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ChevronRightIcon, PlusIcon, WrenchIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink, RowList } from "@/components/ui/row-list";
import { StatusPill } from "@/components/ui/status-pill";
import { requireStaff } from "@/lib/auth/session";
import { shopDaysBetween } from "@/lib/dates";
import { listOpenWorkOrders } from "@/lib/domain/workshop";
import { createClient } from "@/lib/supabase/server";
import { STATUS_LABELS, isOverdue, statusTone } from "@/lib/workshop";

export const metadata: Metadata = { title: "Jobs" };

function age(days: number): string {
  if (days <= 0) return "In today";
  return days === 1 ? "1 day" : `${days} days`;
}

/**
 * Jobs (SPEC §7.2, §21): every job still in the shop (not collected or
 * cancelled), newest check-in first, and "New job". A plain list until the
 * board, My Jobs and filters arrive (Phase 3 step 4).
 */
export default async function JobsPage() {
  await requireStaff();
  const { items: jobs, more } = await listOpenWorkOrders(await createClient());
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Every bike in the workshop, newest first."
        actions={
          <ButtonLink href="/jobs/new" size="lg" icon={<PlusIcon className="size-5" />}>
            New job
          </ButtonLink>
        }
      />
      <section aria-labelledby="open-jobs" className="flex flex-col gap-2">
        <h2 id="open-jobs" className="eyebrow text-dust-500">
          {more ? `Latest ${jobs.length} open jobs` : "Open jobs"}
        </h2>
        {more ? (
          <p className="text-sm text-dust-700">
            There are more open jobs than this. Search for a job number to find an older one.
          </p>
        ) : null}
        {jobs.length === 0 ? (
          <EmptyState
            icon={<WrenchIcon />}
            title="No bikes in the workshop"
            description="Check a bike in to start a job: customer, bike, the work wanted, who is on it."
            action={
              <ButtonLink href="/jobs/new" icon={<PlusIcon className="size-5" />}>
                New job
              </ButtonLink>
            }
          />
        ) : (
          <RowList label="Open jobs">
            {jobs.map((job) => {
              const overdue = isOverdue(job, now);
              return (
                <RowLink key={job.id} href={`/jobs/${job.id}`}>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <ShortId value={job.jobNumber} />
                      <StatusPill status={statusTone(job.status)}>
                        {STATUS_LABELS[job.status]}
                      </StatusPill>
                      {overdue ? (
                        <Badge tone="danger" emphasis="solid">
                          Overdue
                        </Badge>
                      ) : null}
                    </span>
                    <span className="truncate font-medium">{job.bikeTitle}</span>
                    <span className="truncate text-sm text-dust-500">
                      {[
                        job.customerLabel,
                        job.leadName ?? "Unassigned",
                        age(shopDaysBetween(job.checkedInAt, now)),
                      ].join(" · ")}
                    </span>
                  </span>
                  <ChevronRightIcon className="size-5 shrink-0 text-dust-500" />
                </RowLink>
              );
            })}
          </RowList>
        )}
      </section>
    </>
  );
}
