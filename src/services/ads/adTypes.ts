// Shared types for the ad system. The AdAdapter interface is the seam between
// game code and any real ad SDK: game code only ever talks to rewardedAds.ts,
// which talks to whatever adapter is registered. Adding AdMob later (e.g. the
// Capacitor AdMob plugin once the game is wrapped as a native app) means writing
// one adapter object and registering it - zero changes to game code.
//
// Like adPlacements.ts, this file must stay dependency-free apart from that
// module: analyticsSchema.ts (bundled into the Worker too) imports the failure
// reason list from here.

import type { RewardedAdPlacement } from "./adPlacements";

/** Every ad format we may ever serve. Config/flag rows in adConfig.ts are keyed by this. */
export type AdFormat = "rewarded" | "rewardedInterstitial" | "interstitial" | "banner" | "appOpen";

export type AdPlatform = "android" | "ios";

/** The reward AdMob reports when the user watched a rewarded ad to completion. */
export type AdReward = {
  type: string;
  amount: number;
};

/**
 * Closed list of generic, non-sensitive failure/unavailability reasons - safe to
 * ship to analytics as-is. Raw SDK error messages are NEVER forwarded anywhere;
 * they are collapsed onto one of these.
 */
export const AD_FAILURE_REASONS = [
  /** Master flag or the format's own flag is off. */
  "ads_disabled",
  /** No ad SDK adapter registered (e.g. running as a plain web app). */
  "no_adapter",
  /** No ad unit ID configured for this format+platform. */
  "not_configured",
  /** An ad is already on screen. */
  "already_showing",
  /** Invalid placement passed from non-typechecked code. */
  "invalid_placement",
  /** The SDK did not produce a loaded ad to show. */
  "load_failed",
  /** A load/show exceeded its time budget. */
  "timeout",
  /** The SDK threw/rejected while loading or showing. */
  "sdk_error",
] as const;

export type AdFailureReason = (typeof AD_FAILURE_REASONS)[number];

export function isAdFailureReason(value: unknown): value is AdFailureReason {
  return typeof value === "string" && (AD_FAILURE_REASONS as readonly string[]).includes(value);
}

/**
 * Outcome of a showRewardedAd() call. Exactly one of these always resolves -
 * the promise NEVER rejects, so call sites need no try/catch and gameplay can
 * never be broken by an ad failure:
 * - "rewarded":    user watched through (SDK-verified reward event); grant the reward.
 * - "dismissed":   user closed the ad early; no reward, no error.
 * - "unavailable": ads disabled, no adapter, not configured, or nothing loaded.
 * - "error":       the SDK failed to show; treat exactly like unavailable.
 */
export type RewardedAdResult =
  | { status: "rewarded"; reward: AdReward }
  | { status: "dismissed" }
  | { status: "unavailable"; reason: AdFailureReason }
  | { status: "error"; reason: AdFailureReason };

/**
 * Lifecycle moments of one rewarded ad flow, in rough order. "loading" is
 * UI-facing only (spinners); the other seven map 1:1 onto analytics events in
 * adAnalytics.ts.
 */
export type RewardedAdLifecycleEvent =
  | "requested"
  | "loading"
  | "loaded"
  | "shown"
  | "rewarded"
  | "dismissed"
  | "unavailable"
  | "error";

export type RewardedAdEventDetail = {
  placement: RewardedAdPlacement;
  /** Present only on "unavailable"/"error". */
  reason?: AdFailureReason;
};

/** Observer of lifecycle events. Must never throw (the service guards anyway). */
export type RewardedAdListener = (event: RewardedAdLifecycleEvent, detail: RewardedAdEventDetail) => void;

/**
 * What a concrete ad SDK integration must implement. Only rewarded support is
 * required today; future formats become OPTIONAL members (e.g. `showInterstitial?`)
 * so existing adapters keep compiling untouched.
 */
export type AdAdapter = {
  /** Stable name, keyed in the registry so HMR/StrictMode re-registration replaces, not duplicates. */
  name: string;
  /** One-time SDK init (consent, config). Called lazily before the first load. May reject; the service catches. */
  initialize(): Promise<void>;
  /** Load (pre-cache) a rewarded ad for the given ad unit. Resolves when ready to show. May reject; the service catches. */
  loadRewarded(adUnitId: string): Promise<void>;
  /** Show the loaded rewarded ad. Resolves with the reward, or null if dismissed early. May reject; the service catches. */
  showRewarded(): Promise<AdReward | null>;
};
