"use client";

import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ChevronRightIcon } from "@/components/ui/icons";
import {
  clearRecentSearches,
  parseRecentSearches,
  recentSearchesSnapshot,
  rememberSearch,
  subscribeRecentSearches,
} from "@/lib/recent-searches";

const serverSnapshot = () => null;
const clientSnapshot = () => recentSearchesSnapshot();

/**
 * This device's recent searches (localStorage), shown on /search before
 * anything is typed. Nothing renders on the server, which cannot know them.
 */
export function RecentSearches({ empty }: { empty: ReactNode }) {
  const raw = useSyncExternalStore(subscribeRecentSearches, clientSnapshot, serverSnapshot);
  if (raw === null) return null;
  const recent = parseRecentSearches(raw);
  if (recent.length === 0) return <>{empty}</>;
  return (
    <section aria-labelledby="recent-searches" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h2 id="recent-searches" className="eyebrow text-dust-500">
          Recent searches on this device
        </h2>
        <Button variant="ghost" size="sm" onClick={() => clearRecentSearches()}>
          Clear
        </Button>
      </div>
      <ul
        aria-label="Recent searches"
        className="divide-y divide-hairline rounded-2xl border border-hairline bg-card"
      >
        {recent.map((q) => (
          <li key={q} className="group/row">
            <Link
              href={`/search?q=${encodeURIComponent(q)}`}
              replace
              className="flex min-h-tap items-center gap-3 px-4 py-2 focus-inset transition-colors group-first/row:rounded-t-[15px] group-last/row:rounded-b-[15px] hover:bg-dust-100"
            >
              <span className="min-w-0 flex-1 truncate">{q}</span>
              <ChevronRightIcon className="size-5 shrink-0 text-dust-500" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Wraps search results: opening one keeps the query in this device's
 * recent searches.
 */
export function RememberOnOpen({ q, children }: { q: string; children: ReactNode }) {
  return (
    <div
      className="flex flex-col gap-6"
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest("a")) rememberSearch(q);
      }}
    >
      {children}
    </div>
  );
}
