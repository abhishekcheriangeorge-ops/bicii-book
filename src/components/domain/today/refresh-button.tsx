"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

import { Spinner } from "@/components/ui/spinner";

/** Coming back to the tab refreshes Today when the figures are at least this old. */
const STALE_AFTER_MS = 60_000;

/**
 * "Updated 10:42 am" and Refresh (client): `router.refresh()` in a
 * transition re-reads every figure on the server while the page stays
 * usable, with a spinner meanwhile. Returning to the tab (visibilitychange)
 * refreshes too, once the figures are a minute old.
 */
export function RefreshButton({ generatedAt, label }: { generatedAt: string; label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const loadedAt = useRef(Date.parse(generatedAt) || 0);

  useEffect(() => {
    loadedAt.current = Date.parse(generatedAt) || Date.now();
  }, [generatedAt]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - loadedAt.current < STALE_AFTER_MS) return;
      loadedAt.current = Date.now();
      startTransition(() => router.refresh());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router]);

  return (
    <div className="flex items-center gap-2 text-sm text-dust-500">
      <span aria-live="polite">{pending ? "Updating…" : `Updated ${label}`}</span>
      <button
        type="button"
        onClick={() => {
          loadedAt.current = Date.now();
          startTransition(() => router.refresh());
        }}
        disabled={pending}
        aria-busy={pending || undefined}
        className="inline-flex min-h-tap items-center gap-2 rounded-full px-3 font-display text-xs font-bold tracking-wide text-ink uppercase hover:bg-dust-100 disabled:opacity-60"
      >
        {pending ? <Spinner className="size-4" /> : null}
        Refresh
      </button>
    </div>
  );
}
