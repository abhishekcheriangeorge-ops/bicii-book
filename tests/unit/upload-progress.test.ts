import { afterEach, describe, expect, it, vi } from "vitest";

import { onUploadProgress, progressFetch, signedUploadToken } from "@/lib/supabase/upload-progress";

const UPLOAD_URL =
  "http://127.0.0.1:54321/storage/v1/object/upload/sign/media-internal/bike/b/x.jpg?token=tok-1";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signedUploadToken", () => {
  it("finds the token of a signed upload URL only", () => {
    expect(signedUploadToken(UPLOAD_URL)).toBe("tok-1");
    expect(
      signedUploadToken("http://127.0.0.1:54321/storage/v1/object/sign/a/b?token=t"),
    ).toBeNull();
    expect(signedUploadToken("http://127.0.0.1:54321/rest/v1/rpc/x")).toBeNull();
    expect(signedUploadToken("not a url")).toBeNull();
  });
});

class FakeXhr {
  static last: FakeXhr | null = null;
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  withCredentials = false;
  status = 0;
  statusText = "";
  responseText = "";
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  getAllResponseHeaders() {
    return "content-type: application/json\r\n";
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.onabort?.();
  }
}

describe("progressFetch", () => {
  it("passes requests nobody watches to fetch", async () => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    await progressFetch(UPLOAD_URL, { method: "PUT" });
    await progressFetch("http://127.0.0.1:54321/rest/v1/x");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uploads a watched signed upload with XMLHttpRequest and reports progress", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const seen: number[] = [];
    const stop = onUploadProgress("tok-1", (f) => seen.push(f));
    const body = new FormData();
    const pending = progressFetch(UPLOAD_URL, {
      method: "PUT",
      headers: new Headers({ "x-upsert": "false" }),
      body,
    });
    const xhr = FakeXhr.last!;
    expect(xhr.method).toBe("PUT");
    expect(xhr.headers["x-upsert"]).toBe("false");
    expect(xhr.body).toBe(body);
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 200 } as ProgressEvent);
    xhr.status = 200;
    xhr.responseText = '{"Key":"media-internal/bike/b/x.jpg"}';
    xhr.onload?.();
    const res = await pending;
    stop();
    expect(seen).toEqual([0.25, 1]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ Key: "media-internal/bike/b/x.jpg" });
  });

  it("rejects like fetch on a network error", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const stop = onUploadProgress("tok-1", () => {});
    const pending = progressFetch(UPLOAD_URL, { method: "PUT", body: new FormData() });
    FakeXhr.last!.onerror?.();
    await expect(pending).rejects.toBeInstanceOf(TypeError);
    stop();
  });
});
