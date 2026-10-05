import type { Metadata } from "next";

import { NewCustomerButton } from "@/components/domain/customer-sheet";
import { ArchivedFilter } from "@/components/domain/list-filter";
import { SearchField } from "@/components/domain/search-field";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ChevronRightIcon, UsersIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink, RowList } from "@/components/ui/row-list";
import { requireStaff } from "@/lib/auth/session";
import { listCustomers } from "@/lib/domain/customers";
import { readFlag, readQuery } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Customers" };

/**
 * Customers (SPEC §21), search first: type a name, phone digits or an
 * email; with nothing typed, the most recently updated customers. Archived
 * customers have their own list.
 */
export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  await requireStaff();
  const params = await searchParams;
  const q = readQuery(params.q);
  const archived = readFlag(params.archived);
  const { items: customers, more } = await listCustomers(await createClient(), { q, archived });

  const heading = q
    ? more
      ? `First ${customers.length} matches`
      : `${customers.length} ${customers.length === 1 ? "match" : "matches"}`
    : archived
      ? more
        ? `Latest ${customers.length} archived customers`
        : "Archived customers"
      : "Recently updated";

  return (
    <>
      <PageHeader title="Customers" actions={<NewCustomerButton />} />
      <div className="flex flex-col gap-3">
        <SearchField
          label="Search customers"
          hint="Name, phone digits or email"
          placeholder="Search customers"
        />
        <ArchivedFilter basePath="/customers" q={q} archived={archived} label="Which customers" />
      </div>
      <section aria-labelledby="customer-results" className="flex flex-col gap-2">
        <h2 id="customer-results" className="eyebrow text-dust-500">
          {heading}
        </h2>
        {more && q ? (
          <p className="text-sm text-dust-700">
            There are more. Add more of the name, phone number or email to narrow it down.
          </p>
        ) : null}
        {customers.length === 0 ? (
          <EmptyState
            icon={<UsersIcon />}
            title={
              q
                ? `No customer matches “${q}”`
                : archived
                  ? "No archived customers"
                  : "No customers yet"
            }
            description={
              q
                ? "Try part of the name, the last digits of the phone number, or the email. If they are new, add them."
                : archived
                  ? "Customers you archive appear here, with their bikes and history intact."
                  : "Add the first customer to start keeping their bikes and history."
            }
            action={archived ? undefined : <NewCustomerButton />}
          />
        ) : (
          <RowList label="Customers">
            {customers.map((c) => (
              <RowLink key={c.id} href={`/customers/${c.id}`}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{c.label}</span>
                    {c.archived ? <Badge>Archived</Badge> : null}
                  </span>
                  {c.detail ? (
                    <span className="truncate text-sm text-dust-500">{c.detail}</span>
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
