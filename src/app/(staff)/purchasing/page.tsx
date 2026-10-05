import type { Metadata } from "next";

import { ComingSoon } from "@/components/shell/coming-soon";
import { TruckIcon } from "@/components/ui/icons";
import { requireStaff } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Purchasing" };

export default async function Page() {
  await requireStaff();
  return (
    <ComingSoon
      title="Purchasing"
      phase="Phase 7 (Purchasing)"
      icon={<TruckIcon />}
      description="Suppliers, purchase orders and receiving."
    />
  );
}
