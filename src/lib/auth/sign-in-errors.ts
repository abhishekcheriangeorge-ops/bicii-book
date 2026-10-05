/**
 * What a failed Supabase Auth password check means for the person at the
 * screen. Pure, so it is unit-tested directly.
 *
 * Wrong email and wrong password must look the same (never reveal whether
 * an account exists): Supabase Auth answers both with 400
 * `invalid_credentials`, and every other 4xx gets that same message too.
 * An outage or a rate limit does not depend on the account, so saying so
 * reveals nothing, and it stops people with the right password retyping it
 * (feeding the rate limiter) or asking for a reset.
 */
export type SignInFailure = "credentials" | "rate_limited" | "unavailable";

/** The fields auth-js errors carry (AuthApiError, AuthRetryableFetchError, ...). */
export type AuthErrorLike = { status?: number; code?: string; name?: string };

const RATE_LIMIT_CODES = new Set(["over_request_rate_limit", "over_email_send_rate_limit"]);

export function classifySignInError(error: AuthErrorLike): SignInFailure {
  if (error.status === 429 || (error.code && RATE_LIMIT_CODES.has(error.code))) {
    return "rate_limited";
  }
  // auth-js reports a network failure as AuthRetryableFetchError with status
  // 0, and 502/503/504 with the same class; any 5xx is Auth being down.
  if (
    error.name === "AuthRetryableFetchError" ||
    error.status === undefined ||
    error.status === 0 ||
    error.status >= 500
  ) {
    return "unavailable";
  }
  return "credentials";
}

export const SIGN_IN_MESSAGES: Record<SignInFailure, string> = {
  credentials: "That email and password don't match. Try again.",
  rate_limited: "Too many attempts. Wait a minute and try again.",
  unavailable: "Sign-in is unavailable right now. Try again in a minute.",
};
