import Link from "next/link";

import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/dates";
import type { HistoryEntry, Movement } from "@/lib/domain/inventory";
import { movementLabel, signedQuantity } from "@/lib/inventory";
import { formatMoney } from "@/lib/money";

import { ShortId } from "./short-id";

/**
 * Stock movements, newest first (SPEC §12, §23): when (Singapore time),
 * what (movementLabel), the product (linked; the unit too), the signed
 * quantity (green in, red out, tabular), where, who, why, the job (J-
 * link) and the reversal links ("Reverses #12", "Reversed by #15"), which
 * jump to the other row when it is on the page (each row is
 * `#movement-{id}`) and otherwise open the movements list before it. The
 * unit cost only when the DTO carries it (view_costs holders). Server
 * Component.
 */
export function MovementList({
  movements,
  showProduct = true,
  label = "Stock movements",
}: {
  movements: Movement[];
  /** False on a product's own page, where every row is that product. */
  showProduct?: boolean;
  label?: string;
}) {
  const onPage = new Set(movements.map((m) => m.id));
  const anchor = (id: number) =>
    onPage.has(id) ? `#movement-${id}` : `/inventory/movements?before=${id + 1}#movement-${id}`;
  return (
    <ol aria-label={label} className="flex flex-col divide-y divide-hairline">
      {movements.map((m) => {
        const label = movementLabel(m.type, m.quantity, { onJob: m.job !== null });
        return (
          <li
            key={m.id}
            id={`movement-${m.id}`}
            aria-label={`${label} ${signedQuantity(m.quantity)}`}
            className="flex scroll-mt-24 gap-3 py-3 first:pt-0 last:pb-0 target:bg-waiting-soft"
          >
            <span
              className={cn(
                "w-14 shrink-0 text-right text-lg font-bold tabular-nums",
                m.quantity >= 0 ? "text-done-deep" : "text-danger-deep",
              )}
            >
              {signedQuantity(m.quantity)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-base font-medium">{label}</span>
                {m.job ? (
                  <Link href={`/jobs/${m.job.id}`} className="underline-offset-2 hover:underline">
                    <ShortId value={m.job.jobNumber} />
                  </Link>
                ) : null}
                <span className="text-dust-500">#{m.id}</span>
              </span>
              {showProduct ? (
                <span className="flex flex-wrap items-center gap-2">
                  <Link href={`/products/${m.product.id}`} className="font-medium underline">
                    {m.product.name}
                  </Link>
                  <ShortId value={m.product.shortId} />
                  {m.unit ? (
                    <Link
                      href={`/units/${m.unit.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      <ShortId value={m.unit.shortId} />
                    </Link>
                  ) : null}
                </span>
              ) : m.unit ? (
                <span>
                  <Link href={`/units/${m.unit.id}`} className="underline-offset-2 hover:underline">
                    <ShortId value={m.unit.shortId} />
                  </Link>
                </span>
              ) : null}
              <span className="text-dust-700">
                {m.location.name}
                {" · "}
                {m.actorName ?? "Recorded outside the app"}
                {" · "}
                <time dateTime={m.at}>{formatDateTime(m.at)}</time>
              </span>
              {m.reason ? <span className="text-dust-700">“{m.reason}”</span> : null}
              {m.reversesId !== null || m.reversedById !== null ? (
                <span className="flex flex-wrap gap-3">
                  {m.reversesId !== null ? (
                    <a href={anchor(m.reversesId)} className="font-medium underline">
                      Reverses #{m.reversesId}
                    </a>
                  ) : null}
                  {m.reversedById !== null ? (
                    <a href={anchor(m.reversedById)} className="font-medium underline">
                      Reversed by #{m.reversedById}
                    </a>
                  ) : null}
                </span>
              ) : null}
              {m.unitCost !== undefined ? (
                <span className="text-dust-500 tabular-nums">
                  Unit cost {m.unitCost !== null ? formatMoney(m.unitCost, m.currency) : "—"}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** A record's history (product or unit events), newest first. Server Component. */
export function HistoryList({
  entries,
  describe,
}: {
  entries: HistoryEntry[];
  describe: (entry: HistoryEntry) => string;
}) {
  if (entries.length === 0) return <p className="text-dust-500">No history yet.</p>;
  return (
    <ol aria-label="History" className="flex flex-col">
      {entries.map((e, i) => (
        <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
          <span aria-hidden="true" className="flex flex-col items-center">
            <span className="mt-1.5 size-3 shrink-0 rounded-full bg-dust-500" />
            {i < entries.length - 1 ? <span className="mt-1 w-0.5 flex-1 bg-dust-200" /> : null}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-medium break-words">{describe(e)}</span>
            {e.reason ? <span className="text-sm text-dust-700">“{e.reason}”</span> : null}
            <span className="text-sm text-dust-500">
              {e.actorName ?? "Recorded outside the app"}
              {" · "}
              <time dateTime={e.at}>{formatDateTime(e.at)}</time>
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
