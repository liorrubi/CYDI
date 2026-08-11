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

export async function initializeNativeAds(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const { AdMob, MaxAdContentRating } = await import("@capacitor-community/admob");

    const [consentState] = await Promise.all([initializeConsent(AdMob), refreshRemoteAdsKillSwitch()]);
    registerAdConsentGate(() => getConsentState().canRequestAds);
    registerRemoteAdsGate(isRemoteAdsEnabled);

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
  } catch {
    // No adapter ends up registered; every rewarded-ad call resolves "unavailable"
    // and the math-exercise fallback in DoubleCoinsOffer is unaffected.
  }
}
