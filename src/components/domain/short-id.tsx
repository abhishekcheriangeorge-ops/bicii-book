import { cn } from "@/lib/cn";

/**
 * A human short ID (B-000123): monospaced so similar digits stay apart,
 * never wrapped. `large` is the identity header of a record page, where the
 * number on the bike's label has to be easy to compare by eye.
 */
export function ShortId({
  value,
  large = false,
  className,
}: {
  value: string;
  large?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center font-mono font-bold tracking-wide whitespace-nowrap tabular-nums",
        large
          ? "rounded-xl bg-ink px-3 py-1.5 text-2xl text-paper sm:text-3xl"
          : "rounded-md bg-dust-100 px-2 py-0.5 text-sm text-dust-700",
        className,
      )}
    >
      {value}
    </span>
  );
}
