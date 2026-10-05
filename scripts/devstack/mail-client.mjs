// Reads sign-in codes from the local mail catcher (mailcatcher.mjs) for
// tests: stack tests, Playwright and anything else that has to read an
// email Supabase Auth sent. Dependency-free (fetch).
//
//   const cursor = await mailCursor(email);          // before asking for a code
//   await supabase.auth.signInWithOtp({ email, ... });
//   const code = await waitForCode({ to: email, after: cursor });
//
// The base URL is BICII_MAIL_URL, else the devstack catcher (MAIL_URL from
// config.mjs, http://127.0.0.1:${BICII_MAIL_HTTP_PORT:-8025}).
//
// BICII_MAIL_KIND=mailpit reads Mailpit instead, the catcher `supabase
// start` runs (E2E_EXTERNAL_STACK=1; default URL http://127.0.0.1:54324),
// through its documented API: GET /api/v1/search?query=to:"<addr>" (newest
// first), GET /api/v1/message/<ID> (Text, HTML), DELETE /api/v1/search and
// DELETE /api/v1/messages. Not run here (no Docker); see docs/TESTING.md.

import { MAIL_URL } from "./config.mjs";
import { extractCode } from "./mail-parse.mjs";

/**
 * @typedef {object} MailMessage
 * @property {number | string} id the catcher's integer id, or Mailpit's ID
 * @property {string} receivedAt ISO timestamp
 * @property {string} envelopeFrom
 * @property {string[]} envelopeTo lower-cased recipients
 * @property {string} from From header
 * @property {string} to To header
 * @property {string} subject
 * @property {string | null} text
 * @property {string | null} html
 * @property {string | null} code the first 6-10 digit code, or null
 */

/**
 * @typedef {object} WaitOptions
 * @property {string} to recipient address
 * @property {string | null} [after] a cursor from mailCursor(); null or omitted: any message
 * @property {number} [timeoutMs] default 15000
 * @property {number} [intervalMs] default 200
 */

const MAILPIT_DEFAULT_URL = "http://127.0.0.1:54324";

/** "catcher" (the devstack's) or "mailpit". */
export function mailKind() {
  return process.env.BICII_MAIL_KIND === "mailpit" ? "mailpit" : "catcher";
}

/** The mail API's base URL, without a trailing slash. */
export function mailUrl() {
  const fallback = mailKind() === "mailpit" ? MAILPIT_DEFAULT_URL : MAIL_URL;
  return (process.env.BICII_MAIL_URL ?? fallback).replace(/\/+$/, "");
}

/** @param {string} pathname */
async function getJson(pathname) {
  const res = await fetch(`${mailUrl()}${pathname}`, { signal: AbortSignal.timeout(5000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${mailUrl()}${pathname}: HTTP ${res.status}`);
  return res.json();
}

// --- Mailpit ---------------------------------------------------------------

/** @param {string} to */
function mailpitQuery(to) {
  return encodeURIComponent(`to:"${to}"`);
}

/**
 * Newest first, as Mailpit's search returns them.
 * @param {string} to
 * @returns {Promise<Array<{ ID: string, Created: string }>>}
 */
async function mailpitSearch(to) {
  const body = await getJson(`/api/v1/search?query=${mailpitQuery(to)}&limit=50`);
  return body?.messages ?? [];
}

/**
 * @param {any} m a Mailpit /api/v1/message/<ID> body
 * @returns {MailMessage}
 */
function fromMailpit(m) {
  /** @param {any} a */
  const address = (a) => String(a?.Address ?? "").toLowerCase();
  /** @param {any[]} list */
  const header = (list) =>
    (list ?? []).map((a) => (a?.Name ? `${a.Name} <${a.Address}>` : a?.Address)).join(", ");
  const text = m.Text ?? null;
  const html = m.HTML ?? null;
  return {
    id: m.ID,
    receivedAt: m.Date ?? m.Created ?? new Date().toISOString(),
    envelopeFrom: address(m.From),
    envelopeTo: [...(m.To ?? []), ...(m.Cc ?? []), ...(m.Bcc ?? [])].map(address),
    from: header(m.From ? [m.From] : []),
    to: header(m.To),
    subject: m.Subject ?? "",
    text,
    html,
    code: extractCode({ text, html }),
  };
}

/** @param {string | null | undefined} cursor */
function decodeMailpitCursor(cursor) {
  if (!cursor) return null;
  try {
    return /** @type {{ id: string, created: string }} */ (JSON.parse(cursor));
  } catch {
    return null;
  }
}

// --- Public API -------------------------------------------------------------

/**
 * An opaque cursor for the newest message to `to`, or null when there is
 * none. Take it before asking for a code; waitForMessage({ after }) then
 * ignores everything already there.
 * @param {string} to
 * @returns {Promise<string | null>}
 */
export async function mailCursor(to) {
  if (mailKind() === "mailpit") {
    const [newest] = await mailpitSearch(to);
    return newest ? JSON.stringify({ id: newest.ID, created: newest.Created }) : null;
  }
  const body = await getJson(`/messages?to=${encodeURIComponent(to)}&limit=1`);
  const newest = body?.messages?.[0];
  return newest ? String(newest.id) : null;
}

/**
 * The newest message to `to` that is newer than the cursor, or null.
 * @param {string} to
 * @param {string | null | undefined} after
 * @returns {Promise<MailMessage | null>}
 */
async function latestAfter(to, after) {
  if (mailKind() === "mailpit") {
    const list = await mailpitSearch(to);
    const cursor = decodeMailpitCursor(after);
    let candidates = list;
    if (cursor) {
      const index = list.findIndex((m) => m.ID === cursor.id);
      candidates =
        index >= 0
          ? list.slice(0, index)
          : list.filter((m) => Date.parse(m.Created) > Date.parse(cursor.created));
    }
    if (candidates.length === 0) return null;
    const full = await getJson(`/api/v1/message/${encodeURIComponent(candidates[0].ID)}`);
    return full ? fromMailpit(full) : null;
  }
  const query = new URLSearchParams({ to });
  if (after) query.set("after", after);
  return getJson(`/messages/latest?${query}`);
}

/**
 * Polls until a message to `to` newer than `after` arrives and returns the
 * newest such message. Throws, naming the address and the mail URL, on
 * timeout.
 * @param {WaitOptions} options
 * @returns {Promise<MailMessage>}
 */
export async function waitForMessage({ to, after = null, timeoutMs = 15000, intervalMs = 200 }) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  for (;;) {
    try {
      const message = await latestAfter(to, after);
      if (message) return message;
      lastError = "";
    } catch (err) {
      lastError = /** @type {Error} */ (err).message;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `No email to ${to}${after ? ` newer than ${after}` : ""} arrived within ${timeoutMs} ms ` +
          `at ${mailUrl()} (${mailKind()})${lastError ? `: ${lastError}` : ""}. ` +
          "Is the devstack's mail service running (npm run devstack:status)?",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * The sign-in code in the next message to `to` (see waitForMessage).
 * Throws when that message has no code.
 * @param {WaitOptions} options
 * @returns {Promise<string>}
 */
export async function waitForCode(options) {
  const message = await waitForMessage(options);
  if (!message.code) {
    throw new Error(
      `The email to ${options.to} (id ${message.id}, subject "${message.subject}") has no code.`,
    );
  }
  return message.code;
}

/**
 * Deletes the messages to `to`, or every message.
 * @param {string} [to]
 * @returns {Promise<void>}
 */
export async function clearMail(to) {
  const url =
    mailKind() === "mailpit"
      ? to
        ? `${mailUrl()}/api/v1/search?query=${mailpitQuery(to)}`
        : `${mailUrl()}/api/v1/messages`
      : `${mailUrl()}/messages${to ? `?to=${encodeURIComponent(to)}` : ""}`;
  const res = await fetch(url, { method: "DELETE", signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`DELETE ${url}: HTTP ${res.status}`);
}
