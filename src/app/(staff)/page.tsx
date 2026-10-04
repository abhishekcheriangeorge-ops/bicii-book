import type { Metadata } from "next";

import { Card } from "@/components/ui/card";
import { requireStaff } from "@/lib/auth/session";
import { formatDate, greetingFor } from "@/lib/dates";

export const metadata: Metadata = { title: "Today" };

const TILES = [
  { label: "In the workshop", hint: "Open jobs by status" },
  { label: "Ready for collection", hint: "Completed, not yet collected" },
  { label: "Appointments today", hint: "Bookings and arrivals" },
  { label: "Low stock", hint: "Products under their reorder point" },
] as const;

/**
 * The Today dashboard (SPEC §19.1). Phase 0 shows the greeting and the
 * tiles' places; M1.5 fills them from reporting.daily_summary.
 */
export default async function TodayPage() {
  const staff = await requireStaff();
  const now = new Date();
  const firstName = staff.displayName.split(/\s+/)[0];
  return (
    <>
      <header className="flex flex-col gap-2 pt-6">
        <p className="eyebrow text-dust-500">{formatDate(now)}</p>
        <h1 className="text-4xl sm:text-5xl">
          {greetingFor(now)}, {firstName}
        </h1>
      </header>
      <section aria-labelledby="today-tiles" className="flex flex-col gap-3">
        <h2 id="today-tiles" className="sr-only">
          Today at a glance
        </h2>
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {TILES.map((tile) => (
            <li key={tile.label}>
              <Card className="h-full">
                {/* Label and value read together: dt/dd, so M1.5 drops the
                    real count into the dd and screen readers say both. */}
                <dl>
                  <dt className="eyebrow text-dust-500">{tile.label}</dt>
                  <dd className="mt-2 font-display text-4xl font-extrabold text-dust-300">
                    <span aria-hidden="true">—</span>
                    <span className="sr-only">Not available yet</span>
                  </dd>
                </dl>
                <p className="mt-1 text-sm text-dust-500">{tile.hint}</p>
              </Card>
            </li>
          ))}
        </ul>
        <p className="text-sm text-dust-500">
          Live figures arrive with the Today milestone (M1.5), once jobs and stock exist.
        </p>
      </section>
    </>
  );
}
