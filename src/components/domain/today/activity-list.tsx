import { ShortId } from "@/components/domain/short-id";
import { Badge } from "@/components/ui/badge";
import { RowLink, RowList } from "@/components/ui/row-list";
import { StatusPill } from "@/components/ui/status-pill";
import { formatMoney } from "@/lib/money";
import type { ActivityRow } from "@/lib/reports";
import { STATUS_LABELS, statusTone } from "@/lib/workshop";

/**
 * One flow's jobs in Today's Activity (server): "Checked in", "Completed",
 * … Each row opens the job: J- number, customer, bike, status (text and
 * tone), an "Overdue" badge (D20) and the sale total (sale only, so every
 * staff member sees it). The heading's id is the anchor the flow tile
 * links to.
 */
export function ActivityList({
  label,
  anchor,
  rows,
}: {
  label: string;
  anchor: string;
  rows: readonly ActivityRow[];
}) {
  return (
    <div id={anchor} className="flex scroll-mt-20 flex-col gap-2">
      <h3 className="font-display text-sm font-bold tracking-wide uppercase">
        {label} <span className="text-dust-500 tabular-nums">({rows.length})</span>
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-dust-500">None.</p>
      ) : (
        <RowList label={label}>
          {rows.map((r) => (
            <RowLink key={r.workOrderId} href={`/jobs/${r.workOrderId}`} className="items-start">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <ShortId value={r.jobNumber} />
                  <StatusPill status={statusTone(r.status)}>{STATUS_LABELS[r.status]}</StatusPill>
                  {r.isOverdue ? (
                    <Badge tone="danger" emphasis="solid">
                      Overdue
                    </Badge>
                  ) : null}
                </div>
                <p className="truncate font-medium">{r.customerLabel}</p>
                <p className="truncate text-sm text-dust-700">{r.bikeTitle}</p>
              </div>
              <span className="shrink-0 font-semibold tabular-nums">
                {formatMoney(r.saleTotal, r.currency)}
              </span>
            </RowLink>
          ))}
        </RowList>
      )}
    </div>
  );
}
