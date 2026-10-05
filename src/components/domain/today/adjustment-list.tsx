import { ShortIdLink } from "@/components/domain/short-id";
import { Badge } from "@/components/ui/badge";
import { formatTime } from "@/lib/dates";
import { signedQuantity } from "@/lib/inventory";
import { formatMoney } from "@/lib/money";
import { splitAdjustments, type AdjustmentRow } from "@/lib/reports";

/**
 * The day's stock adjustments and damaged stock (server): significant ones
 * first, then newest first; the first few listed and the rest behind a
 * "Show N more" disclosure (no JavaScript), so an opening stock count does
 * not push "Needs attention" screens down. Each row: the product's P-
 * number (linked), the signed change, the reason, who and when, a
 * "Significant" badge (D33, shown to everyone) and the value at cost only
 * when the database returned it (view_costs, D30).
 */
export function AdjustmentList({ rows }: { rows: readonly AdjustmentRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-dust-500">No adjustments.</p>;
  const { shown, more } = splitAdjustments(rows);
  return (
    <div className="flex flex-col gap-1">
      <ul aria-label="Stock adjustments" className="flex flex-col divide-y divide-hairline">
        {shown.map((r) => (
          <AdjustmentItem key={r.movementId} row={r} />
        ))}
      </ul>
      {more.length > 0 ? (
        <details className="group rounded-xl border border-hairline">
          <summary className="flex min-h-tap cursor-pointer items-center px-3 text-sm font-semibold focus-inset">
            <span className="group-open:hidden">Show {more.length} more</span>
            <span className="hidden group-open:inline">Show fewer</span>
          </summary>
          <ul
            aria-label="More stock adjustments"
            className="flex flex-col divide-y divide-hairline border-t border-hairline px-3"
          >
            {more.map((r) => (
              <AdjustmentItem key={r.movementId} row={r} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function AdjustmentItem({ row: r }: { row: AdjustmentRow }) {
  return (
    <li className="flex items-start gap-3 py-2">
      <span
        className={
          r.quantityDelta < 0
            ? "w-12 shrink-0 font-semibold text-danger-deep tabular-nums"
            : "w-12 shrink-0 font-semibold text-done-deep tabular-nums"
        }
      >
        {signedQuantity(r.quantityDelta)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <ShortIdLink href={`/products/${r.productId}`} value={r.productShortId} />
          <span className="text-sm font-medium">{r.productName}</span>
          {r.significant ? <Badge tone="waiting">Significant</Badge> : null}
        </div>
        {r.reason ? <p className="text-sm">“{r.reason}”</p> : null}
        <p className="text-sm text-dust-500">
          {r.movementType === "damaged" ? "Damaged" : "Adjustment"} · {r.locationName} ·{" "}
          {r.actorName ?? "Recorded outside the app"} · {formatTime(r.createdAt)}
          {r.valueAtCost !== null ? ` · ${formatMoney(r.valueAtCost, r.currency)} at cost` : ""}
        </p>
      </div>
    </li>
  );
}
