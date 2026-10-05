import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Sheet } from "@/components/ui/sheet";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Adjust stock
      </button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Adjust stock"
        footer={<button type="button">Save</button>}
      >
        <input aria-label="Change" />
      </Sheet>
    </>
  );
}

describe("Sheet", () => {
  it("is a labelled modal dialog that takes focus and inerts the page", () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Adjust stock" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Adjust stock" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByLabelText("Change")).toHaveFocus();
    // The app root (RTL's container) is inert while the sheet is open
    expect(opener.closest("body > div")).toHaveAttribute("inert");
  });

  it("traps Tab within the sheet", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Adjust stock" }));
    const save = screen.getByRole("button", { name: "Save" });
    const close = screen.getByRole("button", { name: "Close" });
    save.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(save).toHaveFocus();
  });

  it("closes on Escape, un-inerts the page and restores focus to the opener", () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Adjust stock" });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener.closest("body > div")).not.toHaveAttribute("inert");
    expect(opener).toHaveFocus();
  });
});
