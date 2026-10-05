import type { Metadata } from "next";

import { ComingSoon } from "@/components/shell/coming-soon";
import { BikeIcon } from "@/components/ui/icons";
import { requireStaff } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Bikes" };

export default async function Page() {
  await requireStaff();
  return (
    <ComingSoon
      title="Bikes"
      phase="Phase 1 (Customers, bikes, attachments)"
      icon={<BikeIcon />}
      description="Bike records with photos, ownership and service history."
    />
  );
}
