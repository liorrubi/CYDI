// Native-only bootstrap for the ad system. Fail-closed and strictly ordered so
// NOTHING ad-related happens before consent AND the remote kill switch both clear:
//   1. Web build -> return immediately, before even importing the AdMob SDK. This
//      is what guarantees zero ad requests (and zero SDK bytes ever executed) on
//      the web build.
//   2. Run UMP consent (consent.ts) and fetch the remote kill switch
//      (remoteKillSwitch.ts) in parallel - independent checks, same "every app
//      open" cadence. Register both live gates regardless of the result - wiring
//      a gate is not itself an ad request.
//   3. Only if consent says canRequestAds === true AND the remote flag says
//      enabled === true: initialize the AdMob SDK and register the adapter.
//      Otherwise stop here - no SDK init, no adapter, no preload, no ad request.
//      (A later consent grant via Settings' privacy-options button, or a later
//      remote-flag flip, updates its gate for future requests, but neither
//      retroactively initializes the SDK mid-session - relaunching the app
//      re-runs this whole sequence.)
//
// The interstitial experiment rides the same sequence without changing any of it:
// its config comes from its OWN endpoint (/api/config/ads/interstitial), fetched in
// parallel and never awaited, so a slow or missing interstitial config cannot delay
// or alter the rewarded path. Its gates are registered next to the rewarded ones and
// include the SAME consent and global remote switch, plus its own live `enabled`.
// Its adapter is registered only where the rewarded one is - after consent, the
// global switch and SDK init have all cleared.
//
// Never throws: any failure here (plugin missing, consent flow exception, remote
// fetch failure, SDK init exception) must leave the game exactly as if this
// module were never called - the ad service already treats "no adapter" as a
// normal "unavailable".

import { Capacitor } from "@capacitor/core";
import { createAdMobAdapter } from "./admobAdapter";
import { isAdTestingEnvironment } from "./adConfig";
import { registerAdAdapter, registerAdConsentGate, registerRemoteAdsGate } from "./rewardedAds";
import { getConsentState, initializeConsent } from "./consent";
import { isRemoteAdsEnabled, refreshRemoteAdsKillSwitch } from "./remoteKillSwitch";
import { createAdMobInterstitialAdapter } from "./admobAdapter";
import { registerInterstitialAdapter, registerInterstitialGates, getInterstitialDebugInfo } from "./interstitialAds";
import {
  INTERSTITIAL_QA_OVERRIDE_KEY,
  isInterstitialLiveEnabled,
  refreshInterstitialConfig,
  refreshInterstitialConfigIfStale,
} from "./interstitialConfig";
import { getInterstitialControllerDebugInfo } from "./interstitialController";
import { isQaBuild } from "../analyticsIdentity";

let interstitialResumeHookInstalled = false;

/** Re-reads the interstitial config (throttled) whenever the app returns to the foreground, so its emergency switch reaches running apps. */
function installInterstitialResumeRefresh(): void {
  if (interstitialResumeHookInstalled) return;
  interstitialResumeHookInstalled = true;
  try {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void refreshInterstitialConfigIfStale();
    });
  } catch {
    // no document - nothing to hook
  }
}

/**
 * Stage-0 QA console hook, installed ONLY on a debuggable build (Capacitor.DEBUG, see
 * isQaBuild): `cydiInterstitialQa.info()` shows assignment, cadence, marker and ad
 * state (including the measured Showed latency); `.setOverride({...})` /
 * `.setOverride(null)` writes or clears the QA config override and refreshes.
 */
function installInterstitialQaHook(): void {
  if (!isQaBuild()) return;
  try {
    (window as unknown as Record<string, unknown>).cydiInterstitialQa = {
      info: () => ({ ...getInterstitialControllerDebugInfo(), ad: getInterstitialDebugInfo(), liveEnabled: isInterstitialLiveEnabled() }),
      setOverride: async (value: unknown) => {
        if (value === null) localStorage.removeItem(INTERSTITIAL_QA_OVERRIDE_KEY);
        else localStorage.setItem(INTERSTITIAL_QA_OVERRIDE_KEY, JSON.stringify(value));
        await refreshInterstitialConfig();
        return isInterstitialLiveEnabled();
      },
      refresh: () => refreshInterstitialConfig(),
    };
  } catch {
    // no window
  }
}

export async function initializeNativeAds(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  void refreshInterstitialConfig();
  installInterstitialResumeRefresh();
  installInterstitialQaHook();

  try {
    const { AdMob, MaxAdContentRating } = await import("@capacitor-community/admob");

    const [consentState] = await Promise.all([initializeConsent(AdMob), refreshRemoteAdsKillSwitch()]);
    registerAdConsentGate(() => getConsentState().canRequestAds);
    registerRemoteAdsGate(isRemoteAdsEnabled);
    registerInterstitialGates({
      consent: () => getConsentState().canRequestAds,
      remoteAds: isRemoteAdsEnabled,
      interstitialEnabled: isInterstitialLiveEnabled,
    });

    if (!consentState.canRequestAds) return;
    if (!isRemoteAdsEnabled()) return;

    const testing = isAdTestingEnvironment();
    // CYDI is a 13+ title on Google Play with no in-app age gate, so ad content is
    // capped at Teen. The newer AgeRestrictedTreatment.TEEN would be the stricter
    // signal, but it only exists in Google Mobile Ads SDK 25.x while this plugin
    // pins 24.9.+, and it isn't worth a major SDK upgrade plus a native override of
    // the plugin on its own. The deprecated TFCD/TFUA tags are deliberately not used.
    await AdMob.initialize({ initializeForTesting: testing, maxAdContentRating: MaxAdContentRating.Teen });
    registerAdAdapter(createAdMobAdapter(AdMob, { testing }));
    registerInterstitialAdapter(createAdMobInterstitialAdapter(AdMob));
  } catch {
    // No adapter ends up registered; every rewarded-ad call resolves "unavailable",
    // so DoubleCoinsOffer shows its "ads aren't available right now" note and grants
    // nothing beyond the coins the player already earned.
  }
}
