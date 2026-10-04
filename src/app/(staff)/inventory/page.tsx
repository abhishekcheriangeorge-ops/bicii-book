import type { Metadata } from "next";

import { ComingSoon } from "@/components/shell/coming-soon";
import { BoxIcon } from "@/components/ui/icons";
import { requireStaff } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Inventory" };

export default async function Page() {
  await requireStaff();
  return (
    <ComingSoon
      title="Inventory"
      phase="Phase 4 (Inventory)"
      icon={<BoxIcon />}
      description="Products, stock by location, unique units, movements and stock adjustments."
    />
  );
}
