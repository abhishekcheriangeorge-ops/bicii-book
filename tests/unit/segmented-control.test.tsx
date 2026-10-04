import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SegmentedControl } from "@/components/ui/segmented-control";

const options = [
  { value: "internal", label: "Internal" },
  { value: "customer", label: "Customer" },
  { value: "public", label: "Public", disabled: true },
];

describe("SegmentedControl disabled options", () => {
  it("marks a disabled option and ignores clicks on it", () => {
    const onValueChange = vi.fn();
    render(
      <SegmentedControl
        label="Who can see this photo"
        options={options}
        defaultValue="internal"
        onValueChange={onValueChange}
      />,
    );
    const publicOption = screen.getByRole("radio", { name: "Public" });
    expect(publicOption).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(publicOption);
    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Internal" })).toHaveAttribute("aria-checked", "true");
  });

  it("skips disabled options with the arrow keys", () => {
    const onValueChange = vi.fn();
    render(
      <SegmentedControl
        label="Who can see this photo"
        options={options}
        defaultValue="customer"
        onValueChange={onValueChange}
      />,
    );
    fireEvent.keyDown(screen.getByRole("radio", { name: "Customer" }), { key: "ArrowRight" });
    expect(onValueChange).toHaveBeenLastCalledWith("internal");
    fireEvent.keyDown(screen.getByRole("radio", { name: "Internal" }), { key: "End" });
    expect(onValueChange).toHaveBeenLastCalledWith("customer");
  });
});
