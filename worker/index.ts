import { AnalyticsDO } from "./analyticsDO";
import { DailyChallengeDO } from "./dailyChallengeDO";
import { parseShareRecord, renderShareImage, shareTitleAndDescription } from "./shareImage";
import { CATALOG_KV_KEY, MAX_CATALOG_BYTES, parseCatalogJson } from "../src/content/catalogSchema";

export { AnalyticsDO, DailyChallengeDO };

export interface Env {
  SHARE_KV: KVNamespace;
  ASSETS: Fetcher;
  DAILY_CHALLENGE_DO: DurableObjectNamespace;
  ANALYTICS_DO: DurableObjectNamespace;
  ANALYTICS_ADMIN_TOKEN: string;
}

// Excludes 0/O and 1/I to avoid ids that are ambiguous when read aloud or copied by hand.
const ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
// 8 chars over a 32-symbol alphabet (~40 bits) makes enumerating other players'
// shared drawings ~1000x harder than 6 chars, at no cost. Backward compatible:
// the /c/:id and /api/share/:id route matchers already accept 4-12 chars, so
// existing 6-char links keep resolving.
const ID_LENGTH = 8;
const MAX_BODY_BYTES = 20_000;
const TTL_SECONDS = 60 * 60 * 24 * 180; // 180 days

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH));
  let id = "";
  for (const byte of bytes) id += ID_ALPHABET[byte % ID_ALPHABET.length];
  return id;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

async function handleCreate(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  if (!body || body.length > MAX_BODY_BYTES) return json({ error: "invalid payload" }, 400);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const type = (parsed as Record<string, unknown> | null)?.type;
  if (type !== "c" && type !== "r" && type !== "a") return json({ error: "invalid shape" }, 400);

  for (let attempt = 0; attempt < 5; attempt++) {
    const id = randomId();
    const existing = await env.SHARE_KV.get(id);
    if (existing === null) {
      await env.SHARE_KV.put(id, body, { expirationTtl: TTL_SECONDS });
      return json({ id }, 201);
    }
  }
  return json({ error: "could not allocate id" }, 500);
}

async function handleGet(id: string, env: Env): Promise<Response> {
  const value = await env.SHARE_KV.get(id);
  if (value === null) return json({ error: "not found" }, 404);
  return new Response(value, { headers: { "content-type": "application/json" } });
}

async function handleShareImage(id: string, env: Env): Promise<Response> {
  const value = await env.SHARE_KV.get(id);
  const record = value === null ? null : parseShareRecord(value);
  const png = record ? await renderShareImage(record) : null;
  if (!png) return new Response("Not found", { status: 404 });
  return new Response(png, {
    headers: {
      "content-type": "image/png",
      // Share payloads are immutable once created (see handleCreate) - safe to cache hard.
      "cache-control": "public, max-age=604800, immutable",
    },
  });
}

// Rewrites the SPA shell's generic Open Graph/Twitter tags with the specific
// challenge/result being shared, so chat apps that unfurl the link (WhatsApp,
// iMessage, Slack, ...) show the player's actual drawing instead of a bare link.
// Real visitors get the exact same HTML/JS bundle underneath - only the <head>
// metadata differs, so the SPA behaves identically once it mounts.
async function handleShareLinkPage(id: string, request: Request, env: Env): Promise<Response | null> {
  const value = await env.SHARE_KV.get(id);
  if (value === null) return null;
  const record = parseShareRecord(value);
  if (!record) return null;
  const copy = shareTitleAndDescription(record);
  if (!copy) return null;

  const pageResponse = await env.ASSETS.fetch(request);
  if (!pageResponse.ok) return null;

  const imageUrl = new URL(`/api/share/${id}/image.png`, request.url).toString();
  const shareUrl = new URL(request.url).toString();

  return new HTMLRewriter()
    .on("title", {
      element(el) {
        el.setInnerContent(copy.title);
      },
    })
    .on('meta[property="og:title"]', {
      element(el) {
        el.setAttribute("content", copy.title);
      },
    })
    .on('meta[property="og:description"]', {
      element(el) {
        el.setAttribute("content", copy.description);
      },
    })
    .on('meta[name="twitter:title"]', {
      element(el) {
        el.setAttribute("content", copy.title);
      },
    })
    .on('meta[name="twitter:description"]', {
      element(el) {
        el.setAttribute("content", copy.description);
      },
    })
    .on('meta[name="twitter:card"]', {
      element(el) {
        el.setAttribute("content", "summary_large_image");
      },
    })
    .on("head", {
      element(el) {
        el.append(`<meta property="og:image" content="${imageUrl}">`, { html: true });
        el.append(`<meta property="og:image:width" content="640">`, { html: true });
        el.append(`<meta property="og:image:height" content="640">`, { html: true });
        el.append(`<meta property="og:url" content="${shareUrl}">`, { html: true });
        el.append(`<meta name="twitter:image" content="${imageUrl}">`, { html: true });
      },
    })
    .transform(pageResponse);
}

// ---------- Content catalog (server-published shapes/categories) ----------
// GET is public and served straight from KV; PUT/DELETE are owner-only,
// guarded by the same admin bearer token as the analytics report. The
// catalog is pure JSON data (validated on upload with the exact same
// schema the client enforces) - the server never stores or serves code.

// Constant-time comparison, same rationale as analyticsDO.ts.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isAdminAuthorized(request: Request, env: Env): boolean {
  const token = env.ANALYTICS_ADMIN_TOKEN;
  const authHeader = request.headers.get("authorization");
  return Boolean(token && authHeader && timingSafeEqual(authHeader, `Bearer ${token}`));
}

async function handleCatalogGet(env: Env): Promise<Response> {
  const raw = await env.SHARE_KV.get(CATALOG_KV_KEY);
  if (raw === null) return json({ error: "no catalog published" }, 404);
  return new Response(raw, {
    headers: {
      "content-type": "application/json",
      // Short edge cache: a freshly published catalog reaches every client
      // within minutes while repeat app launches mostly hit the edge.
      "cache-control": "public, max-age=300",
    },
  });
}

async function handleCatalogPut(request: Request, env: Env): Promise<Response> {
  if (!isAdminAuthorized(request, env)) return json({ error: "unauthorized" }, 401);

  const raw = await request.text();
  if (!raw || raw.length > MAX_CATALOG_BYTES) return json({ error: "catalog missing or exceeds size cap" }, 400);

  const result = parseCatalogJson(raw);
  if (!result.ok) return json({ error: `invalid catalog: ${result.error}` }, 400);

  await env.SHARE_KV.put(CATALOG_KV_KEY, raw);
  return json({
    ok: true,
    contentVersion: result.catalog.contentVersion,
    categories: result.catalog.categories.length,
    shapes: result.catalog.shapes.length,
  });
}

/** Rollback-to-baked-in switch: with the key gone, GET returns 404, clients clear their cache on next refresh and fall back to bundled content. */
async function handleCatalogDelete(request: Request, env: Env): Promise<Response> {
  if (!isAdminAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
  await env.SHARE_KV.delete(CATALOG_KV_KEY);
  return json({ ok: true });
}

// Every /api/daily/* request is forwarded to the single global DailyChallengeDO
// instance, which processes requests one at a time (see dailyChallengeDO.ts).
function forwardToDailyDO(request: Request, env: Env, path: string): Promise<Response> {
  const id = env.DAILY_CHALLENGE_DO.idFromName("global");
  const stub = env.DAILY_CHALLENGE_DO.get(id);
  const url = new URL(request.url);
  const target = new URL(path + url.search, "https://daily-challenge.internal");
  return stub.fetch(target.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
  });
}

// Every /api/analytics/* request is forwarded to the single global AnalyticsDO
// instance, which processes requests one at a time (see analyticsDO.ts) so counter
// increments can never race or lose an update.
function forwardToAnalyticsDO(request: Request, env: Env, path: string): Promise<Response> {
  const id = env.ANALYTICS_DO.idFromName("analytics");
  const stub = env.ANALYTICS_DO.get(id);
  const url = new URL(request.url);
  const target = new URL(path + url.search, "https://analytics.internal");
  return stub.fetch(target.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/share" && request.method === "POST") return handleCreate(request, env);

    const shareMatch = url.pathname.match(/^\/api\/share\/([A-Za-z0-9]{4,12})$/);
    if (shareMatch && request.method === "GET") return handleGet(shareMatch[1], env);

    const shareImageMatch = url.pathname.match(/^\/api\/share\/([A-Za-z0-9]{4,12})\/image\.png$/);
    if (shareImageMatch && request.method === "GET") return handleShareImage(shareImageMatch[1], env);

    if (url.pathname === "/api/content/catalog") {
      if (request.method === "GET") return handleCatalogGet(env);
      if (request.method === "PUT") return handleCatalogPut(request, env);
      if (request.method === "DELETE") return handleCatalogDelete(request, env);
    }

    if (url.pathname === "/api/daily/current" && request.method === "GET") return forwardToDailyDO(request, env, "/current");
    if (url.pathname === "/api/daily/submit" && request.method === "POST") return forwardToDailyDO(request, env, "/submit");
    if (url.pathname === "/api/daily/claim-prizes" && request.method === "POST") return forwardToDailyDO(request, env, "/claim-prizes");
    if (url.pathname === "/api/daily/history" && request.method === "GET") return forwardToDailyDO(request, env, "/history");

    const episodeMatch = url.pathname.match(/^\/api\/daily\/episode\/(\d+)$/);
    if (episodeMatch && request.method === "GET") return forwardToDailyDO(request, env, `/episode/${episodeMatch[1]}`);

    if (url.pathname === "/api/analytics/event" && request.method === "POST") return forwardToAnalyticsDO(request, env, "/event");
    if (url.pathname === "/api/analytics/report" && request.method === "GET") return forwardToAnalyticsDO(request, env, "/report");

    const shareLinkMatch = url.pathname.match(/^\/c\/([A-Za-z0-9]{4,12})$/);
    if (shareLinkMatch && request.method === "GET") {
      const rewritten = await handleShareLinkPage(shareLinkMatch[1], request, env);
      if (rewritten) return rewritten;
    }

    return env.ASSETS.fetch(request);
  },
};
