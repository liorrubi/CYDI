/// <reference types="vite/client" />

/** Short git commit hash (or a build timestamp fallback) injected by vite.config.ts at build time. */
declare const __APP_BUILD__: string;
/** ISO timestamp of when this build was produced, injected by vite.config.ts at build time. */
declare const __APP_BUILD_TIME__: string;

/**
 * AdMob production IDs, read ONLY by src/services/ads/adConfig.ts. Set them in an
 * untracked `.env.production.local` (or CI) - never committed. All optional: a
 * missing var just means that ad format is unconfigured/disabled in production.
 */
interface ImportMetaEnv {
  readonly VITE_ADMOB_APP_ID_ANDROID?: string;
  readonly VITE_ADMOB_APP_ID_IOS?: string;
  readonly VITE_ADMOB_REWARDED_ANDROID?: string;
  readonly VITE_ADMOB_REWARDED_IOS?: string;
  readonly VITE_ADMOB_REWARDED_INTERSTITIAL_ANDROID?: string;
  readonly VITE_ADMOB_REWARDED_INTERSTITIAL_IOS?: string;
  readonly VITE_ADMOB_INTERSTITIAL_ANDROID?: string;
  readonly VITE_ADMOB_INTERSTITIAL_IOS?: string;
  readonly VITE_ADMOB_BANNER_ANDROID?: string;
  readonly VITE_ADMOB_BANNER_IOS?: string;
  readonly VITE_ADMOB_APP_OPEN_ANDROID?: string;
  readonly VITE_ADMOB_APP_OPEN_IOS?: string;
}
