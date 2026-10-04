import type { Metadata } from "next";

import { NewBikeButton } from "@/components/domain/bike-sheet";
import { ArchivedFilter } from "@/components/domain/list-filter";
import { SearchField } from "@/components/domain/search-field";
import { ShortId } from "@/components/domain/short-id";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { BikeIcon, ChevronRightIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink, RowList } from "@/components/ui/row-list";
import { requireStaff } from "@/lib/auth/session";
import { listBikes } from "@/lib/domain/bikes";
import { readFlag, readQuery } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Bikes" };

/**
 * Bikes (SPEC §5, §21): search by B- number, serial number (case, spaces
 * and dashes don't matter), brand, model, colour or owner; with nothing
 * typed, the most recently updated bikes. New bikes may have no owner
 * (shop and consigned bikes).
 */
export default async function BikesPage({ searchParams }: PageProps<"/bikes">) {
  await requireStaff();
  const params = await searchParams;
  const q = readQuery(params.q);
  const archived = readFlag(params.archived);
  const { items: bikes, more } = await listBikes(await createClient(), { q, archived });

  const heading = q
    ? more
      ? `First ${bikes.length} matches`
      : `${bikes.length} ${bikes.length === 1 ? "match" : "matches"}`
    : archived
      ? more
        ? `Latest ${bikes.length} archived bikes`
        : "Archived bikes"
      : "Recently updated";

  return (
    <>
      <PageHeader title="Bikes" actions={<NewBikeButton />} />
      <div className="flex flex-col gap-3">
        <SearchField
          label="Search bikes"
          hint="B- number, serial number, brand, model or owner"
          placeholder="Search bikes"
        />
        <ArchivedFilter basePath="/bikes" q={q} archived={archived} label="Which bikes" />
      </div>
      <section aria-labelledby="bike-results" className="flex flex-col gap-2">
        <h2 id="bike-results" className="eyebrow text-dust-500">
          {heading}
        </h2>
        {more && q ? (
          <p className="text-sm text-dust-700">
            There are more. Add more of the B- number, serial number, model or owner to narrow it
            down.
          </p>
        ) : null}
        {bikes.length === 0 ? (
          <EmptyState
            icon={<BikeIcon />}
            title={q ? `No bike matches “${q}”` : archived ? "No archived bikes" : "No bikes yet"}
            description={
              q
                ? "Try the B- number from its label, part of the serial number, the brand and model, or the owner's name."
                : archived
                  ? "Bikes you archive appear here, with their photos and history intact."
                  : "Add a bike from a customer's page, or here for a shop or consigned bike."
            }
            action={archived ? undefined : <NewBikeButton />}
          />
        ) : (
          <RowList label="Bikes">
            {bikes.map((b) => (
              <RowLink key={b.id} href={`/bikes/${b.id}`}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2">
                    <span className="line-clamp-2 font-medium break-words">{b.title}</span>
                    {b.archived ? <Badge>Archived</Badge> : null}
                  </span>
                  {b.detail ? (
                    <span className="truncate text-sm text-dust-500">{b.detail}</span>
                  ) : null}
                </span>
                <ShortId value={b.shortId} />
                <ChevronRightIcon className="size-5 shrink-0 text-dust-500" />
              </RowLink>
            ))}
          </RowList>
        )}
      </section>
    </>
  );
}
