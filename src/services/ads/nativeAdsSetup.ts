// Native-only bootstrap for the ad system. Fail-closed and strictly ordered so
// NOTHING ad-related happens before consent is confirmed:
//   1. Web build -> return immediately, before even importing the AdMob SDK. This
//      is what guarantees zero ad requests (and zero SDK bytes ever executed) on
//      the web build.
//   2. Run UMP consent (consent.ts). Register the live consent gate regardless of
//      the result - wiring the gate is not itself an ad request.
//   3. Only if consent says canRequestAds === true: initialize the AdMob SDK and
//      register the adapter. If consent is not sufficient, stop here - no SDK
//      init, no adapter, no preload, no ad request. (A later consent grant via
//      Settings' privacy-options button updates the gate for future requests, but
//      does not retroactively initialize the SDK mid-session - relaunching the app
//      re-runs this sequence, which is standard AdMob/UMP integration practice.)
//
// Never throws: any failure here (plugin missing, consent flow exception, SDK
// init exception) must leave the game exactly as if this module were never
// called - the ad service already treats "no adapter" as a normal "unavailable".

import { Capacitor } from "@capacitor/core";
import { createAdMobAdapter } from "./admobAdapter";
import { isAdTestingEnvironment } from "./adConfig";
import { registerAdAdapter, registerAdConsentGate } from "./rewardedAds";
import { getConsentState, initializeConsent } from "./consent";

export async function initializeNativeAds(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const { AdMob } = await import("@capacitor-community/admob");

    const consentState = await initializeConsent(AdMob);
    registerAdConsentGate(() => getConsentState().canRequestAds);

    if (!consentState.canRequestAds) return;

    const testing = isAdTestingEnvironment();
    await AdMob.initialize({ initializeForTesting: testing });
    registerAdAdapter(createAdMobAdapter(AdMob, { testing }));
  } catch {
    // No adapter ends up registered; every rewarded-ad call resolves "unavailable"
    // and the math-exercise fallback in DoubleCoinsOffer is unaffected.
  }
}
