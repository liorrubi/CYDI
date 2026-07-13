// SINGLE source of truth for everything AdMob: the master switch, every ad unit ID,
// and the app IDs. Swapping/adding production IDs, enabling ads, or adding a new ad
// format is done ONLY in this file - no other code ever contains an ad unit ID.
//
// ID policy:
// - Dev builds (`npm run dev`) ALWAYS resolve to Google's official public demo/test
//   ad units, per Google policy. These are published by Google for exactly this
//   purpose and are safe to commit.
// - Production builds resolve ONLY from Vite env vars (VITE_ADMOB_*), typically set
//   in an untracked `.env.production.local` or in CI. Nothing sensitive is hardcoded
//   here; a missing env var yields an empty ID, which the ad service treats as
//   "this format is not configured" and skips silently.

import type { AdFormat, AdPlatform } from "./adTypes";

export type AdFeatureFlags = {
  /** Master kill switch: false disables the ENTIRE ad system regardless of per-format flags. */
  master: boolean;
  /** Per-format switches - each format can be launched/killed independently. */
  formats: Record<AdFormat, boolean>;
};

/**
 * Ads are being PREPARED but not launched yet - everything stays `false` until
 * placements/rewards are decided. While a format is off (or master is off), the
 * ad service never initializes an SDK or issues a single ad request for it, and
 * every public call resolves instantly as "unavailable". Launching later =
 * flipping `master` plus the formats you want, here only.
 */
export const AD_FLAGS: AdFeatureFlags = {
  master: false,
  formats: {
    rewarded: false,
    rewardedInterstitial: false,
    interstitial: false,
    banner: false,
    appOpen: false,
  },
};

// Tests exercise enabled/disabled flows without editing the shipped flags above.
let activeFlags: AdFeatureFlags = AD_FLAGS;

/** A format serves ads only when BOTH the master switch and its own flag are on. */
export function isAdFormatEnabled(format: AdFormat, flags: AdFeatureFlags = activeFlags): boolean {
  return flags.master && flags.formats[format];
}

/** Test-only: override (or with no argument, restore) the active feature flags. */
export function _setAdFlagsForTests(flags: AdFeatureFlags = AD_FLAGS): void {
  activeFlags = flags;
}

/**
 * Google's official demo AdMob App IDs (from the AdMob "demo ad units" docs).
 * Used in dev; production app IDs come from env vars below.
 */
const GOOGLE_TEST_APP_IDS: Record<AdPlatform, string> = {
  android: "ca-app-pub-3940256099942544~3347511713",
  ios: "ca-app-pub-3940256099942544~1458002511",
};

/**
 * Google's official demo ad unit IDs, one per format we may ever use. Adding a new
 * format later = add its row here + its env-var rows in PROD_AD_UNITS; the resolver
 * and service need no changes.
 */
const GOOGLE_TEST_AD_UNITS: Record<AdFormat, Record<AdPlatform, string>> = {
  rewarded: {
    android: "ca-app-pub-3940256099942544/5224354917",
    ios: "ca-app-pub-3940256099942544/1712485313",
  },
  rewardedInterstitial: {
    android: "ca-app-pub-3940256099942544/5354046379",
    ios: "ca-app-pub-3940256099942544/6978759866",
  },
  interstitial: {
    android: "ca-app-pub-3940256099942544/1033173712",
    ios: "ca-app-pub-3940256099942544/4411468910",
  },
  banner: {
    android: "ca-app-pub-3940256099942544/6300978111",
    ios: "ca-app-pub-3940256099942544/2934735716",
  },
  appOpen: {
    android: "ca-app-pub-3940256099942544/9257395921",
    ios: "ca-app-pub-3940256099942544/5575463023",
  },
};

// Each env var must be spelled out literally - `import.meta.env` is statically
// replaced at build time, so dynamic key lookups would silently resolve to
// undefined in a production bundle. Wrapped in try/catch for the same reason as
// analytics.ts: `import.meta.env` doesn't exist under plain Node (test runner).
function env(pick: (e: ImportMetaEnv) => string | undefined): string {
  try {
    return pick(import.meta.env) ?? "";
  } catch {
    return "";
  }
}

const PROD_APP_IDS: Record<AdPlatform, string> = {
  android: env((e) => e.VITE_ADMOB_APP_ID_ANDROID),
  ios: env((e) => e.VITE_ADMOB_APP_ID_IOS),
};

const PROD_AD_UNITS: Record<AdFormat, Record<AdPlatform, string>> = {
  rewarded: {
    android: env((e) => e.VITE_ADMOB_REWARDED_ANDROID),
    ios: env((e) => e.VITE_ADMOB_REWARDED_IOS),
  },
  rewardedInterstitial: {
    android: env((e) => e.VITE_ADMOB_REWARDED_INTERSTITIAL_ANDROID),
    ios: env((e) => e.VITE_ADMOB_REWARDED_INTERSTITIAL_IOS),
  },
  interstitial: {
    android: env((e) => e.VITE_ADMOB_INTERSTITIAL_ANDROID),
    ios: env((e) => e.VITE_ADMOB_INTERSTITIAL_IOS),
  },
  banner: {
    android: env((e) => e.VITE_ADMOB_BANNER_ANDROID),
    ios: env((e) => e.VITE_ADMOB_BANNER_IOS),
  },
  appOpen: {
    android: env((e) => e.VITE_ADMOB_APP_OPEN_ANDROID),
    ios: env((e) => e.VITE_ADMOB_APP_OPEN_IOS),
  },
};

// Same rationale/wrapping as isDevBuild() in analytics.ts: unknown environment is
// treated as dev, so test ad units are the failure-mode default, never real ones.
function isDevBuild(): boolean {
  try {
    return import.meta.env.DEV;
  } catch {
    return true;
  }
}

/** AdMob App ID for SDK initialization - test ID in dev, env-configured in prod. */
export function getAdMobAppId(platform: AdPlatform): string {
  return isDevBuild() ? GOOGLE_TEST_APP_IDS[platform] : PROD_APP_IDS[platform];
}

/**
 * Resolve the ad unit ID for a format+platform. Dev builds always get Google test
 * units; production gets the env-configured ID, or "" when that format isn't
 * configured (callers treat "" as "format unavailable", never as an error).
 */
export function getAdUnitId(format: AdFormat, platform: AdPlatform): string {
  return isDevBuild() ? GOOGLE_TEST_AD_UNITS[format][platform] : PROD_AD_UNITS[format][platform];
}
