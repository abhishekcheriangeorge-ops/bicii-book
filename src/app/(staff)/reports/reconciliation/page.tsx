import type { Metadata } from "next";

import { ComingSoon } from "@/components/shell/coming-soon";
import { BoxIcon } from "@/components/ui/icons";
import { requireStaff } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Stock reconciliation" };

/** Placeholder until Phase 9 step 4 builds stock reconciliation; the Reports link never 404s. */
export default async function Page() {
  await requireStaff();
  return (
    <ComingSoon
      title="Stock reconciliation"
      phase="Phase 9 step 4"
      icon={<BoxIcon />}
      description="Stock on hand checked against the ledger, product by product and location by location."
    />
  );
}
