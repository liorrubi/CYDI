// The interstitial ad service against a fake adapter, a fake clock and a fake page
// visibility. Proves: one load at a time, numeric-code classification, a late Loaded
// never shows anything, not_ready never waits, "shown" only from the real Showed
// callback, and gameplay is released exactly once - never by Showed alone.

import { strict as assert } from "node:assert";
import { test, beforeEach } from "node:test";

import {
  _resetInterstitialAdsForTests,
  _setInterstitialTimeoutsForTests,
  classifyInterstitialLoadError,
  getInterstitialState,
  preloadInterstitial,
  presentInterstitial,
  registerInterstitialAdapter,
  registerInterstitialGates,
  subscribeInterstitialLifecycle,
  type InterstitialEnv,
  type InterstitialLifecycleEvent,
  type InterstitialNativeEvent,
  type PresentOutcome,
} from "./interstitialAds";

// --- Fakes --------------------------------------------------------------------------

function fakeEnv() {
  let now = 0;
  let nextId = 0;
  let hidden = false;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const visibility = new Set<() => void>();
  const env: InterstitialEnv = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = ++nextId;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
    isHidden: () => hidden,
    onVisibilityChange: (listener) => {
      visibility.add(listener);
      return () => visibility.delete(listener);
    },
    platform: () => "android",
  };
  return {
    env,
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now && timers.has(id)) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    setHidden(value: boolean) {
      hidden = value;
      for (const listener of [...visibility]) listener();
    },
    pendingTimers: () => timers.size,
    visibilityListeners: () => visibility.size,
  };
}

function fakeAdapter() {
  const calls = { load: 0, show: 0 };
  let listener: (event: InterstitialNativeEvent) => void = () => {};
  let loadControl: { resolve: () => void; reject: (err: unknown) => void } | null = null;
  let showImpl: () => Promise<void> = () => Promise.resolve();
  registerInterstitialAdapter({
    name: "fake",
    load: () => {
      calls.load++;
      return new Promise<void>((resolve, reject) => {
        loadControl = { resolve, reject };
      });
    },
    show: () => {
      calls.show++;
      return showImpl();
    },
    setListener: (next) => {
      listener = next;
    },
  });
  return {
    calls,
    resolveLoad: () => loadControl?.resolve(),
    rejectLoad: (code?: number) => loadControl?.reject({ code }),
    fire: (event: InterstitialNativeEvent) => listener(event),
    setShow: (impl: () => Promise<void>) => {
      showImpl = impl;
    },
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

let clock: ReturnType<typeof fakeEnv>;
let events: InterstitialLifecycleEvent[];

beforeEach(() => {
  clock = fakeEnv();
  _resetInterstitialAdsForTests(clock.env);
  registerInterstitialGates({ consent: () => true, remoteAds: () => true, interstitialEnabled: () => true });
  events = [];
  subscribeInterstitialLifecycle("test", (e) => events.push(e));
});

async function readyAd() {
  const ad = fakeAdapter();
  assert.equal(preloadInterstitial(), true);
  ad.resolveLoad();
  await flush();
  assert.equal(getInterstitialState(), "ready");
  return ad;
}

function present() {
  const outcomes: PresentOutcome[] = [];
  let released = false;
  const release = presentInterstitial({ onOutcome: (o) => outcomes.push(o) });
  void release?.then(() => {
    released = true;
  });
  return { outcomes, release, isReleased: () => released };
}

// --- Loading / state ----------------------------------------------------------------

test("idle -> loading -> ready; a second preload while loading or ready starts nothing", async () => {
  const ad = fakeAdapter();
  assert.equal(getInterstitialState(), "idle");
  assert.equal(preloadInterstitial(), true);
  assert.equal(getInterstitialState(), "loading");
  assert.equal(preloadInterstitial(), false, "no concurrent duplicate load");
  ad.resolveLoad();
  await flush();
  assert.equal(getInterstitialState(), "ready");
  assert.equal(preloadInterstitial(), false, "no load while one is cached");
  assert.equal(ad.calls.load, 1);
  assert.equal(ad.calls.show, 0, "a load never shows anything");
});

test("a failed load returns to idle and reports a bounded reason from the numeric code", async () => {
  const ad = fakeAdapter();
  preloadInterstitial();
  ad.rejectLoad(3);
  await flush();
  assert.equal(getInterstitialState(), "idle");
  assert.deepEqual(events.at(-1), { type: "load_failed", reason: "no_fill" });
});

test("numeric GMA error codes map onto the bounded vocabulary; no code means sdk_error", () => {
  assert.equal(classifyInterstitialLoadError({ code: 3 }), "no_fill");
  assert.equal(classifyInterstitialLoadError({ code: 9 }), "no_fill");
  assert.equal(classifyInterstitialLoadError({ code: 2 }), "network_error");
  assert.equal(classifyInterstitialLoadError({ code: 1 }), "not_configured");
  assert.equal(classifyInterstitialLoadError({ code: 8 }), "not_configured");
  assert.equal(classifyInterstitialLoadError({ code: 0 }), "sdk_error");
  assert.equal(classifyInterstitialLoadError({ code: 99 }), "sdk_error");
  assert.equal(classifyInterstitialLoadError(new Error("No fill.")), "sdk_error", "message text is never parsed");
  assert.equal(classifyInterstitialLoadError(undefined), "sdk_error");
});

test("a load that times out is reported once, and its late Loaded never makes anything ready or shown", async () => {
  _setInterstitialTimeoutsForTests({ load: 1000 });
  const ad = fakeAdapter();
  preloadInterstitial();
  clock.advance(1000);
  assert.equal(getInterstitialState(), "idle");
  assert.deepEqual(events.at(-1), { type: "load_failed", reason: "timeout" });
  ad.resolveLoad();
  await flush();
  assert.equal(getInterstitialState(), "idle", "late Loaded ignored");
  assert.equal(ad.calls.show, 0, "late Loaded never auto-shows");
  assert.equal(events.filter((e) => e.type === "load_failed").length, 1);
});

test("a gate that is closed means no load at all", () => {
  const ad = fakeAdapter();
  registerInterstitialGates({ consent: () => false });
  assert.equal(preloadInterstitial(), false);
  registerInterstitialGates({ consent: () => true, interstitialEnabled: () => false });
  assert.equal(preloadInterstitial(), false);
  assert.equal(ad.calls.load, 0);
});

// --- Show / navigation --------------------------------------------------------------

test("not_ready is decided synchronously and returns null - nothing to wait for", () => {
  fakeAdapter();
  const { outcomes, release } = present();
  assert.equal(release, null);
  assert.deepEqual(outcomes, [{ outcome: "not_ready" }]);
});

test("not_ready while a load is still in flight does not wait for it either", () => {
  fakeAdapter();
  preloadInterstitial();
  const { outcomes, release } = present();
  assert.equal(release, null);
  assert.deepEqual(outcomes, [{ outcome: "not_ready" }]);
  assert.equal(getInterstitialState(), "loading", "the load itself is left alone");
});

test("the actual Showed callback establishes `shown` - and does NOT release gameplay", async () => {
  const ad = await readyAd();
  const p = present();
  assert.equal(getInterstitialState(), "showing");
  assert.deepEqual(p.outcomes, []);
  clock.advance(180);
  ad.fire({ type: "showed" });
  assert.deepEqual(p.outcomes, [{ outcome: "shown" }]);
  assert.deepEqual(events.find((e) => e.type === "showed"), { type: "showed", latencyMs: 180 });
  await flush();
  assert.equal(p.isReleased(), false, "Showed alone never releases");
  assert.equal(getInterstitialState(), "showing", "state stays occupied while the ad is visible");
  ad.fire({ type: "dismissed" });
  await flush();
  assert.equal(p.isReleased(), true);
  assert.equal(getInterstitialState(), "idle");
  assert.equal(events.filter((e) => e.type === "dismissed").length, 1);
});

test("the show promise resolving is NOT `shown`", async () => {
  await readyAd();
  const p = present();
  await flush();
  assert.deepEqual(p.outcomes, [], "handing over to the SDK decides nothing");
});

test("visibility hidden alone does NOT emit `shown`, and defers the no-signal timeout", async () => {
  _setInterstitialTimeoutsForTests({ decision: 2500 });
  await readyAd();
  const p = present();
  clock.setHidden(true);
  clock.advance(10_000);
  await flush();
  assert.deepEqual(p.outcomes, [], "no outcome from visibility");
  assert.equal(p.isReleased(), false, "hidden keeps gameplay behind the (possible) ad");
  assert.equal(events.some((e) => e.type === "showed"), false);
  // Back to visible without Showed ever arriving: released, and NOT counted as shown.
  clock.setHidden(false);
  await flush();
  assert.equal(p.isReleased(), true);
  assert.deepEqual(p.outcomes, [{ outcome: "show_failed", reason: "timeout" }]);
});

test("FailedToShow -> show_failed and immediate release", async () => {
  const ad = await readyAd();
  const p = present();
  ad.fire({ type: "failedToShow", code: 1 });
  await flush();
  assert.deepEqual(p.outcomes, [{ outcome: "show_failed", reason: "sdk_error" }]);
  assert.equal(p.isReleased(), true);
  assert.equal(getInterstitialState(), "idle");
});

test("a rejected show promise -> show_failed and immediate release", async () => {
  const ad = await readyAd();
  ad.setShow(() => Promise.reject(new Error("boom")));
  const p = present();
  await flush();
  assert.deepEqual(p.outcomes, [{ outcome: "show_failed", reason: "sdk_error" }]);
  assert.equal(p.isReleased(), true);
});

test("no signal at all within the decision window fails safe as show_failed(timeout)", async () => {
  _setInterstitialTimeoutsForTests({ decision: 2500 });
  await readyAd();
  const p = present();
  clock.advance(2499);
  await flush();
  assert.equal(p.isReleased(), false);
  clock.advance(1);
  await flush();
  assert.deepEqual(p.outcomes, [{ outcome: "show_failed", reason: "timeout" }]);
  assert.equal(p.isReleased(), true);
});

test("Dismissed releases exactly once", async () => {
  const ad = await readyAd();
  const p = present();
  let releases = 0;
  void p.release!.then(() => releases++);
  ad.fire({ type: "showed" });
  ad.fire({ type: "dismissed" });
  ad.fire({ type: "dismissed" });
  await flush();
  assert.equal(releases, 1);
  assert.equal(events.filter((e) => e.type === "dismissed").length, 1);
});

test("visibility return + Dismissed settle once; Dismissed is still reported from the real callback", async () => {
  const ad = await readyAd();
  const p = present();
  clock.setHidden(true);
  ad.fire({ type: "showed" });
  clock.setHidden(false);
  await flush();
  assert.equal(p.isReleased(), true, "visible-after-hidden releases gameplay");
  assert.equal(events.some((e) => e.type === "dismissed"), false, "visibility never fabricates Dismissed");
  ad.fire({ type: "dismissed" });
  await flush();
  assert.equal(events.filter((e) => e.type === "dismissed").length, 1, "the real Dismissed is reported once");
  assert.deepEqual(p.outcomes, [{ outcome: "shown" }]);
  assert.equal(clock.visibilityListeners(), 0, "no listener leaks");
});

test("the long safety timeout frees the state but NEVER continues: it resolves \"stay\"", async () => {
  // Stage-0 regression (vc46, Mi 8): the WebView never fires visibilitychange under an
  // interstitial, so with the ad still open after 120 s the old timeout released
  // gameplay and the next round started behind the ad.
  _setInterstitialTimeoutsForTests({ safety: 120_000 });
  const ad = await readyAd();
  const p = present();
  let how: string | null = null;
  void p.release!.then((h) => {
    how = h;
  });
  ad.fire({ type: "showed" });
  clock.advance(119_999);
  await flush();
  assert.equal(p.isReleased(), false);
  clock.advance(1);
  await flush();
  assert.equal(p.isReleased(), true);
  assert.equal(how, "stay", "a timeout release must not navigate");
  assert.deepEqual(p.outcomes, [{ outcome: "shown" }], "still shown - the outcome was already known");
  assert.equal(getInterstitialState(), "idle", "state is freed for later opportunities");
  // The player finally closes the ad: Dismissed is reported once, and nothing else happens.
  ad.fire({ type: "dismissed" });
  await flush();
  assert.equal(events.filter((e) => e.type === "dismissed").length, 1);
  assert.equal(how, "stay");
  assert.equal(getInterstitialState(), "idle");
});

test("a timeout while covered but before Showed also stays, and is not counted as shown", async () => {
  _setInterstitialTimeoutsForTests({ safety: 120_000 });
  await readyAd();
  const p = present();
  let how: string | null = null;
  void p.release!.then((h) => {
    how = h;
  });
  clock.setHidden(true);
  clock.advance(120_000);
  await flush();
  assert.equal(how, "stay");
  assert.deepEqual(p.outcomes, [{ outcome: "show_failed", reason: "timeout" }]);
});

test("every other release continues: Dismissed, back-to-visible, FailedToShow, no signal", async () => {
  _setInterstitialTimeoutsForTests({ decision: 2500 });
  const runs: Array<(ad: ReturnType<typeof fakeAdapter>) => void> = [
    (ad) => {
      ad.fire({ type: "showed" });
      ad.fire({ type: "dismissed" });
    },
    () => {
      clock.setHidden(true);
      clock.setHidden(false);
    },
    (ad) => ad.fire({ type: "failedToShow", code: 0 }),
    () => clock.advance(2500),
  ];
  for (const run of runs) {
    const ad = await readyAd();
    const p = present();
    run(ad);
    assert.equal(await p.release, "continue");
  }
});

test("the emergency switch flipping off means a cached ad is never presented", async () => {
  const ad = await readyAd();
  registerInterstitialGates({ interstitialEnabled: () => false });
  const p = present();
  assert.equal(p.release, null);
  assert.deepEqual(p.outcomes, [{ outcome: "not_ready" }]);
  assert.equal(ad.calls.show, 0);
});

test("a load that completes after the switch went off never becomes ready", async () => {
  const ad = fakeAdapter();
  let enabled = true;
  registerInterstitialGates({ interstitialEnabled: () => enabled });
  preloadInterstitial();
  enabled = false;
  ad.resolveLoad();
  await flush();
  assert.equal(getInterstitialState(), "idle");
});
