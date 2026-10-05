"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useFieldControlProps } from "./field";
import { IconButton } from "./icon-button";
import { CloseIcon, SearchIcon } from "./icons";
import { controlClasses } from "./input";
import { Spinner } from "./spinner";

export type PickerOption = {
  /** Stable key; submitted under `name` when the picker is in a form. */
  id: string;
  label: string;
  /** Second line: phone number, serial, SKU… */
  description?: string;
  /** Right-aligned meta: stock on hand, short ID, price. */
  meta?: string;
  disabled?: boolean;
};

export type SearchPickerProps<T extends PickerOption = PickerOption> = {
  /**
   * Returns matches for the query. May be a Server Action. Results for a
   * stale query are discarded, so slow responses never overwrite newer ones.
   */
  search: (query: string) => Promise<T[]>;
  /** A choice was made, or (null) the selection was cleared. */
  onSelect?: (option: T | null) => void;
  /** Controlled selection, shown in the input when not editing. */
  value?: T | null;
  /** Hidden input name: submits the selected option's id with the form. */
  name?: string;
  placeholder?: string;
  debounceMs?: number;
  minChars?: number;
  /** Shown when a search returns nothing. */
  emptyMessage?: ReactNode;
  /** Custom row; defaults to label / description / meta. */
  renderOption?: (option: T) => ReactNode;
  /**
   * The last option of the list, e.g. "Create new customer": reached with
   * the arrow keys and Enter like any result, or tapped. Receives the query.
   */
  action?: {
    label: (query: string) => ReactNode;
    onSelect: (query: string) => void;
  };
  /**
   * Whether the selection can be removed (clear button, emptying the
   * field, Escape on an empty field). Defaults to `!required`.
   */
  clearable?: boolean;
  disabled?: boolean;
  id?: string;
  "aria-describedby"?: string;
  required?: boolean;
  className?: string;
};

type State<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "results"; items: T[] }
  | { kind: "error"; message: string };

/**
 * Searchable picker for large catalogs (SPEC §22: never giant dropdowns).
 *
 * WAI-ARIA 1.2 combobox with a listbox popup and list autocomplete: focus
 * stays in the input, `aria-activedescendant` points at the highlighted
 * option. Keys: ↓/↑ move (wrapping, through the results and then the
 * `action` row), Enter selects, Escape closes, then clears the query, then
 * (clearable) the selection; Tab closes. Emptying the field and leaving it
 * also clears a clearable selection. Wrap in <Field> for a label.
 */
export function SearchPicker<T extends PickerOption = PickerOption>({
  search,
  onSelect,
  value,
  name,
  placeholder = "Search…",
  debounceMs = 200,
  minChars = 1,
  emptyMessage = "No matches",
  renderOption,
  action,
  clearable,
  disabled = false,
  className,
  ...rest
}: SearchPickerProps<T>) {
  const wiring = useFieldControlProps(rest);
  const canClear = clearable ?? !wiring.required;
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State<T>>({ kind: "idle" });
  const [active, setActive] = useState(-1);
  const [innerSelected, setInnerSelected] = useState<T | null>(null);
  const selected = value !== undefined ? value : innerSelected;
  const requestSeq = useRef(0);
  const searchRef = useRef(search);

  useEffect(() => {
    searchRef.current = search;
  });

  const timer = useRef<number | undefined>(undefined);

  // Cancel any pending search on unmount
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      requestSeq.current++;
    },
    [],
  );

  const cancelSearch = () => {
    window.clearTimeout(timer.current);
    requestSeq.current++;
  };

  // Debounced search, driven from the input's events. Each run bumps the
  // sequence; only the latest request may write results.
  const runSearch = (raw: string) => {
    window.clearTimeout(timer.current);
    const q = raw.trim();
    const seq = ++requestSeq.current;
    if (q.length < minChars) {
      setState({ kind: "idle" });
      setActive(-1);
      return;
    }
    setState({ kind: "loading" });
    timer.current = window.setTimeout(() => {
      searchRef.current(q).then(
        (items) => {
          if (seq !== requestSeq.current) return;
          setState({ kind: "results", items });
          setActive(items.findIndex((i) => !i.disabled));
        },
        (err: unknown) => {
          if (seq !== requestSeq.current) return;
          setState({
            kind: "error",
            message: err instanceof Error ? err.message : "Search failed",
          });
          setActive(-1);
        },
      );
    }, debounceMs);
  };

  const items = state.kind === "results" ? state.items : [];
  const expanded = open && state.kind !== "idle";
  const optionId = (i: number) => `${listId}-opt-${i}`;
  // The action row is the option after the last result.
  const showAction = Boolean(action) && (state.kind === "results" || state.kind === "error");
  const actionIndex = showAction ? items.length : -1;
  const optionCount = items.length + (showAction ? 1 : 0);
  const isEnabled = (i: number) =>
    i === actionIndex || (items[i] !== undefined && !items[i].disabled);

  const close = () => {
    cancelSearch();
    setEditing(false);
    setOpen(false);
    setQuery("");
    setState({ kind: "idle" });
    setActive(-1);
  };

  const clear = () => {
    if (!selected) return;
    setInnerSelected(null);
    onSelect?.(null);
  };

  const choose = (option: T) => {
    if (option.disabled) return;
    setInnerSelected(option);
    close();
    onSelect?.(option);
  };

  const runAction = () => {
    if (!action) return;
    const q = query.trim();
    close();
    action.onSelect(q);
  };

  const move = (delta: 1 | -1) => {
    if (optionCount === 0) return;
    let i = active;
    for (let n = 0; n < optionCount; n++) {
      i = (i + delta + optionCount) % optionCount;
      if (isEnabled(i)) {
        setActive(i);
        // Keep the highlighted option in view in a long list
        document.getElementById(optionId(i))?.scrollIntoView?.({ block: "nearest" });
        return;
      }
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) {
          setOpen(true);
          if (!editing) {
            const seed = selected?.label ?? "";
            setEditing(true);
            setQuery(seed);
            runSearch(seed);
          }
          return;
        }
        move(1);
        return;
      case "ArrowUp":
        e.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        move(-1);
        return;
      case "Enter":
        if (expanded && active >= 0 && active === actionIndex) {
          e.preventDefault();
          runAction();
        } else if (expanded && active >= 0 && items[active]) {
          e.preventDefault();
          choose(items[active]);
        }
        return;
      case "Escape":
        if (expanded) {
          e.preventDefault();
          setOpen(false);
        } else if (query) {
          e.preventDefault();
          setQuery("");
          runSearch("");
        } else if (canClear && selected) {
          e.preventDefault();
          clear();
        }
        return;
      case "Tab":
        setOpen(false);
        return;
    }
  };

  const inputValue = editing ? query : (selected?.label ?? "");

  return (
    <div className={cn("relative", className)}>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-4 flex h-12 items-center text-dust-500"
      >
        <SearchIcon />
      </span>
      <input
        {...wiring}
        ref={inputRef}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        aria-busy={state.kind === "loading" || undefined}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        placeholder={placeholder}
        disabled={disabled}
        value={inputValue}
        onChange={(e) => {
          setEditing(true);
          setOpen(true);
          setQuery(e.target.value);
          runSearch(e.target.value);
        }}
        onFocus={(e) => {
          if (!editing && selected) e.currentTarget.select();
        }}
        onBlur={() => {
          // Emptying the field and leaving it removes the choice.
          if (editing && query.trim() === "" && canClear) clear();
          close();
        }}
        onKeyDown={onKeyDown}
        className={cn(controlClasses, "min-h-12 pr-12 pl-12")}
      />
      {state.kind === "loading" ? (
        <span className="pointer-events-none absolute top-0 right-4 flex h-12 items-center text-dust-500">
          <Spinner className="size-4" />
        </span>
      ) : canClear && selected && !editing && !disabled ? (
        <span className="absolute top-0 right-0.5 flex h-12 items-center">
          <IconButton
            aria-label={`Clear ${selected.label}`}
            icon={<CloseIcon className="size-4" />}
            onClick={() => {
              clear();
              inputRef.current?.focus();
            }}
          />
        </span>
      ) : null}
      {name ? <input type="hidden" name={name} value={selected?.id ?? ""} /> : null}

      <div
        hidden={!expanded}
        className="absolute inset-x-0 top-full z-40 mt-2 overflow-hidden rounded-2xl border-2 border-ink bg-card shadow-[0_12px_32px_rgb(5_7_7/0.14)]"
        // Keep focus in the input when tapping inside the popup (blur closes it)
        onMouseDown={(e) => e.preventDefault()}
      >
        <ul
          id={listId}
          role="listbox"
          aria-label="Search results"
          className="max-h-[min(22rem,60dvh)] overflow-y-auto overscroll-contain p-1 empty:hidden"
        >
          {items.map((option, i) => (
            <li
              key={option.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              aria-disabled={option.disabled || undefined}
              onClick={() => choose(option)}
              onMouseMove={() => !option.disabled && i !== active && setActive(i)}
              className={cn(
                "flex min-h-tap cursor-pointer items-center gap-3 rounded-xl px-3 py-2",
                i === active && "bg-dust-100",
                option.disabled && "cursor-not-allowed opacity-50",
              )}
            >
              {renderOption ? (
                renderOption(option)
              ) : (
                <>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{option.label}</span>
                    {option.description ? (
                      <span className="truncate text-sm text-dust-500">{option.description}</span>
                    ) : null}
                  </span>
                  {option.meta ? (
                    <span className="shrink-0 text-dense text-dust-700 tabular-nums">
                      {option.meta}
                    </span>
                  ) : null}
                </>
              )}
            </li>
          ))}
          {showAction && action ? (
            <li
              id={optionId(actionIndex)}
              role="option"
              aria-selected={active === actionIndex}
              onClick={runAction}
              onMouseMove={() => active !== actionIndex && setActive(actionIndex)}
              className={cn(
                "mt-1 flex min-h-tap cursor-pointer items-center gap-2 rounded-xl border-t border-hairline px-3 py-2 font-display text-sm font-bold tracking-wide uppercase",
                active === actionIndex && "bg-dust-100",
              )}
            >
              {action.label(query.trim())}
            </li>
          ) : null}
        </ul>
        {state.kind === "results" && items.length === 0 ? (
          <p className="px-4 py-3 text-sm text-dust-500">{emptyMessage}</p>
        ) : null}
        {state.kind === "loading" ? (
          <p className="px-4 py-3 text-sm text-dust-500">Searching…</p>
        ) : null}
        {state.kind === "error" ? (
          <p className="px-4 py-3 text-sm font-medium text-danger-deep">{state.message}</p>
        ) : null}
      </div>
      <span className="sr-only" aria-live="polite">
        {expanded && state.kind === "results"
          ? `${items.length} result${items.length === 1 ? "" : "s"}`
          : ""}
      </span>
    </div>
  );
}
