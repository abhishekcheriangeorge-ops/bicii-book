import type { Totals } from "@/lib/domain/lines";
import { formatMoney } from "@/lib/money";

/**
 * A job's running totals (SPEC §22: shown without obscuring the work, a
 * compact summary under the lines, not a modal). Everyone sees the sale
 * total; a view_costs holder also sees cost, yield, Cult Commons and
 * BICII's yield after it, from work_order_totals_staff (the database's
 * arithmetic, D1). `ccRate` labels the Cult Commons row when every line
 * shares one rate.
 */
export function TotalsSummary({ totals, ccRate }: { totals: Totals; ccRate?: string | null }) {
  const money = (v: string) => formatMoney(v, totals.currency);
  const rows: { label: string; value: string; strong?: boolean }[] = [
    { label: "Total", value: money(totals.saleTotal), strong: true },
  ];
  if (totals.costs) {
    const percent = ccRate ? ` (${Number((Number(ccRate) * 100).toFixed(2))}%)` : "";
    rows.push(
      { label: "Cost", value: money(totals.costs.costTotal) },
      { label: "Yield", value: money(totals.costs.yieldTotal) },
      { label: `Cult Commons${percent}`, value: money(totals.costs.ccShare) },
      { label: "BICII yield after Cult Commons", value: money(totals.costs.yieldAfterCc) },
    );
  }
  return (
    <dl
      aria-label="Totals"
      className="flex flex-col gap-1 border-t border-hairline bg-sunken px-4 py-3 text-dense tabular-nums sm:px-5"
    >
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-4">
          <dt className={r.strong ? "text-sm font-semibold" : "text-dust-700"}>{r.label}</dt>
          <dd className={r.strong ? "text-lg font-bold" : "font-medium"}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
