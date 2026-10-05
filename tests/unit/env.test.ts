import { describe, expect, it } from "vitest";
import { EnvError, parsePublicEnv, parseServerEnv } from "@/lib/env";

const validPublic = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  NEXT_PUBLIC_PUBLIC_SITE_URL: "https://bicii.vercel.app/",
};

describe("env", () => {
  it("parses a valid public env and trims the site URL's trailing slash", () => {
    expect(parsePublicEnv(validPublic).NEXT_PUBLIC_PUBLIC_SITE_URL).toBe(
      "https://bicii.vercel.app",
    );
  });

  it("names every missing or invalid variable and points at .env.example", () => {
    let error: unknown;
    try {
      parsePublicEnv({
        ...validPublic,
        NEXT_PUBLIC_SUPABASE_URL: "not a url",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(EnvError);
    const message = (error as Error).message;
    expect(message).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(message).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(message).toContain(".env.example");
  });

  it("applies server defaults and validates the database URL", () => {
    expect(parseServerEnv({}).LOG_LEVEL).toBe("info");
    expect(parseServerEnv({ DATABASE_URL: "postgres://u:p@127.0.0.1:5432/db" }).DATABASE_URL).toBe(
      "postgres://u:p@127.0.0.1:5432/db",
    );
    expect(() => parseServerEnv({ DATABASE_URL: "mysql://x" })).toThrow(/DATABASE_URL/);
    expect(() => parseServerEnv({ LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
  });

  it("the sign-in limit multiplier defaults to 1 and takes whole numbers from 1 (PLAN D72)", () => {
    expect(parseServerEnv({}).SIGN_IN_LIMIT_MULTIPLIER).toBe(1);
    expect(parseServerEnv({ SIGN_IN_LIMIT_MULTIPLIER: "" }).SIGN_IN_LIMIT_MULTIPLIER).toBe(1);
    expect(parseServerEnv({ SIGN_IN_LIMIT_MULTIPLIER: "1000" }).SIGN_IN_LIMIT_MULTIPLIER).toBe(
      1000,
    );
    for (const bad of ["0", "-1", "1.5", "lots", "100001"]) {
      expect(() => parseServerEnv({ SIGN_IN_LIMIT_MULTIPLIER: bad })).toThrow(
        /SIGN_IN_LIMIT_MULTIPLIER/,
      );
    }
  });
});
