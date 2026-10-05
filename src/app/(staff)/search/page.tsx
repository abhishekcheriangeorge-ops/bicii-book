import type { Metadata } from "next";

import { EmptyState } from "@/components/ui/empty-state";
import { SearchIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { requireStaff } from "@/lib/auth/session";

import { SearchBox } from "./search-box";

export const metadata: Metadata = { title: "Search" };

/**
 * Global search (SPEC §20). The box is here so the header entry lands
 * somewhere real; results come as each record type is built.
 */
export default async function SearchPage() {
  await requireStaff();
  return (
    <>
      <PageHeader title="Search" />
      <SearchBox />
      <EmptyState
        icon={<SearchIcon />}
        title="Nothing to search yet"
        description="Customers and bikes become searchable in Phase 1, jobs in Phase 3, and products, units and short IDs in Phase 4."
      />
    </>
  );
}
