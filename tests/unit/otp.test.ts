import { describe, expect, it } from "vitest";

import {
  OTP_EXPIRY_MINUTES,
  OTP_LENGTH,
  RESEND_COOLDOWN_SECONDS,
  formatCountdown,
  normaliseCode,
  resendSecondsLeft,
} from "@/lib/auth/otp";

describe("code settings", () => {
  it("match Auth's: 6 digits, 10 minutes, a new code after 60 s (PLAN D70)", () => {
    expect(OTP_LENGTH).toBe(6);
    expect(OTP_EXPIRY_MINUTES).toBe(10);
    expect(RESEND_COOLDOWN_SECONDS).toBe(60);
  });
});

describe("normaliseCode", () => {
  it("accepts six digits as typed", () => {
    expect(normaliseCode("042917")).toBe("042917");
  });

  it("drops spaces and hyphens from a pasted code", () => {
    expect(normaliseCode(" 123 456 ")).toBe("123456");
    expect(normaliseCode("123-456")).toBe("123456");
    expect(normaliseCode("12 34 56")).toBe("123456");
    expect(normaliseCode("123\u00a0456")).toBe("123456");
    expect(normaliseCode("123\u2013456")).toBe("123456");
    expect(normaliseCode("123\t456\n")).toBe("123456");
  });

  it("refuses anything that is not exactly six digits", () => {
    expect(normaliseCode("")).toBeNull();
    expect(normaliseCode("12345")).toBeNull();
    expect(normaliseCode("1234567")).toBeNull();
    expect(normaliseCode("12345a")).toBeNull();
    expect(normaliseCode("123.456")).toBeNull();
    expect(normaliseCode("\u0661\u0662\u0663\u0664\u0665\u0666")).toBeNull();
    expect(normaliseCode(null)).toBeNull();
    expect(normaliseCode(123456)).toBeNull();
  });
});

describe("resendSecondsLeft", () => {
  const sent = 1_000_000;

  it("counts down from the cooldown and opens at 0", () => {
    expect(resendSecondsLeft(sent, sent)).toBe(60);
    expect(resendSecondsLeft(sent, sent + 1)).toBe(60);
    expect(resendSecondsLeft(sent, sent + 1000)).toBe(59);
    expect(resendSecondsLeft(sent, sent + 59_001)).toBe(1);
    expect(resendSecondsLeft(sent, sent + 60_000)).toBe(0);
    expect(resendSecondsLeft(sent, sent + 3_600_000)).toBe(0);
  });

  it("never waits longer than the cooldown when the clock is behind", () => {
    expect(resendSecondsLeft(sent, sent - 120_000)).toBe(60);
  });

  it("opens when a time is missing", () => {
    expect(resendSecondsLeft(Number.NaN, sent)).toBe(0);
    expect(resendSecondsLeft(sent, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("formatCountdown", () => {
  it("reads as minutes and seconds", () => {
    expect(formatCountdown(60)).toBe("1:00");
    expect(formatCountdown(59)).toBe("0:59");
    expect(formatCountdown(5)).toBe("0:05");
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-3)).toBe("0:00");
  });
});
