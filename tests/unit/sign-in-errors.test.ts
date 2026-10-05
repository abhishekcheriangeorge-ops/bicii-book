import { describe, expect, it } from "vitest";

import { SIGN_IN_MESSAGES, classifySignInError } from "@/lib/auth/sign-in-errors";

describe("classifySignInError", () => {
  it("wrong email and wrong password look the same, as do other 4xx answers", () => {
    expect(classifySignInError({ status: 400, code: "invalid_credentials" })).toBe("credentials");
    expect(classifySignInError({ status: 400, code: "email_not_confirmed" })).toBe("credentials");
    expect(classifySignInError({ status: 422, code: "validation_failed" })).toBe("credentials");
  });

  it("reports rate limits separately", () => {
    expect(classifySignInError({ status: 429, code: "over_request_rate_limit" })).toBe(
      "rate_limited",
    );
    expect(classifySignInError({ status: 400, code: "over_request_rate_limit" })).toBe(
      "rate_limited",
    );
  });

  it("reports outages and network failures as unavailable, not as a wrong password", () => {
    expect(classifySignInError({ status: 500, code: "unexpected_failure" })).toBe("unavailable");
    expect(classifySignInError({ status: 503 })).toBe("unavailable");
    expect(classifySignInError({ status: 0, name: "AuthRetryableFetchError" })).toBe("unavailable");
    expect(classifySignInError({ name: "AuthUnknownError" })).toBe("unavailable");
  });

  it("has a message for each outcome", () => {
    expect(SIGN_IN_MESSAGES.credentials).toMatch(/don't match/);
    expect(SIGN_IN_MESSAGES.unavailable).toMatch(/unavailable/);
    expect(SIGN_IN_MESSAGES.rate_limited).toMatch(/Too many attempts/);
  });
});
