import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  PERMISSIONS,
  accessChangeBlocker,
  permissionChangeBlocker,
  type PermissionKey,
} from "@/lib/auth/permissions";
import { requireStaff } from "@/lib/auth/session";
import { getStaffMember, listStaffHistory } from "@/lib/domain/staff";
import { createClient } from "@/lib/supabase/server";

import { StaffHistory } from "./staff-history";
import { AccessControl, PermissionSwitches } from "./staff-controls";

export const metadata: Metadata = { title: "Staff member" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function StaffMemberPage({ params }: PageProps<"/settings/staff/[staffId]">) {
  const me = await requireStaff("manage_staff");
  const { staffId } = await params;
  if (!UUID.test(staffId)) notFound();
  const supabase = await createClient();
  const member = await getStaffMember(supabase, staffId);
  if (!member) notFound();
  const history = await listStaffHistory(supabase, staffId);

  const isAdmin = member.role === "admin";
  // The same rules the RPCs enforce (PLAN D11): show why a control is off.
  const blockers = Object.fromEntries(
    PERMISSIONS.map((p) => [p, permissionChangeBlocker(me, member, p)]),
  ) as Record<PermissionKey, string | null>;
  const accessBlocker = accessChangeBlocker(me, member);

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
          <>
            {me.role !== "admin" ? (
              <p className="mb-2 text-sm text-dust-500">
                You can grant or remove the permissions you have yourself. Only an admin changes
                Manage staff, or your own permissions.
              </p>
            ) : null}
            <PermissionSwitches
              staffId={member.staffId}
              granted={member.grantedPermissions}
              disabled={!member.active}
              blockers={blockers}
            />
          </>
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
          blocker={accessBlocker}
        />
      </Card>
      <Card title="History">
        <StaffHistory events={history} />
      </Card>
    </>
  );
}
