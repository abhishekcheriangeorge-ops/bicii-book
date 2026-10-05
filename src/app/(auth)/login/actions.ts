"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";

import { normaliseCode } from "@/lib/auth/otp";
import { safeNextPath } from "@/lib/auth/redirect";
import {
  SIGN_IN_FIELD_MESSAGES,
  SIGN_IN_MESSAGES,
  classifyCodeRequestError,
  classifyCodeVerifyError,
} from "@/lib/auth/sign-in-errors";
import { getCorrelationId, readStaffProfile } from "@/lib/auth/session";
import { child } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

/**
 * The sign-in screen's state (PLAN D10, D70). Two steps on one page: the
 * email, then the code. Carries the email so nothing typed is lost, never
 * the code. `sentAt` identifies the last send (the form restarts the
 * "Send a new code" countdown when it changes).
 */
export type LoginState =
  | {
      step: "email";
      email?: string;
      next?: string;
      error?: string;
      /** The field the error is about; the form marks it invalid and focuses it. */
      errorField?: "email";
    }
  | {
      step: "code";
      email: string;
      next?: string;
      sentAt: number;
      error?: string;
      errorField?: "code";
      /** A polite confirmation ("We've sent a new code."). */
      notice?: string;
    }
  | null;

const emailSchema = z.email().trim().toLowerCase();

function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

/** `next` as submitted; safeNextPath() vets it where it is used. */
function nextOf(formData: FormData): string | undefined {
  return text(formData, "next") || undefined;
}

/** The previous send's time, while the screen is still on that email's code step. */
function previousSentAt(prev: LoginState, email: string): number | undefined {
  if (prev?.step !== "code" || prev.email !== email) return undefined;
  return Number.isFinite(prev.sentAt) ? prev.sentAt : undefined;
}

/**
 * Step 1, and "Send a new code": asks Supabase Auth to email a code.
 * `shouldCreateUser: false`, so signing in never creates an account; an
 * unknown email gets exactly the screen a staff email gets (Auth's 422
 * `otp_disabled` counts as sent). A rate limit or an outage says so and
 * keeps the email; on a resend it keeps the code step, whose earlier code
 * may still work.
 */
export async function requestCode(prev: LoginState, formData: FormData): Promise<LoginState> {
  const typed = text(formData, "email") ?? "";
  const next = nextOf(formData);
  const resend = formData.get("resend") === "1";
  const parsed = emailSchema.safeParse(typed);
  if (!parsed.success) {
    return {
      step: "email",
      email: typed,
      next,
      error: SIGN_IN_FIELD_MESSAGES.email,
      errorField: "email",
    };
  }
  const email = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  const outcome = classifyCodeRequestError(error);

  // Never the email: who asked for a code is not the log's business.
  const log = child(await getCorrelationId(), { action: "auth.request_code" });
  after(() =>
    log[outcome === "sent" ? "info" : "error"](
      { outcome, status: error?.status, code: error?.code },
      "sign-in code requested",
    ),
  );

  if (outcome !== "sent") {
    const sentAt = resend ? previousSentAt(prev, email) : undefined;
    if (sentAt !== undefined) {
      return { step: "code", email, next, sentAt, error: SIGN_IN_MESSAGES[outcome] };
    }
    return { step: "email", email, next, error: SIGN_IN_MESSAGES[outcome], errorField: "email" };
  }
  return {
    step: "code",
    email,
    next,
    sentAt: Date.now(),
    notice: resend ? "We've sent a new code." : undefined,
  };
}

/**
 * Step 2: exchanges the code for a session (`verifyOtp`, type `email`),
 * then admits only active staff (`my_staff_profile`): anyone else is
 * signed out at once and told this email has no access. On success the
 * browser goes to `next` (same-origin paths only) or Today.
 */
export async function verifyCode(prev: LoginState, formData: FormData): Promise<LoginState> {
  const next = nextOf(formData);
  const parsedEmail = emailSchema.safeParse(text(formData, "email") ?? "");
  if (!parsedEmail.success) {
    return {
      step: "email",
      email: text(formData, "email"),
      next,
      error: SIGN_IN_FIELD_MESSAGES.email,
      errorField: "email",
    };
  }
  const email = parsedEmail.data;
  const sentAt = previousSentAt(prev, email) ?? Date.now();
  const token = normaliseCode(formData.get("code"));
  if (!token) {
    return {
      step: "code",
      email,
      next,
      sentAt,
      error: SIGN_IN_FIELD_MESSAGES.code,
      errorField: "code",
    };
  }

  const supabase = await createClient();
  const log = child(await getCorrelationId(), { action: "auth.verify_code" });
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) {
    const failure = classifyCodeVerifyError(error);
    after(() =>
      log[failure === "invalid_code" ? "warn" : "error"](
        { outcome: "failed", failure, status: error.status, code: error.code },
        "sign-in code refused",
      ),
    );
    return {
      step: "code",
      email,
      next,
      sentAt,
      error: SIGN_IN_MESSAGES[failure],
      errorField: "code",
    };
  }

  let failure: "not_staff" | "unavailable" | null = null;
  try {
    const staff = await readStaffProfile(supabase);
    if (!staff || !staff.active) failure = "not_staff";
  } catch {
    after(() =>
      log.error(
        { outcome: "failed", failure: "unavailable", code: "my_staff_profile" },
        "could not read the staff profile after sign-in",
      ),
    );
    failure = "unavailable";
  }
  if (failure) {
    // A valid code for a login that is not active staff (a deactivated
    // colleague, a customer login): end the session it just created.
    await supabase.auth.signOut({ scope: "local" });
    after(() => log.warn({ outcome: "refused", failure }, "signed in but not active staff"));
    return { step: "email", email, next, error: SIGN_IN_MESSAGES[failure], errorField: "email" };
  }

  after(() => log.info({ outcome: "ok" }, "signed in with a code"));
  redirect(safeNextPath(next));
}

/** "Use a different email": back to step 1 with the email kept. */
export async function changeEmail(_prev: LoginState, formData: FormData): Promise<LoginState> {
  return { step: "email", email: text(formData, "email"), next: nextOf(formData) };
}

/**
 * The one action the sign-in form uses (useActionState keeps one state for
 * both steps): routes on the submitted `intent`. Bound directly, so the
 * forms post without JavaScript too.
 */
export async function signInStep(prev: LoginState, formData: FormData): Promise<LoginState> {
  switch (formData.get("intent")) {
    case "verify":
      return verifyCode(prev, formData);
    case "change_email":
      return changeEmail(prev, formData);
    default:
      return requestCode(prev, formData);
  }
}

/** Ends this device's session and returns to the login page. */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  const log = child(await getCorrelationId(), { action: "auth.sign_out" });
  after(() => log.info({ outcome: "ok" }, "sign out"));
  redirect("/login");
}
