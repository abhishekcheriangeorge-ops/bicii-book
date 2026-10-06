import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// PLAN D9, ADR-017: displayed and printed QR URLs come from
// shop_settings.public_site_url only. The environment's public site URL is
// read in src/lib/env.ts and used only by src/lib/qr.ts (scanBases, an
// extra accepted scan base). Any other reference could build a QR URL from
// it, so it fails here.
const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");
const ALLOWED = new Set(["src/lib/env.ts", "src/lib/qr.ts"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Strips // and /* *\/ comments (good enough for this codebase's sources). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

describe("NEXT_PUBLIC_PUBLIC_SITE_URL is read only where allowed", () => {
  it("appears in code only in src/lib/env.ts and src/lib/qr.ts", () => {
    const offenders = files(SRC)
      .map((path) => relative(ROOT, path).replaceAll("\\", "/"))
      .filter((rel) => !rel.endsWith("database.types.ts"))
      .filter((rel) =>
        stripComments(readFileSync(join(ROOT, rel), "utf8")).includes(
          "NEXT_PUBLIC_PUBLIC_SITE_URL",
        ),
      )
      .filter((rel) => !ALLOWED.has(rel));
    expect(offenders).toEqual([]);
  });

  it("is still referenced by both allowed files (the check is live)", () => {
    for (const rel of ALLOWED) {
      expect(stripComments(readFileSync(join(ROOT, rel), "utf8"))).toContain(
        "NEXT_PUBLIC_PUBLIC_SITE_URL",
      );
    }
  });
});
