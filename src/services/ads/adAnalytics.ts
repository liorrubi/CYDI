// The ONLY connection between the ad system and analytics, kept in its own file
// so rewardedAds.ts knows nothing about analytics and analytics knows nothing
// about ads: this bridge subscribes to the ad lifecycle stream and forwards each
// moment as a schema-validated analytics event (see analyticsSchema.ts).
//
// Privacy: the detail forwarded is exactly { placement, reason? }, both from
// closed unions defined in the ads module - no SDK error strings, no free text,
// nothing sensitive can pass through even by accident.

import { trackEvent } from "../analytics";
import type { AnalyticsEventName, EventParamsMap } from "../analyticsSchema";
import { subscribeRewardedAdEvents } from "./rewardedAds";
import type { RewardedAdEventDetail, RewardedAdLifecycleEvent } from "./adTypes";

type AdAnalyticsEvent =
  | { eventName: "rewarded_ad_requested" | "rewarded_ad_loaded" | "rewarded_ad_shown" | "rewarded_ad_completed" | "rewarded_ad_dismissed"; params: EventParamsMap["rewarded_ad_requested"] }
  | { eventName: "rewarded_ad_unavailable" | "rewarded_ad_failed"; params: EventParamsMap["rewarded_ad_failed"] };

/**
 * Pure lifecycle -> analytics mapping (exported for tests). Returns null for
 * moments that are UI-only ("loading" has no analytics event).
 */
export function mapLifecycleToAnalytics(
  event: RewardedAdLifecycleEvent,
  detail: RewardedAdEventDetail,
): AdAnalyticsEvent | null {
  switch (event) {
    case "requested":
      return { eventName: "rewarded_ad_requested", params: { placement: detail.placement } };
    case "loaded":
      return { eventName: "rewarded_ad_loaded", params: { placement: detail.placement } };
    case "shown":
      return { eventName: "rewarded_ad_shown", params: { placement: detail.placement } };
    case "rewarded":
      return { eventName: "rewarded_ad_completed", params: { placement: detail.placement } };
    case "dismissed":
      return { eventName: "rewarded_ad_dismissed", params: { placement: detail.placement } };
    case "unavailable":
      return {
        eventName: "rewarded_ad_unavailable",
        params: { placement: detail.placement, reason: detail.reason ?? "sdk_error" },
      };
    case "error":
      return {
        eventName: "rewarded_ad_failed",
        params: { placement: detail.placement, reason: detail.reason ?? "sdk_error" },
      };
    case "loading":
      return null;
  }
}

type TrackFn = <E extends AnalyticsEventName>(eventName: E, params: EventParamsMap[E]) => void;

/**
 * Wire the bridge. Called once at module load via ads/index.ts; the named
 * subscription makes repeat calls (HMR, tests) replace rather than stack.
 * `track` is injectable for tests only.
 */
export function connectAdAnalytics(track: TrackFn = trackEvent): void {
  subscribeRewardedAdEvents("analytics-bridge", (event, detail) => {
    const mapped = mapLifecycleToAnalytics(event, detail);
    if (mapped) track(mapped.eventName, mapped.params);
  });
}
