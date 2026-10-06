import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

/**
 * Instant fallback for a staff section while its server work runs (SPEC
 * §22 "useful loading states"). Staff pages are dynamic (they await
 * requireStaff()), so without a loading.tsx Next keeps the old screen up
 * until the new one has rendered and a tap on shop Wi-Fi looks ignored;
 * with one, the fallback is prefetched and shown at once.
 *
 * Used by `loading.tsx` files of sections whose pages need nothing beyond
 * requireStaff(). A loading boundary makes the response stream, which
 * commits it to HTTP 200 before the page runs (Next docs, loading.js
 * "Status Codes"): a permission page under it would answer forbidden()
 * with a 200. So permission-gated subtrees (/settings/staff,
 * /reports) and the group root have no loading.tsx; the nav links' pending
 * state (LinkPending) acknowledges taps there. DESIGN.md "Loading".
 */
export function RouteLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6 pt-6">
      <p role="status" className="sr-only">
        Loading…
      </p>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-10 w-2/3 max-w-md" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <SkeletonText lines={4} className="max-w-xl" />
    </div>
  );
}
