import type { Metadata } from "next";

import { QueueList } from "@/components/domain/shopify/queue-list";
import { LinkSegments } from "@/components/domain/workshop-board";
import { EmptyState } from "@/components/ui/empty-state";
import { CheckIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/auth/session";
import { getQueueJob, listQueue } from "@/lib/domain/shopify";
import { QUEUE_EMPTY, QUEUE_VIEWS, readQueueView } from "@/lib/shopify";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

export const metadata: Metadata = { title: "Shopify queue" };

const EMPTY: Record<string, { title: string; description: string }> = {
  attention: { title: "Nothing needs attention", description: QUEUE_EMPTY },
  waiting: {
    title: "Nothing is waiting",
    description: "Jobs that failed for a passing reason are retried here automatically.",
  },
  recent: {
    title: "Nothing finished in the last 7 days",
    description: "Done and dismissed items from the last week show here.",
  },
};

/**
 * The Shopify queue (admins; managers see refund jobs only, D94; SPEC §26;
 * D82, D86, D87): Needs attention
 * (the default), Waiting (queued or running, retried automatically) and
 * Recent (done or dismissed in the last 7 days). Each row opens a sheet
 * with Retry, Link to a BICII product, Dismiss… and Open event.
 * `?job=<id>` opens that job's sheet (Today's exception row links here).
 * A manager reaches it from Today: RLS returns them only refunds/create
 * jobs, which they retry or dismiss (money going out, D94); orders,
 * product syncs and the rest of Shopify stay the admin's (D86).
 */
export default async function ShopifyQueuePage({ searchParams }: PageProps<"/shopify/queue">) {
  const staff = await requireRole(["admin", "manager"]);
  const params = await searchParams;
  const view = readQueueView(params.view);
  const jobParam = typeof params.job === "string" ? params.job : null;
  const supabase = await createClient();
  const [{ items, more }, deepLink] = await Promise.all([
    listQueue(supabase, { view }),
    jobParam && isUuid(jobParam) ? getQueueJob(supabase, jobParam) : Promise.resolve(null),
  ]);
  const empty = EMPTY[view]!;

  return (
    <>
      <PageHeader
        eyebrow="Shopify"
        title="Queue"
        description={
          staff.role === "admin"
            ? "Orders, refunds and product syncs BICII could not finish on its own."
            : "Shopify refunds BICII could not record on its own. Orders and product syncs are an admin's."
        }
      />
      <div className="mb-4">
        <LinkSegments
          label="Queue view"
          options={QUEUE_VIEWS.map((v) => ({
            key: v.key,
            text: v.label,
            href: v.key === "attention" ? "/shopify/queue" : `/shopify/queue?view=${v.key}`,
            current: view === v.key,
          }))}
        />
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={<CheckIcon className="size-6" />}
          title={empty.title}
          description={empty.description}
        />
      ) : null}
      {more ? (
        <p className="mb-2 text-sm text-dust-700">Showing the first {items.length}.</p>
      ) : null}
      <QueueList key={`${view}:${jobParam ?? ""}`} rows={items} deepLinkJob={deepLink} />
    </>
  );
}
