"use client";

import { useEffect, useRef } from "react";

/**
 * After a failed form submission, move focus to the first invalid control
 * (Field marks it aria-invalid), so keyboard and screen-reader users land on
 * what needs fixing. Pass the action state; attach the ref to the <form>.
 */
export function useFocusFirstInvalid<T extends { ok: boolean } | null>(state: T) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state || state.ok) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [state]);
  return formRef;
}
