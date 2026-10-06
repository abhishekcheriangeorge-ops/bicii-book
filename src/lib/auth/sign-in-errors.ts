/**
 * What a Supabase Auth answer means for the person at the sign-in screen
 * (PLAN D10, D70). Pure, so it is unit-tested directly.
 *
 * Asking for a code must look the same whether or not the email has a
 * login (never reveal who is staff). With `shouldCreateUser: false` Auth
 * answers an unknown email with 422 `otp_disabled` BEFORE it applies
 * anything that depends on the address, so:
 *
 *   * every 4xx that is not an address-independent rate limit counts as
 *     "sent", 422 `otp_disabled` included;
 *   * `over_email_send_rate_limit` counts as "sent" too. Auth returns it
 *     only for an address that has a login: the per-address interval
 *     (`max_frequency`, 60 s on hosted projects) and the hourly email cap
 *     count emails actually sent. Saying "too many attempts" there would
 *     tell staff from unknown addresses on the Admin's own screen. Within
 *     the interval the code sent earlier is still valid, so "Check your
 *     email" is also the useful answer.
 *
 * Limits that do not depend on the address (Auth's per-IP
 * `over_request_rate_limit`, a 429 without a code, the Admin's own sign-in
 * limits, D72) and outages say what they are: that reveals nothing about
 * the account and stops people asking for code after code. Wrong, expired,
 * used and superseded codes all get one message (Auth answers 403
 * `otp_expired` for each).
 */

/** The fields auth-js errors carry (AuthApiError, AuthRetryableFetchError, ...). */
export type AuthErrorLike = { status?: number; code?: string; name?: string };

export type CodeRequestOutcome = "sent" | "rate_limited" | "unavailable";
export type CodeVerifyFailure = "invalid_code" | "rate_limited" | "unavailable";
export type SignInMessageKey = "invalid_code" | "rate_limited" | "unavailable" | "not_staff";

/** Auth's per-address email limits: answered only for an address that has a login. */
const PER_ADDRESS_LIMIT_CODE = "over_email_send_rate_limit";

/**
 * Auth's rate-limit codes. `over_request_rate_limit` is per IP, the same
 * for every address; asking for a code checks the per-address one first.
 */
const RATE_LIMIT_CODES = new Set(["over_request_rate_limit", PER_ADDRESS_LIMIT_CODE]);

function rateLimited(error: AuthErrorLike): boolean {
  return error.status === 429 || (error.code !== undefined && RATE_LIMIT_CODES.has(error.code));
}

/**
 * True when Auth refused to email this address again yet (its per-address
 * interval or hourly cap). classifyCodeRequestError counts it as sent; the
 * action logs it, so a real email-quota problem still shows in the logs.
 */
export function isPerAddressEmailLimit(error: AuthErrorLike | null | undefined): boolean {
  return error?.code === PER_ADDRESS_LIMIT_CODE;
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
  // Before the status checks: it comes as a 429, but only for an address
  // with a login, so it must look exactly like 422 otp_disabled (D70).
  if (isPerAddressEmailLimit(error)) return "sent";
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
  not_staff:
    "This email doesn't have access to BICII Admin. Ask an admin to invite or reactivate you.",
};

export const SIGN_IN_FIELD_MESSAGES = {
  email: "Enter your email address.",
  code: "Enter the 6-digit code from the email.",
} as const;
