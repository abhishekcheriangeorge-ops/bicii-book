import { Badge, type Tone } from "@/components/ui/badge";
import { ROLE_LABELS, type StaffRole } from "@/lib/auth/permissions";

const ROLE_TONES: Record<StaffRole, Tone> = {
  admin: "info",
  manager: "progress",
  mechanic: "neutral",
};

/** A staff member's role as a badge with its word: Admin, Manager or Mechanic (D90). */
export function RoleBadge({ role }: { role: StaffRole }) {
  return <Badge tone={ROLE_TONES[role]}>{ROLE_LABELS[role]}</Badge>;
}
