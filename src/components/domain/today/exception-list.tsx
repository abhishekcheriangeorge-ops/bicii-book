import { ShortId } from "@/components/domain/short-id";
import { EmptyState } from "@/components/ui/empty-state";
import { CheckIcon } from "@/components/ui/icons";
import { RowLink, RowList } from "@/components/ui/row-list";
import { StatusPill } from "@/components/ui/status-pill";
import { isShortId } from "@/lib/ids";
import {
  exceptionCopy,
  exceptionHref,
  exceptionKeys,
  exceptionLabel,
  exceptionsShownNote,
  type OperationalException,
} from "@/lib/reports";

/**
 * Operational exceptions (server; D34), danger first as the database
 * orders them: a pill (tone and words), the record's short ID and subject,
 * and what is wrong in a sentence. A row opens its record when this build
 * has a page for it; an unknown kind from a later phase still renders.
 * `total` is the full count: when the list is capped below it, a line says
 * how many of how many are shown (most urgent first, as the database
 * orders them). Phase 9 reuses this list and turns that line into a link
 * to /reports/exceptions.
 */
export function ExceptionList({
  rows,
  total = rows.length,
}: {
  rows: readonly OperationalException[];
  total?: number;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<CheckIcon className="size-6" />}
        title="Nothing needs attention"
        description="No overdue or uncollected jobs, no stock below zero and no stale holds."
      />
    );
  }
  const keys = exceptionKeys(rows);
  const shown = exceptionsShownNote(rows.length, total);
  const list = (
    <RowList label="Needs attention">
      {rows.map((r, i) => {
        const { text, tone } = exceptionCopy(r.kind, r);
        const href = exceptionHref(r);
        const body = (
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={tone}>{exceptionLabel(r.kind)}</StatusPill>
              {r.entityLabel ? (
                isShortId(r.entityLabel) ? (
                  <ShortId value={r.entityLabel} />
                ) : (
                  <span className="font-medium">{r.entityLabel}</span>
                )
              ) : null}
            </div>
            {r.subjectLabel ? <p className="truncate text-sm">{r.subjectLabel}</p> : null}
            <p className="text-sm text-dust-700">{text}</p>
          </div>
        );
        const key = keys[i];
        return href ? (
          <RowLink key={key} href={href}>
            {body}
          </RowLink>
        ) : (
          <li key={key} className="flex min-h-16 items-center gap-4 px-4 py-3">
            {body}
          </li>
        );
      })}
    </RowList>
  );
  if (!shown) return list;
  return (
    <div className="flex flex-col gap-2">
      {list}
      <p className="text-sm text-dust-500 tabular-nums">{shown}</p>
    </div>
  );
}
