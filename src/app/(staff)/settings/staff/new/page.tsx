import type { Metadata } from "next";

import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { invitableRoles } from "@/lib/auth/permissions";
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
        description="Creates their login. They sign in with their email and a one-time code; there is no password to hand over."
      />
      <Card>
        <InviteForm roles={invitableRoles(me)} />
      </Card>
    </>
  );
}
