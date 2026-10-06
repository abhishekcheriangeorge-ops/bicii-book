import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { ChevronRightIcon, PlusIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink, RowList } from "@/components/ui/row-list";
import { RoleBadge } from "@/components/domain/role-badge";
import { PERMISSION_LABELS, exceptionsOf } from "@/lib/auth/permissions";
import { requireStaff } from "@/lib/auth/session";
import { listStaff, type StaffMember } from "@/lib/domain/staff";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Staff" };

/**
 * Under each person: what their role includes (D91), then their "Extra
 * access" exceptions on top of it (D92), each marked as extra.
 */
function StaffAccessSummary({ member }: { member: StaffMember }) {
  const extra = exceptionsOf(member.role, member.grantedPermissions);
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="text-sm text-dust-700">
        {member.role === "admin"
          ? "All permissions"
          : member.role === "manager"
            ? "Everything except staff management"
            : extra.length === 0
              ? "Workshop access only"
              : "Workshop access"}
      </span>
      {extra.length > 0 ? (
        <>
          <span className="text-sm text-dust-500">· Extra:</span>
          {extra.map((p) => (
            <Badge key={p}>{PERMISSION_LABELS[p].label}</Badge>
          ))}
        </>
      ) : null}
    </span>
  );
}

/** Staff settings (SPEC §21): admins and manage_staff holders. */
export default async function StaffSettingsPage() {
  const me = await requireStaff("manage_staff");
  const staff = await listStaff(await createClient());
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Staff"
        description="Who can sign in, and what they can see and change."
        actions={
          <ButtonLink href="/settings/staff/new" icon={<PlusIcon className="size-5" />}>
            Invite staff
          </ButtonLink>
        }
      />
      <RowList label="Staff members">
        {staff.map((s) => (
          <RowLink key={s.staffId} href={`/settings/staff/${s.staffId}`}>
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{s.displayName}</span>
                {s.staffId === me.staffId ? (
                  <span className="text-sm text-dust-500">(you)</span>
                ) : null}
                <RoleBadge role={s.role} />
                {s.active ? null : <Badge tone="danger">Deactivated</Badge>}
              </span>
              <span className="truncate text-sm text-dust-500">{s.email}</span>
              <StaffAccessSummary member={s} />
            </span>
            <ChevronRightIcon className="size-5 shrink-0 text-dust-500" />
          </RowLink>
        ))}
      </RowList>
    </>
  );
}
