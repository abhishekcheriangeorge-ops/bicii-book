import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PurchaseOrderStatusPill } from "@/components/domain/purchasing/purchase-order-status-pill";
import { ReceiveForm } from "@/components/domain/purchasing/receive-form";
import { requireStaff } from "@/lib/auth/session";
import { getReceiveForm } from "@/lib/domain/purchasing";
import { itemsText, receiptTimeText } from "@/lib/receive-form";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

export const metadata: Metadata = { title: "Receive delivery" };

/**
 * Receive a delivery against a submitted or partially received order
 * (SPEC §14, §21, §22; PLAN D63, D64, D65). manage_purchasing only, with
 * a real 403: this route sits outside the (browse) group and no
 * loading.tsx is above it (DESIGN.md "Loading"). A focused page: the
 * header, the supplier, a back link, the order's receipts of the last 24
 * hours, then ReceiveForm, which also shows the closed state of a received
 * or cancelled order.
 */
export default async function ReceivePage({ params }: PageProps<"/purchasing/receive/[id]">) {
  const staff = await requireStaff("manage_purchasing");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const now = new Date();
  const form = await getReceiveForm(await createClient(), id, staff, now);
  if (!form) notFound();

  return (
    <>
      <header className="flex flex-col gap-3 pt-6 pb-4">
        <Link
          href={`/purchasing/orders/${form.id}`}
          className="inline-flex min-h-tap w-fit items-center text-sm font-semibold underline underline-offset-4"
        >
          ← Back to {form.poNumber}
        </Link>
        <h1 className="text-3xl leading-tight sm:text-4xl">Receive {form.poNumber}</h1>
        <p className="flex flex-wrap items-center gap-2 text-dust-700">
          <span>
            From{" "}
            <Link
              href={`/purchasing/suppliers/${form.supplier.id}`}
              className="font-semibold text-ink underline underline-offset-4"
            >
              {form.supplier.name}
            </Link>
          </span>
          <PurchaseOrderStatusPill status={form.status} />
        </p>
      </header>

      {form.recentReceipts.length > 0 ? (
        <section
          aria-labelledby="recent-receipts"
          className="mb-4 rounded-2xl border border-hairline bg-card p-4"
        >
          <h2 id="recent-receipts" className="eyebrow text-dust-500">
            Received in the last 24 hours
          </h2>
          <ul
            aria-label="Received in the last 24 hours"
            className="mt-2 flex flex-col gap-1 text-dense"
          >
            {form.recentReceipts.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-x-2 tabular-nums">
                <span className="font-semibold">{receiptTimeText(r.receivedAt)}</span>
                <span>by {r.receivedBy}</span>
                {r.reference ? <span className="font-mono">{r.reference}</span> : null}
                <span className="text-dust-700">{itemsText(r.units)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {form.status === "draft" ? (
        <p className="rounded-2xl bg-info-soft p-4 text-info-deep">
          Submit the order before receiving.{" "}
          <Link href={`/purchasing/orders/${form.id}`} className="font-semibold underline">
            Back to {form.poNumber}
          </Link>
        </p>
      ) : (
        <ReceiveForm
          order={{
            id: form.id,
            poNumber: form.poNumber,
            status: form.status,
            currency: form.currency,
            submittedAt: form.submittedAt,
            supplier: form.supplier,
          }}
          lines={form.lines}
          locations={form.locations.map(({ id: locationId, name }) => ({ id: locationId, name }))}
          defaultLocationId={form.defaultLocationId}
          references={form.allReferences}
          serverNow={now.toISOString()}
        />
      )}
    </>
  );
}
