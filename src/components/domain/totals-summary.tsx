import type { Totals } from "@/lib/domain/lines";
import { formatMoney } from "@/lib/money";

/**
 * A job's running totals (SPEC §22: shown without obscuring the work, a
 * compact summary under the lines, not a modal). Everyone sees the sale
 * total; a view_costs holder also sees cost, yield, Cult Commons and
 * BICII's yield after it, from work_order_totals_staff (the database's
 * arithmetic, D1). `ccRate` labels the Cult Commons row when every line
 * shares one rate. While a live manual line has no cost entered (D14) the
 * cost-side figures count it at 0, so they are marked provisional.
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
  const pending = totals.costs?.costPendingCount ?? 0;
  return (
    <div className="flex flex-col border-t border-hairline bg-sunken px-4 py-3 sm:px-5">
      <dl aria-label="Totals" className="flex flex-col gap-1 text-dense tabular-nums">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-4">
            <dt className={r.strong ? "text-sm font-semibold" : "text-dust-700"}>{r.label}</dt>
            <dd className={r.strong ? "text-lg font-bold" : "font-medium"}>{r.value}</dd>
          </div>
        ))}
      </dl>
      {pending > 0 ? (
        <p role="note" className="mt-2 text-sm font-medium text-waiting-deep">
          {pending === 1
            ? "Provisional: 1 line has no cost entered, so cost, yield and Cult Commons count it at 0. Void it and add it again with its cost."
            : `Provisional: ${pending} lines have no cost entered, so cost, yield and Cult Commons count them at 0. Void each and add it again with its cost.`}
        </p>
      ) : null}
    </div>
  );
}
