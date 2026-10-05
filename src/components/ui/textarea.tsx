"use client";

import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/cn";
import { useFieldControlProps } from "./field";
import { controlClasses } from "./input";

export type TextareaProps = ComponentPropsWithRef<"textarea">;

export function Textarea({ className, rows = 4, ...props }: TextareaProps) {
  const wiring = useFieldControlProps(props);
  return (
    <textarea
      rows={rows}
      {...props}
      {...wiring}
      className={cn(controlClasses, "min-h-24 py-3 leading-relaxed", className)}
    />
  );
}
