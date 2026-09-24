// Adapter factory for the Capacitor community AdMob plugin - the expected SDK
// once CYDI ships as a native app. The plugin is NOT a dependency yet, so the
// plugin object is passed in structurally typed; future wiring is exactly:
//
//   import { AdMob } from "@capacitor-community/admob";
//   import { registerAdAdapter, createAdMobAdapter } from "./services/ads";
//   registerAdAdapter(createAdMobAdapter(AdMob));
//
// ...in native startup code only. The web build never registers an adapter and
// keeps its zero-dependency no-op behavior.

import type { AdAdapter, AdReward } from "./adTypes";
import type { InterstitialAdapter, InterstitialNativeEvent } from "./interstitialAds";

// Minimal structural slice of @capacitor-community/admob's AdMob object - just
// the members this adapter calls, so the real plugin satisfies it when installed.
export type AdMobPluginLike = {
  initialize(options?: { initializeForTesting?: boolean }): Promise<unknown>;
  prepareRewardVideoAd(options: { adId: string }): Promise<unknown>;
  showRewardVideoAd(): Promise<{ type?: string; amount?: number } | undefined>;
};

export function createAdMobAdapter(admob: AdMobPluginLike, options?: { testing?: boolean }): AdAdapter {
  return {
    name: "admob-capacitor",

    async initialize(): Promise<void> {
      await admob.initialize(options?.testing ? { initializeForTesting: true } : undefined);
    },

    async loadRewarded(adUnitId: string): Promise<void> {
      await admob.prepareRewardVideoAd({ adId: adUnitId });
    },

    // The plugin resolves showRewardVideoAd() with the reward item when earned.
    // A missing/zero reward means the user bailed early -> null (dismissed).
    async showRewarded(): Promise<AdReward | null> {
      const item = await admob.showRewardVideoAd();
      if (!item || typeof item.amount !== "number" || item.amount <= 0) return null;
      return { type: item.type ?? "reward", amount: item.amount };
    },
  };
}

// --- Interstitial --------------------------------------------------------------------
//
// A SEPARATE adapter for a separate format, deliberately not new members on the
// rewarded one above: the rewarded adapter and everything that calls it stay exactly
// as they were. Wired only by nativeAdsSetup.ts, after the SDK is initialized.

/** The plugin's InterstitialAdPluginEvents values (spelled out: that enum is not importable under plain-Node tests). */
export const INTERSTITIAL_PLUGIN_EVENTS = {
  loaded: "interstitialAdLoaded",
  failedToLoad: "interstitialAdFailedToLoad",
  showed: "interstitialAdShowed",
  failedToShow: "interstitialAdFailedToShow",
  dismissed: "interstitialAdDismissed",
} as const;

export type AdMobInterstitialPluginLike = {
  prepareInterstitial(options: { adId: string }): Promise<unknown>;
  showInterstitial(): Promise<void>;
  addListener(eventName: string, listener: (info: unknown) => void): Promise<unknown>;
};

/**
 * How long a rejected prepareInterstitial() waits for the FailedToLoad event that
 * carries the numeric code. The plugin posts the event and then the rejection (see
 * InterstitialAdCallbackAndListeners.kt), so this is normally already settled.
 */
const LOAD_CODE_GRACE_MS = 300;

function errorCode(info: unknown): number | undefined {
  const code = (info as { code?: unknown } | null)?.code;
  return typeof code === "number" && Number.isInteger(code) ? code : undefined;
}

export function createAdMobInterstitialAdapter(admob: AdMobInterstitialPluginLike): InterstitialAdapter {
  let listener: (event: InterstitialNativeEvent) => void = () => {};
  let pendingLoad: { resolve: () => void; reject: (err: { code?: number }) => void } | null = null;

  const settleLoad = (outcome: { ok: true } | { ok: false; code?: number }) => {
    const pending = pendingLoad;
    if (!pending) return;
    pendingLoad = null;
    if (outcome.ok) pending.resolve();
    else pending.reject({ code: outcome.code });
  };

  // FailedToLoad is the only place the numeric Google Mobile Ads code surfaces. The
  // plugin also fires it (code -1) when showInterstitial() finds nothing prepared;
  // with no load pending that one is simply ignored here.
  void admob.addListener(INTERSTITIAL_PLUGIN_EVENTS.failedToLoad, (info) => settleLoad({ ok: false, code: errorCode(info) }));
  void admob.addListener(INTERSTITIAL_PLUGIN_EVENTS.showed, () => listener({ type: "showed" }));
  void admob.addListener(INTERSTITIAL_PLUGIN_EVENTS.failedToShow, (info) => listener({ type: "failedToShow", code: errorCode(info) }));
  void admob.addListener(INTERSTITIAL_PLUGIN_EVENTS.dismissed, () => listener({ type: "dismissed" }));

  return {
    name: "admob-capacitor-interstitial",

    load(adUnitId) {
      return new Promise<void>((resolve, reject) => {
        pendingLoad = { resolve, reject };
        admob.prepareInterstitial({ adId: adUnitId }).then(
          () => settleLoad({ ok: true }),
          () => setTimeout(() => settleLoad({ ok: false }), LOAD_CODE_GRACE_MS),
        );
      });
    },

    show() {
      return admob.showInterstitial();
    },

    setListener(next) {
      listener = next;
    },
  };
}
