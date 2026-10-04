import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { ChipRadioGroup } from "@/components/ui/chip";

function Lead({ initial }: { initial: string | null | undefined }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <p id="lead">Lead mechanic</p>
      <ChipRadioGroup<string | null>
        labelledBy="lead"
        value={value}
        onChange={setValue}
        options={[
          { value: "me", children: "Me", label: "Me (Marcus)" },
          { value: "nur", children: "Nur" },
          { value: null, children: "Unassigned" },
        ]}
      />
    </>
  );
}

const radio = (name: string) => screen.getByRole("radio", { name });

describe("ChipRadioGroup", () => {
  it("is one radio group with a single Tab stop on the chosen chip", () => {
    render(<Lead initial="nur" />);
    expect(screen.getByRole("radiogroup", { name: "Lead mechanic" })).toBeInTheDocument();
    expect(radio("Nur")).toHaveAttribute("aria-checked", "true");
    expect(radio("Nur")).toHaveAttribute("tabindex", "0");
    expect(radio("Me (Marcus)")).toHaveAttribute("tabindex", "-1");
    expect(radio("Unassigned")).toHaveAttribute("tabindex", "-1");
  });

  it("puts the Tab stop on the first chip when nothing is chosen", () => {
    render(<Lead initial={undefined} />);
    expect(radio("Me (Marcus)")).toHaveAttribute("tabindex", "0");
    expect(screen.getAllByRole("radio").filter((r) => r.tabIndex === 0)).toHaveLength(1);
  });

  it("moves and chooses with the arrow keys, wrapping, and jumps with Home and End", () => {
    render(<Lead initial="me" />);
    radio("Me (Marcus)").focus();
    fireEvent.keyDown(radio("Me (Marcus)"), { key: "ArrowRight" });
    expect(radio("Nur")).toHaveFocus();
    expect(radio("Nur")).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(radio("Nur"), { key: "ArrowDown" });
    expect(radio("Unassigned")).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(radio("Unassigned"), { key: "ArrowRight" });
    expect(radio("Me (Marcus)")).toHaveFocus();
    fireEvent.keyDown(radio("Me (Marcus)"), { key: "ArrowLeft" });
    expect(radio("Unassigned")).toHaveFocus();
    fireEvent.keyDown(radio("Unassigned"), { key: "Home" });
    expect(radio("Me (Marcus)")).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(radio("Me (Marcus)"), { key: "End" });
    expect(radio("Unassigned")).toHaveAttribute("aria-checked", "true");
    expect(radio("Unassigned")).toHaveAttribute("tabindex", "0");
  });
});
