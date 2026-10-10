// Client side of the 0.59.0 coin-offer remote flags. Rides the existing `GET /api/config/ads/interstitial?v=3`
// answer as its own top-level `coin` key (no extra request), exactly like the Ink Trial config.
//
// FAIL-CLOSED: before any answer, after a 404, or with a missing/invalid `coin`, every switch is OFF - the Classic
// coin offer is the 0.58 "x3" for everyone; Category "Unlock Now" and the Streak Rescue never appear. LIVE: the latest
// answer applies.

import { isQaBuild } from "../analyticsIdentity";
import { observeConfigBody } from "./interstitialConfig";
import { parseClientCoinOfferConfig, type CoinOfferConfig } from "./coinOfferConfigSchema";

let liveConfig: CoinOfferConfig | null = null;

/** Feeds this module from the v3 config answers. Called once at native startup, next to the Ink Trial observer. */
export function installCoinOfferConfigObserver(): void {
  observeConfigBody((body) => {
    const coin = body !== null && typeof body === "object" ? (body as Record<string, unknown>).coin : undefined;
    liveConfig = parseClientCoinOfferConfig(coin);
  });
}

export const COIN_OFFER_QA_OVERRIDE_KEY = "cydi.qa.coinOfferConfig.v1";

function isDevBuild(): boolean {
  try {
    return import.meta.env.DEV === true;
  } catch {
    return false;
  }
}

/** Debuggable APK / dev server only: a JSON value under COIN_OFFER_QA_OVERRIDE_KEY replaces the answer. Malformed = OFF. */
function readQaOverride(): CoinOfferConfig | null | undefined {
  if (!isQaBuild() && !isDevBuild()) return undefined;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(COIN_OFFER_QA_OVERRIDE_KEY);
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;
  try {
    return parseClientCoinOfferConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

function currentConfig(): CoinOfferConfig | null {
  const qa = readQaOverride();
  return qa !== undefined ? qa : liveConfig;
}

export const RUN_ARM_QA_OVERRIDE_KEY = "cydi.qa.rewardedRunArm.v1";

/**
 * Debuggable APK / dev server only: force this device's Classic arm ("x3" or "x3run") so QA can see both A/B arms on
 * one phone. Null in every Play build, and whenever the key is absent or holds anything else.
 */
export function qaForcedRunArm(): "x3" | "x3run" | null {
  if (!isQaBuild() && !isDevBuild()) return null;
  try {
    const v = localStorage.getItem(RUN_ARM_QA_OVERRIDE_KEY);
    return v === "x3" || v === "x3run" ? v : null;
  } catch {
    return null;
  }
}

/** Is the Classic coin-offer A/B (x3 vs x3run) running? */
export function isRunX3ExperimentOn(): boolean {
  return currentConfig()?.runX3 === true;
}

/** May Category "Unlock Now" be offered? (Platform, ad readiness and the daily limit are checked by the caller.) */
export function isUnlockNowOn(): boolean {
  return currentConfig()?.unlockNow === true;
}

/** May the Rewarded Streak Rescue be offered? (Platform, ad readiness and the rescue rules are checked by the caller.) */
export function isStreakRescueOn(): boolean {
  return currentConfig()?.streakRescue === true;
}

export function _resetCoinOfferConfigForTests(config: CoinOfferConfig | null = null): void {
  liveConfig = config;
}
