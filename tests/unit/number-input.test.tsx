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
