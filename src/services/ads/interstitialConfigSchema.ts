// Shared wire format and closed vocabularies for the interstitial A/B experiment,
// used by the client (interstitialConfig.ts, interstitialController.ts), the
// analytics schema and the Worker (GET/PUT /api/config/ads/interstitial). Same
// "shared, dependency-free schema module" rule as remoteAdsConfigSchema.ts: no
// imports, no import.meta.env, no browser APIs, so workerd and plain-Node tests can
// load it directly.
//
// Deliberately a SEPARATE endpoint and a separate KV key from /api/config/ads.
// Released clients validate that object strictly (exactly one key, `enabled`), so
// adding interstitial fields to it would make every installed build fail closed and
// silently turn rewarded ads off. This file never touches that contract.

export const INTERSTITIAL_CONFIG_KV_KEY = "config:ads:interstitial";

/** Games between opportunities. A closed set so a typo in the admin PUT cannot ship a cadence nobody reviewed. */
export const INTERSTITIAL_CADENCES = [5, 7, 10, 12, 15, 20] as const;
export type InterstitialCadence = (typeof INTERSTITIAL_CADENCES)[number];

/** Opportunities per analytics session - symmetric across arms, NOT "ads shown". */
export const INTERSTITIAL_SESSION_CAPS = [1, 2] as const;
export type InterstitialSessionCap = (typeof INTERSTITIAL_SESSION_CAPS)[number];

/**
 * Treatment is buckets [0, rollout%) and control the equal-sized mirror
 * [50%, 50% + rollout%), so the ceiling is 50: at 50 every installation is in one
 * arm or the other. Both arms only ever GROW as the percentage rises, which is what
 * makes 5 -> 20 -> 50 keep every earlier assignment.
 */
export const INTERSTITIAL_MAX_ROLLOUT_PERCENT = 50;
/**
 * The full range a 0.56+ client and Worker accept (0-100). Above 50 the control holdback
 * shrinks (see assignArm). Clients older than 0.56 reject anything above 50 as malformed
 * and fail closed, so the Worker serves them min(rollout, 50) - see toClientConfig.
 */
export const INTERSTITIAL_MAX_ROLLOUT_PERCENT_V2 = 100;

export const INTERSTITIAL_ARMS = ["control", "treatment"] as const;
export type InterstitialArm = (typeof INTERSTITIAL_ARMS)[number];
/** What an installation is when it takes no part: not bucketed in, or no stable persisted id. Never sent to analytics. */
export type InterstitialAssignment = InterstitialArm | "unassigned";

/**
 * Every way an opportunity can end. EVERY one of them consumes the opportunity -
 * there is deliberately no "capped" or "pending" value.
 * - control:     control arm; nothing is shown, the moment is only recorded.
 * - not_ready:   treatment, but no ad was loaded at the checkpoint - skipped at once.
 * - shown:       the SDK's own Showed callback fired. Nothing else may produce this.
 * - show_failed: FailedToShow, a rejected show call, or no evidence of an ad in time.
 * - suppressed:  a rewarded ad was shown during this result cycle (either arm).
 */
export const INTERSTITIAL_OUTCOMES = ["control", "not_ready", "shown", "show_failed", "suppressed"] as const;
export type InterstitialOutcome = (typeof INTERSTITIAL_OUTCOMES)[number];

/**
 * Bounded failure vocabulary for interstitial loads and failed shows. Derived from the
 * Google Mobile Ads numeric error code wherever the plugin exposes one - never from an
 * SDK message string, which is never stored or sent.
 */
export const INTERSTITIAL_FAILURE_REASONS = ["no_fill", "network_error", "not_configured", "timeout", "sdk_error"] as const;
export type InterstitialFailureReason = (typeof INTERSTITIAL_FAILURE_REASONS)[number];

export function isInterstitialCadence(value: unknown): value is InterstitialCadence {
  return typeof value === "number" && (INTERSTITIAL_CADENCES as readonly number[]).includes(value);
}

export function isInterstitialSessionCap(value: unknown): value is InterstitialSessionCap {
  return typeof value === "number" && (INTERSTITIAL_SESSION_CAPS as readonly number[]).includes(value);
}

/** Legacy (pre-0.56) range, 0-50: what an older client still validates. */
export function isInterstitialRolloutPercent(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= INTERSTITIAL_MAX_ROLLOUT_PERCENT;
}

/** The full 0-100 range (0.56+). */
export function isInterstitialRolloutPercentV2(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= INTERSTITIAL_MAX_ROLLOUT_PERCENT_V2;
}

export function isInterstitialArm(value: unknown): value is InterstitialArm {
  return typeof value === "string" && (INTERSTITIAL_ARMS as readonly string[]).includes(value);
}

export function isInterstitialOutcome(value: unknown): value is InterstitialOutcome {
  return typeof value === "string" && (INTERSTITIAL_OUTCOMES as readonly string[]).includes(value);
}

export function isInterstitialFailureReason(value: unknown): value is InterstitialFailureReason {
  return typeof value === "string" && (INTERSTITIAL_FAILURE_REASONS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  const objKeys = Object.keys(obj);
  return objKeys.length === keys.length && keys.every((k) => objKeys.includes(k));
}

// --- What the client receives -------------------------------------------------------

/**
 * The response of GET /api/config/ads/interstitial. `countryEligible` is the ONLY
 * country information a client ever sees: the server decides it from the network
 * country Cloudflare observed, and the client never sends or learns a country code.
 *
 * The two optional keys exist since 0.56 and are sent ONLY to a client that asks for the
 * v2 shape (`?v=2`) - a released client validates exact keys and would fail closed on them.
 * Absent = the default: every installation may have a second opportunity (up to the
 * session cap) and the rewarded lifecycle v2 is on.
 */
export type InterstitialClientConfig = {
  enabled: boolean;
  rolloutPercent: number;
  gamesBetweenAds: InterstitialCadence;
  maxOpportunitiesPerSession: InterstitialSessionCap;
  countryEligible: boolean;
  /** 0-100: the share of installations that may have a 2nd+ opportunity in a session. */
  secondOpportunityRolloutPercent?: number;
  /** false = back out the rewarded lifecycle v2 to the 0.55 timing (a remote kill switch). */
  rewardedLifecycleV2?: boolean;
};

const CLIENT_KEYS = ["enabled", "rolloutPercent", "gamesBetweenAds", "maxOpportunitiesPerSession", "countryEligible"] as const;
const CLIENT_OPTIONAL_KEYS = ["secondOpportunityRolloutPercent", "rewardedLifecycleV2"] as const;

function hasKeysWithin(obj: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean {
  const keys = Object.keys(obj);
  return required.every((k) => keys.includes(k)) && keys.every((k) => required.includes(k) || optional.includes(k));
}

function optionalFieldsValid(value: Record<string, unknown>): boolean {
  return (
    (!("secondOpportunityRolloutPercent" in value) || isInterstitialRolloutPercentV2(value.secondOpportunityRolloutPercent)) &&
    (!("rewardedLifecycleV2" in value) || typeof value.rewardedLifecycleV2 === "boolean")
  );
}

/**
 * Strict, all-or-nothing: the five required keys (plus, since 0.56, the two optional ones),
 * every value from its closed set. Anything else fails closed. The rollout is 0-100 here;
 * the Worker never sends a legacy client more than 50 (toClientConfig).
 */
export function isValidInterstitialClientConfig(value: unknown): value is InterstitialClientConfig {
  if (!isRecord(value) || !hasKeysWithin(value, CLIENT_KEYS, CLIENT_OPTIONAL_KEYS)) return false;
  return (
    typeof value.enabled === "boolean" &&
    isInterstitialRolloutPercentV2(value.rolloutPercent) &&
    isInterstitialCadence(value.gamesBetweenAds) &&
    isInterstitialSessionCap(value.maxOpportunitiesPerSession) &&
    typeof value.countryEligible === "boolean" &&
    optionalFieldsValid(value)
  );
}

/** What a PRE-0.56 client accepts, for compatibility tests: exact keys, rollout 0-50. */
export function isValidLegacyInterstitialClientConfig(value: unknown): value is InterstitialClientConfig {
  if (!isRecord(value) || !hasExactKeys(value, CLIENT_KEYS)) return false;
  return (
    typeof value.enabled === "boolean" &&
    isInterstitialRolloutPercent(value.rolloutPercent) &&
    isInterstitialCadence(value.gamesBetweenAds) &&
    isInterstitialSessionCap(value.maxOpportunitiesPerSession) &&
    typeof value.countryEligible === "boolean"
  );
}

// --- What the owner stores (KV) ------------------------------------------------------

/**
 * The stored config. Country policy stays server-side: `blockedCountries` is never
 * returned to a client, only the resulting boolean.
 */
export type InterstitialStoredConfig = {
  enabled: boolean;
  /** 0-100 (0.56+). Above 50 the control holdback shrinks; a pre-0.56 client is served min(rollout, 50). */
  rolloutPercent: number;
  gamesBetweenAds: InterstitialCadence;
  maxOpportunitiesPerSession: InterstitialSessionCap;
  /** Upper-case ISO 3166-1 alpha-2 codes. Unknown/unsupported codes are ALWAYS ineligible on top of this list. */
  blockedCountries: string[];
  /** Optional (0.56+): see InterstitialClientConfig. */
  secondOpportunityRolloutPercent?: number;
  /** Optional (0.56+): see InterstitialClientConfig. */
  rewardedLifecycleV2?: boolean;
};

const STORED_KEYS = ["enabled", "rolloutPercent", "gamesBetweenAds", "maxOpportunitiesPerSession", "blockedCountries"] as const;
const COUNTRY_CODE = /^[A-Z]{2}$/;
const MAX_BLOCKED_COUNTRIES = 250;

export function isValidInterstitialStoredConfig(value: unknown): value is InterstitialStoredConfig {
  if (!isRecord(value) || !hasKeysWithin(value, STORED_KEYS, CLIENT_OPTIONAL_KEYS)) return false;
  const blocked = value.blockedCountries;
  return (
    typeof value.enabled === "boolean" &&
    isInterstitialRolloutPercentV2(value.rolloutPercent) &&
    optionalFieldsValid(value) &&
    isInterstitialCadence(value.gamesBetweenAds) &&
    isInterstitialSessionCap(value.maxOpportunitiesPerSession) &&
    Array.isArray(blocked) &&
    blocked.length <= MAX_BLOCKED_COUNTRIES &&
    blocked.every((code) => typeof code === "string" && COUNTRY_CODE.test(code))
  );
}

/** Parses raw JSON text (KV value or request body) without ever throwing. */
export function parseInterstitialStoredConfig(raw: string): InterstitialStoredConfig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isValidInterstitialStoredConfig(parsed) ? parsed : null;
}

/**
 * Codes Cloudflare uses for "not a real country": XX = could not be determined,
 * T1 = Tor. Anything that is not two upper-case letters is unsupported as well.
 * These are ineligible regardless of `blockedCountries`, so "unknown" can never be
 * opted in by forgetting to list it.
 */
const NEVER_ELIGIBLE = new Set(["XX", "T1", "ZZ"]);

/**
 * The server-side eligibility decision, from the NETWORK country Cloudflare observed
 * for this request. It is not the person's nationality or physical location - a VPN
 * reports its exit - and no attempt is made to detect one.
 */
export function isCountryEligible(config: InterstitialStoredConfig, country: unknown): boolean {
  if (typeof country !== "string" || !COUNTRY_CODE.test(country) || NEVER_ELIGIBLE.has(country)) return false;
  return !config.blockedCountries.includes(country);
}

/**
 * `v2` = the client asked for the 0.56 shape (`?v=2`). Without it the response is exactly the
 * five keys a released client validates, with the rollout capped at 50 (its schema maximum) -
 * so storing a value above 50, or either optional key, can never turn a released client's
 * interstitial off.
 */
export function toClientConfig(config: InterstitialStoredConfig, country: unknown, v2 = false): InterstitialClientConfig {
  const base: InterstitialClientConfig = {
    enabled: config.enabled,
    rolloutPercent: v2 ? config.rolloutPercent : Math.min(config.rolloutPercent, INTERSTITIAL_MAX_ROLLOUT_PERCENT),
    gamesBetweenAds: config.gamesBetweenAds,
    maxOpportunitiesPerSession: config.maxOpportunitiesPerSession,
    countryEligible: isCountryEligible(config, country),
  };
  if (!v2) return base;
  return {
    ...base,
    ...(config.secondOpportunityRolloutPercent !== undefined ? { secondOpportunityRolloutPercent: config.secondOpportunityRolloutPercent } : {}),
    ...(config.rewardedLifecycleV2 !== undefined ? { rewardedLifecycleV2: config.rewardedLifecycleV2 } : {}),
  };
}

// --- v3: remote multi-cell interstitial experiment (0.57+) -----------------------------
//
// Served ONLY on `?v=3` of the interstitial config route, and stored under its OWN KV key.
// Never a new key on the stored `config:ads:interstitial` object or on the plain / `?v=2`
// bodies: 0.56 and older clients validate those objects by exact key set and would switch the
// interstitial off (and the live Worker would answer 500 for a stored object it does not
// know). The v3 body is the v2 body unchanged plus an optional top-level `experiments` object.
//
// An `experiments` block that is missing or invalid means "experiments OFF" - it never
// invalidates the base config next to it.

export const INTERSTITIAL_EXPERIMENTS_KV_KEY = "config:ads:experiments";

export const INTERSTITIAL_CELL_IDS = ["A", "B", "C", "D", "E", "F"] as const;
export type InterstitialCellId = (typeof INTERSTITIAL_CELL_IDS)[number];

/**
 * SAFETY ENVELOPE - hard client bounds, enforced here for the client AND the Worker, so a bad
 * remote config can never cause more ad pressure than the reviewed limits. Nothing may be
 * more aggressive than cadence 5 / cap 2 (a 7/3 cell is the most opportunities per session
 * the envelope allows, and only because its cadence is longer).
 *  - cadence: any INTEGER 5..20 (isEffectiveInterstitialCadence). Analytics accepts the same range
 *    (`gamesBetweenAds` telemetry and the Worker's per-cadence counter, at most 16 keys), so a cell such
 *    as 6/2 or 5/2 needs no APK. Nothing below 5 games between opportunities exists. The BASE config's
 *    cadence stays the closed legacy set INTERSTITIAL_CADENCES (v1/v2 compatibility).
 *  - cap: 1..3 opportunities per analytics session.
 *  - joint rule cadence >= 2 * cap: the cap must never be reachable faster than every second
 *    cadence window (5/2 and 7/3 ok; 5/3 and 5/4 not), so a high cap cannot be combined with a
 *    short cadence into a burst of ads.
 *  - 2..6 cells with unique ids from A..F; integer weights summing to EXACTLY 100, at least two
 *    cells with weight > 0 (a 0-weight cell is allowed: nobody new lands in it).
 *  - version 1..1_000_000 (bumping it deliberately re-assigns everyone); rolloutPercentInTreatment 0..100.
 * Any violation anywhere in the interstitial subtree turns the WHOLE experiment off - never a
 * partially applied cell set.
 */
export const IFX_MIN_CADENCE = 5;
export const IFX_MAX_CADENCE = 20;
export const IFX_MIN_CAP = 1;
export const IFX_MAX_CAP = 3;
export const IFX_MIN_CELLS = 2;
export const IFX_MAX_CELLS = 6;
export const IFX_MAX_VERSION = 1_000_000;

/**
 * The EFFECTIVE cadence of a session (a cell's, or the base config's): any integer IFX_MIN_CADENCE..IFX_MAX_CADENCE.
 * Wider than isInterstitialCadence (the closed legacy set the BASE config is still validated against), and the
 * one check analytics (client + Worker) and the persisted snapshot / continuation marker use, so a cell cadence
 * of 6 survives a reload and is accepted by telemetry. Old values 5/7/10/12/15/20 stay valid.
 */
export function isEffectiveInterstitialCadence(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= IFX_MIN_CADENCE && value <= IFX_MAX_CADENCE;
}

export type InterstitialExperimentCell = {
  id: InterstitialCellId;
  /** Any integer 5..20 (not limited to INTERSTITIAL_CADENCES). */
  cadence: number;
  /** Opportunities per analytics session for this cell. */
  cap: number;
  /** Integer share of the in-experiment population, 0-100; all cells sum to exactly 100. */
  weight: number;
};

export type InterstitialExperimentSpec = {
  enabled: boolean;
  /** Share of TREATMENT-arm installations that take part (monotonic: raising it only adds participants). */
  rolloutPercentInTreatment: number;
  version: number;
  cells: InterstitialExperimentCell[];
};

export type InterstitialExperiments = { interstitial: InterstitialExperimentSpec };

const SPEC_KEYS = ["enabled", "rolloutPercentInTreatment", "version", "cells"] as const;
const CELL_KEYS = ["id", "cadence", "cap", "weight"] as const;

function isIntInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isValidExperimentCell(value: unknown): value is InterstitialExperimentCell {
  if (!isRecord(value) || !hasExactKeys(value, CELL_KEYS)) return false;
  return (
    typeof value.id === "string" &&
    (INTERSTITIAL_CELL_IDS as readonly string[]).includes(value.id) &&
    isEffectiveInterstitialCadence(value.cadence) &&
    isIntInRange(value.cap, IFX_MIN_CAP, IFX_MAX_CAP) &&
    value.cadence >= 2 * value.cap &&
    isIntInRange(value.weight, 0, 100)
  );
}

/** Strict and all-or-nothing: the exact four keys, every cell valid, the whole set inside the envelope. */
export function isValidInterstitialExperimentSpec(value: unknown): value is InterstitialExperimentSpec {
  if (!isRecord(value) || !hasExactKeys(value, SPEC_KEYS)) return false;
  const cells = value.cells;
  if (
    typeof value.enabled !== "boolean" ||
    !isIntInRange(value.rolloutPercentInTreatment, 0, 100) ||
    !isIntInRange(value.version, 1, IFX_MAX_VERSION) ||
    !Array.isArray(cells) ||
    cells.length < IFX_MIN_CELLS ||
    cells.length > IFX_MAX_CELLS ||
    !cells.every(isValidExperimentCell)
  ) {
    return false;
  }
  const typed = cells as InterstitialExperimentCell[];
  if (new Set(typed.map((c) => c.id)).size !== typed.length) return false;
  if (typed.reduce((sum, c) => sum + c.weight, 0) !== 100) return false;
  return typed.filter((c) => c.weight > 0).length >= 2;
}

function copySpec(spec: InterstitialExperimentSpec): InterstitialExperimentSpec {
  return {
    enabled: spec.enabled,
    rolloutPercentInTreatment: spec.rolloutPercentInTreatment,
    version: spec.version,
    cells: spec.cells.map((c) => ({ id: c.id, cadence: c.cadence, cap: c.cap, weight: c.weight })),
  };
}

/**
 * Client side: the `experiments` value of a v3 body -> the interstitial spec, or null (= experiments
 * OFF). Tolerant at this level - other keys next to `interstitial` (a future experiment) are ignored -
 * but the interstitial subtree itself is strict. Never throws.
 */
export function parseClientInterstitialExperiment(experiments: unknown): InterstitialExperimentSpec | null {
  if (!isRecord(experiments)) return null;
  const spec = experiments.interstitial;
  return isValidInterstitialExperimentSpec(spec) ? copySpec(spec) : null;
}

/**
 * Worker side (stored value / PUT body): exactly `{ interstitial: <valid spec> }`. Strict at the
 * top level too, so a typo like `interstital` is rejected on write instead of silently doing nothing.
 */
export function isValidStoredInterstitialExperiments(value: unknown): value is InterstitialExperiments {
  return isRecord(value) && hasExactKeys(value, ["interstitial"]) && isValidInterstitialExperimentSpec(value.interstitial);
}

/** Parses raw JSON text (KV value or request body) without ever throwing. */
export function parseStoredInterstitialExperiments(raw: string): InterstitialExperiments | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isValidStoredInterstitialExperiments(parsed) ? { interstitial: copySpec(parsed.interstitial) } : null;
}

const CLIENT_BASE_KEYS: readonly string[] = [...CLIENT_KEYS, ...CLIENT_OPTIONAL_KEYS];

/**
 * Client side: a `?v=3` body. The base keys are validated EXACTLY as before (isValidInterstitialClientConfig);
 * what is new is that unknown top-level keys are tolerated and ignored (so a future Worker can add one without
 * switching 0.57 clients off) and that `experiments` can never invalidate the base. A legacy-shaped body (the
 * five plain keys - what an OLD Worker answers for `?v=3`) is a valid base with experiments OFF.
 */
export function parseInterstitialV3Body(body: unknown): { config: InterstitialClientConfig; experiment: InterstitialExperimentSpec | null } | null {
  if (!isRecord(body)) return null;
  const base: Record<string, unknown> = {};
  for (const key of CLIENT_BASE_KEYS) if (key in body) base[key] = body[key];
  if (!isValidInterstitialClientConfig(base)) return null;
  return { config: base, experiment: parseClientInterstitialExperiment(body.experiments) };
}
