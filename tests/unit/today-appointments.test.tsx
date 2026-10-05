import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The Book button is a client sheet over Server Actions; here only its presence matters.
vi.mock("@/components/domain/book-appointment-sheet", () => ({
  BookAppointmentButton: ({ label, presetDate }: { label?: string; presetDate?: string }) => (
    <button type="button" data-preset-date={presetDate}>
      {label ?? "Book appointment"}
    </button>
  ),
}));

import { AppointmentsSection, TodayArrivals } from "@/components/domain/today/appointments-section";
import type { TodayAppointmentSummary } from "@/lib/domain/appointments";
import { NOT_TRACKED } from "@/lib/reports";

const summary = (over: Partial<TodayAppointmentSummary> = {}): TodayAppointmentSummary => ({
  day: "2026-10-06",
  booked: 4,
  expected: 2,
  arrived: 1,
  noShows: 0,
  arrivals: [
    {
      id: "e2000000-0000-4000-8000-000000000004",
      startsAt: "2026-10-06T02:30:00Z",
      endsAt: "2026-10-06T03:00:00Z",
      status: "confirmed",
      customerLabel: "Hafiz Rahman",
      typeName: "Service drop-off",
      late: true,
    },
    {
      id: "e2000000-0000-4000-8000-000000000006",
      startsAt: "2026-10-06T08:00:00Z",
      endsAt: "2026-10-06T08:30:00Z",
      status: "booked",
      customerLabel: "Nurul Huda",
      typeName: "Bike fit",
      late: false,
    },
  ],
  ...over,
});

describe("AppointmentsSection (D41 counts, D30: every staff member)", () => {
  it("shows Scheduled, Arrived and No-shows from today_dashboard with what each counts", () => {
    render(<AppointmentsSection appointments={{ scheduled: 4, arrived: 1, noShow: 2 }} />);
    const section = screen.getByRole("region", { name: "Appointments" });
    expect(within(section).getByText("Scheduled").nextElementSibling).toHaveTextContent("4");
    expect(within(section).getByText("Arrived").nextElementSibling).toHaveTextContent("1");
    expect(within(section).getByText("No-shows").nextElementSibling).toHaveTextContent("2");
    expect(section).toHaveTextContent("Booked for this day");
    expect(section).not.toHaveTextContent("Arrives with appointments");
    expect(screen.queryByText(NOT_TRACKED)).toBeNull();
  });

  it("keeps the placeholder treatment for a day the database did not count", () => {
    render(<AppointmentsSection appointments={null} />);
    expect(screen.getAllByText(NOT_TRACKED)).toHaveLength(3);
  });
});

describe("TodayArrivals", () => {
  it("lists expected arrivals as links to the appointment, named with the time, Late badged", () => {
    render(<TodayArrivals summary={summary()} />);
    const list = screen.getByRole("list", { name: "Arrivals" });
    const links = within(list).getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/appointments/e2000000-0000-4000-8000-000000000004");
    expect(links[0]).toHaveAccessibleName("10:30, Hafiz Rahman, Service drop-off, late");
    expect(links[1]).toHaveAccessibleName("16:00, Nurul Huda, Bike fit");
    expect(screen.getByText("Still expected").nextElementSibling).toHaveTextContent("2");
    expect(screen.getByRole("link", { name: /^See all/ })).toHaveAttribute(
      "href",
      "/appointments?date=2026-10-06",
    );
    expect(screen.getByRole("link", { name: "Still expected: 2" })).toHaveAttribute(
      "href",
      "/appointments?date=2026-10-06",
    );
  });

  it("says how many more are expected beyond the list", () => {
    render(<TodayArrivals summary={summary({ expected: 7 })} />);
    expect(screen.getByText("5 more expected later.")).toBeInTheDocument();
  });

  it("says nobody else is expected, and offers Book on that day", () => {
    render(<TodayArrivals summary={summary({ expected: 0, arrivals: [] })} />);
    expect(screen.getByText("No more arrivals expected today.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Book" })).toHaveAttribute(
      "data-preset-date",
      "2026-10-06",
    );
    expect(screen.queryByRole("link", { name: /Still expected/ })).toBeNull();
  });
});
