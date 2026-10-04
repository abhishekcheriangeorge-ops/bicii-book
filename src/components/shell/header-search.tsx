"use client";

import Form from "next/form";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { SearchIcon } from "@/components/ui/icons";
import { rememberSearch } from "@/lib/recent-searches";

/**
 * The global search field in the header (SPEC §20): customers and bikes by
 * name, phone, email, serial number or B- number. Enter opens /search with
 * the results (a GET form, so it works before hydration too). "/" focuses
 * it from anywhere on a keyboard (iPad, desktop). On /search itself the
 * page has its own, larger field, so this one steps aside.
 */
export function HeaderSearch() {
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);
  const onSearchPage = pathname === "/search";

  useEffect(() => {
    if (onSearchPage) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")
      ) {
        return;
      }
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onSearchPage]);

  if (onSearchPage) return <div className="min-w-0 flex-1" />;

  return (
    <Form
      action="/search"
      role="search"
      className="relative min-w-0 flex-1 md:max-w-md"
      onSubmit={() => {
        const q = inputRef.current?.value ?? "";
        rememberSearch(q);
      }}
    >
      <label htmlFor="header-search" className="sr-only">
        Search customers and bikes
      </label>
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink"
      />
      <input
        ref={inputRef}
        id="header-search"
        type="search"
        name="q"
        placeholder="Search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        className="min-h-tap w-full rounded-full border-2 border-ink bg-card pr-4 pl-11 text-base text-ink placeholder:text-dust-500"
      />
    </Form>
  );
}
