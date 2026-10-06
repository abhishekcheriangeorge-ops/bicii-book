import type { Metadata } from "next";

import { ArchivedFilter } from "@/components/domain/list-filter";
import { NewSupplierButton } from "@/components/domain/purchasing/supplier-sheet";
import { SearchField } from "@/components/domain/search-field";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ChevronRightIcon, TruckIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink, RowList } from "@/components/ui/row-list";
import { requireStaff } from "@/lib/auth/session";
import { listSuppliers } from "@/lib/domain/suppliers";
import { canManagePurchasing } from "@/lib/purchasing";
import { readFlag, readQuery } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Suppliers" };

/**
 * Suppliers (SPEC §14, §21): search by name, contact, email, account
 * reference or phone digits; without a query, every active supplier by
 * name. Archived suppliers have their own list. New supplier for
 * manage_purchasing.
 */
export default async function SuppliersPage({ searchParams }: PageProps<"/purchasing/suppliers">) {
  const staff = await requireStaff();
  const params = await searchParams;
  const q = readQuery(params.q);
  const archived = readFlag(params.archived);
  const manage = canManagePurchasing(staff);
  const { items: suppliers, more } = await listSuppliers(await createClient(), { q, archived });

  const heading = q
    ? more
      ? `First ${suppliers.length} matches`
      : `${suppliers.length} ${suppliers.length === 1 ? "match" : "matches"}`
    : archived
      ? "Archived suppliers"
      : "By name";

  return (
    <>
      <PageHeader title="Suppliers" actions={manage ? <NewSupplierButton /> : null} />
      <div className="flex flex-col gap-3">
        <SearchField
          label="Search suppliers"
          hint="Name, contact, email, account reference or phone digits"
          placeholder="Search suppliers"
        />
        <ArchivedFilter
          basePath="/purchasing/suppliers"
          q={q}
          archived={archived}
          label="Which suppliers"
        />
      </div>
      <section aria-labelledby="supplier-results" className="flex flex-col gap-2">
        <h2 id="supplier-results" className="eyebrow text-dust-500">
          {heading}
        </h2>
        {more ? (
          <p className="text-sm text-dust-700">
            There are more. Type more of the name to narrow it down.
          </p>
        ) : null}
        {suppliers.length === 0 ? (
          <EmptyState
            icon={<TruckIcon />}
            title={
              q
                ? `No supplier matches “${q}”`
                : archived
                  ? "No archived suppliers"
                  : "No suppliers yet"
            }
            description={
              q
                ? "Try part of the name, the contact's name, their email or phone digits."
                : archived
                  ? "Suppliers you archive appear here, with their orders intact."
                  : "Add the shops and distributors you buy stock from, then order from them."
            }
            action={manage && !archived ? <NewSupplierButton /> : undefined}
          />
        ) : (
          <RowList label="Suppliers">
            {suppliers.map((s) => (
              <RowLink key={s.id} href={`/purchasing/suppliers/${s.id}`}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{s.name}</span>
                    {s.archived ? <Badge>Archived</Badge> : null}
                  </span>
                  {s.detail ? (
                    <span className="truncate text-sm text-dust-500">{s.detail}</span>
                  ) : null}
                </span>
                <ChevronRightIcon className="size-5 shrink-0 text-dust-500" />
              </RowLink>
            ))}
          </RowList>
        )}
      </section>
    </>
  );
}
