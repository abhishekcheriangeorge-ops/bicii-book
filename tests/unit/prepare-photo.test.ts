import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PhotoRejected, preparePhoto } from "@/components/domain/prepare-photo";

/**
 * jsdom decodes no images, so these exercise the path for a file the
 * browser cannot decode (HEIC outside Safari): the original goes up as it
 * is, without dimensions, and typed so Storage accepts it.
 */
describe("preparePhoto, for a file the browser cannot decode", () => {
  const { createObjectURL, revokeObjectURL } = URL;
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  });

  it("labels a type-less HEIC with the type its name says, so Storage does not see octet-stream", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "IMG_0001.HEIC", { type: "" });
    const prepared = await preparePhoto(file);
    expect(prepared).toMatchObject({ mediaType: "image/heic", width: null, height: null });
    expect(prepared.blob.type).toBe("image/heic");
    expect(prepared.blob.size).toBe(3);
  });

  it("keeps a correctly typed original as it is", async () => {
    const file = new File([new Uint8Array([1])], "photo.heic", { type: "image/heic" });
    expect((await preparePhoto(file)).blob).toBe(file);
  });

  it("refuses what is not a photo", async () => {
    const file = new File(["%PDF"], "invoice.pdf", { type: "application/pdf" });
    await expect(preparePhoto(file)).rejects.toBeInstanceOf(PhotoRejected);
  });
});
