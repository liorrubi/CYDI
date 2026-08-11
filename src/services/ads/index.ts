// Public surface of the ad system. Game code imports ONLY from here:
//
//   import { showRewardedAd, isRewardedAdAvailable } from "../services/ads";
//
// Wired in (DoubleCoinsOffer + ShapeChallengeScreen/SpecialChallengeScreen/
// MegaChallengeScreen/ArtistPackScreen). The build-time flags in adConfig.ts are now
// BOTH on - AD_FLAGS.master = true and AD_FLAGS.formats.rewarded = true - so a shipped
// build is fully rewarded-capable. What actually keeps ads off is the remote kill switch
// (remoteKillSwitch.ts): it is fail-closed, defaults to disabled, and currently has no
// published config at all, so no ad request is issued regardless of what calls these.
// Flipping it to { enabled: true } is what launches ads - no new build needed. Every
// other format stays off at build time.
//
// adConfig.ts is the single place for flags + ad unit IDs; adPlacements.ts is the single
// place for the closed placement list.

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
  registerRemoteAdsGate,
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
export { isRemoteAdsEnabled, refreshRemoteAdsKillSwitch } from "./remoteKillSwitch";
export { isValidRemoteAdsConfig, type RemoteAdsConfig } from "./remoteAdsConfigSchema";

// Analytics bridge is wired the moment the ad system is first imported, so no
// call site ever has to remember it. Idempotent (named subscription).
connectAdAnalytics();
