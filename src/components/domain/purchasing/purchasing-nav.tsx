"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

/**
 * The Purchasing section's own links (in (browse)/layout.tsx): Orders and
 * Suppliers, plus Reorder (/purchasing/reorder, D66) for manage_purchasing
 * holders (`canReorder`), aria-current on the active one, 44px targets,
 * scrolling sideways on a narrow phone with the inset focus ring.
 */
const LINKS = [
  {
    href: "/purchasing",
    label: "Orders",
    active: (p: string) => p === "/purchasing" || p.startsWith("/purchasing/orders"),
  },
  {
    href: "/purchasing/suppliers",
    label: "Suppliers",
    active: (p: string) => p.startsWith("/purchasing/suppliers"),
  },
  {
    href: "/purchasing/reorder",
    label: "Reorder",
    active: (p: string) => p.startsWith("/purchasing/reorder"),
    manageOnly: true,
  },
] as const;

export function PurchasingNav({ canReorder = false }: { canReorder?: boolean }) {
  const pathname = usePathname() ?? "";
  return (
    <nav aria-label="Purchasing" className="max-w-full pt-4">
      <ul className="inline-flex max-w-full [scrollbar-width:none] gap-1 overflow-x-auto rounded-full border-2 border-ink bg-card p-1">
        {LINKS.filter((l) => !("manageOnly" in l) || canReorder).map((l) => {
          const current = l.active(pathname);
          return (
            <li key={l.href} className="shrink-0">
              <Link
                href={l.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-tap items-center rounded-full px-4 font-display text-xs font-bold tracking-wide whitespace-nowrap uppercase focus-inset transition-colors",
                  current ? "bg-ink text-paper" : "text-ink hover:bg-dust-100",
                )}
              >
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
