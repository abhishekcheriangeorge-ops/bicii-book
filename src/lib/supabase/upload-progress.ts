/**
 * Upload progress for Storage uploads made through the browser Supabase
 * client. `fetch` cannot report upload progress, so the browser client is
 * given `progressFetch`: a fetch that hands requests to a signed upload URL
 * (`/storage/v1/object/upload/sign/…?token=…`) to XMLHttpRequest when
 * someone is listening for that token, and passes everything else to the
 * real fetch untouched.
 *
 *   const stop = onUploadProgress(token, (fraction) => …);
 *   await supabase.storage.from(bucket).uploadToSignedUrl(path, token, blob);
 *   stop();
 */

type Listener = (fraction: number) => void;

const listeners = new Map<string, Listener>();

/** Report progress (0..1) of the upload to the signed URL with this token. */
export function onUploadProgress(token: string, listener: Listener): () => void {
  listeners.set(token, listener);
  return () => {
    if (listeners.get(token) === listener) listeners.delete(token);
  };
}

/** The token of a signed upload URL, or null for any other request. */
export function signedUploadToken(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.pathname.includes("/object/upload/sign/")) return null;
    return u.searchParams.get("token");
  } catch {
    return null;
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function headerEntries(headers: HeadersInit | undefined): [string, string][] {
  if (!headers) return [];
  if (headers instanceof Headers) return [...headers.entries()];
  if (Array.isArray(headers)) return headers.map(([k, v]) => [k, v]);
  return Object.entries(headers);
}

function parseResponseHeaders(raw: string): Headers {
  const headers = new Headers();
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const i = line.indexOf(":");
    if (i > 0) headers.append(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  return headers;
}

const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

function xhrFetch(url: string, init: RequestInit, listener: Listener): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(init.method ?? "GET", url, true);
    for (const [key, value] of headerEntries(init.headers)) xhr.setRequestHeader(key, value);
    xhr.withCredentials = init.credentials === "include";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) listener(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      listener(1);
      resolve(
        new Response(NULL_BODY_STATUS.has(xhr.status) ? null : xhr.responseText, {
          status: xhr.status,
          statusText: xhr.statusText,
          headers: parseResponseHeaders(xhr.getAllResponseHeaders()),
        }),
      );
    };
    xhr.onerror = () => reject(new TypeError("Network request failed"));
    xhr.ontimeout = () => reject(new TypeError("Network request timed out"));
    xhr.onabort = () => reject(new DOMException("The upload was aborted.", "AbortError"));
    if (init.signal) {
      if (init.signal.aborted) return xhr.abort();
      init.signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send((init.body ?? null) as XMLHttpRequestBodyInit | null);
  });
}

/** `fetch`, except that watched signed uploads report progress. */
export const progressFetch: typeof fetch = (input, init) => {
  const token = signedUploadToken(requestUrl(input));
  const listener = token ? listeners.get(token) : undefined;
  if (!listener || typeof XMLHttpRequest === "undefined" || input instanceof Request) {
    return fetch(input, init);
  }
  return xhrFetch(requestUrl(input), init ?? {}, listener);
};
