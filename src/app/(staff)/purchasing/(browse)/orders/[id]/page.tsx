import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  CancelOrderControl,
  SubmitOrderButton,
} from "@/components/domain/purchasing/purchase-order-actions";
import { AddPurchaseOrderLineButton } from "@/components/domain/purchasing/purchase-order-line-sheet";
import { PurchaseOrderLines } from "@/components/domain/purchasing/purchase-order-lines";
import {
  EditPurchaseOrderButton,
  NewPurchaseOrderButton,
} from "@/components/domain/purchasing/purchase-order-sheet";
import { PurchaseOrderStatusPill } from "@/components/domain/purchasing/purchase-order-status-pill";
import { QuantityProgress } from "@/components/domain/purchasing/quantity-progress";
import { ShortIdLink } from "@/components/domain/short-id";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireStaff } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";
import { getPurchaseOrder } from "@/lib/domain/purchasing";
import { formatMoney } from "@/lib/money";
import { canManagePurchasing, formatExpected } from "@/lib/purchasing";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

export const metadata: Metadata = { title: "Purchase order" };

/**
 * One purchase order (SPEC §14, §21; PLAN D60, D61, D65): the PO number
 * large, the supplier, status, expected date or Overdue, the supplier's
 * reference; Submit (draft), Edit details, Cancel (two steps with a reason)
 * for manage_purchasing; the lines with their progress and, for
 * cost-visible staff only, unit costs, line totals, the totals card and
 * the history. A fully received order is closed: a calm note and "New
 * order for <supplier>" instead of editing.
 */
export default async function PurchaseOrderPage({ params }: PageProps<"/purchasing/orders/[id]">) {
  const staff = await requireStaff();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const po = await getPurchaseOrder(await createClient(), id, staff);
  if (!po) notFound();
  const manage = canManagePurchasing(staff);
  const money = (v: string) => formatMoney(v, po.currency);
  const lineOrder = {
    id: po.id,
    supplierId: po.supplier.id,
    status: po.status,
    currency: po.currency,
    productIds: po.lines.map((l) => l.product.id),
  };

  return (
    <>
      <header className="flex flex-col gap-4 pt-6 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-3">
          <p className="eyebrow text-dust-500">Purchase order</p>
          <h1 className="inline-flex w-fit shrink-0 items-center rounded-xl bg-ink px-3 py-1.5 font-mono text-2xl font-bold tracking-wide whitespace-nowrap text-paper tabular-nums sm:text-3xl">
            {po.poNumber}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <PurchaseOrderStatusPill status={po.status} />
            {po.overdue ? (
              <Badge tone="danger" emphasis="solid">
                Overdue
              </Badge>
            ) : null}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-dust-700">
            <dt className="text-dust-500">Supplier</dt>
            <dd>
              <Link
                href={`/purchasing/suppliers/${po.supplier.id}`}
                className="inline-flex min-h-tap items-center font-semibold text-ink underline underline-offset-4"
              >
                {po.supplier.name}
              </Link>
              {po.supplier.archived ? <Badge className="ml-2">Archived</Badge> : null}
            </dd>
            <dt className="text-dust-500">Expected</dt>
            <dd className={po.overdue ? "font-semibold text-danger-deep" : undefined}>
              {po.expectedAt ? formatExpected(po.expectedAt) : "No date set"}
              {po.overdue ? " (overdue)" : ""}
            </dd>
            {po.supplierReference ? (
              <>
                <dt className="text-dust-500">Their reference</dt>
                <dd className="font-mono">{po.supplierReference}</dd>
              </>
            ) : null}
          </dl>
        </div>
        {manage && (po.flags.canSubmit || po.flags.canEdit || po.flags.canReceive) ? (
          <div className="flex flex-wrap items-center gap-2">
            {po.flags.canSubmit ? (
              <SubmitOrderButton
                purchaseOrderId={po.id}
                poNumber={po.poNumber}
                disabled={po.lines.length === 0}
              />
            ) : null}
            {po.flags.canReceive ? (
              <ButtonLink href={`/purchasing/receive/${po.id}`}>Receive</ButtonLink>
            ) : null}
            {po.flags.canSubmit ? (
              <p className="w-full text-sm text-dust-500 sm:order-last sm:text-right">
                Submit the order before receiving
              </p>
            ) : null}
            {po.flags.canEdit ? (
              <EditPurchaseOrderButton
                order={{
                  id: po.id,
                  supplier: { id: po.supplier.id, name: po.supplier.name },
                  supplierEditable: po.status === "draft",
                  expectedAt: po.expectedAt,
                  supplierReference: po.supplierReference,
                  notes: po.notes,
                }}
              />
            ) : null}
          </div>
        ) : null}
      </header>

      {po.flags.canSubmit && po.lines.length === 0 ? (
        <p className="rounded-xl bg-info-soft p-4 text-info-deep">
          A draft. Add at least one line, then submit it to the supplier.
        </p>
      ) : null}

      {po.status === "received" ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-done-soft p-4 text-done-deep sm:flex-row sm:items-center sm:justify-between">
          <p className="font-medium">
            Fully received
            {po.receivedAt ? ` on ${formatDateTime(po.receivedAt)}` : ""}. Extra or late units go on
            a new order.
          </p>
          {manage && !po.supplier.archived ? (
            <NewPurchaseOrderButton
              supplier={{ id: po.supplier.id, name: po.supplier.name }}
              label={`New order for ${po.supplier.name}`}
              variant="outline"
              size="sm"
            />
          ) : null}
        </div>
      ) : null}

      {po.status === "cancelled" ? (
        <div className="rounded-2xl bg-danger-soft p-4 text-danger-deep">
          <p className="font-medium">
            Cancelled
            {po.cancelledAt ? ` on ${formatDateTime(po.cancelledAt)}` : ""}
            {po.cancelledBy ? ` by ${po.cancelledBy}` : ""}.
            {po.progress.received > 0 ? " Items already received stay in stock." : ""}
          </p>
          {po.cancellationReason ? <p className="mt-1 text-sm">“{po.cancellationReason}”</p> : null}
        </div>
      ) : null}

      <Card
        title="Order lines"
        actions={po.flags.canEdit ? <AddPurchaseOrderLineButton order={lineOrder} /> : null}
      >
        {po.lines.length === 0 ? (
          <p className="text-dust-700">
            No lines yet.{po.flags.canEdit ? " Add the products to order with Add line." : ""}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {po.lines.length > 1 ? (
              <QuantityProgress label="Whole order received" {...po.progress} />
            ) : null}
            <PurchaseOrderLines
              lines={po.lines}
              order={lineOrder}
              orderExpectedAt={po.expectedAt}
              editable={po.flags.canEdit}
              showCosts={po.canSeeCosts}
            />
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {po.totals ? (
          <Card title="Totals" eyebrow="Purchase costs">
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 tabular-nums">
              <dt>Ordered</dt>
              <dd className="text-right font-semibold">{money(po.totals.ordered)}</dd>
              <dt>Received</dt>
              <dd className="text-right">{money(po.totals.received)}</dd>
              <dt>Still to come</dt>
              <dd className="text-right">{money(po.totals.outstanding)}</dd>
            </dl>
          </Card>
        ) : null}

        <Card title="Receipts">
          {po.receipts.length === 0 ? (
            <p className="text-dust-700">Nothing received yet.</p>
          ) : (
            <ul aria-label="Receipts" className="flex flex-col divide-y divide-hairline">
              {po.receipts.map((r) => (
                <li key={r.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold">{formatDateTime(r.receivedAt)}</span>
                    <span className="text-sm text-dust-700">by {r.receivedBy}</span>
                    {r.reference ? (
                      <span className="text-sm text-dust-700">
                        · Delivery note <span className="font-mono">{r.reference}</span>
                      </span>
                    ) : null}
                  </p>
                  <ul className="flex flex-col gap-1 text-dense">
                    {r.lines.map((rl) => (
                      <li key={rl.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-semibold tabular-nums">{rl.quantity} ×</span>
                        <span>{rl.product.name}</span>
                        <ShortIdLink
                          href={`/products/${rl.product.id}`}
                          value={rl.product.shortId}
                        />
                        <span className="text-dust-500">to {rl.location}</span>
                        {rl.costs ? (
                          <span className="ml-auto text-dust-700 tabular-nums">
                            {money(rl.costs.unitCostActual)} each · {money(rl.costs.receivedTotal)}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {r.notes ? (
                    <p className="text-sm whitespace-pre-line text-dust-700">{r.notes}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Details">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-dust-500">Created</dt>
            <dd>
              {formatDateTime(po.createdAt)}
              {po.createdBy ? ` by ${po.createdBy}` : ""}
            </dd>
            {po.submittedAt ? (
              <>
                <dt className="text-dust-500">Submitted</dt>
                <dd>
                  {formatDateTime(po.submittedAt)}
                  {po.submittedBy ? ` by ${po.submittedBy}` : ""}
                </dd>
              </>
            ) : null}
            <dt className="text-dust-500">Currency</dt>
            <dd>{po.currency}</dd>
          </dl>
          {po.notes ? <p className="mt-3 whitespace-pre-line text-dust-700">{po.notes}</p> : null}
        </Card>

        {po.history ? (
          <Card title="History" eyebrow="Staff with purchase cost access">
            {po.history.length === 0 ? (
              <p className="text-dust-700">Nothing recorded yet.</p>
            ) : (
              <ol aria-label="Order history" className="flex flex-col gap-3">
                {po.history.map((h) => (
                  <li key={h.id} className="flex flex-col gap-0.5">
                    <span>{h.text}</span>
                    {h.reason ? <span className="text-sm text-dust-700">“{h.reason}”</span> : null}
                    <time dateTime={h.at} className="text-sm text-dust-500">
                      {formatDateTime(h.at)}
                    </time>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        ) : null}
      </div>

      {po.flags.canCancel ? (
        <Card title="Cancel order">
          <CancelOrderControl
            purchaseOrderId={po.id}
            poNumber={po.poNumber}
            received={po.progress.received}
          />
        </Card>
      ) : null}
    </>
  );
}
