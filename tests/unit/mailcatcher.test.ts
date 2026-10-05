// @vitest-environment node
// The devstack mail catcher (scripts/devstack/mailcatcher.mjs) end to end on
// ephemeral ports: raw SMTP in over node:net, the JSON API out over HTTP,
// and mail-client.mjs reading codes the way tests do.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { clearMail, mailCursor, waitForCode } from "../../scripts/devstack/mail-client.mjs";
import { startMailCatcher } from "../../scripts/devstack/mailcatcher.mjs";

type Catcher = Awaited<ReturnType<typeof startMailCatcher>>;

/** A raw SMTP conversation: send bytes, await whole replies (multi-line ones as one). */
async function smtpConnect(port: number) {
  const socket = net.connect({ host: "127.0.0.1", port });
  let received = "";
  const replies: string[] = [];
  const waiters: Array<() => void> = [];
  socket.on("data", (chunk) => {
    received += chunk.toString("utf8");
    let match;
    // A reply ends with a line "NNN text" (a space after the code).
    while ((match = /^((?:\d{3}-[^\r\n]*\r\n)*\d{3}(?: [^\r\n]*)?\r\n)/.exec(received))) {
      replies.push(match[1]);
      received = received.slice(match[1].length);
    }
    for (const w of waiters.splice(0)) w();
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("error", reject);
  });
  let taken = 0;
  /** The next `n` replies, in order. */
  const next = async (n = 1) => {
    const deadline = Date.now() + 10_000;
    while (replies.length - taken < n) {
      if (Date.now() > deadline) throw new Error(`timed out; got ${JSON.stringify(replies)}`);
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
        setTimeout(resolve, 200);
      });
    }
    const out = replies.slice(taken, taken + n);
    taken += n;
    return out;
  };
  const send = (data: string | Buffer) =>
    new Promise<void>((resolve) => socket.write(data, () => resolve()));
  const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
  return { send, next, closed, socket };
}

/** HTTP GET/DELETE with the path sent exactly as given (no URL normalisation). */
function request(port: number, method: string, rawPath: string) {
  return new Promise<{ status: number; type: string; body: string }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: rawPath }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (body += d));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"]), body }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

async function json(port: number, method: string, rawPath: string) {
  const res = await request(port, method, rawPath);
  return { status: res.status, body: JSON.parse(res.body) };
}

const QP_HTML_MESSAGE = [
  'From: "BICII" <no-reply@bicii.test>',
  "To: Mixed.Case@BICII.test",
  "Subject: =?UTF-8?Q?Your_BICII_sign-in_code?=",
  "MIME-Version: 1.0",
  "Content-Type: text/html; charset=UTF-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  '<p style=3D"font-size: 32px">135=',
  "790</p>",
  // A line that starts with a dot is sent dot-stuffed ("..").
  "..leading dot",
  "<p>It expires in 10 minutes.</p>",
].join("\r\n");

const multipartMessage = (code: string) =>
  [
    "From: no-reply@bicii.test",
    "To: mixed.case@bicii.test",
    "Subject: Your BICII sign-in code",
    'Content-Type: multipart/alternative; boundary="b1"',
    "",
    "--b1",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(`Your code is ${code}. Café.`, "utf8").toString("base64"),
    "--b1",
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(`<p>Your code is <b>${code}</b>.</p>`, "utf8").toString("base64"),
    "--b1--",
  ].join("\r\n");

describe("mail catcher", () => {
  let root: string;
  let dir: string;
  let templatesDir: string;
  let catcher: Catcher;

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), "bicii-mail-"));
    dir = path.join(root, "mail");
    templatesDir = path.join(root, "templates");
    mkdirSync(templatesDir);
    writeFileSync(path.join(templatesDir, "magic_link.html"), "<p>{{ .Token }}</p>");
    writeFileSync(path.join(root, "secret.html"), "not for you");
    catcher = await startMailCatcher({ smtpPort: 0, httpPort: 0, dir, templatesDir });
  });

  afterAll(async () => {
    await catcher?.close();
    delete process.env.BICII_MAIL_URL;
    rmSync(root, { recursive: true, force: true });
  });

  it("takes two messages on one connection, pipelined and in odd chunks", async () => {
    expect(catcher.smtpPort).toBeGreaterThan(0);
    expect(catcher.httpPort).toBeGreaterThan(0);
    const smtp = await smtpConnect(catcher.smtpPort);
    expect((await smtp.next())[0]).toMatch(/^220 /);

    await smtp.send("EHLO test.local\r\n");
    const [ehlo] = await smtp.next();
    expect(ehlo).toMatch(/^250-/);
    expect(ehlo).toContain("AUTH PLAIN LOGIN");
    expect(ehlo).toContain("8BITMIME");
    expect(ehlo).toMatch(/SIZE \d+/);
    expect(ehlo).not.toContain("STARTTLS");

    await smtp.send(`AUTH PLAIN ${Buffer.from("\0user\0pass").toString("base64")}\r\n`);
    expect((await smtp.next())[0]).toMatch(/^235 /);

    await smtp.send("DATA\r\n");
    expect((await smtp.next())[0]).toMatch(/^503 /);

    // Pipelined envelope, then the data split mid-line and mid-terminator.
    await smtp.send(
      "MAIL FROM:<No-Reply@BICII.test> BODY=8BITMIME\r\nRCPT TO:<Mixed.Case@BICII.test>\r\n" +
        "RCPT TO:<other@bicii.test>\r\nDATA\r\n",
    );
    expect((await smtp.next(4)).map((r) => r.slice(0, 3))).toEqual(["250", "250", "250", "354"]);
    const data = `${QP_HTML_MESSAGE}\r\n.\r\n`;
    await smtp.send(data.slice(0, 37));
    await smtp.send(data.slice(37, data.length - 4));
    await smtp.send(data.slice(data.length - 4, data.length - 2));
    await smtp.send(data.slice(data.length - 2));
    expect((await smtp.next())[0]).toMatch(/^250 .*queued as 1/);

    await smtp.send("RSET\r\nNOOP\r\nVRFY someone\r\nHELP\r\n");
    expect((await smtp.next(4)).map((r) => r.slice(0, 3))).toEqual(["250", "250", "252", "502"]);

    await smtp.send("AUTH LOGIN\r\n");
    expect((await smtp.next())[0]).toMatch(/^334 /);
    await smtp.send("dXNlcg==\r\n");
    expect((await smtp.next())[0]).toMatch(/^334 /);
    await smtp.send("cGFzcw==\r\n");
    expect((await smtp.next())[0]).toMatch(/^235 /);

    // Second message, everything in one write.
    await smtp.send(
      `MAIL FROM:<no-reply@bicii.test>\r\nRCPT TO:<MIXED.case@bicii.test>\r\nDATA\r\n${multipartMessage("246802")}\r\n.\r\nQUIT\r\n`,
    );
    expect((await smtp.next(5)).map((r) => r.slice(0, 3))).toEqual([
      "250",
      "250",
      "354",
      "250",
      "221",
    ]);
    await smtp.closed;

    expect(readdirSync(dir).sort()).toEqual(["1.eml", "1.json", "2.eml", "2.json"]);
  });

  it("refuses a message above 10 MB with 552 and keeps the connection", async () => {
    const smtp = await smtpConnect(catcher.smtpPort);
    await smtp.next();
    await smtp.send("HELO x\r\nMAIL FROM:<a@b.test> SIZE=99999999\r\n");
    expect((await smtp.next(2)).map((r) => r.slice(0, 3))).toEqual(["250", "552"]);
    await smtp.send("MAIL FROM:<a@b.test>\r\nRCPT TO:<big@bicii.test>\r\nDATA\r\n");
    expect((await smtp.next(3)).map((r) => r.slice(0, 3))).toEqual(["250", "250", "354"]);
    const line = `${"x".repeat(998)}\r\n`;
    const block = line.repeat(1024); // ~1 MB
    for (let i = 0; i < 11; i++) await smtp.send(block);
    await smtp.send(".\r\n");
    expect((await smtp.next())[0]).toMatch(/^552 /);
    await smtp.send("NOOP\r\nQUIT\r\n");
    expect((await smtp.next(2)).map((r) => r.slice(0, 3))).toEqual(["250", "221"]);
    const { body } = await json(catcher.httpPort, "GET", "/messages?to=big@bicii.test");
    expect(body.messages).toEqual([]);
  });

  it("serves the newest message for a recipient, with and without after", async () => {
    const port = catcher.httpPort;
    expect(await json(port, "GET", "/health")).toEqual({ status: 200, body: { ok: true } });

    const latest = await json(port, "GET", "/messages/latest?to=MIXED.CASE%40bicii.test");
    expect(latest.status).toBe(200);
    expect(latest.body).toMatchObject({
      id: 2,
      envelopeFrom: "no-reply@bicii.test",
      envelopeTo: ["mixed.case@bicii.test"],
      subject: "Your BICII sign-in code",
      text: "Your code is 246802. Café.",
      html: "<p>Your code is <b>246802</b>.</p>",
      code: "246802",
    });
    expect(Date.parse(latest.body.receivedAt)).not.toBeNaN();

    expect(
      (await json(port, "GET", "/messages/latest?to=mixed.case@bicii.test&after=1")).body.id,
    ).toBe(2);
    expect(await json(port, "GET", "/messages/latest?to=mixed.case@bicii.test&after=2")).toEqual({
      status: 404,
      body: { error: "not_found" },
    });

    const first = await json(port, "GET", "/messages/latest?to=other@bicii.test");
    expect(first.body).toMatchObject({
      id: 1,
      envelopeFrom: "no-reply@bicii.test",
      envelopeTo: ["mixed.case@bicii.test", "other@bicii.test"],
      from: '"BICII" <no-reply@bicii.test>',
      to: "Mixed.Case@BICII.test",
      subject: "Your BICII sign-in code",
      text: null,
      code: "135790",
    });
    // Quoted-printable decoded and the dot-stuffing undone.
    expect(first.body.html).toBe(
      '<p style="font-size: 32px">135790</p>\r\n.leading dot\r\n<p>It expires in 10 minutes.</p>',
    );

    const list = await json(port, "GET", "/messages");
    expect(list.body.messages.map((m: { id: number }) => m.id)).toEqual([2, 1]);
    expect(list.body.messages[0]).not.toHaveProperty("html");
    expect(list.body.messages[0].code).toBe("246802");
    expect((await json(port, "GET", "/messages?limit=1")).body.messages).toHaveLength(1);
    expect((await json(port, "GET", "/messages?after=1")).body.messages).toHaveLength(1);
    expect((await json(port, "GET", "/messages?to=other@bicii.test")).body.messages).toHaveLength(
      1,
    );

    expect((await json(port, "GET", "/messages/1")).body.id).toBe(1);
    expect(await json(port, "GET", "/messages/99")).toEqual({
      status: 404,
      body: { error: "not_found" },
    });
    const raw = await request(port, "GET", "/messages/1/raw");
    expect(raw.status).toBe(200);
    expect(raw.type).toContain("message/rfc822");
    expect(raw.body).toContain("\r\n.leading dot\r\n");
    expect(raw.body).not.toContain("..leading");
    expect(raw.body.startsWith('From: "BICII" <no-reply@bicii.test>\r\n')).toBe(true);
  });

  it("serves templates by plain name only", async () => {
    const port = catcher.httpPort;
    const ok = await request(port, "GET", "/templates/magic_link.html");
    expect(ok).toMatchObject({ status: 200, body: "<p>{{ .Token }}</p>" });
    expect(ok.type).toContain("text/html");
    for (const bad of [
      "/templates/missing.html",
      "/templates/Magic_Link.html",
      "/templates/magic_link.txt",
      "/templates/../secret.html",
      "/templates/..%2fsecret.html",
      "/templates/%2e%2e%2fsecret.html",
      "/templates/..%5csecret.html",
      "/templates/",
    ]) {
      const res = await request(port, "GET", bad);
      expect({ bad, status: res.status }).toEqual({ bad, status: 404 });
      expect(res.body).not.toContain("not for you");
    }
  });

  it("keeps counting ids after a restart on the same directory", async () => {
    await catcher.close();
    catcher = await startMailCatcher({ smtpPort: 0, httpPort: 0, dir, templatesDir });
    expect((await json(catcher.httpPort, "GET", "/messages")).body.messages).toHaveLength(2);
    const smtp = await smtpConnect(catcher.smtpPort);
    await smtp.next();
    await smtp.send(
      `HELO x\r\nMAIL FROM:<a@b.test>\r\nRCPT TO:<third@bicii.test>\r\nDATA\r\nSubject: three\r\n\r\ncode 777001\r\n.\r\nQUIT\r\n`,
    );
    expect((await smtp.next(6))[4]).toMatch(/^250 .*queued as 3/);
  });

  it("mail-client reads codes after a cursor and clears mail", async () => {
    process.env.BICII_MAIL_URL = `http://127.0.0.1:${catcher.httpPort}`;
    const cursor = await mailCursor("Mixed.Case@bicii.test");
    expect(cursor).toBe("2");
    expect(await mailCursor("nobody@bicii.test")).toBeNull();
    expect(await waitForCode({ to: "third@bicii.test", after: null })).toBe("777001");
    await expect(
      waitForCode({ to: "mixed.case@bicii.test", after: cursor, timeoutMs: 300, intervalMs: 50 }),
    ).rejects.toThrow(/mixed\.case@bicii\.test.*http:\/\/127\.0\.0\.1:\d+/);

    expect(await json(catcher.httpPort, "DELETE", "/messages?to=other@bicii.test")).toEqual({
      status: 200,
      body: { deleted: 1 },
    });
    await clearMail("third@bicii.test");
    expect((await json(catcher.httpPort, "GET", "/messages")).body.messages).toHaveLength(1);
    await clearMail();
    expect((await json(catcher.httpPort, "GET", "/messages")).body.messages).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
  });
});
