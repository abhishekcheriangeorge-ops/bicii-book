"use client";

import { useState, type ChangeEvent, type ComponentPropsWithRef } from "react";
import { cn } from "@/lib/cn";
import { Decimal } from "@/lib/money";
import { MinusIcon, PlusIcon } from "./icons";
import { controlClasses } from "./input";
import { useFieldControlProps } from "./field";

export type NumberInputKind = "money" | "quantity" | "decimal";

export type NumberInputProps = Omit<
  ComponentPropsWithRef<"input">,
  "type" | "inputMode" | "value" | "defaultValue" | "onChange" | "prefix" | "size" | "step"
> & {
  /**
   * money: two decimals, currency prefix, decimal keypad.
   * quantity: a count with optional −/+ steppers; whole numbers on the
   *   numeric keypad, or up to `decimals` places on the decimal keypad.
   * decimal: free decimal (rates, millimetres); with `stepper`, −/+ move
   *   by `step` (print offsets: 0.5 mm).
   */
  kind?: NumberInputKind;
  /**
   * quantity only: decimal places allowed (default 0). Job lines take 2
   * (1.5 hours of labour): the decimal keypad, and the steppers add or
   * take 1 while keeping the fraction (1.5 → 2.5).
   */
  decimals?: number;
  value?: string;
  defaultValue?: string;
  /** Receives the raw text; parse with lib/money (parseMoney) at the boundary. */
  onValueChange?: (value: string) => void;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  /** Currency symbol shown before money values. Default "$" (SGD). */
  currencySymbol?: string;
  /** Show −/+ buttons (quantity, or decimal with `step`). */
  stepper?: boolean;
  /**
   * decimal only: what each −/+ press adds or takes (default 1). The result
   * is rounded to the step's decimal places (step 0.5: 1.24 + 0.5 = 1.74,
   * shown as 1.7) and clamped to min/max. The steppers are also how a
   * phone enters a negative value: iOS's decimal keypad has no minus key.
   */
  step?: number;
  /** Bounds used by the steppers; typed input is validated server-side. */
  minValue?: number;
  maxValue?: number;
  suffix?: string;
};

const patterns: Record<NumberInputKind, string> = {
  money: "-?[0-9,]*(\\.[0-9]{0,2})?",
  quantity: "-?[0-9]*",
  decimal: "-?[0-9,]*(\\.[0-9]*)?",
};

/** The typed text as a Decimal, or null when it is not a plain number. */
function asDecimal(text: string): Decimal | null {
  const t = text.trim();
  if (t === "") return new Decimal(0);
  if (!/^-?\d*(\.\d*)?$/.test(t) || t === "-" || t === ".") return null;
  return new Decimal(t);
}

/**
 * Text input for numbers. type="text" + inputMode, not type="number": number
 * inputs coerce through floats, change on scroll and reject "1,200". The
 * value stays a string end to end so money never becomes a JS float; the
 * server parses it with decimal and Postgres stores numeric.
 */
export function NumberInput({
  kind = "decimal",
  value,
  defaultValue,
  onValueChange,
  onChange,
  currencySymbol = "$",
  stepper = false,
  step: stepSize = 1,
  decimals = 0,
  minValue,
  maxValue,
  suffix,
  className,
  disabled,
  ...props
}: NumberInputProps) {
  const wiring = useFieldControlProps(props);
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = controlled ? value : inner;

  const update = (next: string) => {
    if (!controlled) setInner(next);
    onValueChange?.(next);
  };

  const fractional = kind === "quantity" && decimals > 0;
  const currentNumber = asDecimal(current) ?? new Decimal(0);

  // Decimal arithmetic on the text, so a fraction survives a step (1.5 + 1
  // is 2.5, not 2) and nothing passes through a float.
  const step = (direction: 1 | -1) => {
    let next: Decimal;
    if (kind === "decimal") {
      const by = new Decimal(String(stepSize));
      next = currentNumber
        .plus(by.times(direction))
        .toDecimalPlaces(by.decimalPlaces(), Decimal.ROUND_HALF_UP);
    } else {
      next = (fractional ? currentNumber : currentNumber.trunc()).plus(direction);
    }
    if (minValue !== undefined) next = Decimal.max(minValue, next);
    if (maxValue !== undefined) next = Decimal.min(maxValue, next);
    // Never "-0".
    update(next.isZero() ? "0" : next.toString());
  };

  const showStepper = stepper && (kind === "quantity" || kind === "decimal");

  const input = (
    <div className="relative min-w-0 flex-1">
      {kind === "money" ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-dust-500"
        >
          {currencySymbol}
        </span>
      ) : null}
      <input
        {...props}
        {...wiring}
        type="text"
        inputMode={kind === "quantity" && !fractional ? "numeric" : "decimal"}
        pattern={fractional ? `[0-9]*(\\.[0-9]{0,${decimals}})?` : patterns[kind]}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={current}
        onChange={(e) => {
          onChange?.(e);
          update(e.target.value);
        }}
        className={cn(
          controlClasses,
          "min-h-12 text-right tabular-nums",
          kind === "money" && "pl-9",
          suffix && "pr-14",
          showStepper && "text-center",
          className,
        )}
      />
      {suffix ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-dust-500"
        >
          {suffix}
        </span>
      ) : null}
    </div>
  );

  if (!showStepper) return input;

  const stepClasses =
    "inline-flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 border-ink bg-card transition-transform duration-200 ease-[var(--ease-spring)] active:scale-90 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:active:scale-100";

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className={stepClasses}
        aria-label="Decrease"
        aria-controls={wiring.id}
        disabled={disabled || (minValue !== undefined && currentNumber.lte(minValue))}
        onClick={() => step(-1)}
      >
        <MinusIcon />
      </button>
      {input}
      <button
        type="button"
        className={stepClasses}
        aria-label="Increase"
        aria-controls={wiring.id}
        disabled={disabled || (maxValue !== undefined && currentNumber.gte(maxValue))}
        onClick={() => step(1)}
      >
        <PlusIcon />
      </button>
    </div>
  );
}
