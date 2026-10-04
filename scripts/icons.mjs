#!/usr/bin/env node
// Generates the PWA icons from the brand mark (the public site's
// brand/logo-source.png, copied to brand/logo-source.png here). Outputs are
// committed; rerun after a brand change:
//
//   npm run icons
//
// "any" icons keep the wordmark large; "maskable" ones keep it inside the
// 80% safe-zone circle (W3C maskable icons), since launchers crop them.

import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "brand", "logo-source.png");
const PUBLIC = path.join(ROOT, "public");
const PAPER = "#fbfaf7";

/**
 * The source PNG is opaque with a white field. Trim the field, then
 * multiply by paper so white becomes exactly paper (#fbfaf7) and the
 * accents shift by under 2%.
 */
async function mark(width) {
  const trimmed = await sharp(SOURCE)
    .trim({ background: "#ffffff", threshold: 12 })
    .resize({ width, fit: "inside" })
    .removeAlpha()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = trimmed.info;
  return sharp(trimmed.data)
    .composite([
      {
        input: { create: { width: w, height: h, channels: 3, background: PAPER } },
        blend: "multiply",
      },
    ])
    .png()
    .toBuffer();
}

/** Wordmark centred on paper, `scale` = wordmark width / canvas width. */
async function icon(size, scale, file) {
  const width = Math.round(size * scale);
  const logo = await mark(width);
  const out = path.join(PUBLIC, file);
  mkdirSync(path.dirname(out), { recursive: true });
  await sharp({ create: { width: size, height: size, channels: 4, background: PAPER } })
    .composite([{ input: logo, gravity: "centre" }])
    .flatten({ background: PAPER })
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`wrote public/${file}`);
}

// The wordmark is ~2.12:1; its diagonal must fit the 80% circle for
// maskable, so its width can be at most ~72% of the canvas. 66% leaves air.
await icon(192, 0.84, "icons/icon-192.png");
await icon(512, 0.84, "icons/icon-512.png");
await icon(192, 0.66, "icons/maskable-192.png");
await icon(512, 0.66, "icons/maskable-512.png");
// iOS rounds the corners itself and ignores transparency.
await icon(180, 0.76, "apple-touch-icon.png");
