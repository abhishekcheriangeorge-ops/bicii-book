import type { Metadata } from "next";

import { ComingSoon } from "@/components/shell/coming-soon";
import { AlertIcon } from "@/components/ui/icons";
import { requireStaff } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Exceptions" };

/** Placeholder until Phase 9 step 4 builds the exceptions screen; the Reports link never 404s. */
export default async function Page() {
  await requireStaff();
  return (
    <ComingSoon
      title="Exceptions"
      phase="Phase 9 step 4"
      icon={<AlertIcon />}
      description="Every operational exception in one list: negative stock, cost pending, foreign-currency lines, unsettled consignment and more."
    />
  );
}
