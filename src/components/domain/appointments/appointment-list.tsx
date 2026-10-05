import Link from "next/link";

import { ShortId } from "@/components/domain/short-id";
import { Badge } from "@/components/ui/badge";
import { RowList, RowLink } from "@/components/ui/row-list";
import { StatusPill } from "@/components/ui/status-pill";
import { formatAppointmentWhen, formatClock, formatTimeRange } from "@/lib/appointments/format";
import type { WindowUsage } from "@/lib/appointments/slots";
import {
  APPOINTMENT_SOURCE_LABELS,
  APPOINTMENT_STATUS_LABELS,
  SCHEDULE_WARNING_LABELS,
  appointmentTone,
  isLate,
} from "@/lib/appointments/status";
import { cn } from "@/lib/cn";
import { formatShopDayShort, shopDayToDate } from "@/lib/dates";
import type { AppointmentListItem, CustomHours, WeekDay } from "@/lib/domain/appointments";

/**
 * The appointment list's pieces (server; DESIGN.md "Appointments"): the
 * week strip, a day's rows grouped by start time, the capacity bars, the
 * custom-hours banner and the week agenda. Every row links to
 * /appointments/<id> (the href is how E2E finds a row). No money.
 */

export type AppointmentsView = "day" | "week";

export const appointmentsHref = (date: string, view: AppointmentsView) =>
  view === "week" ? `/appointments?date=${date}&view=week` : `/appointments?date=${date}`;

const weekday = new Intl.DateTimeFormat("en-SG", { weekday: "short", timeZone: "Asia/Singapore" });
const dayOfMonth = new Intl.DateTimeFormat("en-SG", { day: "numeric", timeZone: "Asia/Singapore" });

/**
 * Monday to Sunday around the date shown: each day a 44px+ link with its
 * weekday, date, how many appointments it has (D41: not cancelled) and a
 * "Closed" or "Short day" marker; the selected day has aria-current.
 */
export function AppointmentWeekStrip({
  days,
  selected,
  view,
  today,
}: {
  days: readonly WeekDay[];
  selected: string;
  view: AppointmentsView;
  today: string;
}) {
  return (
    <nav
      aria-label="Week"
      className="sticky top-[calc(4rem+env(safe-area-inset-top))] z-20 -mx-4 border-b border-hairline bg-paper/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border sm:px-2"
    >
      <ul className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const date = shopDayToDate(d.day);
          const current = d.day === selected;
          const marker = d.closedAllDay ? "Closed" : d.customHours ? d.customHours.label : null;
          return (
            <li key={d.day} className="min-w-0">
              <Link
                href={appointmentsHref(d.day, view)}
                replace
                scroll={false}
                aria-current={current ? "date" : undefined}
                aria-label={`${formatShopDayShort(d.day)}${d.day === today ? " (today)" : ""}: ${d.scheduled} ${d.scheduled === 1 ? "appointment" : "appointments"}${marker ? `, ${marker}` : ""}`}
                className={cn(
                  "flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-xl border-2 px-0.5 py-1 text-center transition-colors",
                  current
                    ? "border-ink bg-ink text-paper"
                    : d.day === today
                      ? "border-ink bg-card text-ink hover:bg-dust-100"
                      : "border-transparent bg-card text-ink hover:border-hairline",
                )}
              >
                <span className="font-display text-[0.6875rem] font-bold tracking-wide uppercase">
                  {weekday.format(date)}
                </span>
                <span className="text-lg leading-none font-semibold tabular-nums">
                  {dayOfMonth.format(date)}
                </span>
                <span
                  className={cn(
                    "text-[0.6875rem] leading-tight tabular-nums",
                    current ? "text-paper" : "text-dust-500",
                  )}
                >
                  {marker ? (
                    <>
                      <span className="hidden sm:inline">{marker}</span>
                      <span className="sm:hidden">
                        {d.closedAllDay ? "Closed" : marker === "Short day" ? "Short" : "Hours"}
                      </span>
                    </>
                  ) : d.scheduled > 0 ? (
                    d.scheduled
                  ) : (
                    "–"
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** "Short day 12:00–16:00: Short day for stocktake" (custom hours, D38). */
export function CustomHoursBanner({ hours }: { hours: CustomHours }) {
  return (
    <p className="rounded-xl bg-waiting-soft px-4 py-3 text-waiting-deep">
      <strong className="font-semibold">
        {hours.label} {hours.opens}–{hours.closes}:
      </strong>{" "}
      {hours.reason}
    </p>
  );
}

/**
 * The badges that flag a row: online booking, late, note, a D38 schedule
 * warning. `narrow` (the week agenda's day columns) lets a badge wrap onto
 * a second line instead of running past its column.
 */
function RowBadges({
  appt,
  now,
  narrow = false,
}: {
  appt: AppointmentListItem;
  now: Date;
  narrow?: boolean;
}) {
  const fit = narrow ? NARROW_BADGE : undefined;
  return (
    <>
      {appt.source === "customer" ? (
        <Badge tone="info" className={fit}>
          {APPOINTMENT_SOURCE_LABELS.customer}
        </Badge>
      ) : null}
      {isLate(appt, now) ? (
        <Badge tone="danger" emphasis="solid" className={fit}>
          Late
        </Badge>
      ) : null}
      {appt.scheduleWarning ? (
        <Badge tone="waiting" emphasis="solid" className={fit}>
          {SCHEDULE_WARNING_LABELS[appt.scheduleWarning]}
        </Badge>
      ) : null}
      {appt.hasCustomerNote || appt.hasInternalNote ? (
        <Badge tone="neutral" className={fit}>
          Note<span className="sr-only">: this appointment has a note</span>
        </Badge>
      ) : null}
    </>
  );
}

/** A badge or pill that may wrap inside a narrow column rather than overflow it. */
const NARROW_BADGE = "max-w-full min-w-0 rounded-lg whitespace-normal [overflow-wrap:anywhere]";

/** One appointment as a tappable row (whole row links to it). */
export function AppointmentRow({ appt, now }: { appt: AppointmentListItem; now: Date }) {
  return (
    <RowLink href={`/appointments/${appt.id}`} className="items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold tabular-nums">
            {formatTimeRange(appt.startsAt, appt.endsAt)}
          </span>
          <StatusPill status={appointmentTone(appt.status)}>
            {APPOINTMENT_STATUS_LABELS[appt.status]}
          </StatusPill>
          <RowBadges appt={appt} now={now} />
        </div>
        <p className="text-lg leading-tight font-semibold">{appt.customer.label}</p>
        <p className="text-sm text-dust-500">{appt.type.name}</p>
        <p className="flex flex-wrap items-center gap-2 text-sm text-dust-500">
          {appt.bike ? (
            <span className="flex items-center gap-2">
              <ShortId value={appt.bike.shortId} />
              <span>{appt.bike.title}</span>
            </span>
          ) : (
            <span>No bike yet</span>
          )}
          {appt.job ? (
            <>
              <span aria-hidden="true">·</span>
              <span>Job {appt.job.jobNumber}</span>
            </>
          ) : null}
        </p>
      </div>
    </RowLink>
  );
}

/** A day's appointments in time order, one group per start time. */
export function DayAppointments({
  appointments,
  now,
}: {
  appointments: readonly AppointmentListItem[];
  now: Date;
}) {
  const groups: { time: string; items: AppointmentListItem[] }[] = [];
  for (const a of appointments) {
    const time = formatClock(a.startsAt);
    const last = groups.at(-1);
    if (last && last.time === time) last.items.push(a);
    else groups.push({ time, items: [a] });
  }
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <section key={g.time} aria-labelledby={`at-${g.time}`} className="flex flex-col gap-2">
          <h2
            id={`at-${g.time}`}
            className="font-display text-sm font-bold tracking-wide text-dust-700 uppercase tabular-nums"
          >
            {g.time}
          </h2>
          <RowList>
            {g.items.map((a) => (
              <AppointmentRow key={a.id} appt={a} now={now} />
            ))}
          </RowList>
        </section>
      ))}
    </div>
  );
}

/**
 * One slim bar per intake window: units used of capacity (D2), with the
 * words beside it ("1 of 2 booked"). Over capacity after a settings change
 * (D38) the bar is red and reads "3 of 2 booked".
 */
export function CapacityBars({ windows }: { windows: readonly WindowUsage[] }) {
  if (windows.length === 0) return null;
  return (
    <ul aria-label="Capacity by slot" className="flex flex-col gap-1.5">
      {windows.map((w) => {
        const over = w.used > w.capacity;
        const share = w.capacity > 0 ? Math.min(1, w.used / w.capacity) : 1;
        return (
          <li
            key={w.start.toISOString()}
            className="grid grid-cols-[3.25rem_1fr_auto] items-center gap-3 text-dense"
          >
            <span className="text-dust-700 tabular-nums">{formatClock(w.start)}</span>
            <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-dust-100">
              <span
                className={cn(
                  "block h-full rounded-full",
                  over ? "bg-danger" : w.used >= w.capacity ? "bg-ink" : "bg-progress",
                )}
                style={{ width: `${share * 100}%` }}
              />
            </span>
            <span
              className={cn(
                "tabular-nums",
                over ? "font-semibold text-danger-deep" : "text-dust-500",
              )}
            >
              {w.closed ? "Closed · " : !w.open ? "Outside hours · " : ""}
              {w.used} of {w.capacity} booked
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The week view: each day with its appointments. The columns follow the
 * agenda's own width (a container query, so the side rail is counted):
 * stacked on phones, two to four columns on tablets, seven only from 72rem,
 * where a day's column still fits a time, a status and a badge. Badges
 * wrap rather than run into the next day.
 */
export function WeekAgenda({
  days,
  today,
  now,
}: {
  days: readonly WeekDay[];
  today: string;
  now: Date;
}) {
  return (
    <div className="@container">
      <ol
        aria-label="Appointments this week"
        className="grid gap-3 @2xl:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4 @6xl:grid-cols-7 @6xl:gap-2"
      >
        {days.map((d) => (
          <li
            key={d.day}
            className={cn(
              "flex min-w-0 flex-col gap-2 rounded-2xl border bg-card p-3",
              d.day === today ? "border-2 border-ink" : "border-hairline",
            )}
          >
            <h2 className="flex flex-wrap items-center justify-between gap-1">
              <Link
                href={appointmentsHref(d.day, "day")}
                className="flex min-h-tap items-center font-semibold underline-offset-4 hover:underline"
              >
                {formatShopDayShort(d.day)}
                {d.day === today ? <span className="sr-only"> (today)</span> : null}
              </Link>
              {d.closedAllDay ? (
                <Badge tone="neutral">Closed</Badge>
              ) : d.customHours ? (
                <Badge tone="waiting">{d.customHours.label}</Badge>
              ) : null}
            </h2>
            {d.appointments.length === 0 ? (
              <p className="text-sm text-dust-500">
                {d.closedAllDay ? (d.closedReason ?? "Closed") : "Nothing booked"}
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {d.appointments.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/appointments/${a.id}`}
                      className={cn(
                        "flex min-h-tap flex-col justify-center rounded-lg px-2 py-1.5 text-dense hover:bg-dust-100",
                        a.status === "cancelled" && "text-dust-500 line-through",
                      )}
                    >
                      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="font-semibold tabular-nums">
                          {formatClock(a.startsAt)}
                        </span>
                        <StatusPill
                          status={appointmentTone(a.status)}
                          className={cn("min-h-6 px-2 text-[0.75rem]", NARROW_BADGE)}
                        >
                          {APPOINTMENT_STATUS_LABELS[a.status]}
                        </StatusPill>
                        <RowBadges appt={a} now={now} narrow />
                      </span>
                      <span className="truncate">{a.customer.label}</span>
                      <span className="truncate text-dust-500">{a.type.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * A customer's appointments on their page: when (day and time range), the
 * status pill, who booked it ("Booked online" / "Booked by staff"), the
 * type and the bike; each row opens the appointment.
 */
export function CustomerAppointmentRows({
  label,
  appointments,
}: {
  label: string;
  appointments: readonly AppointmentListItem[];
}) {
  return (
    <RowList label={label}>
      {appointments.map((a) => (
        <RowLink key={a.id} href={`/appointments/${a.id}`} className="items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span
              className={cn(
                "font-semibold tabular-nums",
                a.status === "cancelled" && "text-dust-500 line-through",
              )}
            >
              {formatAppointmentWhen(a.startsAt, a.endsAt)}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <StatusPill status={appointmentTone(a.status)}>
                {APPOINTMENT_STATUS_LABELS[a.status]}
              </StatusPill>
              <Badge tone={a.source === "customer" ? "info" : "neutral"}>
                {APPOINTMENT_SOURCE_LABELS[a.source]}
              </Badge>
            </span>
            <span className="text-sm text-dust-700">
              {a.type.name}
              {a.bike ? ` · ${a.bike.title}` : ""}
              {a.job ? ` · Job ${a.job.jobNumber}` : ""}
            </span>
          </div>
        </RowLink>
      ))}
    </RowList>
  );
}
