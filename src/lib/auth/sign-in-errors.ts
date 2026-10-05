/**
 * What a Supabase Auth answer means for the person at the sign-in screen
 * (PLAN D10, D70). Pure, so it is unit-tested directly.
 *
 * Asking for a code must look the same whether or not the email has a
 * login (never reveal who is staff): with `shouldCreateUser: false` Auth
 * answers an unknown email with 422 `otp_disabled`, so every 4xx that is
 * not a rate limit counts as "sent". Wrong, expired, used and superseded
 * codes all get one message (Auth answers 403 `otp_expired` for each).
 * An outage or a rate limit does not depend on the account, so saying so
 * reveals nothing and stops people asking for code after code.
 */

/** The fields auth-js errors carry (AuthApiError, AuthRetryableFetchError, ...). */
export type AuthErrorLike = { status?: number; code?: string; name?: string };

export type CodeRequestOutcome = "sent" | "rate_limited" | "unavailable";
export type CodeVerifyFailure = "invalid_code" | "rate_limited" | "unavailable";
export type SignInMessageKey = "invalid_code" | "rate_limited" | "unavailable" | "not_staff";

const RATE_LIMIT_CODES = new Set(["over_request_rate_limit", "over_email_send_rate_limit"]);

function rateLimited(error: AuthErrorLike): boolean {
  return error.status === 429 || (error.code !== undefined && RATE_LIMIT_CODES.has(error.code));
}

/**
 * auth-js reports a network failure as AuthRetryableFetchError with status
 * 0, and 502/503/504 with the same class; any 5xx is Auth being down, and
 * an error without a status never reached Auth.
 */
function unavailable(error: AuthErrorLike): boolean {
  return (
    error.name === "AuthRetryableFetchError" ||
    error.status === undefined ||
    error.status === 0 ||
    error.status >= 500
  );
}

/** signInWithOtp's error (null: sent). */
export function classifyCodeRequestError(
  error: AuthErrorLike | null | undefined,
): CodeRequestOutcome {
  if (!error) return "sent";
  if (rateLimited(error)) return "rate_limited";
  if (unavailable(error)) return "unavailable";
  return "sent";
}

/** verifyOtp's error. */
export function classifyCodeVerifyError(error: AuthErrorLike): CodeVerifyFailure {
  if (rateLimited(error)) return "rate_limited";
  if (unavailable(error)) return "unavailable";
  return "invalid_code";
}

export const SIGN_IN_MESSAGES: Record<SignInMessageKey, string> = {
  invalid_code: "That code is wrong or has expired. Check your latest email or send a new code.",
  rate_limited: "Too many attempts. Wait a minute and try again.",
  unavailable: "Sign-in is unavailable right now. Try again in a minute.",
  not_staff: "This email doesn't have access to BICII Admin. Ask an admin to invite you.",
};

export const SIGN_IN_FIELD_MESSAGES = {
  email: "Enter your email address.",
  code: "Enter the 6-digit code from the email.",
} as const;
