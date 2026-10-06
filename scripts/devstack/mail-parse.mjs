// Pure helpers for the devstack mail catcher (mailcatcher.mjs) and its unit
// tests: parse a raw RFC 5322 message into headers, addresses, subject and
// its text and HTML parts, turn HTML into readable text, and pull a
// one-time code out of a message. No dependencies, no I/O.
//
// Handles what Supabase Auth (gomail) and ordinary clients send: folded
// headers, RFC 2047 encoded words (B and Q), nested multipart/* bodies,
// Content-Transfer-Encoding 7bit / 8bit / binary / quoted-printable /
// base64, and utf-8 (or any charset Node's TextDecoder knows).

/**
 * @typedef {object} ParsedMessage
 * @property {Record<string, string>} headers Lower-cased names; the first occurrence wins; values unfolded and decoded.
 * @property {string} from The From header, decoded.
 * @property {string} to The To header, decoded.
 * @property {string} subject The Subject header, decoded.
 * @property {string | null} text The first text/plain part that is not an attachment.
 * @property {string | null} html The first text/html part that is not an attachment.
 */

/** @param {string | Uint8Array} raw */
function toBinaryString(raw) {
  if (typeof raw === "string") return Buffer.from(raw, "utf8").toString("latin1");
  return Buffer.from(raw).toString("latin1");
}

/**
 * Bytes (as a latin1 "binary" string or a Buffer) to text in a charset.
 * @param {Buffer} bytes
 * @param {string | undefined} charset
 */
function decodeBytes(bytes, charset) {
  const label = (charset ?? "utf-8").trim().toLowerCase() || "utf-8";
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/**
 * Splits a binary string into its header block and body at the first empty line.
 * @param {string} bin
 */
function splitHeadersAndBody(bin) {
  const match = /\r?\n\r?\n/.exec(bin);
  if (!match) return { head: bin, body: "" };
  return { head: bin.slice(0, match.index), body: bin.slice(match.index + match[0].length) };
}

/**
 * Header block (binary string) to lower-cased name -> raw unfolded value.
 * @param {string} head
 */
function parseHeaderBlock(head) {
  /** @type {Record<string, string>} */
  const headers = {};
  const unfolded = head.replace(/\r?\n(?=[ \t])/g, "");
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!name || name in headers) continue;
    // Raw 8-bit header bytes (RFC 6532) are utf-8.
    headers[name] = Buffer.from(line.slice(colon + 1).trim(), "latin1").toString("utf8");
  }
  return headers;
}

/**
 * Quoted-printable (binary string) to bytes.
 * @param {string} input
 * @param {boolean} [header] RFC 2047 Q: "_" is a space.
 */
function decodeQuotedPrintable(input, header = false) {
  const s = header ? input.replace(/_/g, " ") : input.replace(/=[ \t]*\r?\n/g, "");
  /** @type {number[]} */
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(s.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/**
 * Decodes RFC 2047 encoded words; whitespace between adjacent encoded words
 * is dropped, as the RFC says.
 * @param {string} value
 */
export function decodeEncodedWords(value) {
  const word = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g;
  const joined = value.replace(
    /(=\?[^?\s]+\?[BbQq]\?[^?\s]*\?=)\s+(?==\?[^?\s]+\?[BbQq]\?[^?\s]*\?=)/g,
    "$1",
  );
  return joined.replace(word, (_all, charset, enc, text) => {
    const cs = String(charset).split("*")[0];
    const bytes =
      String(enc).toUpperCase() === "B"
        ? Buffer.from(text, "base64")
        : decodeQuotedPrintable(Buffer.from(text, "utf8").toString("latin1"), true);
    return decodeBytes(bytes, cs);
  });
}

/**
 * "text/html; charset=UTF-8; boundary=..." -> { type, params }.
 * @param {string | undefined} value
 */
function parseContentType(value) {
  const [typePart, ...rest] = (value ?? "text/plain").split(";");
  /** @type {Record<string, string>} */
  const params = {};
  for (const p of rest) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    const key = p.slice(0, eq).trim().toLowerCase();
    let v = p.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\(.)/g, "$1");
    params[key] = v;
  }
  return { type: (typePart.trim() || "text/plain").toLowerCase(), params };
}

/**
 * Decodes a part body (binary string) by its Content-Transfer-Encoding.
 * @param {string} body
 * @param {string | undefined} encoding
 */
function decodeTransfer(body, encoding) {
  const enc = (encoding ?? "7bit").trim().toLowerCase();
  if (enc === "base64") return Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ""), "base64");
  if (enc === "quoted-printable") return decodeQuotedPrintable(body);
  return Buffer.from(body, "latin1");
}

/**
 * Walks a MIME entity, collecting the first inline text/plain and text/html.
 * @param {Record<string, string>} headers
 * @param {string} body binary string
 * @param {{ text: string | null, html: string | null }} out
 * @param {number} depth
 */
function walk(headers, body, out, depth) {
  const { type, params } = parseContentType(headers["content-type"]);
  if (type.startsWith("multipart/") && params.boundary && depth < 20) {
    const delimiter = `--${params.boundary}`;
    const lines = body.split(/\r?\n/);
    /** @type {string[][]} */
    const parts = [];
    /** @type {string[] | null} */
    let current = null;
    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (trimmed === `${delimiter}--`) {
        if (current) parts.push(current);
        current = null;
        break;
      }
      if (trimmed === delimiter) {
        if (current) parts.push(current);
        current = [];
        continue;
      }
      if (current) current.push(line);
    }
    if (current) parts.push(current);
    for (const partLines of parts) {
      const { head, body: partBody } = splitHeadersAndBody(partLines.join("\r\n"));
      // A part with no headers starts with the empty line itself.
      const startsBlank = partLines.length > 0 && partLines[0] === "";
      const partHeaders = startsBlank ? {} : parseHeaderBlock(head);
      walk(partHeaders, startsBlank ? partLines.slice(1).join("\r\n") : partBody, out, depth + 1);
    }
    return;
  }
  if (type === "message/rfc822" && depth < 20) {
    const inner = splitHeadersAndBody(body);
    walk(parseHeaderBlock(inner.head), inner.body, out, depth + 1);
    return;
  }
  const disposition = (headers["content-disposition"] ?? "").toLowerCase();
  if (disposition.startsWith("attachment")) return;
  if (type !== "text/plain" && type !== "text/html") return;
  const decoded = decodeBytes(
    decodeTransfer(body, headers["content-transfer-encoding"]),
    params.charset,
  );
  if (type === "text/plain" && out.text === null) out.text = decoded;
  if (type === "text/html" && out.html === null) out.html = decoded;
}

/**
 * Parses a raw message.
 * @param {string | Uint8Array} raw
 * @returns {ParsedMessage}
 */
export function parseMessage(raw) {
  const bin = toBinaryString(raw);
  const { head, body } = splitHeadersAndBody(bin);
  const rawHeaders = parseHeaderBlock(head);
  /** @type {Record<string, string>} */
  const headers = {};
  for (const [name, value] of Object.entries(rawHeaders)) headers[name] = decodeEncodedWords(value);
  const out = {
    text: /** @type {string | null} */ (null),
    html: /** @type {string | null} */ (null),
  };
  walk(rawHeaders, body, out, 0);
  return {
    headers,
    from: headers.from ?? "",
    to: headers.to ?? "",
    subject: headers.subject ?? "",
    text: out.text,
    html: out.html,
  };
}

const ENTITIES = /** @type {Record<string, string>} */ ({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  copy: "©",
});

/** @param {string} s */
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (all, name) => {
    const n = String(name);
    if (n[0] === "#") {
      const code =
        n[1] === "x" || n[1] === "X" ? parseInt(n.slice(2), 16) : parseInt(n.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : all;
    }
    return ENTITIES[n.toLowerCase()] ?? all;
  });
}

/**
 * Readable text from HTML: drops head, style and script, breaks lines at
 * block elements, strips tags, decodes entities and tidies whitespace.
 * @param {string | null | undefined} html
 */
export function htmlToText(html) {
  if (!html) return "";
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(
      /<\/?(p|div|tr|li|ul|ol|table|h[1-6]|blockquote|section|header|footer|center)\b[^>]*>/gi,
      "\n",
    )
    .replace(/<\/?(td|th)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The first standalone run of `min`..`max` digits in the text part, else in
 * the tag-stripped HTML, else null. "Standalone": not part of a longer run
 * of digits or of a word, and not a colour (#123456).
 * @param {{ text?: string | null, html?: string | null }} message
 * @param {{ min?: number, max?: number }} [options]
 * @returns {string | null}
 */
export function extractCode({ text, html }, { min = 6, max = 10 } = {}) {
  const pattern = new RegExp(`(?<![0-9A-Za-z#&_])[0-9]{${min},${max}}(?![0-9A-Za-z_])`);
  for (const source of [text ?? "", htmlToText(html)]) {
    const match = pattern.exec(source);
    if (match) return match[0];
  }
  return null;
}
