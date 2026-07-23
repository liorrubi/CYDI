// Public surface of the ad system. Game code imports ONLY from here:
//
//   import { showRewardedAd, isRewardedAdAvailable } from "../services/ads";
//
// Currently dormant: every flag in AD_FLAGS (adConfig.ts) is false and no game
// code calls these yet. adConfig.ts is the single place for flags + ad unit IDs;
// adPlacements.ts is the single place for the closed placement list.

import { connectAdAnalytics } from "./adAnalytics";

export { AD_FLAGS, isAdFormatEnabled, isAdTestingEnvironment, type AdFeatureFlags } from "./adConfig";
export { REWARDED_AD_PLACEMENTS, isRewardedAdPlacement, type RewardedAdPlacement } from "./adPlacements";
export type {
  AdFormat,
  AdPlatform,
  AdReward,
  AdFailureReason,
  RewardedAdResult,
  RewardedAdLifecycleEvent,
  RewardedAdEventDetail,
  RewardedAdListener,
  AdAdapter,
} from "./adTypes";
export {
  registerAdAdapter,
  registerAdConsentGate,
  subscribeRewardedAdEvents,
  isRewardedAdAvailable,
  isRewardedAdReady,
  preloadRewardedAd,
  showRewardedAd,
} from "./rewardedAds";
export { createAdMobAdapter } from "./admobAdapter";
export type { AdMobPluginLike } from "./admobAdapter";
export {
  getConsentState,
  subscribeConsentState,
  initializeConsent,
  refreshConsentAfterPrivacyOptions,
  type ConsentState,
  type ConsentPluginLike,
} from "./consent";

// Analytics bridge is wired the moment the ad system is first imported, so no
// call site ever has to remember it. Idempotent (named subscription).
connectAdAnalytics();
