import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { NOT_TRACKED, formatSignedMoney } from "@/lib/reports";

export type TileTone = "neutral" | "danger" | "waiting";

const valueTone: Record<TileTone, string> = {
  neutral: "text-ink",
  danger: "text-danger-deep",
  waiting: "text-waiting-deep",
};

const tileClasses =
  "flex h-full min-h-tap min-w-0 flex-col gap-1 rounded-2xl border border-hairline bg-card px-4 py-3";

/**
 * One figure on Today (server): a `<dl>` whose `<dt>` is the label and
 * `<dd>` the value, so a screen reader reads them together (as Phase 0's
 * placeholders did). With `href` the whole tile is one link named
 * "Label: value". `notTracked` is the placeholder treatment for a measure a
 * later phase lights up: "—" with NOT_TRACKED for screen readers and
 * the hint saying what brings it. `tone` colours the value; the label
 * always says what it means.
 */
export function StatTile({
  label,
  value,
  valueText,
  hint,
  href,
  tone = "neutral",
  notTracked = false,
  large = false,
  className,
}: {
  label: string;
  value: ReactNode;
  /** The value as words for the link's name, when `value` is not plain text. */
  valueText?: string;
  hint?: ReactNode;
  href?: string | null;
  tone?: TileTone;
  notTracked?: boolean;
  large?: boolean;
  className?: string;
}) {
  const body = (
    <>
      <dl className="@container flex flex-col gap-1">
        <dt className="eyebrow text-dust-500">{label}</dt>
        <dd
          className={cn(
            "font-display leading-none font-extrabold tabular-nums",
            large ? "text-5xl" : "text-3xl sm:text-4xl",
            notTracked ? "text-dust-500" : valueTone[tone],
          )}
        >
          {notTracked ? (
            <>
              <span aria-hidden="true">—</span>
              <span className="sr-only">{NOT_TRACKED}</span>
            </>
          ) : (
            value
          )}
        </dd>
      </dl>
      {hint ? <p className="text-sm text-dust-500">{hint}</p> : null}
    </>
  );
  if (href && !notTracked) {
    const name = `${label}: ${valueText ?? (typeof value === "string" || typeof value === "number" ? String(value) : "")}`;
    return (
      <Link
        href={href}
        aria-label={name}
        className={cn(tileClasses, "transition-colors hover:bg-dust-100", className)}
      >
        {body}
      </Link>
    );
  }
  return <div className={cn(tileClasses, className)}>{body}</div>;
}

/**
 * The amount's font size for its length: a percentage of the tile's width
 * (`cqi` of the `<dl>`, a size container) chosen so that many characters
 * of the display face fit, capped at the usual tile size and floored at
 * 1rem. So "$400.00" stays large in a half-width phone tile and
 * "$12,345.67" shrinks to fit instead of running into the next tile.
 * Literal classes, so Tailwind generates each.
 */
export function moneySizeClass(chars: number, large = false): string {
  if (large) {
    if (chars <= 9) return "text-[clamp(1rem,17cqi,3rem)]";
    if (chars <= 11) return "text-[clamp(1rem,13.5cqi,3rem)]";
    return "text-[clamp(1rem,11cqi,3rem)]";
  }
  if (chars <= 7) return "text-[clamp(1rem,21cqi,2.25rem)]";
  if (chars <= 9) return "text-[clamp(1rem,16.5cqi,2.25rem)]";
  if (chars <= 11) return "text-[clamp(1rem,13.5cqi,2.25rem)]";
  return "text-[clamp(1rem,11cqi,2.25rem)]";
}

/**
 * An amount on Today (server): formatted in its currency, with the
 * currency code beside it so the tile says which money it is. The amount
 * scales to the tile (moneySizeClass) and the code wraps under it when
 * both do not fit on one line, so neither leaves its card at any width.
 */
export function MoneyTile({
  label,
  amount,
  currency,
  hint,
  large = false,
  tone = "neutral",
  className,
}: {
  label: string;
  /** Fixed-2 string from the database. */
  amount: string;
  currency: string;
  hint?: ReactNode;
  large?: boolean;
  tone?: TileTone;
  className?: string;
}) {
  const text = formatSignedMoney(amount, currency);
  return (
    <StatTile
      label={label}
      large={large}
      tone={tone}
      hint={hint}
      className={className}
      value={
        <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
          <span className={cn("whitespace-nowrap", moneySizeClass(text.length, large))}>
            {text}
          </span>
          <span className="font-sans text-sm font-semibold text-dust-500">{currency}</span>
        </span>
      }
    />
  );
}

/** A grid of tiles: two columns on a phone, three or four from md. */
export function TileGrid({
  columns = 4,
  label,
  children,
}: {
  columns?: 3 | 4;
  label?: string;
  children: ReactNode;
}) {
  return (
    <div
      role={label ? "group" : undefined}
      aria-label={label}
      className={cn(
        "grid grid-cols-2 gap-3",
        columns === 3 ? "md:grid-cols-3" : "md:grid-cols-3 lg:grid-cols-4",
      )}
    >
      {children}
    </div>
  );
}

/** A Today section: an h2 and its content. */
export function TodaySection({
  id,
  title,
  description,
  actions,
  children,
  className,
}: {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn("flex scroll-mt-20 flex-col gap-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={id} className="text-2xl leading-tight">
            {title}
          </h2>
          {description ? <p className="text-sm text-dust-500">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
