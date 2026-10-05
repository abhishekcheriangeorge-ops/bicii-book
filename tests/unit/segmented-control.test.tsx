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

describe("SegmentedControl looks", () => {
  // cn() does not merge conflicting utilities, so a disabled segment must
  // not carry the enabled look at all (CSS order would decide otherwise).
  it("gives a disabled segment only the disabled look: muted text, not-allowed cursor", () => {
    render(<SegmentedControl label="Who" options={options} defaultValue="internal" />);
    const classes = screen.getByRole("radio", { name: "Public" }).className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["text-dust-500", "cursor-not-allowed"]));
    expect(classes).not.toContain("text-ink");
    expect(classes).not.toContain("cursor-pointer");
    expect(classes).not.toContain("hover:bg-dust-100");

    const enabled = screen.getByRole("radio", { name: "Customer" }).className.split(/\s+/);
    expect(enabled).toEqual(expect.arrayContaining(["text-ink", "cursor-pointer"]));
    expect(enabled).not.toContain("cursor-not-allowed");
  });
});

describe("SegmentedControl with nothing chosen (value null, D4's bearer)", () => {
  const bearers = [
    { value: "consignor", label: "Consignor pays" },
    { value: "shop", label: "Shop pays" },
  ];

  it("checks no option, keeps one tab stop and submits nothing until a choice", () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <SegmentedControl
        label="Who pays"
        name="bearer"
        options={bearers}
        value={null}
        onValueChange={onValueChange}
      />,
    );
    const radios = screen.getAllByRole("radio");
    expect(radios.every((r) => r.getAttribute("aria-checked") === "false")).toBe(true);
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1]);
    expect(container.querySelector('input[name="bearer"]')).toHaveValue("");
    fireEvent.click(screen.getByRole("radio", { name: "Shop pays" }));
    expect(onValueChange).toHaveBeenCalledWith("shop");
  });

  it("starts on the first enabled option when the first is disabled", () => {
    render(
      <SegmentedControl
        label="Who pays"
        options={[bearers[0], { ...bearers[1], disabled: true }].reverse()}
        value={null}
      />,
    );
    expect(screen.getAllByRole("radio").map((r) => r.tabIndex)).toEqual([-1, 0]);
  });
});
