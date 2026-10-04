import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";

describe("Field", () => {
  it("labels its control", () => {
    render(
      <Field label="Customer name">
        <Input />
      </Field>,
    );
    expect(screen.getByLabelText("Customer name")).toBeInstanceOf(HTMLInputElement);
  });

  it("describes the control with its hint, and is valid without an error", () => {
    render(
      <Field label="Serial number" hint="Usually under the bottom bracket">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText("Serial number");
    expect(input).toHaveAccessibleDescription("Usually under the bottom bracket");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("marks the control invalid and announces the error with the hint", () => {
    render(
      <Field label="Phone" hint="Singapore number" error="Enter 8 digits">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText("Phone");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toBeInvalid();
    const ids = input.getAttribute("aria-describedby")?.split(" ") ?? [];
    expect(ids).toHaveLength(2);
    const texts = ids.map((id) => document.getElementById(id)?.textContent);
    expect(texts).toEqual(["Enter 8 digits", "Singapore number"]);
    expect(input).toHaveAccessibleDescription("Enter 8 digits Singapore number");
  });

  it("shows a required marker and makes the control required", () => {
    render(
      <Field label="Reason" required>
        <Textarea />
      </Field>,
    );
    const textarea = screen.getByRole("textbox", { name: /Reason/ });
    expect(textarea).toBeRequired();
    expect(textarea).toHaveAttribute("aria-required", "true");
    // The visual asterisk is hidden from AT; the label says "(required)"
    expect(screen.getByText("*")).toHaveAttribute("aria-hidden", "true");
    expect(textarea).toHaveAccessibleName("Reason (required)");
  });

  it("keeps describedby that the control was given directly", () => {
    render(
      <>
        <p id="extra">Shown on the label</p>
        <Field label="Price" hint="Incl. GST">
          <NumberInput kind="money" aria-describedby="extra" />
        </Field>
      </>,
    );
    const input = screen.getByLabelText("Price");
    expect(input.getAttribute("aria-describedby")?.split(" ")).toContain("extra");
    expect(input).toHaveAccessibleDescription("Incl. GST Shown on the label");
    expect(input).toHaveAttribute("inputmode", "decimal");
    expect(input).toHaveAttribute("type", "text");
  });

  it("gives separate fields distinct ids", () => {
    render(
      <>
        <Field label="First">
          <Input />
        </Field>
        <Field label="Second">
          <Input />
        </Field>
      </>,
    );
    expect(screen.getByLabelText("First").id).not.toBe(screen.getByLabelText("Second").id);
  });
});
