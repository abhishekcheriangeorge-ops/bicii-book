import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { getPublicEnv, getServerEnv } from "@/lib/env";

/**
 * Service-role client: BYPASSES RLS. Importable only from src/lib/admin/**
 * and src/lib/integrations/** (enforced by ESLint no-restricted-imports in
 * eslint.config.mjs) and never from anything a browser can load
 * (`server-only`). Use it for the Auth admin API and integration workers,
 * never for reads a signed-in user could do through RLS.
 */
export function createServiceClient() {
  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicEnv();
  const { SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set; the service-role client is unavailable.",
    );
  }
  return createClient<Database>(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
