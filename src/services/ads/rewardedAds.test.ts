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
  registerRemoteAdsGate,
  showRewardedAd,
  subscribeRewardedAdEvents,
} from "./rewardedAds";
import { AD_FLAGS, _setAdFlagsForTests, getAdUnitId, isAdFormatEnabled, type AdFeatureFlags } from "./adConfig";
import { REWARDED_AD_PLACEMENTS, isRewardedAdPlacement, type RewardedAdPlacement } from "./adPlacements";
import type { AdFailureReason, AdFormat, AdReward, RewardedAdLifecycleEvent } from "./adTypes";
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

test("shipped flags enable rewarded only - every other format stays off", () => {
  assert.equal(AD_FLAGS.master, true);
  assert.equal(AD_FLAGS.formats.rewarded, true);
  assert.equal(isAdFormatEnabled("rewarded"), true);
  for (const format of ALL_FORMATS) {
    if (format === "rewarded") continue;
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
  _setAdTimeoutsForTests(30, 30);
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

test("a non-Error rejection cannot crash the classifier", async () => {
  _setAdFlagsForTests(flags(true, true));
  registerAdAdapter({
    name: "throws-string",
    initialize: async () => {},
    loadRewarded: async () => {
      throw "No fill."; // eslint-disable-line no-throw-literal -- a rogue adapter may do this
    },
    showRewarded: async () => null,
  });
  const seen = recordDetailed();

  await preloadRewardedAd(PLACEMENT);

  assert.deepEqual(
    seen.filter((e) => e.event === "unavailable").map((e) => e.reason),
    ["sdk_error"],
    "only a real Error carries a message we may read",
  );
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
  assert.equal(calls.filter((c) => c === "initialize").length, 1);
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

test("when the early preload fails, the offer's own show still attempts its own load", async () => {
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

  // The fallback path: DoubleCoinsOffer's Watch Ad still loads and shows.
  const result = await showRewardedAd(PLACEMENT);
  assert.equal(result.status, "rewarded");
  assert.deepEqual(calls, ["initialize", "load:1", "load:2", "show"]);
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
