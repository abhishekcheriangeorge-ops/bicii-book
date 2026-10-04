import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireStaff } from "@/lib/auth/session";
import { getStaffMember } from "@/lib/domain/staff";
import { createClient } from "@/lib/supabase/server";

import { AccessControl, PermissionSwitches } from "./staff-controls";

export const metadata: Metadata = { title: "Staff member" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function StaffMemberPage({ params }: PageProps<"/settings/staff/[staffId]">) {
  const me = await requireStaff("manage_staff");
  const { staffId } = await params;
  if (!UUID.test(staffId)) notFound();
  const member = await getStaffMember(await createClient(), staffId);
  if (!member) notFound();

  const isSelf = member.staffId === me.staffId;
  const isAdmin = member.role === "admin";
  // Only an admin changes an admin's status (set_staff_active enforces it too).
  const canChangeAccess = !isSelf && (!isAdmin || me.role === "admin");

  return (
    <>
      <PageHeader
        eyebrow="Staff"
        title={member.displayName}
        description={member.email}
        actions={
          <>
            <Badge tone={isAdmin ? "info" : "neutral"}>{isAdmin ? "Admin" : "Staff"}</Badge>
            {member.active ? (
              <Badge tone="done">Active</Badge>
            ) : (
              <Badge tone="danger">Deactivated</Badge>
            )}
          </>
        }
      />
      <Card title="Permissions">
        {isAdmin ? (
          <p className="text-dust-700">Admins have every permission; there is nothing to grant.</p>
        ) : (
          <PermissionSwitches
            staffId={member.staffId}
            granted={member.grantedPermissions}
            disabled={!member.active}
          />
        )}
        {!member.active && !isAdmin ? (
          <p className="mt-3 text-sm text-dust-500">
            Deactivated staff have no permissions while deactivated; grants are kept for when they
            return.
          </p>
        ) : null}
      </Card>
      <Card title="Access">
        <AccessControl
          staffId={member.staffId}
          name={member.displayName}
          active={member.active}
          canChange={canChangeAccess}
          reason={
            isSelf
              ? "You can't deactivate yourself."
              : isAdmin && me.role !== "admin"
                ? "Only an admin can change an admin's access."
                : undefined
          }
        />
      </Card>
    </>
  );
}
