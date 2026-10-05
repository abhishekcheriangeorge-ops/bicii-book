import { cn } from "@/lib/cn";
import { progressText, type Progress } from "@/lib/purchasing";

/**
 * How much of an order line (or order) has arrived: a bar with
 * role="progressbar" (aria-valuenow = received, aria-valuemax = ordered)
 * and the same facts in words, "18 of 20 received · 2 to come", so colour
 * is never the only signal. A cancelled remainder (D61) is hatched and
 * named "cancelled", never "to come".
 */
export function QuantityProgress({
  label,
  className,
  ...progress
}: Progress & {
  /** Accessible name of the bar, e.g. "Chain 11-speed received". */
  label: string;
  className?: string;
}) {
  const { ordered, received, cancelled } = progress;
  const text = progressText(progress);
  const pct = ordered > 0 ? Math.min(100, Math.round((received / ordered) * 100)) : 0;
  const cancelledPct =
    ordered > 0 ? Math.min(100 - pct, Math.round((cancelled / ordered) * 100)) : 0;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={ordered}
        aria-valuenow={Math.min(received, ordered)}
        aria-valuetext={text}
        className="flex h-2 w-full overflow-hidden rounded-full bg-dust-200"
      >
        <span
          aria-hidden="true"
          className={cn("h-full", received >= ordered ? "bg-done" : "bg-progress")}
          style={{ width: `${pct}%` }}
        />
        {cancelledPct > 0 ? (
          <span
            aria-hidden="true"
            className="h-full bg-[repeating-linear-gradient(135deg,var(--color-danger)_0_3px,transparent_3px_6px)]"
            style={{ width: `${cancelledPct}%` }}
          />
        ) : null}
      </div>
      <span className="text-dense text-dust-700 tabular-nums">{text}</span>
    </div>
  );
}
