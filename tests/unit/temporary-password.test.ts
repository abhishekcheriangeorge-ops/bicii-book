import { describe, expect, it } from "vitest";

import { temporaryPassword } from "@/lib/admin/temporary-password";

describe("temporaryPassword", () => {
  it("is 20 characters in hyphenated groups of five", () => {
    expect(temporaryPassword()).toMatch(/^[A-Za-z2-9]{5}(-[A-Za-z2-9]{5}){3}$/);
  });

  it("always has an upper-case letter, a lower-case letter, a digit and a symbol", () => {
    // Without the guarantee about 4% of passwords had no digit and failed a
    // project that requires digits.
    for (let i = 0; i < 2000; i++) {
      const pw = temporaryPassword();
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[2-9]/);
      expect(pw).toMatch(/-/);
    }
  });

  it("never uses look-alike characters", () => {
    for (let i = 0; i < 200; i++) expect(temporaryPassword()).not.toMatch(/[01OIl]/);
  });
});
