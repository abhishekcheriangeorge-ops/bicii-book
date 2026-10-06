import { getStaff } from "@/lib/auth/session";

import { SideRail } from "./side-rail";

/**
 * The rail for the signed-in staff member: admin-only destinations only
 * for an active admin. Rendered under <Suspense> in the staff layout (the
 * fallback is the rail without them), so the session read does not hold
 * back the shell.
 */
export async function StaffSideRail() {
  const staff = await getStaff();
  return <SideRail isAdmin={!!staff && staff.active && staff.role === "admin"} />;
}
