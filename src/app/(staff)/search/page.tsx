import type { Metadata } from "next";

import { SearchField } from "@/components/domain/search-field";
import { ShortId } from "@/components/domain/short-id";
import { EmptyState } from "@/components/ui/empty-state";
import { ChevronRightIcon, SearchIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink, RowList } from "@/components/ui/row-list";
import { requireStaff } from "@/lib/auth/session";
import { staffSearch } from "@/lib/domain/search";
import { groupHits, hrefForHit } from "@/lib/search";
import { readQuery } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";

import { RecentSearches, RememberOnOpen } from "./recent-searches";

export const metadata: Metadata = { title: "Search" };

/**
 * Global search (SPEC §20) over staff_search: customers by name, phone or
 * email; bikes by B- number, serial number (ignoring case, spaces and
 * dashes), brand, model, colour or owner. Exact short IDs and serial
 * numbers come first. Jobs, products and the rest join as their phases
 * land.
 */
export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  await requireStaff();
  const q = readQuery((await searchParams).q);
  const { items: hits, more } = q
    ? await staffSearch(await createClient(), q)
    : { items: [], more: false };
  const groups = groupHits(hits);

  return (
    <>
      <PageHeader title="Search" />
      <SearchField
        label="Search customers and bikes"
        hint="Name, phone, email, serial number or B- number"
        placeholder="Search"
        autoFocus={!q}
        remember
      />
      {!q ? (
        <RecentSearches
          empty={
            <EmptyState
              icon={<SearchIcon />}
              title="Find a customer or bike"
              description="Type part of a name, the last digits of a phone number, a serial number or a B- number. Jobs and products become searchable in later phases."
            />
          }
        />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<SearchIcon />}
          title={`Nothing matches “${q}”`}
          description="Check the spelling, try fewer words, or search by phone digits, serial number or B- number. Archived customers and bikes are not searched; find them under Customers or Bikes."
        />
      ) : (
        <RememberOnOpen q={q}>
          {more ? (
            <p className="text-sm text-dust-700">
              Showing the {hits.length} best matches; there are more. Add more of the name, phone,
              serial number or B- number to narrow it down.
            </p>
          ) : null}
          {groups.map((group) => (
            <section
              key={group.kind}
              aria-labelledby={`results-${group.kind}`}
              className="flex flex-col gap-2"
            >
              <h2 id={`results-${group.kind}`} className="eyebrow text-dust-500">
                {/* Cut off: a count would read as the total. */}
                {more ? group.label : `${group.label} (${group.hits.length})`}
              </h2>
              <RowList label={group.label}>
                {group.hits.map((hit) => (
                  <RowLink key={hit.id} href={hrefForHit(hit)}>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="line-clamp-2 font-medium break-words">{hit.title}</span>
                      {hit.subtitle ? (
                        <span className="truncate text-sm text-dust-500">{hit.subtitle}</span>
                      ) : null}
                    </span>
                    {hit.shortId ? <ShortId value={hit.shortId} /> : null}
                    <ChevronRightIcon className="size-5 shrink-0 text-dust-500" />
                  </RowLink>
                ))}
              </RowList>
            </section>
          ))}
        </RememberOnOpen>
      )}
    </>
  );
}
