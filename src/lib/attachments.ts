import type { Database } from "@/lib/database.types";

import { extensionFor, type PhotoMediaType } from "./images";

/**
 * Photo storage rules (SPEC §8; DATA-MODEL §2 "Attachment storage", PLAN
 * D13). Pure, so the photo viewer, the upload path and tests share one
 * statement of them; the database enforces every one again.
 */

export type AttachmentEntity = Database["public"]["Enums"]["attachment_entity"];
export type Visibility = Database["public"]["Enums"]["attachment_visibility"];

/**
 * Entity types that can hold photos so far (private.attachment_entity_exists):
 * bikes and customers (Phase 1), jobs (Phase 3), products and unique units
 * (Phase 4).
 */
export const PHOTO_ENTITIES = [
  "bike",
  "customer",
  "work_order",
  "product",
  "inventory_unit",
] as const;
export type PhotoEntity = (typeof PHOTO_ENTITIES)[number];

export function isPhotoEntity(value: unknown): value is PhotoEntity {
  return typeof value === "string" && (PHOTO_ENTITIES as readonly string[]).includes(value);
}

/** The record a photo belongs to. */
export type PhotoTarget = { entityType: PhotoEntity; entityId: string };

export const INTERNAL_BUCKET = "media-internal";
export const PUBLIC_BUCKET = "media-public";
export type PhotoBucket = typeof INTERNAL_BUCKET | typeof PUBLIC_BUCKET;

/** Public photos live in the public bucket; internal and customer ones in the private one. */
export function bucketFor(visibility: Visibility): PhotoBucket {
  return visibility === "public" ? PUBLIC_BUCKET : INTERNAL_BUCKET;
}

/** The other bucket, where a stale copy could be left after a move. */
export function otherBucket(bucket: PhotoBucket): PhotoBucket {
  return bucket === PUBLIC_BUCKET ? INTERNAL_BUCKET : PUBLIC_BUCKET;
}

/** `{entity_type}/{entity_id}/{attachment_id}.{ext}`, the only path record_attachment accepts. */
export function attachmentPath(
  entityType: AttachmentEntity,
  entityId: string,
  attachmentId: string,
  mediaType: PhotoMediaType,
): string {
  return `${entityType}/${entityId}/${attachmentId}.${extensionFor(mediaType)}`;
}

/**
 * How long a signed URL for an internal photo lasts. Short on purpose: a
 * copied link stops working within minutes. Pages mint fresh ones on every
 * render, and a thumbnail whose link expired asks for a refresh.
 */
export const SIGNED_URL_TTL_SECONDS = 300;

export type VisibilityOption = {
  value: Visibility;
  label: string;
  /** Who sees a photo at this level, in a sentence. */
  description: string;
  /** Why it cannot be chosen here, or null. */
  blocked: string | null;
};

/**
 * Whether a photo is an original stored as it was uploaded (the device
 * could not decode it, so it was not re-encoded): recorded without its
 * dimensions, and possibly still carrying EXIF metadata, GPS included.
 */
export function isUndecodedOriginal(photo: { width: number | null; height: number | null }) {
  return photo.width === null || photo.height === null;
}

/** Stock (a product or a unit) has no customer: its photos are internal or public (D13, like D19). */
export function isStockEntity(entityType: AttachmentEntity): boolean {
  return entityType === "product" || entityType === "inventory_unit";
}

export const STOCK_NEVER_CUSTOMER = "Stock photos have no customer.";

export const ORIGINAL_NEVER_PUBLIC =
  "This photo was stored as its original file, which may carry where it was taken, so it can't be public. Add it again as a JPEG to share it publicly.";

/**
 * The visibility levels for a photo on `entityType`, with who sees each.
 * PLAN D13: a photo on a customer record is never public; D19: nor is a
 * photo on a job; nor is an undecoded original (`original`), which may
 * carry its GPS position. Stock (products and units) has no customer, so
 * its photos are offered Internal and Public only (the database's
 * attachment_stock_never_customer, D13 extended); a public stock photo
 * shows on the item's QR page once it is published (D26).
 */
export function visibilityOptions(
  entityType: AttachmentEntity,
  { original = false }: { original?: boolean } = {},
): VisibilityOption[] {
  const internal: VisibilityOption = {
    value: "internal",
    label: "Internal",
    description: "Staff only.",
    blocked: null,
  };
  if (isStockEntity(entityType)) {
    return [
      internal,
      {
        value: "public",
        label: "Public",
        description: "Public photos appear on the QR page once the item is published.",
        blocked: original ? ORIGINAL_NEVER_PUBLIC : null,
      },
    ];
  }
  const owner =
    entityType === "customer"
      ? "this customer"
      : entityType === "work_order"
        ? "the job's customer"
        : "the bike's current owner";
  return [
    internal,
    {
      value: "customer",
      label: "Customer",
      description: `Staff, and ${owner} on the BICII website once customer accounts launch.`,
      blocked: null,
    },
    {
      value: "public",
      label: "Public",
      description: "Anyone with the link, e.g. a listing for a bike for sale.",
      blocked:
        entityType === "customer"
          ? "Photos on a customer record can never be public."
          : entityType === "work_order"
            ? "Photos on a job can never be public."
            : original
              ? ORIGINAL_NEVER_PUBLIC
              : null,
    },
  ];
}

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  internal: "Internal",
  customer: "Customer",
  public: "Public",
};
