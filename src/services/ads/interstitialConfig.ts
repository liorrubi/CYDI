// Client side of GET /api/config/ads/interstitial - the interstitial experiment's
// remote controls. Fail-closed like remoteKillSwitch.ts, with one difference that
// is the point of the design:
//
//   - rolloutPercent, gamesBetweenAds, maxOpportunitiesPerSession and countryEligible
//     are FROZEN for the app run at the first successful fetch. A mid-run change
//     cannot move an installation between arms or reshape a cadence in progress.
//   - `enabled` stays LIVE: every later successful refresh overrides it. That is the
//     interstitial-only emergency switch - flipping it off stops preloads and shows
//     on running apps without touching the global ads/rewarded switch.
//
// What counts as an answer: a 200 with a valid body, a 404 ("nothing published" ->
// off), or a 200 with a malformed body (-> off). A network error, timeout or 5xx is
// NOT an answer, so it leaves the last answer in place; before any answer at all the
// experiment is simply off.

import { apiFetch, type ApiResponse } from "../nativeApi";
import { isQaBuild } from "../analyticsIdentity";
import { isInterstitialArm, isValidInterstitialClientConfig, type InterstitialArm, type InterstitialClientConfig } from "./interstitialConfigSchema";

export const INTERSTITIAL_CONFIG_PATH = "/api/config/ads/interstitial";
const FETCH_TIMEOUT_MS = 5000;
/** Resume refreshes are throttled; the emergency switch reaching a running app within ~10 minutes is enough. */
const RESUME_REFRESH_MIN_INTERVAL_MS = 10 * 60 * 1000;

/** The run's frozen values. `enabled` is deliberately absent - read it through isInterstitialLiveEnabled(). */
export type FrozenInterstitialConfig = Omit<InterstitialClientConfig, "enabled">;

let frozen: FrozenInterstitialConfig | null = null;
let liveEnabled = false;
let lastRefreshAt = -Infinity;
let qaForcedArm: InterstitialArm | null = null;

type Fetcher = (path: string, init: { timeoutMs: number }) => Promise<ApiResponse>;
let fetcher: Fetcher = apiFetch;

export function getFrozenInterstitialConfig(): FrozenInterstitialConfig | null {
  return frozen;
}

export function isInterstitialLiveEnabled(): boolean {
  return frozen !== null && liveEnabled;
}

/** Debug builds only (see readQaOverride). Always null in a Play build. */
export function getQaForcedArm(): InterstitialArm | null {
  return qaForcedArm;
}

function applyAnswer(config: InterstitialClientConfig | null): void {
  if (config === null) {
    liveEnabled = false;
    return;
  }
  // First answer freezes the run; later ones only move `enabled`.
  frozen ??= {
    rolloutPercent: config.rolloutPercent,
    gamesBetweenAds: config.gamesBetweenAds,
    maxOpportunitiesPerSession: config.maxOpportunitiesPerSession,
    countryEligible: config.countryEligible,
  };
  liveEnabled = config.enabled;
}

// --- Stage-0 QA override -------------------------------------------------------------

export const INTERSTITIAL_QA_OVERRIDE_KEY = "cydi.qa.interstitialConfig.v1";

/**
 * Stage-0 needs to exercise the experiment before the endpoint exists in production
 * (it is not deployed) and to flip `enabled`, cadence and arm by hand. A JSON value
 * under INTERSTITIAL_QA_OVERRIDE_KEY replaces the network answer - but ONLY when
 * isQaBuild(), i.e. `window.Capacitor.DEBUG === true`, which Capacitor derives from
 * the APK's own android:debuggable. Google Play refuses debuggable artifacts, and a
 * locally built release APK reports false too, so a shipped build can never honour it.
 *
 * Shape: the normal client config, plus an optional `qaForceArm` ("control" |
 * "treatment"). Anything malformed is treated as "off", never as "use the network".
 */
function readQaOverride(): { config: InterstitialClientConfig | null; arm: InterstitialArm | null } | undefined {
  if (!isQaBuild()) return undefined;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(INTERSTITIAL_QA_OVERRIDE_KEY);
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const { qaForceArm, ...rest } = parsed ?? {};
    const arm = isInterstitialArm(qaForceArm) ? qaForceArm : null;
    return { config: isValidInterstitialClientConfig(rest) ? rest : null, arm };
  } catch {
    return { config: null, arm: null };
  }
}

// --- Refresh -------------------------------------------------------------------------

/** Never throws. Returns whether an answer (see header) was received. */
export async function refreshInterstitialConfig(now: number = Date.now()): Promise<boolean> {
  lastRefreshAt = now;
  const qa = readQaOverride();
  if (qa !== undefined) {
    qaForcedArm = qa.arm;
    applyAnswer(qa.config);
    return true;
  }
  try {
    const response = await fetcher(INTERSTITIAL_CONFIG_PATH, { timeoutMs: FETCH_TIMEOUT_MS });
    if (response.status === 404) {
      applyAnswer(null);
      return true;
    }
    if (!response.ok) return false;
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    applyAnswer(isValidInterstitialClientConfig(body) ? body : null);
    return true;
  } catch {
    return false;
  }
}

/** For app resume: at most one refresh per RESUME_REFRESH_MIN_INTERVAL_MS. */
export function refreshInterstitialConfigIfStale(now: number = Date.now()): Promise<boolean> | null {
  if (now - lastRefreshAt < RESUME_REFRESH_MIN_INTERVAL_MS) return null;
  return refreshInterstitialConfig(now);
}

export function _resetInterstitialConfigForTests(testFetcher?: Fetcher): void {
  frozen = null;
  liveEnabled = false;
  lastRefreshAt = -Infinity;
  qaForcedArm = null;
  fetcher = testFetcher ?? apiFetch;
}
