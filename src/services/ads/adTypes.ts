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
import type { AdLatencyBucket, AdLoadSource, AdNotReadyCause, RewardedTapState } from "./adDiagnostics";

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
  /** Google UMP consent does not currently allow an ad request (fail-closed default). */
  "consent_blocked",
  /** An ad is already on screen. */
  "already_showing",
  /** Invalid placement passed from non-typechecked code. */
  "invalid_placement",
  /** The SDK did not produce a loaded ad to show. */
  "load_failed",
  /** A load/show exceeded its time budget. */
  "timeout",
  /**
   * The ad network had no ad to return (Google Mobile Ads ERROR_CODE_NO_FILL).
   * A normal auction outcome for a low-volume app, NOT a fault - kept apart from
   * "sdk_error" so an empty inventory never reads as a broken integration.
   */
  "no_fill",
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
 * - "dismissed":   user closed the ad without earning the reward; no reward, no error.
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
  /** 0.56 diagnostics (all optional, all bounded - see adDiagnostics.ts). */
  /** "loaded"/"unavailable": who started the load this concerns. */
  source?: AdLoadSource;
  /** Numeric Google Mobile Ads error code of the failed load, when the plugin reported one. */
  code?: number;
  /** "requested"/"unavailable": the lifecycle state the tap found. */
  stateAtTap?: RewardedTapState;
  /** "unavailable": why nothing could be shown at the tap. */
  cause?: AdNotReadyCause;
  /** "loaded"/"unavailable" (failed load): request-to-callback latency bucket. */
  latency?: AdLatencyBucket;
};

/**
 * A rejected rewarded load or show: the numeric GMA code when the plugin reported one, plus the
 * plugin's rejection message (bounded). The message exists ONLY so the service can classify a
 * no-fill when no numeric code arrived; it is never forwarded to analytics or stored anywhere.
 */
export type RewardedLoadError = { code?: number; message?: string };

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
  /** Load (pre-cache) a rewarded ad for the given ad unit. Resolves when ready to show. May reject (optionally with a RewardedLoadError); the service catches. */
  loadRewarded(adUnitId: string): Promise<void>;
  /**
   * Show the loaded rewarded ad. Resolves with the reward once it is earned, or null when the ad was
   * dismissed without one (a dismiss, not a failure - nothing is granted). Must settle on the ad
   * closing, not only on a reward: the plugin's own call resolves on a reward alone. Rejects (optionally
   * with a RewardedLoadError) when the ad could not be shown; the service catches.
   */
  showRewarded(): Promise<AdReward | null>;
};
