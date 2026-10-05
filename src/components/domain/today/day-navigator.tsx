"use client";

import Form from "next/form";
import Link from "next/link";
import { useEffect, useRef } from "react";

import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const linkClasses =
  "inline-flex min-h-tap items-center rounded-full px-3 font-display text-xs font-bold tracking-wide uppercase";

/**
 * Moving between shop days on Today (client only for auto-submit): links
 * to the previous day, today and the next day (disabled on today), and a
 * GET form with a date input. The form is `next/form`, so it works before
 * hydration with "Go"; once hydrated, picking a date submits it (after a
 * short pause, so typing a year digit by digit does not jump to the year
 * 2). `max` is
 * the last day that can be asked for: the database's today when it is
 * showing today (D35).
 */
export function DayNavigator({
  day,
  isToday,
  max,
  previousHref,
  nextHref,
}: {
  day: string;
  isToday: boolean;
  max: string;
  previousHref: string;
  /** Null on today. */
  nextHref: string | null;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
      <nav aria-label="Days" className="flex flex-wrap items-center gap-1">
        <Link href={previousHref} className={cn(linkClasses, "hover:bg-dust-100")}>
          <span aria-hidden="true">‹&nbsp;</span>Previous day
        </Link>
        <Link
          href="/"
          aria-current={isToday ? "page" : undefined}
          className={cn(linkClasses, isToday ? "bg-ink text-paper" : "hover:bg-dust-100")}
        >
          Today
        </Link>
        {nextHref ? (
          <Link href={nextHref} className={cn(linkClasses, "hover:bg-dust-100")}>
            Next day<span aria-hidden="true">&nbsp;›</span>
          </Link>
        ) : (
          <span role="link" aria-disabled="true" className={cn(linkClasses, "text-dust-500")}>
            Next day<span aria-hidden="true">&nbsp;›</span>
          </span>
        )}
      </nav>
      <Form action="/" className="flex items-center gap-2">
        <label htmlFor="today-day" className="sr-only">
          Show day
        </label>
        <input
          key={day}
          id="today-day"
          type="date"
          name="day"
          defaultValue={day}
          max={max}
          required
          onChange={(e) => {
            // Typing a year digit by digit passes through "0002-…": wait
            // for a pause and a plausible full date before navigating.
            const input = e.currentTarget;
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => {
              const year = Number(input.value.slice(0, 4));
              if (input.value && input.validity.valid && year >= 2000 && input.value !== day) {
                input.form?.requestSubmit();
              }
            }, 600);
          }}
          className="min-h-tap rounded-xl border border-hairline bg-card px-3 text-base tabular-nums"
        />
        <button type="submit" className={buttonClasses({ variant: "outline", size: "sm" })}>
          Go
        </button>
      </Form>
    </div>
  );
}
