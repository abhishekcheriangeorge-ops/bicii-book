"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";

import { Field } from "@/components/ui/field";
import { SearchIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { rememberSearch } from "@/lib/recent-searches";
import { readQuery, withParam } from "@/lib/search-params";

/**
 * A search box that keeps its query in the URL (`?q=`): the page renders
 * the results on the server, so they survive a reload, the back button and
 * a shared link. Typing updates the URL after a short pause, replacing the
 * history entry; Enter searches at once. The previous results stay on
 * screen, with a spinner in the field, until the new ones arrive. What is
 * typed while a slow search loads is kept (the field tells its own
 * searches arriving from a change of URL made elsewhere), and a search
 * still waiting to be sent is dropped when staff open a link or leave.
 */
export function SearchField({
  label,
  hint,
  placeholder = "Search",
  autoFocus = false,
  debounceMs = 300,
  remember = false,
}: {
  label: string;
  hint?: string;
  placeholder?: string;
  autoFocus?: boolean;
  debounceMs?: number;
  /** Keep a query submitted with Enter in this device's recent searches. */
  remember?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const [value, setValue] = useState(urlQuery);
  const [seen, setSeen] = useState(urlQuery);
  // Queries this field sent (router.replace) that the URL has not shown yet.
  const [sent, setSent] = useState<readonly string[]>([]);
  const [pending, startTransition] = useTransition();
  const timer = useRef<number | undefined>(undefined);

  if (urlQuery !== seen) {
    setSeen(urlQuery);
    const at = sent.indexOf(urlQuery);
    if (at >= 0) {
      // Our own search arriving, perhaps after more was typed (a slow
      // connection): keep what is in the field.
      setSent(sent.slice(at + 1));
    } else {
      // The URL changed without us (back/forward, a recent-search link): show it.
      setSent([]);
      if (readQuery(value) !== urlQuery) setValue(urlQuery);
    }
  }

  const go = (raw: string) => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const q = readQuery(raw);
    // Where the URL is heading: the last query sent, else what it shows.
    if (q === (sent.at(-1) ?? readQuery(urlQuery))) return;
    setSent((list) => [...list, q]);
    startTransition(() => {
      router.replace(`${pathname}${withParam(searchParams.toString(), "q", q)}`, { scroll: false });
    });
  };
  // The debounce timer calls the latest go (this render's URL and state).
  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  });

  // A search still waiting to be sent must not fire after staff have moved
  // on: tapping a result or a nav link (the timer would replace the page
  // being opened with this list), or this page going away.
  useEffect(() => {
    const cancel = () => {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    };
    const onClick = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest("a[href]")) cancel();
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      cancel();
    };
  }, []);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    go(value);
    if (remember) rememberSearch(value);
  };

  return (
    <form role="search" onSubmit={onSubmit} className="flex flex-col">
      <Field label={label} hideLabel hint={hint}>
        <div className="relative">
          <Input
            type="search"
            name="q"
            value={value}
            onChange={(e) => {
              const next = e.target.value;
              setValue(next);
              window.clearTimeout(timer.current);
              timer.current = window.setTimeout(() => goRef.current(next), debounceMs);
            }}
            autoFocus={autoFocus}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            placeholder={placeholder}
            prefix={<SearchIcon className="size-5" />}
          />
          {pending ? (
            <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-dust-500">
              <Spinner label="Searching" className="size-4" />
            </span>
          ) : null}
        </div>
      </Field>
    </form>
  );
}
