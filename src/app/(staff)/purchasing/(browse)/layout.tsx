import { PurchasingNav } from "@/components/domain/purchasing/purchasing-nav";

/**
 * Purchasing's browsing screens (orders, suppliers) share the section nav
 * and the (browse)/loading.tsx skeleton. A route group: it adds nothing to
 * the URL, and its loading boundary covers only the routes inside it, so
 * step 4's manage_purchasing pages beside it (outside the group) keep their
 * real 403 (DESIGN.md "Loading": a loading boundary above forbidden()
 * commits a 200).
 */
export default function PurchasingBrowseLayout({ children }: LayoutProps<"/purchasing">) {
  return (
    <>
      <PurchasingNav />
      {children}
    </>
  );
}
