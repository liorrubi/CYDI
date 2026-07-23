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
  /**
   * Internal-testing-track override: forces Google's official test app/ad-unit IDs
   * (and the "rewarded" format on) even in a release build, so an internal test AAB
   * can exercise the real ad flow without ever requesting a live ad. Must be the
   * literal string "true" - anything else (including unset) is production behavior.
   * Only ever passed inline on the one-off command that builds the internal-test
   * AAB's web assets (e.g. `VITE_ADS_INTERNAL_TEST_MODE=true npm run build`) -
   * NEVER set in any committed `.env*` file, CI default, or the web/production
   * Android build.
   */
  readonly VITE_ADS_INTERNAL_TEST_MODE?: string;
}
