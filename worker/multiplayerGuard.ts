// Multiplayer admission cost guard - Phase 1: evaluation and measurement only.
//
// Why this exists: on 23 Sep 2026 CYDI exhausted two account-wide Cloudflare Free
// Durable Object caps and production went to edge 429. Analytics could already be
// shed on demand (analyticsBreaker.ts), but multiplayer had NO way to refuse work -
// every optimisation made a room cheaper, none could make fewer rooms. RoomDO was
// 57.2k of the 111.13k DO requests that day.
//
// PHASE 1 DECIDES BUT NEVER DENIES. Every code path here returns a decision that the
// caller records and then ignores; room creation proceeds exactly as it always has.
// The point is to measure what a policy WOULD do against real traffic before anyone
// is affected by one.
//
// Three properties this must never violate:
//
//   1. It costs ZERO Durable Object requests. A guard that spends the quota it
//      protects is worse than no guard. There is no DO binding in this file.
//   2. It costs zero KV reads on the hot path. The config is read once per isolate
//      per cache window, exactly like analyticsBreaker.ts.
//   3. It FAILS OPEN. Missing config, malformed config, a KV outage, an unknown
//      country - every one of them resolves to "unrestricted". Guard infrastructure
//      breaking must never be able to take multiplayer down.
//
// Deliberately generic: no country is hard-coded. Iran appears only in tests and in
// the operator's config, because it is the country the 23 Sep data happens to point
// at. Zero, one or many countries can be configured, added or removed without a
// deployment.

import { normalizeCountry, UNKNOWN_COUNTRY } from "./analyticsDO";

export const MULTIPLAYER_GUARD_KV_KEY = "config:multiplayer-guard";

/** Escalating protection levels. Only the operator (or, later, an external monitor) moves between them. */
export const GUARD_MODES = ["NORMAL", "ELEVATED", "EMERGENCY"] as const;
export type GuardMode = (typeof GUARD_MODES)[number];

/** What the guard would do, were it enforcing. Phase 1 records these and allows regardless. */
export const GUARD_DECISIONS = ["would_allow", "would_throttle", "would_reject"] as const;
export type GuardDecision = (typeof GUARD_DECISIONS)[number];

export type CountryPolicy = {
  mode: GuardMode;
  /** ELEVATED only: percentage of new room creations that would be admitted. 0-100. */
  createAllowPercent?: number;
};

export type GuardOverride = {
  /** An ISO country code, or "GLOBAL" to override everything at once. */
  scope: string;
  mode: GuardMode;
  /** ISO timestamp. An override with no future expiry is not accepted - see validate(). */
  expiresAt: string;
  reason?: string;
};

export type MultiplayerGuardConfig = {
  /** Phase 1 ships true and must stay true until enforcement is explicitly approved. */
  monitorOnly: boolean;
  globalMode: GuardMode;
  /** Keyed by normalized ISO country code. Absent country = unrestricted. */
  countries: Record<string, CountryPolicy>;
  override?: GuardOverride;
  /** ISO timestamp after which the WHOLE protective state lapses back to NORMAL. */
  expiresAt?: string;
  /** Operator note, surfaced by the status endpoint. */
  reason?: string;
  /** Set by the PUT handler, not by the operator. */
  activatedAt?: string;
  /** Most recent state changes, newest first. Written only on PUT, never per request. */
  history?: GuardTransition[];
};

export type GuardTransition = {
  at: string;
  scope: string;
  from: GuardMode;
  to: GuardMode;
  monitorOnly: boolean;
  reason?: string;
  expiresAt?: string;
};

/** The state the guard resolves to when anything at all is wrong. Unrestricted, always. */
export const GUARD_FAIL_OPEN: MultiplayerGuardConfig = {
  monitorOnly: true,
  globalMode: "NORMAL",
  countries: {},
};

export const MAX_HISTORY_ENTRIES = 20;
/** Same window as the analytics breaker: long enough that the hot path never reads KV, short enough that an operator change lands within a minute. */
const CACHE_MS = 30_000;
const KV_CACHE_TTL_SECONDS = 60;
/** A config carrying more than this many countries is a mistake or an attack, not a policy. */
const MAX_COUNTRIES = 64;

function isGuardMode(value: unknown): value is GuardMode {
  return typeof value === "string" && (GUARD_MODES as readonly string[]).includes(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length >= 20 && Number.isFinite(Date.parse(value));
}

function isPercent(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}

function isCountryPolicy(value: unknown): value is CountryPolicy {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  for (const key of Object.keys(p)) if (key !== "mode" && key !== "createAllowPercent") return false;
  if (!isGuardMode(p.mode)) return false;
  if (p.createAllowPercent !== undefined && !isPercent(p.createAllowPercent)) return false;
  return true;
}

function isOverride(value: unknown): value is GuardOverride {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const o = value as Record<string, unknown>;
  for (const key of Object.keys(o)) if (!["scope", "mode", "expiresAt", "reason"].includes(key)) return false;
  // An override is a deliberately temporary thing. One without an expiry is a
  // permanent policy wearing a temporary label, so it is simply not valid here.
  if (!isGuardMode(o.mode) || !isIsoTimestamp(o.expiresAt)) return false;
  if (typeof o.scope !== "string") return false;
  const scope = o.scope.toUpperCase();
  if (scope !== "GLOBAL" && normalizeCountry(scope) === UNKNOWN_COUNTRY) return false;
  if (o.reason !== undefined && typeof o.reason !== "string") return false;
  return true;
}

/**
 * Strict, all-or-nothing validation, matching isValidRemoteAdsConfig's posture: a
 * config that is not exactly right is not partially applied, it is not applied.
 *
 * Callers differ in what they do with a rejection. The PUT handler answers 400 and
 * leaves the stored config alone. The read path falls back to GUARD_FAIL_OPEN, so a
 * corrupted value can never restrict anybody.
 */
export function isValidGuardConfig(value: unknown): value is MultiplayerGuardConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  const allowed = ["monitorOnly", "globalMode", "countries", "override", "expiresAt", "reason", "activatedAt", "history"];
  for (const key of Object.keys(c)) if (!allowed.includes(key)) return false;

  if (typeof c.monitorOnly !== "boolean") return false;
  if (!isGuardMode(c.globalMode)) return false;
  if (typeof c.countries !== "object" || c.countries === null || Array.isArray(c.countries)) return false;

  const countries = c.countries as Record<string, unknown>;
  const codes = Object.keys(countries);
  if (codes.length > MAX_COUNTRIES) return false;
  for (const code of codes) {
    // Keys must already be normalized, so a policy can never be filed under a code
    // the request path would never produce and then silently never apply.
    if (code !== normalizeCountry(code) || code === UNKNOWN_COUNTRY) return false;
    if (!isCountryPolicy(countries[code])) return false;
  }

  if (c.override !== undefined && !isOverride(c.override)) return false;
  if (c.expiresAt !== undefined && !isIsoTimestamp(c.expiresAt)) return false;
  if (c.reason !== undefined && typeof c.reason !== "string") return false;
  if (c.activatedAt !== undefined && !isIsoTimestamp(c.activatedAt)) return false;
  if (c.history !== undefined && !Array.isArray(c.history)) return false;
  return true;
}

/** Parses a stored KV value. Any failure yields null, and the caller falls open. Never throws. */
export function parseGuardConfig(raw: string | null): MultiplayerGuardConfig | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isValidGuardConfig(parsed) ? parsed : null;
}

// --- isolate cache -------------------------------------------------------------
//
// A KV read per room creation would trade the DO quota for the KV quota - the Free
// plan allows 100,000 KV reads/day, and the breaker already learned this lesson. The
// config is therefore read at most once per isolate per CACHE_MS, with cacheTtl
// asking Cloudflare's edge for the same thing a layer lower.

type GuardKv = { get(key: string, options?: { cacheTtl?: number }): Promise<string | null> };

let cache: { config: MultiplayerGuardConfig; expiresAt: number; fetchedAt: number } | null = null;

/**
 * The current config, or the fail-open default.
 *
 * Only a SUCCESSFUL read is cached. A KV outage therefore retries on the next
 * request rather than freezing an answer for the whole window - and because the
 * fallback is unrestricted, an outage can only ever make the guard less restrictive.
 */
export async function readGuardConfig(kv: GuardKv | undefined, now: number = Date.now()): Promise<MultiplayerGuardConfig> {
  if (cache !== null && now < cache.expiresAt) return cache.config;
  if (!kv) return GUARD_FAIL_OPEN;
  try {
    const raw = await kv.get(MULTIPLAYER_GUARD_KV_KEY, { cacheTtl: KV_CACHE_TTL_SECONDS });
    const config = parseGuardConfig(raw) ?? GUARD_FAIL_OPEN;
    cache = { config, expiresAt: now + CACHE_MS, fetchedAt: now };
    return config;
  } catch {
    return GUARD_FAIL_OPEN;
  }
}

/** How long ago the cached config was read, for the status endpoint. null when nothing is cached. */
export function guardConfigAgeMs(now: number = Date.now()): number | null {
  return cache === null ? null : now - cache.fetchedAt;
}

// --- effective mode ------------------------------------------------------------

export type EffectiveMode = {
  mode: GuardMode;
  /** Where the mode came from, so the status endpoint and logs can explain themselves. */
  source: "override" | "country" | "global" | "expired" | "default";
  createAllowPercent: number;
  expired: boolean;
};

/**
 * Resolve the mode that applies to one country, at one instant.
 *
 * Precedence: a live override beats a country policy, which beats the global mode.
 * Expiry is pure timestamp arithmetic - there is no scheduler in Phase 1, and none is
 * needed: an expired policy simply stops resolving to anything restrictive the moment
 * a request is evaluated after its expiresAt. Nothing is mutated, no cleanup runs, and
 * no write happens because a request noticed the time.
 *
 * The consequence to be honest about: because expiry is lazy, there is no event at
 * exactly 00:00 UTC. Nothing fires, nothing is logged, no history entry appears. The
 * policy just stops applying. A transition record at the boundary needs a scheduler,
 * which is Phase 2.
 */
export function effectiveMode(config: MultiplayerGuardConfig, country: string, now: number = Date.now()): EffectiveMode {
  const unrestricted = (source: EffectiveMode["source"], expired: boolean): EffectiveMode => ({
    mode: "NORMAL",
    source,
    createAllowPercent: 100,
    expired,
  });

  // A country we could not determine is never restricted - see the VPN note in the
  // guard's documentation. ZZ covers absent, XX, Tor and malformed alike.
  if (country === UNKNOWN_COUNTRY) return unrestricted("default", false);

  const wholeConfigExpired = config.expiresAt !== undefined && Date.parse(config.expiresAt) <= now;
  if (wholeConfigExpired) return unrestricted("expired", true);

  const override = config.override;
  if (override && Date.parse(override.expiresAt) > now) {
    const scope = override.scope.toUpperCase();
    if (scope === "GLOBAL" || scope === country) {
      return { mode: override.mode, source: "override", createAllowPercent: override.mode === "ELEVATED" ? 50 : 100, expired: false };
    }
  }

  const policy = config.countries[country];
  if (policy) {
    return {
      mode: policy.mode,
      source: "country",
      createAllowPercent: policy.createAllowPercent ?? (policy.mode === "ELEVATED" ? 50 : 100),
      expired: false,
    };
  }

  if (config.globalMode !== "NORMAL") {
    return { mode: config.globalMode, source: "global", createAllowPercent: 50, expired: false };
  }

  return unrestricted("global", false);
}

// --- admission decision --------------------------------------------------------

export type GuardEvaluation = {
  country: string;
  mode: GuardMode;
  source: EffectiveMode["source"];
  decision: GuardDecision;
  createAllowPercent: number;
  monitorOnly: boolean;
  expired: boolean;
  /** Phase 1: always true. The caller must honour this, not the decision. */
  allowed: boolean;
};

/**
 * Sampling for ELEVATED.
 *
 * Deliberately a fresh uniform draw per creation attempt rather than a hash of some
 * stable key, because there is nothing stable to hash: POST /api/room carries no body,
 * no installation id and no room code yet. The only stable inputs available would be
 * IP-derived, and CYDI's privacy policy is explicit that it does not use IP.
 *
 * A per-attempt draw gives an unbiased throttle RATE, which is exactly what Phase 1
 * needs to measure. It has a known weakness for enforcement, recorded here so Phase 2
 * does not rediscover it: createRoom() does not retry, but the PERSON does, and each
 * tap re-rolls. At createAllowPercent=50 a determined user is through in about two
 * taps, so the realised reduction in rooms would be well below the nominal 50%.
 * Enforcement therefore needs a bucket key that is stable per device - most cleanly
 * one the client sends deliberately, which is an Android change, not a Worker one.
 */
function sampleAllows(percent: number): boolean {
  if (percent >= 100) return true;
  if (percent <= 0) return false;
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] % 100) < percent;
}

/**
 * Evaluate one room-creation attempt.
 *
 * `allowed` is hard-coded true while monitorOnly is set, and the caller keys off
 * `allowed`, never off `decision`. That is the structural guarantee that Phase 1
 * cannot restrict anyone: turning the guard on is a separate, deliberate change to
 * this one line plus the config flag.
 */
export function evaluateRoomCreation(
  config: MultiplayerGuardConfig,
  rawCountry: unknown,
  now: number = Date.now(),
): GuardEvaluation {
  const country = normalizeCountry(rawCountry);
  const eff = effectiveMode(config, country, now);

  let decision: GuardDecision = "would_allow";
  if (eff.mode === "EMERGENCY") decision = "would_reject";
  else if (eff.mode === "ELEVATED" && !sampleAllows(eff.createAllowPercent)) decision = "would_throttle";

  return {
    country,
    mode: eff.mode,
    source: eff.source,
    decision,
    createAllowPercent: eff.createAllowPercent,
    monitorOnly: config.monitorOnly,
    expired: eff.expired,
    // PHASE 1: always allowed. Enforcement is a later, explicit decision.
    allowed: true,
  };
}

/**
 * Structured one-line record of a decision, for `wrangler tail` / Workers
 * Observability. Deliberately not an analytics event and not a KV or DO write: the
 * monitor must not become the quota problem it was built to watch.
 *
 * Carries no identifying field - country is the coarse network code the analytics
 * pipeline already records, and nothing else about the request is included.
 */
export function guardLogLine(evaluation: GuardEvaluation): string {
  return JSON.stringify({
    t: "mp_guard",
    country: evaluation.country,
    mode: evaluation.mode,
    src: evaluation.source,
    decision: evaluation.decision,
    pct: evaluation.createAllowPercent,
    monitorOnly: evaluation.monitorOnly,
  });
}

/**
 * Placeholder for Phase 2 transition alerting. Intentionally inert and intentionally
 * not wired to anything: no provider, no secret, no account. It exists so the call
 * site can be added to the PUT handler later without reshaping the request path.
 */
export function notifyGuardTransition(_transition: GuardTransition): void {
  // Phase 2: webhook or email, best effort, inside waitUntil, never awaited.
}

/** Test-only: drop the isolate cache between cases. */
export function _resetGuardCacheForTests(): void {
  cache = null;
}
