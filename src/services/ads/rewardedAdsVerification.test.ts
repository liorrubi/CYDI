// Pre-deploy verification (0.57.0) of the rewarded adapter + state machine against a fake
// plugin that models the REAL @capacitor-community/admob 8.0.0 Android behaviour (read from
// AdRewardExecutor.java / RewardedAdCallbackAndListeners.kt / FullscreenPluginCallback.kt):
//   - events are permanent, id-less, broadcast to every listener;
//   - showRewardVideoAd() creates a PluginCall that settles ONLY on a reward (notify Reward, then
//     call.resolve) - a close or a show failure never settles it;
//   - the ad is held in a static (mRewardedAd) that is NOT cleared by a show;
//   - showRewardVideoAd() with nothing prepared rejects and also fires FailedToLoad (-1).
// Real short timers only (postDismissGraceMs / _setAdTimeoutsForTests hooks); no fake clock.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test, beforeEach, afterEach } from "node:test";

import {
  _resetRewardedAdsForTests,
  _setAdTimeoutsForTests,
  getRewardedLifecycleState,
  handleRewardedForeground,
  isRewardedAdReady,
  preloadRewardedAd,
  registerAdAdapter,
  showRewardedAd,
  subscribeRewardedAdEvents,
} from "./rewardedAds";
import { _setAdFlagsForTests, type AdFeatureFlags } from "./adConfig";
import type { RewardedAdPlacement } from "./adPlacements";
import type { AdReward, RewardedAdLifecycleEvent } from "./adTypes";
import { connectAdAnalytics } from "./adAnalytics";
import {
  INTERSTITIAL_PLUGIN_EVENTS,
  REWARDED_PLUGIN_EVENTS,
  REWARDED_POST_DISMISS_GRACE_MS,
  createAdMobAdapter,
  createAdMobInterstitialAdapter,
} from "./admobAdapter";
import type { InterstitialNativeEvent } from "./interstitialAds";
import { resolveAdOutcome, consumesDoubleAttempt } from "../../components/doubleOfferAdFlow";
import { createOfferSettlement, offerExitAction } from "../../app/doubleOfferSettlement";
import { rewardedFinalAmount } from "../../app/rewardedOfferCadence";

const PLACEMENT: RewardedAdPlacement = "daily_retry";
const GRACE = 40;

function flags(): AdFeatureFlags {
  return { master: true, formats: { rewarded: true, rewardedInterstitial: false, interstitial: false, banner: false, appOpen: false } };
}

beforeEach(() => {
  _resetRewardedAdsForTests();
  _setAdFlagsForTests(flags());
});
afterEach(() => {
  _setAdFlagsForTests();
});

const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type PluginCallRecord = { kind: "prepare" | "show"; settled: boolean; resolve: (v?: unknown) => void; reject: (e: unknown) => void };
type Item = { type?: string; amount?: number } | undefined;

/** A plugin that behaves like the real one. `prepareBehaviour` drives the next prepare call. */
function realisticPlugin() {
  const listeners = new Map<string, Array<(info: unknown) => void>>();
  const calls: PluginCallRecord[] = [];
  const log: string[] = [];
  let mRewardedAd: { shown: boolean; n: number } | null = null; // the plugin's static
  let adCounter = 0;
  let showCall: PluginCallRecord | null = null; // the call tied to the ad currently on screen
  let prepareBehaviour: "ok" | { failCode?: number; failMessage: string; emitEvent?: boolean } | "hang" = "ok";
  let prepareDelayMs = 0;

  const emit = (name: string, info?: unknown) => {
    for (const fn of listeners.get(name) ?? []) fn(info);
  };

  const plugin = {
    initialize: async () => undefined,
    addListener: async (name: string, fn: (info: unknown) => void) => {
      listeners.set(name, [...(listeners.get(name) ?? []), fn]);
    },
    prepareRewardVideoAd: (_o: { adId: string }) => {
      log.push("prepare");
      return new Promise<unknown>((resolve, reject) => {
        const rec: PluginCallRecord = { kind: "prepare", settled: false, resolve: (v) => ((rec.settled = true), resolve(v)), reject: (e) => ((rec.settled = true), reject(e)) };
        calls.push(rec);
        const behave = prepareBehaviour;
        if (behave === "hang") return;
        setTimeout(() => {
          if (behave === "ok") {
            mRewardedAd = { shown: false, n: ++adCounter };
            rec.resolve({ adUnitId: "x" });
          } else {
            // The plugin posts FailedToLoad {code, message} and then rejects with the message.
            if (behave.emitEvent !== false) emit(REWARDED_PLUGIN_EVENTS.failedToLoad, { code: behave.failCode, message: behave.failMessage });
            rec.reject(new Error(behave.failMessage));
          }
        }, prepareDelayMs);
      });
    },
    showRewardVideoAd: (): Promise<Item> => {
      log.push("show");
      return new Promise<Item>((resolve, reject) => {
        const rec: PluginCallRecord = { kind: "show", settled: false, resolve: (v) => ((rec.settled = true), resolve(v as Item)), reject: (e) => ((rec.settled = true), reject(e)) };
        calls.push(rec);
        if (mRewardedAd === null) {
          rec.reject(new Error("No Reward Video Ad can be shown. It was not prepared or maybe it failed to be prepared."));
          emit(REWARDED_PLUGIN_EVENTS.failedToLoad, { code: -1, message: "No Reward Video Ad can be shown." });
          return;
        }
        if (mRewardedAd.shown) {
          // GMA refuses to show a consumed ad: FailedToShow, call stays pending.
          setTimeout(() => emit(REWARDED_PLUGIN_EVENTS.failedToShow, { code: 1, message: "The ad has already been shown." }), 0);
          return;
        }
        mRewardedAd.shown = true; // NOTE: the static stays set (the plugin never clears it)
        showCall = rec;
      });
    },
  };

  return {
    plugin,
    calls,
    log,
    emit,
    setPrepare: (b: typeof prepareBehaviour, delayMs = 0) => {
      prepareBehaviour = b;
      prepareDelayMs = delayMs;
    },
    /** User earns the reward: Reward event, then the show call resolves (the plugin's own order). */
    reward: (amount = 5) => {
      emit(REWARDED_PLUGIN_EVENTS.reward, { type: "coins", amount });
      showCall?.resolve({ type: "coins", amount });
    },
    /** Only the Reward event, without the call resolving. */
    rewardEventOnly: (amount = 5) => emit(REWARDED_PLUGIN_EVENTS.reward, { type: "coins", amount }),
    /** Only the call resolving, without the Reward event. */
    rewardCallOnly: (amount = 5) => showCall?.resolve({ type: "coins", amount }),
    dismiss: () => emit(REWARDED_PLUGIN_EVENTS.dismissed, {}),
    failToShow: (info = { code: 0, message: "Internal error" }) => emit(REWARDED_PLUGIN_EVENTS.failedToShow, info),
    showCalls: () => calls.filter((c) => c.kind === "show"),
    prepareCalls: () => calls.filter((c) => c.kind === "prepare"),
    staticAdShown: () => mRewardedAd?.shown ?? null,
  };
}

type Tracked = { eventName: string; params: Record<string, unknown> };

function wire(options: { grace?: number } = {}) {
  const fake = realisticPlugin();
  registerAdAdapter(createAdMobAdapter(fake.plugin, { postDismissGraceMs: options.grace ?? GRACE }));
  const lifecycle: RewardedAdLifecycleEvent[] = [];
  subscribeRewardedAdEvents("verify-recorder", (event) => lifecycle.push(event));
  const analytics: Tracked[] = [];
  connectAdAnalytics((eventName, params) => analytics.push({ eventName, params: params as Record<string, unknown> }));
  const count = (name: string) => analytics.filter((a) => a.eventName === name).length;
  return { fake, lifecycle, analytics, count };
}

const terminal = (events: RewardedAdLifecycleEvent[]) => events.filter((e) => e === "rewarded" || e === "dismissed" || e === "error");

/** Preload, then start a show and give the adapter a tick to register its pending show. */
async function readyAndShow(_w: ReturnType<typeof wire>): Promise<{ result: ReturnType<typeof showRewardedAd> }> {
  await preloadRewardedAd(PLACEMENT);
  assert.equal(getRewardedLifecycleState(), "ready");
  const result = showRewardedAd(PLACEMENT);
  await tick(2);
  assert.equal(getRewardedLifecycleState(), "showing");
  return { result }; // wrapped: returning the promise itself from an async function would await the whole show
}

// --- (0) the fake models the real plugin / the adapter's assumptions match the plugin source --------------

test("source cross-check: the adapter's rewarded event names are the plugin's own constants, and no interstitial name collides", () => {
  const kt = readFileSync(new URL("../../../node_modules/@capacitor-community/admob/android/src/main/java/com/getcapacitor/community/admob/rewarded/RewardAdPluginEvents.kt", import.meta.url), "utf8");
  const ktInter = readFileSync(new URL("../../../node_modules/@capacitor-community/admob/android/src/main/java/com/getcapacitor/community/admob/interstitial/InterstitialAdPluginPluginEvent.kt", import.meta.url), "utf8");
  const value = (src: string, key: string) => new RegExp(`${key}\\s*=\\s*"([^"]+)"`).exec(src)?.[1];
  assert.equal(value(kt, "FailedToLoad"), REWARDED_PLUGIN_EVENTS.failedToLoad);
  assert.equal(value(kt, "Rewarded"), REWARDED_PLUGIN_EVENTS.reward);
  assert.equal(value(kt, "Dismissed"), REWARDED_PLUGIN_EVENTS.dismissed);
  assert.equal(value(kt, "FailedToShow"), REWARDED_PLUGIN_EVENTS.failedToShow);
  assert.equal(value(ktInter, "Dismissed"), INTERSTITIAL_PLUGIN_EVENTS.dismissed);
  const rewardedNames = new Set<string>(Object.values(REWARDED_PLUGIN_EVENTS));
  for (const name of Object.values(INTERSTITIAL_PLUGIN_EVENTS)) assert.equal(rewardedNames.has(name), false, `${name} must not be a rewarded event`);
});

test("interstitial events cannot be confused with rewarded ones, in either direction", async () => {
  // Rewarded adapter with a show pending: every interstitial event is inert.
  const w = wire();
  const result = (await readyAndShow(w)).result;
  for (const name of Object.values(INTERSTITIAL_PLUGIN_EVENTS)) w.fake.emit(name, { code: 0, message: "x", type: "coins", amount: 5 });
  await tick(GRACE * 2);
  assert.deepEqual(terminal(w.lifecycle), [], "interstitial dismissed/failedToShow/etc. never settle a rewarded show");
  w.fake.reward(5);
  assert.equal((await result).status, "rewarded");

  // Interstitial adapter: rewarded events never reach its listener.
  const seen: InterstitialNativeEvent[] = [];
  const listeners = new Map<string, (info: unknown) => void>();
  const inter = createAdMobInterstitialAdapter({
    prepareInterstitial: async () => undefined,
    showInterstitial: async () => undefined,
    addListener: async (n, fn) => void listeners.set(n, fn),
  });
  inter.setListener((e) => seen.push(e));
  for (const name of Object.values(REWARDED_PLUGIN_EVENTS)) listeners.get(name)?.({ code: 3 });
  assert.deepEqual(seen, [], "no rewarded event name is registered on the interstitial adapter");
});

// --- (1) reward before dismiss -----------------------------------------------------------------------

test("(1) reward before dismiss: exactly one reward, no skip/dismissed/failed event, state idle", async () => {
  const w = wire();
  const p = (await readyAndShow(w)).result;
  w.fake.reward(5); // Reward event, then call.resolve - both arrive
  const result = await p;
  assert.deepEqual(result, { status: "rewarded", reward: { type: "coins", amount: 5 } });
  w.fake.dismiss(); // the user closes the end card afterwards
  w.fake.dismiss();
  await tick(GRACE * 3);
  assert.deepEqual(terminal(w.lifecycle), ["rewarded"]);
  assert.equal(w.count("rewarded_ad_completed"), 1);
  assert.equal(w.count("rewarded_ad_dismissed"), 0);
  assert.equal(w.count("rewarded_ad_failed"), 0);
  assert.equal(w.count("rewarded_ad_unavailable"), 0);
  assert.equal(getRewardedLifecycleState(), "idle");
});

test("(1) the reward can arrive as the Reward event alone or the call resolution alone - one grant either way", async () => {
  for (const mode of ["event", "call"] as const) {
    _resetRewardedAdsForTests();
    _setAdFlagsForTests(flags());
    const w = wire();
    const p = (await readyAndShow(w)).result;
    if (mode === "event") w.fake.rewardEventOnly(7);
    else w.fake.rewardCallOnly(7);
    assert.deepEqual(await p, { status: "rewarded", reward: { type: "coins", amount: 7 } }, mode);
    assert.equal(w.count("rewarded_ad_completed"), 1, mode);
  }
});

// --- (2) dismiss before reward: bounded grace --------------------------------------------------------

test("(2) dismiss then late reward inside the grace grants exactly once (event + call), and the grace timer cannot settle again", async () => {
  const w = wire({ grace: 80 });
  const p = (await readyAndShow(w)).result;
  w.fake.dismiss();
  await tick(15);
  w.fake.reward(9); // Reward event then call resolve, both inside the grace
  const result = await p;
  assert.deepEqual(result, { status: "rewarded", reward: { type: "coins", amount: 9 } });
  await tick(140); // well past the (cleared) grace
  assert.deepEqual(terminal(w.lifecycle), ["rewarded"]);
  assert.equal(w.count("rewarded_ad_completed"), 1);
  assert.equal(w.count("rewarded_ad_dismissed"), 0);
});

test("(2) a reward after the grace is ignored: the offer already ended as dismissed, with one terminal event", async () => {
  const w = wire({ grace: 30 });
  const p = (await readyAndShow(w)).result;
  w.fake.dismiss();
  assert.deepEqual(await p, { status: "dismissed" });
  w.fake.reward(5); // far too late
  await tick(30);
  assert.deepEqual(terminal(w.lifecycle), ["dismissed"]);
  assert.equal(w.count("rewarded_ad_completed"), 0, "no coins for a reward that arrives after the show ended");
  assert.equal(getRewardedLifecycleState(), "idle");
});

test("(2) with the default grace the dismissed result arrives after ~1.5 s, nowhere near the 90 s backstop", async () => {
  assert.equal(REWARDED_POST_DISMISS_GRACE_MS, 1500);
  const w = wire({ grace: REWARDED_POST_DISMISS_GRACE_MS });
  const p = (await readyAndShow(w)).result;
  const t0 = Date.now();
  w.fake.dismiss();
  assert.deepEqual(await p, { status: "dismissed" });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 1400, `waited the grace (${elapsed} ms)`);
  assert.ok(elapsed < 10_000, `settled long before the 90 s backstop (${elapsed} ms)`);
});

// --- (3) dismiss with no reward ----------------------------------------------------------------------

test("(3) dismiss with no reward: dismissed outcome, zero reward, NO failure event, idle, and the player can watch again", async () => {
  _setAdTimeoutsForTests({ show: 5_000 });
  const w = wire({ grace: GRACE });
  const p = (await readyAndShow(w)).result;
  const t0 = Date.now();
  w.fake.dismiss();
  const result = await p;
  const elapsed = Date.now() - t0;
  assert.deepEqual(result, { status: "dismissed" });
  assert.ok(elapsed >= GRACE - 5 && elapsed < 3_000, `bounded by the grace, not the show backstop (${elapsed} ms)`);
  assert.equal(w.count("rewarded_ad_dismissed"), 1);
  assert.equal(w.count("rewarded_ad_completed"), 0);
  assert.equal(w.count("rewarded_ad_failed"), 0);
  assert.equal(w.count("rewarded_ad_unavailable"), 0);
  assert.equal(getRewardedLifecycleState(), "idle");
  // The plugin's own show call never settled (real plugin behaviour) - nothing depends on it.
  assert.equal(w.fake.showCalls()[0].settled, false);
  // The consumed ad is still the plugin's static; the service must not reuse it.
  assert.equal(w.fake.staticAdShown(), true);
  assert.equal(isRewardedAdReady(), false, "an ad that was shown is never offered as ready again");

  // Watch again: the tap starts a fresh load (no re-preload after a dismiss) and shows the NEW ad.
  _setAdTimeoutsForTests({ tapWait: 2_000 });
  const second = showRewardedAd(PLACEMENT);
  await tick(30);
  w.fake.reward(3);
  assert.deepEqual(await second, { status: "rewarded", reward: { type: "coins", amount: 3 } });
  assert.deepEqual(w.fake.log, ["prepare", "show", "prepare", "show"], "never a show on the consumed ad");
  assert.equal(w.fake.showCalls().length, 2);
  assert.equal(w.count("rewarded_ad_completed"), 1);
});

test("(3) dismiss then preload again, then tap: the preloaded ad is used (the old unsettled call does not interfere)", async () => {
  const w = wire();
  const p = (await readyAndShow(w)).result;
  w.fake.dismiss();
  assert.deepEqual(await p, { status: "dismissed" });
  await preloadRewardedAd(PLACEMENT);
  assert.equal(getRewardedLifecycleState(), "ready");
  const second = showRewardedAd(PLACEMENT);
  await tick(2);
  w.fake.dismiss();
  assert.deepEqual(await second, { status: "dismissed" });
  assert.equal(w.count("rewarded_ad_dismissed"), 2);
  assert.equal(w.count("rewarded_ad_failed"), 0);
});

test("(3) current behaviour after a dismiss: no re-preload, so Watch again waits at most the tap wait and then reports unavailable/timeout while the load keeps going", async () => {
  _setAdTimeoutsForTests({ tapWait: 30 });
  const w = wire();
  const p = (await readyAndShow(w)).result;
  w.fake.dismiss();
  await p;
  w.fake.setPrepare("ok", 120); // a slowish fill
  const tap = await showRewardedAd(PLACEMENT);
  assert.deepEqual(tap, { status: "unavailable", reason: "timeout" });
  assert.equal(w.count("rewarded_ad_unavailable"), 1);
  await tick(200);
  assert.equal(getRewardedLifecycleState(), "ready", "the load finished in the background: the next tap works");
});

// --- (4) FailedToShow --------------------------------------------------------------------------------

test("(4) FailedToShow: error/sdk_error, one failed event with no code or message, idle; the NEXT show ignores every straggler from the previous one", async () => {
  const w = wire();
  const p = (await readyAndShow(w)).result;
  w.fake.failToShow({ code: 0, message: "Internal error" });
  assert.deepEqual(await p, { status: "error", reason: "sdk_error" });
  assert.equal(w.count("rewarded_ad_failed"), 1);
  const failed = w.analytics.find((a) => a.eventName === "rewarded_ad_failed")!;
  assert.equal(JSON.stringify(failed.params).includes("Internal error"), false);
  assert.equal("code" in failed.params, false, "show failures carry no code");
  assert.equal(getRewardedLifecycleState(), "idle");

  // Stragglers from the failed ad, arriving before the next show begins.
  w.fake.dismiss();
  w.fake.rewardEventOnly(5);
  w.fake.failToShow({ code: 2, message: "again" });
  await tick(GRACE * 2);
  assert.deepEqual(terminal(w.lifecycle), ["error"], "stragglers produced no event");

  // The next show: starts pending, is unaffected by the earlier events, settles on its own.
  await preloadRewardedAd(PLACEMENT);
  const second = showRewardedAd(PLACEMENT);
  await tick(GRACE * 2);
  assert.equal(getRewardedLifecycleState(), "showing", "still the second show's own state");
  w.fake.reward(4);
  assert.deepEqual(await second, { status: "rewarded", reward: { type: "coins", amount: 4 } });
  assert.deepEqual(terminal(w.lifecycle), ["error", "rewarded"]);
});

test("(4) a dismiss grace left running by one show cannot settle the next show", async () => {
  // Show 1 is dismissed and superseded by show 2 while its grace timer is armed (adapter level).
  const fake = realisticPlugin();
  const adapter = createAdMobAdapter(fake.plugin, { postDismissGraceMs: 80 });
  await fake.plugin.prepareRewardVideoAd({ adId: "u" });
  await tick(2);
  const first = adapter.showRewarded();
  fake.dismiss(); // arms show 1's grace
  await fake.plugin.prepareRewardVideoAd({ adId: "u" }); // a fresh ad, so the second show is a legitimate one
  await tick(2);
  const second = adapter.showRewarded(); // supersedes: show 1 is closed out as dismissed, its timer cleared
  assert.equal(await first, null);
  let secondSettled = false;
  void second.then(() => (secondSettled = true), () => (secondSettled = true));
  await tick(200); // > grace: show 1's old timer must not touch show 2
  assert.equal(secondSettled, false);
});

// --- (5) FailedToLoad: {code, message} --------------------------------------------------------------

test("(5) FailedToLoad code 3 + message: both survive the adapter, classified no_fill with the code, and the message never reaches analytics", async () => {
  const w = wire();
  w.fake.setPrepare({ failCode: 3, failMessage: "No fill." });
  await preloadRewardedAd(PLACEMENT);
  const un = w.analytics.find((a) => a.eventName === "rewarded_ad_unavailable")!;
  assert.equal(un.params.reason, "no_fill");
  assert.equal(un.params.code, 3);
  assert.equal(JSON.stringify(w.analytics).includes("No fill"), false);
  assert.equal(JSON.stringify(w.analytics).toLowerCase().includes("message"), false);

  // And at the adapter boundary the thrown error keeps {code, message}.
  const direct = createAdMobAdapter(w.fake.plugin);
  w.fake.setPrepare({ failCode: 3, failMessage: "No fill." });
  await assert.rejects(direct.loadRewarded("u"), (e: { code?: number; message?: string }) => e.code === 3 && e.message === "No fill.");
});

test("(5) a numeric GMA code stays authoritative over the message text, both directions", async () => {
  // code 0 (internal error) with a "No fill." message: still sdk_error.
  const a = wire();
  a.fake.setPrepare({ failCode: 0, failMessage: "No fill." });
  await preloadRewardedAd(PLACEMENT);
  const ua = a.analytics.find((x) => x.eventName === "rewarded_ad_unavailable")!;
  assert.equal(ua.params.reason, "sdk_error");
  assert.equal(ua.params.code, 0);

  // code 9 (mediation no fill) with a misleading message: still no_fill.
  _resetRewardedAdsForTests();
  _setAdFlagsForTests(flags());
  const b = wire();
  b.fake.setPrepare({ failCode: 9, failMessage: "Something exploded" });
  await preloadRewardedAd(PLACEMENT);
  const ub = b.analytics.find((x) => x.eventName === "rewarded_ad_unavailable")!;
  assert.equal(ub.params.reason, "no_fill");
  assert.equal(ub.params.code, 9);
});

test("(5) no_fill is recognised from the message alone when FailedToLoad never fires (no code in analytics)", async () => {
  const w = wire();
  w.fake.setPrepare({ failMessage: "No fill.", emitEvent: false });
  await preloadRewardedAd(PLACEMENT); // includes the adapter's 300 ms code grace
  const un = w.analytics.find((a) => a.eventName === "rewarded_ad_unavailable")!;
  assert.equal(un.params.reason, "no_fill");
  assert.equal("code" in un.params, false);
  assert.equal(JSON.stringify(w.analytics).includes("No fill"), false);
});

test("(5) the plugin's own show-time FailedToLoad (-1, nothing prepared) never poisons a later load's code", async () => {
  const w = wire();
  // A show with nothing prepared (adapter level): rejects, and the plugin also emits FailedToLoad -1.
  const adapter = createAdMobAdapter(w.fake.plugin, { postDismissGraceMs: GRACE });
  await assert.rejects(adapter.showRewarded(), (e: { message?: string }) => /not prepared/.test(e.message ?? ""));
  // The next load fails with no event: it must not inherit -1.
  w.fake.setPrepare({ failMessage: "No fill.", emitEvent: false });
  await assert.rejects(adapter.loadRewarded("u"), (e: { code?: number }) => e.code === undefined);
});

// --- (6) stale callbacks cannot mutate current state ---------------------------------------------------

test("(6) callbacks of an abandoned load cannot touch a later load, a ready ad, or an ad being shown", async () => {
  _setAdTimeoutsForTests({ hardLoad: 60, failedCooldown: 0, show: 50 }); // show: this test never settles its show; keep the backstop short so the process can exit
  const loads: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
  registerAdAdapter({
    name: "controlled",
    initialize: async () => {},
    loadRewarded: () => new Promise<void>((resolve, reject) => void loads.push({ resolve, reject })),
    showRewarded: () => new Promise<AdReward | null>(() => undefined), // never settles: we only inspect state
  });
  const seen: RewardedAdLifecycleEvent[] = [];
  subscribeRewardedAdEvents("verify-recorder", (e) => seen.push(e));
  await preloadRewardedAd(PLACEMENT); // load 0 abandoned at the hard expiry (state failed)
  assert.equal(getRewardedLifecycleState(), "failed");
  const second = preloadRewardedAd(PLACEMENT); // load 1
  loads[1].resolve();
  await second;
  assert.equal(getRewardedLifecycleState(), "ready");
  const eventsBefore = seen.length;
  loads[0].reject({ code: 3 }); // stale rejection while ready
  loads[0].resolve(); // stale success
  await tick(5);
  assert.equal(getRewardedLifecycleState(), "ready");
  assert.equal(seen.length, eventsBefore, "stale callbacks emitted nothing");
  void showRewardedAd(PLACEMENT);
  await tick(2);
  assert.equal(getRewardedLifecycleState(), "showing");
  loads[0].reject({ code: 0 });
  loads[0].resolve();
  await tick(5);
  assert.equal(getRewardedLifecycleState(), "showing", "stale callbacks while showing change nothing");
});

test("(6) plugin events from a previous show cannot settle or fail a later one (adapter level)", async () => {
  const fake = realisticPlugin();
  const adapter = createAdMobAdapter(fake.plugin, { postDismissGraceMs: 20 });
  await fake.plugin.prepareRewardVideoAd({ adId: "u" });
  await tick(2);
  const first = adapter.showRewarded();
  fake.dismiss();
  assert.equal(await first, null);
  await fake.plugin.prepareRewardVideoAd({ adId: "u" });
  await tick(2);
  const second = adapter.showRewarded();
  let outcome: unknown = "pending";
  void second.then((v) => (outcome = v), (e) => (outcome = { rejected: e }));
  fake.showCalls()[0].resolve({ type: "coins", amount: 5 }); // the OLD call finally resolves (late reward via the call)
  fake.showCalls()[0].reject(new Error("late"));
  await tick(60);
  assert.equal(outcome, "pending", "a settlement via the old call is bound to the old show");
  fake.reward(2);
  await tick(2);
  assert.deepEqual(outcome, { type: "coins", amount: 2 });
});

// --- (7) duplicates --------------------------------------------------------------------------------

test("(7) duplicate Reward events, duplicate Dismissed, Reward+call: one terminal outcome, one analytics event", async () => {
  const w = wire();
  const p = (await readyAndShow(w)).result;
  w.fake.rewardEventOnly(5);
  w.fake.rewardEventOnly(5);
  w.fake.rewardCallOnly(5);
  w.fake.dismiss();
  w.fake.dismiss();
  w.fake.reward(5);
  assert.equal((await p).status, "rewarded");
  await tick(GRACE * 3);
  assert.deepEqual(terminal(w.lifecycle), ["rewarded"]);
  assert.equal(w.count("rewarded_ad_completed"), 1);
  assert.equal(w.count("rewarded_ad_dismissed") + w.count("rewarded_ad_failed"), 0);
});

test("(7) Dismissed twice and FailedToShow twice: one outcome each", async () => {
  const d = wire();
  const p = (await readyAndShow(d)).result;
  d.fake.dismiss();
  d.fake.dismiss();
  await p;
  d.fake.dismiss();
  await tick(GRACE * 3);
  assert.deepEqual(terminal(d.lifecycle), ["dismissed"]);
  assert.equal(d.count("rewarded_ad_dismissed"), 1);

  _resetRewardedAdsForTests();
  _setAdFlagsForTests(flags());
  const f = wire();
  const q = (await readyAndShow(f)).result;
  f.fake.failToShow();
  f.fake.failToShow();
  await q;
  await tick(GRACE * 2);
  assert.deepEqual(terminal(f.lifecycle), ["error"]);
  assert.equal(f.count("rewarded_ad_failed"), 1);
});

test("(7) two adapters on one plugin (a double initializeNativeAds): only the registered one acts; no doubled events or rewards", async () => {
  const fake = realisticPlugin();
  const stale = createAdMobAdapter(fake.plugin, { postDismissGraceMs: GRACE }); // first registration, replaced below
  void stale;
  registerAdAdapter(createAdMobAdapter(fake.plugin, { postDismissGraceMs: GRACE }));
  const events: RewardedAdLifecycleEvent[] = [];
  subscribeRewardedAdEvents("verify-recorder", (e) => events.push(e));
  await preloadRewardedAd(PLACEMENT);
  const p = showRewardedAd(PLACEMENT);
  await tick(2);
  fake.reward(5);
  assert.equal((await p).status, "rewarded");
  assert.deepEqual(terminal(events), ["rewarded"]);
});

// --- (8) foreground / initialize --------------------------------------------------------------------

test("(8) repeated foreground events never start a second load or an overlapping one", async () => {
  const w = wire();
  w.fake.setPrepare("ok", 60);
  const preload = preloadRewardedAd(PLACEMENT);
  for (let i = 0; i < 5; i++) handleRewardedForeground();
  await tick(10);
  void preloadRewardedAd(PLACEMENT); // an offer mounting while the load is in flight
  handleRewardedForeground();
  await preload;
  assert.equal(w.fake.prepareCalls().length, 1, "one native prepare only");
  handleRewardedForeground();
  assert.equal(getRewardedLifecycleState(), "ready");
  assert.equal(w.fake.prepareCalls().length, 1, "resume with a ready ad requests nothing");
});

test("(8) source guards: one AdMob.initialize in the app, and the resume hooks only refresh state/config - they never load or show", () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const setup = read("./nativeAdsSetup.ts");
  assert.equal((setup.match(/AdMob\.initialize\(/g) ?? []).length, 1, "single AdMob.initialize call site");
  assert.equal((setup.match(/registerAdAdapter\(/g) ?? []).length, 1);
  // Resume hook in nativeAdsSetup: interstitial CONFIG refresh only.
  const hook = /visibilitychange[\s\S]*?\}\);/.exec(setup)![0];
  assert.ok(hook.includes("refreshInterstitialConfigIfStale"));
  assert.equal(/preload|loadRewarded|prepare|showRewarded|initialize/i.test(hook), false);
  // Foreground hook in rewardedAds: refreshLifecycle only.
  const ra = read("./rewardedAds.ts");
  const fg = /export function handleRewardedForeground\(\): void \{([\s\S]*?)\n\}/.exec(ra)![1];
  assert.equal(fg.trim(), "refreshLifecycle();");
  // No other AdMob.initialize call anywhere in non-test app source.
  for (const f of ["./admobAdapter.ts", "./consent.ts", "./interstitialAds.ts", "./interstitialController.ts"]) {
    assert.equal(/AdMob\.initialize\(/.test(read(f)), false, f);
  }
});

// --- Offer-level: coin grant exactly once, Keep/Watch state after a dismiss -------------------------------

test("offer level: dismissed -> offer phase, no consumed double, no failure; Watch again then Keep/Continue are both reachable", async () => {
  const w = wire();
  const p = (await readyAndShow(w)).result;
  w.fake.dismiss();
  const outcome = resolveAdOutcome(await p);
  assert.deepEqual(outcome, { nextPhase: "offer", dismissed: true });
  assert.equal(consumesDoubleAttempt(outcome), false, "a dismissal costs the daily chest-double cap nothing");
  assert.equal(outcome.adUnavailable, undefined, "no 'ads aren't available' notice");
  assert.equal(outcome.grantSource, undefined);
  // The component keeps rendering Watch + Keep in the offer phase after this (source guard).
  const src = readFileSync(new URL("../../components/DoubleCoinsOffer.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(src.includes("setPhase(outcome.nextPhase);"));
  assert.ok(src.includes("setAdPending(false);"), "buttons re-enabled before the outcome is applied");
  // Cadence/exposure: the offer file never touches the cadence counter itself.
  assert.equal(/markRewardedOfferShown|recordRewardedGameCompleted/.test(src), false);
});

test("offer level: one coin grant however the earned double is settled (Continue, exit, both, late duplicate ad callbacks)", async () => {
  const base = 35;
  const w = wire();
  const credits: number[] = [];
  let offerOpen = true;
  let earnedFinalize: (() => void) | null = null;
  const settlement = createOfferSettlement(false, {
    resolveBonusRewardRound: () => undefined,
    onResolved: (finalAmount) => {
      if (offerOpen && finalAmount > base) credits.push(finalAmount - base); // ShapeChallengeScreen.handleDoubleOfferResolved
      offerOpen = false;
    },
  });
  // DoubleCoinsOffer.handleWatchAd's reward branch, driven by the real service + adapter.
  const p = (await readyAndShow(w)).result;
  w.fake.reward(5);
  w.fake.rewardEventOnly(5); // duplicate plugin callbacks
  w.fake.rewardCallOnly(5);
  const result = await p;
  const outcome = resolveAdOutcome(result);
  assert.equal(outcome.grantSource, "ad");
  const final = rewardedFinalAmount("x3", base);
  earnedFinalize = () => settlement.settle({ granted: true, finalAmount: final }, null);
  // Continue, then the screen's exit path, then Continue again.
  settlement.settle({ granted: true, finalAmount: final }, null);
  assert.equal(offerExitAction(offerOpen, earnedFinalize), "none");
  earnedFinalize();
  settlement.settle({ granted: true, finalAmount: final }, null);
  assert.deepEqual(credits, [final - base], "exactly one credit of M - N");
  assert.equal(final - base, 70);
  assert.equal(w.count("rewarded_ad_completed"), 1);
});
