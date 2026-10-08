// The experiment as gameplay drives it: arm symmetry, the per-session opportunity
// cap, every outcome consuming the opportunity, one preload per upcoming
// opportunity, rewarded-collision suppression, the continuation marker, and the
// interstitial-only emergency switch.

import { strict as assert } from "node:assert";
import { test, beforeEach } from "node:test";

import {
  _resetInterstitialControllerForTests,
  beginInterstitialResultCycle,
  claimResultAdLane,
  isInterstitialDueThisCycle,
  markRewardedOfferRenderedThisCycle,
  recordInterstitialGameCompleted,
  recordInterstitialGameStarted,
  runInterstitialCheckpoint,
} from "./interstitialController";
import {
  _resetInterstitialAdsForTests,
  getInterstitialState,
  registerInterstitialAdapter,
  registerInterstitialGates,
  type InterstitialEnv,
  type InterstitialNativeEvent,
} from "./interstitialAds";
import { _resetInterstitialConfigForTests, refreshInterstitialConfig } from "./interstitialConfig";
import { assignArm, isSecondOpportunityEligible, parseInterstitialState, type InterstitialStorage } from "./interstitialExperiment";
import type { InterstitialClientConfig } from "./interstitialConfigSchema";
import {
  _resetRewardedAdsForTests,
  registerAdAdapter,
  showRewardedAd,
  subscribeRewardedAdEvents,
} from "./rewardedAds";
import { validateEventParams, type AnalyticsEventName } from "../analyticsSchema";
import type { ApiResponse } from "../nativeApi";
import type { GameType } from "../analyticsSchema";

// --- Fixtures -----------------------------------------------------------------------

function findId(arm: "treatment" | "control"): string {
  for (let i = 0; i < 100_000; i++) {
    const id = i.toString(16).padStart(12, "0");
    if (assignArm(id, 5) === arm) return id;
  }
  throw new Error("no id found");
}
const TREATMENT_ID = findId("treatment");
const CONTROL_ID = findId("control");

const BASE: InterstitialClientConfig = {
  enabled: true,
  rolloutPercent: 5,
  gamesBetweenAds: 7,
  maxOpportunitiesPerSession: 1,
  countryEligible: true,
};

function response(status: number, body?: unknown): ApiResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

let served: { status: number; body?: unknown } = { status: 200, body: BASE };
async function setConfig(config: (Partial<InterstitialClientConfig> & { experiments?: unknown }) | null, freshRun = true) {
  served = config === null ? { status: 404 } : { status: 200, body: { ...BASE, ...config } };
  if (freshRun) _resetInterstitialConfigForTests(async () => response(served.status, served.body));
  await refreshInterstitialConfig();
}

function memoryStorage(): InterstitialStorage & { raw: () => string | null } {
  let value: string | null = null;
  return {
    read: () => value,
    write: (v) => {
      value = v;
      return true;
    },
    raw: () => value,
  };
}

type Tracked = { name: AnalyticsEventName; params: Record<string, unknown> };

function manualEnv(): { env: InterstitialEnv; setHidden(v: boolean): void } {
  let hidden = false;
  const listeners = new Set<() => void>();
  return {
    env: {
      now: () => 0,
      setTimeout: () => 0,
      clearTimeout: () => {},
      isHidden: () => hidden,
      onVisibilityChange: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      platform: () => "android",
    },
    setHidden(v) {
      hidden = v;
      for (const l of [...listeners]) l();
    },
  };
}

function fakeInterstitialAdapter() {
  const calls = { load: 0, show: 0 };
  let listener: (e: InterstitialNativeEvent) => void = () => {};
  let control: { resolve: () => void; reject: (e: unknown) => void } | null = null;
  registerInterstitialAdapter({
    name: "fake",
    load: () => {
      calls.load++;
      return new Promise<void>((resolve, reject) => {
        control = { resolve, reject };
      });
    },
    show: () => {
      calls.show++;
      return Promise.resolve();
    },
    setListener: (l) => {
      listener = l;
    },
  });
  return { calls, resolveLoad: () => control?.resolve(), rejectLoad: (code?: number) => control?.reject({ code }), fire: (e: InterstitialNativeEvent) => listener(e) };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

let tracked: Tracked[];
let storage: ReturnType<typeof memoryStorage>;
let ifxStore: ReturnType<typeof memoryStorage>;
let session: string;
let installation: string | null;
let ad: ReturnType<typeof fakeInterstitialAdapter>;
let visibility: ReturnType<typeof manualEnv>;

beforeEach(async () => {
  tracked = [];
  storage = memoryStorage();
  ifxStore = memoryStorage();
  session = "sess00000001";
  installation = TREATMENT_ID;
  _resetRewardedAdsForTests();
  visibility = manualEnv();
  _resetInterstitialAdsForTests(visibility.env);
  registerInterstitialGates({ consent: () => true, remoteAds: () => true, interstitialEnabled: () => true });
  ad = fakeInterstitialAdapter();
  _resetInterstitialControllerForTests({
    track: (name, params) => tracked.push({ name, params: params as Record<string, unknown> }),
    storage,
    ifxStorage: ifxStore,
    sessionId: () => session,
    installationId: () => installation,
  });
  await setConfig({});
});

/** One full round: result cycle, completion, then (optionally) continue. */
function completeRound(gameType: GameType = "shapeChallenge") {
  beginInterstitialResultCycle();
  recordInterstitialGameCompleted(gameType);
}

function playRounds(n: number): (Promise<void> | null)[] {
  const results: (Promise<void> | null)[] = [];
  for (let i = 0; i < n; i++) {
    completeRound();
    results.push(runInterstitialCheckpoint());
  }
  return results;
}

const checkpoints = () => tracked.filter((t) => t.name === "interstitial_checkpoint").map((t) => t.params);
const persisted = () => parseInterstitialState(storage.raw());

// --- Symmetry / cap -----------------------------------------------------------------

test("control and treatment consume an opportunity at the same completion", () => {
  playRounds(7);
  const treatment = checkpoints();
  tracked = [];
  storage = memoryStorage();
  installation = CONTROL_ID;
  _resetInterstitialControllerForTests({
    track: (name, params) => tracked.push({ name, params: params as Record<string, unknown> }),
    storage,
    sessionId: () => session,
    installationId: () => installation,
  });
  playRounds(7);
  const control = checkpoints();
  assert.equal(treatment.length, 1);
  assert.equal(control.length, 1);
  assert.deepEqual(control[0], { arm: "control", outcome: "control", gamesBetweenAds: 7 });
  assert.equal(treatment[0].arm, "treatment");
  // Both are valid by the shared analytics schema.
  for (const params of [...treatment, ...control]) assert.equal(validateEventParams("interstitial_checkpoint", params).valid, true);
});

test("control never loads or shows an ad", () => {
  installation = CONTROL_ID;
  playRounds(14);
  assert.equal(ad.calls.load, 0);
  assert.equal(ad.calls.show, 0);
});

test("maxOpportunitiesPerSession = 1: one opportunity per session, then none until a new session", () => {
  playRounds(7 * 3);
  assert.equal(checkpoints().length, 1);
  session = "sess00000002";
  completeRound();
  runInterstitialCheckpoint();
  assert.equal(checkpoints().length, 2, "the next session's first completion is due (progress kept counting)");
});

test("not_ready consumes the opportunity", () => {
  playRounds(7);
  assert.equal(checkpoints()[0].outcome, "not_ready");
  assert.equal(persisted().eligibleGamesSinceLastOpportunity, 0);
  assert.equal(persisted().session?.opportunities, 1);
});

test("suppressed consumes the opportunity", async () => {
  registerAdAdapter({ name: "rw", initialize: async () => {}, loadRewarded: async () => {}, showRewarded: async () => null });
  playRounds(6);
  completeRound();
  await showRewardedAd("shape_challenge_double_reward");
  assert.equal(runInterstitialCheckpoint(), null);
  assert.deepEqual(checkpoints(), [{ arm: "treatment", outcome: "suppressed", gamesBetweenAds: 7, attempt: 1 }]);
  assert.equal(persisted().session?.opportunities, 1);
  playRounds(7);
  assert.equal(checkpoints().length, 1, "consumed: no second opportunity this session");
});

test("show_failed consumes the opportunity", async () => {
  playRounds(6);
  ad.resolveLoad();
  await flush();
  assert.equal(getInterstitialState(), "ready");
  completeRound();
  const pending = runInterstitialCheckpoint();
  assert.ok(pending);
  ad.fire({ type: "failedToShow", code: 0 });
  await pending;
  assert.deepEqual(checkpoints(), [{ arm: "treatment", outcome: "show_failed", gamesBetweenAds: 7, reason: "sdk_error", attempt: 1, latency: "lt5s" }]);
  assert.equal(persisted().session?.opportunities, 1);
});

// --- Preload ------------------------------------------------------------------------

test("at most two attempts per opportunity: game 5 -> attempt 1, game 6 -> retry if it failed, game 7 -> checkpoint, no third", async () => {
  playRounds(4);
  assert.equal(ad.calls.load, 0, "nothing before cadence-2");
  completeRound(); // 5th = cadence - 2: attempt 1
  runInterstitialCheckpoint();
  assert.equal(ad.calls.load, 1);
  ad.rejectLoad(3);
  await flush();
  completeRound(); // 6th = cadence - 1: attempt 1 definitively failed -> the retry
  runInterstitialCheckpoint();
  assert.equal(ad.calls.load, 2, "the retry opportunity");
  ad.rejectLoad(2);
  await flush();
  completeRound(); // 7th - due: never a third attempt, never an immediate loop
  assert.equal(ad.calls.load, 2, "two attempts, no more");
  assert.equal(runInterstitialCheckpoint(), null, "not ready -> no waiting");
  assert.deepEqual(checkpoints(), [{ arm: "treatment", outcome: "not_ready", gamesBetweenAds: 7, attempt: 2, code: 2, notReadyCause: "failed" }]);
  const failures = tracked.filter((t) => t.name === "interstitial_load_failed");
  assert.deepEqual(
    failures.map((f) => f.params),
    [
      { reason: "no_fill", attempt: 1, code: 3, latency: "lt5s" },
      { reason: "network_error", attempt: 2, code: 2, latency: "lt5s" },
    ],
  );
  for (const f of failures) assert.equal(validateEventParams("interstitial_load_failed", f.params).valid, true);
  assert.equal(validateEventParams("interstitial_checkpoint", checkpoints()[0]).valid, true);
});

test("attempt 1 still loading at game 6: no overlapping attempt 2; the checkpoint reports cause loading and continues at once", () => {
  playRounds(5);
  assert.equal(ad.calls.load, 1);
  completeRound(); // 6th
  runInterstitialCheckpoint();
  assert.equal(ad.calls.load, 1, "never two loads in flight");
  completeRound(); // 7th
  assert.equal(runInterstitialCheckpoint(), null, "no spinner, no waiting");
  assert.deepEqual(checkpoints(), [{ arm: "treatment", outcome: "not_ready", gamesBetweenAds: 7, attempt: 1, notReadyCause: "loading" }]);
});

test("a load that succeeds late - after game 6, before the checkpoint - is used", async () => {
  playRounds(6);
  assert.equal(ad.calls.load, 1);
  ad.resolveLoad(); // slow, but still inside the opportunity
  await flush();
  completeRound();
  const pending = runInterstitialCheckpoint();
  assert.ok(pending, "the late ad is presented");
  ad.fire({ type: "showed" });
  assert.deepEqual(checkpoints(), [{ arm: "treatment", outcome: "shown", gamesBetweenAds: 7, attempt: 1, latency: "lt5s" }]);
});

test("a success that lands after the opportunity was consumed is dropped, and the next opportunity starts clean", async () => {
  playRounds(5); // attempt 1 in flight
  playRounds(2); // game 7 checkpoint consumes the opportunity (not_ready: loading)
  assert.equal(checkpoints()[0].outcome, "not_ready");
  ad.resolveLoad(); // stale: belongs to the consumed opportunity
  await flush();
  assert.equal(getInterstitialState(), "idle", "stale success never becomes ready");
  session = "sess00000002"; // the per-session cap (1) is spent in this session
  playRounds(4);
  assert.equal(ad.calls.load, 1, "no load before the next window");
  playRounds(1);
  assert.equal(ad.calls.load, 2, "the next opportunity gets its own attempt 1");
});

test("a session change throws away the previous session's attempts and ad", async () => {
  playRounds(5);
  ad.resolveLoad();
  await flush();
  assert.equal(getInterstitialState(), "ready");
  session = "sess00000002";
  completeRound(); // 6th, new session: the stale ad is invalidated and a fresh attempt 1 starts
  assert.equal(ad.calls.load, 2);
  assert.equal(getInterstitialState(), "loading");
});

test("a loaded ad does not carry over when its opportunity is consumed by suppression", async () => {
  registerAdAdapter({ name: "rw", initialize: async () => {}, loadRewarded: async () => {}, showRewarded: async () => null });
  playRounds(5);
  ad.resolveLoad();
  await flush();
  playRounds(1);
  completeRound();
  await showRewardedAd("shape_challenge_double_reward");
  assert.equal(runInterstitialCheckpoint(), null);
  assert.equal(checkpoints()[0].outcome, "suppressed");
  assert.equal(getInterstitialState(), "idle", "consumed: the loaded ad is invalidated");
});

test("after an opportunity is consumed the next upcoming one gets its own preload", async () => {
  playRounds(7);
  session = "sess00000002";
  ad.rejectLoad(2);
  await flush();
  playRounds(4);
  assert.equal(ad.calls.load, 1, "the counter restarted at 0 - four rounds is not yet cadence-2");
  playRounds(1);
  assert.equal(ad.calls.load, 2);
});

// --- Show / navigation --------------------------------------------------------------

test("the next game cannot start behind the ad: continuation waits for release, and `shown` needs Showed", async () => {
  playRounds(6);
  ad.resolveLoad();
  await flush();
  completeRound();
  let navigated = false;
  const pending = runInterstitialCheckpoint();
  assert.ok(pending, "a ready ad returns a promise");
  void pending.then((proceed) => {
    navigated = proceed;
  });
  visibility.setHidden(true);
  await flush();
  assert.equal(checkpoints().length, 0, "hidden alone records nothing");
  ad.fire({ type: "showed" });
  assert.deepEqual(checkpoints(), [{ arm: "treatment", outcome: "shown", gamesBetweenAds: 7, attempt: 1, latency: "lt5s" }]);
  // The marker is already persisted while the ad is still on screen...
  assert.equal(persisted().marker?.outcome, "shown");
  await flush();
  assert.equal(navigated, false, "...but gameplay is still held");
  ad.fire({ type: "dismissed" });
  await flush();
  assert.equal(navigated, true);
  assert.equal(tracked.filter((t) => t.name === "interstitial_dismissed").length, 1);
});

test("a second tap while an ad is presenting cannot start another checkpoint", async () => {
  playRounds(6);
  ad.resolveLoad();
  await flush();
  completeRound();
  const first = runInterstitialCheckpoint();
  assert.ok(first);
  assert.equal(runInterstitialCheckpoint(), null);
  assert.equal(ad.calls.show, 1);
});

// --- Rewarded collision -------------------------------------------------------------

test("a rewarded ad shown in this result cycle suppresses; the next result cycle resets the marker", async () => {
  registerAdAdapter({ name: "rw", initialize: async () => {}, loadRewarded: async () => {}, showRewarded: async () => ({ type: "coins", amount: 1 }) });
  // The (cadence-1)th round shows a rewarded ad but is not due; its marker must not leak.
  playRounds(5);
  completeRound();
  await showRewardedAd("shape_challenge_double_reward");
  runInterstitialCheckpoint();
  completeRound(); // new cycle -> marker reset
  runInterstitialCheckpoint();
  assert.equal(checkpoints()[0].outcome, "not_ready", "the previous cycle's rewarded ad does not suppress this one");
});

test("control is suppressed by a rewarded ad too (symmetric)", async () => {
  installation = CONTROL_ID;
  registerAdAdapter({ name: "rw", initialize: async () => {}, loadRewarded: async () => {}, showRewarded: async () => null });
  playRounds(6);
  completeRound();
  await showRewardedAd("shape_challenge_double_reward");
  runInterstitialCheckpoint();
  assert.deepEqual(checkpoints(), [{ arm: "control", outcome: "suppressed", gamesBetweenAds: 7 }]);
});

test("the rewarded flow is untouched by the interstitial observer", async () => {
  const seen: string[] = [];
  subscribeRewardedAdEvents("test-observer", (event) => seen.push(event));
  registerAdAdapter({ name: "rw", initialize: async () => {}, loadRewarded: async () => {}, showRewarded: async () => ({ type: "coins", amount: 5 }) });
  const result = await showRewardedAd("shape_challenge_double_reward");
  assert.deepEqual(result, { status: "rewarded", reward: { type: "coins", amount: 5 } });
  assert.deepEqual(seen, ["requested", "loading", "loaded", "shown", "rewarded"]);
  assert.equal(ad.calls.load + ad.calls.show, 0, "rewarded never touches the interstitial adapter");
});

// --- Continuation -------------------------------------------------------------------

test("the outcome marker is written before navigation", () => {
  playRounds(6);
  completeRound();
  const before = persisted().marker;
  assert.equal(before, null);
  const pending = runInterstitialCheckpoint();
  assert.equal(pending, null);
  // `go()` would run right here; the marker must already be on disk.
  assert.deepEqual(persisted().marker, { sessionId: session, arm: "treatment", outcome: "not_ready", gamesBetweenAds: 7 });
});

test("the next eligible game_started emits the continuation once and consumes the marker", () => {
  playRounds(7);
  recordInterstitialGameStarted("seoPractice");
  recordInterstitialGameStarted("dailyChallenge");
  assert.equal(tracked.filter((t) => t.name === "interstitial_continuation").length, 0, "ineligible starts neither emit nor consume");
  recordInterstitialGameStarted("shapeChallenge");
  recordInterstitialGameStarted("shapeChallenge");
  const continuations = tracked.filter((t) => t.name === "interstitial_continuation");
  assert.deepEqual(continuations.map((c) => c.params), [{ arm: "treatment", outcome: "not_ready", gamesBetweenAds: 7 }]);
  assert.equal(validateEventParams("interstitial_continuation", continuations[0].params).valid, true);
  assert.equal(persisted().marker, null);
});

test("a marker from a previous analytics session is dropped without an event", () => {
  playRounds(7);
  session = "sess00000009";
  recordInterstitialGameStarted("shapeChallenge");
  assert.equal(tracked.filter((t) => t.name === "interstitial_continuation").length, 0);
  assert.equal(persisted().marker, null);
});

// --- Eligibility / config -----------------------------------------------------------

test("only normal Shape Challenge completions count", () => {
  for (const gameType of ["seoPractice", "dailyChallenge", "megaChallenge", "artistPack", "specialChallenge", "customChallenge", "playTogether"] as GameType[]) {
    for (let i = 0; i < 10; i++) completeRound(gameType);
  }
  assert.equal(persisted().eligibleGamesSinceLastOpportunity, 0);
  assert.equal(runInterstitialCheckpoint(), null);
  assert.equal(checkpoints().length, 0);
});

test("Back to Map (no checkpoint) keeps the opportunity due for the next completion - consumed exactly once", () => {
  playRounds(6);
  completeRound(); // 7th: due, but the player leaves via Back to Map
  completeRound(); // 8th: still due
  runInterstitialCheckpoint();
  assert.equal(checkpoints().length, 1);
});

test("a config change alone cannot trigger an opportunity", async () => {
  playRounds(4);
  await setConfig({ gamesBetweenAds: 5 }, false); // a refresh mid-run: cadence is frozen anyway
  assert.equal(runInterstitialCheckpoint(), null);
  await setConfig({ gamesBetweenAds: 5 }); // a fresh run under the new cadence
  assert.equal(runInterstitialCheckpoint(), null, "startup/config fetch alone is never due");
  assert.equal(checkpoints().length, 0);
  completeRound(); // 5 >= 5: the next completion is
  runInterstitialCheckpoint();
  assert.equal(checkpoints().length, 1);
  assert.equal(checkpoints()[0].gamesBetweenAds, 5);
});

test("enabled:false from a later refresh stops counting, preloads and checkpoints", async () => {
  playRounds(5);
  const loadsBefore = ad.calls.load;
  await setConfig({ enabled: false }, false);
  playRounds(10);
  assert.equal(checkpoints().length, 0);
  assert.equal(ad.calls.load, loadsBefore, "no further loads while off");
  assert.equal(persisted().eligibleGamesSinceLastOpportunity, 5, "nothing counted while off");
});

test("an ineligible network country, an unassigned installation, or no config: nothing at all", async () => {
  await setConfig({ countryEligible: false });
  playRounds(10);
  installation = null; // no stable persisted id
  await setConfig({});
  playRounds(10);
  await setConfig(null); // 404
  installation = TREATMENT_ID;
  playRounds(10);
  assert.equal(checkpoints().length, 0);
  assert.equal(ad.calls.load, 0);
  assert.equal(storage.raw(), null, "nothing persisted either");
});

test("safety-timeout release after Showed stays on Result; the next explicit tap continues immediately", async () => {
  // Real timers for this one: the release safety timeout has to actually fire.
  const timers: Array<{ at: number; fn: () => void }> = [];
  let now = 0;
  _resetInterstitialAdsForTests({
    ...visibility.env,
    now: () => now,
    setTimeout: (fn, ms) => timers.push({ at: now + ms, fn }) - 1,
    clearTimeout: (h) => {
      if (typeof h === "number" && timers[h]) timers[h].fn = () => {};
    },
  });
  registerInterstitialGates({ consent: () => true, remoteAds: () => true, interstitialEnabled: () => true });
  ad = fakeInterstitialAdapter();
  // Resetting the ad service dropped the controller's lifecycle subscription; re-wire it.
  _resetInterstitialControllerForTests({
    track: (name, params) => tracked.push({ name, params: params as Record<string, unknown> }),
    storage,
    sessionId: () => session,
    installationId: () => installation,
  });
  playRounds(6);
  ad.resolveLoad();
  await flush();
  completeRound();
  const pending = runInterstitialCheckpoint();
  assert.ok(pending);
  let proceed: boolean | null = null;
  void pending.then((p) => {
    proceed = p;
  });
  ad.fire({ type: "showed" });
  now = 120_000;
  for (const t of timers.filter((t) => t.at <= now)) t.fn();
  await flush();
  assert.equal(proceed, false, "never auto-navigate on the safety timeout");
  // The next tap: no opportunity is due any more, so it continues at once (null).
  assert.equal(runInterstitialCheckpoint(), null);
  // A late Dismissed is still reported, and navigates nothing.
  ad.fire({ type: "dismissed" });
  await flush();
  assert.equal(tracked.filter((t) => t.name === "interstitial_dismissed").length, 1);
  assert.equal(tracked.filter((t) => t.name === "interstitial_checkpoint").length, 1);
});

// Rewarded Ads Experiment v1 reads this to defer the rewarded offer (interstitial priority).
test("isInterstitialDueThisCycle: true only on a TREATMENT result whose exit runs an opportunity", async () => {
  for (let i = 1; i <= 6; i++) {
    completeRound();
    assert.equal(isInterstitialDueThisCycle(), false, `game ${i} is not due`);
    runInterstitialCheckpoint();
  }
  completeRound();
  assert.equal(isInterstitialDueThisCycle(), true, "game 7 is due in treatment");
  beginInterstitialResultCycle();
  assert.equal(isInterstitialDueThisCycle(), false, "a new result cycle clears it");
});

test("isInterstitialDueThisCycle: a control opportunity never defers the rewarded offer", async () => {
  installation = CONTROL_ID;
  for (let i = 1; i <= 7; i++) {
    completeRound();
    if (i < 7) runInterstitialCheckpoint();
  }
  assert.equal(isInterstitialDueThisCycle(), false, "control shows no ad, so nothing to yield to");
});

// --- Result-screen ad exclusivity (Rewarded Ads Experiment v1) -------------------------
// Each Result screen exposes at most one ad lane. claimResultAdLane() is asked only when a
// rewarded offer is otherwise ready to render (due, paying, ad-capable).

async function dueAndLoaded() {
  playRounds(6); // preload for the upcoming opportunity starts here
  ad.resolveLoad();
  await flush();
  completeRound(); // 7th: due, ad ready
}

test("lane 1: due + loaded -> the screen is reserved for the interstitial, which shows on exit", async () => {
  await dueAndLoaded();
  assert.equal(claimResultAdLane(), "interstitial", "rewarded deferred");
  const pending = runInterstitialCheckpoint();
  assert.ok(pending, "the interstitial is presented");
  ad.fire({ type: "showed" });
  assert.deepEqual(checkpoints(), [{ arm: "treatment", outcome: "shown", gamesBetweenAds: 7, attempt: 1, latency: "lt5s" }]);
});

test("lane 2: due + loaded, player leaves via Back to Map -> next paying result renders rewarded", async () => {
  await dueAndLoaded();
  assert.equal(claimResultAdLane(), "interstitial");
  // Back to Map: no checkpoint, nothing presented. Next result - still due and loaded.
  completeRound();
  assert.equal(isInterstitialDueThisCycle(), true);
  assert.equal(claimResultAdLane(), "rewarded", "one reservation per opportunity - no starvation");
  markRewardedOfferRenderedThisCycle();
  assert.equal(runInterstitialCheckpoint(), null, "rewarded rendered -> no interstitial from this screen");
  assert.equal(checkpoints()[0].outcome, "suppressed");
  assert.equal(ad.calls.show, 0);
});

test("lane 3: due but NOT loaded -> rewarded renders", () => {
  playRounds(6); // preload started but never resolves
  completeRound();
  assert.equal(isInterstitialDueThisCycle(), true);
  assert.equal(claimResultAdLane(), "rewarded");
});

test("lane 4: rewarded rendered, interstitial finishes loading afterwards -> still no interstitial from that screen", async () => {
  playRounds(6);
  completeRound(); // due, still loading
  assert.equal(claimResultAdLane(), "rewarded");
  markRewardedOfferRenderedThisCycle();
  ad.resolveLoad(); // the race: loaded after the offer rendered
  await flush();
  assert.equal(runInterstitialCheckpoint(), null);
  assert.equal(checkpoints()[0].outcome, "suppressed");
  assert.equal(ad.calls.show, 0);
});

test("lane 5: a zero-coin result (no claim) does not spend the reservation", async () => {
  await dueAndLoaded();
  // Zero-coin result: the screen never asks for the lane; the player goes Back to Map.
  completeRound(); // next result is paying
  assert.equal(claimResultAdLane(), "interstitial", "the reservation is still available");
});

test("lane 6: no repeated starvation; a fresh opportunity gets its own single reservation", async () => {
  await dueAndLoaded();
  assert.equal(claimResultAdLane(), "interstitial");
  for (let i = 0; i < 3; i++) {
    completeRound(); // left via Back to Map each time
    assert.equal(claimResultAdLane(), "rewarded", `result ${i + 2} after the reservation renders rewarded`);
  }
  markRewardedOfferRenderedThisCycle();
  runInterstitialCheckpoint(); // consumed (suppressed) at the rewarded screen's exit
  // A new session reopens the cap; the next opportunity may reserve one screen again.
  session = "sess00000002";
  playRounds(6);
  ad.resolveLoad();
  await flush();
  completeRound();
  assert.equal(claimResultAdLane(), "interstitial");
});

test("lane: control arm never reserves a screen", async () => {
  installation = CONTROL_ID;
  playRounds(6);
  completeRound();
  assert.equal(claimResultAdLane(), "rewarded");
});

// --- 0.56 remote controls: full rollout range, second opportunity, session snapshot -----------

function findSecondId(eligible: boolean, percent: number): string {
  for (let i = 0; i < 100_000; i++) {
    const id = i.toString(16).padStart(12, "0");
    if (assignArm(id, 100) === "treatment" && isSecondOpportunityEligible(id, percent) === eligible) return id;
  }
  throw new Error("no id found");
}

test("max/session 2 with the default second-opportunity rollout: a second opportunity in the same session", () => {
  return setConfig({ maxOpportunitiesPerSession: 2 }).then(() => {
    playRounds(7 * 3);
    assert.equal(checkpoints().length, 2, "capped at two, not unlimited");
  });
});

test("secondOpportunityRolloutPercent: an installation outside it gets only the first opportunity, one inside gets both", async () => {
  installation = findSecondId(false, 20);
  await setConfig({ rolloutPercent: 100, maxOpportunitiesPerSession: 2, secondOpportunityRolloutPercent: 20 });
  playRounds(7 * 3);
  assert.equal(checkpoints().length, 1, "first opportunity only");
  tracked = [];
  storage = memoryStorage();
  installation = findSecondId(true, 20);
  _resetInterstitialControllerForTests({
    track: (name, params) => tracked.push({ name, params: params as Record<string, unknown> }),
    storage,
    sessionId: () => session,
    installationId: () => installation,
  });
  playRounds(7 * 3);
  assert.equal(checkpoints().length, 2, "inside the second-opportunity rollout");
});

test("rollout above 50 puts everyone in treatment at 100 and never loads for nobody at 0", async () => {
  await setConfig({ rolloutPercent: 100 });
  installation = CONTROL_ID; // a control id at 5% is treatment at 100%
  playRounds(7);
  assert.equal(checkpoints()[0].arm, "treatment");
  tracked = [];
  storage = memoryStorage();
  _resetInterstitialControllerForTests({
    track: (name, params) => tracked.push({ name, params: params as Record<string, unknown> }),
    storage,
    sessionId: () => session,
    installationId: () => installation,
  });
  await setConfig({ rolloutPercent: 0 });
  playRounds(14);
  assert.equal(checkpoints().length, 0, "0% = nobody takes part");
});

test("the monetization rules are a session snapshot: a later remote change moves only the live switch", async () => {
  playRounds(3);
  await setConfig({ gamesBetweenAds: 5, maxOpportunitiesPerSession: 2, rolloutPercent: 100, secondOpportunityRolloutPercent: 0 }, false);
  playRounds(4);
  assert.equal(checkpoints().length, 1, "still the launch cadence of 7");
  assert.equal(checkpoints()[0].gamesBetweenAds, 7);
  playRounds(14);
  assert.equal(checkpoints().length, 1, "still max 1 per session");
});

test("lane: a due interstitial that is still LOADING does not reserve the Result screen - the rewarded offer renders", () => {
  playRounds(6); // attempt 1 in flight, never resolved
  completeRound(); // 7th: due, but nothing loaded
  assert.equal(isInterstitialDueThisCycle(), true);
  assert.equal(getInterstitialState(), "loading");
  assert.equal(claimResultAdLane(), "rewarded");
  markRewardedOfferRenderedThisCycle();
  assert.equal(runInterstitialCheckpoint(), null);
  assert.equal(checkpoints()[0].outcome, "suppressed");
});

// --- 0.57 multi-cell experiment through the controller -------------------------------------------

import { getEffectiveInterstitialContext, getInterstitialControllerDebugInfo } from "./interstitialController";
import { IFX_STATE_KEY, isInExperimentGate, parseIfxState, pickCell } from "./interstitialCells";
import { consumeOpportunity, recordEligibleCompletion } from "./interstitialExperiment";
import type { InterstitialExperimentSpec } from "./interstitialConfigSchema";

const xcell = (id: string, cadence: number, cap: number, weight: number) => ({ id, cadence, cap, weight }) as InterstitialExperimentSpec["cells"][number];
function xspec(over: Partial<InterstitialExperimentSpec> = {}): InterstitialExperimentSpec {
  return {
    enabled: true,
    rolloutPercentInTreatment: 100,
    version: 1,
    cells: [xcell("A", 7, 2, 50), xcell("B", 5, 2, 50)],
    ...over,
  };
}

/** A TREATMENT installation (rollout 5) that lands in `cellId` under `spec` (and inside its gate). */
function idInCell(spec: InterstitialExperimentSpec, cellId: string): string {
  for (let i = 0; i < 200_000; i++) {
    const id = `ifx${i.toString(16).padStart(9, "0")}`;
    if (assignArm(id, 5) === "treatment" && isInExperimentGate(id, spec.version, spec.rolloutPercentInTreatment) && pickCell(id, spec).id === cellId) return id;
  }
  throw new Error("no id found");
}

/** Which round numbers (1-based) ended in a recorded checkpoint, over `n` rounds, rotating the session every `sessionEvery` rounds. */
function checkpointRounds(n: number, sessionEvery = Infinity): number[] {
  const rounds: number[] = [];
  let sessionNo = 1;
  for (let round = 1; round <= n; round++) {
    if (round > 1 && (round - 1) % sessionEvery === 0) session = `sess${String(++sessionNo).padStart(8, "0")}`;
    const before = checkpoints().length;
    completeRound();
    runInterstitialCheckpoint();
    if (checkpoints().length > before) rounds.push(round);
  }
  return rounds;
}

/** Reference: the unchanged 0.56 pure functions under a base cadence and cap, same session rotation. */
function referenceRounds(n: number, cadence: 7, cap: number, sessionEvery = Infinity): number[] {
  const rounds: number[] = [];
  let state = parseInterstitialState(null);
  let sessionNo = 1;
  for (let round = 1; round <= n; round++) {
    if (round > 1 && (round - 1) % sessionEvery === 0) sessionNo++;
    const sid = `sess${String(sessionNo).padStart(8, "0")}`;
    const d = recordEligibleCompletion(state, cadence, cap, sid, "treatment", true);
    state = d.state;
    if (d.due) {
      rounds.push(round);
      state = consumeOpportunity(state, sid);
    }
  }
  return rounds;
}

/** Restart the app inside the same analytics session: controller memory and the frozen config reset, storage stays. */
function coldStart() {
  _resetInterstitialControllerForTests({
    track: (name, params) => tracked.push({ name, params: params as Record<string, unknown> }),
    storage,
    ifxStorage: ifxStore,
    sessionId: () => session,
    installationId: () => installation,
  });
}

test("baseline equivalence: experiments absent, off, rollout 0, invalid or in control produce EXACTLY the 0.56 sequence (7/2 and 7/1, one and several sessions)", async () => {
  const scenarios: [string, Record<string, unknown>, () => void][] = [
    ["absent", {}, () => {}],
    ["enabled:false", { experiments: { interstitial: xspec({ enabled: false }) } }, () => {}],
    ["rollout 0 (the launch state)", { experiments: { interstitial: xspec({ rolloutPercentInTreatment: 0 }) } }, () => {}],
    ["invalid block", { experiments: { interstitial: { ...xspec(), version: 0 } } }, () => {}],
    ["control arm, experiment on", { experiments: { interstitial: xspec() } }, () => (installation = CONTROL_ID)],
  ];
  for (const [cap, sessionEvery] of [[2, Infinity], [1, Infinity], [2, 20], [1, 20]] as const) {
    const expected = referenceRounds(60, 7, cap, sessionEvery);
    assert.ok(expected.length >= 2 || cap === 1, "sanity: the reference has opportunities");
    for (const [name, extra, arrange] of scenarios) {
      tracked = [];
      storage = memoryStorage();
      ifxStore = memoryStorage();
      session = "sess00000001";
      installation = TREATMENT_ID;
      coldStart();
      arrange();
      await setConfig({ maxOpportunitiesPerSession: cap, ...extra });
      const rounds = checkpointRounds(60, sessionEvery);
      // (control records the same moments as treatment - symmetric accounting - so it matches the reference too)
      assert.deepEqual(rounds, expected, `${name}, cap ${cap}, session every ${sessionEvery}`);
      assert.ok(checkpoints().every((c) => c.gamesBetweenAds === 7), `${name}: telemetry reports the baseline cadence`);
    }
  }
});

test("participant: the cell's cadence and cap rule, and telemetry reports the EFFECTIVE cadence", async () => {
  const spec = xspec({ cells: [xcell("A", 5, 2, 50), xcell("B", 10, 1, 50)] });
  installation = idInCell(spec, "A");
  await setConfig({ maxOpportunitiesPerSession: 1, experiments: { interstitial: spec } });
  assert.deepEqual(checkpointRounds(30), [5, 10], "cadence 5, cap 2 (and the base cap of 1 is not what applies)");
  assert.ok(checkpoints().every((c) => c.gamesBetweenAds === 5));
  for (const c of checkpoints()) assert.equal(validateEventParams("interstitial_checkpoint", c).valid, true, "the effective cadence is a valid analytics value");
  const marker = persisted().marker;
  assert.equal(marker?.gamesBetweenAds, 5);
  recordInterstitialGameStarted("shapeChallenge");
  assert.equal(tracked.filter((t) => t.name === "interstitial_continuation").at(-1)?.params.gamesBetweenAds, 5);
});

test("participant in a cap-1 / cadence-10 cell gets exactly one opportunity per session even if the base cap is 2", async () => {
  const spec = xspec({ cells: [xcell("A", 5, 2, 50), xcell("B", 10, 1, 50)] });
  installation = idInCell(spec, "B");
  await setConfig({ maxOpportunitiesPerSession: 2, experiments: { interstitial: spec } });
  assert.deepEqual(checkpointRounds(40), [10]);
});

test("second opportunity: a cap-2 cell is NOT reduced by secondOpportunityRolloutPercent (0 or 50); baseline still is", async () => {
  const spec = xspec({ cells: [xcell("A", 5, 2, 50), xcell("B", 7, 2, 50)] });
  for (const pct of [0, 50]) {
    // Find an installation the LEGACY gate would exclude, so the bypass is what lets it through.
    let id: string | null = null;
    for (let i = 0; i < 200_000 && id === null; i++) {
      const cand = `ifx${i.toString(16).padStart(9, "0")}`;
      if (assignArm(cand, 5) === "treatment" && isInExperimentGate(cand, 1, 100) && !isSecondOpportunityEligible(cand, pct)) id = cand;
    }
    assert.ok(id !== null);
    installation = id;
    storage = memoryStorage();
    ifxStore = memoryStorage();
    tracked = [];
    coldStart();
    await setConfig({ maxOpportunitiesPerSession: 2, secondOpportunityRolloutPercent: pct, experiments: { interstitial: spec } });
    const cellCadence = pickCell(id, spec).cadence;
    assert.deepEqual(checkpointRounds(3 * cellCadence), [cellCadence, 2 * cellCadence], `participant, legacy gate ${pct}%: both opportunities`);

    // The same excluded installation as a NON-participant (experiment off) keeps the 0.56 rule: one opportunity.
    storage = memoryStorage();
    ifxStore = memoryStorage();
    tracked = [];
    coldStart();
    await setConfig({ maxOpportunitiesPerSession: 2, secondOpportunityRolloutPercent: pct });
    assert.deepEqual(checkpointRounds(30), [7], `baseline, legacy gate ${pct}%: first opportunity only`);
  }
});

test("the snapshot holds for the session: a remote change (disable, new version, new weights) and a cold start change nothing until the next session", async () => {
  const spec = xspec({ cells: [xcell("A", 5, 2, 50), xcell("B", 10, 1, 50)] });
  installation = idInCell(spec, "A");
  await setConfig({ experiments: { interstitial: spec } });
  assert.deepEqual(checkpointRounds(5), [5]);
  const ctx = getEffectiveInterstitialContext();
  assert.deepEqual(ctx, { experimentVersion: 1, cellId: "A", cadence: 5, cap: 2 });

  // mid-session refresh: the experiment is switched off and its version bumped
  await setConfig({ experiments: { interstitial: xspec({ enabled: false, version: 2, cells: [xcell("A", 10, 1, 50), xcell("B", 10, 1, 50)] }) } }, false);
  assert.deepEqual(getEffectiveInterstitialContext(), ctx, "a live config change does not move a running session");
  // cold start in the SAME session under the changed config
  coldStart();
  await setConfig({ experiments: { interstitial: xspec({ enabled: false, version: 2 }) } });
  assert.deepEqual(getEffectiveInterstitialContext(), ctx, "persisted snapshot survives the cold start");
  assert.deepEqual(parseIfxState(ifxStore.raw()).snapshot, { sessionId: session, experimentVersion: 1, cellId: "A", cadence: 5, cap: 2 });
  let rounds: number[] = [];
  for (let r = 1; r <= 5; r++) {
    const before = checkpoints().length;
    completeRound();
    runInterstitialCheckpoint();
    if (checkpoints().length > before) rounds.push(r);
  }
  assert.deepEqual(rounds, [5], "cadence 5 still rules the rest of the session (second opportunity at 5 more games)");

  // next analytics session: the new (off) config applies, baseline cadence 7 / cap 1
  session = "sess00000077";
  assert.deepEqual(getEffectiveInterstitialContext(), { experimentVersion: null, cellId: null, cadence: 7, cap: 1 });
});

test("a failing ifx storage write cannot let a remote change reshape a participant's session", async () => {
  const spec = xspec({ cells: [xcell("A", 5, 2, 50), xcell("B", 10, 1, 50)] });
  installation = idInCell(spec, "A");
  ifxStore.write = () => false;
  await setConfig({ experiments: { interstitial: spec } });
  assert.equal(getEffectiveInterstitialContext()?.cadence, 5);
  await setConfig({ experiments: { interstitial: xspec({ enabled: false }) } }, false);
  assert.equal(getEffectiveInterstitialContext()?.cadence, 5, "held in memory");
});

test("lowering the rollout or disabling returns participants to baseline at the next session; raising it adds others", async () => {
  const spec = xspec({ rolloutPercentInTreatment: 100, cells: [xcell("A", 5, 2, 50), xcell("B", 10, 1, 50)] });
  installation = idInCell(spec, "A");
  await setConfig({ experiments: { interstitial: spec } });
  assert.equal(getEffectiveInterstitialContext()?.cellId, "A");
  session = "sess00000002";
  await setConfig({ experiments: { interstitial: { ...spec, rolloutPercentInTreatment: 0 } } }, false);
  assert.deepEqual(getEffectiveInterstitialContext(), { experimentVersion: null, cellId: null, cadence: 7, cap: 1 });
  session = "sess00000003";
  await setConfig({ experiments: { interstitial: spec } }, false);
  assert.equal(getEffectiveInterstitialContext()?.cellId, "A", "back in: the persisted assignment is kept");
});

test("the control arm is never moved into a cell, even with the experiment fully on", async () => {
  installation = CONTROL_ID;
  await setConfig({ experiments: { interstitial: xspec() } });
  assert.deepEqual(getEffectiveInterstitialContext(), { experimentVersion: null, cellId: null, cadence: 7, cap: 1 });
  assert.equal(getInterstitialControllerDebugInfo().participation?.arm, "control");
  assert.equal(parseIfxState(ifxStore.raw()).assignment, null);
});

test("getEffectiveInterstitialContext: null before any config answer; baseline when the installation takes no part; no ids or buckets", async () => {
  _resetInterstitialConfigForTests(async () => response(503));
  assert.equal(getEffectiveInterstitialContext(), null);
  await setConfig({ countryEligible: false, experiments: { interstitial: xspec() } });
  assert.deepEqual(getEffectiveInterstitialContext(), { experimentVersion: null, cellId: null, cadence: 7, cap: 1 });
  await setConfig({ enabled: false });
  assert.deepEqual(getEffectiveInterstitialContext(), { experimentVersion: null, cellId: null, cadence: 7, cap: 1 });

  const spec = xspec();
  installation = idInCell(spec, "B");
  await setConfig({ experiments: { interstitial: spec } });
  const ctx = getEffectiveInterstitialContext()!;
  assert.deepEqual(Object.keys(ctx).sort(), ["cadence", "cap", "cellId", "experimentVersion"]);
  assert.equal(JSON.stringify(ctx).includes(installation), false);
});

test("nothing handed to analytics or persisted by the experiment contains the installation id", async () => {
  const spec = xspec({ cells: [xcell("A", 5, 2, 50), xcell("B", 7, 2, 50)] });
  installation = idInCell(spec, "A");
  await setConfig({ experiments: { interstitial: spec } });
  checkpointRounds(12);
  recordInterstitialGameStarted("shapeChallenge");
  assert.ok(tracked.length > 0);
  assert.equal(JSON.stringify(tracked).includes(installation), false);
  assert.equal((ifxStore.raw() ?? "").includes(installation), false);
  assert.equal((storage.raw() ?? "").includes(installation), false);
  assert.equal(IFX_STATE_KEY === "cydi.interstitial.v1", false, "its own key; the v1 state parse is untouched");
});

test("the due-state machine for participants matches the pure functions under the cell's cadence/cap (lane logic untouched)", async () => {
  const spec = xspec({ cells: [xcell("A", 5, 2, 50), xcell("B", 7, 3, 50)] });
  installation = idInCell(spec, "B");
  await setConfig({ experiments: { interstitial: spec } });
  assert.deepEqual(checkpointRounds(60, 25), (() => {
    const out: number[] = [];
    let state = parseInterstitialState(null);
    let sessionNo = 1;
    for (let r = 1; r <= 60; r++) {
      if (r > 1 && (r - 1) % 25 === 0) sessionNo++;
      const sid = `sess${String(sessionNo).padStart(8, "0")}`;
      const d = recordEligibleCompletion(state, 7, 3, sid, "treatment", true);
      state = d.state;
      if (d.due) {
        out.push(r);
        state = consumeOpportunity(state, sid);
      }
    }
    return out;
  })());
});

// --- 0.57 telemetry: ifx context, next-game context, play-segment summary -------------------------------

import {
  FULL_SCREEN_AD_BACKGROUND_GRACE_MS,
  _playSegmentCountersForTests,
  _resetPlaySegmentSummaryForTests,
  onLifecycleFlush,
} from "./playSegmentSummary";
import { getInterstitialCellForAnalytics, recordRewardedOfferDeferred, takeNextGameContext } from "./interstitialController";

const eventsNamed = (name: string) => tracked.filter((t) => t.name === name).map((t) => t.params);
const summaries = () => eventsNamed("session_summary");

let clock = 0;
/** The segment summary in "Android, with a controllable clock" mode, reporting into the same `tracked` list. */
let sessionLive = true;
function androidSegments() {
  clock = 1_000_000;
  sessionLive = true;
  _resetPlaySegmentSummaryForTests({
    track: (name, params) => tracked.push({ name, params: params as unknown as Record<string, unknown> }),
    now: () => clock,
    isNative: () => true,
    // the analytics session is live unless a test says otherwise (the real check reads the stored session read-only)
    sessionActive: () => sessionLive,
  });
}

/** A participant of cell `cellId` (cadence/cap as given); version 1. */
async function participantIn(cellId: string, cells: InterstitialExperimentSpec["cells"], baseOver: Partial<InterstitialClientConfig> = {}) {
  const spec = xspec({ cells });
  installation = idInCell(spec, cellId);
  await setConfig({ experiments: { interstitial: spec }, ...baseOver });
  return spec;
}

test("a cell may run cadence 6 / cap 2 (7/2 vs 6/2 vs 5/2 needs no APK): due at 6 and 12, telemetry reports 6, valid, and survives a cold start", async () => {
  await participantIn("A", [xcell("A", 6, 2, 50), xcell("B", 7, 2, 50)]);
  assert.deepEqual(checkpointRounds(14), [6, 12]);
  assert.ok(checkpoints().every((c) => c.gamesBetweenAds === 6));
  for (const c of checkpoints()) assert.equal(validateEventParams("interstitial_checkpoint", c).valid, true);
  assert.equal(persisted().marker?.gamesBetweenAds, 6, "the continuation marker accepts a cell cadence");
  coldStart();
  // Same session, the experiment now switched off remotely: the persisted snapshot (cadence 6) still rules.
  await setConfig({ experiments: { interstitial: xspec({ enabled: false, cells: [xcell("A", 6, 2, 50), xcell("B", 7, 2, 50)] }) } });
  assert.equal(getEffectiveInterstitialContext()?.cadence, 6, "the persisted snapshot with cadence 6 is read back, not dropped");
  assert.equal(getEffectiveInterstitialContext()?.cellId, "A");
  recordInterstitialGameStarted("shapeChallenge");
  const cont = eventsNamed("interstitial_continuation").at(-1)!;
  assert.equal(cont.gamesBetweenAds, 6);
  assert.equal(validateEventParams("interstitial_continuation", cont).valid, true);
});

test("ifx context: a participant's checkpoint and continuation carry cell / version / cap; baseline and control carry none", async () => {
  await participantIn("B", [xcell("A", 5, 2, 50), xcell("B", 7, 2, 50)]);
  assert.equal(getInterstitialCellForAnalytics(), "B");
  checkpointRounds(7);
  recordInterstitialGameStarted("shapeChallenge");
  for (const p of [...checkpoints(), ...eventsNamed("interstitial_continuation")]) {
    assert.equal(p.ifxCell, "B");
    assert.equal(p.ifxVersion, 1);
    assert.equal(p.ifxCap, 2);
    assert.equal(p.gamesBetweenAds, 7);
  }
  assert.equal(checkpoints().length, 1);
  assert.equal(eventsNamed("interstitial_continuation").length, 1);
  assert.equal(validateEventParams("interstitial_checkpoint", checkpoints()[0]).valid, true);
  assert.equal(validateEventParams("interstitial_continuation", eventsNamed("interstitial_continuation")[0]).valid, true);

  // Baseline (no experiment): exactly the 0.56 keys.
  tracked = [];
  storage = memoryStorage();
  ifxStore = memoryStorage();
  installation = TREATMENT_ID;
  coldStart();
  await setConfig({});
  assert.equal(getInterstitialCellForAnalytics(), null);
  checkpointRounds(7);
  recordInterstitialGameStarted("shapeChallenge");
  for (const p of [...checkpoints(), ...eventsNamed("interstitial_continuation")]) {
    assert.equal("ifxCell" in p || "ifxVersion" in p || "ifxCap" in p, false);
  }
  // Control arm with the experiment fully on: never a participant.
  tracked = [];
  storage = memoryStorage();
  ifxStore = memoryStorage();
  installation = CONTROL_ID;
  coldStart();
  await setConfig({ experiments: { interstitial: xspec() } });
  checkpointRounds(7);
  assert.deepEqual(checkpoints(), [{ arm: "control", outcome: "control", gamesBetweenAds: 7 }]);
});

test("participant context never contains an id or bucket (checkpoint, continuation, completion, summary)", async () => {
  await participantIn("A", [xcell("A", 5, 2, 50), xcell("B", 7, 2, 50)]);
  androidSegments();
  checkpointRounds(5);
  recordInterstitialGameStarted("shapeChallenge");
  takeNextGameContext("shapeChallenge");
  onLifecycleFlush();
  assert.ok(summaries().length === 1);
  assert.equal(JSON.stringify(tracked).includes(installation), false);
});

// --- Next-Classic-game completion context ----------------------------------------------------------------

test("next-game context: set at the continuation's game_started, consumed ONCE by the next game_completed", async () => {
  playRounds(7); // checkpoint (not_ready)
  assert.equal(takeNextGameContext("shapeChallenge"), null, "nothing before the next game starts");
  recordInterstitialGameStarted("shapeChallenge");
  assert.deepEqual(takeNextGameContext("shapeChallenge"), { nextOutcome: "not_ready" });
  assert.equal(takeNextGameContext("shapeChallenge"), null, "take-and-clear: a second completion gets nothing");
});

test("next-game context: every treatment outcome is mirrored, and a participant also gets ifxCell", async () => {
  await participantIn("A", [xcell("A", 5, 2, 50), xcell("B", 7, 2, 50)]);
  playRounds(5);
  recordInterstitialGameStarted("shapeChallenge");
  const ctx = takeNextGameContext("shapeChallenge");
  assert.deepEqual(ctx, { nextOutcome: "not_ready", ifxCell: "A" });
  assert.equal(validateEventParams("game_completed", { gameType: "shapeChallenge", category: "geometric", contentKey: "circle", ...ctx }).valid, true);
});

test("next-game context: shown and suppressed (treatment) and show_failed", async () => {
  // shown
  playRounds(6);
  ad.resolveLoad();
  await flush();
  completeRound();
  const pending = runInterstitialCheckpoint();
  ad.fire({ type: "showed" });
  ad.fire({ type: "dismissed" });
  await pending;
  recordInterstitialGameStarted("shapeChallenge");
  assert.deepEqual(takeNextGameContext("shapeChallenge"), { nextOutcome: "shown" });
  // suppressed (a rewarded ad this cycle), next session
  session = "sess00000002";
  registerAdAdapter({ name: "rw", initialize: async () => {}, loadRewarded: async () => {}, showRewarded: async () => null });
  playRounds(6);
  completeRound();
  await showRewardedAd("shape_challenge_double_reward");
  runInterstitialCheckpoint();
  recordInterstitialGameStarted("shapeChallenge");
  assert.deepEqual(takeNextGameContext("shapeChallenge"), { nextOutcome: "suppressed" });
});

test("next-game context: the control arm path (control, and control_suppressed for a suppressed control)", async () => {
  installation = CONTROL_ID;
  playRounds(7);
  recordInterstitialGameStarted("shapeChallenge");
  assert.deepEqual(takeNextGameContext("shapeChallenge"), { nextOutcome: "control" });
  session = "sess00000002";
  registerAdAdapter({ name: "rw", initialize: async () => {}, loadRewarded: async () => {}, showRewarded: async () => null });
  playRounds(6);
  completeRound();
  await showRewardedAd("shape_challenge_double_reward");
  runInterstitialCheckpoint();
  recordInterstitialGameStarted("shapeChallenge");
  assert.deepEqual(takeNextGameContext("shapeChallenge"), { nextOutcome: "control_suppressed" });
});

test("next-game context: a new game_started WITHOUT a fresh marker clears it (abandon then restart)", () => {
  playRounds(7);
  recordInterstitialGameStarted("shapeChallenge"); // sets it
  recordInterstitialGameStarted("shapeChallenge"); // Try Again / a later game: no marker -> cleared
  assert.equal(takeNextGameContext("shapeChallenge"), null);
});

test("next-game context: dropped when the analytics session changed; other game types neither take nor clear it", () => {
  playRounds(7);
  recordInterstitialGameStarted("shapeChallenge");
  assert.equal(takeNextGameContext("dailyChallenge"), null, "a Daily completion does not consume it");
  recordInterstitialGameStarted("dailyChallenge" as GameType); // a non-eligible start does not clear it either
  session = "sess00000002";
  assert.equal(takeNextGameContext("shapeChallenge"), null, "cross-session: dropped");
  assert.equal(takeNextGameContext("shapeChallenge"), null, "and gone");
  // A stale marker from another session sets no context at all.
  session = "sess00000001";
  playRounds(7);
  session = "sess00000003";
  recordInterstitialGameStarted("shapeChallenge");
  assert.equal(takeNextGameContext("shapeChallenge"), null);
});

test("next-game context is memory only: a cold start (kill) loses it, and nothing is persisted for it", () => {
  playRounds(7);
  recordInterstitialGameStarted("shapeChallenge");
  const before = { s: storage.raw(), i: ifxStore.raw() };
  coldStart();
  assert.equal(takeNextGameContext("shapeChallenge"), null);
  assert.deepEqual({ s: storage.raw(), i: ifxStore.raw() }, before);
});

// --- Play-segment summary ---------------------------------------------------------------------------------

test("segment summary: nothing without a completed Classic game; one per segment; a new segment after a genuine background", () => {
  androidSegments();
  onLifecycleFlush();
  assert.equal(summaries().length, 0, "no game, no summary");
  playRounds(3);
  onLifecycleFlush();
  onLifecycleFlush(); // visibilitychange + pagehide + appStateChange for ONE backgrounding
  onLifecycleFlush();
  assert.equal(summaries().length, 1, "at most one per segment");
  assert.deepEqual(summaries()[0], { arm: "treatment", classicGames: 3, checkpoints: 0, shown: 0, notReady: 0, secondReached: 0, rewardedShown: 0, rewardedDeferred: 0, cadence: 7, cap: 1 });
  assert.equal(validateEventParams("session_summary", summaries()[0]).valid, true);
  // Returning later = a NEW segment with fresh counters.
  playRounds(2);
  onLifecycleFlush();
  assert.equal(summaries().length, 2);
  assert.equal(summaries()[1].classicGames, 2);
  // A segment without a game after that emits nothing.
  onLifecycleFlush();
  assert.equal(summaries().length, 2);
});

test("segment summary: web (non-native) emits nothing, and neither do non-Classic games or an ineligible installation", async () => {
  androidSegments();
  _resetPlaySegmentSummaryForTests({ track: (name, params) => tracked.push({ name, params: params as unknown as Record<string, unknown> }), now: () => clock, isNative: () => false });
  playRounds(3);
  onLifecycleFlush();
  assert.equal(summaries().length, 0, "web: nothing");
  androidSegments();
  completeRound("dailyChallenge");
  completeRound("seoPractice");
  onLifecycleFlush();
  assert.equal(summaries().length, 0, "only Classic (shapeChallenge) games count");
  await setConfig({ countryEligible: false });
  androidSegments();
  playRounds(3);
  onLifecycleFlush();
  assert.equal(summaries().length, 0, "an installation that takes no part has no arm and reports nothing");
});

test("segment summary: checkpoints, not-ready, secondReached and the effective cadence/cap (cap 2)", async () => {
  await setConfig({ maxOpportunitiesPerSession: 2 });
  androidSegments();
  playRounds(14);
  onLifecycleFlush();
  assert.deepEqual(summaries()[0], { arm: "treatment", classicGames: 14, checkpoints: 2, shown: 0, notReady: 2, secondReached: 1, rewardedShown: 0, rewardedDeferred: 0, cadence: 7, cap: 2 });
  assert.equal(validateEventParams("session_summary", summaries()[0]).valid, true);
});

test("segment summary: cap 1 never reaches a second opportunity; a second one that is merely DUE counts", async () => {
  androidSegments();
  playRounds(14);
  onLifecycleFlush();
  assert.equal(summaries()[0].checkpoints, 1);
  assert.equal(summaries()[0].secondReached, 0);
  tracked = [];
  storage = memoryStorage();
  coldStart();
  await setConfig({ maxOpportunitiesPerSession: 2 });
  androidSegments();
  playRounds(7); // opportunity 1 consumed
  for (let i = 0; i < 7; i++) completeRound(); // the 14th completion makes the second one DUE; the player never taps Next
  onLifecycleFlush();
  assert.equal(summaries()[0].checkpoints, 1);
  assert.equal(summaries()[0].secondReached, 1);
});

test("segment summary: a shown interstitial is counted; control counts checkpoints but never shown", async () => {
  androidSegments();
  playRounds(6);
  ad.resolveLoad();
  await flush();
  completeRound();
  const pending = runInterstitialCheckpoint();
  ad.fire({ type: "showed" });
  ad.fire({ type: "dismissed" });
  await pending;
  clock += FULL_SCREEN_AD_BACKGROUND_GRACE_MS + 1;
  onLifecycleFlush();
  assert.deepEqual(summaries()[0], { arm: "treatment", classicGames: 7, checkpoints: 1, shown: 1, notReady: 0, secondReached: 0, rewardedShown: 0, rewardedDeferred: 0, cadence: 7, cap: 1 });
  tracked = [];
  storage = memoryStorage();
  installation = CONTROL_ID;
  coldStart();
  await setConfig({});
  androidSegments();
  playRounds(7);
  onLifecycleFlush();
  assert.deepEqual(summaries()[0], { arm: "control", classicGames: 7, checkpoints: 1, shown: 0, notReady: 0, secondReached: 0, rewardedShown: 0, rewardedDeferred: 0, cadence: 7, cap: 1 });
  assert.equal(validateEventParams("session_summary", summaries()[0]).valid, true);
});

test("segment summary: rewarded shown and rewarded-deferred counters", async () => {
  registerAdAdapter({ name: "rw", initialize: async () => {}, loadRewarded: async () => {}, showRewarded: async () => null });
  androidSegments();
  playRounds(2);
  await showRewardedAd("shape_challenge_double_reward");
  await showRewardedAd("shape_challenge_double_reward");
  recordRewardedOfferDeferred();
  clock += FULL_SCREEN_AD_BACKGROUND_GRACE_MS + 1; // the app is left well after the last ad
  onLifecycleFlush();
  assert.equal(summaries()[0].rewardedShown, 2);
  assert.equal(summaries()[0].rewardedDeferred, 1);
  assert.equal(validateEventParams("session_summary", summaries()[0]).valid, true);
});

test("segment summary: counters are capped at 99, so the event always validates", () => {
  androidSegments();
  for (let i = 0; i < 150; i++) {
    completeRound();
    recordRewardedOfferDeferred();
  }
  assert.equal(_playSegmentCountersForTests().classicGames, 99);
  onLifecycleFlush();
  assert.equal(summaries()[0].classicGames, 99);
  assert.equal(summaries()[0].rewardedDeferred, 99);
  assert.equal(validateEventParams("session_summary", summaries()[0]).valid, true);
});

test("segment summary: an interstitial on screen does NOT end the segment; after its dismissal and the grace it does", async () => {
  androidSegments();
  playRounds(6);
  ad.resolveLoad();
  await flush();
  completeRound();
  const pending = runInterstitialCheckpoint();
  assert.ok(pending);
  assert.equal(getInterstitialState(), "showing");
  onLifecycleFlush(); // the Mi 8 emits appStateChange(false) the moment the ad opens
  ad.fire({ type: "showed" });
  onLifecycleFlush();
  assert.equal(summaries().length, 0, "ad on screen: the segment goes on");
  ad.fire({ type: "dismissed" });
  await pending;
  onLifecycleFlush(); // a late background event right after the dismissal: still the ad
  assert.equal(summaries().length, 0, "within the grace after the dismissal");
  clock += FULL_SCREEN_AD_BACKGROUND_GRACE_MS - 1;
  onLifecycleFlush();
  assert.equal(summaries().length, 0);
  clock += 2;
  onLifecycleFlush(); // a genuine background
  assert.equal(summaries().length, 1);
  assert.equal(summaries()[0].classicGames, 7, "one segment spanning the ad");
  assert.equal(summaries()[0].shown, 1);
});

test("segment summary: a rewarded ad on screen does not end the segment either", async () => {
  let finish: (v: null) => void = () => {};
  registerAdAdapter({
    name: "rw",
    initialize: async () => {},
    loadRewarded: async () => {},
    showRewarded: () => new Promise((resolve) => (finish = resolve as (v: null) => void)),
  });
  androidSegments();
  playRounds(2);
  const shown = showRewardedAd("shape_challenge_double_reward");
  await flush();
  onLifecycleFlush();
  assert.equal(summaries().length, 0, "rewarded showing");
  finish(null);
  await shown;
  onLifecycleFlush();
  assert.equal(summaries().length, 0, "grace after the rewarded ad");
  clock += FULL_SCREEN_AD_BACKGROUND_GRACE_MS + 1;
  onLifecycleFlush();
  assert.equal(summaries().length, 1);
  assert.equal(summaries()[0].rewardedShown, 1);
});

test("segment summary: a participant's summary carries the cell's cadence and cap and ifxCell / ifxVersion (no ifxCap)", async () => {
  await participantIn("A", [xcell("A", 6, 2, 50), xcell("B", 7, 2, 50)]);
  androidSegments();
  checkpointRounds(12);
  onLifecycleFlush();
  assert.deepEqual(summaries()[0], { arm: "treatment", classicGames: 12, checkpoints: 2, shown: 0, notReady: 2, secondReached: 1, rewardedShown: 0, rewardedDeferred: 0, cadence: 6, cap: 2, ifxCell: "A", ifxVersion: 1 });
  assert.equal(validateEventParams("session_summary", summaries()[0]).valid, true);
});

test("segment summary: persists nothing (memory only) and starts clean after a cold start", () => {
  androidSegments();
  playRounds(3);
  const before = { s: storage.raw(), i: ifxStore.raw() };
  coldStart();
  androidSegments();
  assert.deepEqual({ s: storage.raw(), i: ifxStore.raw() }, before);
  onLifecycleFlush();
  assert.equal(summaries().length, 0, "the killed process's final segment is lost - documented");
});

test("segment summary: dropped, not emitted, when the analytics session already expired (no phantom session)", () => {
  androidSegments();
  playRounds(3);
  sessionLive = false; // the foreground sat idle past the session timeout after the last event
  onLifecycleFlush();
  assert.equal(summaries().length, 0, "an expired session means the summary is dropped");
  // the counters were taken: the next segment starts from zero and emits once the session is live
  sessionLive = true;
  playRounds(2);
  onLifecycleFlush();
  assert.equal(summaries().length, 1);
  assert.equal(summaries()[0].classicGames, 2, "the dropped segment's games are not carried over");
});

// --- 0.58.0: deferInterstitialThisCycle (the purchase CTA owns this Result) ----------------------------------------

test("0.58.0 defer: a due opportunity is left due - not shown, not consumed, not recorded, cap untouched - and runs at the next Result", async () => {
  const { deferInterstitialThisCycle } = await import("./interstitialController");
  playRounds(6);
  completeRound(); // the 7th eligible completion: due
  assert.equal(deferInterstitialThisCycle(), true, "reports that an opportunity was due (= deferred)");
  assert.equal(runInterstitialCheckpoint(), null);
  assert.equal(checkpoints().length, 0, "nothing recorded");
  assert.equal(persisted().session?.opportunities ?? 0, 0, "nothing consumed / no cap used");
  assert.ok(persisted().eligibleGamesSinceLastOpportunity >= 7, "cadence progress preserved");
  completeRound(); // the next Result: still due, the defer flag is gone
  runInterstitialCheckpoint();
  assert.equal(checkpoints().length, 1);
  assert.equal(persisted().session?.opportunities, 1);
});

test("0.58.0 defer: control is deferred the same way (symmetric across arms); nothing due -> reports false", async () => {
  const { deferInterstitialThisCycle } = await import("./interstitialController");
  installation = CONTROL_ID;
  _resetInterstitialControllerForTests({
    track: (name, params) => tracked.push({ name, params: params as Record<string, unknown> }),
    storage,
    sessionId: () => session,
    installationId: () => installation,
  });
  completeRound();
  assert.equal(deferInterstitialThisCycle(), false, "not due yet");
  playRounds(5);
  completeRound();
  assert.equal(deferInterstitialThisCycle(), true);
  assert.equal(runInterstitialCheckpoint(), null);
  assert.equal(checkpoints().length, 0);
  completeRound();
  runInterstitialCheckpoint();
  assert.deepEqual(checkpoints().map((c) => c.outcome), ["control"]);
});
