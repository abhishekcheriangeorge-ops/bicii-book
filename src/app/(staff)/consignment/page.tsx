import type { Metadata } from "next";

import { ComingSoon } from "@/components/shell/coming-soon";
import { TagIcon } from "@/components/ui/icons";
import { requireStaff } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Consignment" };

export default async function Page() {
  await requireStaff();
  return (
    <ComingSoon
      title="Consignment"
      phase="Phase 6 (Consignment)"
      icon={<TagIcon />}
      description="Consignors, consignment intake, sales and settlements."
    />
  );
}
