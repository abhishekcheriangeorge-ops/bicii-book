import Link from "next/link";

import { requireStaff } from "@/lib/auth/session";

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
  return letters.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

/**
 * The signed-in staff member's avatar, linking to their profile. Rendered
 * inside <Suspense> in the staff layout, so the session check here does not
 * hold back the rest of the shell; it is also the layout's staff gate
 * (redirect to /login or 403). Pages still check for themselves.
 */
export async function ProfileChip() {
  const staff = await requireStaff();
  return (
    <Link
      href="/settings/profile"
      className="flex size-tap items-center justify-center rounded-full"
      aria-label={`Your profile: ${staff.displayName}`}
    >
      <span
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-full bg-ink font-display text-sm font-bold text-paper"
      >
        {initials(staff.displayName)}
      </span>
    </Link>
  );
}

export function ProfileChipSkeleton() {
  return (
    <span className="flex size-tap items-center justify-center" aria-hidden="true">
      <span className="size-10 animate-pulse rounded-full bg-dust-200 motion-reduce:animate-none" />
    </span>
  );
}
