import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { NumberInput } from "@/components/ui/number-input";

function Quantity({ initial, decimals }: { initial: string; decimals?: number }) {
  const [value, setValue] = useState(initial);
  return (
    <NumberInput
      kind="quantity"
      decimals={decimals}
      stepper
      minValue={1}
      maxValue={9999}
      aria-label="Quantity"
      value={value}
      onValueChange={setValue}
    />
  );
}

const field = () => screen.getByLabelText("Quantity");
const press = (name: "Increase" | "Decrease") =>
  fireEvent.click(screen.getByRole("button", { name }));

describe("NumberInput quantity", () => {
  it("whole numbers by default: the numeric keypad", () => {
    render(<Quantity initial="2" />);
    expect(field()).toHaveAttribute("inputmode", "numeric");
    press("Increase");
    expect(field()).toHaveValue("3");
  });

  it("with decimals, offers the decimal keypad so 1.5 hours can be typed on a phone", () => {
    render(<Quantity initial="1" decimals={2} />);
    expect(field()).toHaveAttribute("inputmode", "decimal");
    expect(field()).toHaveAttribute("pattern", "[0-9]*(\\.[0-9]{0,2})?");
  });

  it("steps by 1 and keeps the fraction", () => {
    render(<Quantity initial="1.5" decimals={2} />);
    press("Increase");
    expect(field()).toHaveValue("2.5");
    press("Increase");
    expect(field()).toHaveValue("3.5");
    press("Decrease");
    expect(field()).toHaveValue("2.5");
  });

  it("clamps to the bounds and disables a step past them", () => {
    render(<Quantity initial="1.25" decimals={2} />);
    press("Decrease");
    expect(field()).toHaveValue("1");
    expect(screen.getByRole("button", { name: "Decrease" })).toBeDisabled();
    fireEvent.change(field(), { target: { value: "9998.5" } });
    press("Increase");
    expect(field()).toHaveValue("9999");
    expect(screen.getByRole("button", { name: "Increase" })).toBeDisabled();
  });
});

function Offset({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <NumberInput
      kind="decimal"
      stepper
      step={0.5}
      minValue={-5}
      maxValue={5}
      aria-label="Offset"
      value={value}
      onValueChange={setValue}
    />
  );
}

describe("NumberInput decimal stepper", () => {
  const offset = () => screen.getByLabelText("Offset");

  it("steps by `step` on the decimal keypad, through zero to negatives", () => {
    render(<Offset initial="0.5" />);
    expect(offset()).toHaveAttribute("inputmode", "decimal");
    press("Decrease");
    expect(offset()).toHaveValue("0");
    press("Decrease");
    expect(offset()).toHaveValue("-0.5");
    press("Increase");
    press("Increase");
    press("Increase");
    expect(offset()).toHaveValue("1");
  });

  it("starts from an empty field as 0", () => {
    render(<Offset initial="" />);
    press("Increase");
    expect(offset()).toHaveValue("0.5");
  });

  it("rounds to the step's decimals and clamps to min and max", () => {
    render(<Offset initial="1.24" />);
    press("Increase");
    expect(offset()).toHaveValue("1.7");
    fireEvent.change(offset(), { target: { value: "4.8" } });
    press("Increase");
    expect(offset()).toHaveValue("5");
    expect(screen.getByRole("button", { name: "Increase" })).toBeDisabled();
    fireEvent.change(offset(), { target: { value: "-4.9" } });
    press("Decrease");
    expect(offset()).toHaveValue("-5");
    expect(screen.getByRole("button", { name: "Decrease" })).toBeDisabled();
  });

  it("a whole-number step keeps whole numbers", () => {
    function Whole() {
      const [value, setValue] = useState("2");
      return (
        <NumberInput
          kind="decimal"
          stepper
          aria-label="Whole"
          value={value}
          onValueChange={setValue}
        />
      );
    }
    render(<Whole />);
    press("Increase");
    expect(screen.getByLabelText("Whole")).toHaveValue("3");
  });

  it("without `stepper` a decimal field has no buttons", () => {
    render(<NumberInput kind="decimal" aria-label="Rate" defaultValue="1" />);
    expect(screen.queryByRole("button", { name: "Increase" })).toBeNull();
  });
});
