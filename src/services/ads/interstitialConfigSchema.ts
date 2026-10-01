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
export const INTERSTITIAL_SESSION_CAPS = [1, 2, 3] as const;
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
