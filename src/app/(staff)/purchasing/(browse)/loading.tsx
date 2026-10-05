import { RouteLoading } from "@/components/shell/route-loading";

/**
 * Instant fallback for the Purchasing lists (src/components/shell/route-loading.tsx).
 * Only inside the (browse) group: nothing under it calls forbidden().
 */
export default function Loading() {
  return <RouteLoading />;
}
