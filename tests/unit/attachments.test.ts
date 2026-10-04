import { describe, expect, it } from "vitest";

import {
  INTERNAL_BUCKET,
  PHOTO_ENTITIES,
  PUBLIC_BUCKET,
  attachmentPath,
  bucketFor,
  isPhotoEntity,
  isUndecodedOriginal,
  otherBucket,
  isStockEntity,
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

  it("offers internal and customer for a job photo, never public (PLAN D19)", () => {
    const job = visibilityOptions("work_order");
    expect(job.find((o) => o.value === "customer")?.description).toBe(
      "Staff, and the job's customer on the BICII website once customer accounts launch.",
    );
    expect(job.find((o) => o.value === "customer")?.blocked).toBeNull();
    expect(job.find((o) => o.value === "public")?.blocked).toBe(
      "Photos on a job can never be public.",
    );
    expect(attachmentPath("work_order", BIKE, ID, "image/jpeg")).toBe(
      `work_order/${BIKE}/${ID}.jpg`,
    );
  });

  it("offers internal and public for stock, never customer (D13 extended, like D19)", () => {
    for (const entity of ["product", "inventory_unit"] as const) {
      const stock = visibilityOptions(entity);
      expect(stock.map((o) => o.value)).toEqual(["internal", "public"]);
      expect(stock.every((o) => o.blocked === null)).toBe(true);
      expect(stock.find((o) => o.value === "public")?.description).toBe(
        "Public photos appear on the QR page once the item is published.",
      );
      expect(stock.map((o) => o.description).join(" ")).not.toMatch(/owner/);
      expect(
        visibilityOptions(entity, { original: true }).find((o) => o.value === "public")?.blocked,
      ).toMatch(/original file/);
    }
    expect(isStockEntity("product")).toBe(true);
    expect(isStockEntity("bike")).toBe(false);
  });

  it("knows which records hold photos", () => {
    expect(PHOTO_ENTITIES).toEqual(["bike", "customer", "work_order", "product", "inventory_unit"]);
    expect(isPhotoEntity("work_order")).toBe(true);
    expect(isPhotoEntity("product")).toBe(true);
    expect(isPhotoEntity("inventory_unit")).toBe(true);
    expect(isPhotoEntity("consignment_item")).toBe(false);
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
