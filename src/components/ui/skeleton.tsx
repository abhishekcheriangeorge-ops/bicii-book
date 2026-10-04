import { cn } from "@/lib/cn";

/**
 * Placeholder block while data loads. Decorative: the region that is loading
 * should carry aria-busy="true" (loading.tsx files do this for routes).
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("animate-pulse rounded-lg bg-dust-200", className)} />
  );
}

/** A few lines of text-shaped skeleton; the last line is shorter. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-4", i === lines - 1 ? "w-3/5" : "w-full")} />
      ))}
    </div>
  );
}
