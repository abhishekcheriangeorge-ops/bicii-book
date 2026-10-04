"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { IconButton } from "./icon-button";
import { AlertIcon, CheckIcon, CloseIcon } from "./icons";

export type ToastTone = "neutral" | "success" | "error" | "info";

export type ToastOptions = {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** ms before auto-dismiss. Errors default to staying until dismissed. */
  duration?: number | null;
};

type ToastItem = Required<Pick<ToastOptions, "title" | "tone">> &
  Pick<ToastOptions, "description"> & { id: number; duration: number | null };

type ToastApi = {
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() must be used inside <ToastProvider>.");
  return ctx;
}

const tones: Record<ToastTone, { box: string; icon: ReactNode }> = {
  neutral: { box: "bg-ink text-paper on-ink", icon: null },
  success: { box: "bg-ink text-paper on-ink", icon: <CheckIcon className="size-5 text-green" /> },
  info: { box: "bg-ink text-paper on-ink", icon: null },
  error: { box: "bg-danger text-danger-fg on-ink", icon: <AlertIcon className="size-5" /> },
};

const subscribeNoop = () => () => {};

/**
 * Toasts confirm what just happened ("Part added, stock 4 → 3") without
 * blocking the next action. Two live regions exist from first render so
 * screen readers announce reliably: polite for confirmations, assertive
 * (role="alert") for errors. Never use a toast as the only record of a
 * failure that needs action; errors also belong inline next to the field.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((options: ToastOptions) => {
    const id = nextId.current++;
    const tone = options.tone ?? "neutral";
    const duration =
      options.duration !== undefined ? options.duration : tone === "error" ? null : 5000;
    setItems((list) => [
      ...list.slice(-3),
      { id, title: options.title, description: options.description, tone, duration },
    ]);
    return id;
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  const polite = items.filter((t) => t.tone !== "error");
  const assertive = items.filter((t) => t.tone === "error");

  const viewport = (
    <div
      data-sheet-exempt=""
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:items-end md:px-6 md:pb-6"
    >
      <ol
        aria-live="polite"
        aria-label="Notifications"
        className="flex w-full max-w-sm flex-col gap-2"
      >
        {polite.map((t) => (
          <ToastCard key={t.id} item={t} onDismiss={dismiss} />
        ))}
      </ol>
      <ol role="alert" aria-label="Errors" className="flex w-full max-w-sm flex-col gap-2">
        {assertive.map((t) => (
          <ToastCard key={t.id} item={t} onDismiss={dismiss} />
        ))}
      </ol>
    </div>
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {mounted ? createPortal(viewport, document.body) : null}
    </ToastContext.Provider>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (item.duration === null || paused) return;
    const timer = window.setTimeout(() => onDismiss(item.id), item.duration);
    return () => window.clearTimeout(timer);
  }, [item.id, item.duration, paused, onDismiss]);

  const tone = tones[item.tone];
  return (
    <li
      className={cn(
        "pointer-events-auto flex animate-[rise_var(--duration-spring)_var(--ease-spring)] items-start gap-3 rounded-2xl py-2 pr-2 pl-4 shadow-[0_8px_30px_rgb(5_7_7/0.25)]",
        tone.box,
      )}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {tone.icon ? <span className="mt-2.5 shrink-0">{tone.icon}</span> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-2">
        <p className="font-display text-sm font-bold tracking-wide uppercase">{item.title}</p>
        {item.description ? <p className="text-sm opacity-90">{item.description}</p> : null}
      </div>
      <IconButton
        aria-label="Dismiss notification"
        icon={<CloseIcon className="size-4" />}
        variant="inherit"
        onClick={() => onDismiss(item.id)}
      />
    </li>
  );
}
