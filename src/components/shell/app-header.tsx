import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { HeaderSearch } from "./header-search";

/**
 * Sticky top bar: BICII mark (phones; the rail shows it from md up), the
 * global search field (HeaderSearch: Enter opens /search) and the profile
 * button. Clears the notch/status bar via the safe-area inset
 * (viewport-fit=cover in the root layout).
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
        <HeaderSearch />
        <div className="ml-auto flex shrink-0 items-center">{profile}</div>
      </div>
    </header>
  );
}
