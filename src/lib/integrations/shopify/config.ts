/**
 * Shopify integration constants (Phase 10; SPEC §17, §26; PLAN D84, D87,
 * D88; ADR-020). Pure: imported by the adapters, the webhook handler and
 * the unit tests.
 */

/**
 * The Admin API version every call is pinned to. The upgrade procedure is
 * in docs/RUNBOOK.md ("Shopify", API version upgrade); the version is
 * stored on each sync row (shopify_product_sync.api_version) and is part
 * of the desired-state hash, so an upgrade re-pushes every product once
 * (D84). Each webhook event stores the version Shopify sent
 * (X-Shopify-Api-Version).
 */
export const SHOPIFY_API_VERSION = "2026-10";

/** The webhook topics BICII subscribes to and processes (D85: no orders/cancelled). */
export const HANDLED_TOPICS = ["orders/paid", "refunds/create"] as const;

/** D88: a body above 1 MiB gets 413 and is not stored. */
export const MAX_WEBHOOK_BYTES = 1_048_576;

/** D88: above this many rejected deliveries per minute per server instance, they are logged, not stored. */
export const MAX_REJECTED_PER_MINUTE = 30;

/**
 * D88: the request headers kept on an event (lower-cased). The database
 * caps them again (16 keys, 512 characters each).
 */
export const WEBHOOK_HEADER_ALLOWLIST = [
  "x-shopify-topic",
  "x-shopify-hmac-sha256",
  "x-shopify-shop-domain",
  "x-shopify-webhook-id",
  "x-shopify-event-id",
  "x-shopify-api-version",
  "x-shopify-triggered-at",
  "x-shopify-test",
  "content-type",
  "content-length",
  "user-agent",
] as const;

/** A Shopify call that has not answered by then is abandoned (retriable). */
export const SHOPIFY_TIMEOUT_MS = 15_000;
