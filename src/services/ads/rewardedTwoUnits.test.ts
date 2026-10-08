// 0.57.1: two AdMob rewarded units (Coin, Ink Trial) on ONE rewarded lane. One native load at a time, one ready ad,
// never the wrong unit's ad shown; a settled ad of the other unit is set aside, a load in flight is left alone.

import { strict as assert } from "node:assert";
import { beforeEach, test } from "node:test";
import {
  _resetRewardedAdsForTests,
  _setAdTimeoutsForTests,
  getRewardedLifecycleState,
  isRewardedAdAvailable,
  isRewardedUnitConfigured,
  preloadRewardedAd,
  registerAdAdapter,
  showRewardedAd,
  subscribeRewardedAdEvents,
} from "./rewardedAds";
import { getAdUnitId, getRewardedAdUnitId } from "./adConfig";
import { REWARDED_AD_PLACEMENTS, rewardedUnitFor } from "./adPlacements";

type Pending = { resolve: () => void; reject: (e: unknown) => void };
let loads: Pending[];
let loadCount: number;
let shows: number;
let events: string[];

const flush = () => new Promise<void>((r) => setImmediate(r));

beforeEach(() => {
  _resetRewardedAdsForTests();
  _setAdTimeoutsForTests({ tapWait: 30, hardLoad: 5000, failedCooldown: 10_000 });
  loads = [];
  loadCount = 0;
  shows = 0;
  events = [];
  registerAdAdapter({
    name: "two-units",
    initialize: async () => {},
    loadRewarded: () => {
      loadCount++;
      return new Promise<void>((resolve, reject) => loads.push({ resolve, reject }));
    },
    showRewarded: async () => {
      shows++;
      return { type: "coins", amount: 1 };
    },
  });
  subscribeRewardedAdEvents("rec", (e, d) => events.push(`${e}:${d.placement}`));
});

const COIN = "shape_challenge_double_reward" as const;
const INK = "shape_challenge_ink_trial" as const;

test("placements map to units: the three Ink Trial placements -> ink, every other placement -> coin", () => {
  for (const p of REWARDED_AD_PLACEMENTS) assert.equal(rewardedUnitFor(p), p.endsWith("_ink_trial") ? "ink" : "coin", p);
});

test("unit IDs: coin = the existing rewarded unit resolver (unchanged); dev/test builds use Google's test unit for BOTH", () => {
  assert.equal(getRewardedAdUnitId("coin", "android"), getAdUnitId("rewarded", "android"));
  assert.equal(getRewardedAdUnitId("ink", "android"), "ca-app-pub-3940256099942544/5224354917", "Google test rewarded unit, never production");
  assert.equal(isRewardedUnitConfigured("ink"), true);
  assert.equal(isRewardedAdAvailable(INK), true);
});

test("same unit: a ready coin ad serves the coin offer exactly as before (one load, one show)", async () => {
  void preloadRewardedAd(COIN);
  loads[0].resolve();
  await flush();
  const r = await showRewardedAd(COIN);
  assert.equal(r.status, "rewarded");
  assert.deepEqual([loadCount, shows], [1, 1]);
});

test("a ready COIN ad is never shown for an INK offer: it is set aside and the Ink unit is loaded (still one lane)", async () => {
  void preloadRewardedAd(COIN);
  loads[0].resolve();
  await flush();
  assert.equal(getRewardedLifecycleState(), "ready");
  const tap = showRewardedAd(INK);
  await flush();
  assert.equal(loadCount, 2, "the Ink unit is requested");
  loads[1].resolve();
  const r = await tap;
  assert.equal(r.status, "rewarded");
  assert.equal(shows, 1);
});

test("preloading the other unit while a load is in flight never starts a second concurrent load", async () => {
  void preloadRewardedAd(COIN);
  void preloadRewardedAd(INK);
  void preloadRewardedAd(INK);
  assert.equal(loadCount, 1);
});

test("an Ink tap during an in-flight COIN load waits (bounded), never shows the coin ad, and the coin load completes", async () => {
  void preloadRewardedAd(COIN);
  const tap = showRewardedAd(INK);
  loads[0].resolve();
  const r = await tap;
  assert.equal(r.status, "unavailable");
  assert.equal(shows, 0, "the coin unit's ad was not shown for the Ink offer");
  assert.equal(loadCount, 1, "no overlapping Ink load");
  assert.equal(getRewardedLifecycleState(), "ready", "the coin ad stays ready for a coin offer");
});

test("a failed Ink load does not hold the Coin unit in its cooldown (and vice versa)", async () => {
  void preloadRewardedAd(INK);
  loads[0].reject({ code: 3 });
  await flush();
  assert.equal(getRewardedLifecycleState(), "failed");
  void preloadRewardedAd(COIN);
  assert.equal(loadCount, 2, "coin loads at once despite the Ink unit's fresh no_fill");
  void preloadRewardedAd(COIN);
  assert.equal(loadCount, 2);
});

test("the Classic preload warms the unit the next opportunity will use; a fallback to coin warms coin", async () => {
  const { expectedClassicRewardedPlacement } = await import("./resultAdLane");
  const base = {
    recordGameCompleted: () => true,
    claimLane: () => "rewarded" as const,
    recordDeferred: () => {},
    deferInterstitial: () => false,
    pendingCtaInk: () => null,
  };
  assert.equal(expectedClassicRewardedPlacement({ ...base, inkOn: () => true, scheduledSlot: () => "ink", eligibleInk: () => "rainbow" }), INK);
  assert.equal(expectedClassicRewardedPlacement({ ...base, inkOn: () => true, scheduledSlot: () => "ink", eligibleInk: () => null }), COIN, "fallback");
  assert.equal(expectedClassicRewardedPlacement({ ...base, inkOn: () => true, scheduledSlot: () => "coin", eligibleInk: () => "rainbow" }), COIN);
  assert.equal(expectedClassicRewardedPlacement({ ...base, inkOn: () => false, scheduledSlot: () => "ink", eligibleInk: () => "rainbow" }), COIN, "Ink off: exactly the 0.57 preload");
});

test("lifecycle events keep their own placement, so analytics attribute every load / show to Coin or Ink", async () => {
  void preloadRewardedAd(INK);
  loads[0].resolve();
  await flush();
  await showRewardedAd(INK);
  assert.ok(events.includes(`loaded:${INK}`));
  assert.ok(events.includes(`shown:${INK}`));
});
