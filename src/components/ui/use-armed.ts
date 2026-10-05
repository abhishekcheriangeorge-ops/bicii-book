"use client";

import { useEffect, useState } from "react";

/**
 * How long a commit or confirm button ignores presses after it appears
 * (DESIGN.md "Forms": a double tap must not reach a button that the first
 * tap revealed).
 */
export const CONFIRM_GUARD_MS = 400;

/**
 * False from the render in which `key` takes a new value, true again
 * CONFIRM_GUARD_MS later. For buttons that stay in place while what they
 * do changes: key them by that (a job's status), and the button that
 * appears under the finger after the first tap cannot take the second.
 */
export function useArmedAfter(key: string | number | boolean | null): boolean {
  const [armedFor, setArmedFor] = useState<{ key: typeof key } | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setArmedFor({ key }), CONFIRM_GUARD_MS);
    return () => window.clearTimeout(timer);
  }, [key]);
  return armedFor !== null && armedFor.key === key;
}

/** Disarmed while `open` is false, and for CONFIRM_GUARD_MS after it turns true. */
export function useArmed(open: boolean): boolean {
  return useArmedAfter(open) && open;
}
