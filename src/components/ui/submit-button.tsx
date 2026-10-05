"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./button";

/**
 * A submit Button that reads its form's pending state, so a Server Action
 * form cannot be double-submitted while the commit is in flight.
 */
export function SubmitButton({ pending, ...props }: Omit<ButtonProps, "type">) {
  const status = useFormStatus();
  return <Button type="submit" pending={pending || status.pending} {...props} />;
}
