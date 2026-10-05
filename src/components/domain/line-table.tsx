"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/dates";
import type { Line } from "@/lib/domain/lines";
import { formatMoney, formatQuantity } from "@/lib/money";

import { VoidLineControl } from "./void-line-control";

/**
 * When the table shows its columns, by the width of its own container (a
 * card's width, not the screen's: on an iPad the lines card is about 520px
 * wide). Four sale columns need 28rem; with the three cost columns, 42rem.
 * Narrower, each line is one stacked row. Static strings for Tailwind.
 */
const LAYOUT = {
  sale: {
    head: "hidden @md:table-header-group",
    cell: "hidden @md:table-cell",
    stacked: "@md:hidden",
    total: "@md:pr-3",
  },
  costs: {
    head: "hidden @2xl:table-header-group",
    cell: "hidden @2xl:table-cell",
    stacked: "@2xl:hidden",
    total: "@2xl:pr-3",
  },
} as const;
type Layout = (typeof LAYOUT)[keyof typeof LAYOUT];

/**
 * A job's lines (SPEC §9, §22): a dense table (description, quantity, unit
 * price, line total; with view_costs also unit cost, yield and Cult
 * Commons per line). On phones each line is one stacked row: quantity and
 * price under the description, the total on the right. Voided lines are
 * kept, struck through with who, when and why, behind "Show voided". Lines
 * of someone without view_costs carry no cost figures at all (the DTO has
 * none), so there is nothing to hide here. A manual line added without a
 * cost carries a "Cost pending" badge for everyone (D14): its placeholder 0
 * is not a real cost, and only someone with cost access can fix it.
 */
export function LineTable({
  lines,
  viewCosts,
  canVoid,
}: {
  lines: Line[];
  viewCosts: boolean;
  /** The job is open (D15): lines can be voided. */
  canVoid: boolean;
}) {
  const [showVoided, setShowVoided] = useState(false);
  const voidedCount = lines.filter((l) => l.voided).length;
  const shown = showVoided ? lines : lines.filter((l) => !l.voided);
  const costs = viewCosts && lines.some((l) => l.costs);
  const layout = costs ? LAYOUT.costs : LAYOUT.sale;

  return (
    <div className="flex flex-col gap-3">
      {shown.length === 0 ? (
        <p className="px-4 text-dust-500 sm:px-5">
          {lines.length === 0
            ? "No lines yet. Add a service or a manual line."
            : "Every line is voided."}
        </p>
      ) : (
        <div className="@container">
          <table className="w-full text-dense tabular-nums">
            <caption className="sr-only">Lines</caption>
            <thead className={cn("border-b border-hairline bg-sunken text-left", layout.head)}>
              <tr>
                <th scope="col" className="py-2 pr-3 pl-5 font-semibold">
                  Description
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  Qty
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  Unit price
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  Total
                </th>
                {costs ? (
                  <>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      Unit cost
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      Yield
                    </th>
                    <th scope="col" className="py-2 pr-5 pl-3 text-right font-semibold">
                      Cult Commons
                    </th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {shown.map((line) => (
                <LineRow
                  key={line.id}
                  line={line}
                  costs={costs}
                  layout={layout}
                  canVoid={canVoid && !line.voided}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {voidedCount > 0 ? (
        <div className="px-4 sm:px-5">
          <button
            type="button"
            aria-pressed={showVoided}
            onClick={() => setShowVoided((v) => !v)}
            className="min-h-tap cursor-pointer rounded-full px-1 text-sm font-medium underline"
          >
            {showVoided ? "Hide voided" : `Show voided (${voidedCount})`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function LineRow({
  line,
  costs,
  layout,
  canVoid,
}: {
  line: Line;
  costs: boolean;
  layout: Layout;
  canVoid: boolean;
}) {
  const money = (v: string) => formatMoney(v, line.currency);
  const struck = line.voided ? "text-dust-500 line-through" : undefined;
  return (
    <tr className="align-top">
      <td className="py-3 pr-3 pl-4 sm:pl-5">
        <div className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className={cn("text-sm font-medium", struck)}>{line.description}</span>
            {line.costPending && !line.voided ? <Badge tone="waiting">Cost pending</Badge> : null}
          </span>
          <span className={cn("text-dust-500", layout.stacked, struck)}>
            {formatQuantity(line.quantity)} × {money(line.unitSalePrice)}
          </span>
          {line.costs ? (
            <span className={cn("text-dust-500", layout.stacked, struck)}>
              Cost {money(line.costs.costTotal)} · Yield {money(line.costs.yieldTotal)} · Cult
              Commons {money(line.costs.ccShare)}
            </span>
          ) : null}
          {line.voided ? (
            <span className="text-danger-deep">
              Voided {formatDateTime(line.voided.at)}
              {line.voided.byName ? ` by ${line.voided.byName}` : ""}
              {line.voided.reason ? `: “${line.voided.reason}”` : ""}
            </span>
          ) : null}
          {canVoid ? <VoidLineControl lineId={line.id} description={line.description} /> : null}
        </div>
      </td>
      <td className={cn("px-3 py-3 text-right", layout.cell, struck)}>
        {formatQuantity(line.quantity)}
      </td>
      <td className={cn("px-3 py-3 text-right", layout.cell, struck)}>
        {money(line.unitSalePrice)}
      </td>
      <td className={cn("py-3 pr-4 pl-3 text-right font-semibold sm:pr-5", layout.total, struck)}>
        {money(line.saleTotal)}
      </td>
      {costs ? (
        <>
          <td className={cn("px-3 py-3 text-right", layout.cell, struck)}>
            {line.costs ? (line.costPending ? "—" : money(line.costs.unitDirectCost)) : ""}
          </td>
          <td className={cn("px-3 py-3 text-right", layout.cell, struck)}>
            {line.costs ? money(line.costs.yieldTotal) : ""}
          </td>
          <td className={cn("py-3 pr-5 pl-3 text-right", layout.cell, struck)}>
            {line.costs ? money(line.costs.ccShare) : ""}
          </td>
        </>
      ) : null}
    </tr>
  );
}
