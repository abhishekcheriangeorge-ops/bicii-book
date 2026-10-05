/** FormData -> plain object. Repeated keys become arrays; React's `$ACTION_*` keys are dropped. */
export function formDataToObject(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$ACTION_")) continue;
    if (key in out) {
      const prev = out[key];
      out[key] = Array.isArray(prev) ? [...prev, value] : [prev, value];
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Field names never echoed back to the browser. */
const SECRET_FIELD = /pass|secret|token|pin|confirm|otp/i;

/**
 * The non-secret text fields of a submitted form, for a failed Server Action
 * to hand back (ActionResult.values) so the form can show them again. Field
 * names that look secret are never echoed: passwords and their
 * confirmations, tokens, PINs, one-time codes.
 */
export function echoValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$ACTION_") || SECRET_FIELD.test(key)) continue;
    if (typeof value === "string" && !(key in out)) out[key] = value;
  }
  return out;
}
