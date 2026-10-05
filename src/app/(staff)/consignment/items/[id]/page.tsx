import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AddChargeButton, VoidChargeControl } from "@/components/domain/charge-sheet";
import {
  EditTermsButton,
  ReturnToConsignorControl,
} from "@/components/domain/consignment-item-controls";
import { PhotoGrid } from "@/components/domain/photo-grid";
import { RecordSaleButton } from "@/components/domain/record-sale-sheet";
import { ShortId, ShortIdLink } from "@/components/domain/short-id";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { canViewConsignmentMoney, canViewSaleCosts, hasPermission } from "@/lib/auth/permissions";
import { requireStaff } from "@/lib/auth/session";
import {
  CHARGE_BEARER_LABELS,
  OVERPAID_REMEDIES,
  SHOP_CHARGE_UNIQUE_ONLY,
  consignmentStatusPill,
  describeConsignmentEvent,
  outstandingLabel,
  remainingLabel,
} from "@/lib/consignment";
import { lineEconomics } from "@/lib/cult-commons";
import { formatDate, formatDateTime } from "@/lib/dates";
import { getConsignmentItem } from "@/lib/domain/consignment";
import { currentCultCommonsRate } from "@/lib/domain/services";
import { unitStatusLabel } from "@/lib/inventory";
import { formatMoney, sumMoney, toDecimal } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

export const metadata: Metadata = { title: "Consignment item" };

/**
 * One consignment item (SPEC §13, §21): its C- number large, the product,
 * its status, and links to the consignor, the unit or product and the
 * linked bike (D51). Facts for everyone: received, asking price, where it
 * is, quantities for a quantity item, and the sales and jobs that took it
 * (D44). For consignment money users (D48): the money card (agreed amount,
 * charges, liability, owed, paid, outstanding; a labelled yield preview
 * for view_costs while it is for sale), the charges and the history.
 * Listing photos live on the product (they may be public, D26); agreement
 * photos are internal only (D52) and shown to money users, since they
 * carry the terms. Edit terms, Add charge, Void and Return to consignor
 * need manage_consignments. Sell (any staff, D48) opens the sale sheet
 * preset with this item while it is for sale with stock left: the unit,
 * or this consignment of the product (D45); its sales link to their pages.
 */
export default async function ConsignmentItemPage({
  params,
}: PageProps<"/consignment/items/[id]">) {
  const staff = await requireStaff();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const manage = hasPermission(staff, "manage_consignments");
  const money = canViewConsignmentMoney(staff);
  const costs = canViewSaleCosts(staff);
  const supabase = await createClient();
  const [item, rate] = await Promise.all([
    getConsignmentItem(supabase, id, { canSeeMoney: money }),
    costs ? currentCultCommonsRate(supabase) : Promise.resolve(null),
  ]);
  if (!item) notFound();
  const st = item.statement;
  const fmt = (v: string) => formatMoney(v, item.currency);
  const active = item.status === "active";
  const unique = item.trackingType === "unique";
  const pill = consignmentStatusPill(item.status, money ? st.outstanding : null);

  // D45: the shop bears a charge only on a single item that is still available.
  const shopBlocked = !unique
    ? SHOP_CHARGE_UNIQUE_ONLY
    : item.unit?.status !== "available"
      ? "The shop can no longer bear a charge: the item is on a job or sold, so its cost is already fixed."
      : null;

  // Labelled preview (view_costs): the line if it sold at the asking price,
  // with the cost add_inventory_line or a sale would snapshot (D44: agreed
  // amount plus shop-paid charges).
  const unitCost =
    st.agreedAmountOwed !== null
      ? sumMoney([st.agreedAmountOwed, unique ? (st.shopCharges ?? "0") : "0"])
      : null;
  const preview =
    active && costs && rate && unitCost && item.askingPrice !== null
      ? lineEconomics({
          quantity: 1,
          unitSalePrice: item.askingPrice,
          unitDirectCost: unitCost,
          rate,
        })
      : null;

  const sellable = active && (unique ? item.unit?.status === "available" : st.remainingQty > 0);
  const liveJobs = item.jobs.filter((j) => !j.voided);
  const liveSales = item.sales.filter((s) => !s.voided);

  return (
    <>
      <header className="flex flex-col gap-4 pt-6 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <ShortId value={item.shortId} large />
            <StatusPill status={pill.tone}>{pill.label}</StatusPill>
          </div>
          <h1 className="text-3xl break-words sm:text-4xl">{item.product.name}</h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-dust-700">
            <span>
              Consigned by{" "}
              <Link
                href={`/consignment/consignors/${item.consignor.id}`}
                className="font-medium underline"
              >
                {item.consignor.name}
              </Link>
            </span>
            {item.unit ? (
              <ShortIdLink href={`/units/${item.unit.id}`} value={item.unit.shortId} />
            ) : (
              <ShortIdLink href={`/products/${item.product.id}`} value={item.product.shortId} />
            )}
            {item.bike ? (
              <ShortIdLink href={`/bikes/${item.bike.id}`} value={item.bike.shortId} />
            ) : null}
          </p>
        </div>
        {sellable || (manage && active && st.agreedAmountOwed !== null) ? (
          <div className="flex flex-wrap items-center gap-2">
            {sellable ? (
              <RecordSaleButton
                label="Sell"
                viewCosts={costs}
                preset={
                  unique && item.unit
                    ? { q: item.unit.shortId, unitId: item.unit.id }
                    : {
                        q: item.shortId,
                        productId: item.product.id,
                        consignmentItemId: item.id,
                      }
                }
              />
            ) : null}
            {manage && active && st.agreedAmountOwed !== null ? (
              <EditTermsButton
                itemId={item.id}
                agreedAmountOwed={st.agreedAmountOwed}
                askingPrice={item.askingPrice}
              />
            ) : null}
          </div>
        ) : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Details">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
            <dt className="text-sm text-dust-500">Received</dt>
            <dd>
              <time dateTime={item.receivedAt}>{formatDate(item.receivedAt)}</time>
            </dd>
            <dt className="text-sm text-dust-500">Asking price</dt>
            <dd className="tabular-nums">
              {item.askingPrice !== null ? fmt(item.askingPrice) : "Not set"}
              {unique ? "" : " each"}
            </dd>
            {item.unit ? (
              <>
                <dt className="text-sm text-dust-500">Unit</dt>
                <dd>
                  <Link href={`/units/${item.unit.id}`} className="underline">
                    {item.unit.shortId}
                  </Link>{" "}
                  · {unitStatusLabel(item.unit.status)}
                </dd>
                <dt className="text-sm text-dust-500">Location</dt>
                <dd>{item.unit.location.name}</dd>
                {item.unit.serialNumber ? (
                  <>
                    <dt className="text-sm text-dust-500">Serial number</dt>
                    <dd className="font-mono break-all">{item.unit.serialNumber}</dd>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <dt className="text-sm text-dust-500">Quantity</dt>
                <dd className="tabular-nums">{item.quantity}</dd>
                <dt className="text-sm text-dust-500">Sold</dt>
                <dd className="tabular-nums">{st.soldQty - st.restockedQty}</dd>
                <dt className="text-sm text-dust-500">On jobs</dt>
                <dd className="tabular-nums">{st.jobHeldQty + st.jobSoldQty}</dd>
                <dt className="text-sm text-dust-500">Returned</dt>
                <dd className="tabular-nums">{st.returnedQty}</dd>
                <dt className="text-sm text-dust-500">Remaining</dt>
                <dd className="font-semibold">{remainingLabel(st.remainingQty, item.quantity)}</dd>
              </>
            )}
            {item.bike ? (
              <>
                <dt className="text-sm text-dust-500">Bike</dt>
                <dd>
                  <Link href={`/bikes/${item.bike.id}`} className="underline">
                    {item.bike.shortId} {item.bike.title}
                  </Link>
                </dd>
              </>
            ) : null}
            {item.returnedAt ? (
              <>
                <dt className="text-sm text-dust-500">Returned</dt>
                <dd>
                  <time dateTime={item.returnedAt}>{formatDate(item.returnedAt)}</time>
                  {item.returnReason ? ` · ${item.returnReason}` : ""}
                </dd>
              </>
            ) : null}
          </dl>
          {liveSales.length > 0 || liveJobs.length > 0 ? (
            <div className="mt-4 flex flex-col gap-2">
              <h3 className="font-display text-xs font-bold tracking-wide uppercase">
                Sold through
              </h3>
              <ul className="flex flex-col gap-1 text-sm">
                {liveJobs.map((j) => (
                  <li key={j.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`/jobs/${j.jobId}`} className="font-medium underline">
                      Job {j.jobNumber}
                    </Link>
                    <span className="text-dust-700">
                      {j.quantity} × {fmt(j.unitPrice)} ·{" "}
                      {j.completed ? "completed" : "open: held for the job"}
                    </span>
                  </li>
                ))}
                {liveSales.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`/sales/${s.saleId}`} className="font-medium underline">
                      Sale {s.saleNumber}
                    </Link>
                    <span className="text-dust-700">
                      {s.quantity} × {fmt(s.unitPrice)}
                      {s.restocked ? " · restocked" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {item.agreementNotes || item.internalNotes ? (
            <div className="mt-4 flex flex-col gap-2">
              {item.agreementNotes ? (
                <>
                  <h3 className="font-display text-xs font-bold tracking-wide uppercase">
                    Agreement notes
                  </h3>
                  <p className="whitespace-pre-line text-dust-700">{item.agreementNotes}</p>
                </>
              ) : null}
              {item.internalNotes ? (
                <>
                  <h3 className="font-display text-xs font-bold tracking-wide uppercase">
                    Internal notes
                  </h3>
                  <p className="whitespace-pre-line text-dust-700">{item.internalNotes}</p>
                </>
              ) : null}
            </div>
          ) : null}
        </Card>

        {money && st.agreedAmountOwed !== null ? (
          <Card title="Money" eyebrow="Staff who manage consignments or view costs">
            <dl
              aria-label="Consignment money"
              className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 tabular-nums"
            >
              <dt>
                Agreed amount owed{unique ? "" : " each"}
                <span className="block text-sm text-dust-500">
                  What we pay the consignor when it sells. It is the cost of the sale.
                </span>
              </dt>
              <dd className="text-right">{fmt(st.agreedAmountOwed)}</dd>
              {st.shopCharges !== null && toDecimal(st.shopCharges).greaterThan(0) ? (
                <>
                  <dt>Shop-paid charges</dt>
                  <dd className="text-right">{fmt(st.shopCharges)}</dd>
                </>
              ) : null}
              <dt>Liability (sold)</dt>
              <dd className="text-right">{fmt(st.liability ?? "0")}</dd>
              {st.consignorCharges !== null && toDecimal(st.consignorCharges).greaterThan(0) ? (
                <>
                  <dt>Consignor-paid charges</dt>
                  <dd className="text-right">−{fmt(st.consignorCharges)}</dd>
                </>
              ) : null}
              <dt>Owed</dt>
              <dd className="text-right">{fmt(st.owed ?? "0")}</dd>
              <dt>Paid</dt>
              <dd className="text-right">{fmt(st.paid ?? "0")}</dd>
              <dt className="border-t border-hairline pt-2 font-semibold">Outstanding</dt>
              <dd className="border-t border-hairline pt-2 text-right font-bold">
                {fmt(st.outstanding ?? "0")}
              </dd>
            </dl>
            {st.outstanding !== null ? (
              <p className="mt-2 text-sm text-dust-700">
                {outstandingLabel(st.outstanding, item.currency)}
                {toDecimal(st.outstanding).isNegative() ? `. ${OVERPAID_REMEDIES}` : ""}
              </p>
            ) : null}
            {preview ? (
              <p
                role="note"
                className="mt-3 rounded-xl bg-sunken px-4 py-3 text-sm text-dust-700 tabular-nums"
              >
                If it sells at the asking price: yield {fmt(preview.yield.toFixed(2))} · Cult
                Commons {fmt(preview.ccShare.toFixed(2))} · BICII keeps{" "}
                {fmt(preview.yieldAfterCc.toFixed(2))}
              </p>
            ) : null}
          </Card>
        ) : null}
      </div>

      {money && item.charges ? (
        <Card
          title="Charges"
          actions={
            manage && active ? <AddChargeButton itemId={item.id} shopBlocked={shopBlocked} /> : null
          }
        >
          {item.charges.length === 0 ? (
            <p className="text-dust-700">No charges on this item.</p>
          ) : (
            <ul
              aria-label="Charges"
              className="-mx-4 flex flex-col divide-y divide-hairline sm:-mx-5"
            >
              {item.charges.map((c) => (
                <li key={c.id} className="flex flex-col gap-2 px-4 py-3 sm:px-5">
                  <div
                    className={
                      c.voided
                        ? "flex flex-wrap items-center gap-2 text-dust-500 line-through"
                        : "flex flex-wrap items-center gap-2"
                    }
                  >
                    <span className="font-medium">{c.description}</span>
                    <span className="tabular-nums">{formatMoney(c.amount, c.currency)}</span>
                    <Badge tone={c.bearer === "shop" ? "progress" : "neutral"}>
                      {CHARGE_BEARER_LABELS[c.bearer]}
                    </Badge>
                  </div>
                  {c.voided ? (
                    <p className="text-sm text-danger-deep">
                      Voided {formatDateTime(c.voided.at)}
                      {c.voided.byName ? ` by ${c.voided.byName}` : ""}
                      {c.voided.reason ? `: “${c.voided.reason}”` : ""}
                    </p>
                  ) : manage ? (
                    <VoidChargeControl chargeId={c.id} description={c.description} />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <Card title="Listing photos" eyebrow={`On ${item.product.shortId}: public once published`}>
        <PhotoGrid
          target={{ entityType: "product", entityId: item.product.id }}
          photos={item.listingPhotos}
        />
      </Card>

      <Card title="Agreement photos" eyebrow="Internal only">
        {item.agreementPhotos ? (
          <PhotoGrid
            target={{ entityType: "consignment_item", entityId: item.id }}
            photos={item.agreementPhotos}
          />
        ) : (
          <p className="text-dust-700">
            The signed agreement shows the consignor&apos;s terms, so only staff who manage
            consignments or view costs see these photos.
          </p>
        )}
      </Card>

      {manage && active ? (
        <Card title="Return to consignor">
          <p className="mb-3 text-dust-700">
            {unique
              ? "Give the item back to its consignor. It leaves stock; nothing is owed for it."
              : "Give some or all of what is left back to the consignor. It leaves stock; nothing is owed for it."}
          </p>
          <ReturnToConsignorControl
            itemId={item.id}
            shortId={item.shortId}
            unique={unique}
            remaining={st.remainingQty}
            locations={item.stock}
          />
        </Card>
      ) : null}

      {money && item.events ? (
        <Card title="History">
          {item.events.length === 0 ? (
            <p className="text-dust-700">Nothing recorded yet.</p>
          ) : (
            <ol aria-label="Timeline" className="flex flex-col gap-3">
              {item.events.map((e) => {
                const d = describeConsignmentEvent(e.type, e.payload, item.currency);
                return (
                  <li key={e.id} className="flex flex-col">
                    <span className="font-medium">{d.title}</span>
                    {d.detail ? <span className="text-sm text-dust-700">{d.detail}</span> : null}
                    {e.reason ? <span className="text-sm text-dust-700">“{e.reason}”</span> : null}
                    <span className="text-sm text-dust-500">
                      <time dateTime={e.at}>{formatDateTime(e.at)}</time>
                      {e.actorName ? ` · ${e.actorName}` : ""}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      ) : null}
    </>
  );
}
