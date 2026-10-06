import "server-only";

import type { Logger } from "pino";

import { getPublicEnv } from "@/lib/env";
import { child } from "@/lib/logger";
import { createServiceClient } from "@/lib/supabase/service";

import type { ShopifyAdmin } from "./admin";
import { getShopifyAdmin } from "./client";

/**
 * What every integration runner needs, passed in (never imported), so the
 * unit tests stub the RPCs and the stack test uses its own fake Shopify:
 * the service-role client (the only way the runners reach the database:
 * the service-role RPCs of DATA-MODEL §16), the Shopify adapter (null when
 * Shopify is not configured), a logger bound to the correlation id, and
 * the public Storage base the product photos are served from.
 */
export type ServiceSupabase = ReturnType<typeof createServiceClient>;

export type IntegrationDeps = {
  supabase: ServiceSupabase;
  admin: ShopifyAdmin | null;
  log: Logger;
  publicStorageBase: string;
};

export function publicStorageBase(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/media-public`;
}

export function defaultDeps(correlationId: string): IntegrationDeps {
  return {
    supabase: createServiceClient({ correlationId }),
    admin: getShopifyAdmin(),
    log: child(correlationId, { integration: "shopify" }),
    publicStorageBase: publicStorageBase(getPublicEnv().NEXT_PUBLIC_SUPABASE_URL),
  };
}
