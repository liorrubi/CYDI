// Emergency off-switch for analytics INGEST only (POST /api/analytics/event).
//
// Why this exists: Workers, Durable Objects and their row budgets are all
// ACCOUNT-wide on the Free plan, so on 23 Sep 2026 a traffic spike let analytics
// exhaust the shared Durable Object quota and take Daily Challenge and Play
// Together down with it - three unrelated features sharing one budget with no
// priority between them. Flipping this flag sheds the telemetry load instantly,
// with no deploy, so the GAME is never the thing that breaks when the numbers
// get expensive.
//
// FAIL-OPEN, the exact opposite of the ads kill switch (remoteAdsConfigSchema.ts).
// That one protects users from ads we did not mean to serve, so silence means
// "off". This one protects us from losing data we did mean to collect, so
// anything other than an explicit, well-formed { disabled: true } - a missing
// key, malformed JSON, an unexpected shape, a KV outage, a thrown binding -
// leaves ingest running exactly as it is today. Analytics must never go dark
// because a lookup failed.
//
// Reuses CONTENT_KV and CONTENT_ADMIN_TOKEN, the same "small trusted operational
// config" boundary as the ads switch and the content catalog. No new namespace,
// no new secret, no new dependency.

export const ANALYTICS_BREAKER_KV_KEY = "config:analytics-breaker";

export type AnalyticsBreakerConfig = { disabled: boolean };

/** Strict, all-or-nothing: exactly one key, `disabled`, and it must be a boolean. Anything else is not a valid instruction to stop collecting. */
export function isValidAnalyticsBreakerConfig(value: unknown): value is AnalyticsBreakerConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as Record<string, unknown>).disabled === "boolean"
  );
}

/** Parses a stored KV value. Returns false (= keep collecting) for null, malformed JSON, or any shape that isn't exactly { disabled: boolean }. Never throws. */
export function parseAnalyticsBreaker(raw: string | null): boolean {
  if (raw === null) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  return isValidAnalyticsBreakerConfig(parsed) ? parsed.disabled : false;
}

// A KV read per analytics event would trade one exhausted quota for another -
// the Free plan allows 100,000 KV reads/day and yesterday alone produced ~50,000
// events. The flag is therefore read at most once per isolate per window and
// cached in module scope; `cacheTtl` asks Cloudflare's own edge cache for the
// same thing a layer lower. 30 seconds is the worst-case delay between flipping
// the switch and ingest actually stopping, which is immaterial for a lever pulled
// by hand during an incident.
const BREAKER_CACHE_MS = 30_000;
const BREAKER_KV_CACHE_TTL_SECONDS = 60;

let cache: { disabled: boolean; expiresAt: number } | null = null;

type BreakerKv = { get(key: string, options?: { cacheTtl?: number }): Promise<string | null> };

/**
 * True only when a well-formed { disabled: true } was actually read from KV.
 *
 * Only a SUCCESSFUL read is cached, so a KV outage expires the cache normally and
 * falls back to collecting rather than freezing whatever the last answer happened
 * to be forever.
 */
export async function isAnalyticsIngestDisabled(kv: BreakerKv, now: number = Date.now()): Promise<boolean> {
  if (cache !== null && now < cache.expiresAt) return cache.disabled;
  try {
    const raw = await kv.get(ANALYTICS_BREAKER_KV_KEY, { cacheTtl: BREAKER_KV_CACHE_TTL_SECONDS });
    const disabled = parseAnalyticsBreaker(raw);
    cache = { disabled, expiresAt: now + BREAKER_CACHE_MS };
    return disabled;
  } catch {
    // Binding missing, KV unavailable, read threw - collect, and do not cache the
    // failure, so the next event retries instead of inheriting an outage.
    return false;
  }
}

/** Test-only: drop the module-scoped cache between cases. */
export function _resetAnalyticsBreakerCacheForTests(): void {
  cache = null;
}
