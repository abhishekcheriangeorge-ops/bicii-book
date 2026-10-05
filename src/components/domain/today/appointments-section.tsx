import Link from "next/link";
import type { ReactNode } from "react";

import { BookAppointmentButton } from "@/components/domain/book-appointment-sheet";
import { Badge } from "@/components/ui/badge";
import { RowLink, RowList } from "@/components/ui/row-list";
import { formatClock } from "@/lib/appointments/format";
import type { TodayAppointmentSummary } from "@/lib/domain/appointments";
import type { TodayDashboard } from "@/lib/reports";

import { StatTile, TileGrid, TodaySection } from "./stat-tile";

/**
 * Today's appointments (server; PLAN D30, D41). The three tiles come from
 * today_dashboard's appointment columns, filled by Phase 2 per D41: by the
 * appointment's scheduled shop day and its CURRENT status (Scheduled = not
 * cancelled; Arrived = of those, arrived, checked in or completed;
 * No-shows), so tapping Arrived on an earlier booking moves the count of
 * the day it was booked for. They are operational counts: every active
 * staff member sees them (D30). `appointments` is null only for a row the
 * database did not count (the placeholder treatment: "—" and "Not tracked
 * yet" for screen readers).
 *
 * `children`: on today, the page passes `TodayArrivals` (the "Still
 * expected" tile and the arrivals list); a past day shows only the counts.
 */
export function AppointmentsSection({
  appointments,
  children,
}: {
  appointments: TodayDashboard["appointments"];
  children?: ReactNode;
}) {
  const tracked = appointments !== null;
  return (
    <TodaySection id="today-appointments" title="Appointments">
      <TileGrid columns={3}>
        <StatTile
          label="Scheduled"
          value={appointments?.scheduled ?? 0}
          notTracked={!tracked}
          hint={tracked ? "Booked for this day" : undefined}
        />
        <StatTile
          label="Arrived"
          value={appointments?.arrived ?? 0}
          notTracked={!tracked}
          hint={tracked ? "Including checked in" : undefined}
        />
        <StatTile
          label="No-shows"
          value={appointments?.noShow ?? 0}
          notTracked={!tracked}
          tone={appointments && appointments.noShow > 0 ? "waiting" : "neutral"}
        />
      </TileGrid>
      {children}
    </TodaySection>
  );
}

/**
 * Today only: "Still expected" (booked or confirmed, not arrived yet) and
 * the first expected arrivals, late ones first, each a row (time,
 * customer, type, a Late badge) opening the appointment; its accessible
 * name starts with the time. "See all" opens the day view. When nobody is
 * expected any more it says so, with Book.
 */
export function TodayArrivals({ summary }: { summary: TodayAppointmentSummary }) {
  const dayHref = `/appointments?date=${summary.day}`;
  const more = summary.expected - summary.arrivals.length;
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <StatTile
        label="Still expected"
        value={summary.expected}
        hint="Booked, not arrived yet"
        href={summary.expected > 0 ? dayHref : null}
      />
      <div className="flex flex-col gap-2 rounded-2xl border border-hairline bg-card px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h3 id="today-arrivals" className="eyebrow text-dust-500">
            Arrivals
          </h3>
          <Link
            href={dayHref}
            className="inline-flex min-h-tap items-center text-sm font-semibold underline"
          >
            See all<span className="sr-only"> appointments today</span>
          </Link>
        </div>
        {summary.arrivals.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
            <p className="text-sm text-dust-500">No more arrivals expected today.</p>
            <BookAppointmentButton presetDate={summary.day} label="Book" />
          </div>
        ) : (
          <>
            <RowList label="Arrivals">
              {summary.arrivals.map((a) => (
                <RowLink
                  key={a.id}
                  href={`/appointments/${a.id}`}
                  label={`${formatClock(a.startsAt)}, ${a.customerLabel}, ${a.typeName}${a.late ? ", late" : ""}`}
                  className="min-h-14 py-2"
                >
                  <span className="w-14 shrink-0 font-display text-lg font-bold tabular-nums">
                    {formatClock(a.startsAt)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{a.customerLabel}</span>
                    <span className="truncate text-sm text-dust-500">{a.typeName}</span>
                  </span>
                  {a.late ? (
                    <Badge tone="danger" emphasis="solid">
                      Late
                    </Badge>
                  ) : null}
                </RowLink>
              ))}
            </RowList>
            {more > 0 ? (
              <p className="text-sm text-dust-500">
                {more === 1 ? "1 more expected later" : `${more} more expected later`}.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
