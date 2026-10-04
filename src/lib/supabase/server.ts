import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

import type { Database } from "@/lib/database.types";
import { getPublicEnv } from "@/lib/env";

export type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

/**
 * The Supabase client for Server Components, Server Actions and Route
 * Handlers (ADR-001 A5): anon key + the signed-in user's session from the
 * request cookies, so RLS applies to every read. Deduplicated per request.
 *
 * Server Components cannot write cookies; a refreshed session is written
 * back by proxy.ts (which runs first) or by the next Server Action, so the
 * failed write there is safe to ignore.
 */
export const createClient = cache(async () => {
  const env = getPublicEnv();
  const cookieStore = await cookies();
  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component: cookies are read-only there.
          }
        },
      },
    },
  );
});
