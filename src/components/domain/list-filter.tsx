import Link from "next/link";

import { cn } from "@/lib/cn";
import { withParam } from "@/lib/search-params";

/**
 * Active / Archived switch for a list page, as links that keep the search
 * text (`?q=`), so the filter is part of the URL like the query.
 */
export function ArchivedFilter({
  basePath,
  q,
  archived,
  label,
}: {
  basePath: string;
  q: string;
  archived: boolean;
  /** Accessible name, e.g. "Show customers". */
  label: string;
}) {
  const options = [
    {
      key: "active",
      text: "Active",
      href: `${basePath}${withParam("", "q", q)}`,
      current: !archived,
    },
    {
      key: "archived",
      text: "Archived",
      href: `${basePath}${withParam(new URLSearchParams({ archived: "1" }), "q", q)}`,
      current: archived,
    },
  ];
  return (
    <nav aria-label={label}>
      <ul className="inline-flex gap-1 rounded-full border-2 border-ink bg-card p-1">
        {options.map((o) => (
          <li key={o.key}>
            <Link
              href={o.href}
              replace
              scroll={false}
              aria-current={o.current ? "page" : undefined}
              className={cn(
                "inline-flex min-h-tap items-center rounded-full px-4 font-display text-xs font-bold tracking-wide uppercase focus-inset transition-colors",
                o.current ? "bg-ink text-paper" : "text-ink hover:bg-dust-100",
              )}
            >
              {o.text}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
