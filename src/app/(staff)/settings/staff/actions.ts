"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { ActionError, staffAction } from "@/lib/actions";
import { LoginExistsError, createStaffLogin, deleteStaffLogin } from "@/lib/admin/staff-logins";
import { Constants } from "@/lib/database.types";
import { linkStaff, setActive, setPermission } from "@/lib/domain/staff";

const staffId = z.uuid({ error: "Unknown staff member." });

const inviteSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, { error: "Enter their name." })
    .max(80, { error: "Keep the name under 80 characters." }),
  email: z.email({ error: "Enter a valid email address." }).trim().toLowerCase(),
  role: z.enum(Constants.public.Enums.staff_role).default("staff"),
});

export type InviteResult = { staffId: string; email: string; temporaryPassword: string };

/**
 * Invite a colleague: create their Supabase Auth login (service-role admin
 * API, src/lib/admin) with a one-time temporary password, then link the
 * staff row through create_staff AS THE INVITING USER, so the database
 * checks manage_staff (and admin-only for admins) itself. If linking fails
 * the login is deleted again. The password is returned once for the admin
 * to hand over; it is not stored or logged.
 */
export const inviteStaff = staffAction(
  inviteSchema,
  { name: "staff.invite", permission: "manage_staff" },
  async (input, { staff, supabase, log }): Promise<InviteResult> => {
    if (input.role === "admin" && staff.role !== "admin") {
      throw new ActionError("Only an admin can invite another admin.", {
        role: ["Only an admin can invite another admin."],
      });
    }
    let login: { userId: string; temporaryPassword: string };
    try {
      login = await createStaffLogin({ email: input.email, displayName: input.displayName });
    } catch (err) {
      if (err instanceof LoginExistsError) {
        throw new ActionError("An account with that email already exists.", {
          email: ["An account with that email already exists."],
        });
      }
      throw err;
    }
    try {
      const { staffId } = await linkStaff(supabase, {
        authUserId: login.userId,
        displayName: input.displayName,
        email: input.email,
        role: input.role,
      });
      refresh();
      return { staffId, email: input.email, temporaryPassword: login.temporaryPassword };
    } catch (err) {
      await deleteStaffLogin(login.userId).catch((cleanupError) =>
        log.error({ cleanupError, userId: login.userId }, "could not delete orphaned login"),
      );
      throw err;
    }
  },
);

export const setStaffPermission = staffAction(
  z.object({
    staffId,
    permission: z.enum(Constants.public.Enums.permission_key),
    granted: z.boolean(),
  }),
  { name: "staff.set_permission", permission: "manage_staff" },
  async (input, { supabase }) => {
    await setPermission(supabase, input);
    refresh();
    return null;
  },
);

export const setStaffActive = staffAction(
  z.object({ staffId, active: z.boolean() }),
  { name: "staff.set_active", permission: "manage_staff" },
  async (input, { staff, supabase }) => {
    if (input.staffId === staff.staffId && !input.active) {
      throw new ActionError("You can't deactivate yourself.");
    }
    await setActive(supabase, input);
    refresh();
    return null;
  },
);
