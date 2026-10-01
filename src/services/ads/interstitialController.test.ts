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
async function setConfig(config: Partial<InterstitialClientConfig> | null, freshRun = true) {
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
let session: string;
let installation: string | null;
let ad: ReturnType<typeof fakeInterstitialAdapter>;
let visibility: ReturnType<typeof manualEnv>;

beforeEach(async () => {
  tracked = [];
  storage = memoryStorage();
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
