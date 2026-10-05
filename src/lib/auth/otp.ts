/**
 * Staff sign-in codes (PLAN D10, D70): Supabase Auth emails a 6-digit code
 * that is valid for 10 minutes; each new code replaces the previous one.
 * Pure, so the login form (client) and the server actions share it and it
 * is unit-tested directly.
 *
 * The numbers must match Auth's settings: `GOTRUE_MAILER_OTP_LENGTH` /
 * `GOTRUE_MAILER_OTP_EXP` in the devstack (scripts/devstack/services.mjs),
 * `otp_length` / `otp_expiry` in supabase/config.toml, and the hosted
 * project's Email provider settings (RUNBOOK "Hosted Supabase projects").
 */

export const OTP_LENGTH = 6;
export const OTP_EXPIRY_MINUTES = 10;
/**
 * "Send a new code" unlocks this long after the last send. Matches the
 * hosted project's per-address minimum interval between emails (RUNBOOK).
 */
export const RESEND_COOLDOWN_SECONDS = 60;

const CODE_PATTERN = new RegExp(`^\\d{${OTP_LENGTH}}$`);

/**
 * The code as Auth expects it, or null. People paste "123 456" or
 * "123-456" (some mail apps and autofill tools group digits), so
 * whitespace (including non-breaking spaces) and hyphens or dashes are
 * dropped first; anything else that is not exactly six digits is refused.
 */
export function normaliseCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const digits = input.replace(/[\s\u00a0\u2007\u202f\-\u2010-\u2015\u2212]/g, "");
  return CODE_PATTERN.test(digits) ? digits : null;
}

/**
 * Whole seconds until "Send a new code" unlocks, 0 when it is open.
 * Rounded up, so the button never unlocks early; a clock that moved
 * backwards never waits longer than the cooldown.
 */
export function resendSecondsLeft(sentAtMs: number, nowMs: number): number {
  if (!Number.isFinite(sentAtMs) || !Number.isFinite(nowMs)) return 0;
  const left = Math.ceil((sentAtMs + RESEND_COOLDOWN_SECONDS * 1000 - nowMs) / 1000);
  return Math.min(Math.max(left, 0), RESEND_COOLDOWN_SECONDS);
}

/** 59 -> "0:59", 60 -> "1:00". */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
