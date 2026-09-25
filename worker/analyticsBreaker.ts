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

import { isValidAnalyticsShedConfig, SHED_OFF, type AnalyticsShedConfig } from "./analyticsShedding";
import { EXACT_LEDGER_OFF, isValidExactLedgerConfig, type ExactLedgerConfig } from "./analyticsExactLedgerConfig";

export const ANALYTICS_BREAKER_KV_KEY = "config:analytics-breaker";

/**
 * One key, one cached read, two levers.
 *
 * `disabled` is the original all-or-nothing breaker. `shed` is the graded,
 * country-aware policy in analyticsShedding.ts, and it lives HERE rather than under a
 * key of its own for two reasons: a second key would be a second KV read on the same
 * hot path, and - more importantly - two independent analytics emergency controls
 * could disagree about which one is in force. One object cannot contradict itself.
 *
 * Precedence is one-way and absolute: `disabled` wins. When it is true, ingest stops
 * and the shed policy is never consulted. Shedding can narrow what reaches the DO; it
 * can never re-open what the breaker shut.
 */
export type AnalyticsBreakerConfig = { disabled: boolean; shed?: AnalyticsShedConfig; exactLedger?: ExactLedgerConfig };

/** Everything one cached read yields. */
export type AnalyticsControl = { disabled: boolean; shed: AnalyticsShedConfig; exactLedger: ExactLedgerConfig };

/** Collect everything, shed nothing, Phase 2 off - what a missing, malformed or unreadable config means. */
export const ANALYTICS_CONTROL_OPEN: AnalyticsControl = { disabled: false, shed: SHED_OFF, exactLedger: EXACT_LEDGER_OFF };

/** The keys a stored value may carry. `exactLedger` is the Phase 2 gate (analyticsExactLedger.ts). */
const BREAKER_KEYS = new Set(["disabled", "shed", "exactLedger"]);

/**
 * Strict: `disabled` must be a boolean, the only other permitted keys are `shed` and
 * `exactLedger`, and any block that is present must itself be valid. Used by the admin
 * PUT, so an operator who mistypes a policy is told, rather than silently storing
 * something the read path will ignore.
 */
export function isValidAnalyticsBreakerConfig(value: unknown): value is AnalyticsBreakerConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  if (typeof c.disabled !== "boolean") return false;
  for (const key of Object.keys(c)) if (!BREAKER_KEYS.has(key)) return false;
  if (c.shed !== undefined && !isValidAnalyticsShedConfig(c.shed)) return false;
  if (c.exactLedger !== undefined && !isValidExactLedgerConfig(c.exactLedger)) return false;
  return true;
}

/**
 * Parses a stored KV value into both levers, defensively and INDEPENDENTLY.
 *
 * Deliberately laxer than the validator above: a hand-edited KV value with a broken
 * `shed` block must still let the breaker work, because the breaker is the control
 * someone reaches for when the account is on fire. A bad shed block degrades to "shed
 * nothing"; it never takes the emergency stop down with it. Never throws.
 */
export function parseAnalyticsControl(raw: string | null): AnalyticsControl {
  if (raw === null) return ANALYTICS_CONTROL_OPEN;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return ANALYTICS_CONTROL_OPEN;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return ANALYTICS_CONTROL_OPEN;
  const c = parsed as Record<string, unknown>;
  // `disabled` keeps its original all-or-nothing strictness: a value carrying any key
  // beyond these two, or a non-boolean `disabled`, is not a recognisable instruction
  // to stop collecting, so it does not stop collecting. `shed` and `exactLedger` are the
  // only keys added to that set, and each is judged separately below - a broken Phase 2
  // block degrades to "Phase 2 off", never to "breaker off".
  const recognisable = typeof c.disabled === "boolean" && Object.keys(c).every((k) => BREAKER_KEYS.has(k));
  return {
    disabled: recognisable && c.disabled === true,
    shed: isValidAnalyticsShedConfig(c.shed) ? c.shed : SHED_OFF,
    exactLedger: isValidExactLedgerConfig(c.exactLedger) ? c.exactLedger : EXACT_LEDGER_OFF,
  };
}

/** Back-compat shim for callers and tests that only care about the original boolean. */
export function parseAnalyticsBreaker(raw: string | null): boolean {
  return parseAnalyticsControl(raw).disabled;
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

let cache: { control: AnalyticsControl; expiresAt: number } | null = null;

type BreakerKv = { get(key: string, options?: { cacheTtl?: number }): Promise<string | null> };

/**
 * True only when a well-formed { disabled: true } was actually read from KV.
 *
 * Only a SUCCESSFUL read is cached, so a KV outage expires the cache normally and
 * falls back to collecting rather than freezing whatever the last answer happened
 * to be forever.
 */
export async function readAnalyticsControl(kv: BreakerKv, now: number = Date.now()): Promise<AnalyticsControl> {
  if (cache !== null && now < cache.expiresAt) return cache.control;
  try {
    const raw = await kv.get(ANALYTICS_BREAKER_KV_KEY, { cacheTtl: BREAKER_KV_CACHE_TTL_SECONDS });
    const control = parseAnalyticsControl(raw);
    cache = { control, expiresAt: now + BREAKER_CACHE_MS };
    return control;
  } catch {
    // Binding missing, KV unavailable, read threw - collect everything, shed nothing,
    // and do not cache the failure, so the next event retries instead of inheriting
    // an outage.
    return ANALYTICS_CONTROL_OPEN;
  }
}

/** The original boolean question, answered from the same single cached read. */
export async function isAnalyticsIngestDisabled(kv: BreakerKv, now: number = Date.now()): Promise<boolean> {
  return (await readAnalyticsControl(kv, now)).disabled;
}

/** Test-only: drop the module-scoped cache between cases. */
export function _resetAnalyticsBreakerCacheForTests(): void {
  cache = null;
}
