import { Suspense } from "react";

import { PhotoUploadsProvider } from "@/components/domain/photo-uploads";
import { AppHeader } from "@/components/shell/app-header";
import { ProfileChip, ProfileChipSkeleton } from "@/components/shell/profile-chip";
import { SideRail } from "@/components/shell/side-rail";
import { StaffSideRail } from "@/components/shell/staff-side-rail";
import { TabBar } from "@/components/shell/tab-bar";

/**
 * The staff app shell (ADR-001 A9): bottom tab bar on phones, labelled rail
 * from md up, sticky header with search and profile.
 *
 * Not async, so the shell streams immediately (Next docs: "Auth and
 * streaming"). The staff check lives in <ProfileChip> under <Suspense>, and
 * — because layouts do not re-run on navigation and do not stop child
 * segments from rendering — every page calls requireStaff() itself.
 *
 * PhotoUploadsProvider keeps photo uploads going (and their failures in
 * view) while staff move between screens.
 */
export default function StaffLayout({ children }: LayoutProps<"/">) {
  return (
    <PhotoUploadsProvider>
      <div className="flex min-h-dvh flex-1">
        <a
          href="#main"
          className="sr-only z-50 rounded-full bg-ink px-4 py-2 text-paper focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        <Suspense fallback={<SideRail />}>
          <StaffSideRail />
        </Suspense>
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader
            profile={
              <Suspense fallback={<ProfileChipSkeleton />}>
                <ProfileChip />
              </Suspense>
            }
          />
          <main
            id="main"
            tabIndex={-1}
            className="gutter flex flex-1 flex-col gap-6 pb-[calc(6.5rem+env(safe-area-inset-bottom))] focus:outline-none md:pb-10"
          >
            {children}
          </main>
        </div>
        <TabBar />
      </div>
    </PhotoUploadsProvider>
  );
}
