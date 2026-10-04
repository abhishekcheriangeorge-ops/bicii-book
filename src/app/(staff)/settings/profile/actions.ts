"use server";

import { z } from "zod";

import { ActionError, staffAction } from "@/lib/actions";
import { SIGN_IN_MESSAGES } from "@/lib/auth/sign-in-errors";
import { verifyPassword } from "@/lib/auth/verify-password";

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, { error: "Enter your current password." }),
    password: z.string().min(12, { error: "Use at least 12 characters." }).max(72, {
      error: "Use at most 72 characters.",
    }),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    error: "The passwords don't match.",
    path: ["confirm"],
  });

const WRONG_CURRENT = "That isn't your current password.";

/**
 * Replace the temporary password an admin handed over (or any old one).
 * Requires the current password, checked server-side first, so a session
 * left signed in on a shared shop iPad cannot be used to lock the real
 * person out.
 */
export const changePassword = staffAction(
  passwordSchema,
  { name: "auth.change_password" },
  async ({ currentPassword, password }, { session, staff, supabase }) => {
    const check = await verifyPassword(session.email ?? staff.email, currentPassword);
    if (!check.ok) {
      if (check.failure === "credentials") {
        throw new ActionError(WRONG_CURRENT, { currentPassword: [WRONG_CURRENT] });
      }
      throw new ActionError(SIGN_IN_MESSAGES[check.failure]);
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      if (error.code === "same_password") {
        throw new ActionError("Choose a password you haven't used here before.", {
          password: ["Choose a password you haven't used here before."],
        });
      }
      if (error.code === "weak_password") {
        throw new ActionError("That password is too weak.", {
          password: ["That password is too weak."],
        });
      }
      throw new ActionError("The password could not be changed. Try again.");
    }
    return null;
  },
);
