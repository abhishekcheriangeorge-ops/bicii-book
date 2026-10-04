import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type IconButtonProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "children" | "aria-label"
> & {
  /** Required: an icon has no text, so this is the control's only name. */
  "aria-label": string;
  icon: ReactNode;
  /** "inherit" takes the surrounding text colour (toasts, ink bands). */
  variant?: "ghost" | "outline" | "solid" | "inherit";
  size?: "md" | "lg";
};

const variants = {
  ghost: "text-ink hover:bg-dust-100",
  outline: "border-2 border-ink text-ink hover:bg-ink hover:text-paper",
  solid: "bg-ink text-paper hover:bg-dust-700",
  inherit: "text-current hover:bg-current/10",
} as const;

/** Square-on-round icon control; never smaller than the 44px tap floor. */
export function IconButton({
  icon,
  variant = "ghost",
  size = "md",
  className,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full",
        "transition-[transform,background-color,color] duration-200 ease-[var(--ease-spring)] active:scale-90 motion-reduce:active:scale-100",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "md" ? "size-tap" : "size-14",
        variants[variant],
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  );
}
