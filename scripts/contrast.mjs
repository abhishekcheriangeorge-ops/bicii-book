#!/usr/bin/env node
// WCAG 2.x contrast ratios for the token pairs documented in
// src/app/globals.css. Run `node scripts/contrast.mjs` after changing a colour
// and update the ratios recorded in the comments. Exits non-zero if any pair
// that is used for text falls under 4.5:1 (or a UI pair under 3:1).

const hex = {
  ink: "#050707",
  paper: "#fbfaf7",
  card: "#ffffff",
  "dust-100": "#f2f0ea",
  "dust-200": "#e4e1d8",
  "dust-300": "#cbc7ba",
  "dust-500": "#716d61",
  "dust-700": "#4a4740",
  red: "#d03731",
  yellow: "#f4c245",
  sky: "#4dabe9",
  indigo: "#2e318d",
  green: "#4aa35a",
  "red-deep": "#a8271f",
  "yellow-deep": "#7a5a00",
  "sky-deep": "#1c5f8c",
  "green-deep": "#2c6b37",
  "red-soft": "#f9e1df",
  "yellow-soft": "#fcf0cc",
  "sky-soft": "#ddeefb",
  "indigo-soft": "#e3e3f3",
  "green-soft": "#dfefe2",
};

function luminance(h) {
  const n = parseInt(h.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function ratio(a, b) {
  const [l1, l2] = [luminance(hex[a] ?? a), luminance(hex[b] ?? b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// [foreground, background, minimum, purpose]
const pairs = [
  ["ink", "paper", 4.5, "body text"],
  ["dust-500", "paper", 4.5, "secondary text"],
  ["dust-500", "dust-100", 4.5, "secondary text on sunken surface"],
  ["dust-500", "card", 4.5, "secondary text on card"],
  ["dust-700", "paper", 4.5, "strong secondary text"],
  ["dust-300", "ink", 4.5, "secondary text on ink"],
  ["paper", "ink", 4.5, "solid button"],
  // Solid status fills: text-on-accent pairs
  ["ink", "yellow", 4.5, "status waiting (solid)"],
  ["ink", "sky", 4.5, "status in progress (solid)"],
  ["ink", "green", 4.5, "status ready/done (solid)"],
  // Danger takes paper text. Ink on red is 4.11:1 and must not be used.
  ["paper", "red", 4.5, "status danger (solid)"],
  ["paper", "indigo", 4.5, "status info (solid)"],
  // Soft status fills: deep text on tint, for dense tables
  ["yellow-deep", "yellow-soft", 4.5, "status waiting (soft)"],
  ["sky-deep", "sky-soft", 4.5, "status in progress (soft)"],
  ["green-deep", "green-soft", 4.5, "status ready/done (soft)"],
  ["red-deep", "red-soft", 4.5, "status danger (soft)"],
  ["indigo", "indigo-soft", 4.5, "status info (soft)"],
  // Deep accents as text on page surfaces (errors, links, inline status)
  ["red-deep", "paper", 4.5, "error text"],
  ["red-deep", "card", 4.5, "error text on card"],
  ["yellow-deep", "paper", 4.5, "warning text"],
  ["sky-deep", "paper", 4.5, "progress text"],
  ["green-deep", "paper", 4.5, "success text"],
  ["indigo", "paper", 4.5, "info text / links"],
  // Non-text UI (WCAG 1.4.11)
  ["ink", "paper", 3, "input border"],
  ["dust-500", "card", 3, "subtle control border"],
  ["red", "paper", 3, "error border"],
  ["indigo", "card", 3, "focus ring on card"],
  ["indigo", "dust-100", 3, "focus ring on sunken surface"],
  ["paper", "ink", 3, "focus ring on ink"],
];

let failed = false;
for (const [fg, bg, min, purpose] of pairs) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) failed = true;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${r.toFixed(2).padStart(5)}:1  ${fg} on ${bg}  (${purpose}, needs ${min}:1)`,
  );
}
process.exit(failed ? 1 : 0);
