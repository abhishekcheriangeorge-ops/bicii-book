import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./spinner";

export type ButtonVariant = "solid" | "outline" | "accent" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const variants: Record<ButtonVariant, string> = {
  solid: "bg-ink text-paper hover:bg-dust-700",
  outline: "border-2 border-ink text-ink hover:bg-ink hover:text-paper",
  accent: "bg-yellow text-ink hover:brightness-105",
  ghost: "text-ink hover:bg-dust-100",
  // paper on red is 4.71:1; ink on red (4.11:1) fails AA, so never swap it
  danger: "bg-danger text-danger-fg hover:bg-danger-deep",
};

// Every size clears the 44px tap floor; md matches the public site's 48px.
const sizes: Record<ButtonSize, string> = {
  sm: "min-h-tap px-4 text-xs",
  md: "min-h-12 px-6 text-sm",
  lg: "min-h-14 px-8 text-base",
};

/**
 * Shared class string, exported so a non-button element (a label wrapping a
 * file input, say) can look like a button without pretending to be one.
 */
export function buttonClasses({
  variant = "solid",
  size = "md",
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
} = {}): string {
  return cn(
    // Compresses on press and springs back on release, as on the public site.
    // Pure CSS: `:active` fires on touch as well as mouse.
    "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full font-display font-bold tracking-wide whitespace-nowrap uppercase select-none",
    "transition-[transform,background-color,color,filter] duration-200 ease-[var(--ease-spring)] active:scale-[0.94] motion-reduce:active:scale-100",
    "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
    variants[variant],
    sizes[size],
    fullWidth && "w-full",
    className,
  );
}

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /** Leading icon; hidden while pending so the spinner takes its place. */
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
};

export type ButtonProps = CommonProps &
  Omit<ComponentPropsWithoutRef<"button">, keyof CommonProps> & {
    /**
     * Shows a spinner, sets aria-busy and blocks further presses. Pass the
     * `pending` from useActionState / useFormStatus; financial and stock
     * commits must not be double-submitted.
     */
    pending?: boolean;
    /** Replaces the label while pending, e.g. "Saving…". */
    pendingLabel?: ReactNode;
  };

export function Button({
  variant,
  size,
  fullWidth,
  icon,
  children,
  className,
  pending = false,
  pendingLabel,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={buttonClasses({ variant, size, fullWidth, className })}
      {...props}
    >
      {pending ? <Spinner className="size-4" /> : icon}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

export type ButtonLinkProps = CommonProps &
  Omit<ComponentPropsWithoutRef<typeof Link>, keyof CommonProps>;

/** Navigation that looks like a button. External URLs render a plain <a>. */
export function ButtonLink({
  variant,
  size,
  fullWidth,
  icon,
  children,
  className,
  href,
  ...props
}: ButtonLinkProps) {
  const classes = buttonClasses({ variant, size, fullWidth, className });
  const external = typeof href === "string" && /^(https?:|mailto:|tel:)/.test(href);
  if (external) {
    return (
      <a href={href} className={classes} {...props}>
        {icon}
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={classes} {...props}>
      {icon}
      {children}
    </Link>
  );
}
