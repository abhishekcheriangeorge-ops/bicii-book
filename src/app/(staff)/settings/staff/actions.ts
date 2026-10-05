"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { staffAction } from "@/lib/actions";
import { Constants } from "@/lib/database.types";
import {
  REASON_MAX,
  inviteStaff as invite,
  setActive,
  setPermission,
  type InviteResult,
} from "@/lib/domain/staff";

export type { InviteResult };

const staffId = z.uuid({ error: "Unknown staff member." });

const inviteSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, { error: "Enter their name." })
    .max(80, { error: "Keep the name under 80 characters." }),
  email: z.email({ error: "Enter a valid email address." }).trim().toLowerCase(),
  role: z.enum(Constants.public.Enums.staff_role).default("mechanic"),
});

/** Invite a colleague (src/lib/domain/staff.ts inviteStaff). */
export const inviteStaff = staffAction(
  inviteSchema,
  { name: "staff.invite", permission: "manage_staff" },
  async (input, { staff, supabase, log }): Promise<InviteResult> => {
    const result = await invite(supabase, staff, input, (cleanupError, userId) =>
      log.error({ cleanupError, userId }, "could not delete orphaned login"),
    );
    refresh();
    return result;
  },
);

export const setStaffPermission = staffAction(
  z.object({
    staffId,
    permission: z.enum(Constants.public.Enums.permission_key),
    granted: z.boolean(),
  }),
  { name: "staff.set_permission", permission: "manage_staff" },
  async (input, { staff, supabase }) => {
    await setPermission(supabase, staff, input);
    refresh();
    return null;
  },
);

export const setStaffActive = staffAction(
  z.object({
    staffId,
    active: z.boolean(),
    reason: z
      .string()
      .trim()
      .max(REASON_MAX, { error: `Keep the reason under ${REASON_MAX} characters.` })
      .optional(),
  }),
  { name: "staff.set_active", permission: "manage_staff" },
  async (input, { staff, supabase }) => {
    await setActive(supabase, staff, input);
    refresh();
    return null;
  },
);
