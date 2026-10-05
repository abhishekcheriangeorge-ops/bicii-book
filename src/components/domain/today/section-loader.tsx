import type { ReactNode } from "react";

import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { logger } from "@/lib/logger";

/**
 * One streamed part of Today (server): awaits `load`, then renders
 * `children(data)`. Wrap it in <Suspense fallback={<SectionSkeleton />}>
 * so the rest of the page shows first. A failed read is logged and shown
 * in place ("Couldn't load this. Refresh") instead of failing the page.
 */
export async function SectionLoader<T>({
  name,
  load,
  children,
}: {
  /** For the log line. */
  name: string;
  load: () => Promise<T>;
  children: (data: T) => ReactNode;
}) {
  let data: T;
  try {
    data = await load();
  } catch (err) {
    logger.error({ err, section: name }, "today section failed to load");
    return <SectionError />;
  }
  return children(data);
}

/** The inline error a section shows when its read failed. */
export function SectionError() {
  return (
    <p role="alert" className="rounded-2xl border border-hairline bg-card px-4 py-3 text-sm">
      <span className="font-semibold text-danger-deep">Couldn&apos;t load this.</span> Refresh the
      page to try again.
    </p>
  );
}

/** The fallback while a section loads. */
export function SectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div
      aria-busy="true"
      className="flex flex-col gap-3 rounded-2xl border border-hairline bg-card p-4"
    >
      <Skeleton className="h-5 w-1/3" />
      <SkeletonText lines={rows} />
    </div>
  );
}
