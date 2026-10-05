/**
 * Photo rules shared by the camera upload (CaptureButton) and the server.
 * Pure: sizing math and type detection only; the browser work (decode,
 * canvas, encode) is in src/components/domain/prepare-photo.ts.
 */

/** Longest edge after downscaling on the phone. */
export const MAX_PHOTO_EDGE = 2048;
/** JPEG quality of the re-encoded photo. */
export const PHOTO_JPEG_QUALITY = 0.85;
/** The buckets' file_size_limit (20 MiB, media storage migration). */
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

/** What the buckets and record_attachment accept. */
export const PHOTO_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;
export type PhotoMediaType = (typeof PHOTO_MEDIA_TYPES)[number];

export function isPhotoMediaType(value: unknown): value is PhotoMediaType {
  return typeof value === "string" && (PHOTO_MEDIA_TYPES as readonly string[]).includes(value);
}

const EXTENSIONS: Record<PhotoMediaType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

const BY_EXTENSION: Record<string, PhotoMediaType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

/** The file extension stored in the object path (record_attachment checks it matches). */
export function extensionFor(mediaType: PhotoMediaType): string {
  return EXTENSIONS[mediaType];
}

/**
 * The photo type of a picked file, from its MIME type or, when the browser
 * leaves that empty or generic (HEIC on many browsers), from its extension.
 * Null for anything that is not an accepted photo.
 */
export function photoMediaType(name: string, type: string): PhotoMediaType | null {
  const t = type.trim().toLowerCase();
  if (t === "image/jpg" || t === "image/pjpeg") return "image/jpeg";
  if (isPhotoMediaType(t)) return t;
  if (t && t !== "application/octet-stream" && !t.startsWith("image/")) return null;
  const ext = /\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase();
  return (ext && BY_EXTENSION[ext]) || null;
}

export type Size = { width: number; height: number };

/**
 * The size to draw a `width` x `height` image at so its longest edge is at
 * most `maxEdge`, keeping the aspect ratio. Never upscales; never returns
 * less than 1px on either side.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge = MAX_PHOTO_EDGE,
): Size & {
  scaled: boolean;
} {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new RangeError(`Not an image size: ${width}x${height}`);
  }
  const longest = Math.max(width, height);
  if (longest <= maxEdge)
    return { width: Math.round(width), height: Math.round(height), scaled: false };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scaled: true,
  };
}

/** "1.2 MB", "340 KB": approximate sizes for people. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
