import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider, useToast, type ToastOptions } from "@/components/ui/toast";

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
