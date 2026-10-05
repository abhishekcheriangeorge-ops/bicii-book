#!/usr/bin/env node
// Devstack API gateway: the same URL layout as Supabase (Kong) on one port,
// with no dependencies.
//
//   /auth/v1/*     -> Supabase Auth  (prefix stripped)
//   /rest/v1/*     -> PostgREST      (prefix stripped)
//   /storage/v1/*  -> Supabase Storage (prefix stripped)
//   GET /health    -> JSON health of every upstream
//
// Headers pass through untouched, except: Host is rewritten for the
// upstream, X-Forwarded-* are added, and (as Supabase's gateway does) an
// `apikey` header with no Authorization becomes `Authorization: Bearer
// <apikey>`. CORS is wide open: this is for local development only.

import http from "node:http";

import { PORTS } from "./config.mjs";

const UPSTREAMS = [
  { prefix: "/auth/v1", name: "auth", port: PORTS.auth, health: "/health" },
  { prefix: "/rest/v1", name: "rest", port: PORTS.rest, health: "/" },
  { prefix: "/storage/v1", name: "storage", port: PORTS.storage, health: "/status" },
];

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function corsHeaders(req) {
  return {
    "access-control-allow-origin": req.headers.origin ?? "*",
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD",
    "access-control-allow-headers":
      req.headers["access-control-request-headers"] ??
      "authorization, x-client-info, apikey, content-type, prefer, range, x-upsert, accept-profile, content-profile",
    "access-control-expose-headers": "content-range, content-length, content-type, etag, location",
    "access-control-max-age": "3600",
    vary: "Origin",
  };
}

function probe(port, pathname) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: pathname, timeout: 2000 }, (res) => {
      res.resume();
      resolve({ ok: res.statusCode < 500, status: res.statusCode });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (err) => resolve({ ok: false, error: err.message }));
  });
}

async function health(req, res) {
  const entries = await Promise.all(
    UPSTREAMS.map(async (u) => [u.name, { port: u.port, ...(await probe(u.port, u.health)) }]),
  );
  const upstreams = Object.fromEntries(entries);
  const ok = entries.every(([, v]) => v.ok);
  res.writeHead(ok ? 200 : 503, { "content-type": "application/json", ...corsHeaders(req) });
  res.end(JSON.stringify({ ok, gateway: { port: PORTS.gateway }, upstreams }));
}

function proxy(req, res, upstream) {
  const rest = req.url.slice(upstream.prefix.length) || "/";
  const target = rest.startsWith("/") || rest.startsWith("?") ? rest : `/${rest}`;
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(k)) headers[k] = v;
  }
  headers.host = `127.0.0.1:${upstream.port}`;
  headers["x-forwarded-host"] = req.headers.host ?? `127.0.0.1:${PORTS.gateway}`;
  headers["x-forwarded-proto"] = "http";
  headers["x-forwarded-prefix"] = upstream.prefix;
  headers["x-forwarded-for"] = req.socket.remoteAddress ?? "127.0.0.1";
  if (!headers.authorization && typeof headers.apikey === "string") {
    headers.authorization = `Bearer ${headers.apikey}`;
  }

  const upstreamReq = http.request(
    {
      host: "127.0.0.1",
      port: upstream.port,
      method: req.method,
      path: target.startsWith("?") ? `/${target}` : target,
      headers,
    },
    (upstreamRes) => {
      const out = {};
      for (const [k, v] of Object.entries(upstreamRes.headers)) {
        if (!HOP_BY_HOP.has(k) && !k.startsWith("access-control-")) out[k] = v;
      }
      res.writeHead(upstreamRes.statusCode ?? 502, { ...out, ...corsHeaders(req) });
      upstreamRes.pipe(res);
    },
  );
  upstreamReq.on("error", (err) => {
    if (res.headersSent) {
      res.destroy(err);
      return;
    }
    res.writeHead(502, { "content-type": "application/json", ...corsHeaders(req) });
    res.end(
      JSON.stringify({ error: "bad_gateway", upstream: upstream.name, message: err.message }),
    );
  });
  req.pipe(upstreamReq);
}

const server = http.createServer((req, res) => {
  const url = req.url ?? "/";
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }
  if (url === "/health" || url.startsWith("/health?")) {
    void health(req, res);
    return;
  }
  const upstream = UPSTREAMS.find(
    (u) => url === u.prefix || url.startsWith(`${u.prefix}/`) || url.startsWith(`${u.prefix}?`),
  );
  if (!upstream) {
    res.writeHead(404, { "content-type": "application/json", ...corsHeaders(req) });
    res.end(JSON.stringify({ error: "not_found", message: `no route for ${url}` }));
    return;
  }
  proxy(req, res, upstream);
});

server.listen(PORTS.gateway, "127.0.0.1", () => {
  process.stdout.write(`[gateway] listening on http://127.0.0.1:${PORTS.gateway}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
}
