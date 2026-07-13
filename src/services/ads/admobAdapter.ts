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

// Minimal structural slice of @capacitor-community/admob's AdMob object - just
// the members this adapter calls, so the real plugin satisfies it when installed.
export type AdMobPluginLike = {
  initialize(options?: { initializeForTesting?: boolean }): Promise<unknown>;
  prepareRewardVideoAd(options: { adId: string }): Promise<unknown>;
  showRewardVideoAd(): Promise<{ type?: string; amount?: number } | undefined>;
};

export function createAdMobAdapter(admob: AdMobPluginLike): AdAdapter {
  return {
    name: "admob-capacitor",

    async initialize(): Promise<void> {
      await admob.initialize();
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
