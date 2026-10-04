"use server";

import { z } from "zod";

import { ActionError, staffAction } from "@/lib/actions";

const passwordSchema = z
  .object({
    password: z.string().min(12, { error: "Use at least 12 characters." }).max(72, {
      error: "Use at most 72 characters.",
    }),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    error: "The passwords don't match.",
    path: ["confirm"],
  });

/** Replace the temporary password an admin handed over (or any old one). */
export const changePassword = staffAction(
  passwordSchema,
  { name: "auth.change_password" },
  async ({ password }, { supabase }) => {
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
