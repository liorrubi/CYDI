// The ONLY connection between the ad system and analytics, kept in its own file
// so rewardedAds.ts knows nothing about analytics and analytics knows nothing
// about ads: this bridge subscribes to the ad lifecycle stream and forwards each
// moment as a schema-validated analytics event (see analyticsSchema.ts).
//
// Privacy: the detail forwarded is { placement, reason? } plus the 0.56 readiness
// diagnostics (a numeric Google Mobile Ads error code, a load-source / lifecycle-state /
// not-ready-cause enum and a latency bucket - all closed sets from adDiagnostics.ts) - no
// SDK error strings, no free text, no identifiers; nothing sensitive can pass through even
// by accident. They ride on the events that already exist: no new event, no new request.

import { trackEvent } from "../analytics";
import type { AnalyticsEventName, EventParamsMap } from "../analyticsSchema";
import { subscribeRewardedAdEvents } from "./rewardedAds";
import type { RewardedAdEventDetail, RewardedAdLifecycleEvent } from "./adTypes";

type AdAnalyticsEvent =
  | { eventName: "rewarded_ad_requested"; params: EventParamsMap["rewarded_ad_requested"] }
  | { eventName: "rewarded_ad_loaded"; params: EventParamsMap["rewarded_ad_loaded"] }
  | { eventName: "rewarded_ad_shown" | "rewarded_ad_completed" | "rewarded_ad_dismissed"; params: { placement: RewardedAdEventDetail["placement"] } }
  | { eventName: "rewarded_ad_unavailable" | "rewarded_ad_failed"; params: EventParamsMap["rewarded_ad_failed"] };

/** The optional diagnostic fields present on `detail`, and only those. */
function failureDiag(detail: RewardedAdEventDetail): Omit<EventParamsMap["rewarded_ad_failed"], "placement" | "reason"> {
  return {
    ...(detail.source !== undefined ? { source: detail.source } : {}),
    ...(detail.code !== undefined ? { code: detail.code } : {}),
    ...(detail.stateAtTap !== undefined ? { stateAtTap: detail.stateAtTap } : {}),
    ...(detail.cause !== undefined ? { cause: detail.cause } : {}),
    ...(detail.latency !== undefined ? { latency: detail.latency } : {}),
  };
}

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
      return {
        eventName: "rewarded_ad_requested",
        params: { placement: detail.placement, ...(detail.stateAtTap !== undefined ? { stateAtTap: detail.stateAtTap } : {}) },
      };
    case "loaded":
      return {
        eventName: "rewarded_ad_loaded",
        params: {
          placement: detail.placement,
          ...(detail.source !== undefined ? { source: detail.source } : {}),
          ...(detail.latency !== undefined ? { latency: detail.latency } : {}),
        },
      };
    case "shown":
      return { eventName: "rewarded_ad_shown", params: { placement: detail.placement } };
    case "rewarded":
      return { eventName: "rewarded_ad_completed", params: { placement: detail.placement } };
    case "dismissed":
      return { eventName: "rewarded_ad_dismissed", params: { placement: detail.placement } };
    case "unavailable":
      return {
        eventName: "rewarded_ad_unavailable",
        params: { placement: detail.placement, reason: detail.reason ?? "sdk_error", ...failureDiag(detail) },
      };
    case "error":
      return {
        eventName: "rewarded_ad_failed",
        params: { placement: detail.placement, reason: detail.reason ?? "sdk_error", ...failureDiag(detail) },
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
