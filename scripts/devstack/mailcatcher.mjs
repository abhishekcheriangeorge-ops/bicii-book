#!/usr/bin/env node
// A local mail catcher for the devstack: an SMTP server that accepts every
// message and keeps it, and a small JSON API to read the messages back.
// Supabase Auth sends staff sign-in codes through it (services.mjs), tests
// and people read them over HTTP (mail-client.mjs, or curl), and it serves
// Auth's email templates from supabase/templates. Generic on purpose: the
// public site's customer sign-in codes (Phase 11) use it too.
//
// Local only. It binds 127.0.0.1, accepts any AUTH credentials, never
// offers STARTTLS and delivers nothing anywhere.
//
//   node scripts/devstack/mailcatcher.mjs     (npm run devstack:start runs it)
//
// SMTP (BICII_SMTP_PORT, default 2525): EHLO/HELO, AUTH PLAIN/LOGIN (any
// credentials), MAIL FROM, RCPT TO (several), DATA (dot-stuffing undone,
// 552 above 10 MB), RSET, NOOP, VRFY (252), QUIT; anything else 502.
// Pipelined commands, partial TCP chunks and several messages per
// connection are fine.
//
// HTTP (BICII_MAIL_HTTP_PORT, default 8025), JSON:
//   GET    /health                        {ok:true}
//   GET    /messages?to=&after=&limit=    {messages:[summary...]}, newest first
//   GET    /messages/latest?to=&after=    newest full message to `to` with id > after, else 404
//   GET    /messages/:id                  one full message
//   GET    /messages/:id/raw              its raw .eml
//   DELETE /messages[?to=]                {deleted:n}
//   GET    /templates/<name>.html         a file from the templates directory
// `to` matches the envelope recipients (RCPT TO), case-insensitively.
//
// Storage: <dir>/<id>.json (parsed) and <dir>/<id>.eml (raw). Ids are
// integers that keep increasing across restarts; the newest 1000 are kept.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { extractCode, parseMessage } from "./mail-parse.mjs";

export const MAX_MESSAGE_BYTES = 10 * 1024 * 1024;
export const KEEP_MESSAGES = 1000;
const MAX_LINE_BYTES = 64 * 1024;
const TEMPLATE_NAME = /^[a-z0-9_-]+\.html$/;

/**
 * @typedef {object} StoredMessage
 * @property {number} id
 * @property {string} receivedAt ISO timestamp
 * @property {string} envelopeFrom MAIL FROM, lower-cased
 * @property {string[]} envelopeTo RCPT TO, lower-cased
 * @property {string} from From header
 * @property {string} to To header
 * @property {string} subject decoded Subject
 * @property {string | null} text
 * @property {string | null} html
 * @property {string | null} code the first 6-10 digit code, or null
 */

/** @param {string} arg "FROM:<a@b> SIZE=1" -> "a@b" */
function parsePath(arg) {
  const angle = /<([^>]*)>/.exec(arg);
  const address = angle ? angle[1] : arg.split(/\s+/)[0];
  return address.trim().toLowerCase();
}

/** The message store: files on disk plus an in-memory index. */
class Store {
  /** @param {string} dir */
  constructor(dir) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    /** @type {Map<number, StoredMessage>} */
    this.messages = new Map();
    let maxId = 0;
    const ids = [];
    for (const file of readdirSync(dir)) {
      const m = /^(\d+)\.(json|eml)$/.exec(file);
      if (!m) continue;
      const id = Number(m[1]);
      maxId = Math.max(maxId, id);
      if (m[2] === "json") ids.push(id);
    }
    ids.sort((a, b) => a - b);
    for (const id of ids) {
      try {
        this.messages.set(id, JSON.parse(readFileSync(this.file(id, "json"), "utf8")));
      } catch {
        /* unreadable leftovers are ignored */
      }
    }
    this.nextId = maxId + 1;
    this.prune();
  }

  /** @param {number} id @param {"json" | "eml"} ext */
  file(id, ext) {
    return path.join(this.dir, `${id}.${ext}`);
  }

  /**
   * @param {{ from: string, to: string[] }} envelope
   * @param {Buffer} raw
   */
  add(envelope, raw) {
    const id = this.nextId++;
    const parsed = parseMessage(raw);
    /** @type {StoredMessage} */
    const message = {
      id,
      receivedAt: new Date().toISOString(),
      envelopeFrom: envelope.from,
      envelopeTo: envelope.to,
      from: parsed.from,
      to: parsed.to,
      subject: parsed.subject,
      text: parsed.text,
      html: parsed.html,
      code: extractCode(parsed),
    };
    writeFileSync(this.file(id, "eml"), raw);
    writeFileSync(this.file(id, "json"), `${JSON.stringify(message, null, 2)}\n`);
    this.messages.set(id, message);
    this.prune();
    return message;
  }

  prune() {
    const excess = this.messages.size - KEEP_MESSAGES;
    if (excess <= 0) return;
    const oldest = [...this.messages.keys()].sort((a, b) => a - b).slice(0, excess);
    for (const id of oldest) this.remove(id);
  }

  /** @param {number} id */
  remove(id) {
    this.messages.delete(id);
    rmSync(this.file(id, "json"), { force: true });
    rmSync(this.file(id, "eml"), { force: true });
  }

  /**
   * Newest first.
   * @param {{ to?: string | null, after?: number }} filter
   */
  list({ to, after = 0 }) {
    const recipient = to ? to.trim().toLowerCase() : null;
    return [...this.messages.values()]
      .filter((m) => m.id > after && (!recipient || m.envelopeTo.includes(recipient)))
      .sort((a, b) => b.id - a.id);
  }
}

/**
 * One SMTP connection: a line-oriented state machine over a byte buffer, so
 * pipelined commands and split TCP chunks need no special handling.
 * @param {net.Socket} socket
 * @param {Store} store
 */
function smtpSession(socket, store) {
  let buffer = Buffer.alloc(0);
  /** @type {"command" | "data" | "auth-plain" | "auth-login-user" | "auth-login-pass" | "closed"} */
  let mode = "command";
  /** @type {{ from: string | null, to: string[] }} */
  let envelope = { from: null, to: [] };

  // DATA state. The data is searched for <CRLF>.<CRLF> as if it began with a
  // CRLF (the one that ended the DATA command), so an empty message (".")
  // is found too; `tail` keeps the last 4 bytes searched, so a terminator
  // split across TCP chunks is found as well.
  /** @type {Buffer[]} */
  let dataChunks = [];
  let dataLength = 0;
  let tooBig = false;
  let tail = CRLF;

  /** @param {string} line */
  const reply = (line) => {
    if (!socket.destroyed) socket.write(`${line}\r\n`);
  };
  const resetTransaction = () => {
    envelope = { from: null, to: [] };
  };

  /** @param {string} line */
  const command = (line) => {
    const space = line.indexOf(" ");
    const verb = (space < 0 ? line : line.slice(0, space)).toUpperCase();
    const arg = space < 0 ? "" : line.slice(space + 1).trim();
    switch (verb) {
      case "EHLO":
        resetTransaction();
        reply(`250-localhost greets ${arg || "you"}`);
        reply("250-AUTH PLAIN LOGIN");
        reply("250-8BITMIME");
        reply(`250-SIZE ${MAX_MESSAGE_BYTES}`);
        reply("250 PIPELINING");
        return;
      case "HELO":
        resetTransaction();
        return reply("250 localhost");
      case "AUTH": {
        // Any credentials are accepted: this is a local catcher.
        const [mechanism, initial] = arg.split(/\s+/);
        const mech = (mechanism ?? "").toUpperCase();
        if (mech === "PLAIN") {
          if (initial) return reply("235 2.7.0 Authentication successful");
          mode = "auth-plain";
          return reply("334 ");
        }
        if (mech === "LOGIN") {
          mode = initial ? "auth-login-pass" : "auth-login-user";
          return reply(initial ? "334 UGFzc3dvcmQ6" : "334 VXNlcm5hbWU6");
        }
        return reply("504 5.5.4 Unrecognised authentication type");
      }
      case "MAIL": {
        if (!/^FROM:/i.test(arg)) return reply("501 5.5.4 Syntax: MAIL FROM:<address>");
        const size = /\bSIZE=(\d+)/i.exec(arg);
        if (size && Number(size[1]) > MAX_MESSAGE_BYTES) {
          return reply("552 5.3.4 Message size exceeds fixed maximum message size");
        }
        envelope = { from: parsePath(arg.slice(5)), to: [] };
        return reply("250 2.1.0 OK");
      }
      case "RCPT": {
        if (envelope.from === null) return reply("503 5.5.1 Error: need MAIL command");
        if (!/^TO:/i.test(arg)) return reply("501 5.5.4 Syntax: RCPT TO:<address>");
        const address = parsePath(arg.slice(3));
        if (!address) return reply("501 5.1.3 Bad recipient address syntax");
        if (!envelope.to.includes(address)) envelope.to.push(address);
        return reply("250 2.1.5 OK");
      }
      case "DATA":
        if (envelope.to.length === 0) return reply("503 5.5.1 Error: need RCPT command");
        mode = "data";
        dataChunks = [];
        dataLength = 0;
        tooBig = false;
        tail = CRLF;
        return reply("354 End data with <CR><LF>.<CR><LF>");
      case "RSET":
        resetTransaction();
        return reply("250 2.0.0 OK");
      case "NOOP":
        return reply("250 2.0.0 OK");
      case "VRFY":
        return reply("252 2.0.0 Cannot VRFY user, but will accept message");
      case "QUIT":
        reply("221 2.0.0 Bye");
        mode = "closed";
        socket.end();
        return;
      default:
        return reply("502 5.5.2 Command not recognised");
    }
  };

  /** Stores the message (dot-stuffing undone) and replies. @param {Buffer} body */
  const finishData = (body) => {
    mode = "command";
    if (tooBig) {
      resetTransaction();
      return reply("552 5.3.4 Message size exceeds fixed maximum message size");
    }
    const raw = Buffer.from(
      body
        .toString("latin1")
        .split("\r\n")
        .map((line) => (line.startsWith(".") ? line.slice(1) : line))
        .join("\r\n"),
      "latin1",
    );
    try {
      const message = store.add({ from: envelope.from ?? "", to: envelope.to }, raw);
      reply(`250 2.0.0 OK: queued as ${message.id}`);
    } catch (err) {
      reply(`451 4.3.0 Could not store the message: ${/** @type {Error} */ (err).message}`);
    }
    resetTransaction();
  };

  /**
   * Feeds DATA bytes. Returns the bytes after the terminator once the
   * message is complete, or null while it is still coming.
   * @param {Buffer} chunk
   */
  const feedData = (chunk) => {
    const window = Buffer.concat([tail, chunk]);
    const at = window.indexOf(TERMINATOR);
    const before = dataLength;
    if (!tooBig) dataChunks.push(chunk);
    dataLength += chunk.length;
    if (dataLength > MAX_MESSAGE_BYTES && !tooBig) {
      tooBig = true;
      dataChunks = [];
    }
    if (at < 0) {
      tail = window.subarray(Math.max(0, window.length - 4));
      return null;
    }
    // Offsets in "CRLF + data" coordinates: the window starts at
    // (2 + before - tail.length); the body is data[0, end).
    const end = Math.max(0, before - tail.length + at);
    const body = tooBig ? Buffer.alloc(0) : Buffer.concat(dataChunks).subarray(0, end);
    const rest = chunk.subarray(at + TERMINATOR.length - tail.length);
    dataChunks = [];
    finishData(body);
    return rest;
  };

  const pump = () => {
    while (buffer.length > 0 && mode !== "closed") {
      if (mode === "data") {
        buffer = feedData(buffer) ?? Buffer.alloc(0);
        continue;
      }
      const nl = buffer.indexOf(0x0a);
      if (nl < 0) {
        if (buffer.length > MAX_LINE_BYTES) {
          reply("500 5.5.2 Line too long");
          mode = "closed";
          socket.end();
        }
        return;
      }
      const line = buffer.subarray(0, nl).toString("utf8").replace(/\r$/, "");
      buffer = buffer.subarray(nl + 1);
      if (mode === "auth-plain" || mode === "auth-login-pass") {
        mode = "command";
        reply("235 2.7.0 Authentication successful");
      } else if (mode === "auth-login-user") {
        mode = "auth-login-pass";
        reply("334 UGFzc3dvcmQ6");
      } else {
        command(line);
      }
    }
  };

  socket.on("data", (chunk) => {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
    pump();
  });
  socket.on("error", () => socket.destroy());
  reply("220 localhost BICII devstack mail catcher ESMTP");
}

const CRLF = Buffer.from("\r\n");
const TERMINATOR = Buffer.from("\r\n.\r\n");

/** @param {http.ServerResponse} res @param {number} status @param {unknown} body */
function sendJson(res, status, body) {
  const text = `${JSON.stringify(body)}\n`;
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(text);
}

/** @param {StoredMessage} m */
function summary(m) {
  return {
    id: m.id,
    receivedAt: m.receivedAt,
    envelopeFrom: m.envelopeFrom,
    envelopeTo: m.envelopeTo,
    from: m.from,
    to: m.to,
    subject: m.subject,
    code: m.code,
  };
}

/** @param {string | null} value */
function intParam(value, fallback = 0) {
  if (value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/**
 * @param {Store} store
 * @param {string} templatesDir
 * @returns {http.RequestListener}
 */
function httpHandler(store, templatesDir) {
  const templatesRoot = path.resolve(templatesDir);
  return (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const method = req.method ?? "GET";
    const pathname = url.pathname;
    const to = url.searchParams.get("to");

    if (pathname === "/health" && method === "GET") return sendJson(res, 200, { ok: true });

    if (pathname === "/messages") {
      if (method === "GET") {
        const limit = Math.min(KEEP_MESSAGES, intParam(url.searchParams.get("limit"), 50) || 50);
        const after = intParam(url.searchParams.get("after"));
        return sendJson(res, 200, {
          messages: store.list({ to, after }).slice(0, limit).map(summary),
        });
      }
      if (method === "DELETE") {
        const doomed = store.list({ to });
        for (const m of doomed) store.remove(m.id);
        return sendJson(res, 200, { deleted: doomed.length });
      }
      return sendJson(res, 405, { error: "method_not_allowed" });
    }

    if (pathname === "/messages/latest" && method === "GET") {
      const [latest] = store.list({ to, after: intParam(url.searchParams.get("after")) });
      return latest ? sendJson(res, 200, latest) : sendJson(res, 404, { error: "not_found" });
    }

    const one = /^\/messages\/(\d+)(\/raw)?$/.exec(pathname);
    if (one && method === "GET") {
      const message = store.messages.get(Number(one[1]));
      if (!message) return sendJson(res, 404, { error: "not_found" });
      if (!one[2]) return sendJson(res, 200, message);
      try {
        const raw = readFileSync(store.file(message.id, "eml"));
        res.writeHead(200, { "content-type": "message/rfc822", "cache-control": "no-store" });
        return res.end(raw);
      } catch {
        return sendJson(res, 404, { error: "not_found" });
      }
    }

    if (pathname.startsWith("/templates/") && method === "GET") {
      const name = pathname.slice("/templates/".length);
      // Only plain lower-case names: no slashes, dots or %-escapes, so no
      // traversal; the resolved path is checked again anyway.
      if (TEMPLATE_NAME.test(name)) {
        const file = path.resolve(templatesRoot, name);
        if (path.dirname(file) === templatesRoot) {
          try {
            const html = readFileSync(file);
            res.writeHead(200, {
              "content-type": "text/html; charset=utf-8",
              "cache-control": "no-store",
            });
            return res.end(html);
          } catch {
            /* fall through to 404 */
          }
        }
      }
      return sendJson(res, 404, { error: "not_found" });
    }

    return sendJson(res, 404, { error: "not_found" });
  };
}

/** @param {net.Server | http.Server} server @param {number} port @param {string} host */
function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (/** @type {Error} */ err) => reject(err);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : port);
    });
  });
}

/**
 * Starts the SMTP server and the HTTP API. Port 0 picks a free port; the
 * real ports are returned.
 * @param {{ smtpPort: number, httpPort: number, host?: string, dir: string, templatesDir: string }} options
 * @returns {Promise<{ smtpPort: number, httpPort: number, close: () => Promise<void> }>}
 */
export async function startMailCatcher({
  smtpPort,
  httpPort,
  host = "127.0.0.1",
  dir,
  templatesDir,
}) {
  const store = new Store(dir);
  /** @type {Set<net.Socket>} */
  const sockets = new Set();
  const smtp = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    smtpSession(socket, store);
  });
  const api = http.createServer(httpHandler(store, templatesDir));
  const realSmtp = await listen(smtp, smtpPort, host);
  let realHttp;
  try {
    realHttp = await listen(api, httpPort, host);
  } catch (err) {
    smtp.close();
    throw err;
  }
  return {
    smtpPort: realSmtp,
    httpPort: realHttp,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      api.closeAllConnections();
      await Promise.all([
        new Promise((resolve) => smtp.close(() => resolve(undefined))),
        new Promise((resolve) => api.close(() => resolve(undefined))),
      ]);
    },
  };
}

async function main() {
  const { PORTS, MAIL_DIR, MAIL_URL, TEMPLATES_DIR, log } = await import("./config.mjs");
  const catcher = await startMailCatcher({
    smtpPort: PORTS.smtp,
    httpPort: PORTS.mailHttp,
    dir: MAIL_DIR,
    templatesDir: TEMPLATES_DIR,
  });
  log(
    `mail catcher: SMTP 127.0.0.1:${catcher.smtpPort}, HTTP ${MAIL_URL} (messages in ${MAIL_DIR})`,
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await catcher.close();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`[mail] ${err?.stack ?? err}\n`);
    process.exit(1);
  });
}
