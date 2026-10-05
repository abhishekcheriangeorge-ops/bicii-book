import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  experimental: {
    // forbidden() / unauthorized() and forbidden.tsx / unauthorized.tsx
    // (ADR-001 A3).
    authInterrupts: true,
  },
  // `next dev` blocks dev resources for origins other than localhost; the
  // devstack and Playwright sometimes use 127.0.0.1.
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        // Per the PWA guide: never cache the service worker itself, so a new
        // deploy's worker is picked up; it may only load same-origin code.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
