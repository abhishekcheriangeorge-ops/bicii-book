import { PurchasingNav } from "@/components/domain/purchasing/purchasing-nav";
import { requireStaff } from "@/lib/auth/session";
import { canManagePurchasing } from "@/lib/purchasing";

/**
 * Purchasing's browsing screens (orders, suppliers) share the section nav
 * and the (browse)/loading.tsx skeleton. A route group: it adds nothing to
 * the URL, and its loading boundary covers only the routes inside it, so
 * step 4's manage_purchasing pages beside it (outside the group) keep their
 * real 403 (DESIGN.md "Loading": a loading boundary above forbidden()
 * commits a 200).
 */
export default async function PurchasingBrowseLayout({ children }: LayoutProps<"/purchasing">) {
  const staff = await requireStaff();
  return (
    <>
      <PurchasingNav canReorder={canManagePurchasing(staff)} />
      {children}
    </>
  );
}
