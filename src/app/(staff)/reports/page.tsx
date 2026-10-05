import type { Metadata } from "next";

import { ComingSoon } from "@/components/shell/coming-soon";
import { ChartIcon } from "@/components/ui/icons";
import { requireStaff } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Reports" };

export default async function Page() {
  await requireStaff();
  return (
    <ComingSoon
      title="Reports"
      phase="Phase 9 (Reporting)"
      icon={<ChartIcon />}
      description="Day, week and month reports by job, product, service and mechanic."
    />
  );
}
