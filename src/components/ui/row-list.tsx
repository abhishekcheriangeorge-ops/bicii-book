import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * An edge-to-edge list of tappable rows in a rounded panel (More, Settings,
 * Staff, and later jobs, products, customers).
 *
 * It does not clip (`overflow-hidden` would cut the focus ring and any
 * popup inside a row): the first and last rows round their own corners,
 * and rows use the inset focus ring (`focus-inset`), which stays inside the
 * row, so the ring is whole on every row at every width.
 */
export function RowList({
  label,
  className,
  children,
}: {
  /** Accessible name, e.g. "Staff members". Omit inside a labelled <nav>. */
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ul
      aria-label={label}
      className={cn(
        "divide-y divide-hairline rounded-2xl border border-hairline bg-card",
        className,
      )}
    >
      {children}
    </ul>
  );
}

/** One row of a RowList: the whole row is the link (≥ 64px tall). */
export function RowLink({
  href,
  label,
  className,
  children,
}: {
  href: string;
  /** The link's accessible name when its text alone would run together. */
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <li className="group/row">
      <Link
        href={href}
        aria-label={label}
        className={cn(
          "flex min-h-16 items-center gap-4 px-4 py-3 focus-inset transition-colors hover:bg-dust-100",
          // Inner radius of the panel's 16px corner minus its 1px border.
          "group-first/row:rounded-t-[15px] group-last/row:rounded-b-[15px]",
          className,
        )}
      >
        {children}
      </Link>
    </li>
  );
}
