// Proves the contracts of the ad system: feature flags gate everything, the
// placement list is closed, lifecycle events feed analytics with schema-valid
// params only, rewards are granted only on an SDK-verified reward event, and
// every failure mode (disabled, missing SDK, exception, timeout) resolves
// instantly and safely - gameplay can never hang or crash on ads. Runs under
// plain Node (import.meta.env absent), which is itself part of the contract.

import { strict as assert } from "node:assert";
import { test, beforeEach, afterEach } from "node:test";

import {
  _resetRewardedAdsForTests,
  _setAdTimeoutsForTests,
  isRewardedAdAvailable,
  isRewardedAdReady,
  preloadRewardedAd,
  registerAdAdapter,
  registerAdConsentGate,
  showRewardedAd,
  subscribeRewardedAdEvents,
} from "./rewardedAds";
import { AD_FLAGS, _setAdFlagsForTests, getAdUnitId, isAdFormatEnabled, type AdFeatureFlags } from "./adConfig";
import { REWARDED_AD_PLACEMENTS, isRewardedAdPlacement, type RewardedAdPlacement } from "./adPlacements";
import type { AdFormat, AdReward, RewardedAdLifecycleEvent } from "./adTypes";
import { connectAdAnalytics, mapLifecycleToAnalytics } from "./adAnalytics";
import { createAdMobAdapter } from "./admobAdapter";
import { validateEventParams, type AnalyticsEventName } from "../analyticsSchema";

const ALL_FORMATS: AdFormat[] = ["rewarded", "rewardedInterstitial", "interstitial", "banner", "appOpen"];
const PLACEMENT: RewardedAdPlacement = "daily_retry";

function flags(master: boolean, rewarded: boolean): AdFeatureFlags {
  return {
    master,
    formats: { rewarded, rewardedInterstitial: false, interstitial: false, banner: false, appOpen: false },
  };
}

function makeSpyAdapter(showResult: () => Promise<AdReward | null>) {
  const calls: string[] = [];
  registerAdAdapter({
    name: "spy",
    initialize: async () => {
      calls.push("initialize");
    },
    loadRewarded: async (adUnitId: string) => {
      calls.push(`load:${adUnitId}`);
    },
    showRewarded: () => {
      calls.push("show");
      return showResult();
    },
  });
  return { calls };
}

function recordEvents(): RewardedAdLifecycleEvent[] {
  const events: RewardedAdLifecycleEvent[] = [];
  subscribeRewardedAdEvents("test-recorder", (event) => events.push(event));
  return events;
}

beforeEach(() => {
  _resetRewardedAdsForTests();
});

afterEach(() => {
  _setAdFlagsForTests(); // restore the shipped (all-false) flags
});

// --- Feature flags ---------------------------------------------------------------

test("shipped flags are all off - ads are prepared but not enabled", () => {
  assert.equal(AD_FLAGS.master, false);
  for (const format of ALL_FORMATS) {
    assert.equal(AD_FLAGS.formats[format], false);
    assert.equal(isAdFormatEnabled(format), false);
  }
});

test("master flag off disables every format even when the format flag is on", () => {
  const allOn: AdFeatureFlags = {
    master: false,
    formats: { rewarded: true, rewardedInterstitial: true, interstitial: true, banner: true, appOpen: true },
  };
  for (const format of ALL_FORMATS) assert.equal(isAdFormatEnabled(format, allOn), false);
});

test("a format serves only when master AND its own flag are on", () => {
  assert.equal(isAdFormatEnabled("rewarded", flags(true, false)), false);
  assert.equal(isAdFormatEnabled("rewarded", flags(true, true)), true);
  assert.equal(isAdFormatEnabled("interstitial", flags(true, true)), false);
});

test("rewarded flag off blocks rewarded ads in the service, with no SDK calls", async () => {
  _setAdFlagsForTests(flags(true, false));
  const spy = makeSpyAdapter(async () => null);
  assert.equal(isRewardedAdAvailable(), false);
  await preloadRewardedAd(PLACEMENT);
  assert.deepEqual(await showRewardedAd(PLACEMENT), { status: "unavailable", reason: "ads_disabled" });
  assert.deepEqual(spy.calls, [], "no adapter method may run while the format is disabled");
});

test("with shipped flags (all off) nothing reaches the SDK", async () => {
  const spy = makeSpyAdapter(async () => ({ type: "coins", amount: 5 }));
  await preloadRewardedAd(PLACEMENT);
  const result = await showRewardedAd(PLACEMENT);
  assert.equal(result.status, "unavailable");
  assert.deepEqual(spy.calls, []);
});

// --- Placements -------------------------------------------------------------------

test("placements are a closed list", () => {
  for (const placement of REWARDED_AD_PLACEMENTS) assert.equal(isRewardedAdPlacement(placement), true);
  assert.equal(isRewardedAdPlacement("free_text_placement"), false);
  assert.equal(isRewardedAdPlacement(""), false);
  assert.equal(isRewardedAdPlacement(42), false);
});

test("an unknown placement is rejected safely with no SDK calls and no events", async () => {
  _setAdFlagsForTests(flags(true, true));
  const spy = makeSpyAdapter(async () => ({ type: "coins", amount: 1 }));
  const events = recordEvents();
  const result = await showRewardedAd("not_a_real_placement" as RewardedAdPlacement);
  assert.deepEqual(result, { status: "unavailable", reason: "invalid_placement" });
  await preloadRewardedAd("nope" as RewardedAdPlacement);
  assert.deepEqual(spy.calls, []);
  assert.deepEqual(events, []);
});

// --- Fail-safe availability --------------------------------------------------------

test("no adapter registered: everything resolves instantly as unavailable", async () => {
  _setAdFlagsForTests(flags(true, true));
  assert.equal(isRewardedAdAvailable(), false);
  assert.equal(isRewardedAdReady(), false);
  await preloadRewardedAd(PLACEMENT); // must not throw
  assert.deepEqual(await showRewardedAd(PLACEMENT), { status: "unavailable", reason: "no_adapter" });
});

// --- Consent gate (fail-closed) ----------------------------------------------------

test("consent gate blocking is checked before the adapter, with no SDK calls", async () => {
  _setAdFlagsForTests(flags(true, true));
  registerAdConsentGate(() => false);
  const spy = makeSpyAdapter(async () => ({ type: "coins", amount: 5 }));
  assert.equal(isRewardedAdAvailable(), false);
  assert.deepEqual(await showRewardedAd(PLACEMENT), { status: "unavailable", reason: "consent_blocked" });
  assert.deepEqual(spy.calls, [], "no adapter method may run while consent blocks ad requests");
});

test("consent gate allowing lets the normal flow proceed", async () => {
  _setAdFlagsForTests(flags(true, true));
  registerAdConsentGate(() => true);
  makeSpyAdapter(async () => ({ type: "coins", amount: 5 }));
  assert.deepEqual(await showRewardedAd(PLACEMENT), { status: "rewarded", reward: { type: "coins", amount: 5 } });
});

test("the consent gate resets to allowed between tests (pre-consent test suite compatibility)", async () => {
  // The previous test registered a blocking gate; _resetRewardedAdsForTests() (beforeEach)
  // must have restored the default "allowed" gate, or this would still be blocked.
  _setAdFlagsForTests(flags(true, true));
  makeSpyAdapter(async () => ({ type: "coins", amount: 1 }));
  assert.equal((await showRewardedAd(PLACEMENT)).status, "rewarded");
});

// --- Full flow, lifecycle events, and rewards ---------------------------------------

test("happy path: lifecycle events in order, reward granted only from SDK reward", async () => {
  _setAdFlagsForTests(flags(true, true));
  makeSpyAdapter(async () => ({ type: "coins", amount: 5 }));
  const events = recordEvents();
  const result = await showRewardedAd(PLACEMENT);
  assert.deepEqual(result, { status: "rewarded", reward: { type: "coins", amount: 5 } });
  assert.deepEqual(events, ["requested", "loading", "loaded", "shown", "rewarded"]);
});

test("early dismiss yields dismissed - never a reward, never a completed event", async () => {
  _setAdFlagsForTests(flags(true, true));
  makeSpyAdapter(async () => null); // SDK resolved without a reward item
  const events = recordEvents();
  const result = await showRewardedAd(PLACEMENT);
  assert.deepEqual(result, { status: "dismissed" });
  assert.ok(events.includes("dismissed"));
  assert.ok(!events.includes("rewarded"));
});

test("per-call onEvent callback is optional and receives the same lifecycle", async () => {
  _setAdFlagsForTests(flags(true, true));
  makeSpyAdapter(async () => null);
  const seen: RewardedAdLifecycleEvent[] = [];
  await showRewardedAd(PLACEMENT, (event, detail) => {
    seen.push(event);
    assert.equal(detail.placement, PLACEMENT);
  });
  assert.deepEqual(seen, ["requested", "loading", "loaded", "shown", "dismissed"]);
});

test("a throwing lifecycle listener never breaks the ad flow", async () => {
  _setAdFlagsForTests(flags(true, true));
  makeSpyAdapter(async () => ({ type: "coins", amount: 1 }));
  subscribeRewardedAdEvents("broken", () => {
    throw new Error("observer bug");
  });
  const result = await showRewardedAd(PLACEMENT);
  assert.equal(result.status, "rewarded");
});

// --- SDK failures and timeouts -------------------------------------------------------

test("SDK exception during show resolves as a safe error result", async () => {
  _setAdFlagsForTests(flags(true, true));
  makeSpyAdapter(async () => {
    throw new Error("internal SDK detail that must not leak");
  });
  const events = recordEvents();
  const result = await showRewardedAd(PLACEMENT);
  assert.deepEqual(result, { status: "error", reason: "sdk_error" });
  assert.ok(events.includes("error"));
});

test("a hung SDK load resolves as unavailable via timeout, never hangs the game", async () => {
  _setAdFlagsForTests(flags(true, true));
  _setAdTimeoutsForTests(30, 30);
  registerAdAdapter({
    name: "hung",
    initialize: async () => undefined,
    loadRewarded: () => new Promise(() => {}), // never resolves
    showRewarded: async () => null,
  });
  const result = await showRewardedAd(PLACEMENT);
  assert.deepEqual(result, { status: "unavailable", reason: "timeout" });
});

test("a hung SDK show resolves as a timeout error, never hangs the game", async () => {
  _setAdFlagsForTests(flags(true, true));
  _setAdTimeoutsForTests(50, 30);
  registerAdAdapter({
    name: "hung-show",
    initialize: async () => undefined,
    loadRewarded: async () => undefined,
    showRewarded: () => new Promise(() => {}), // never resolves
  });
  const result = await showRewardedAd(PLACEMENT);
  assert.deepEqual(result, { status: "error", reason: "timeout" });
});

// --- Analytics bridge ----------------------------------------------------------------

test("lifecycle events reach analytics as schema-valid events", async () => {
  _setAdFlagsForTests(flags(true, true));
  makeSpyAdapter(async () => ({ type: "coins", amount: 5 }));
  const tracked: { eventName: AnalyticsEventName; params: unknown }[] = [];
  connectAdAnalytics((eventName, params) => tracked.push({ eventName, params }));

  await showRewardedAd(PLACEMENT);

  assert.deepEqual(
    tracked.map((t) => t.eventName),
    ["rewarded_ad_requested", "rewarded_ad_loaded", "rewarded_ad_shown", "rewarded_ad_completed"],
  );
  // Every forwarded event must pass the exact same validation the Worker applies.
  for (const t of tracked) {
    assert.equal(validateEventParams(t.eventName, t.params).valid, true, `${t.eventName} params invalid`);
  }
});

test("dismiss and failure map to their analytics events; no completion on dismiss", async () => {
  _setAdFlagsForTests(flags(true, true));
  makeSpyAdapter(async () => null);
  const tracked: AnalyticsEventName[] = [];
  connectAdAnalytics((eventName) => tracked.push(eventName));
  await showRewardedAd(PLACEMENT);
  assert.ok(tracked.includes("rewarded_ad_dismissed"));
  assert.ok(!tracked.includes("rewarded_ad_completed"));

  const unavailable = mapLifecycleToAnalytics("unavailable", { placement: PLACEMENT, reason: "no_adapter" });
  assert.deepEqual(unavailable, {
    eventName: "rewarded_ad_unavailable",
    params: { placement: PLACEMENT, reason: "no_adapter" },
  });
  const failed = mapLifecycleToAnalytics("error", { placement: PLACEMENT, reason: "timeout" });
  assert.deepEqual(failed, { eventName: "rewarded_ad_failed", params: { placement: PLACEMENT, reason: "timeout" } });
  assert.equal(mapLifecycleToAnalytics("loading", { placement: PLACEMENT }), null);
});

test("schema rejects unknown placements and free-text failure reasons", () => {
  assert.equal(validateEventParams("rewarded_ad_completed", { placement: "daily_retry" }).valid, true);
  assert.equal(validateEventParams("rewarded_ad_completed", { placement: "hacked" }).valid, false);
  assert.equal(validateEventParams("rewarded_ad_completed", { placement: "daily_retry", extra: 1 }).valid, false);
  assert.equal(
    validateEventParams("rewarded_ad_failed", { placement: "daily_retry", reason: "timeout" }).valid,
    true,
  );
  assert.equal(
    validateEventParams("rewarded_ad_failed", { placement: "daily_retry", reason: "Error: stack at 0x1f" }).valid,
    false,
  );
});

// --- ID policy ------------------------------------------------------------------------

test("outside a prod Vite build, ad unit IDs are always Google test units", () => {
  // Google demo units all live under the 3940256099942544 publisher.
  for (const format of ALL_FORMATS) {
    assert.match(getAdUnitId(format, "android"), /^ca-app-pub-3940256099942544\//);
    assert.match(getAdUnitId(format, "ios"), /^ca-app-pub-3940256099942544\//);
  }
});

// --- AdMob adapter mapping ---------------------------------------------------------------

test("AdMob adapter maps plugin results to the reward contract", async () => {
  const adapter = createAdMobAdapter({
    initialize: async () => undefined,
    prepareRewardVideoAd: async () => undefined,
    showRewardVideoAd: async () => ({ type: "coins", amount: 5 }),
  });
  assert.deepEqual(await adapter.showRewarded(), { type: "coins", amount: 5 });

  const dismissed = createAdMobAdapter({
    initialize: async () => undefined,
    prepareRewardVideoAd: async () => undefined,
    showRewardVideoAd: async () => undefined,
  });
  assert.equal(await dismissed.showRewarded(), null);
});
