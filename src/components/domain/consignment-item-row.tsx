import { ChevronRightIcon } from "@/components/ui/icons";
import { RowLink } from "@/components/ui/row-list";
import { StatusPill } from "@/components/ui/status-pill";
import type { Pill } from "@/lib/consignment";

import { ShortId } from "./short-id";

/**
 * One consignment item in a RowList (the Items view, a consignor's page):
 * the C- number and its status on the first line, the name on its own
 * line so a phone never squeezes it out, then the details (consignor,
 * what is left, the asking price) and, for money users, what is owed.
 */
export function ConsignmentItemRow({
  href,
  shortId,
  name,
  pill,
  details,
  amount,
}: {
  href: string;
  shortId: string;
  name: string;
  pill: Pill;
  details: readonly (string | null)[];
  /** Right-aligned figure, e.g. what is owed on it (money users only). */
  amount?: string | null;
}) {
  const detail = details.filter(Boolean).join(" · ");
  return (
    <RowLink href={href}>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <ShortId value={shortId} />
          <StatusPill status={pill.tone}>{pill.label}</StatusPill>
        </span>
        <span className="font-medium break-words">{name}</span>
        {detail ? <span className="text-sm break-words text-dust-500">{detail}</span> : null}
      </span>
      {amount ? (
        <span className="shrink-0 text-sm font-semibold tabular-nums">{amount}</span>
      ) : null}
      <ChevronRightIcon className="size-5 shrink-0 text-dust-500" />
    </RowLink>
  );
}
