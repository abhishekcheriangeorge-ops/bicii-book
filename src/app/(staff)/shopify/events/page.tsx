import type { Metadata } from "next";

import { SearchField } from "@/components/domain/search-field";
import { LinkSegments } from "@/components/domain/workshop-board";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ChevronRightIcon, ReceiptIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink, RowList } from "@/components/ui/row-list";
import { StatusPill } from "@/components/ui/status-pill";
import { requireAdmin } from "@/lib/auth/session";
import { formatDayShort, formatTime } from "@/lib/dates";
import { listEvents } from "@/lib/domain/shopify";
import { readQuery, withParam } from "@/lib/search-params";
import {
  EVENT_FILTERS,
  deliveredText,
  eventRowNote,
  eventStatusLabel,
  eventStatusTone,
  readEventFilter,
  topicLabel,
} from "@/lib/shopify";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Shopify events" };

/**
 * Every webhook Shopify sent (admins; D86, D88), newest first: search by
 * order name or webhook id (`?q=`), filter All / Failed / Rejected /
 * Processed / Skipped. Each row: the topic in words, the subject, when it
 * arrived (Singapore time), "Delivered 2×" for repeats, "Test" for test
 * deliveries, what happened in a few words and the status. At most 30
 * rows, saying so when cut off.
 */
export default async function ShopifyEventsPage({ searchParams }: PageProps<"/shopify/events">) {
  await requireAdmin();
  const params = await searchParams;
  const q = readQuery(params.q);
  const status = readEventFilter(params.status);
  const { items, more } = await listEvents(await createClient(), { status, q });

  return (
    <>
      <PageHeader
        eyebrow="Shopify"
        title="Events"
        description="Webhooks from Shopify as they arrived, with what BICII did with each."
      />
      <div className="mb-4 flex flex-col gap-3">
        <SearchField
          label="Search events"
          hint="Order name like #1042, or a webhook id"
          placeholder="Search events"
        />
        <LinkSegments
          label="Event status"
          options={EVENT_FILTERS.map((f) => ({
            key: f.key,
            text: f.label,
            href: `/shopify/events${withParam(withParam("", "status", f.key === "all" ? null : f.key), "q", q)}`,
            current: status === f.key,
          }))}
        />
      </div>
      {more ? (
        <p className="mb-2 text-sm text-dust-700">
          First {items.length} matches. Search by order name or webhook id to find an older one.
        </p>
      ) : null}
      {items.length === 0 ? (
        <EmptyState
          icon={<ReceiptIcon />}
          title={q ? `No event matches “${q}”` : "No events"}
          description="Shopify's webhooks appear here as they arrive."
        />
      ) : (
        <RowList label="Events">
          {items.map((e) => {
            const delivered = deliveredText(e.deliveryCount);
            const note = eventRowNote(e);
            return (
              <RowLink key={e.id} href={`/shopify/events/${e.id}`}>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="eyebrow text-dust-500">{topicLabel(e.topic)}</span>
                    <span className="font-medium break-words">{e.subject ?? "No subject"}</span>
                    <StatusPill status={eventStatusTone(e.status)}>
                      {eventStatusLabel(e.status)}
                    </StatusPill>
                    {e.testDelivery ? <Badge tone="waiting">Test</Badge> : null}
                  </span>
                  {note ? <span className="text-sm break-words">{note}</span> : null}
                  <span className="text-sm text-dust-500 tabular-nums">
                    <time dateTime={e.receivedAt}>
                      {formatDayShort(e.receivedAt)}, {formatTime(e.receivedAt)}
                    </time>
                    {delivered ? ` · ${delivered}` : ""}
                  </span>
                  <span className="truncate font-mono text-xs text-dust-500">{e.webhookId}</span>
                </span>
                <ChevronRightIcon className="size-5 shrink-0 text-dust-500" />
              </RowLink>
            );
          })}
        </RowList>
      )}
    </>
  );
}
