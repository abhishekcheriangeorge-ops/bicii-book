import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setStatus = vi.fn();
vi.mock("@/app/(staff)/labels/actions", () => ({
  setPrintJobStatusAction: (...args: unknown[]) => setStatus(...args),
  createPrintJobAction: vi.fn(),
}));

import { PrintJobControls } from "@/components/domain/print-job-controls";
import { PrintJobOutcome } from "@/components/domain/print-job-outcome";
import { ToastProvider } from "@/components/ui/toast";
import { reprintPath } from "@/lib/printing/links";

const JOB = "a9000000-0000-4000-8000-000000000005";
const ENTITY = "9a000000-0000-4000-8000-000000000011";

const props = {
  jobId: JOB,
  quantity: 10,
  pdfHref: `/api/labels/${JOB}/pdf`,
  widthMm: 58,
  heightMm: 40,
  shortId: "P-000011",
  recordHref: `/products/${ENTITY}`,
};

let order: string[];

beforeEach(() => {
  order = [];
  setStatus.mockReset();
  setStatus.mockImplementation((input: { status: string }) => {
    order.push(`action:${input.status}`);
    return new Promise((resolve) => {
      // Resolves later: Print must not wait for it.
      setTimeout(() => {
        order.push(`resolved:${input.status}`);
        resolve({ ok: true, data: { status: input.status } });
      }, 20);
    });
  });
  vi.spyOn(window, "print").mockImplementation(() => {
    order.push("print");
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const renderControls = (over: Partial<Parameters<typeof PrintJobControls>[0]> = {}) =>
  render(
    <ToastProvider>
      <PrintJobControls status="queued" adapter="browser" {...props} {...over} />
    </ToastProvider>,
  );

describe("PrintJobControls", () => {
  it("calls window.print in the click itself, before the action resolves", async () => {
    renderControls();
    fireEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(order[0]).toBe("print");
    expect(order[1]).toBe("action:rendered");
    expect(order).not.toContain("resolved:rendered");
    expect(setStatus).toHaveBeenCalledWith({ id: JOB, status: "rendered" });
    expect(
      screen.getByRole("heading", { name: "Did all 10 labels print correctly?" }),
    ).toBeVisible();
    await waitFor(() => expect(order).toContain("resolved:rendered"));
  });

  it("does not mark an already rendered job again and asks for confirmation at once", () => {
    renderControls({ status: "rendered" });
    expect(
      screen.getByRole("heading", { name: "Did all 10 labels print correctly?" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(window.print).toHaveBeenCalledTimes(1);
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("offers Open PDF for a PDF printer, linking the job's PDF in a new tab", () => {
    renderControls({ adapter: "pdf" });
    expect(screen.queryByRole("button", { name: "Print" })).toBeNull();
    const link = screen.getByRole("link", { name: "Open PDF" });
    expect(link).toHaveAttribute("href", props.pdfHref);
    expect(link).toHaveAttribute("target", "_blank");
    expect(
      screen.getByText(/Share → Print\. Set the paper to 58 × 40 mm, scale 100%\./),
    ).toBeVisible();
    link.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(link);
    expect(setStatus).toHaveBeenCalledWith({ id: JOB, status: "rendered" });
    expect(screen.getByRole("heading", { name: /Did all 10 labels/ })).toBeVisible();
  });

  it("needs a reason to mark the job failed", async () => {
    renderControls({ status: "rendered" });
    fireEvent.click(screen.getByRole("button", { name: "Something went wrong…" }));
    const reason = screen.getByLabelText(/What went wrong\?/);
    expect(reason).toHaveFocus();
    // The house guard: presses in the first 400 ms are ignored.
    await act(() => new Promise((r) => setTimeout(r, 450)));
    fireEvent.click(screen.getByRole("button", { name: "Mark as failed" }));
    expect(await screen.findByText("Give a reason.")).toBeVisible();
    expect(setStatus).not.toHaveBeenCalled();

    fireEvent.change(reason, { target: { value: "Roll ran out" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mark as failed" }));
    });
    await waitFor(() =>
      expect(setStatus).toHaveBeenCalledWith({ id: JOB, status: "failed", error: "Roll ran out" }),
    );
    expect(await screen.findByRole("heading", { name: "Marked as failed" })).toBeVisible();
  });

  it("confirms printed after the double-tap guard", async () => {
    renderControls({ status: "rendered" });
    const yes = screen.getByRole("button", { name: "Yes, all printed" });
    expect(yes).toBeDisabled();
    await waitFor(() => expect(yes).toBeEnabled());
    await act(async () => {
      fireEvent.click(yes);
    });
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith({ id: JOB, status: "printed" }));
    expect(await screen.findByRole("link", { name: "Back to P-000011" })).toHaveAttribute(
      "href",
      props.recordHref,
    );
    expect(screen.getByRole("link", { name: "Print history" })).toHaveAttribute("href", "/labels");
  });
});

describe("PrintJobOutcome (a finished job)", () => {
  const printed = {
    id: JOB,
    kind: "product" as const,
    entityId: ENTITY,
    quantity: 10,
    status: "printed" as const,
    error: null,
    completedAt: "2026-10-03T03:02:00Z",
    statusChangedBy: { id: "s", name: "Marcus Tan" },
    entityArchived: false,
  };

  it("has no Print control and links Print again to the record", () => {
    render(<PrintJobOutcome job={printed} />);
    expect(screen.queryByRole("button", { name: "Print" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open PDF" })).toBeNull();
    expect(screen.getByText(/^Printed .* by Marcus Tan$/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Print again" })).toHaveAttribute(
      "href",
      reprintPath(printed),
    );
  });

  it("disables Print again for an archived record and says why", () => {
    render(
      <PrintJobOutcome
        job={{ ...printed, status: "failed", error: "Jammed", entityArchived: true }}
      />,
    );
    expect(screen.getByText("Failed: Jammed")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Print again" })).toBeNull();
    expect(screen.getByRole("button", { name: "Print again" })).toBeDisabled();
    expect(
      screen.getByText("That record is archived. Unarchive it before printing labels."),
    ).toBeVisible();
  });
});
