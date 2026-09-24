// The experiment as gameplay drives it: arm symmetry, the per-session opportunity
// cap, every outcome consuming the opportunity, one preload per upcoming
// opportunity, rewarded-collision suppression, the continuation marker, and the
// interstitial-only emergency switch.

import { strict as assert } from "node:assert";
import { test, beforeEach } from "node:test";

import {
  _resetInterstitialControllerForTests,
  beginInterstitialResultCycle,
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
import { assignArm, parseInterstitialState, type InterstitialStorage } from "./interstitialExperiment";
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
  assert.deepEqual(checkpoints(), [{ arm: "treatment", outcome: "suppressed", gamesBetweenAds: 7 }]);
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
  assert.deepEqual(checkpoints(), [{ arm: "treatment", outcome: "show_failed", gamesBetweenAds: 7, reason: "sdk_error" }]);
  assert.equal(persisted().session?.opportunities, 1);
});

// --- Preload ------------------------------------------------------------------------

test("exactly one preload per upcoming opportunity - a failed one is not retried before the checkpoint", async () => {
  playRounds(5);
  assert.equal(ad.calls.load, 0, "nothing before cadence-1");
  completeRound(); // 6th = cadence - 1
  runInterstitialCheckpoint();
  assert.equal(ad.calls.load, 1);
  ad.rejectLoad(3);
  await flush();
  completeRound(); // 7th - due, would also qualify for a preload
  assert.equal(ad.calls.load, 1, "no aggressive retry");
  assert.equal(runInterstitialCheckpoint(), null, "not ready -> no waiting");
  assert.equal(checkpoints()[0].outcome, "not_ready");
  const failures = tracked.filter((t) => t.name === "interstitial_load_failed");
  assert.deepEqual(failures.map((f) => f.params), [{ reason: "no_fill" }]);
});

test("after an opportunity is consumed the next upcoming one gets its own preload", async () => {
  playRounds(7);
  session = "sess00000002";
  ad.rejectLoad(2);
  await flush();
  playRounds(5);
  assert.equal(ad.calls.load, 1, "the counter restarted at 0 - five rounds is not yet cadence-1");
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
  assert.deepEqual(checkpoints(), [{ arm: "treatment", outcome: "shown", gamesBetweenAds: 7 }]);
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
  await setConfig({ enabled: false }, false);
  playRounds(10);
  assert.equal(checkpoints().length, 0);
  assert.equal(ad.calls.load, 0);
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
