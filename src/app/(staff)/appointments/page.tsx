import type { Metadata } from "next";

import { ComingSoon } from "@/components/shell/coming-soon";
import { CalendarIcon } from "@/components/ui/icons";
import { requireStaff } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Appointments" };

export default async function Page() {
  await requireStaff();
  return (
    <ComingSoon
      title="Appointments"
      phase="Phase 2 (Appointments)"
      icon={<CalendarIcon />}
      description="Day and week views, bookings, shop hours, closures and capacity."
    />
  );
}
