import type { Metadata } from "next";

import { ComingSoon } from "@/components/shell/coming-soon";
import { UsersIcon } from "@/components/ui/icons";
import { requireStaff } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Customers" };

export default async function Page() {
  await requireStaff();
  return (
    <ComingSoon
      title="Customers"
      phase="Phase 1 (Customers, bikes, attachments)"
      icon={<UsersIcon />}
      description="Search, create and edit customers, with their bikes and history."
    />
  );
}
