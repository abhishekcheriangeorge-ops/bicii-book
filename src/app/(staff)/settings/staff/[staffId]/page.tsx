import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RoleBadge } from "@/components/domain/role-badge";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  PERMISSIONS,
  PERMISSION_LABELS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  accessChangeBlocker,
  exceptionsOf,
  isExceptionFor,
  permissionChangeBlocker,
  roleChangeBlocker,
} from "@/lib/auth/permissions";
import { joinList } from "@/lib/auth/role-change";
import { requireStaff } from "@/lib/auth/session";
import { getStaffMember, listStaffHistory } from "@/lib/domain/staff";
import { createClient } from "@/lib/supabase/server";

import { StaffHistory } from "./staff-history";
import { AccessControl, PermissionSwitches, RoleControl } from "./staff-controls";

export const metadata: Metadata = { title: "Staff member" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One staff member (SPEC §21; PLAN D90-D93): their role (admins change
 * it), their "Extra access" exceptions on top of the role, their access
 * and their history. Every control mirrors the RPC that decides (the
 * blockers in src/lib/auth/permissions.ts) and shows why it is off.
 */
export default async function StaffMemberPage({ params }: PageProps<"/settings/staff/[staffId]">) {
  const me = await requireStaff("manage_staff");
  const { staffId } = await params;
  if (!UUID.test(staffId)) notFound();
  const supabase = await createClient();
  const member = await getStaffMember(supabase, staffId);
  if (!member) notFound();
  const history = await listStaffHistory(supabase, staffId);

  const roleLabel = ROLE_LABELS[member.role];
  const included = ROLE_PERMISSIONS[member.role];
  // Only what the role does not include can be an exception (D92).
  const offered = PERMISSIONS.filter((p) => isExceptionFor(member.role, p));
  const blockers = Object.fromEntries(
    offered.map((p) => [p, permissionChangeBlocker(me, member, p)]),
  );
  const accessBlocker = accessChangeBlocker(me, member);
  const roleBlocker = roleChangeBlocker(me, member);

  return (
    <>
      <PageHeader
        eyebrow="Staff"
        title={member.displayName}
        description={member.email}
        actions={
          <>
            <RoleBadge role={member.role} />
            {member.active ? (
              <Badge tone="done">Active</Badge>
            ) : (
              <Badge tone="danger">Deactivated</Badge>
            )}
          </>
        }
      />
      <Card title="Role">
        <p className="mb-3 text-dust-700">
          <span className="font-medium text-ink">{roleLabel}</span>:{" "}
          {ROLE_DESCRIPTIONS[member.role]}.
        </p>
        {me.role === "admin" && me.active ? (
          // Admins change roles, never their own (D93): the picker shows,
          // disabled with the reason on their own row.
          <RoleControl
            key={member.role}
            staffId={member.staffId}
            name={member.displayName}
            role={member.role}
            exceptions={exceptionsOf(member.role, member.grantedPermissions)}
            blocker={roleBlocker}
          />
        ) : (
          <p className="text-sm text-dust-500">Only an admin changes roles.</p>
        )}
      </Card>
      <Card title="Extra access">
        {offered.length === 0 ? (
          <p className="text-dust-700">
            Admins have every permission; there is nothing extra to grant.
          </p>
        ) : (
          <>
            {included.length > 0 ? (
              <p className="mb-2 text-dust-700">
                Included in the {roleLabel} role:{" "}
                {joinList(included.map((p) => PERMISSION_LABELS[p].label))}.
              </p>
            ) : (
              <p className="mb-2 text-dust-700">
                The {roleLabel} role has workshop access only. Turn on anything extra they need.
              </p>
            )}
            {me.role !== "admin" ? (
              <p className="mb-2 text-sm text-dust-500">
                You can grant or remove the permissions you have yourself, for mechanics. Only an
                admin changes Manage staff, your own access, or an admin&apos;s or a manager&apos;s.
              </p>
            ) : null}
            <PermissionSwitches
              staffId={member.staffId}
              permissions={offered}
              granted={member.grantedPermissions}
              disabled={!member.active}
              blockers={blockers}
            />
          </>
        )}
        {!member.active && offered.length > 0 ? (
          <p className="mt-3 text-sm text-dust-500">
            Deactivated staff have no permissions while deactivated; their role and extra access are
            kept for when they return.
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
