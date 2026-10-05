/**
 * Recent searches, kept per device in localStorage (never on the server:
 * they are a convenience, not data). Every access is wrapped: storage can be
 * missing, full, or throw on access (Safari private mode, blocked site data).
 */

export const RECENT_SEARCHES_KEY = "bicii.recent-searches.v1";
export const MAX_RECENT_SEARCHES = 8;
/** Fired on window when this tab changes the list (the `storage` event covers other tabs). */
export const RECENT_SEARCHES_EVENT = "bicii:recent-searches";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function announce() {
  try {
    window.dispatchEvent(new Event(RECENT_SEARCHES_EVENT));
  } catch {
    // Not in a browser.
  }
}

/** The stored list from its raw JSON; [] for anything malformed. */
export function parseRecentSearches(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is string => typeof v === "string" && v.trim() !== "")
      .slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

/** The raw stored value ("" when unavailable): a stable snapshot for useSyncExternalStore. */
export function recentSearchesSnapshot(storage: StorageLike | null = defaultStorage()): string {
  try {
    return storage?.getItem(RECENT_SEARCHES_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Calls `onChange` when the list changes in this tab or another one. */
export function subscribeRecentSearches(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === RECENT_SEARCHES_KEY) onChange();
  };
  window.addEventListener(RECENT_SEARCHES_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(RECENT_SEARCHES_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Newest first; [] when storage is unavailable or holds something else. */
export function readRecentSearches(storage: StorageLike | null = defaultStorage()): string[] {
  return parseRecentSearches(recentSearchesSnapshot(storage));
}

/**
 * Puts `query` first (case-insensitive duplicates removed), keeps the
 * newest eight, and returns the new list. Blank queries change nothing.
 */
export function rememberSearch(
  query: string,
  storage: StorageLike | null = defaultStorage(),
): string[] {
  const q = query.replace(/\s+/g, " ").trim();
  const current = readRecentSearches(storage);
  if (!q) return current;
  const next = [q, ...current.filter((v) => v.toLowerCase() !== q.toLowerCase())].slice(
    0,
    MAX_RECENT_SEARCHES,
  );
  try {
    storage?.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
    announce();
  } catch {
    // Full or blocked: the list just isn't remembered.
  }
  return next;
}

export function clearRecentSearches(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(RECENT_SEARCHES_KEY);
    announce();
  } catch {
    // Nothing to do.
  }
}
