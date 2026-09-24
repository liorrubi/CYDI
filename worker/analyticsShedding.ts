/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Country-aware load shedding for analytics INGEST, decided in the Worker and
// therefore BEFORE the AnalyticsDO fetch.
//
// That placement is the whole feature. A Durable Object request is the scarce
// resource - not the event, not the row - so dropping a batch after the DO has
// already been invoked saves nothing at all. Everything here runs on the request
// path with the body still in the Worker's hands.
//
// SHIPS INERT. The default, and the production state, is NORMAL + monitorOnly: the
// body is never read, nothing is filtered, and the request reaches the DO byte for
// byte as it does today. A mode has to be configured in KV before a single line of
// the filtering code below executes.
//
// RELATIONSHIP TO THE P0 BREAKER (analyticsBreaker.ts). This is not a second,
// competing analytics kill switch. It shares the breaker's KV key, its cache and its
// single read - `shed` is a block inside `config:analytics-breaker`, not a config
// source of its own - so the two can never disagree about which is in force, and the
// guard costs zero additional KV reads. Precedence is fixed and one-way: the breaker
// is the bigger hammer, and when it is on, ingest stops before this code is reached.
// Shedding can narrow what gets through; it can never re-open what the breaker shut.
//
// WHY A SEPARATE ENGINE FROM THE MULTIPLAYER GUARD. They protect different Durable
// Objects with genuinely different mechanics - one refuses a request outright, the
// other rewrites a payload - so sharing enforcement code would mean a switch
// statement pretending two things are one. What they DO share is vocabulary: the
// same three modes, the same country normalization, the same monitorOnly, expiry and
// fail-open conventions, so an operator who has run one can run the other. The mode
// names are imported rather than re-declared precisely so they cannot drift apart.
// Neither system reads the other's config, and neither can trigger the other.

import { GUARD_MODES, type GuardMode } from "./multiplayerGuard";
import { normalizeCountry } from "./analyticsDO";

/**
 * Events that are NEVER shed, at any mode, in any country.
 *
 * The test is not "is this important" - nearly everything is - but "if this is
 * dropped, is the fact gone forever, or merely measured less precisely?" Gameplay
 * telemetry is a stream: sample it and the shape survives. These are not.
 *
 *  - Acquisition fires once per installation, ever. A dropped first_open is an
 *    install that no later event can reconstruct.
 *  - Money is money. A purchase or a served ad is a fact about revenue, not a
 *    sample of one.
 *  - mp_room_created / mp_game_started are what the multiplayer guard's country
 *    policy is decided from. Shedding them would blind the other guard during an
 *    incident, which is precisely when it is being read.
 *
 * Deliberately ABSENT: rewarded_ad_unavailable. It is the single largest ad event
 * (~9% of all events, because ads fail often in the countries this exists for) and
 * its value is statistical - a sample answers "are ads failing here" as well as a
 * census does. Preserving it would roughly triple the share of batches that cannot
 * be dropped. If that judgement is ever wrong, `preserveExtra` reverses it with no
 * deploy.
 *
 * An event not listed here is sheddable, so an event added to the schema later
 * defaults to sheddable rather than silently eroding the saving. That is the
 * conservative direction for quota and the risky one for data, which is exactly why
 * `preserveExtra` exists.
 */
export const ALWAYS_PRESERVE: readonly string[] = [
  // Acquisition - irreplaceable, once per install.
  "first_open",
  "install_attributed",
  // Denominators and virality. Carried in the KV `preserveExtra` during the 24 Sep 2026
  // emergency and made permanent in code here, so no future EMERGENCY can silently
  // drop them: app_open is the one event every session count and per-release adoption
  // figure divides by, and result_shared is the only measure of sharing. Both are
  // low volume (one per launch / one per share). A KV preserveExtra that still names
  // them is now simply redundant.
  "app_open",
  "result_shared",
  // Revenue.
  "purchase_completed",
  "shop_purchase_with_coins",
  "mega_card_unlocked",
  // Ad monetization outcomes. All low volume; together well under 1% of events.
  "rewarded_ad_requested",
  "rewarded_ad_loaded",
  "rewarded_ad_shown",
  "rewarded_ad_completed",
  "rewarded_ad_dismissed",
  "rewarded_ad_failed",
  "reward_ad_started",
  "reward_ad_completed",
  "reward_ad_failed",
  "reward_bonus_ad_started",
  "reward_bonus_ad_completed",
  "reward_bonus_ad_failed",
  "reward_fallback_used",
  // Inputs to the OTHER guard's decision. See the note above.
  "mp_room_created",
  "mp_game_started",
];

export type AnalyticsCountryPolicy = {
  mode: GuardMode;
  /** Percentage of SHEDDABLE events to keep, 0-100. Required for live ELEVATED; ignored under NORMAL. */
  keepPercent?: number;
};

export type AnalyticsShedConfig = {
  /** The single enforcement switch. True = decide and record only. Production ships true. */
  monitorOnly: boolean;
  globalMode: GuardMode;
  /** Keyed by normalized ISO country code. A country absent from here is unaffected. */
  countries: Record<string, AnalyticsCountryPolicy>;
  /** Event names added to ALWAYS_PRESERVE, so a classification call can be reversed without a deploy. */
  preserveExtra?: string[];
  /** ISO timestamp after which the whole shedding state lapses back to NORMAL. */
  expiresAt?: string;
  reason?: string;
};

/** What an absent, malformed or expired config resolves to: collect everything, exactly as today. */
export const SHED_OFF: AnalyticsShedConfig = { monitorOnly: true, globalMode: "NORMAL", countries: {} };

/** EMERGENCY keeps nothing sheddable unless told otherwise; that is what makes it the emergency. */
const EMERGENCY_DEFAULT_KEEP_PERCENT = 0;

function isGuardMode(value: unknown): value is GuardMode {
  return typeof value === "string" && (GUARD_MODES as readonly string[]).includes(value);
}

function isKeepPercent(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isCountryPolicy(value: unknown): value is AnalyticsCountryPolicy {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  if (!isGuardMode(p.mode)) return false;
  if (p.keepPercent !== undefined && !isKeepPercent(p.keepPercent)) return false;
  return true;
}

/**
 * The rules that apply only once monitorOnly is false, returned as a message rather
 * than a boolean so an operator learns WHICH rule they hit at 3am, not "invalid".
 *
 * Monitor-only configs are unconstrained - modelling a policy is the entire point of
 * monitor mode, and a model with no expiry costs nobody anything.
 */
export function shedEnforcementError(config: AnalyticsShedConfig): string | null {
  if (config.monitorOnly) return null;

  const policies =
    typeof config.countries === "object" && config.countries !== null && !Array.isArray(config.countries)
      ? (Object.values(config.countries) as AnalyticsCountryPolicy[])
      : [];
  const entries: { mode: unknown; keepPercent?: unknown }[] = [{ mode: config.globalMode }, ...policies];

  // ELEVATED means "shed some", and there is no defensible default for "some". The
  // operator states the number or does not get to run ELEVATED live - this is the one
  // numeric policy decision that must never be inherited from a code default.
  for (const entry of entries) {
    if (entry.mode === "ELEVATED" && !isKeepPercent(entry.keepPercent)) {
      return "live ELEVATED requires an explicit keepPercent (0-100) on each ELEVATED policy";
    }
  }
  // Shedding without an end is how a temporary measure becomes permanent data loss by
  // being forgotten. Every live policy is time-boxed.
  if (entries.some((entry) => entry.mode !== "NORMAL") && config.expiresAt === undefined) {
    return "live shedding requires expiresAt (prefer the next 00:00 UTC quota reset)";
  }
  return null;
}

export function isValidAnalyticsShedConfig(value: unknown): value is AnalyticsShedConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  if (typeof c.monitorOnly !== "boolean") return false;
  if (!isGuardMode(c.globalMode)) return false;
  if (typeof c.countries !== "object" || c.countries === null || Array.isArray(c.countries)) return false;
  for (const [code, policy] of Object.entries(c.countries)) {
    // Keys must already be normalized, so a policy written as "ir" cannot silently
    // match nothing while looking correct in the config.
    if (code !== normalizeCountry(code)) return false;
    if (!isCountryPolicy(policy)) return false;
  }
  if (c.preserveExtra !== undefined && (!Array.isArray(c.preserveExtra) || c.preserveExtra.some((n) => typeof n !== "string"))) return false;
  if (c.expiresAt !== undefined && !isIsoTimestamp(c.expiresAt)) return false;
  if (c.reason !== undefined && typeof c.reason !== "string") return false;
  return shedEnforcementError(c as unknown as AnalyticsShedConfig) === null;
}

export type ShedPolicy = {
  country: string;
  mode: GuardMode;
  source: "global" | "country" | "expired";
  /** Percentage of sheddable events to keep. 100 under NORMAL, so NORMAL needs no special case downstream. */
  keepPercent: number;
  monitorOnly: boolean;
};

/**
 * Resolve the policy for one request's country.
 *
 * A country entry wins over the global mode, which is what makes "protect the account
 * from one country's load" expressible without touching everyone else. Expiry is
 * evaluated lazily here, on the read path, so a lapsed policy costs no scheduler, no
 * alarm and no write - it simply stops resolving to anything restrictive.
 *
 * An unknown country (ZZ) is treated exactly like any other code: it matches only if
 * someone explicitly configured ZZ. It is never swept up by another country's policy,
 * because "we could not tell where this came from" is not evidence that it came from
 * there.
 */
export function effectiveShedPolicy(config: AnalyticsShedConfig, rawCountry: unknown, now: number = Date.now()): ShedPolicy {
  const country = normalizeCountry(rawCountry);
  const base: ShedPolicy = { country, mode: "NORMAL", source: "global", keepPercent: 100, monitorOnly: config.monitorOnly !== false };

  if (config.expiresAt !== undefined && Date.parse(config.expiresAt) <= now) {
    return { ...base, source: "expired" };
  }
  const specific = config.countries?.[country];
  const mode = specific?.mode ?? config.globalMode;
  if (mode === "NORMAL") return base;

  const configured = specific?.keepPercent;
  const keepPercent = isKeepPercent(configured)
    ? configured
    : mode === "EMERGENCY"
      ? EMERGENCY_DEFAULT_KEEP_PERCENT
      : // An ELEVATED policy with no keepPercent cannot be live (validation refuses
        // it), so this can only be a monitor-only model. Keep everything rather than
        // invent a shed rate nobody chose.
        100;
  return { ...base, mode, source: specific ? "country" : "global", keepPercent };
}

export type ShedAction = "forward" | "forward_filtered" | "drop";

export type ShedDecision = {
  action: ShedAction;
  /** What enforcement WOULD do, regardless of monitorOnly. This is the measurement. */
  wouldDrop: boolean;
  preserved: number;
  keptSampled: number;
  dropped: number;
  /** Replacement request body, present only for forward_filtered. */
  body?: string;
};

const FORWARD_UNCHANGED: ShedDecision = { action: "forward", wouldDrop: false, preserved: 0, keptSampled: 0, dropped: 0 };

function preserveSet(config: AnalyticsShedConfig): Set<string> {
  if (!config.preserveExtra || config.preserveExtra.length === 0) return new Set(ALWAYS_PRESERVE);
  return new Set([...ALWAYS_PRESERVE, ...config.preserveExtra]);
}

/**
 * Decide what to do with one ingest request, given its already-read body.
 *
 * Sampling is genuinely random here, and that is a deliberate difference from the
 * multiplayer guard, where percentage admission was rejected as unenforceable. There,
 * a refused user could tap Create again and re-roll the dice. Here the client never
 * retries - analyticsQueue.ts drops a failed batch on purpose - so there is no
 * re-roll, and unbiased random sampling is also what keeps the surviving counters
 * statistically meaningful instead of skewed toward whoever retried hardest.
 *
 * FAIL-OPEN at every step. Anything unexpected about the body - unparseable, wrong
 * shape, an entry that is not an object, a missing eventName - forwards the original
 * untouched. Validating the payload is the DO's job; this function's only job is to
 * decide whether the DO gets to see it, and when in doubt it does.
 */
export function decideShedding(
  policy: ShedPolicy,
  path: "/event" | "/events",
  bodyText: string,
  config: AnalyticsShedConfig,
  random: () => number = Math.random,
): ShedDecision {
  if (policy.mode === "NORMAL") return FORWARD_UNCHANGED;

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return FORWARD_UNCHANGED;
  }
  if (typeof parsed !== "object" || parsed === null) return FORWARD_UNCHANGED;

  const preserve = preserveSet(config);
  const isPreserved = (envelope: unknown): boolean =>
    typeof envelope === "object" && envelope !== null && preserve.has(String((envelope as { eventName?: unknown }).eventName));
  const keep = (envelope: unknown): boolean => {
    if (typeof envelope !== "object" || envelope === null) return true;
    const name = (envelope as { eventName?: unknown }).eventName;
    if (typeof name !== "string") return true;
    if (preserve.has(name)) return true;
    return random() * 100 < policy.keepPercent;
  };

  if (path === "/event") {
    // A single-event request is the simple and, today, the commonest case: roughly
    // 70% of traffic is still on pre-0.51.0 clients that post one event per request,
    // so one shed decision here removes one whole DO request.
    if (keep(parsed)) {
      const preservedOne = isPreserved(parsed) ? 1 : 0;
      return { action: "forward", wouldDrop: false, preserved: preservedOne, keptSampled: 1 - preservedOne, dropped: 0 };
    }
    return { action: "drop", wouldDrop: true, preserved: 0, keptSampled: 0, dropped: 1 };
  }

  const events = (parsed as { events?: unknown }).events;
  if (!Array.isArray(events) || events.length === 0) return FORWARD_UNCHANGED;

  const survivors: unknown[] = [];
  let preserved = 0;
  let keptSampled = 0;
  for (const envelope of events) {
    if (!keep(envelope)) continue;
    survivors.push(envelope);
    if (isPreserved(envelope)) preserved++;
    else keptSampled++;
  }
  const dropped = events.length - survivors.length;

  // Nothing survived, so the DO never needs to hear about this request at all. THIS
  // is the line that actually saves quota.
  if (survivors.length === 0) return { action: "drop", wouldDrop: true, preserved: 0, keptSampled: 0, dropped };
  // Something survived, so the request costs one DO invocation no matter what we
  // strip out of it. Filtering is still worth doing - fewer counter increments, less
  // body to parse - but it is NOT a quota saving, and the log line says so.
  if (dropped === 0) return { action: "forward", wouldDrop: false, preserved, keptSampled, dropped: 0 };
  return {
    action: "forward_filtered",
    wouldDrop: false,
    preserved,
    keptSampled,
    dropped,
    body: JSON.stringify({ ...(parsed as object), events: survivors }),
  };
}

/**
 * One structured line per NON-NORMAL decision, and nothing at all under NORMAL.
 *
 * This is the whole dry-run instrumentation, chosen over a counter because a counter
 * would have to live in AnalyticsDO - meaning the measurement of a feature that
 * exists to avoid DO requests would itself cost DO requests. A log line costs no
 * request, no row, no KV operation and no storage; `wrangler tail` reads it live, and
 * the denominator it needs - requests per country - already exists as
 * analytics_requests.byCountry. In today's production state, NORMAL, not even this is
 * emitted.
 */
export function shedLogLine(policy: ShedPolicy, decision: ShedDecision, enforced: boolean): string {
  return JSON.stringify({
    t: "an_shed",
    country: policy.country,
    mode: policy.mode,
    src: policy.source,
    keepPct: policy.keepPercent,
    action: decision.action,
    wouldDrop: decision.wouldDrop,
    preserved: decision.preserved,
    kept: decision.keptSampled,
    dropped: decision.dropped,
    monitorOnly: policy.monitorOnly,
    enforced,
  });
}
