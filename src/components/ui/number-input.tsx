"use client";

import { useState, type ChangeEvent, type ComponentPropsWithRef } from "react";
import { cn } from "@/lib/cn";
import { MinusIcon, PlusIcon } from "./icons";
import { controlClasses } from "./input";
import { useFieldControlProps } from "./field";

export type NumberInputKind = "money" | "quantity" | "decimal";

export type NumberInputProps = Omit<
  ComponentPropsWithRef<"input">,
  "type" | "inputMode" | "value" | "defaultValue" | "onChange" | "prefix" | "size"
> & {
  /**
   * money: two decimals, currency prefix, decimal keypad.
   * quantity: whole numbers, numeric keypad, optional −/+ steppers.
   * decimal: free decimal (rates, hours).
   */
  kind?: NumberInputKind;
  value?: string;
  defaultValue?: string;
  /** Receives the raw text; parse with lib/money (parseMoney) at the boundary. */
  onValueChange?: (value: string) => void;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  /** Currency symbol shown before money values. Default "$" (SGD). */
  currencySymbol?: string;
  /** Show −/+ buttons (quantity only). */
  stepper?: boolean;
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

  const step = (delta: number) => {
    const n = Number.parseInt(current || "0", 10);
    let next = (Number.isNaN(n) ? 0 : n) + delta;
    if (minValue !== undefined) next = Math.max(minValue, next);
    if (maxValue !== undefined) next = Math.min(maxValue, next);
    update(String(next));
  };

  const showStepper = stepper && kind === "quantity";
  const asInt = Number.parseInt(current || "0", 10);

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
        inputMode={kind === "quantity" ? "numeric" : "decimal"}
        pattern={patterns[kind]}
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
        disabled={disabled || (minValue !== undefined && asInt <= minValue)}
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
        disabled={disabled || (maxValue !== undefined && asInt >= maxValue)}
        onClick={() => step(1)}
      >
        <PlusIcon />
      </button>
    </div>
  );
}
