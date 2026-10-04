import type { Metadata } from "next";

import { ComingSoon } from "@/components/shell/coming-soon";
import { WrenchIcon } from "@/components/ui/icons";
import { requireStaff } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Jobs" };

export default async function Page() {
  await requireStaff();
  return (
    <ComingSoon
      title="Jobs"
      phase="Phase 3 (Workshop)"
      icon={<WrenchIcon />}
      description="The workshop board, My Jobs, intake and job detail with timeline and running totals."
    />
  );
}
