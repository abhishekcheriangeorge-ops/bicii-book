"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";

import { safeNextPath } from "@/lib/auth/redirect";
import { getCorrelationId } from "@/lib/auth/session";
import { child } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

export type LoginState = {
  error?: string;
  fieldErrors?: { email?: string[]; password?: string[] };
  /** Echoed back so a failed attempt keeps the email typed. Never the password. */
  email?: string;
} | null;

const loginSchema = z.object({
  email: z.email({ error: "Enter your email address." }).trim().toLowerCase(),
  password: z.string().min(1, { error: "Enter your password." }),
  next: z.string().optional(),
});

/** Same message for every failure: never reveal whether the email exists. */
const LOGIN_FAILED = "That email and password don't match. Try again.";

/**
 * Staff sign-in (PLAN D10: Supabase email + password). On success the
 * session cookies are set by the server client and the browser is sent to
 * `next` (same-origin paths only) or Today.
 */
export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const raw = {
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  };
  const parsed = loginSchema.safeParse(raw);
  const typedEmail = typeof raw.email === "string" ? raw.email : undefined;
  if (!parsed.success) {
    const fieldErrors = z.flattenError(parsed.error).fieldErrors;
    return {
      error: "Enter your email and password.",
      fieldErrors: { email: fieldErrors.email, password: fieldErrors.password },
      email: typedEmail,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  const log = child(await getCorrelationId(), { action: "auth.login" });
  if (error) {
    after(() =>
      log.warn({ outcome: "failed", status: error.status, code: error.code }, "login failed"),
    );
    return { error: LOGIN_FAILED, email: typedEmail };
  }
  after(() => log.info({ outcome: "ok" }, "login"));
  redirect(safeNextPath(parsed.data.next));
}

/** Ends this device's session and returns to the login page. */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  const log = child(await getCorrelationId(), { action: "auth.sign_out" });
  after(() => log.info({ outcome: "ok" }, "sign out"));
  redirect("/login");
}
