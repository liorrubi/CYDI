// Closed vocabularies for the ad-readiness diagnostics added in 0.56.0, shared by the
// client (rewardedAds.ts, interstitialAds.ts, interstitialController.ts), the analytics
// schema and the Worker's Analytics Engine mapping. Dependency-free on purpose (same rule
// as adTypes.ts / interstitialConfigSchema.ts): workerd and plain-Node tests load it as is.
//
// Everything here rides as OPTIONAL fields on events that already exist - no new events,
// no new requests. Nothing is an identifier: a numeric Google Mobile Ads error code, a
// latency bucket and a few short enum values.

/** Where a rewarded load was started: the background preload, or the player's tap. */
export const AD_LOAD_SOURCES = ["preload", "click"] as const;
export type AdLoadSource = (typeof AD_LOAD_SOURCES)[number];

/** The rewarded lifecycle state, as observed at the tap. */
export const REWARDED_TAP_STATES = ["idle", "loading", "ready", "failed", "expired", "showing"] as const;
export type RewardedTapState = (typeof REWARDED_TAP_STATES)[number];

/**
 * Why an ad was not available at the moment it was needed (rewarded tap / interstitial
 * checkpoint). `not_attempted` = nothing was ever requested for this opportunity.
 */
export const AD_NOT_READY_CAUSES = ["failed", "loading", "not_attempted", "blocked", "expired"] as const;
export type AdNotReadyCause = (typeof AD_NOT_READY_CAUSES)[number];

/** Load latency, from the request to the SDK's Loaded callback. */
export const AD_LATENCY_BUCKETS = ["lt5s", "5to10s", "10to20s", "20to30s", "30to45s", "gt45s"] as const;
export type AdLatencyBucket = (typeof AD_LATENCY_BUCKETS)[number];

export function adLatencyBucket(ms: number): AdLatencyBucket {
  if (ms < 5_000) return "lt5s";
  if (ms < 10_000) return "5to10s";
  if (ms < 20_000) return "10to20s";
  if (ms < 30_000) return "20to30s";
  if (ms < 45_000) return "30to45s";
  return "gt45s";
}

/** Google Mobile Ads LoadAdError codes are 0..11 today; the plugin itself reports -1 for "nothing prepared". */
export const AD_ERROR_CODE_MIN = -1;
export const AD_ERROR_CODE_MAX = 99;

export function isAdErrorCode(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= AD_ERROR_CODE_MIN && value <= AD_ERROR_CODE_MAX;
}

/** Interstitial attempts per opportunity: at most two, ever. */
export function isAdAttempt(value: unknown): value is 1 | 2 {
  return value === 1 || value === 2;
}

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

export const isAdLoadSource = (v: unknown): v is AdLoadSource => isOneOf(AD_LOAD_SOURCES, v);
export const isRewardedTapState = (v: unknown): v is RewardedTapState => isOneOf(REWARDED_TAP_STATES, v);
export const isAdNotReadyCause = (v: unknown): v is AdNotReadyCause => isOneOf(AD_NOT_READY_CAUSES, v);
export const isAdLatencyBucket = (v: unknown): v is AdLatencyBucket => isOneOf(AD_LATENCY_BUCKETS, v);

/** 1-based position (0 = absent) - how the Worker stores an enum in an Analytics Engine double. */
export function enumPosition(list: readonly string[], value: unknown): number {
  const i = typeof value === "string" ? list.indexOf(value) : -1;
  return i < 0 ? 0 : i + 1;
}
