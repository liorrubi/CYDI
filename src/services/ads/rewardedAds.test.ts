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
  _setRewardedClockForTests,
  getRewardedLifecycleState,
  handleRewardedForeground,
  isRewardedAdAvailable,
  isRewardedAdReady,
  preloadRewardedAd,
  registerAdAdapter,
  registerAdConsentGate,
  registerRemoteAdsGate,
  registerRewardedLifecycleGate,
  showRewardedAd,
  subscribeRewardedAdEvents,
} from "./rewardedAds";
import { AD_FLAGS, _setAdFlagsForTests, getAdUnitId, isAdFormatEnabled, type AdFeatureFlags } from "./adConfig";
import { REWARDED_AD_PLACEMENTS, isRewardedAdPlacement, type RewardedAdPlacement } from "./adPlacements";
import type { AdFailureReason, AdFormat, AdReward, RewardedAdLifecycleEvent } from "./adTypes";
import { connectAdAnalytics, mapLifecycleToAnalytics } from "./adAnalytics";
import { REWARDED_POST_DISMISS_GRACE_MS, createAdMobAdapter } from "./admobAdapter";
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

/** Same recorder, keeping the reason too - the classification tests need it. */
function recordDetailed(): { event: RewardedAdLifecycleEvent; reason?: AdFailureReason }[] {
  const seen: { event: RewardedAdLifecycleEvent; reason?: AdFailureReason }[] = [];
  subscribeRewardedAdEvents("test-recorder", (event, detail) => seen.push({ event, reason: detail.reason }));
  return seen;
}

/** An adapter whose load always rejects with `message` - the only thing the plugin gives us. */
function registerLoadFailingAdapter(message: string): void {
  registerAdAdapter({
    name: "load-fails",
    initialize: async () => {},
    loadRewarded: async () => {
      throw new Error(message);
    },
    showRewarded: async () => null,
  });
}

beforeEach(() => {
  _resetRewardedAdsForTests();
});

afterEach(() => {
  _setAdFlagsForTests(); // restore the shipped (all-false) flags
});

// --- Feature flags ---------------------------------------------------------------

// Interstitial joined rewarded in 0.53.0 (the A/B experiment, gated by its own remote
// config in interstitialConfig.ts); every other format is still off at build time.
test("shipped flags enable rewarded and interstitial only - every other format stays off", () => {
  assert.equal(AD_FLAGS.master, true);
  assert.equal(AD_FLAGS.formats.rewarded, true);
  assert.equal(AD_FLAGS.formats.interstitial, true);
  assert.equal(isAdFormatEnabled("rewarded"), true);
  assert.equal(isAdFormatEnabled("interstitial"), true);
  for (const format of ALL_FORMATS) {
    if (format === "rewarded" || format === "interstitial") continue;
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

// The shipped-configuration counterpart to "remote-gate blocking is checked before the
// adapter" below: that one proves the gate's behavior with synthetic flags, this one
// proves the REAL AD_FLAGS (master + rewarded both on) plus the fail-closed remote gate
// the app registers when no remote config is published - i.e. exactly what an installed
// AAB does today. Neither preload nor show may touch the SDK: no adapter.initialize(),
// no load, no show.
test("with shipped flags (rewarded on) and the remote switch off, nothing reaches the SDK", async () => {
  registerRemoteAdsGate(() => false);
  const spy = makeSpyAdapter(async () => ({ type: "coins", amount: 5 }));
  assert.equal(isAdFormatEnabled("rewarded"), true, "the build must be rewarded-capable for this to prove anything");
  assert.equal(isRewardedAdAvailable(), false);
  await preloadRewardedAd(PLACEMENT);
  assert.deepEqual(await showRewardedAd(PLACEMENT), { status: "unavailable", reason: "ads_disabled" });
  assert.deepEqual(spy.calls, [], "no adapter method may run while the remote kill switch is off");
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

// --- Preload failure reporting -----------------------------------------------------
// A background preload that never fills used to fail completely silently, so ad
// requests that don't return an ad left no trace in analytics at all. It must now
// report - without double-counting the failure when a show is what triggered the load.

test("a preload whose load fails reports it as unavailable", async () => {
  _setAdFlagsForTests(flags(true, true));
  registerAdAdapter({
    name: "failing-load",
    initialize: async () => {},
    loadRewarded: async () => {
      throw new Error("no fill");
    },
    showRewarded: async () => null,
  });
  const events = recordEvents();

  await preloadRewardedAd(PLACEMENT);

  assert.ok(events.includes("unavailable"), "a failed preload must emit unavailable");
  assert.ok(!events.includes("loaded"), "a failed preload must not report a loaded ad");
  assert.equal(isRewardedAdReady(), false);
});

// --- Load-failure classification ---------------------------------------------------
//
// AdMob answers an empty auction with ERROR_CODE_NO_FILL (3), which the Capacitor
// plugin surfaces to JS only as the message "No fill." - no numeric code survives the
// bridge. That used to fall into the catch-all and report as "sdk_error", so a
// perfectly healthy integration with nothing to serve read as a broken one. These
// tests pin the three outcomes apart by the exact strings the plugin really produces.

test("an empty auction reports no_fill, not sdk_error", async () => {
  _setAdFlagsForTests(flags(true, true));
  registerLoadFailingAdapter("No fill."); // verbatim Google Mobile Ads wording for code 3
  const seen = recordDetailed();

  await preloadRewardedAd(PLACEMENT);

  assert.deepEqual(
    seen.filter((e) => e.event === "unavailable").map((e) => e.reason),
    ["no_fill"],
  );
});

test("no-fill matching survives the plugin's own punctuation and casing", async () => {
  // The bundled plugin has a legacy helper that spells it "No fill" with no period;
  // the SDK message carries one. Neither spelling may fall back to sdk_error.
  for (const message of ["No fill", "No fill.", "no fill"]) {
    _resetRewardedAdsForTests();
    _setAdFlagsForTests(flags(true, true));
    registerLoadFailingAdapter(message);
    const seen = recordDetailed();

    await preloadRewardedAd(PLACEMENT);

    assert.deepEqual(
      seen.filter((e) => e.event === "unavailable").map((e) => e.reason),
      ["no_fill"],
      message,
    );
  }
});

test("a load we abandon is still a timeout, never no_fill", async () => {
  _setAdFlagsForTests(flags(true, true));
  _setAdTimeoutsForTests({ hardLoad: 30, show: 30 });
  registerAdAdapter({
    name: "hung-load",
    initialize: async () => {},
    loadRewarded: () => new Promise(() => {}), // never settles
    showRewarded: async () => null,
  });
  const seen = recordDetailed();

  await preloadRewardedAd(PLACEMENT);

  assert.deepEqual(
    seen.filter((e) => e.event === "unavailable").map((e) => e.reason),
    ["timeout"],
  );
});

test("any other load rejection is still sdk_error", async () => {
  for (const message of ["Internal error", "Network Error", "App Id Missing", ""]) {
    _resetRewardedAdsForTests();
    _setAdFlagsForTests(flags(true, true));
    registerLoadFailingAdapter(message);
    const seen = recordDetailed();

    await preloadRewardedAd(PLACEMENT);

    assert.deepEqual(
      seen.filter((e) => e.event === "unavailable").map((e) => e.reason),
      ["sdk_error"],
      message || "(empty message)",
    );
  }
});

test("a non-Error rejection cannot crash the classifier; only an object's string message is read", async () => {
  const reasonFor = async (thrown: unknown): Promise<unknown> => {
    _resetRewardedAdsForTests();
    _setAdFlagsForTests(flags(true, true));
    registerAdAdapter({
      name: "throws-odd",
      initialize: async () => {},
      loadRewarded: async () => {
        throw thrown; // eslint-disable-line no-throw-literal -- a rogue adapter may do this
      },
      showRewarded: async () => null,
    });
    const seen = recordDetailed();
    await preloadRewardedAd(PLACEMENT);
    return seen.filter((e) => e.event === "unavailable").map((e) => e.reason);
  };
  // The adapter throws {code, message}: with no numeric code the message still classifies a no-fill.
  assert.deepEqual(await reasonFor({ message: "No fill." }), ["no_fill"]);
  assert.deepEqual(await reasonFor({ code: undefined, message: "no fill" }), ["no_fill"]);
  assert.deepEqual(await reasonFor({ message: "Internal error" }), ["sdk_error"]);
  assert.deepEqual(await reasonFor({ message: 42 }), ["sdk_error"], "a non-string message is not read");
  // The numeric code stays authoritative over the text.
  assert.deepEqual(await reasonFor({ code: 0, message: "No fill." }), ["sdk_error"]);
  assert.deepEqual(await reasonFor({ code: 3, message: "boom" }), ["no_fill"]);
  // A bare string, null, or an object with no message is not read.
  assert.deepEqual(await reasonFor("No fill."), ["sdk_error"], "a bare string is not read");
  assert.deepEqual(await reasonFor(null), ["sdk_error"]);
  assert.deepEqual(await reasonFor({}), ["sdk_error"]);
});

test("reclassifying changes the reason only - event counts and analytics shape hold", async () => {
  _setAdFlagsForTests(flags(true, true));
  registerLoadFailingAdapter("No fill.");
  const seen = recordDetailed();

  await preloadRewardedAd(PLACEMENT);

  assert.equal(seen.filter((e) => e.event === "unavailable").length, 1, "still exactly one failure event");
  assert.equal(seen.filter((e) => e.event === "loaded").length, 0, "a failed load is never a loaded ad");
  assert.equal(isRewardedAdReady(), false);

  // The analytics bridge keeps emitting the same event name, and no_fill must pass the
  // shared schema - otherwise the Worker would reject the whole event and we would lose
  // the very data this change exists to surface.
  const mapped = mapLifecycleToAnalytics("unavailable", { placement: PLACEMENT, reason: "no_fill" });
  assert.equal(mapped?.eventName, "rewarded_ad_unavailable");
  assert.equal(validateEventParams("rewarded_ad_unavailable" as AnalyticsEventName, mapped?.params).valid, true);
});

test("a successful preload reports loaded and never unavailable", async () => {
  _setAdFlagsForTests(flags(true, true));
  makeSpyAdapter(async () => ({ type: "coins", amount: 5 }));
  const events = recordEvents();

  await preloadRewardedAd(PLACEMENT);

  assert.ok(events.includes("loaded"));
  assert.ok(!events.includes("unavailable"));
});

test("a load started by showRewardedAd reports the failure exactly once", async () => {
  _setAdFlagsForTests(flags(true, true));
  registerAdAdapter({
    name: "failing-load",
    initialize: async () => {},
    loadRewarded: async () => {
      throw new Error("Internal error");
    },
    showRewarded: async () => null,
  });
  const events = recordEvents();

  const result = await showRewardedAd(PLACEMENT);

  assert.deepEqual(result, { status: "unavailable", reason: "sdk_error" });
  assert.equal(
    events.filter((e) => e === "unavailable").length,
    1,
    "showRewardedAd already reports its own failure - the load must not report it a second time",
  );
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

// --- Remote kill switch gate (fail-closed) ------------------------------------------

test("remote-gate blocking is checked before the adapter, with no SDK calls", async () => {
  _setAdFlagsForTests(flags(true, true));
  registerRemoteAdsGate(() => false);
  const spy = makeSpyAdapter(async () => ({ type: "coins", amount: 5 }));
  assert.equal(isRewardedAdAvailable(), false);
  assert.deepEqual(await showRewardedAd(PLACEMENT), { status: "unavailable", reason: "ads_disabled" });
  assert.deepEqual(spy.calls, [], "no adapter method may run while the remote kill switch blocks ad requests");
});

test("remote-gate allowing lets the normal flow proceed", async () => {
  _setAdFlagsForTests(flags(true, true));
  registerRemoteAdsGate(() => true);
  makeSpyAdapter(async () => ({ type: "coins", amount: 5 }));
  assert.deepEqual(await showRewardedAd(PLACEMENT), { status: "rewarded", reward: { type: "coins", amount: 5 } });
});

test("the remote gate resets to allowed between tests (pre-remote-switch test suite compatibility)", async () => {
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
  _setAdTimeoutsForTests({ hardLoad: 30, tapWait: 20, show: 30 });
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
  _setAdTimeoutsForTests({ show: 30 });
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

  // Without listener support, a show call that resolves with no usable reward item is a dismiss.
  const noItem = createAdMobAdapter({
    initialize: async () => undefined,
    prepareRewardVideoAd: async () => undefined,
    showRewardVideoAd: async () => undefined,
  });
  assert.equal(await noItem.showRewarded(), null);
  const zero = createAdMobAdapter({
    initialize: async () => undefined,
    prepareRewardVideoAd: async () => undefined,
    showRewardVideoAd: async () => ({ type: "coins", amount: 0 }),
  });
  assert.equal(await zero.showRewarded(), null);
});

// --- Rewarded show settlement from the plugin's events --------------------------------
//
// The real plugin resolves showRewardVideoAd() ONLY on the Reward event; Showed /
// FailedToShow / Dismissed are events and nothing else. A fake plugin below reproduces
// exactly that: the show call stays pending until reward() is called.

const EV = {
  reward: "onRewardedVideoAdReward",
  dismissed: "onRewardedVideoAdDismissed",
  failedToShow: "onRewardedVideoAdFailedToShow",
  failedToLoad: "onRewardedVideoAdFailedToLoad",
} as const;

function fakeRewardedPlugin() {
  const listeners = new Map<string, (info: unknown) => void>();
  let resolveShow: ((item: { type?: string; amount?: number } | undefined) => void) | null = null;
  let rejectShow: ((err: unknown) => void) | null = null;
  let showCalls = 0;
  const plugin = {
    initialize: async () => undefined,
    prepareRewardVideoAd: async () => undefined,
    showRewardVideoAd: () => {
      showCalls++;
      return new Promise<{ type?: string; amount?: number } | undefined>((resolve, reject) => {
        resolveShow = resolve;
        rejectShow = reject;
      });
    },
    addListener: async (name: string, fn: (info: unknown) => void) => {
      listeners.set(name, fn);
    },
  };
  return {
    plugin,
    emit: (name: string, info?: unknown) => listeners.get(name)?.(info),
    /** What the plugin does on a real reward: the Reward event, then the call resolves with the item. */
    reward: (amount = 5) => {
      listeners.get(EV.reward)?.({ type: "coins", amount });
      resolveShow?.({ type: "coins", amount });
    },
    rejectCall: (err: unknown) => rejectShow?.(err),
    showCalls: () => showCalls,
  };
}

/** Track what a show promise settled with, without awaiting it. */
function trackShow(p: Promise<AdReward | null>) {
  const out: { settled: number; value?: AdReward | null; error?: unknown } = { settled: 0 };
  p.then(
    (value) => {
      out.settled++;
      out.value = value;
    },
    (error) => {
      out.settled++;
      out.error = error;
    },
  );
  return out;
}

const terminalEvents = (seen: { event: RewardedAdLifecycleEvent }[]) =>
  seen.filter((e) => e.event === "rewarded" || e.event === "dismissed" || e.event === "error").map((e) => e.event);

test("the post-dismiss grace is a single exported constant, 1500 ms by default (unvalidated on device)", () => {
  assert.equal(REWARDED_POST_DISMISS_GRACE_MS, 1500);
});

test("dismissed without a reward settles as dismissed (null) after the grace, and the plugin call never settles", async () => {
  const fake = fakeRewardedPlugin();
  const adapter = createAdMobAdapter(fake.plugin, { postDismissGraceMs: 20 });
  const show = trackShow(adapter.showRewarded());
  fake.emit(EV.dismissed);
  await tick(5);
  assert.equal(show.settled, 0, "waits the grace for a late reward");
  await tick(40);
  assert.equal(show.settled, 1);
  assert.equal(show.value, null);
});

test("reward then dismissed: exactly one reward, the later Dismissed is ignored", async () => {
  const fake = fakeRewardedPlugin();
  const adapter = createAdMobAdapter(fake.plugin, { postDismissGraceMs: 20 });
  const show = trackShow(adapter.showRewarded());
  fake.reward(5);
  fake.emit(EV.dismissed);
  await tick(40);
  assert.equal(show.settled, 1);
  assert.deepEqual(show.value, { type: "coins", amount: 5 });
  fake.emit(EV.reward, { type: "coins", amount: 5 }); // a duplicate reward event
  await tick(5);
  assert.equal(show.settled, 1);
});

test("dismissed then a late reward inside the grace window grants the reward", async () => {
  const fake = fakeRewardedPlugin();
  const adapter = createAdMobAdapter(fake.plugin, { postDismissGraceMs: 50 });
  const show = trackShow(adapter.showRewarded());
  fake.emit(EV.dismissed);
  await tick(10);
  fake.emit(EV.reward, { type: "coins", amount: 7 });
  await tick(5);
  assert.equal(show.settled, 1);
  assert.deepEqual(show.value, { type: "coins", amount: 7 });
  await tick(70);
  assert.equal(show.settled, 1, "the grace timer must not settle a second time");
});

test("a reward arriving after the grace window is ignored", async () => {
  const fake = fakeRewardedPlugin();
  const adapter = createAdMobAdapter(fake.plugin, { postDismissGraceMs: 15 });
  const show = trackShow(adapter.showRewarded());
  fake.emit(EV.dismissed);
  await tick(40);
  assert.equal(show.value, null);
  fake.reward(5);
  await tick(5);
  assert.equal(show.settled, 1);
  assert.equal(show.value, null, "too late: the show already ended as dismissed");
});

test("FailedToShow rejects with the code and message, once", async () => {
  const fake = fakeRewardedPlugin();
  const adapter = createAdMobAdapter(fake.plugin, { postDismissGraceMs: 10 });
  const show = trackShow(adapter.showRewarded());
  fake.emit(EV.failedToShow, { code: 0, message: "Internal error" });
  await tick(5);
  assert.equal(show.settled, 1);
  assert.deepEqual(show.error, { code: 0, message: "Internal error" });
  fake.emit(EV.dismissed);
  fake.emit(EV.failedToShow, { code: 1 });
  await tick(30);
  assert.equal(show.settled, 1);
});

test("a rejected show call (nothing prepared) rejects, but not once the ad was already dismissed", async () => {
  const noAd = fakeRewardedPlugin();
  const adapter = createAdMobAdapter(noAd.plugin, { postDismissGraceMs: 10 });
  const show = trackShow(adapter.showRewarded());
  noAd.rejectCall(new Error("No Reward Video Ad can be shown."));
  await tick(5);
  assert.equal(show.settled, 1);
  assert.equal((show.error as { message?: string }).message, "No Reward Video Ad can be shown.");

  const dismissedFirst = fakeRewardedPlugin();
  const adapter2 = createAdMobAdapter(dismissedFirst.plugin, { postDismissGraceMs: 10 });
  const show2 = trackShow(adapter2.showRewarded());
  dismissedFirst.emit(EV.dismissed);
  dismissedFirst.rejectCall(new Error("late"));
  await tick(30);
  assert.equal(show2.settled, 1);
  assert.equal(show2.value, null, "a dismiss is not turned into a failure");
});

test("events with no pending show, after settlement, or from an older show are ignored", async () => {
  const fake = fakeRewardedPlugin();
  const adapter = createAdMobAdapter(fake.plugin, { postDismissGraceMs: 10 });
  // Before any show: nothing is pending, nothing throws.
  fake.emit(EV.reward, { type: "coins", amount: 5 });
  fake.emit(EV.dismissed);
  fake.emit(EV.failedToShow, { code: 3 });
  await tick(20);
  // The first show ends as dismissed; the pre-show stragglers above did not touch it.
  const first = trackShow(adapter.showRewarded());
  await tick(5);
  assert.equal(first.settled, 0, "stale events from before the show changed nothing");
  fake.emit(EV.dismissed);
  await tick(30);
  assert.equal(first.value, null);
  // A late Reward from that finished show finds no pending show...
  fake.emit(EV.reward, { type: "coins", amount: 5 });
  const second = trackShow(adapter.showRewarded());
  await tick(5);
  assert.equal(second.settled, 0, "...and so cannot settle the next show");
  fake.emit(EV.failedToShow, { code: 2 }); // genuinely the second show's own failure
  await tick(5);
  assert.equal(second.settled, 1);
  assert.equal(first.settled, 1);
  // A show started while an older one is still pending closes the older one out as dismissed.
  const third = trackShow(adapter.showRewarded());
  const fourth = trackShow(adapter.showRewarded());
  await tick(5);
  assert.equal(third.settled, 1);
  assert.equal(third.value, null);
  fake.reward(9);
  await tick(5);
  assert.deepEqual(fourth.value, { type: "coins", amount: 9 });
});

test("through the service: a dismissed ad ends promptly as 'dismissed' (not error) with exactly one terminal event", async () => {
  _setAdFlagsForTests(flags(true, true));
  const fake = fakeRewardedPlugin();
  registerAdAdapter(createAdMobAdapter(fake.plugin, { postDismissGraceMs: 10 }));
  const seen = recordFull();
  await preloadRewardedAd(PLACEMENT);
  const resultPromise = showRewardedAd(PLACEMENT);
  await tick(5);
  fake.emit(EV.dismissed);
  const result = await resultPromise;
  assert.deepEqual(result, { status: "dismissed" });
  assert.deepEqual(terminalEvents(seen), ["dismissed"], "one terminal outcome");
  assert.equal(getRewardedLifecycleState(), "idle", "state is released");
  // The plugin call is still pending forever (that is the real plugin) - nothing later may add events.
  fake.emit(EV.reward, { type: "coins", amount: 5 });
  await tick(20);
  assert.deepEqual(terminalEvents(seen), ["dismissed"]);
});

test("through the service: reward-then-dismissed grants once; FailedToShow is an error", async () => {
  _setAdFlagsForTests(flags(true, true));
  const rewarded = fakeRewardedPlugin();
  registerAdAdapter(createAdMobAdapter(rewarded.plugin, { postDismissGraceMs: 10 }));
  const seen = recordFull();
  await preloadRewardedAd(PLACEMENT);
  const p = showRewardedAd(PLACEMENT);
  await tick(5);
  rewarded.reward(5);
  rewarded.emit(EV.dismissed);
  assert.deepEqual(await p, { status: "rewarded", reward: { type: "coins", amount: 5 } });
  await tick(20);
  assert.deepEqual(terminalEvents(seen), ["rewarded"]);

  _resetRewardedAdsForTests();
  _setAdFlagsForTests(flags(true, true));
  const failing = fakeRewardedPlugin();
  registerAdAdapter(createAdMobAdapter(failing.plugin, { postDismissGraceMs: 10 }));
  const seen2 = recordFull();
  await preloadRewardedAd(PLACEMENT);
  const p2 = showRewardedAd(PLACEMENT);
  await tick(5);
  failing.emit(EV.failedToShow, { code: 0, message: "Internal error" });
  assert.deepEqual(await p2, { status: "error", reason: "sdk_error" });
  assert.deepEqual(terminalEvents(seen2), ["error"]);
});

test("the AdMob adapter keeps the plugin's rejection message on a failed load (classification only) and the service reads it", async () => {
  _setAdFlagsForTests(flags(true, true));
  const plugin = {
    initialize: async () => undefined,
    prepareRewardVideoAd: async () => {
      throw new Error("No fill.");
    },
    showRewardVideoAd: async () => undefined,
    addListener: async () => undefined, // FailedToLoad never fires
  };
  const adapter = createAdMobAdapter(plugin);
  await assert.rejects(adapter.loadRewarded("unit"), (e: { code?: number; message?: string }) => e.code === undefined && e.message === "No fill.");
  registerAdAdapter(adapter);
  const seen = recordDetailed();
  const tracked: { eventName: AnalyticsEventName; params: unknown }[] = [];
  connectAdAnalytics((eventName, params) => tracked.push({ eventName, params }));
  await preloadRewardedAd(PLACEMENT);
  assert.deepEqual(seen.filter((e) => e.event === "unavailable").map((e) => e.reason), ["no_fill"]);
  assert.equal(JSON.stringify(tracked).includes("No fill"), false, "the message is never sent to analytics");
  const long = createAdMobAdapter({ ...plugin, prepareRewardVideoAd: async () => { throw new Error("x".repeat(5000)); } });
  await assert.rejects(long.loadRewarded("unit"), (e: { message?: string }) => (e.message ?? "").length <= 200);
});

// --- Early preload (ShapeChallengeScreen warms the ad at drawing start) --------------
//
// The offer's own preload runs from DoubleCoinsOffer's mount effect, i.e. once the
// offer is already on screen. ShapeChallengeScreen now also preloads at the
// preview -> drawing transition, so the load has the whole drawing phase to finish.
// These tests pin the properties that make having BOTH call sites safe.

test("two preloads for one round issue exactly one adapter load", async () => {
  const { calls } = makeSpyAdapter(async () => null);
  // Drawing starts (screen), then the offer mounts and preloads again.
  await preloadRewardedAd(PLACEMENT);
  await preloadRewardedAd(PLACEMENT);
  assert.deepEqual(calls.filter((c) => c.startsWith("load:")).length, 1);
  // The SDK is initialized exactly once, by nativeAdsSetup, BEFORE the adapter is registered
  // (with the Teen content-rating cap) - the service never calls adapter.initialize() again.
  assert.equal(calls.filter((c) => c === "initialize").length, 0);
});

test("concurrent preloads share one in-flight request", async () => {
  const { calls } = makeSpyAdapter(async () => null);
  await Promise.all([preloadRewardedAd(PLACEMENT), preloadRewardedAd(PLACEMENT), preloadRewardedAd(PLACEMENT)]);
  assert.equal(calls.filter((c) => c.startsWith("load:")).length, 1);
});

test("an early preload leaves the ad ready, and the later show reuses it without loading again", async () => {
  const { calls } = makeSpyAdapter(async () => ({ type: "coins", amount: 10 }));
  await preloadRewardedAd(PLACEMENT);
  assert.equal(isRewardedAdReady(), true, "ad must survive from drawing start to the offer");
  const loadsBeforeShow = calls.filter((c) => c.startsWith("load:")).length;

  const result = await showRewardedAd(PLACEMENT);
  assert.equal(result.status, "rewarded");
  assert.equal(calls.filter((c) => c.startsWith("load:")).length, loadsBeforeShow, "show must not re-load");
});

test("a ready ad is not consumed by anything other than a show", async () => {
  makeSpyAdapter(async () => null);
  await preloadRewardedAd(PLACEMENT);
  // Stand-ins for everything that happens between drawing and the result screen.
  assert.equal(isRewardedAdAvailable(), true);
  assert.equal(isRewardedAdReady(), true);
  assert.equal(isRewardedAdReady(), true);
});

test("an early preload never requests before UMP consent allows it", async () => {
  const { calls } = makeSpyAdapter(async () => null);
  registerAdConsentGate(() => false);
  const events = recordEvents();

  await preloadRewardedAd(PLACEMENT);

  assert.deepEqual(calls, [], "no initialize, no load - nothing may reach the SDK");
  assert.deepEqual(events, [], "a blocked preload is silent; it is not a failed request");
  assert.equal(isRewardedAdReady(), false);
});

test("an early preload is blocked by the remote kill switch too", async () => {
  const { calls } = makeSpyAdapter(async () => null);
  registerRemoteAdsGate(() => false);
  await preloadRewardedAd(PLACEMENT);
  assert.deepEqual(calls, []);
});

test("on web (no adapter registered) the early preload is a silent no-op", async () => {
  const events = recordEvents();
  await preloadRewardedAd(PLACEMENT);
  assert.deepEqual(events, [], "web must stay exactly as it was: no request, no lifecycle event");
  assert.equal(isRewardedAdReady(), false);
});

test("when the early preload fails, the offer's tap fails fast; the next preload (after the cooldown) tries again", async () => {
  let attempt = 0;
  const calls: string[] = [];
  registerAdAdapter({
    name: "flaky",
    initialize: async () => {
      calls.push("initialize");
    },
    loadRewarded: async () => {
      attempt += 1;
      calls.push(`load:${attempt}`);
      if (attempt === 1) throw new Error("no fill");
    },
    showRewarded: async () => {
      calls.push("show");
      return { type: "coins", amount: 3 };
    },
  });

  await preloadRewardedAd(PLACEMENT);
  assert.equal(isRewardedAdReady(), false, "the early preload failed");

  // v2: a failed preload means the tap fails fast (clean UX, no 20-30 s wait), without a new request.
  const fast = await showRewardedAd(PLACEMENT);
  assert.deepEqual(fast, { status: "unavailable", reason: "no_fill" });
  assert.deepEqual(calls, ["load:1"], "the tap started no load");

  // The offer's own preload runs again once the cooldown has passed, and then the tap succeeds.
  _setAdTimeoutsForTests({ failedCooldown: 0 });
  await preloadRewardedAd(PLACEMENT);
  const result = await showRewardedAd(PLACEMENT);
  assert.equal(result.status, "rewarded");
  assert.deepEqual(calls, ["load:1", "load:2", "show"]);
});

test("a failed early preload is reported once, not swallowed and not double-counted", async () => {
  registerAdAdapter({
    name: "failing",
    initialize: async () => undefined,
    loadRewarded: async () => {
      throw new Error("no fill");
    },
    showRewarded: async () => null,
  });
  const events = recordEvents();
  await preloadRewardedAd(PLACEMENT);
  assert.equal(events.filter((e) => e === "unavailable").length, 1);
  assert.equal(events.filter((e) => e === "shown").length, 0, "a preload must never show an ad");
});

test("preload never shows an ad by itself", async () => {
  const { calls } = makeSpyAdapter(async () => ({ type: "coins", amount: 1 }));
  await preloadRewardedAd(PLACEMENT);
  assert.equal(calls.includes("show"), false);
});

// --- 0.56 rewarded lifecycle v2 -------------------------------------------------------------------

type PendingLoad = { resolve: () => void; reject: (err: unknown) => void };

/** An adapter whose every load stays pending until the test settles it - the way to drive races. */
function controlledAdapter(showResult: () => Promise<AdReward | null> = async () => ({ type: "coins", amount: 3 })) {
  const loads: PendingLoad[] = [];
  const calls: string[] = [];
  registerAdAdapter({
    name: "controlled",
    initialize: async () => {
      calls.push("initialize");
    },
    loadRewarded: () => {
      calls.push("load");
      return new Promise<void>((resolve, reject) => {
        loads.push({ resolve, reject });
      });
    },
    showRewarded: () => {
      calls.push("show");
      return showResult();
    },
  });
  return { loads, calls };
}

const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));
type Seen = { event: RewardedAdLifecycleEvent; detail: Record<string, unknown> };
function recordFull(): Seen[] {
  const seen: Seen[] = [];
  subscribeRewardedAdEvents("test-recorder", (event, detail) => seen.push({ event, detail: { ...detail } }));
  return seen;
}

test("idle -> loading -> ready -> show: the preload never blocks, a ready tap shows at once", async () => {
  const { loads, calls } = controlledAdapter();
  const seen = recordFull();
  assert.equal(getRewardedLifecycleState(), "idle");
  const preload = preloadRewardedAd(PLACEMENT);
  assert.equal(getRewardedLifecycleState(), "loading");
  assert.equal(isRewardedAdReady(), false);
  loads[0].resolve();
  await preload;
  assert.equal(getRewardedLifecycleState(), "ready");
  const result = await showRewardedAd(PLACEMENT);
  assert.equal(result.status, "rewarded");
  assert.deepEqual(calls, ["load", "show"]);
  assert.equal(getRewardedLifecycleState(), "idle", "the ad is consumed");
  const requested = seen.find((e) => e.event === "requested")!;
  assert.equal(requested.detail.stateAtTap, "ready");
  const loaded = seen.find((e) => e.event === "loaded")!;
  assert.equal(loaded.detail.source, "preload");
  assert.equal(loaded.detail.latency, "lt5s");
});

test("a failed preload is reported once with source, numeric code and latency; the tap then fails fast without repeating it", async () => {
  const { loads, calls } = controlledAdapter();
  const seen = recordFull();
  const preload = preloadRewardedAd(PLACEMENT);
  loads[0].reject({ code: 3 });
  await preload;
  assert.equal(getRewardedLifecycleState(), "failed");
  const failure = seen.filter((e) => e.event === "unavailable");
  assert.equal(failure.length, 1);
  assert.deepEqual(failure[0].detail, { placement: PLACEMENT, reason: "no_fill", source: "preload", code: 3, latency: "lt5s" });

  const started = Date.now();
  const result = await showRewardedAd(PLACEMENT);
  assert.deepEqual(result, { status: "unavailable", reason: "no_fill" });
  assert.ok(Date.now() - started < 50, "fail fast - no wait");
  assert.deepEqual(calls, ["load"], "the tap started no new load");
  const tap = seen.filter((e) => e.event === "unavailable")[1];
  assert.deepEqual(tap.detail, { placement: PLACEMENT, reason: "no_fill", stateAtTap: "failed", cause: "failed" });
});

test("numeric GMA codes drive the classification: 3 and 9 are no_fill, any other code is sdk_error, and the code is kept", async () => {
  for (const [code, reason] of [[3, "no_fill"], [9, "no_fill"], [2, "sdk_error"], [0, "sdk_error"]] as const) {
    _resetRewardedAdsForTests();
    const { loads } = controlledAdapter();
    const seen = recordFull();
    const preload = preloadRewardedAd(PLACEMENT);
    loads[0].reject({ code });
    await preload;
    const e = seen.find((s) => s.event === "unavailable")!;
    assert.equal(e.detail.reason, reason, `code ${code}`);
    assert.equal(e.detail.code, code);
  }
});

test("a late success - after the old 8 s boundary but inside the hard expiry - is accepted and usable by the next tap", async () => {
  _setAdTimeoutsForTests({ hardLoad: 2000, tapWait: 20 });
  const { loads } = controlledAdapter();
  const preload = preloadRewardedAd(PLACEMENT);
  // A tap that cannot wait gives up quickly but must not cancel the load.
  const early = await showRewardedAd(PLACEMENT);
  assert.deepEqual(early, { status: "unavailable", reason: "timeout" });
  assert.equal(getRewardedLifecycleState(), "loading", "the load keeps going");
  await tick(60);
  loads[0].resolve();
  await preload;
  assert.equal(getRewardedLifecycleState(), "ready", "accepted late");
  assert.equal((await showRewardedAd(PLACEMENT)).status, "rewarded");
});

test("a success after the hard expiry is rejected: the state stays failed and nothing is revived", async () => {
  _setAdTimeoutsForTests({ hardLoad: 30 });
  const { loads } = controlledAdapter();
  const seen = recordFull();
  await preloadRewardedAd(PLACEMENT); // resolves when the hard expiry abandons the load
  assert.equal(getRewardedLifecycleState(), "failed");
  loads[0].resolve();
  await tick();
  assert.equal(getRewardedLifecycleState(), "failed", "stale success ignored");
  assert.equal(seen.filter((e) => e.event === "loaded").length, 0);
  assert.deepEqual(seen.filter((e) => e.event === "unavailable").map((e) => e.detail.reason), ["timeout"], "reported once");
});

test("stale callbacks from an abandoned load can not touch the next load's state", async () => {
  _setAdTimeoutsForTests({ hardLoad: 30, failedCooldown: 0 });
  const { loads } = controlledAdapter();
  await preloadRewardedAd(PLACEMENT); // load 0 abandoned at the hard expiry
  const second = preloadRewardedAd(PLACEMENT);
  assert.equal(getRewardedLifecycleState(), "loading");
  loads[0].reject({ code: 3 }); // stale rejection
  loads[0].resolve(); // and a stale success
  await tick();
  assert.equal(getRewardedLifecycleState(), "loading", "still the second load's state");
  loads[1].resolve();
  await second;
  assert.equal(getRewardedLifecycleState(), "ready");
});

test("never two loads in flight: repeated preloads and a tap while loading start nothing new", async () => {
  _setAdTimeoutsForTests({ tapWait: 10 });
  const { loads, calls } = controlledAdapter();
  void preloadRewardedAd(PLACEMENT);
  void preloadRewardedAd(PLACEMENT);
  await showRewardedAd(PLACEMENT); // loading: waits briefly, then gives up
  void preloadRewardedAd(PLACEMENT);
  assert.equal(calls.filter((c) => c === "load").length, 1);
  loads[0].resolve();
  await tick();
  assert.equal(getRewardedLifecycleState(), "ready");
  void preloadRewardedAd(PLACEMENT);
  assert.equal(calls.filter((c) => c === "load").length, 1, "no refresh while an ad is loaded");
});

test("tap while loading: a short bounded wait, then it shows if the ad arrived and gives up cleanly if not", async () => {
  _setAdTimeoutsForTests({ tapWait: 200 });
  const { loads } = controlledAdapter();
  void preloadRewardedAd(PLACEMENT);
  const tap = showRewardedAd(PLACEMENT);
  await tick(10);
  loads[0].resolve();
  assert.equal((await tap).status, "rewarded", "arrived inside the wait");

  _resetRewardedAdsForTests();
  _setAdTimeoutsForTests({ tapWait: 25 });
  controlledAdapter();
  const seen = recordFull();
  void preloadRewardedAd(PLACEMENT);
  const started = Date.now();
  assert.deepEqual(await showRewardedAd(PLACEMENT), { status: "unavailable", reason: "timeout" });
  assert.ok(Date.now() - started < 200, "bounded");
  const e = seen.filter((s) => s.event === "unavailable").at(-1)!;
  assert.equal(e.detail.stateAtTap, "loading");
  assert.equal(e.detail.cause, "loading");
  assert.equal(e.detail.source, "click");
});

test("tap with nothing attempted: one load is started for it, the wait is bounded, the cause is not_attempted", async () => {
  _setAdTimeoutsForTests({ tapWait: 20 });
  const { calls } = controlledAdapter();
  const seen = recordFull();
  assert.deepEqual(await showRewardedAd(PLACEMENT), { status: "unavailable", reason: "timeout" });
  assert.equal(calls.filter((c) => c === "load").length, 1);
  const e = seen.filter((s) => s.event === "unavailable").at(-1)!;
  assert.deepEqual([e.detail.stateAtTap, e.detail.cause], ["idle", "not_attempted"]);
});

test("blocked at the tap (consent): immediate unavailable with cause blocked, nothing reaches the SDK", async () => {
  const { calls } = controlledAdapter();
  registerAdConsentGate(() => false);
  const seen = recordFull();
  assert.deepEqual(await showRewardedAd(PLACEMENT), { status: "unavailable", reason: "consent_blocked" });
  assert.deepEqual(calls, []);
  assert.equal(seen.find((s) => s.event === "unavailable")!.detail.cause, "blocked");
});

test("a loaded ad expires after its TTL: not ready, tap fails fast with cause expired, the next preload refreshes it", async () => {
  let clock = 1_000_000;
  _setRewardedClockForTests(() => clock);
  _setAdTimeoutsForTests({ readyTtl: 60_000 });
  const { loads, calls } = controlledAdapter();
  const seen = recordFull();
  const preload = preloadRewardedAd(PLACEMENT);
  loads[0].resolve();
  await preload;
  assert.equal(isRewardedAdReady(), true);
  clock += 59_999;
  assert.equal(isRewardedAdReady(), true);
  clock += 1;
  assert.equal(isRewardedAdReady(), false);
  assert.equal(getRewardedLifecycleState(), "expired");
  assert.deepEqual(await showRewardedAd(PLACEMENT), { status: "unavailable", reason: "load_failed" });
  assert.equal(calls.includes("show"), false, "an expired ad is never shown");
  const e = seen.filter((s) => s.event === "unavailable").at(-1)!;
  assert.deepEqual([e.detail.stateAtTap, e.detail.cause], ["expired", "expired"]);
  void preloadRewardedAd(PLACEMENT);
  assert.equal(calls.filter((c) => c === "load").length, 2, "one refresh, only when asked to preload");
});

test("foreground: a load that outlived the hard expiry while the app was away is abandoned, and its later callback is ignored", async () => {
  let clock = 5_000;
  _setRewardedClockForTests(() => clock);
  _setAdTimeoutsForTests({ hardLoad: 75_000 });
  const { loads } = controlledAdapter();
  void preloadRewardedAd(PLACEMENT);
  assert.equal(getRewardedLifecycleState(), "loading");
  clock += 80_000; // the WebView was frozen: its timers never fired
  handleRewardedForeground();
  assert.equal(getRewardedLifecycleState(), "failed");
  loads[0].resolve();
  await tick();
  assert.equal(getRewardedLifecycleState(), "failed", "the old callback does not revive it");
});

test("foreground does not start any request by itself", () => {
  const { calls } = controlledAdapter();
  handleRewardedForeground();
  assert.deepEqual(calls, []);
});

test("an automatic preload waits out the failure cooldown (no churn on no_fill)", async () => {
  let clock = 1000;
  _setRewardedClockForTests(() => clock);
  const { loads, calls } = controlledAdapter();
  const first = preloadRewardedAd(PLACEMENT);
  loads[0].reject({ code: 3 });
  await first;
  void preloadRewardedAd(PLACEMENT);
  assert.equal(calls.filter((c) => c === "load").length, 1, "inside the cooldown");
  clock += 15_000;
  void preloadRewardedAd(PLACEMENT);
  assert.equal(calls.filter((c) => c === "load").length, 2, "after the cooldown");
});

test("kill switch off = the 0.55 behavior: a failed state does not fail fast, the tap loads and waits for it", async () => {
  registerRewardedLifecycleGate(() => false);
  let attempt = 0;
  registerAdAdapter({
    name: "legacy",
    initialize: async () => {},
    loadRewarded: async () => {
      attempt += 1;
      if (attempt === 1) throw { code: 3 };
    },
    showRewarded: async () => ({ type: "coins", amount: 3 }),
  });
  await preloadRewardedAd(PLACEMENT);
  assert.equal(isRewardedAdReady(), false);
  const result = await showRewardedAd(PLACEMENT);
  assert.equal(result.status, "rewarded", "the tap made its own load, as in 0.55");
  assert.equal(attempt, 2);
});

test("kill switch off: the old 8 s load window applies (checked with a scaled clock)", async () => {
  registerRewardedLifecycleGate(() => false);
  let clock = 0;
  _setRewardedClockForTests(() => clock);
  controlledAdapter();
  void preloadRewardedAd(PLACEMENT);
  clock += 7_999;
  assert.equal(getRewardedLifecycleState(), "loading");
  clock += 1;
  assert.equal(getRewardedLifecycleState(), "failed", "8 s, as in 0.55");
});

test("the lifecycle has no notion of the experiment arm: identical scenarios give identical events whatever the placement", async () => {
  const runScenario = async (placement: RewardedAdPlacement) => {
    _resetRewardedAdsForTests();
    const { loads } = controlledAdapter();
    const seen: string[] = [];
    subscribeRewardedAdEvents("t", (event, detail) => seen.push(`${event}:${detail.reason ?? ""}:${detail.stateAtTap ?? ""}:${detail.source ?? ""}`));
    const preload = preloadRewardedAd(placement);
    loads[0].resolve();
    await preload;
    await showRewardedAd(placement);
    return seen;
  };
  assert.deepEqual(await runScenario("shape_challenge_double_reward"), await runScenario("daily_retry"));
});

test("source guard: rewardedAds.ts knows nothing about the x3 / +100 experiment, and only nativeAdsSetup registers an adapter after initialize", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const dir = new URL(".", import.meta.url);
  const source = readFileSync(new URL("rewardedAds.ts", dir), "utf8");
  assert.equal(/plus100|x3|rewardedOfferCadence|experiment/i.test(source.replace(/\/\/.*$/gm, "")), false, "no experiment knowledge in the lifecycle code");
  assert.equal(/adapter\.initialize\(/.test(source), false, "the service never initializes the SDK a second time");
  const code = (text: string) => text.replace(/\/\/.*$/gm, "");
  const callers = readdirSync(new URL("..", dir), { recursive: true } as never)
    .map((f) => String(f).split("\\").join("/"))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) && f !== "ads/rewardedAds.ts")
    .filter((f) => /registerAdAdapter\(/.test(code(readFileSync(new URL(`../${f}`, dir), "utf8"))));
  assert.deepEqual(callers, ["ads/nativeAdsSetup.ts"]);
  const setup = readFileSync(new URL("nativeAdsSetup.ts", dir), "utf8");
  assert.ok(setup.indexOf("await AdMob.initialize(") < setup.indexOf("registerAdAdapter(createAdMobAdapter"), "SDK init precedes any adapter registration");
});

test("the diagnostics ride on existing events and are schema-valid", async () => {
  const { loads } = controlledAdapter();
  const tracked: { eventName: AnalyticsEventName; params: unknown }[] = [];
  connectAdAnalytics((eventName, params) => tracked.push({ eventName, params }));
  const preload = preloadRewardedAd(PLACEMENT);
  loads[0].reject({ code: 3 });
  await preload;
  await showRewardedAd(PLACEMENT);
  assert.deepEqual(
    tracked.map((t) => t.eventName),
    ["rewarded_ad_unavailable", "rewarded_ad_requested", "rewarded_ad_unavailable"],
    "no new event names; one failure record per failed load plus the tap's own",
  );
  for (const t of tracked) assert.equal(validateEventParams(t.eventName, t.params).valid, true, `${t.eventName} invalid: ${JSON.stringify(t.params)}`);
});

test("the AdMob adapter carries the numeric FailedToLoad code on a rejected load, and ignores a show-time FailedToLoad", async () => {
  const listeners = new Map<string, (info: unknown) => void>();
  const plugin = {
    initialize: async () => undefined,
    prepareRewardVideoAd: async () => {
      listeners.get("onRewardedVideoAdFailedToLoad")?.({ code: 3, message: "No fill." });
      throw new Error("No fill.");
    },
    showRewardVideoAd: async () => undefined,
    addListener: async (name: string, fn: (info: unknown) => void) => {
      listeners.set(name, fn);
    },
  };
  const adapter = createAdMobAdapter(plugin);
  await assert.rejects(adapter.loadRewarded("unit"), (e: { code?: number }) => e.code === 3);
  // A FailedToLoad with no load pending (the plugin sends code -1 when a show finds nothing prepared) changes nothing.
  listeners.get("onRewardedVideoAdFailedToLoad")?.({ code: -1 });
  const noEvent = createAdMobAdapter({ ...plugin, prepareRewardVideoAd: async () => { throw new Error("x"); }, addListener: async () => undefined });
  await assert.rejects(noEvent.loadRewarded("unit"), (e: { code?: number }) => e.code === undefined);
});
