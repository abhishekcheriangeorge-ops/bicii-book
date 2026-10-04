import { describe, expect, it } from "vitest";

import { customerLabel, mailtoHref, telHref } from "@/lib/people";

describe("customerLabel (mirrors private.customer_label)", () => {
  it("prefers the display name, then first + last", () => {
    expect(
      customerLabel({ displayName: "Tan Wei Ming", firstName: "Wei Ming", lastName: "Tan" }),
    ).toBe("Tan Wei Ming");
    expect(customerLabel({ firstName: "Priya", lastName: "Ramasamy" })).toBe("Priya Ramasamy");
  });

  it("falls back to either name, then email, then phone", () => {
    expect(customerLabel({ firstName: "Priya" })).toBe("Priya");
    expect(customerLabel({ lastName: "Ong", email: "d@example.com" })).toBe("Ong");
    expect(customerLabel({ email: "d@example.com", phone: "+65 9000 0000" })).toBe("d@example.com");
    expect(customerLabel({ phone: "+65 9000 0000" })).toBe("+65 9000 0000");
    expect(customerLabel({})).toBe("Customer");
  });

  it("treats blank values as missing", () => {
    expect(customerLabel({ displayName: "  ", firstName: " Chloe ", lastName: "" })).toBe("Chloe");
  });
});

describe("telHref", () => {
  it("keeps a leading + and the digits", () => {
    expect(telHref("+65 9123 4567")).toBe("tel:+6591234567");
    expect(telHref("(65) 9123-4567")).toBe("tel:6591234567");
  });

  it("is null when there is nothing to dial", () => {
    expect(telHref("ask at desk")).toBeNull();
    expect(telHref("12")).toBeNull();
    expect(telHref(null)).toBeNull();
  });
});

describe("mailtoHref", () => {
  it("links an address and nothing else", () => {
    expect(mailtoHref(" chloe.lim@example.com ")).toBe("mailto:chloe.lim@example.com");
    expect(mailtoHref("not an email")).toBeNull();
    expect(mailtoHref(undefined)).toBeNull();
  });
});
