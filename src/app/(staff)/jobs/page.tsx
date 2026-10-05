import type { Metadata } from "next";

import { BoardFiltersButton } from "@/components/domain/board-filter-sheet";
import { SearchField } from "@/components/domain/search-field";
import {
  ActiveFilterChips,
  GroupChips,
  JobRow,
  LinkSegments,
} from "@/components/domain/workshop-board";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PlusIcon, WrenchIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { RowList } from "@/components/ui/row-list";
import { requireStaff } from "@/lib/auth/session";
import {
  BOARD_OPEN_CAP,
  boardFilterLabels,
  listActiveStaff,
  listWorkOrders,
} from "@/lib/domain/workshop";
import { createClient } from "@/lib/supabase/server";
import {
  AGE_FILTERS,
  BOARD_GROUPS,
  BOARD_VIEWS,
  CHECKED_IN_PRESETS,
  CLOSED_PAGE,
  CLOSED_WINDOW_DAYS,
  STATUS_LABELS,
  boardQuery,
  hasBoardFilters,
  parseBoardFilters,
  type BoardFilters,
} from "@/lib/workshop";

export const metadata: Metadata = { title: "Jobs" };

/** Every filter off; the view and the group stay. */
const CLEAR_ALL: Partial<BoardFilters> = {
  statuses: [],
  mechanicId: null,
  customerId: null,
  bikeId: null,
  checkedIn: "any",
  age: "any",
  q: "",
  jobNumber: null,
};

const href = (filters: BoardFilters, patch: Partial<BoardFilters> = {}) =>
  `/jobs${boardQuery(filters, { closedLimit: 0, ...patch })}`;

function emptyCopy(f: BoardFilters): { title: string; description: string } {
  if (hasBoardFilters(f)) {
    return {
      title: "No jobs match these filters",
      description: "Remove a filter, or Clear them all, to see more of the workshop.",
    };
  }
  if (f.view === "mine") {
    return {
      title: "No jobs assigned to you — pick one from Unassigned",
      description: "Jobs you lead or help on appear here.",
    };
  }
  if (f.view === "unassigned") {
    return {
      title: "Every job has a lead",
      description: "New check-ins without a lead appear here.",
    };
  }
  if (f.group === "closed") {
    return {
      title: "Nothing closed lately",
      description: `Collected and cancelled jobs from the last ${CLOSED_WINDOW_DAYS} days appear here.`,
    };
  }
  return {
    title: "No bikes in the workshop",
    description: "Check a bike in to start a job: customer, bike, the work wanted, who is on it.",
  };
}

/**
 * The workshop board and My Jobs (SPEC §7.2, §21): every job in the shop by
 * board group (Received, Waiting, Ready, In progress, Completed, Ready for
 * collection; Closed on demand), filtered by view, group, status, mechanic,
 * customer, bike, check-in date, age and job number, all in the URL. A
 * list of rows rather than columns, so it works one-handed on a phone; no
 * money anywhere on it.
 */
export default async function JobsPage({ searchParams }: PageProps<"/jobs">) {
  const staff = await requireStaff();
  const filters = parseBoardFilters(await searchParams);
  const supabase = await createClient();
  const now = new Date();
  const [board, activeStaff, labels] = await Promise.all([
    listWorkOrders(supabase, filters, { staffId: staff.staffId, now }),
    listActiveStaff(supabase),
    boardFilterLabels(supabase, filters),
  ]);

  const chips = [
    ...filters.statuses.map((s) => ({
      key: `status-${s}`,
      text: STATUS_LABELS[s],
      removeHref: href(filters, { statuses: filters.statuses.filter((x) => x !== s) }),
    })),
    ...(filters.mechanicId
      ? [
          {
            key: "mechanic",
            text: `On it: ${labels.mechanic}`,
            removeHref: href(filters, { mechanicId: null }),
          },
        ]
      : []),
    ...(filters.customerId
      ? [
          {
            key: "customer",
            text: `Customer: ${labels.customer}`,
            removeHref: href(filters, { customerId: null }),
          },
        ]
      : []),
    ...(filters.bikeId
      ? [{ key: "bike", text: `Bike: ${labels.bike}`, removeHref: href(filters, { bikeId: null }) }]
      : []),
    ...(filters.checkedIn !== "any"
      ? [
          {
            key: "date",
            text: `Checked in: ${CHECKED_IN_PRESETS.find((p) => p.value === filters.checkedIn)?.label}`,
            removeHref: href(filters, { checkedIn: "any" }),
          },
        ]
      : []),
    ...(filters.age !== "any"
      ? [
          {
            key: "age",
            text: `Age: ${AGE_FILTERS.find((a) => a.value === filters.age)?.label}`,
            removeHref: href(filters, { age: "any" }),
          },
        ]
      : []),
    ...(filters.q
      ? [
          {
            key: "q",
            text: `Job: ${filters.jobNumber ?? filters.q}`,
            removeHref: href(filters, { q: "", jobNumber: null }),
          },
        ]
      : []),
  ];
  const sheetCount = chips.filter((c) => c.key !== "q").length;
  const shown = board.sections.filter((s) => s.jobs.length > 0);
  const empty = emptyCopy(filters);

  return (
    <>
      <PageHeader
        title="Jobs"
        description="The workshop board: every bike in the shop, longest waiting first."
        actions={
          <ButtonLink
            href="/jobs/new"
            size="lg"
            icon={<PlusIcon className="size-5" />}
            className="max-md:hidden"
          >
            New job
          </ButtonLink>
        }
      />
      <ButtonLink
        href="/jobs/new"
        size="lg"
        fullWidth
        icon={<PlusIcon className="size-5" />}
        className="md:hidden"
      >
        New job
      </ButtonLink>

      <LinkSegments
        label="Show jobs"
        options={BOARD_VIEWS.map((v) => ({
          key: v.value,
          text: v.label,
          href: href(filters, { view: v.value }),
          current: filters.view === v.value,
        }))}
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <SearchField
            label="Job number"
            placeholder="J-000123"
            hint="The whole number: J-000123, j000123 or 000123"
          />
        </div>
        <BoardFiltersButton
          filters={filters}
          staff={activeStaff}
          labels={{ customer: labels.customer, bike: labels.bike }}
          activeCount={sheetCount}
        />
      </div>

      <ActiveFilterChips chips={chips} clearHref={href(filters, CLEAR_ALL)} />

      <GroupChips
        label="Board groups"
        options={[
          {
            key: "open",
            text: "All open",
            href: href(filters, { group: null }),
            current: filters.group === null,
          },
          ...BOARD_GROUPS.map((g) => ({
            key: g.id,
            text: g.label,
            href: href(filters, { group: g.id }),
            current: filters.group === g.id,
            count: board.counts[g.id],
          })),
        ]}
      />

      {board.invalidQuery ? (
        <p role="status" className="rounded-xl bg-waiting-soft p-3 text-waiting-deep">
          “{filters.q}” is not a job number. Type all six digits, like J-000123, or use Search for
          names, phones and bikes.
        </p>
      ) : null}

      {board.truncated ? (
        <p className="text-sm text-dust-700">
          There are more open jobs than this. Counts cover the newest {BOARD_OPEN_CAP} open jobs.
          Filter by status, mechanic or date, or type a job number, to find an older one.
        </p>
      ) : null}

      {board.invalidQuery ? null : shown.length === 0 ? (
        <EmptyState
          icon={<WrenchIcon />}
          title={empty.title}
          description={empty.description}
          action={
            filters.view === "mine" && !hasBoardFilters(filters) ? (
              <ButtonLink href={href(filters, { view: "unassigned" })} variant="outline">
                Unassigned jobs
              </ButtonLink>
            ) : filters.view === "all" && !hasBoardFilters(filters) && !filters.group ? (
              <ButtonLink href="/jobs/new" icon={<PlusIcon className="size-5" />}>
                New job
              </ButtonLink>
            ) : undefined
          }
        />
      ) : (
        shown.map((section) => (
          <section
            key={section.id}
            aria-labelledby={`group-${section.id}`}
            className="flex flex-col gap-2"
          >
            <h2 id={`group-${section.id}`} className="eyebrow text-dust-500">
              {section.label} ({section.id === "closed" ? board.counts.closed : section.jobs.length}
              )
            </h2>
            {section.id === "closed" ? (
              <p className="text-sm text-dust-500">
                {filters.jobNumber
                  ? "Collected and cancelled, newest first."
                  : `Collected and cancelled in the last ${CLOSED_WINDOW_DAYS} days, newest first.`}
              </p>
            ) : null}
            <RowList label={section.label}>
              {section.jobs.map((job) => (
                <JobRow key={job.id} job={job} now={now} />
              ))}
            </RowList>
            {section.id === "closed" && board.closedMore ? (
              <div>
                <ButtonLink
                  href={`/jobs${boardQuery(filters, { closedLimit: filters.closedLimit + CLOSED_PAGE })}`}
                  replace
                  scroll={false}
                  variant="outline"
                >
                  Show more
                </ButtonLink>
              </div>
            ) : null}
          </section>
        ))
      )}
    </>
  );
}
