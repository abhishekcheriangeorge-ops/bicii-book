import { describe, expect, it } from "vitest";

import {
  SIGN_IN_FIELD_MESSAGES,
  SIGN_IN_MESSAGES,
  classifyCodeRequestError,
  classifyCodeVerifyError,
} from "@/lib/auth/sign-in-errors";

describe("classifyCodeRequestError", () => {
  it("no error is sent", () => {
    expect(classifyCodeRequestError(null)).toBe("sent");
    expect(classifyCodeRequestError(undefined)).toBe("sent");
  });

  it("an unknown email (422 otp_disabled) and every other 4xx look sent", () => {
    expect(classifyCodeRequestError({ status: 422, code: "otp_disabled" })).toBe("sent");
    expect(classifyCodeRequestError({ status: 400, code: "validation_failed" })).toBe("sent");
    expect(classifyCodeRequestError({ status: 403, code: "email_provider_disabled" })).toBe("sent");
    expect(classifyCodeRequestError({ status: 404, code: "user_not_found" })).toBe("sent");
  });

  it("reports rate limits separately, by status or by code", () => {
    expect(classifyCodeRequestError({ status: 429, code: "over_email_send_rate_limit" })).toBe(
      "rate_limited",
    );
    expect(classifyCodeRequestError({ status: 429 })).toBe("rate_limited");
    expect(classifyCodeRequestError({ status: 400, code: "over_request_rate_limit" })).toBe(
      "rate_limited",
    );
    expect(classifyCodeRequestError({ status: 400, code: "over_email_send_rate_limit" })).toBe(
      "rate_limited",
    );
  });

  it("reports outages and network failures as unavailable", () => {
    expect(classifyCodeRequestError({ status: 500, code: "unexpected_failure" })).toBe(
      "unavailable",
    );
    expect(classifyCodeRequestError({ status: 503 })).toBe("unavailable");
    expect(classifyCodeRequestError({ status: 0, name: "AuthRetryableFetchError" })).toBe(
      "unavailable",
    );
    expect(classifyCodeRequestError({ status: 400, name: "AuthRetryableFetchError" })).toBe(
      "unavailable",
    );
    expect(classifyCodeRequestError({ name: "AuthUnknownError" })).toBe("unavailable");
  });
});

describe("classifyCodeVerifyError", () => {
  it("wrong, expired, used and superseded codes are one failure, as is every other 4xx", () => {
    expect(classifyCodeVerifyError({ status: 403, code: "otp_expired" })).toBe("invalid_code");
    expect(classifyCodeVerifyError({ status: 400, code: "validation_failed" })).toBe(
      "invalid_code",
    );
    expect(classifyCodeVerifyError({ status: 422, code: "otp_disabled" })).toBe("invalid_code");
    expect(classifyCodeVerifyError({ status: 404 })).toBe("invalid_code");
  });

  it("reports rate limits separately", () => {
    expect(classifyCodeVerifyError({ status: 429, code: "over_request_rate_limit" })).toBe(
      "rate_limited",
    );
    expect(classifyCodeVerifyError({ status: 400, code: "over_request_rate_limit" })).toBe(
      "rate_limited",
    );
  });

  it("reports outages and network failures as unavailable, not as a wrong code", () => {
    expect(classifyCodeVerifyError({ status: 502 })).toBe("unavailable");
    expect(classifyCodeVerifyError({ status: 0, name: "AuthRetryableFetchError" })).toBe(
      "unavailable",
    );
    expect(classifyCodeVerifyError({})).toBe("unavailable");
  });
});

describe("messages", () => {
  it("has the agreed wording for each outcome (PLAN D70)", () => {
    expect(SIGN_IN_MESSAGES).toEqual({
      invalid_code:
        "That code is wrong or has expired. Check your latest email or send a new code.",
      rate_limited: "Too many attempts. Wait a minute and try again.",
      unavailable: "Sign-in is unavailable right now. Try again in a minute.",
      not_staff: "This email doesn't have access to BICII Admin. Ask an admin to invite you.",
    });
    expect(SIGN_IN_FIELD_MESSAGES).toEqual({
      email: "Enter your email address.",
      code: "Enter the 6-digit code from the email.",
    });
  });
});
