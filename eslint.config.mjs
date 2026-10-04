import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The service-role Supabase client bypasses RLS (ADR-001 A5). Only the
  // Auth-admin wrappers and integration workers may import it.
  {
    files: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs}"],
    ignores: ["src/lib/admin/**", "src/lib/integrations/**", "src/lib/supabase/service.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/supabase/service", "**/supabase/service", "**/supabase/service.ts"],
              message:
                "The service-role client bypasses RLS. Import it only in src/lib/admin/** or src/lib/integrations/**.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated test output
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
