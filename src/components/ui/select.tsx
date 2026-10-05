"use client";

import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/cn";
import { useFieldControlProps } from "./field";
import { controlClasses } from "./input";

export type SelectProps = ComponentPropsWithRef<"select">;

/**
 * A native select, styled like Input. Only for short fixed lists (fewer
 * than 15 options, e.g. a service's category); anything that grows uses
 * SearchPicker (SPEC §22: never giant dropdowns).
 */
export function Select({ className, children, ...props }: SelectProps) {
  const wiring = useFieldControlProps(props);
  return (
    <select {...props} {...wiring} className={cn(controlClasses, "min-h-12 pr-10", className)}>
      {children}
    </select>
  );
}
