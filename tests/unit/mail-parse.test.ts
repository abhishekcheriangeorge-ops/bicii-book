// @vitest-environment node
// The devstack mail catcher's parser (scripts/devstack/mail-parse.mjs): the
// pure functions behind reading sign-in codes out of Auth's emails.
import { describe, expect, it } from "vitest";

import {
  decodeEncodedWords,
  extractCode,
  htmlToText,
  parseMessage,
} from "../../scripts/devstack/mail-parse.mjs";

const crlf = (lines: string[]) => lines.join("\r\n");

describe("parseMessage", () => {
  it("unfolds headers and decodes RFC 2047 B and Q words in utf-8", () => {
    const raw = crlf([
      'From: "BICII" <no-reply@bicii.test>',
      "To: =?UTF-8?Q?Ren=C3=A9e_Tan?= <renee@bicii.test>",
      "Subject: =?UTF-8?B?WW91ciBCSUNJSSBjb2Rl?=",
      " =?UTF-8?Q?_=E2=80=94_caf=C3=A9?=",
      "X-Long: first part",
      "\tsecond part",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Hello",
    ]);
    const parsed = parseMessage(raw);
    expect(parsed.from).toBe('"BICII" <no-reply@bicii.test>');
    expect(parsed.to).toBe("Renée Tan <renee@bicii.test>");
    // Adjacent encoded words join without the folding whitespace.
    expect(parsed.subject).toBe("Your BICII code — café");
    expect(parsed.headers["x-long"]).toBe("first part\tsecond part");
    expect(parsed.text).toBe("Hello");
    expect(parsed.html).toBeNull();
  });

  it("decodes a quoted-printable HTML body with soft line breaks", () => {
    const raw = crlf([
      "Subject: Code",
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      '<p style=3D"font-size: 32px">Your code is 482=',
      "913</p><p>Caf=C3=A9 =E2=80=94 10 minutes.</p>",
    ]);
    const parsed = parseMessage(raw);
    expect(parsed.html).toBe(
      '<p style="font-size: 32px">Your code is 482913</p><p>Café — 10 minutes.</p>',
    );
    expect(parsed.text).toBeNull();
  });

  it("walks nested multipart bodies, base64 parts and skips attachments", () => {
    const html = Buffer.from("<b>Kód: 120045</b>", "utf8").toString("base64");
    const raw = crlf([
      "Subject: nested",
      'Content-Type: multipart/mixed; boundary="outer"',
      "",
      "preamble",
      "--outer",
      "Content-Type: multipart/alternative; boundary=inner",
      "",
      "--inner",
      "Content-Type: text/plain; charset=iso-8859-1",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Caf=E9 code 120045",
      "--inner",
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      html.slice(0, 10),
      html.slice(10),
      "--inner--",
      "--outer",
      "Content-Type: text/plain",
      "Content-Disposition: attachment; filename=notes.txt",
      "",
      "not the body 999999",
      "--outer--",
      "epilogue",
    ]);
    const parsed = parseMessage(raw);
    expect(parsed.text).toBe("Café code 120045");
    expect(parsed.html).toBe("<b>Kód: 120045</b>");
  });

  it("reads raw 8-bit utf-8 bodies and headers from bytes", () => {
    const raw = Buffer.from(
      crlf([
        "Subject: Prüfung",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        "Grüße 654321",
      ]),
      "utf8",
    );
    const parsed = parseMessage(raw);
    expect(parsed.subject).toBe("Prüfung");
    expect(parsed.text).toBe("Grüße 654321");
  });

  it("treats a message without Content-Type as text/plain and accepts bare LF", () => {
    const parsed = parseMessage("Subject: plain\n\nline one\nline two");
    expect(parsed.subject).toBe("plain");
    expect(parsed.text).toBe("line one\nline two");
  });
});

describe("decodeEncodedWords", () => {
  it("leaves plain text and malformed words alone", () => {
    expect(decodeEncodedWords("plain words")).toBe("plain words");
    expect(decodeEncodedWords("=?utf-8?X?abc?=")).toBe("=?utf-8?X?abc?=");
    expect(decodeEncodedWords("a =?utf-8?q?b?= c")).toBe("a b c");
  });
});

describe("htmlToText", () => {
  it("drops head, style and script, breaks at blocks and decodes entities", () => {
    const html =
      "<html><head><title>T</title><style>p { color: #123456 }</style></head>" +
      "<body><h1>Your&nbsp;code</h1><p>Enter &amp; go:<br>  <b>1 2</b></p>" +
      "<script>var x = 777777;</script><p>&#8212; &#x2014; &lt;ok&gt;</p></body></html>";
    expect(htmlToText(html)).toBe("Your code\n\nEnter & go:\n1 2\n\n— — <ok>");
  });

  it("returns an empty string for nothing", () => {
    expect(htmlToText(null)).toBe("");
    expect(htmlToText("")).toBe("");
  });
});

describe("extractCode", () => {
  it("prefers the text part, then the tag-stripped HTML", () => {
    expect(extractCode({ text: "Code 123456", html: "<p>654321</p>" })).toBe("123456");
    expect(extractCode({ text: "no code here", html: "<p>Code</p><p>654321</p>" })).toBe("654321");
    expect(extractCode({ text: null, html: null })).toBeNull();
  });

  it("finds only standalone runs of min..max digits", () => {
    expect(extractCode({ text: "12345 then 123456" })).toBe("123456");
    expect(extractCode({ text: "id 12345678901 then 0042000" })).toBe("0042000");
    expect(extractCode({ text: "abc123456 x" })).toBeNull();
    expect(extractCode({ text: "colour #123456" })).toBeNull();
    expect(extractCode({ text: "Kód:\n  987654\n" })).toBe("987654");
  });

  it("ignores digits inside tags and styles in the HTML", () => {
    const html =
      '<div style="width: 1234567px; color: #abcdef"><style>.a{b:999999}</style>' +
      "<span>Your code</span> <b>246810</b></div>";
    expect(extractCode({ html })).toBe("246810");
  });

  it("honours min and max", () => {
    expect(extractCode({ text: "1234 and 123456" }, { min: 4, max: 4 })).toBe("1234");
    expect(extractCode({ text: "12345678" }, { min: 6, max: 6 })).toBeNull();
  });
});
