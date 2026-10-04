import { describe, expect, it } from "vitest";

import {
  INTERNAL_BUCKET,
  PUBLIC_BUCKET,
  attachmentPath,
  bucketFor,
  isUndecodedOriginal,
  otherBucket,
  visibilityOptions,
} from "@/lib/attachments";

const BIKE = "b1000000-0000-4000-8000-000000000001";
const ID = "0f0e0d0c-0b0a-4908-8706-050403020100";

describe("photo storage rules", () => {
  it("keeps internal and customer photos private, public ones in the public bucket", () => {
    expect(bucketFor("internal")).toBe(INTERNAL_BUCKET);
    expect(bucketFor("customer")).toBe(INTERNAL_BUCKET);
    expect(bucketFor("public")).toBe(PUBLIC_BUCKET);
    expect(otherBucket(INTERNAL_BUCKET)).toBe(PUBLIC_BUCKET);
    expect(otherBucket(PUBLIC_BUCKET)).toBe(INTERNAL_BUCKET);
  });

  it("builds the only path record_attachment accepts", () => {
    expect(attachmentPath("bike", BIKE, ID, "image/jpeg")).toBe(`bike/${BIKE}/${ID}.jpg`);
    expect(attachmentPath("customer", BIKE, ID, "image/heic")).toBe(`customer/${BIKE}/${ID}.heic`);
  });

  it("offers public for bike photos but never for a customer record (PLAN D13)", () => {
    const bike = visibilityOptions("bike");
    expect(bike.map((o) => o.value)).toEqual(["internal", "customer", "public"]);
    expect(bike.every((o) => o.blocked === null)).toBe(true);

    const customer = visibilityOptions("customer");
    expect(customer.find((o) => o.value === "public")?.blocked).toMatch(/never be public/);
    expect(customer.find((o) => o.value === "customer")?.description).toMatch(/this customer/);
  });

  it("never offers public for an original stored without dimensions (it may carry GPS)", () => {
    expect(isUndecodedOriginal({ width: null, height: null })).toBe(true);
    expect(isUndecodedOriginal({ width: 2048, height: null })).toBe(true);
    expect(isUndecodedOriginal({ width: 2048, height: 1536 })).toBe(false);
    const original = visibilityOptions("bike", { original: true });
    expect(original.find((o) => o.value === "public")?.blocked).toMatch(/original file/);
    expect(original.find((o) => o.value === "customer")?.blocked).toBeNull();
  });
});
