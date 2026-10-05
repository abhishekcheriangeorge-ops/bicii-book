import type { Metadata } from "next";

import { PurchasingNav } from "@/components/domain/purchasing/purchasing-nav";
import { ReorderList } from "@/components/domain/purchasing/reorder-list";
import { PageHeader } from "@/components/ui/page-header";
import { requireStaff } from "@/lib/auth/session";
import { unwrap } from "@/lib/db-errors";
import { getReorderSuggestions } from "@/lib/domain/purchasing";
import { DEFAULT_CURRENCY } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

export const metadata: Metadata = { title: "Reorder" };

/**
 * Reorder from low stock (SPEC §11, §14; PLAN D66 D-REORDER):
 * manage_purchasing only, with a real 403 (outside the (browse) group, no
 * loading.tsx above it). `?supplier=` presets the supplier; the list is
 * reorder_suggestions for it, with the draft's default costs (D60).
 */
export default async function ReorderPage({ searchParams }: PageProps<"/purchasing/reorder">) {
  const staff = await requireStaff("manage_purchasing");
  const raw = (await searchParams).supplier;
  const supplierParam = Array.isArray(raw) ? raw[0] : raw;
  const supabase = await createClient();
  const supplierRow = isUuid(supplierParam)
    ? unwrap(
        await supabase
          .from("suppliers")
          .select("id, name, archived_at")
          .eq("id", supplierParam)
          .maybeSingle(),
      )
    : null;
  const supplier =
    supplierRow && supplierRow.archived_at === null
      ? { id: supplierRow.id, name: supplierRow.name }
      : null;
  const items = await getReorderSuggestions(supabase, supplier?.id ?? null, staff);

  return (
    <>
      <PurchasingNav canReorder />
      <PageHeader
        title="Reorder"
        description="Products at or below their reorder point. Tick what to order and make a draft order; change quantities and costs on the draft before submitting it."
      />
      <ReorderList
        key={supplier?.id ?? "none"}
        supplier={supplier}
        items={items}
        currency={DEFAULT_CURRENCY}
      />
    </>
  );
}
