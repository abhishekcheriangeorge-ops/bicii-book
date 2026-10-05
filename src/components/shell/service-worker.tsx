"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js in production builds only: in development a
 * cache-first worker would serve stale chunks across HMR reloads.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Installability is a convenience; the app works without it.
    });
  }, []);
  return null;
}
