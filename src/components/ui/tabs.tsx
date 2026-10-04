"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type TabItem = {
  id: string;
  label: ReactNode;
  content: ReactNode;
};

export type TabsProps = {
  /** Accessible name for the tab list, e.g. "Job sections". */
  label: string;
  items: readonly TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (id: string) => void;
  className?: string;
};

/**
 * WAI-ARIA tabs with automatic activation: arrows move and show, Home/End
 * jump, Tab moves from the tab list into the panel. Panels that are not
 * selected are not rendered.
 */
export function Tabs({ label, items, value, defaultValue, onValueChange, className }: TabsProps) {
  const base = useId();
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? items[0]?.id);
  const current = controlled ? value : inner;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const index = Math.max(
    0,
    items.findIndex((t) => t.id === current),
  );

  const select = (i: number) => {
    const item = items[i];
    if (!item) return;
    if (!controlled) setInner(item.id);
    onValueChange?.(item.id);
    refs.current[i]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const last = items.length - 1;
    const map: Record<string, number> = {
      ArrowRight: i === last ? 0 : i + 1,
      ArrowLeft: i === 0 ? last : i - 1,
      Home: 0,
      End: last,
    };
    if (!(e.key in map)) return;
    e.preventDefault();
    select(map[e.key]);
  };

  const active = items[index];

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        className="flex [scrollbar-width:none] gap-1 overflow-x-auto border-b-2 border-hairline"
      >
        {items.map((item, i) => {
          const selected = i === index;
          return (
            <button
              key={item.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              id={`${base}-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${base}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(i)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                "relative -mb-0.5 inline-flex min-h-tap shrink-0 cursor-pointer items-center px-4 font-display text-sm font-bold tracking-wide whitespace-nowrap uppercase",
                "border-b-[3px] transition-colors duration-150",
                selected
                  ? "border-ink text-ink"
                  : "border-transparent text-dust-500 hover:text-ink",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {active ? (
        <div
          id={`${base}-panel-${active.id}`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${active.id}`}
          tabIndex={0}
          className="pt-4"
        >
          {active.content}
        </div>
      ) : null}
    </div>
  );
}
