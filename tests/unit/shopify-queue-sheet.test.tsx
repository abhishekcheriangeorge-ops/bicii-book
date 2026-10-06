import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 10 review fixes: the queue sheet follows the server's rows after a
 * Retry or a link (it holds only the job's id), closes when its job
 * closes, keeps focus inside the sheet when the link form is cancelled,
 * and the Online card says why a published product is not listed.
 */

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/shopify/queue",
  useSearchParams: () => new URLSearchParams(),
}));

const retryJobAction = vi.fn();
vi.mock("@/app/(staff)/shopify/actions", () => ({
  retryJobAction: (...a: unknown[]) => retryJobAction(...a),
  dismissJobAction: vi.fn(),
  linkVariantAction: vi.fn(),
  searchProductsForLinkAction: vi.fn(async () => ({ ok: true, data: [] })),
}));
vi.mock("@/app/(staff)/inventory/actions", () => ({
  setPublishOnlineAction: vi.fn(),
  syncNowAction: vi.fn(),
}));

import { JobPanel } from "@/components/domain/shopify/job-panel";
import { OnlineCard } from "@/components/domain/shopify/online-card";
import { QueueList } from "@/components/domain/shopify/queue-list";
import { ToastProvider } from "@/components/ui/toast";
import type { QueueRow } from "@/lib/domain/shopify";

const JOB = "e3000000-0000-4000-8000-000000000001";
const LINE = {
  lineItemId: "gid://shopify/LineItem/1",
  title: "Musette",
  variantTitle: null,
  variantGid: "gid://shopify/ProductVariant/9800000001",
  productGid: "gid://shopify/Product/9700000001",
  quantity: 1,
};

const row = (o: Partial<QueueRow> = {}): QueueRow => ({
  id: JOB,
  kind: "shopify_event",
  topic: "orders/paid",
  status: "needs_attention",
  subject: "#1042",
  reason: "First reason",
  code: "shopify_variant_unmapped",
  attempts: 1,
  maxAttempts: 8,
  nextAttemptAt: null,
  resolutionReason: null,
  updatedAt: "2026-10-06T00:00:00Z",
  eventId: "e1000000-0000-4000-8000-000000000001",
  productId: null,
  unmappedLines: [LINE],
  ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the queue sheet", () => {
  it("shows the refreshed row after a Retry that did not close the job, and closes when the job closes", async () => {
    const { rerender } = render(
      <ToastProvider>
        <QueueList rows={[row()]} deepLinkJob={null} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /#1042/ }));
    const sheet = screen.getByRole("dialog", { name: "Order #1042" });
    expect(sheet).toHaveTextContent("First reason");
    expect(sheet).toHaveTextContent("Attempt 1 of 8");

    // refresh() after a failed retry: new attempts, reason and lines.
    rerender(
      <ToastProvider>
        <QueueList
          rows={[row({ attempts: 2, reason: "Second reason", unmappedLines: [] })]}
          deepLinkJob={null}
        />
      </ToastProvider>,
    );
    const updated = screen.getByRole("dialog", { name: "Order #1042" });
    expect(updated).toHaveTextContent("Second reason");
    expect(updated).toHaveTextContent("Attempt 2 of 8");
    expect(updated).not.toHaveTextContent("First reason");
    expect(screen.queryByRole("button", { name: /Link to a BICII product/ })).toBeNull();

    // The retry ended "Closed without recording": the job is done.
    rerender(
      <ToastProvider>
        <QueueList rows={[row({ status: "done", attempts: 2 })]} deepLinkJob={null} />
      </ToastProvider>,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes when the job leaves the view", async () => {
    const { rerender } = render(
      <ToastProvider>
        <QueueList rows={[row()]} deepLinkJob={null} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /#1042/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    rerender(
      <ToastProvider>
        <QueueList rows={[]} deepLinkJob={null} />
      </ToastProvider>,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("does not repeat the kind in a refund's title", () => {
    render(
      <ToastProvider>
        <QueueList
          rows={[row({ topic: "refunds/create", subject: "Refund 7300000001 of #1001" })]}
          deepLinkJob={null}
        />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Refund 7300000001/ }));
    expect(screen.getByRole("dialog", { name: "Refund 7300000001 of #1001" })).toBeInTheDocument();
  });
});

describe("JobPanel", () => {
  it("a Retry that does not close the item leaves the panel open", async () => {
    retryJobAction.mockResolvedValue({
      ok: true,
      data: { title: "Still needs attention", description: "x", tone: "error", saleNumber: null },
    });
    const onDone = vi.fn();
    render(
      <ToastProvider>
        <JobPanel job={row()} inSheet onDone={onDone} />
      </ToastProvider>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });
    expect(retryJobAction).toHaveBeenCalledOnce();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("Cancel in the link form returns focus to the line's Link button", async () => {
    render(
      <ToastProvider>
        <JobPanel job={row()} inSheet />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Link to a BICII product: Musette" }));
    expect(screen.getByRole("heading", { name: "Link to a BICII product" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Link to a BICII product: Musette" }),
      ).toHaveFocus(),
    );
  });
});

describe("the Online card", () => {
  const online = {
    publishOnline: true,
    syncStatus: "unpublished" as const,
    origin: "bicii" as const,
    lastPushedAt: null,
    lastPushedQuantity: null,
    onlineLocationName: null,
    lastError: null,
    shopifyProductId: null,
    shopifyVariantId: null,
  };

  it("says why a product with Publish online on is not listed", () => {
    render(
      <ToastProvider>
        <OnlineCard
          productId="d1000000-0000-4000-8000-000000000004"
          online={online}
          syncedAgo={null}
          blockedReason={null}
          offlineReason="Not listed: the product is not public. It goes back online when you publish it again."
          canManage
          fakeMode={false}
        />
      </ToastProvider>,
    );
    expect(screen.getByText(/Not listed: the product is not public/)).toBeInTheDocument();
    expect(screen.queryByText("Listed on the Shopify store at its selling price.")).toBeNull();
  });

  it("says it is listed when it is", () => {
    render(
      <ToastProvider>
        <OnlineCard
          productId="d1000000-0000-4000-8000-000000000004"
          online={{ ...online, syncStatus: "synced" }}
          syncedAgo={null}
          blockedReason={null}
          offlineReason={null}
          canManage
          fakeMode={false}
        />
      </ToastProvider>,
    );
    expect(
      screen.getByText("Listed on the Shopify store at its selling price."),
    ).toBeInTheDocument();
  });
});
