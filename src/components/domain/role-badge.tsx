import type { ReactNode } from "react";

import { Badge, type Tone } from "@/components/ui/badge";
import { ROLE_LABELS, type StaffRole } from "@/lib/auth/permissions";

// Each role its own tone; ExtraAccessBadge's tone (waiting) is none of them.
const ROLE_TONES: Record<StaffRole, Tone> = {
  admin: "info",
  manager: "progress",
  mechanic: "neutral",
};

/** A staff member's role as a badge with its word: Admin, Manager or Mechanic (D90). */
export function RoleBadge({ role }: { role: StaffRole }) {
  return <Badge tone={ROLE_TONES[role]}>{ROLE_LABELS[role]}</Badge>;
}

/**
 * An "Extra access" exception on top of the role (D92), the same on every
 * screen: the waiting tone, which no RoleBadge uses, so an exception never
 * looks like a role. Defaults to the words "Extra access"; the staff list
 * passes the permission's label.
 */
export function ExtraAccessBadge({ children = "Extra access" }: { children?: ReactNode }) {
  return <Badge tone="waiting">{children}</Badge>;
}
