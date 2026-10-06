"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Sheet } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import { EARLIEST_SHOP_DAY, parseShopDay } from "@/lib/dates";
import {
  BASES,
  BASIS_VALUES,
  PERIODS,
  PERIOD_LABELS,
  PERIOD_NOUNS,
  customRangeError,
  formatRangeLabel,
  periodRange,
  reportHref,
  shiftPeriod,
  shiftRange,
  type DayRange,
  type ReportBasis,
  type ReportPeriod,
} from "@/lib/period-reports";

/**
 * Navigates /reports by replacing its URL inside a transition (the page
 * renders on the server, so the state survives a reload, the back button
 * and a shared link), keeping scroll and focus where they are, and reports
 * whether a navigation is under way for the spinner.
 */
function useReportNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const go = (overrides: Record<string, string | null>) => {
    const href = reportHref(pathname, new URLSearchParams(searchParams.toString()), overrides);
    startTransition(() => {
      router.replace(href, { scroll: false });
    });
  };
  return { go, pending };
}

/** Whether a key press comes from a place that types text (where `[` and `]` are characters). */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = (target as HTMLInputElement).type;
  return !["button", "checkbox", "radio", "submit", "reset", "range", "color"].includes(type);
}

/**
 * The period controls of /reports (sticky under the app header): the
 * period (Day, Week, Month, Custom), a stepper, the range as a button that
 * opens a date picker (or the Custom sheet), and Today when the shown
 * period does not contain today. `[` and `]` step the period when focus is
 * not in a text field (iPad keyboards and desktops). Everything lives in
 * the URL (`period, date, from, to`).
 */
export function ReportControls({
  period,
  anchor,
  from,
  to,
  today,
  error,
}: {
  period: ReportPeriod;
  anchor: string;
  from: string;
  to: string;
  /** The shop's today ('YYYY-MM-DD'). */
  today: string;
  /** The URL's custom range could not be used (a BUSINESS_ERRORS message). */
  error?: string;
}) {
  const { go, pending } = useReportNavigation();
  const [customOpen, setCustomOpen] = useState(false);
  const dateRef = useRef<HTMLInputElement>(null);

  const noun = PERIOD_NOUNS[period];
  const stepped = (delta: 1 | -1): DayRange =>
    period === "custom"
      ? shiftRange({ from, to }, delta)
      : periodRange(period, shiftPeriod(period, anchor, delta));
  const previous = stepped(-1);
  const next = stepped(1);
  const canPrevious = previous.from >= EARLIEST_SHOP_DAY;
  const canNext = next.from <= today;
  const showToday = period !== "custom" && !(from <= today && today <= to);

  const step = (delta: 1 | -1) => {
    if (delta === -1 ? !canPrevious : !canNext) return;
    if (period === "custom")
      go({ from: (delta === 1 ? next : previous).from, to: (delta === 1 ? next : previous).to });
    else go({ date: shiftPeriod(period, anchor, delta) });
  };
  // The latest step for the keyboard listener.
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return;
      if (document.querySelector("[role=dialog]")) return;
      if (e.key === "[") stepRef.current(-1);
      else if (e.key === "]") stepRef.current(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const choosePeriod = (value: ReportPeriod) => {
    if (value === "custom") {
      setCustomOpen(true);
      return;
    }
    go({ period: value, date: anchor });
  };

  const openPicker = () => {
    if (period === "custom") {
      setCustomOpen(true);
      return;
    }
    const input = dateRef.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.focus();
    }
  };

  return (
    <div
      className="sticky top-[calc(4rem+env(safe-area-inset-top))] z-20 -mx-4 flex flex-col gap-2 border-b border-hairline bg-paper/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border sm:px-3"
      aria-busy={pending || undefined}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SegmentedControl
          label="Period"
          options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABELS[p] }))}
          value={period}
          onValueChange={choosePeriod}
        />
        <div className="flex flex-wrap items-center gap-1">
          <IconButton
            aria-label={`Previous ${noun}`}
            icon={<ChevronLeftIcon className="size-5" />}
            onClick={() => step(-1)}
            disabled={!canPrevious}
          />
          <button
            type="button"
            onClick={openPicker}
            className="inline-flex min-h-tap items-center rounded-full px-3 font-semibold tabular-nums hover:bg-dust-100"
            aria-label={`${formatRangeLabel(from, to)}. Choose ${period === "custom" ? "a range" : `a ${noun}`}`}
          >
            {formatRangeLabel(from, to)}
          </button>
          <IconButton
            aria-label={`Next ${noun}`}
            icon={<ChevronRightIcon className="size-5" />}
            onClick={() => step(1)}
            disabled={!canNext}
          />
          {showToday ? (
            <Button variant="ghost" size="sm" onClick={() => go({ date: today })}>
              Today
            </Button>
          ) : null}
          {pending ? <Spinner label="Loading the report" className="size-4 text-dust-500" /> : null}
        </div>
        {period !== "custom" ? (
          <input
            ref={dateRef}
            key={anchor}
            type="date"
            aria-label={`Choose a ${noun}`}
            tabIndex={-1}
            defaultValue={anchor}
            min={EARLIEST_SHOP_DAY}
            max={today}
            onChange={(e) => {
              const day = parseShopDay(e.currentTarget.value);
              if (day !== null && day >= EARLIEST_SHOP_DAY && day !== anchor) go({ date: day });
            }}
            className="sr-only"
          />
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger-deep">
          {error} Showing the week of {formatRangeLabel(from, to)} instead.
        </p>
      ) : null}
      <CustomRangeSheet
        open={customOpen}
        onOpenChange={setCustomOpen}
        from={from}
        to={to}
        today={today}
        onApply={(range) => {
          setCustomOpen(false);
          go({ period: "custom", from: range.from, to: range.to });
        }}
      />
    </div>
  );
}

/** The Custom range sheet: From and To, checked before it closes; the values stay on an error. */
function CustomRangeSheet({
  open,
  onOpenChange,
  from,
  to,
  today,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  from: string;
  to: string;
  today: string;
  onApply: (range: DayRange) => void;
}) {
  const [values, setValues] = useState({ from, to });
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState({ open, from, to });
  // Opening again starts from the range on screen.
  if (seen.open !== open || seen.from !== from || seen.to !== to) {
    setSeen({ open, from, to });
    if (open && !seen.open) {
      setValues({ from, to });
      setError(null);
    }
  }
  const apply = () => {
    const problem = customRangeError(values.from, values.to);
    if (problem) {
      setError(problem);
      return;
    }
    onApply(values);
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Custom range"
      description="Any range of shop days up to two years."
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={apply}>Apply</Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <Field label="From">
          <Input
            type="date"
            value={values.from}
            min={EARLIEST_SHOP_DAY}
            max={today}
            onChange={(e) => setValues((v) => ({ ...v, from: e.target.value }))}
          />
        </Field>
        <Field label="To">
          <Input
            type="date"
            value={values.to}
            min={EARLIEST_SHOP_DAY}
            onChange={(e) => setValues((v) => ({ ...v, to: e.target.value }))}
          />
        </Field>
        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-deep">
            {error}
          </p>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

/**
 * The date basis (D100), financial section only: which date a line counts
 * on, with the basis's description under it. Changing it keeps the period
 * and the breakdown dimension.
 */
export function BasisControl({ basis }: { basis: ReportBasis }) {
  const { go, pending } = useReportNavigation();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          label="Date basis"
          options={BASIS_VALUES.map((b) => ({ value: b, label: BASES[b].label }))}
          value={basis}
          onValueChange={(value) => go({ basis: value })}
        />
        {pending ? (
          <Spinner label="Loading the report" className={cn("size-4 text-dust-500")} />
        ) : null}
      </div>
      <p className="text-sm text-dust-500">{BASES[basis].description}</p>
    </div>
  );
}
