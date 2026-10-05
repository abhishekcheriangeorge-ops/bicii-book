import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { SearchIcon } from "@/components/ui/icons";

/**
 * Sticky top bar: BICII mark (phones; the rail shows it from md up), the
 * global search entry and the profile button. Clears the notch/status bar
 * via the safe-area inset (viewport-fit=cover in the root layout).
 */
export function AppHeader({ profile }: { profile: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-paper/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="gutter flex h-16 items-center gap-3">
        <Link
          href="/"
          className="flex min-h-tap shrink-0 items-center md:hidden"
          aria-label="BICII Admin, Today"
        >
          <Image
            src="/logo.svg"
            alt=""
            width={2016}
            height={952}
            unoptimized
            loading="eager"
            className="h-6 w-auto"
          />
        </Link>
        <Link
          href="/search"
          className="flex min-h-tap min-w-0 flex-1 items-center gap-2 rounded-full border-2 border-ink bg-card px-4 text-dust-500 transition-colors hover:bg-dust-100 md:max-w-md"
        >
          <SearchIcon className="size-5 shrink-0 text-ink" />
          <span className="truncate text-base">Search</span>
          <span className="sr-only">customers, bikes, jobs and products</span>
        </Link>
        <div className="ml-auto flex shrink-0 items-center">{profile}</div>
      </div>
    </header>
  );
}
