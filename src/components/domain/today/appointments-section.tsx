import type { ReactNode } from "react";

import type { TodayDashboard } from "@/lib/reports";

import { StatTile, TileGrid, TodaySection } from "./stat-tile";

/**
 * Today's appointments (server). The slot Phase 2 extends: until Phase 2
 * fills today_dashboard's appointment columns, `appointments` is null and
 * each tile shows Phase 0's placeholder ("—", "Not tracked yet" for screen
 * readers, "Arrives with appointments"); once they are filled the numbers
 * appear with no change here.
 *
 * `children`: Phase 2 passes the day's appointment list here (TESTING
 * journey 2, "appears on Today"); it renders under the tiles.
 */
export function AppointmentsSection({
  appointments,
  children,
}: {
  appointments: TodayDashboard["appointments"];
  children?: ReactNode;
}) {
  const tracked = appointments !== null;
  const hint = tracked ? undefined : "Arrives with appointments";
  return (
    <TodaySection id="today-appointments" title="Appointments">
      <TileGrid columns={3}>
        <StatTile
          label="Scheduled"
          value={appointments?.scheduled ?? 0}
          notTracked={!tracked}
          hint={hint}
        />
        <StatTile
          label="Arrived"
          value={appointments?.arrived ?? 0}
          notTracked={!tracked}
          hint={hint}
        />
        <StatTile
          label="No-shows"
          value={appointments?.noShow ?? 0}
          notTracked={!tracked}
          hint={hint}
        />
      </TileGrid>
      {children}
    </TodaySection>
  );
}
