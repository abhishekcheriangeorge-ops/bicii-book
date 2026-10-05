import type { Metadata } from "next";

import { signOut } from "@/app/(auth)/login/actions";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CheckIcon, SignOutIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { PERMISSION_LABELS } from "@/lib/auth/permissions";
import { requireStaff } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Your profile" };

export default async function ProfilePage() {
  const staff = await requireStaff();
  const isAdmin = staff.role === "admin";
  return (
    <>
      <PageHeader eyebrow="Settings" title={staff.displayName} description={staff.email} />
      <Card
        title="Role and permissions"
        actions={<Badge tone={isAdmin ? "info" : "neutral"}>{isAdmin ? "Admin" : "Staff"}</Badge>}
      >
        {isAdmin ? (
          <p className="mb-3 text-sm text-dust-500">Admins have every permission.</p>
        ) : null}
        {staff.permissions.length === 0 ? (
          <p className="text-dust-700">
            Workshop access only: jobs, intake, notes, photos, parts, services, scanning and labels.
            Ask an admin if you need more.
          </p>
        ) : (
          <ul aria-label="Your permissions" className="flex flex-col gap-3">
            {staff.permissions.map((p) => (
              <li key={p} className="flex items-start gap-3">
                <CheckIcon className="mt-0.5 size-5 shrink-0 text-done-deep" />
                <span className="flex flex-col">
                  <span className="font-medium">{PERMISSION_LABELS[p].label}</span>
                  <span className="text-sm text-dust-500">{PERMISSION_LABELS[p].description}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <form action={signOut}>
        <SubmitButton
          variant="outline"
          icon={<SignOutIcon className="size-5" />}
          pendingLabel="Signing out…"
        >
          Sign out
        </SubmitButton>
      </form>
    </>
  );
}
