import {
  MAX_PHOTO_BYTES,
  MAX_PHOTO_EDGE,
  PHOTO_JPEG_QUALITY,
  fitWithin,
  photoMediaType,
  type PhotoMediaType,
} from "@/lib/images";

/**
 * Turns a picked or captured file into what is uploaded: decoded with its
 * EXIF orientation applied, scaled so the longest edge is at most 2048px,
 * and re-encoded as JPEG (quality 0.85). Re-encoding also drops the
 * camera's metadata, GPS position included.
 *
 * If the browser cannot decode the file (HEIC outside Safari, say), the
 * original is uploaded as it is, provided it is a photo type Storage
 * accepts, labelled with the type its name says when the browser gave it
 * none (Storage checks the uploaded part's type against the bucket). Such
 * an original keeps its metadata, GPS position included, so it is recorded
 * without dimensions and can never be made public (attachments migration:
 * `attachment_original_never_public`). Browser-only (canvas,
 * createImageBitmap).
 */

export type PreparedPhoto = {
  blob: Blob;
  mediaType: PhotoMediaType;
  /** Null when the original was uploaded undecoded. */
  width: number | null;
  height: number | null;
};

/** Shown to staff as is. */
export class PhotoRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoRejected";
  }
}

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

async function decodeWithBitmap(file: Blob): Promise<Decoded | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  } catch {
    return null;
  }
}

/** Fallback for browsers whose createImageBitmap rejects the options or the file. */
async function decodeWithImage(file: Blob): Promise<Decoded | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight) {
      URL.revokeObjectURL(url);
      return null;
    }
    // <img> applies EXIF orientation by default (image-orientation: from-image).
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

function encodeJpeg(decoded: Decoded, width: number, height: number): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  // JPEG has no alpha: paint white under transparent PNGs instead of black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(decoded.source, 0, 0, width, height);
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        // Release the canvas memory at once (iOS caps total canvas memory).
        canvas.width = 0;
        canvas.height = 0;
        resolve(blob);
      },
      "image/jpeg",
      PHOTO_JPEG_QUALITY,
    );
  });
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const decoded = (await decodeWithBitmap(file)) ?? (await decodeWithImage(file));
  if (decoded) {
    try {
      const size = fitWithin(decoded.width, decoded.height, MAX_PHOTO_EDGE);
      const blob = await encodeJpeg(decoded, size.width, size.height);
      if (blob && blob.size > 0) {
        return { blob, mediaType: "image/jpeg", width: size.width, height: size.height };
      }
    } finally {
      decoded.release();
    }
  }

  const original = photoMediaType(file.name, file.type);
  if (!original) {
    throw new PhotoRejected(`${file.name || "That file"} is not a photo this app can store.`);
  }
  if (file.size > MAX_PHOTO_BYTES) {
    throw new PhotoRejected(`${file.name || "That photo"} is over 20 MB.`);
  }
  // Undecodable here but a photo type Storage accepts: keep the original.
  // storage-js sends a Blob as a multipart part with the Blob's own type
  // (it ignores `contentType` for Blobs), and a type-less IMG_0001.HEIC
  // would go up as application/octet-stream, which the buckets refuse.
  const blob = file.type === original ? file : new Blob([file], { type: original });
  return { blob, mediaType: original, width: null, height: null };
}
