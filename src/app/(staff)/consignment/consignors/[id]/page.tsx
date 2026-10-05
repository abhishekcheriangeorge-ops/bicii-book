import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ArchiveControl } from "@/components/domain/archive-control";
import { ConsignmentItemRow } from "@/components/domain/consignment-item-row";
import { ReceiveItemButton } from "@/components/domain/consignment-intake-sheet";
import { PayoutDetailsReveal } from "@/components/domain/consignment-item-controls";
import { EditConsignorButton } from "@/components/domain/consignor-sheet";
import {
  RecordPaymentButton,
  ReverseSettlementControl,
} from "@/components/domain/settlement-sheet";
import { ShortId } from "@/components/domain/short-id";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { RowList } from "@/components/ui/row-list";
import { StatusPill } from "@/components/ui/status-pill";
import { canViewConsignmentMoney, hasPermission } from "@/lib/auth/permissions";
import { requireStaff } from "@/lib/auth/session";
import {
  OVERPAID_REMEDIES,
  consignmentStatusPill,
  outstandingLabel,
  outstandingTone,
  remainingLabel,
} from "@/lib/consignment";
import { formatDate } from "@/lib/dates";
import { getConsignor, type StatementRow } from "@/lib/domain/consignment";
import { formatMoney, toDecimal } from "@/lib/money";
import { mailtoHref, telHref } from "@/lib/people";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

import { loadIntakeContext } from "../../intake-context";

export const metadata: Metadata = { title: "Consignor" };

const positive = (v: string | null) => v !== null && toDecimal(v).greaterThan(0);

/**
 * One consignor (SPEC §13, §21): how to reach them, their customer record
 * when linked, and their items in three groups (Awaiting payment, For
 * sale, Settled and returned). For staff who may see consignment money
 * (manage_consignments or view_costs, D48): the balance (owed, paid,
 * outstanding; never "credit", D46) and the payments with their
 * allocations and reversals. Recording or reversing a payment, payout
 * details, Receive item, Edit and Archive need manage_consignments.
 * Archiving needs no item for sale and a balance of exactly 0 (D47); the
 * refusal says so.
 */
export default async function ConsignorPage({ params }: PageProps<"/consignment/consignors/[id]">) {
  const staff = await requireStaff();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const manage = hasPermission(staff, "manage_consignments");
  const money = canViewConsignmentMoney(staff);
  const supabase = await createClient();
  const [consignor, intake] = await Promise.all([
    getConsignor(supabase, id, { canSeeMoney: money }),
    manage ? loadIntakeContext(supabase, staff) : Promise.resolve(null),
  ]);
  if (!consignor) notFound();
  const archived = consignor.archivedAt !== null;
  const currency = consignor.currency;
  const fmt = (v: string) => formatMoney(v, currency);
  const tel = telHref(consignor.phone);
  const mailto = mailtoHref(consignor.email);

  // Money users see what is owed; everyone else sees what sold (D48).
  const awaiting = consignor.items.filter((i) =>
    money ? positive(i.outstanding) : i.status === "sold",
  );
  const forSale = consignor.items.filter((i) => i.status === "active" && !awaiting.includes(i));
  const done = consignor.items.filter((i) => !awaiting.includes(i) && !forSale.includes(i));
  const totals = consignor.totals;

  return (
    <>
      <PageHeader
        eyebrow="Consignor"
        title={consignor.name}
        description={`Consignor since ${formatDate(consignor.createdAt)}`}
        actions={
          <>
            {archived ? <Badge tone="waiting">Archived</Badge> : null}
            {manage ? (
              <EditConsignorButton
                consignor={{
                  id: consignor.id,
                  name: consignor.name,
                  phone: consignor.phone,
                  email: consignor.email,
                  customer: consignor.customer,
                  internalNotes: consignor.internalNotes,
                }}
              />
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Contact">
          <div className="flex flex-col gap-3">
            {consignor.customer ? (
              <Link
                href={`/customers/${consignor.customer.id}`}
                className="inline-flex min-h-tap items-center font-medium underline"
              >
                Customer record →
              </Link>
            ) : null}
            {consignor.phone ? (
              tel ? (
                <a href={tel} className="flex min-h-tap flex-col hover:underline">
                  <span className="eyebrow text-dust-500">Phone · tap to call</span>
                  <span className="text-lg font-medium tabular-nums">{consignor.phone}</span>
                </a>
              ) : (
                <p>{consignor.phone}</p>
              )
            ) : null}
            {consignor.email ? (
              mailto ? (
                <a href={mailto} className="flex min-h-tap flex-col break-all hover:underline">
                  <span className="eyebrow text-dust-500">Email</span>
                  <span className="text-lg font-medium">{consignor.email}</span>
                </a>
              ) : (
                <p>{consignor.email}</p>
              )
            ) : null}
            {!consignor.phone && !consignor.email ? (
              <p className="text-dust-700">No phone number or email on file.</p>
            ) : null}
            {manage ? <PayoutDetailsReveal consignorId={consignor.id} /> : null}
            {consignor.internalNotes ? (
              <p className="whitespace-pre-line text-dust-700">{consignor.internalNotes}</p>
            ) : null}
          </div>
        </Card>

        {money && totals ? (
          <Card
            title="Balance"
            actions={
              manage && !archived && consignor.items.length > 0 ? (
                <RecordPaymentButton
                  consignorId={consignor.id}
                  consignorName={consignor.name}
                  currency={currency}
                  items={consignor.items.map((i) => ({
                    id: i.itemId,
                    shortId: i.shortId,
                    name: i.productName,
                    outstanding: i.outstanding ?? "0.00",
                    lastSaleAt: i.lastSaleAt,
                  }))}
                />
              ) : null
            }
          >
            <dl
              aria-label="Balance"
              className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 tabular-nums"
            >
              <dt>Owed</dt>
              <dd className="text-right">{fmt(totals.owed)}</dd>
              <dt>Paid</dt>
              <dd className="text-right">{fmt(totals.paid)}</dd>
              <dt className="border-t border-hairline pt-2 font-semibold">Outstanding</dt>
              <dd className="border-t border-hairline pt-2 text-right font-bold">
                {fmt(totals.outstanding)}
              </dd>
            </dl>
            <div className="mt-3 flex flex-col gap-2">
              <StatusPill status={outstandingTone(totals.outstanding)}>
                {outstandingLabel(totals.outstanding, currency)}
              </StatusPill>
              {positive(totals.consignorCharges) ? (
                <p className="text-sm text-dust-700">
                  Owed includes {fmt(totals.consignorCharges)} deducted for consignor-paid work.
                </p>
              ) : null}
              {toDecimal(totals.outstanding).isNegative() ? (
                <p className="text-sm text-dust-700">{OVERPAID_REMEDIES}</p>
              ) : null}
            </div>
          </Card>
        ) : null}
      </div>

      <Card
        title="Items"
        actions={
          manage && intake && !archived ? (
            <ReceiveItemButton
              context={intake}
              presetConsignor={{ id: consignor.id, label: consignor.name }}
              variant="outline"
            />
          ) : null
        }
      >
        {consignor.items.length === 0 ? (
          <p className="text-dust-700">No items from {consignor.name} yet.</p>
        ) : (
          <div className="flex flex-col gap-5">
            <ItemGroup
              title={money ? "Awaiting payment" : "Sold"}
              items={awaiting}
              money={money}
              currency={currency}
            />
            <ItemGroup title="For sale" items={forSale} money={money} currency={currency} />
            <ItemGroup
              title={money ? "Settled and returned" : "Returned"}
              items={done}
              money={money}
              currency={currency}
            />
          </div>
        )}
      </Card>

      {money && consignor.settlements ? (
        <Card title="Payments">
          {consignor.settlements.length === 0 ? (
            <p className="text-dust-700">No payments to {consignor.name} yet.</p>
          ) : (
            <ul
              aria-label="Payments"
              className="-mx-4 flex flex-col divide-y divide-hairline sm:-mx-5"
            >
              {consignor.settlements.map((s) => {
                const label = `the ${formatMoney(s.amount, s.currency)} payment of ${formatDate(s.paidAt)}`;
                return (
                  <li key={s.id} className="flex flex-col gap-2 px-4 py-3 sm:px-5">
                    <div
                      className={
                        s.reversal
                          ? "flex flex-wrap items-baseline gap-x-3 text-dust-500 line-through"
                          : "flex flex-wrap items-baseline gap-x-3"
                      }
                    >
                      <time dateTime={s.paidAt} className="text-sm">
                        {formatDate(s.paidAt)}
                      </time>
                      <span className="font-semibold tabular-nums">
                        {formatMoney(s.amount, s.currency)}
                      </span>
                      {s.reference ? <span className="text-sm">{s.reference}</span> : null}
                    </div>
                    <ul className="flex flex-wrap gap-2 text-sm">
                      {s.lines.map((l) => (
                        <li key={l.itemId} className="flex flex-col">
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <ShortId value={l.shortId} /> {formatMoney(l.amount, s.currency)}
                          </span>
                          {l.overrideReason ? (
                            <span className="text-dust-700">
                              Above what was owed: {l.overrideReason}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    {s.notes ? <p className="text-sm text-dust-700">{s.notes}</p> : null}
                    {s.reversal ? (
                      <p className="text-sm text-danger-deep">
                        Reversed: {s.reversal.reason}
                        {s.reversal.byName ? ` · ${s.reversal.byName}` : ""} ·{" "}
                        {formatDate(s.reversal.at)}
                      </p>
                    ) : manage && !archived ? (
                      <ReverseSettlementControl settlementId={s.id} label={label} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ) : null}

      {manage ? (
        <Card title="Archive">
          <ArchiveControl
            kind="consignor"
            id={consignor.id}
            name={consignor.name}
            archived={archived}
          />
        </Card>
      ) : null}
    </>
  );
}

function ItemGroup({
  title,
  items,
  money,
  currency,
}: {
  title: string;
  items: StatementRow[];
  money: boolean;
  currency: string;
}) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-display text-xs font-bold tracking-wide text-dust-700 uppercase">
        {title}
      </h3>
      <RowList label={title}>
        {items.map((i) => {
          const pill = consignmentStatusPill(i.status, money ? i.outstanding : null);
          const quantityItem = i.unitId === null;
          return (
            <ConsignmentItemRow
              key={i.itemId}
              href={`/consignment/items/${i.itemId}`}
              shortId={i.shortId}
              name={i.productName}
              pill={pill}
              details={[
                quantityItem ? remainingLabel(i.remainingQty, i.quantity) : null,
                i.askingPrice !== null ? `Asking ${formatMoney(i.askingPrice, currency)}` : null,
              ]}
              amount={
                money && positive(i.outstanding) ? formatMoney(i.outstanding!, currency) : null
              }
            />
          );
        })}
      </RowList>
    </section>
  );
}
