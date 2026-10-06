import { requireStaff } from "@/lib/auth/session";

/**
 * Print views (ADR-001 A9; DATA-MODEL §12): outside the app shell, so a
 * printed page carries the labels and nothing else (no tab bar, rail or
 * header). The staff check here is a convenience only: a layout does not
 * re-run on navigation, so every page under it calls requireStaff() itself.
 */
export default async function PrintLayout({ children }: LayoutProps<"/">) {
  await requireStaff();
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-paper print:min-h-0 print:bg-white">
      {children}
    </div>
  );
}
