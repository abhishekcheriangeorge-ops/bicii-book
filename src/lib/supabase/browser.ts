"use client";

import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/database.types";
import { getPublicEnv } from "@/lib/env";

let client: ReturnType<typeof createBrowserClient<Database>> | undefined;

/**
 * Browser client (anon key, cookie session shared with the server). Only
 * for Storage uploads from the camera and realtime subscriptions
 * (ADR-001 A5). Business reads and every write go through Server Actions.
 */
export function getBrowserClient() {
  const env = getPublicEnv();
  client ??= createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  return client;
}
