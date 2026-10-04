import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ArchiveControl } from "@/components/domain/archive-control";
import { NewBikeButton } from "@/components/domain/bike-sheet";
import { EditCustomerButton } from "@/components/domain/customer-sheet";
import { PhotoGrid } from "@/components/domain/photo-grid";
import { ShortId } from "@/components/domain/short-id";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { BikeIcon, ChevronRightIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink, RowList } from "@/components/ui/row-list";
import { requireStaff } from "@/lib/auth/session";
import { formatDate } from "@/lib/dates";
import { listPhotos } from "@/lib/domain/attachments";
import { getCustomer } from "@/lib/domain/customers";
import { mailtoHref, telHref } from "@/lib/people";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

export const metadata: Metadata = { title: "Customer" };

/**
 * One customer (SPEC §21): how to reach them, staff notes, the bikes they
 * own now (add one here), photos on their record (never public, PLAN D13),
 * and archiving.
 */
export default async function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  await requireStaff();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const [customer, photos] = await Promise.all([
    getCustomer(supabase, id),
    listPhotos(supabase, { entityType: "customer", entityId: id }),
  ]);
  if (!customer) notFound();
  const archived = customer.archivedAt !== null;
  const tel = telHref(customer.phone);
  const mailto = mailtoHref(customer.email);

  return (
    <>
      <PageHeader
        eyebrow="Customer"
        title={customer.label}
        description={`Customer since ${formatDate(customer.createdAt)}`}
        actions={
          <>
            {archived ? <Badge tone="waiting">Archived</Badge> : null}
            <EditCustomerButton
              customer={{
                id: customer.id,
                firstName: customer.firstName,
                lastName: customer.lastName,
                displayName: customer.displayName,
                email: customer.email,
                phone: customer.phone,
                internalNotes: customer.internalNotes,
              }}
            />
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Contact">
          {tel || mailto ? (
            <ul
              aria-label="Contact"
              className="-mx-4 flex flex-col divide-y divide-hairline sm:-mx-5"
            >
              {customer.phone ? (
                <li>
                  {tel ? (
                    <a
                      href={tel}
                      className="flex min-h-tap flex-col px-4 py-2 focus-inset hover:bg-dust-100 sm:px-5"
                    >
                      <span className="eyebrow text-dust-500">Phone · tap to call</span>
                      <span className="text-lg font-medium tabular-nums">{customer.phone}</span>
                    </a>
                  ) : (
                    <p className="px-4 py-2 sm:px-5">{customer.phone}</p>
                  )}
                </li>
              ) : null}
              {customer.email ? (
                <li>
                  {mailto ? (
                    <a
                      href={mailto}
                      className="flex min-h-tap flex-col px-4 py-2 break-all focus-inset hover:bg-dust-100 sm:px-5"
                    >
                      <span className="eyebrow text-dust-500">Email</span>
                      <span className="text-lg font-medium">{customer.email}</span>
                    </a>
                  ) : (
                    <p className="px-4 py-2 sm:px-5">{customer.email}</p>
                  )}
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="text-dust-700">No phone number or email on file.</p>
          )}
        </Card>
        <Card title="Internal notes" eyebrow="Staff only">
          {customer.internalNotes ? (
            <p className="whitespace-pre-line text-dust-700">{customer.internalNotes}</p>
          ) : (
            <p className="text-dust-500">No notes. Add them with Edit.</p>
          )}
        </Card>
      </div>
      <Card
        title="Bikes"
        actions={
          <NewBikeButton
            owner={{ id: customer.id, label: customer.label }}
            disabled={archived}
            variant="outline"
          />
        }
      >
        {archived ? (
          <p className="mb-3 text-sm text-dust-500">
            Archived customers cannot receive bikes. Unarchive them first.
          </p>
        ) : null}
        {customer.bikes.length === 0 ? (
          <p className="flex items-center gap-2 text-dust-700">
            <BikeIcon className="size-5 shrink-0 text-dust-500" />
            No bikes registered to {customer.label} yet.
          </p>
        ) : (
          <RowList label={`Bikes of ${customer.label}`}>
            {customer.bikes.map((bike) => (
              <RowLink key={bike.id} href={`/bikes/${bike.id}`}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2">
                    <span className="line-clamp-2 font-medium break-words">{bike.title}</span>
                    {bike.archived ? <Badge>Archived</Badge> : null}
                  </span>
                  {bike.detail ? (
                    <span className="truncate text-sm text-dust-500">{bike.detail}</span>
                  ) : null}
                </span>
                <ShortId value={bike.shortId} />
                <ChevronRightIcon className="size-5 shrink-0 text-dust-500" />
              </RowLink>
            ))}
          </RowList>
        )}
      </Card>
      <Card title="Photos" eyebrow="On the customer record">
        <PhotoGrid
          target={{ entityType: "customer", entityId: customer.id }}
          photos={photos}
          canAdd={!archived}
        />
      </Card>
      <Card title="Archive">
        <ArchiveControl
          kind="customer"
          id={customer.id}
          name={customer.label}
          archived={archived}
        />
      </Card>
    </>
  );
}
