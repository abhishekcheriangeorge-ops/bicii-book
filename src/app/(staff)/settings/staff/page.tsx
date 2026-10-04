import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { ChevronRightIcon, PlusIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { PERMISSION_LABELS } from "@/lib/auth/permissions";
import { requireStaff } from "@/lib/auth/session";
import { listStaff } from "@/lib/domain/staff";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Staff" };

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
      <ul
        aria-label="Staff members"
        className="overflow-hidden rounded-2xl border border-hairline bg-card"
      >
        {staff.map((s, i) => (
          <li key={s.staffId} className={i > 0 ? "border-t border-hairline" : undefined}>
            <Link
              href={`/settings/staff/${s.staffId}`}
              className="flex min-h-16 items-center gap-4 px-4 py-3 transition-colors hover:bg-dust-100"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{s.displayName}</span>
                  {s.staffId === me.staffId ? (
                    <span className="text-sm text-dust-500">(you)</span>
                  ) : null}
                  <Badge tone={s.role === "admin" ? "info" : "neutral"}>
                    {s.role === "admin" ? "Admin" : "Staff"}
                  </Badge>
                  {s.active ? null : <Badge tone="danger">Deactivated</Badge>}
                </span>
                <span className="truncate text-sm text-dust-500">{s.email}</span>
                <span className="flex flex-wrap gap-1.5">
                  {s.role === "admin" ? (
                    <Badge tone="info" emphasis="soft">
                      All permissions
                    </Badge>
                  ) : s.grantedPermissions.length === 0 ? (
                    <span className="text-sm text-dust-500">Workshop access only</span>
                  ) : (
                    s.grantedPermissions.map((p) => (
                      <Badge key={p}>{PERMISSION_LABELS[p].label}</Badge>
                    ))
                  )}
                </span>
              </span>
              <ChevronRightIcon className="size-5 shrink-0 text-dust-500" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
