import type { Metadata } from "next";

import { ComingSoon } from "@/components/shell/coming-soon";
import { PrinterIcon } from "@/components/ui/icons";
import { requireStaff } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Labels" };

export default async function Page() {
  await requireStaff();
  return (
    <ComingSoon
      title="Labels"
      phase="Phase 8 (QR and labels)"
      icon={<PrinterIcon />}
      description="Print QR labels for products, units and bikes, and see print history."
    />
  );
}
