import { AnalyticsDO, COUNTRY_HEADER, FULL_KEEP_PERCENT, normalizeCountry, SHED_KEEP_HEADER } from "./analyticsDO";
import { CONTENT_PAGE_CACHE_CONTROL, CONTENT_PAGE_CONTENT_TYPE, ROBOTS_CONTENT_TYPE, SITEMAP_CONTENT_TYPE, TEXT_RESPONSE_CACHE_CONTROL } from "./cachePolicy";
import {
  ANALYTICS_BREAKER_KV_KEY,
  isValidAnalyticsBreakerConfig,
  parseAnalyticsControl,
  readAnalyticsControl,
} from "./analyticsBreaker";
import { decideShedding, effectiveShedPolicy, shedEnforcementError, shedLogLine } from "./analyticsShedding";
import {
  evaluateRoomCreation,
  guardConfigAgeMs,
  guardLogLine,
  effectiveMode,
  isValidGuardConfig,
  MAX_HISTORY_ENTRIES,
  MULTIPLAYER_GUARD_KV_KEY,
  parseGuardConfig,
  readGuardConfig,
  enforcementConfigError,
  guardRejectionBody,
  isEnforcementActive,
  GUARD_FAIL_OPEN,
  GUARD_REJECTION_STATUS,
  type GuardTransition,
  type MultiplayerGuardConfig,
} from "./multiplayerGuard";
import { DailyChallengeDO } from "./dailyChallengeDO";
import { RoomDO } from "./roomDO";
import { parseShareRecord, renderShareImage, shareTitleAndDescription } from "./shareImage";
import {
  CONTENT_ACTIVE_KEY,
  CONTENT_RELEASES_INDEX_KEY,
  contentReleaseKey,
  MAX_CATALOG_BYTES,
  parseCatalogJson,
  parseReleaseJson,
  RELEASE_ID_PATTERN,
  sha256Hex,
  type CatalogRelease,
  type ReleaseIndexEntry,
} from "../src/content/catalogSchema";
import { ADS_CONFIG_KV_KEY, isValidRemoteAdsConfig, parseRemoteAdsConfig } from "../src/services/ads/remoteAdsConfigSchema";
import {
  INTERSTITIAL_CONFIG_KV_KEY,
  isValidInterstitialStoredConfig,
  parseInterstitialStoredConfig,
  toClientConfig,
} from "../src/services/ads/interstitialConfigSchema";
import { isRoomCode, MP_LIMITS, ROOM_CODE_ALPHABET } from "../src/multiplayer/protocol";
import { campaignLinkForPath, campaignRedirectUrl, CAMPAIGN_PATH_PREFIX } from "./campaignLinks";
import { versionGateResponse } from "./multiplayerVersionGate";
import { ANDROID_PATH, androidRedirectUrl, canonicalUrl, renderSeoSection, robotsTxt, seoPageForPath, sitemapXml, type SeoPage } from "./seoPages";
import { CONTENT_PATHS, contentPageForPath, renderContentDocument } from "./contentPages";

export { AnalyticsDO, DailyChallengeDO, RoomDO };

export interface Env {
  /** User share content ONLY (drawings/challenges/results). Never content-catalog data. */
  SHARE_KV: KVNamespace;
  /** Dynamic content catalog releases - see the KV-layout note in catalogSchema.ts. */
  CONTENT_KV: KVNamespace;
  ASSETS: Fetcher;
  DAILY_CHALLENGE_DO: DurableObjectNamespace;
  ANALYTICS_DO: DurableObjectNamespace;
  /** Play Together - one instance per room code, addressed by idFromName (see worker/roomDO.ts). */
  ROOM_DO: DurableObjectNamespace;
  /** Admin bearer for the analytics report endpoint only. */
  ANALYTICS_ADMIN_TOKEN: string;
  /** Admin bearer for content-catalog publish/activate/list/delete. Deliberately SEPARATE from ANALYTICS_ADMIN_TOKEN so the two capabilities can be rotated and scoped independently. */
  CONTENT_ADMIN_TOKEN: string;
  /**
   * Admin bearer for the multiplayer cost guard, and nothing else. A third separate
   * credential rather than a reuse of CONTENT_ADMIN_TOKEN because the guard is the one
   * admin surface that can degrade a live feature for real users: whoever operates it
   * during an incident should not thereby be able to publish content or read analytics,
   * and it should be rotatable on its own after an incident without breaking publishing.
   */
  GUARD_ADMIN_TOKEN: string;
  /**
   * Admin bearer for the analytics breaker and its country shedding policy, and
   * nothing else. Separate from GUARD_ADMIN_TOKEN as well as from CONTENT_ADMIN_TOKEN:
   * the two guards protect different Durable Objects and are meant to be operable -
   * and revocable - independently, so holding the lever that can silence telemetry
   * must not also hand over the one that can take Play Together offline.
   */
  ANALYTICS_GUARD_ADMIN_TOKEN: string;
  /**
   * The Emergency Ops Panel's own credentials (the `cydi-ops` Worker, ops/). Held ONLY
   * by that Worker, never by a CLI session, so revoking the panel never locks the
   * operator out of the CLI path and vice versa. Each is a SECOND key to exactly one
   * guard's config route pair and is narrower than the operator token beside it: no
   * status route, and the analytics one cannot move the `disabled` breaker. Optional on
   * purpose - unset means the panel is locked out, never that anything opens.
   */
  OPS_GUARD_ADMIN_TOKEN?: string;
  OPS_ANALYTICS_GUARD_ADMIN_TOKEN?: string;
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

// ---------- Web-only SEO (metadata + crawlable copy) ----------
// Same HTMLRewriter approach as handleShareLinkPage above, for the homepage and
// the SEO landing paths: real visitors get the identical HTML/JS bundle and the
// identical game, only the <head> differs and a copy block is appended at the
// very end of <body> - after the full-height #root, so the game still owns the
// whole first screen. The Android app is untouched by construction: Capacitor
// loads index.html from the APK and never fetches HTML through this Worker.

async function handleSeoPage(page: SeoPage, request: Request, env: Env): Promise<Response> {
  // The landing paths are served by the assets binding's SPA fallback
  // (not_found_handling: single-page-application), so this returns the shell.
  let shell = await env.ASSETS.fetch(request);
  if (!shell.ok) {
    // Defensive only: if a path ever stops falling back, serve the shell
    // explicitly rather than turning a landing page into a 404.
    shell = await env.ASSETS.fetch(new Request(new URL("/", request.url), request));
    if (!shell.ok) return shell;
  }

  const canonical = canonicalUrl(page.path);

  return new HTMLRewriter()
    .on("title", {
      element(el) {
        el.setInnerContent(page.title);
      },
    })
    .on('meta[property="og:title"]', {
      element(el) {
        el.setAttribute("content", page.title);
      },
    })
    .on('meta[property="og:description"]', {
      element(el) {
        el.setAttribute("content", page.description);
      },
    })
    .on('meta[name="twitter:title"]', {
      element(el) {
        el.setAttribute("content", page.title);
      },
    })
    .on('meta[name="twitter:description"]', {
      element(el) {
        el.setAttribute("content", page.description);
      },
    })
    .on("head", {
      element(el) {
        // The shell has no description/canonical/og:url of its own, so these are
        // appended rather than rewritten - exactly one of each per page.
        el.append(`<meta name="description" content="${escapeAttribute(page.description)}">`, { html: true });
        el.append(`<link rel="canonical" href="${canonical}">`, { html: true });
        el.append(`<meta property="og:url" content="${canonical}">`, { html: true });
      },
    })
    .on("body", {
      element(el) {
        el.append(renderSeoSection(page), { html: true });
      },
    })
    .transform(shell);
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function textResponse(body: string, contentType: string): Response {
  return new Response(body, {
    headers: { "content-type": contentType, "cache-control": TEXT_RESPONSE_CACHE_CONTROL },
  });
}

/** Copies a response so a header can be added - transform()/asset responses are not guaranteed mutable. */
function withHeader(response: Response, name: string, value: string): Response {
  const headers = new Headers(response.headers);
  headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// ---------- Content catalog (server-published shapes/categories) ----------
// GET is public and served straight from KV; PUT/POST(activate)/DELETE and the
// releases listing are owner-only, guarded by CONTENT_ADMIN_TOKEN (separate
// from the analytics token). The catalog is pure JSON data (validated on upload
// with the exact same schema the client enforces) - the server never stores or
// serves code.

// Constant-time comparison, same rationale as analyticsDO.ts.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * One bearer convention for every admin surface; only the credential differs.
 * An unset secret authorizes nobody - a missing binding must lock the door, not open it.
 */
function isBearer(request: Request, token: string | undefined): boolean {
  const authHeader = request.headers.get("authorization");
  return Boolean(token && authHeader && timingSafeEqual(authHeader, `Bearer ${token}`));
}

/** Content-catalog admin gate - uses CONTENT_ADMIN_TOKEN, independent of the analytics token. */
function isContentAdminAuthorized(request: Request, env: Env): boolean {
  return isBearer(request, env.CONTENT_ADMIN_TOKEN);
}

/**
 * Multiplayer-guard admin gate - uses GUARD_ADMIN_TOKEN and ONLY that.
 *
 * Deliberately does not also accept CONTENT_ADMIN_TOKEN. There is nothing to stay
 * compatible with: these routes went live on 24 Sep 2026 and no caller has ever
 * successfully authenticated against them, so accepting the broader token would buy
 * no compatibility and would hand every content publisher the ability to take Play
 * Together offline. Least privilege runs both ways - the guard token is equally
 * useless against the content and analytics endpoints.
 */
function isGuardAdminAuthorized(request: Request, env: Env): boolean {
  return isBearer(request, env.GUARD_ADMIN_TOKEN);
}

/**
 * Analytics breaker + shedding gate - uses ANALYTICS_GUARD_ADMIN_TOKEN and ONLY that.
 *
 * Deliberately does not also accept CONTENT_ADMIN_TOKEN, even though that token used
 * to open these two routes. Nothing external depends on the old pairing - the breaker
 * has never been flipped in production - so there is no compatibility to preserve,
 * and every extra credential that opens an emergency control is one more way to
 * silence telemetry by accident. Least privilege runs both ways: this token is
 * equally useless against the content, analytics-report and multiplayer routes.
 */
function isAnalyticsGuardAdminAuthorized(request: Request, env: Env): boolean {
  return isBearer(request, env.ANALYTICS_GUARD_ADMIN_TOKEN);
}

/**
 * Which credential opened a guard config route: the operator's own token, the Ops
 * Panel's narrower one, or neither. The operator token is checked first, so the
 * operator's privileges never depend on whether the panel's secret is set.
 */
type GuardCaller = "operator" | "ops-panel" | null;

function guardConfigCaller(request: Request, env: Env): GuardCaller {
  if (isGuardAdminAuthorized(request, env)) return "operator";
  if (isBearer(request, env.OPS_GUARD_ADMIN_TOKEN)) return "ops-panel";
  return null;
}

function analyticsGuardConfigCaller(request: Request, env: Env): GuardCaller {
  if (isAnalyticsGuardAdminAuthorized(request, env)) return "operator";
  if (isBearer(request, env.OPS_ANALYTICS_GUARD_ADMIN_TOKEN)) return "ops-panel";
  return null;
}

/** Admin responses must never sit in any shared/edge cache. */
function jsonNoStore(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** Reads the active pointer and returns the referenced release's raw envelope text, or null when nothing is published/dangling. */
async function readActiveReleaseRaw(env: Env): Promise<string | null> {
  const pointerRaw = await env.CONTENT_KV.get(CONTENT_ACTIVE_KEY);
  if (pointerRaw === null) return null;
  let releaseId: unknown;
  try {
    releaseId = (JSON.parse(pointerRaw) as Record<string, unknown>).releaseId;
  } catch {
    return null;
  }
  if (typeof releaseId !== "string" || !RELEASE_ID_PATTERN.test(releaseId)) return null;
  return env.CONTENT_KV.get(contentReleaseKey(releaseId));
}

async function handleCatalogGet(env: Env): Promise<Response> {
  const raw = await readActiveReleaseRaw(env);
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

/**
 * Publish flow (all-or-nothing, immutable):
 *   validate -> hash -> store under a NEW releaseId -> read back and verify
 *   byte-for-byte -> update the releases index -> only then flip
 *   content:active. Re-publishing identical bytes is a no-op (same hash as
 *   the active release) so a retried upload never creates duplicate releases.
 */
async function handleCatalogPut(request: Request, env: Env): Promise<Response> {
  if (!isContentAdminAuthorized(request, env)) return jsonNoStore({ error: "unauthorized" }, 401);

  const raw = await request.text();
  if (!raw || raw.length > MAX_CATALOG_BYTES) return jsonNoStore({ error: "catalog missing or exceeds size cap" }, 400);

  const result = parseCatalogJson(raw);
  if (!result.ok) return jsonNoStore({ error: `invalid catalog: ${result.error}` }, 400);
  const catalogHash = await sha256Hex(raw);

  const activeRaw = await readActiveReleaseRaw(env);
  if (activeRaw !== null) {
    const active = parseReleaseJson(activeRaw);
    if (active.ok && active.release.catalogHash === catalogHash) {
      return jsonNoStore({ ok: true, alreadyActive: true, releaseId: active.release.releaseId, catalogHash });
    }
  }

  const releaseId = `r-${Date.now()}-${randomId().slice(0, 6)}`;
  const release: CatalogRelease = {
    releaseId,
    catalogHash,
    publishedAt: new Date().toISOString(),
    contentVersion: result.catalog.contentVersion,
    formatVersion: result.catalog.formatVersion,
    catalogJson: raw,
  };
  const releaseRaw = JSON.stringify(release);
  await env.CONTENT_KV.put(contentReleaseKey(releaseId), releaseRaw);

  // Read-back verification: the pointer only ever flips to a release whose
  // stored bytes provably round-tripped intact.
  const readBack = await env.CONTENT_KV.get(contentReleaseKey(releaseId));
  if (readBack === null || readBack !== releaseRaw || (await sha256Hex(JSON.parse(readBack).catalogJson)) !== catalogHash) {
    return jsonNoStore({ error: "read-back verification failed; active catalog unchanged" }, 500);
  }

  const indexRaw = await env.CONTENT_KV.get(CONTENT_RELEASES_INDEX_KEY);
  let index: ReleaseIndexEntry[] = [];
  try {
    index = indexRaw ? (JSON.parse(indexRaw) as ReleaseIndexEntry[]) : [];
  } catch {
    index = [];
  }
  index.unshift({
    releaseId,
    catalogHash,
    publishedAt: release.publishedAt,
    contentVersion: release.contentVersion,
    shapes: result.catalog.shapes.length,
    categories: result.catalog.categories.length,
  });
  // The index is a listing convenience; release blobs themselves are never auto-deleted.
  await env.CONTENT_KV.put(CONTENT_RELEASES_INDEX_KEY, JSON.stringify(index.slice(0, 50)));

  await env.CONTENT_KV.put(CONTENT_ACTIVE_KEY, JSON.stringify({ releaseId }));

  return jsonNoStore({
    ok: true,
    releaseId,
    catalogHash,
    contentVersion: release.contentVersion,
    categories: result.catalog.categories.length,
    shapes: result.catalog.shapes.length,
  });
}

/** Rollback/activation: points content:active at an EXISTING, re-validated release. No re-upload, no version comparison - the pointer is the single source of truth. */
async function handleCatalogActivate(request: Request, env: Env): Promise<Response> {
  if (!isContentAdminAuthorized(request, env)) return jsonNoStore({ error: "unauthorized" }, 401);

  let releaseId: unknown;
  try {
    releaseId = ((await request.json()) as Record<string, unknown>).releaseId;
  } catch {
    return jsonNoStore({ error: "invalid json" }, 400);
  }
  if (typeof releaseId !== "string" || !RELEASE_ID_PATTERN.test(releaseId)) return jsonNoStore({ error: "invalid releaseId" }, 400);

  const raw = await env.CONTENT_KV.get(contentReleaseKey(releaseId));
  if (raw === null) return jsonNoStore({ error: "release not found" }, 404);
  const result = parseReleaseJson(raw);
  if (!result.ok) return jsonNoStore({ error: `stored release failed validation: ${result.error}` }, 500);
  if ((await sha256Hex(result.release.catalogJson)) !== result.release.catalogHash) {
    return jsonNoStore({ error: "stored release failed hash verification" }, 500);
  }

  await env.CONTENT_KV.put(CONTENT_ACTIVE_KEY, JSON.stringify({ releaseId }));
  return jsonNoStore({ ok: true, releaseId, contentVersion: result.release.contentVersion, catalogHash: result.release.catalogHash });
}

/** Admin listing of published releases, newest first - the rollback menu. */
async function handleReleasesList(request: Request, env: Env): Promise<Response> {
  if (!isContentAdminAuthorized(request, env)) return jsonNoStore({ error: "unauthorized" }, 401);
  const [indexRaw, pointerRaw] = await Promise.all([
    env.CONTENT_KV.get(CONTENT_RELEASES_INDEX_KEY),
    env.CONTENT_KV.get(CONTENT_ACTIVE_KEY),
  ]);
  let activeReleaseId: string | null = null;
  try {
    activeReleaseId = pointerRaw ? ((JSON.parse(pointerRaw) as Record<string, unknown>).releaseId as string) : null;
  } catch {
    activeReleaseId = null;
  }
  return jsonNoStore({ activeReleaseId, releases: indexRaw ? JSON.parse(indexRaw) : [] });
}

/** Deactivation switch: removes only the ACTIVE POINTER (all releases stay for rollback). Clients see 404, clear their cache, and fall back to baked-in content. */
async function handleCatalogDelete(request: Request, env: Env): Promise<Response> {
  if (!isContentAdminAuthorized(request, env)) return jsonNoStore({ error: "unauthorized" }, 401);
  await env.CONTENT_KV.delete(CONTENT_ACTIVE_KEY);
  return jsonNoStore({ ok: true });
}

// ---------- Ads remote kill switch ----------
// Deliberately tiny and separate from the content-catalog concept above - it's one
// boolean, not a release. Reuses CONTENT_KV and CONTENT_ADMIN_TOKEN as an operational
// convenience (same "small trusted config" boundary as catalog publishing), rather
// than provisioning a dedicated KV namespace/secret for a single flag. GET is public
// so the client's fail-closed fetch (src/services/ads/remoteKillSwitch.ts) always has
// something to read; PUT is owner-only, same auth as catalog publishing.

async function handleAdsConfigGet(env: Env): Promise<Response> {
  const raw = await env.CONTENT_KV.get(ADS_CONFIG_KV_KEY);
  if (raw === null) return json({ error: "no ads config published" }, 404);
  const config = parseRemoteAdsConfig(raw);
  if (!config) return json({ error: "stored ads config failed validation" }, 500);
  return new Response(JSON.stringify(config), {
    headers: {
      "content-type": "application/json",
      // Short: this is a kill switch - a change must reach clients within a
      // minute or two, not the 5-minute cache the content catalog uses.
      "cache-control": "public, max-age=60",
    },
  });
}

async function handleAdsConfigPut(request: Request, env: Env): Promise<Response> {
  if (!isContentAdminAuthorized(request, env)) return jsonNoStore({ error: "unauthorized" }, 401);
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return jsonNoStore({ error: "invalid json" }, 400);
  }
  if (!isValidRemoteAdsConfig(parsed)) return jsonNoStore({ error: "body must be exactly { enabled: boolean }" }, 400);
  await env.CONTENT_KV.put(ADS_CONFIG_KV_KEY, JSON.stringify(parsed));
  return jsonNoStore({ ok: true, enabled: parsed.enabled });
}

// ---------- Interstitial experiment config ----------
// Its OWN route and KV key, never a new field on /api/config/ads: released clients
// validate that object strictly and would fail closed - turning rewarded ads off -
// the moment its shape changed. Same auth and namespace as the ads switch.
//
// The response is decided per request: `countryEligible` comes from the network
// country Cloudflare observed for THIS request (request.cf.country), and the stored
// blockedCountries list never leaves the server. That is also why the response is
// `private` - a shared cache keyed only on the URL would hand one country's answer
// to another.

export async function handleInterstitialConfigGet(request: Request, env: Env): Promise<Response> {
  const raw = await env.CONTENT_KV.get(INTERSTITIAL_CONFIG_KV_KEY);
  if (raw === null) return json({ error: "no interstitial config published" }, 404);
  const config = parseInterstitialStoredConfig(raw);
  if (!config) return json({ error: "stored interstitial config failed validation" }, 500);
  const country = (request as { cf?: { country?: unknown } }).cf?.country;
  return new Response(JSON.stringify(toClientConfig(config, country)), {
    headers: {
      "content-type": "application/json",
      // Short for the same reason as the ads switch: `enabled` is an emergency lever.
      "cache-control": "private, max-age=60",
    },
  });
}

export async function handleInterstitialConfigPut(request: Request, env: Env): Promise<Response> {
  if (!isContentAdminAuthorized(request, env)) return jsonNoStore({ error: "unauthorized" }, 401);
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return jsonNoStore({ error: "invalid json" }, 400);
  }
  if (!isValidInterstitialStoredConfig(parsed)) {
    return jsonNoStore(
      {
        error:
          "body must be exactly { enabled: boolean, rolloutPercent: 0-50, gamesBetweenAds: 5|7|10|12|15|20, " +
          "maxOpportunitiesPerSession: 1|2|3, blockedCountries: string[] }",
      },
      400,
    );
  }
  await env.CONTENT_KV.put(INTERSTITIAL_CONFIG_KV_KEY, JSON.stringify(parsed));
  return jsonNoStore({ ok: true, config: parsed });
}

// ---------- Analytics ingest circuit breaker ----------
// The emergency lever described in analyticsBreaker.ts. Admin-only on BOTH verbs,
// unlike the ads switch: no client reads this, so there is no reason to publish
// whether telemetry is currently being shed.

async function handleAnalyticsBreakerGet(request: Request, env: Env): Promise<Response> {
  if (analyticsGuardConfigCaller(request, env) === null) return jsonNoStore({ error: "unauthorized" }, 401);
  const raw = await env.CONTENT_KV.get(ANALYTICS_BREAKER_KV_KEY);
  // Reports the EFFECTIVE value, not the stored text: an unparseable value means
  // ingest is running, and that is what the operator needs to see. `shed` is reported
  // the same way, so a policy that failed validation shows as SHED_OFF here rather
  // than looking active because it is present in `stored`.
  const control = parseAnalyticsControl(raw);
  return jsonNoStore({ disabled: control.disabled, shed: control.shed, sheddingActive: !control.shed.monitorOnly, stored: raw });
}

async function handleAnalyticsBreakerPut(request: Request, env: Env): Promise<Response> {
  const caller = analyticsGuardConfigCaller(request, env);
  if (caller === null) return jsonNoStore({ error: "unauthorized" }, 401);
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return jsonNoStore({ error: "invalid json" }, 400);
  }
  if (!isValidAnalyticsBreakerConfig(parsed)) {
    // A malformed config must never replace a working one - the previous state stands.
    // Where the shed block is the thing that failed, say WHICH rule it broke: "invalid"
    // is not a useful answer to someone activating a protection during an incident.
    const shed = (parsed as { shed?: unknown } | null)?.shed;
    const specific = typeof shed === "object" && shed !== null ? shedEnforcementError(shed as never) : null;
    return jsonNoStore({ error: specific ?? "body must be { disabled: boolean } with an optional valid shed policy" }, 400);
  }
  // The Ops Panel may re-shape shedding but never flip the all-or-nothing breaker: it
  // must carry `disabled` through exactly as currently in force. Enforced here, not
  // just in the panel, so a leaked panel credential still cannot silence telemetry.
  if (caller === "ops-panel") {
    const current = parseAnalyticsControl(await env.CONTENT_KV.get(ANALYTICS_BREAKER_KV_KEY));
    if (parsed.disabled !== current.disabled) {
      return jsonNoStore({ error: "the ops panel credential cannot change the analytics breaker (disabled)" }, 403);
    }
  }
  await env.CONTENT_KV.put(ANALYTICS_BREAKER_KV_KEY, JSON.stringify(parsed));
  const shed = parsed.shed;
  return jsonNoStore({
    ok: true,
    disabled: parsed.disabled,
    monitorOnly: shed?.monitorOnly ?? true,
    sheddingActive: shed !== undefined && shed.monitorOnly === false,
  });
}

// ---------- Multiplayer cost guard ----------
// Admin-only on every verb, under GUARD_ADMIN_TOKEN - plus, for the config GET/PUT
// pair only, the Ops Panel's own OPS_GUARD_ADMIN_TOKEN (see Env). Unlike the ads switch there
// is no public GET: a public endpoint naming the countries under policy would tell
// circumventers exactly what to avoid, and tells an honest user nothing useful.
//
// THIS is the supported way to operate the guard. PUT validates before it stores, so a
// config that could not pass isValidGuardConfig - a live ELEVATED policy, an EMERGENCY
// with no expiresAt - cannot reach KV through here. Writing config:multiplayer-guard
// with `wrangler kv key put --remote` bypasses that validation entirely and remains
// only as the break-glass path for when the Worker itself cannot serve the route.

async function handleGuardConfigGet(request: Request, env: Env): Promise<Response> {
  if (guardConfigCaller(request, env) === null) return jsonNoStore({ error: "unauthorized" }, 401);
  const raw = await env.CONTENT_KV.get(MULTIPLAYER_GUARD_KV_KEY);
  const parsed = parseGuardConfig(raw);
  // Reports the EFFECTIVE config, and says plainly when the stored value failed
  // validation - an operator needs to know their policy is not being applied.
  return jsonNoStore({ config: parsed ?? GUARD_FAIL_OPEN, storedValid: parsed !== null, stored: raw === null ? null : "present" });
}

async function handleGuardConfigPut(request: Request, env: Env): Promise<Response> {
  if (guardConfigCaller(request, env) === null) return jsonNoStore({ error: "unauthorized" }, 401);
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return jsonNoStore({ error: "invalid json" }, 400);
  }
  if (!isValidGuardConfig(parsed)) {
    // A malformed config must never replace a valid one - the previous policy stands.
    // When the shape is fine but an enforcement rule was broken, say which one: an
    // operator reaching for this at 2am should not have to guess.
    const shapeOk = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
    const detail = shapeOk ? enforcementConfigError(parsed as MultiplayerGuardConfig) : null;
    return jsonNoStore({ error: detail ?? "invalid multiplayer guard config" }, 400);
  }

  const previous = parseGuardConfig(await env.CONTENT_KV.get(MULTIPLAYER_GUARD_KV_KEY));
  const now = new Date().toISOString();
  const transition: GuardTransition = {
    at: now,
    scope: parsed.override?.scope ?? "GLOBAL",
    from: previous?.globalMode ?? "NORMAL",
    to: parsed.override?.mode ?? parsed.globalMode,
    monitorOnly: parsed.monitorOnly,
    reason: parsed.reason,
    expiresAt: parsed.expiresAt ?? parsed.override?.expiresAt,
  };
  // History is appended ONLY here, on an explicit operator change. Nothing in the
  // request path ever writes - in particular, a request noticing that expiresAt has
  // passed does not produce a write.
  const history = [transition, ...(previous?.history ?? [])].slice(0, MAX_HISTORY_ENTRIES);
  const next: MultiplayerGuardConfig = { ...parsed, activatedAt: now, history };

  await env.CONTENT_KV.put(MULTIPLAYER_GUARD_KV_KEY, JSON.stringify(next));
  return jsonNoStore({ ok: true, activatedAt: now, monitorOnly: next.monitorOnly, globalMode: next.globalMode });
}

async function handleGuardStatus(request: Request, env: Env): Promise<Response> {
  if (!isGuardAdminAuthorized(request, env)) return jsonNoStore({ error: "unauthorized" }, 401);
  const config = parseGuardConfig(await env.CONTENT_KV.get(MULTIPLAYER_GUARD_KV_KEY)) ?? GUARD_FAIL_OPEN;
  const now = Date.now();
  const countries: Record<string, unknown> = {};
  for (const [code, policy] of Object.entries(config.countries)) {
    const eff = effectiveMode(config, code, now);
    countries[code] = { configured: policy, effectiveMode: eff.mode, source: eff.source, createAllowPercent: eff.createAllowPercent };
  }
  const overrideExpired = config.override ? Date.parse(config.override.expiresAt) <= now : null;
  const configExpired = config.expiresAt !== undefined ? Date.parse(config.expiresAt) <= now : false;
  const enforcementActive = isEnforcementActive(config, now);
  const blocked = enforcementActive
    ? Object.entries(config.countries).filter(([, p]) => p.mode === "EMERGENCY").map(([code]) => code)
    : [];
  return jsonNoStore({
    // The headline question - "is CYDI refusing any new room creation right now?"
    enforcementActive,
    blockedCountries: blocked,
    monitorOnly: config.monitorOnly,
    enforcing: enforcementActive,
    globalMode: config.globalMode,
    effectiveGlobalMode: configExpired ? "NORMAL" : config.globalMode,
    countries,
    override: config.override ?? null,
    overrideExpired,
    expiresAt: config.expiresAt ?? null,
    expired: configExpired,
    reason: config.reason ?? null,
    activatedAt: config.activatedAt ?? null,
    history: config.history ?? [],
    configAgeMs: guardConfigAgeMs(now),
    // Expiry is lazy by design: there is no scheduler in Phase 1, so an expired
    // policy simply stops resolving to anything restrictive. No event fires at
    // 00:00 UTC and no history entry is written for it.
    expirySemantics: "lazy-timestamp-comparison; no scheduler in phase 1",
  });
}

/**
 * Ingest, unless the breaker or the shed policy says otherwise. Both checks happen
 * HERE rather than inside the Durable Object on purpose: the whole point is to not
 * reach the DO at all, since a DO request is itself the scarce resource. 204 (not
 * 200) so the client's fire-and-forget POST succeeds and no retry is provoked - a
 * shed event is deliberately lost, not deferred.
 *
 * Both levers come from ONE cached KV read (analyticsBreaker.ts), so adding graded
 * shedding added no read to this path. The breaker wins outright; only if it is off
 * is a country policy consulted.
 *
 * THE NORMAL PATH IS UNTOUCHED. Under NORMAL - the production state - this function
 * does exactly what it did before: it never reads the body, so the request streams
 * to the DO byte for byte. The body is only materialized once a policy actually
 * applies to this request's country, which is the difference between a feature that
 * ships inert and one that merely claims to.
 */
export async function handleAnalyticsEvent(request: Request, env: Env, path: "/event" | "/events" = "/event"): Promise<Response> {
  const control = await readAnalyticsControl(env.CONTENT_KV);
  if (control.disabled) return new Response(null, { status: 204 });

  const country = (request as { cf?: { country?: unknown } }).cf?.country;
  const policy = effectiveShedPolicy(control.shed, country);
  if (policy.mode === "NORMAL") return forwardToAnalyticsDO(request, env, path);

  let bodyText: string;
  try {
    bodyText = await request.text();
  } catch {
    // Body unreadable - there is nothing left to forward, and inventing an empty one
    // would corrupt the count. Accept and drop, exactly as a failed send already does.
    return new Response(null, { status: 204 });
  }
  const decision = decideShedding(policy, path, bodyText, control.shed);
  const enforced = !policy.monitorOnly && decision.action !== "forward";
  console.log(shedLogLine(policy, decision, enforced));

  // Monitor-only: the decision above is the measurement, and the ORIGINAL body goes
  // to the DO regardless. Nothing is dropped, nothing is filtered, no counter moves.
  // The keep rate reported to the DO is therefore FULL, not policy.keepPercent - a
  // monitor-only day must never be recorded as a sampled one, or a reader would
  // scale up counters that were already complete.
  if (policy.monitorOnly) return forwardToAnalyticsDO(request, env, path, bodyText, FULL_KEEP_PERCENT);
  if (decision.action === "drop") return new Response(null, { status: 204 });
  // Enforced: whatever reached the DO is a policy.keepPercent sample of what was sent,
  // and this is the only place that fact is ever recorded.
  return forwardToAnalyticsDO(request, env, path, decision.body ?? bodyText, policy.keepPercent);
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
function forwardToAnalyticsDO(
  request: Request,
  env: Env,
  path: string,
  body?: string,
  keepPercent: number = FULL_KEEP_PERCENT,
): Promise<Response> {
  const id = env.ANALYTICS_DO.idFromName("analytics");
  const stub = env.ANALYTICS_DO.get(id);
  const url = new URL(request.url);
  const target = new URL(path + url.search, "https://analytics.internal");
  // Coarse country, resolved HERE and nowhere else: `request.cf` exists only on the
  // inbound edge request and is not carried into a Durable Object, so the normalized
  // two-letter code rides in on an internal header instead. The client never sends it
  // and cannot spoof it - the header is overwritten on every request, and the DO
  // re-normalizes whatever arrives. Only the country code crosses; no IP, city,
  // region, coordinates or ASN is read, forwarded or stored anywhere.
  const headers = new Headers(request.headers);
  headers.set(COUNTRY_HEADER, normalizeCountry((request as { cf?: { country?: unknown } }).cf?.country));
  // Set unconditionally, exactly like the country header, so a client-supplied value
  // can never survive: an absent-and-therefore-100 default is only ever reached when
  // the DO is called from somewhere that is not this function.
  headers.set(SHED_KEEP_HEADER, String(keepPercent));
  // `body` is supplied only when the caller has already consumed the stream (see the
  // shed path above); everything else streams through untouched as it always has.
  if (body !== undefined) headers.delete("content-length");
  return stub.fetch(target.toString(), {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : (body ?? request.body),
  });
}

// Play Together. Unlike the two forwarders above, this one is keyed by ROOM
// CODE rather than a fixed global name, so every room gets its own Durable
// Object - the whole point of the design. The request is passed through
// untouched (headers included), which is what lets the DO answer a WebSocket
// upgrade with a 101 + webSocket.
function forwardToRoomDO(request: Request, env: Env, roomCode: string, path: string): Promise<Response> {
  const id = env.ROOM_DO.idFromName(roomCode);
  const stub = env.ROOM_DO.get(id);
  const target = new URL(`${path}?code=${encodeURIComponent(roomCode)}`, "https://room.internal");
  return stub.fetch(target.toString(), request);
}

function randomRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(MP_LIMITS.ROOM_CODE_LENGTH));
  let code = "";
  for (const byte of bytes) code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
  return code;
}

/**
 * Allocates a fresh room. The DO answers 409 when the code is already a live
 * room, so a collision retries with a new code rather than dropping a new host
 * into someone else's game. 6 characters over a 32-symbol alphabet is ~30 bits;
 * collisions are rare enough that five attempts is generous.
 */
async function handleRoomCreate(request: Request, env: Env): Promise<Response> {
  // Cost guard, evaluated HERE - before the loop below, which is the first thing in
  // the whole request that can touch a Durable Object. Note the loop can cost up to
  // FIVE DO requests on code collision, so this is not a one-request decision point.
  //
  // PHASE 1 IS MONITOR-ONLY. The evaluation is recorded and then deliberately not
  // acted on: `allowed` is always true, and nothing below branches on `decision`.
  // Enforcement is a separate, explicit change.
  let refuse = false;
  try {
    const guard = await readGuardConfig(env.CONTENT_KV);
    const evaluation = evaluateRoomCreation(guard, (request as { cf?: { country?: unknown } }).cf?.country);
    // One structured line per creation - a few thousand a day at current volume. Not
    // an analytics event, not a KV write, not a DO write; the monitor must not become
    // the quota problem it exists to watch.
    console.log(guardLogLine(evaluation));
    refuse = !evaluation.allowed;
  } catch {
    // Any failure in the guard leaves `refuse` false. Guard infrastructure breaking
    // must never be able to stop a room being created.
  }
  if (refuse) {
    // Returned BEFORE the loop below, so the whole 1-5 RoomDO-request cost of
    // allocating a room is saved rather than merely wasted.
    return json(guardRejectionBody(), GUARD_REJECTION_STATUS);
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const roomCode = randomRoomCode();
    const created = await forwardToRoomDO(
      new Request("https://room.internal/create", { method: "POST" }),
      env,
      roomCode,
      "/create",
    );
    if (created.ok) return json({ roomCode }, 201);
    if (created.status !== 409) return created;
  }
  return json({ error: "could not allocate a room code" }, 503);
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
    if (url.pathname === "/api/content/activate" && request.method === "POST") return handleCatalogActivate(request, env);
    if (url.pathname === "/api/content/releases" && request.method === "GET") return handleReleasesList(request, env);

    if (url.pathname === "/api/config/ads") {
      if (request.method === "GET") return handleAdsConfigGet(env);
      if (request.method === "PUT") return handleAdsConfigPut(request, env);
    }
    if (url.pathname === "/api/config/ads/interstitial") {
      if (request.method === "GET") return handleInterstitialConfigGet(request, env);
      if (request.method === "PUT") return handleInterstitialConfigPut(request, env);
    }

    if (url.pathname === "/api/daily/current" && request.method === "GET") return forwardToDailyDO(request, env, "/current");
    if (url.pathname === "/api/daily/submit" && request.method === "POST") return forwardToDailyDO(request, env, "/submit");
    if (url.pathname === "/api/daily/claim-prizes" && request.method === "POST") return forwardToDailyDO(request, env, "/claim-prizes");
    if (url.pathname === "/api/daily/history" && request.method === "GET") return forwardToDailyDO(request, env, "/history");

    const episodeMatch = url.pathname.match(/^\/api\/daily\/episode\/(\d+)$/);
    if (episodeMatch && request.method === "GET") return forwardToDailyDO(request, env, `/episode/${episodeMatch[1]}`);

    // Play Together rooms. `/create` is NOT reachable from outside - a room is
    // only ever allocated through POST /api/room, which owns code generation
    // and collision retry.
    // The minimum-version gate runs FIRST on all three room routes - before the cost
    // guard and before any RoomDO is addressed - so a refused client costs a Worker
    // request and nothing more. OFF unless KV says otherwise (multiplayerVersionGate.ts).
    if (url.pathname === "/api/room" && request.method === "POST") {
      return (await versionGateResponse(request, env.CONTENT_KV, "http")) ?? handleRoomCreate(request, env);
    }

    const roomMatch = url.pathname.match(/^\/api\/room\/([A-Z0-9]{6})\/(ws|info)$/);
    if (roomMatch && isRoomCode(roomMatch[1])) {
      const gated = await versionGateResponse(request, env.CONTENT_KV, roomMatch[2] === "ws" ? "ws" : "http");
      return gated ?? forwardToRoomDO(request, env, roomMatch[1], `/${roomMatch[2]}`);
    }

    if (url.pathname === "/api/config/multiplayer-guard") {
      if (request.method === "GET") return handleGuardConfigGet(request, env);
      if (request.method === "PUT") return handleGuardConfigPut(request, env);
    }
    if (url.pathname === "/api/config/multiplayer-guard/status" && request.method === "GET") {
      return handleGuardStatus(request, env);
    }

    if (url.pathname === "/api/config/analytics-breaker") {
      if (request.method === "GET") return handleAnalyticsBreakerGet(request, env);
      if (request.method === "PUT") return handleAnalyticsBreakerPut(request, env);
    }

    // Kept forever: every already-installed APK posts one event per request here, and
    // there are months of them in the field. The batch route below is additive.
    if (url.pathname === "/api/analytics/event" && request.method === "POST") return handleAnalyticsEvent(request, env, "/event");
    if (url.pathname === "/api/analytics/events" && request.method === "POST") return handleAnalyticsEvent(request, env, "/events");
    if (url.pathname === "/api/analytics/report" && request.method === "GET") return forwardToAnalyticsDO(request, env, "/report");

    // Short campaign aliases (/s/cat). The tags come from the server-side map, never
    // from the slug, and an unknown slug lands on a clean homepage rather than
    // inventing a campaign - see worker/campaignLinks.ts.
    if (url.pathname.startsWith(CAMPAIGN_PATH_PREFIX) && (request.method === "GET" || request.method === "HEAD")) {
      return Response.redirect(campaignRedirectUrl(url.origin, campaignLinkForPath(url.pathname)), 302);
    }

    // The branded install link. /android is a permanent redirect to the Play listing,
    // so anywhere the URL is shown it reads playcydi.com rather than a bare store URL.
    // 301 rather than the aliases' 302 because the destination is the app's own
    // listing and is not going to move - see androidRedirectUrl for what (little) of
    // the request travels with it.
    if ((url.pathname === ANDROID_PATH || url.pathname === `${ANDROID_PATH}/`) && (request.method === "GET" || request.method === "HEAD")) {
      return Response.redirect(androidRedirectUrl(url.search), 301);
    }

    if (url.pathname === "/robots.txt" && request.method === "GET") return textResponse(robotsTxt(), ROBOTS_CONTENT_TYPE);
    if (url.pathname === "/sitemap.xml" && request.method === "GET")
      return textResponse(sitemapXml(CONTENT_PATHS), SITEMAP_CONTENT_TYPE);

    // Content pages (/how-to-play, /about, /contact, /terms, /privacy) are whole
    // documents rather than the app shell, so they are answered here and never
    // reach the assets binding's SPA fallback. /privacy in particular used to
    // fall through to that fallback and serve an empty shell, which meant the
    // published policy was invisible to anything that does not run JavaScript.
    if (request.method === "GET") {
      const contentPage = contentPageForPath(url.pathname);
      if (contentPage) {
        return new Response(renderContentDocument(contentPage), {
          headers: {
            "content-type": CONTENT_PAGE_CONTENT_TYPE,
            // Short, because the pages are generated: the scoring example and the
            // shape counts are computed from the live code at render time.
            "cache-control": CONTENT_PAGE_CACHE_CONTROL,
          },
        });
      }
    }

    const shareLinkMatch = url.pathname.match(/^\/c\/([A-Za-z0-9]{4,12})$/);
    if (shareLinkMatch && request.method === "GET") {
      // Share pages are per-player, thin, and near-duplicates of the SPA shell -
      // kept out of the index so they can never compete with the real pages.
      const rewritten = await handleShareLinkPage(shareLinkMatch[1], request, env);
      return withHeader(rewritten ?? (await env.ASSETS.fetch(request)), "x-robots-tag", "noindex");
    }

    if (request.method === "GET") {
      const seoPage = seoPageForPath(url.pathname);
      if (seoPage) return handleSeoPage(seoPage, request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
