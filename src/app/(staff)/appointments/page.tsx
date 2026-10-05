import type { Metadata } from "next";
import Link from "next/link";

import {
  AppointmentWeekStrip,
  CapacityBars,
  CustomHoursBanner,
  DayAppointments,
  WeekAgenda,
  appointmentsHref,
  type AppointmentsView,
} from "@/components/domain/appointments/appointment-list";
import { LinkSegments } from "@/components/domain/workshop-board";
import { BookAppointmentButton } from "@/components/domain/book-appointment-sheet";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClasses } from "@/components/ui/button";
import { weekStart } from "@/lib/appointments/time";
import { requireStaff } from "@/lib/auth/session";
import {
  formatShopDay,
  formatShopDayLong,
  formatShopDayShort,
  parseShopDay,
  shiftShopDay,
  shopToday,
} from "@/lib/dates";
import { listDay, listWeek } from "@/lib/domain/appointments";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Appointments" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Appointments (SPEC §6, §21; PLAN D2, D37, D38, D41): a day (default) or
 * a week, `?date=YYYY-MM-DD` (shop-local today when missing or invalid)
 * and `?view=day|week`. The week strip is always there; the day view lists
 * the day's appointments by start time with the slot capacity, flags
 * bookings a settings change left outside the hours or in a closure (D38),
 * and says when the shop is closed or keeps different hours. Anyone on the
 * staff can book (the button on md+, the floating Book on phones).
 */
export default async function AppointmentsPage({ searchParams }: PageProps<"/appointments">) {
  await requireStaff();
  const params = await searchParams;
  const today = shopToday();
  const date = parseShopDay(first(params.date)) ?? today;
  const view: AppointmentsView = first(params.view) === "week" ? "week" : "day";
  const supabase = await createClient();
  const [week, day] = await Promise.all([
    listWeek(supabase, date),
    view === "day" ? listDay(supabase, date) : Promise.resolve(null),
  ]);
  const now = new Date();
  const step = view === "week" ? 7 : 1;
  const previous = shiftShopDay(view === "week" ? weekStart(date) : date, -step);
  const next = shiftShopDay(view === "week" ? weekStart(date) : date, step);
  const heading =
    view === "week"
      ? `Week of ${formatShopDayShort(week.from)}`
      : date === today
        ? `Today, ${formatShopDayLong(date)}`
        : formatShopDayLong(date);

  return (
    <>
      <PageHeader
        title="Appointments"
        description={heading}
        actions={
          <div className="hidden md:block">
            <BookAppointmentButton presetDate={date} />
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <LinkSegments
          label="View"
          options={[
            {
              key: "day",
              text: "Day",
              href: appointmentsHref(date, "day"),
              current: view === "day",
            },
            {
              key: "week",
              text: "Week",
              href: appointmentsHref(date, "week"),
              current: view === "week",
            },
          ]}
        />
        <nav aria-label="Dates" className="flex items-center gap-1">
          <Link
            href={appointmentsHref(previous, view)}
            aria-label={view === "week" ? "Previous week" : "Previous day"}
            className={buttonClasses({ variant: "ghost", size: "sm", className: "px-3" })}
          >
            <ChevronLeftIcon className="size-5" />
          </Link>
          <Link
            href={appointmentsHref(today, view)}
            aria-current={date === today ? "date" : undefined}
            className={buttonClasses({ variant: "outline", size: "sm" })}
          >
            Today
          </Link>
          <Link
            href={appointmentsHref(next, view)}
            aria-label={view === "week" ? "Next week" : "Next day"}
            className={buttonClasses({ variant: "ghost", size: "sm", className: "px-3" })}
          >
            <ChevronRightIcon className="size-5" />
          </Link>
        </nav>
      </div>

      <AppointmentWeekStrip days={week.days} selected={date} view={view} today={today} />

      {day ? (
        <DayView day={day} now={now} />
      ) : (
        <WeekAgenda days={week.days} today={today} now={now} />
      )}

      <BookAppointmentButton presetDate={date} variant="fab" />
    </>
  );
}

function DayView({ day, now }: { day: Awaited<ReturnType<typeof listDay>>; now: Date }) {
  const active = day.appointments.filter((a) => a.status !== "cancelled");
  const cancelled = day.appointments.filter((a) => a.status === "cancelled");
  return (
    <div className="flex flex-col gap-4">
      {day.customHours && !day.closedAllDay ? <CustomHoursBanner hours={day.customHours} /> : null}

      {day.closedAllDay ? (
        <EmptyState
          icon={<CalendarIcon />}
          title={`Closed: ${day.closedReason ?? "the shop is closed"}`}
          description={
            active.length > 0
              ? "Bookings made before the closure are still listed below. Call the customers to rebook them."
              : "Nothing can be booked on this day."
          }
          action={
            day.nextOpenDay ? (
              <Link
                href={appointmentsHref(day.nextOpenDay, "day")}
                className={buttonClasses({ variant: "outline", size: "sm" })}
              >
                Next open day: {formatShopDay(day.nextOpenDay)}
              </Link>
            ) : null
          }
        />
      ) : null}

      {active.length === 0 && !day.closedAllDay ? (
        <EmptyState
          icon={<CalendarIcon />}
          title="Nothing booked"
          description={`Open ${day.stretches.map((s) => `${s.opens}–${s.closes}`).join(", ")}. Book a customer in, or walk-ins go straight to New job.`}
          action={<BookAppointmentButton presetDate={day.day} />}
        />
      ) : null}

      {active.length > 0 || !day.closedAllDay ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            {active.length > 0 ? <DayAppointments appointments={active} now={now} /> : null}
            {cancelled.length > 0 ? (
              <details className="rounded-2xl border border-hairline bg-card px-4 py-2">
                <summary className="flex min-h-tap cursor-pointer items-center font-semibold">
                  {cancelled.length} cancelled
                </summary>
                <div className="pb-2">
                  <DayAppointments appointments={cancelled} now={now} />
                </div>
              </details>
            ) : null}
          </div>
          {day.windows.length > 0 ? (
            <Card title="Capacity" eyebrow={`${day.settings.slotMinutes}-minute slots`}>
              <p className="mb-3 text-sm text-dust-500">
                Each slot takes {day.settings.capacityUnits}{" "}
                {day.settings.capacityUnits === 1 ? "unit" : "units"} of intake across the shop.
              </p>
              <CapacityBars windows={day.windows} />
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
