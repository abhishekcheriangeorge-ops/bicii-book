import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ToastProvider,
  placeToast,
  useToast,
  type ToastItem,
  type ToastOptions,
} from "@/components/ui/toast";

function Trigger({ options }: { options: ToastOptions }) {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => toast(options)}>
      show
    </button>
  );
}

describe("toast action", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs the action once, dismisses the toast, and does not time out while waiting", () => {
    const onAction = vi.fn();
    render(
      <ToastProvider>
        <Trigger
          options={{
            title: "Photo not saved",
            tone: "success",
            action: { label: "Retry", onAction },
          }}
        />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "show" }));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    const retry = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(retry);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Photo not saved")).toBeNull();
  });
});

describe("toast stacking", () => {
  const item = (id: number, extra: Partial<ToastItem> = {}): ToastItem => ({
    id,
    title: `Toast ${id}`,
    tone: "neutral",
    duration: 5000,
    ...extra,
  });
  const retry = { label: "Retry", onAction: () => {} };

  it("keeps at most four, pushing out the oldest plain toast", () => {
    let list: ToastItem[] = [];
    for (let i = 1; i <= 6; i++) list = placeToast(list, item(i));
    expect(list.map((t) => t.id)).toEqual([3, 4, 5, 6]);
  });

  it("never pushes out a toast with an action, however many arrive after it", () => {
    let list: ToastItem[] = [item(1, { tone: "error", action: retry, duration: null })];
    for (let i = 2; i <= 8; i++) list = placeToast(list, item(i));
    expect(list.map((t) => t.id)).toEqual([1, 6, 7, 8]);
    list = placeToast(list, item(9, { action: retry }));
    list = placeToast(list, item(10, { action: retry }));
    list = placeToast(list, item(11, { action: retry }));
    expect(list.filter((t) => t.action).map((t) => t.id)).toEqual([1, 9, 10, 11]);
  });

  it("replaces a toast with the same key in place", () => {
    let list: ToastItem[] = [
      item(1),
      item(2, { key: "uploads:bike:x", title: "1 photo not saved" }),
    ];
    list = placeToast(list, item(3));
    list = placeToast(list, item(4, { key: "uploads:bike:x", title: "2 photos not saved" }));
    expect(list.map((t) => t.title)).toEqual(["Toast 1", "2 photos not saved", "Toast 3"]);
  });

  it("dismisses by key", () => {
    function Keyed() {
      const { toast, dismiss } = useToast();
      return (
        <>
          <button type="button" onClick={() => toast({ title: "Kept", key: "k" })}>
            show
          </button>
          <button type="button" onClick={() => dismiss("k")}>
            hide
          </button>
        </>
      );
    }
    render(
      <ToastProvider>
        <Keyed />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "show" }));
    fireEvent.click(screen.getByRole("button", { name: "show" }));
    expect(screen.getAllByText("Kept")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "hide" }));
    expect(screen.queryByText("Kept")).toBeNull();
  });
});
