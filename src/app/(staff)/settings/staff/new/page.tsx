import type { Metadata } from "next";

import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireStaff } from "@/lib/auth/session";

import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Invite staff" };

export default async function InviteStaffPage() {
  const me = await requireStaff("manage_staff");
  return (
    <>
      <PageHeader
        eyebrow="Staff"
        title="Invite staff"
        description="Creates their login with a temporary password you hand over in person. They change it under Settings → Your profile."
      />
      <Card>
        <InviteForm canInviteAdmin={me.role === "admin"} />
      </Card>
    </>
  );
}
