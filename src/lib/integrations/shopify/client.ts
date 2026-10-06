import "server-only";

import { getServerEnv } from "@/lib/env";

import type { ShopifyAdmin } from "./admin";
import { SHOPIFY_API_VERSION } from "./config";
import { createFakeShopifyAdmin, type FakeShopifyAdmin } from "./fake-admin";
import { createGraphqlShopifyAdmin } from "./graphql-admin";

/**
 * Which Shopify the app talks to (env.ts; RUNBOOK "Shopify"):
 *   SHOPIFY_ADAPTER=fake               -> the in-memory fake, one per server
 *                                         process (local development, E2E;
 *                                         env.ts refuses it in production)
 *   SHOPIFY_SHOP_DOMAIN + ADMIN_TOKEN  -> the live GraphQL adapter
 *   otherwise                          -> null: Shopify is off, syncs fail
 *                                         retriably with shopify_not_configured
 */

const FAKE_KEY = Symbol.for("bicii.shopify.fake-admin");
type GlobalWithFake = typeof globalThis & { [FAKE_KEY]?: FakeShopifyAdmin };

/** The process-wide fake (survives module reloads in development). */
export function processFakeShopifyAdmin(): FakeShopifyAdmin {
  const g = globalThis as GlobalWithFake;
  g[FAKE_KEY] ??= createFakeShopifyAdmin();
  return g[FAKE_KEY];
}

let live: { key: string; admin: ShopifyAdmin } | undefined;

export function getShopifyAdmin(): ShopifyAdmin | null {
  const env = getServerEnv();
  if (env.SHOPIFY_ADAPTER === "fake") return processFakeShopifyAdmin();
  if (env.SHOPIFY_SHOP_DOMAIN && env.SHOPIFY_ADMIN_TOKEN) {
    const key = `${env.SHOPIFY_SHOP_DOMAIN}|${env.SHOPIFY_ADMIN_TOKEN}`;
    if (live?.key !== key) {
      live = {
        key,
        admin: createGraphqlShopifyAdmin({
          shopDomain: env.SHOPIFY_SHOP_DOMAIN,
          accessToken: env.SHOPIFY_ADMIN_TOKEN,
        }),
      };
    }
    return live.admin;
  }
  return null;
}

export type ShopifyConnection = {
  mode: "live" | "fake" | "off";
  shopDomain: string | null;
  apiVersion: string;
};

/** What the settings screen shows (never the token or the secret). */
export function shopifyConnection(): ShopifyConnection {
  const env = getServerEnv();
  const admin = getShopifyAdmin();
  return {
    mode: admin ? admin.mode : "off",
    shopDomain: env.SHOPIFY_SHOP_DOMAIN ?? null,
    apiVersion: SHOPIFY_API_VERSION,
  };
}
