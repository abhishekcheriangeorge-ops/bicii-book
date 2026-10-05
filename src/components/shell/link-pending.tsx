"use client";

import { useLinkStatus } from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Wraps part of a nav <Link>'s content and marks it while that navigation
 * is pending, so a tap is acknowledged at once even before the route's
 * loading.tsx fallback arrives (slow shop Wi-Fi). Must be rendered inside
 * the <Link>. Styling only changes colour/opacity, never layout.
 */
export function LinkPending({
  className,
  pendingClassName,
  children,
}: {
  className?: string;
  pendingClassName: string;
  children: ReactNode;
}) {
  const { pending } = useLinkStatus();
  return (
    <span
      data-pending={pending || undefined}
      className={cn(className, pending && pendingClassName)}
    >
      {children}
    </span>
  );
}
