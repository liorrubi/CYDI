// The AdMob interstitial adapter against a fake plugin: the numeric GMA code from
// FailedToLoad is what reaches classification (never the message), lifecycle
// callbacks are forwarded 1:1, and the rewarded adapter is a separate object.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { INTERSTITIAL_PLUGIN_EVENTS, createAdMobAdapter, createAdMobInterstitialAdapter } from "./admobAdapter";
import { classifyInterstitialLoadError, type InterstitialNativeEvent } from "./interstitialAds";

function fakePlugin() {
  const listeners = new Map<string, (info: unknown) => void>();
  let prepare: { resolve: () => void; reject: (e: unknown) => void } | null = null;
  const plugin = {
    prepareInterstitial: () =>
      new Promise<unknown>((resolve, reject) => {
        prepare = { resolve: () => resolve({ adUnitId: "x" }), reject };
      }),
    showInterstitial: async () => {},
    addListener: async (eventName: string, listener: (info: unknown) => void) => {
      listeners.set(eventName, listener);
      return { remove: async () => {} };
    },
  };
  return {
    plugin,
    emit: (eventName: string, info?: unknown) => listeners.get(eventName)?.(info),
    resolvePrepare: () => prepare?.resolve(),
    rejectPrepare: (message: string) => prepare?.reject(new Error(message)),
  };
}

test("a failed load rejects with the numeric code from FailedToLoad, not the message", async () => {
  const fake = fakePlugin();
  const adapter = createAdMobInterstitialAdapter(fake.plugin);
  const load = adapter.load("unit");
  fake.emit(INTERSTITIAL_PLUGIN_EVENTS.failedToLoad, { code: 3, message: "No fill." });
  fake.rejectPrepare("No fill.");
  const err = await load.then(() => null, (e) => e);
  assert.deepEqual(err, { code: 3 });
  assert.equal(classifyInterstitialLoadError(err), "no_fill");
});

test("a rejection with no FailedToLoad event still settles, as sdk_error", async () => {
  const fake = fakePlugin();
  const adapter = createAdMobInterstitialAdapter(fake.plugin);
  const load = adapter.load("unit");
  fake.rejectPrepare("something");
  const err = await load.then(() => null, (e) => e);
  assert.deepEqual(err, { code: undefined });
  assert.equal(classifyInterstitialLoadError(err), "sdk_error");
});

test("a successful prepare resolves the load", async () => {
  const fake = fakePlugin();
  const adapter = createAdMobInterstitialAdapter(fake.plugin);
  const load = adapter.load("unit");
  fake.resolvePrepare();
  await load;
});

test("the plugin's show-without-ad FailedToLoad(-1) is ignored when no load is pending", () => {
  const fake = fakePlugin();
  createAdMobInterstitialAdapter(fake.plugin);
  assert.doesNotThrow(() => fake.emit(INTERSTITIAL_PLUGIN_EVENTS.failedToLoad, { code: -1 }));
});

test("Showed / FailedToShow / Dismissed are forwarded 1:1 with the numeric code", () => {
  const fake = fakePlugin();
  const adapter = createAdMobInterstitialAdapter(fake.plugin);
  const seen: InterstitialNativeEvent[] = [];
  adapter.setListener((e) => seen.push(e));
  fake.emit(INTERSTITIAL_PLUGIN_EVENTS.showed);
  fake.emit(INTERSTITIAL_PLUGIN_EVENTS.failedToShow, { code: 2, message: "not ready" });
  fake.emit(INTERSTITIAL_PLUGIN_EVENTS.dismissed);
  assert.deepEqual(seen, [{ type: "showed" }, { type: "failedToShow", code: 2 }, { type: "dismissed" }]);
});

test("the event names match @capacitor-community/admob's InterstitialAdPluginEvents", async () => {
  const { InterstitialAdPluginEvents } = await import("../../../node_modules/@capacitor-community/admob/dist/esm/interstitial/interstitial-ad-plugin-events.enum.js");
  assert.equal(INTERSTITIAL_PLUGIN_EVENTS.loaded, InterstitialAdPluginEvents.Loaded);
  assert.equal(INTERSTITIAL_PLUGIN_EVENTS.failedToLoad, InterstitialAdPluginEvents.FailedToLoad);
  assert.equal(INTERSTITIAL_PLUGIN_EVENTS.showed, InterstitialAdPluginEvents.Showed);
  assert.equal(INTERSTITIAL_PLUGIN_EVENTS.failedToShow, InterstitialAdPluginEvents.FailedToShow);
  assert.equal(INTERSTITIAL_PLUGIN_EVENTS.dismissed, InterstitialAdPluginEvents.Dismissed);
});

test("the rewarded adapter is a separate object with its unchanged shape", () => {
  const rewarded = createAdMobAdapter({
    initialize: async () => undefined,
    prepareRewardVideoAd: async () => undefined,
    showRewardVideoAd: async () => ({ type: "coins", amount: 1 }),
  });
  assert.deepEqual(Object.keys(rewarded).sort(), ["initialize", "loadRewarded", "name", "showRewarded"]);
  assert.equal(rewarded.name, "admob-capacitor");
});
