import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Set up per node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md,
// except that the guide's vite-tsconfig-paths plugin is replaced by Vite 8's
// native `resolve.tsconfigPaths` (the plugin now logs a deprecation notice).
// Projects keep the harnesses apart: `unit` is pure TypeScript and
// synchronous components under jsdom; the `db` project (Vitest over `pg`
// against Postgres) is added alongside it. `npm test` runs every project.
// Async Server Components are not unit-testable here; Playwright covers them.
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["tests/unit/**/*.test.{ts,tsx}"],
          setupFiles: ["tests/unit/setup.ts"],
          // Dates and currency format against the shop's locale, not the
          // machine's, so results are identical on a laptop and in CI.
          env: { TZ: "UTC" },
        },
      },
    ],
  },
});
