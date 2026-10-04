import { describe, expect, it } from "vitest";

import {
  MAX_PHOTO_EDGE,
  extensionFor,
  fitWithin,
  formatBytes,
  isPhotoMediaType,
  photoMediaType,
} from "@/lib/images";

describe("fitWithin (downscale sizing for uploads)", () => {
  it("scales the longest edge down to 2048 and keeps the aspect ratio", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2048, height: 1536, scaled: true });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1536, height: 2048, scaled: true });
    expect(fitWithin(8000, 1000)).toEqual({ width: 2048, height: 256, scaled: true });
  });

  it("never upscales a photo that already fits", () => {
    expect(fitWithin(640, 480)).toEqual({ width: 640, height: 480, scaled: false });
    expect(fitWithin(MAX_PHOTO_EDGE, MAX_PHOTO_EDGE)).toEqual({
      width: 2048,
      height: 2048,
      scaled: false,
    });
  });

  it("rounds to whole pixels and never collapses a side to zero", () => {
    expect(fitWithin(4000, 3)).toEqual({ width: 2048, height: 2, scaled: true });
    expect(fitWithin(100_000, 1)).toEqual({ width: 2048, height: 1, scaled: true });
    expect(fitWithin(4001, 3001, 1000)).toEqual({ width: 1000, height: 750, scaled: true });
  });

  it("rejects sizes that are not an image", () => {
    expect(() => fitWithin(0, 100)).toThrow(RangeError);
    expect(() => fitWithin(100, -1)).toThrow(RangeError);
    expect(() => fitWithin(Number.NaN, 100)).toThrow(RangeError);
    expect(() => fitWithin(Number.POSITIVE_INFINITY, 100)).toThrow(RangeError);
  });
});

describe("photoMediaType", () => {
  it("accepts the photo types the buckets accept, by MIME type", () => {
    expect(photoMediaType("a.jpg", "image/jpeg")).toBe("image/jpeg");
    expect(photoMediaType("a", "image/png")).toBe("image/png");
    expect(photoMediaType("a", "image/webp")).toBe("image/webp");
    expect(photoMediaType("a", "IMAGE/HEIC")).toBe("image/heic");
    expect(photoMediaType("a", "image/heif")).toBe("image/heif");
    expect(photoMediaType("a", "image/jpg")).toBe("image/jpeg");
  });

  it("falls back to the extension when the browser gives no useful type (HEIC)", () => {
    expect(photoMediaType("IMG_0001.HEIC", "")).toBe("image/heic");
    expect(photoMediaType("photo.heif", "application/octet-stream")).toBe("image/heif");
    expect(photoMediaType("photo.JPEG", "")).toBe("image/jpeg");
  });

  it("refuses anything else", () => {
    expect(photoMediaType("doc.pdf", "application/pdf")).toBeNull();
    expect(photoMediaType("anim.gif", "image/gif")).toBeNull();
    expect(photoMediaType("x.jpg", "text/plain")).toBeNull();
    expect(photoMediaType("noext", "")).toBeNull();
    expect(isPhotoMediaType("image/gif")).toBe(false);
  });

  it("maps each type to the extension record_attachment expects", () => {
    expect(extensionFor("image/jpeg")).toBe("jpg");
    expect(extensionFor("image/png")).toBe("png");
    expect(extensionFor("image/webp")).toBe("webp");
    expect(extensionFor("image/heic")).toBe("heic");
    expect(extensionFor("image/heif")).toBe("heif");
  });
});

describe("formatBytes", () => {
  it("rounds to what people read", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(25_483)).toBe("25 KB");
    expect(formatBytes(1_572_864)).toBe("1.5 MB");
    expect(formatBytes(-1)).toBe("");
  });
});
