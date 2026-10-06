import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const saveTemplate = vi.fn();
vi.mock("@/app/(staff)/settings/labels/actions", () => ({
  saveProfileAction: vi.fn(),
  saveTemplateAction: (...args: unknown[]) => saveTemplate(...args),
  setDefaultProfileAction: vi.fn(),
  setDefaultTemplateAction: vi.fn(),
  setPublicSiteUrlAction: vi.fn(),
}));

import { TemplateSheet } from "@/components/domain/label-settings";
import { ToastProvider } from "@/components/ui/toast";

/**
 * Settings → Labels and printers, a new label template (review finding:
 * no error before the admin has typed anything; a field's problem sits on
 * that field; the layout's sentence stays live under the preview).
 */

const renderSheet = () =>
  render(
    <ToastProvider>
      <TemplateSheet template={null} defaults={{}} onClose={() => {}} />
    </ToastProvider>,
  );

const dialog = () => screen.getByRole("dialog", { name: "New label template" });
const nameField = () => within(dialog()).getByRole("textbox", { name: /^Name/ });

beforeEach(() => saveTemplate.mockReset());

describe("TemplateSheet (new)", () => {
  it("opens with no error, a preview and Add template enabled", () => {
    renderSheet();
    expect(within(dialog()).getByRole("img", { name: /^Label: / })).toBeInTheDocument();
    expect(within(dialog()).queryByText("Give the template a name.")).toBeNull();
    expect(nameField()).not.toHaveAttribute("aria-invalid");
    expect(within(dialog()).getByRole("status")).toHaveTextContent("The template fits the label.");
    expect(within(dialog()).getByRole("button", { name: "Add template" })).toBeEnabled();
  });

  it("puts a blocked save's problem on its field and moves focus there", async () => {
    renderSheet();
    await act(async () => {
      fireEvent.click(within(dialog()).getByRole("button", { name: "Add template" }));
    });
    expect(saveTemplate).not.toHaveBeenCalled();
    expect(nameField()).toHaveAttribute("aria-invalid", "true");
    expect(nameField()).toHaveAccessibleDescription(/Give the template a name\./);
    await waitFor(() => expect(nameField()).toHaveFocus());
  });

  it("shows a size problem on the size once it is changed, not on the name", () => {
    renderSheet();
    const width = within(dialog()).getByLabelText(/^Width \(mm\)/);
    fireEvent.change(width, { target: { value: "5" } });
    expect(width).toHaveAttribute("aria-invalid", "true");
    expect(nameField()).not.toHaveAttribute("aria-invalid");
    expect(within(dialog()).queryByText("Give the template a name.")).toBeNull();
  });

  it("keeps the layout's sentence live under the preview, even with no name, and blocks Add", () => {
    renderSheet();
    fireEvent.change(within(dialog()).getByLabelText(/^QR size \(mm\)/), {
      target: { value: "60" },
    });
    expect(within(dialog()).getByRole("status")).toHaveTextContent(/does not fit/);
    expect(within(dialog()).getByRole("button", { name: "Add template" })).toBeDisabled();
    expect(nameField()).not.toHaveAttribute("aria-invalid");
  });
});
