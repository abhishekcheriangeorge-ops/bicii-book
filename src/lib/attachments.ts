import type { Database } from "@/lib/database.types";

import { extensionFor, type PhotoMediaType } from "./images";

/**
 * Photo storage rules (SPEC §8; DATA-MODEL §2 "Attachment storage", PLAN
 * D13). Pure, so the photo viewer, the upload path and tests share one
 * statement of them; the database enforces every one again.
 */

export type AttachmentEntity = Database["public"]["Enums"]["attachment_entity"];
export type Visibility = Database["public"]["Enums"]["attachment_visibility"];

/** Entity types that can hold photos in Phase 1 (private.attachment_entity_exists). */
export const PHOTO_ENTITIES = ["bike", "customer"] as const;
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
 * The visibility levels for a photo on `entityType`, with who sees each.
 * PLAN D13: a photo on a customer record is never public.
 */
export function visibilityOptions(entityType: AttachmentEntity): VisibilityOption[] {
  const owner = entityType === "customer" ? "this customer" : "the bike's current owner";
  return [
    {
      value: "internal",
      label: "Internal",
      description: "Staff only.",
      blocked: null,
    },
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
        entityType === "customer" ? "Photos on a customer record can never be public." : null,
    },
  ];
}

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  internal: "Internal",
  customer: "Customer",
  public: "Public",
};
