// Pre-deploy verification (0.57.0, sections I and J) of the foreground play-segment summary and the one-shot
// next-game completion context, driven END TO END through the REAL modules:
//   fake platform (Android bridge, document/window event targets, localStorage, a controllable clock)
//   -> real analytics identity + real analyticsQueue (real lifecycle listeners, real registerBeforeLifecycleFlush)
//   -> real playSegmentSummary + interstitialController + interstitialAds + rewardedAds
//   -> a fake transport -> the REAL schema validator and the REAL Worker ingest/Analytics Engine mapping.
// Nothing here modifies production code; it only adds checks.
import { strict as assert } from "node:assert";
import { test, beforeEach, afterEach, after } from "node:test";

// ---- fake platform (must exist BEFORE the modules below are imported) --------------------------------------

type Handler = (event?: unknown) => void;
const docHandlers = new Map<string, Handler[]>();
const winHandlers = new Map<string, Handler[]>();
const target = (map: Map<string, Handler[]>) => ({
  addEventListener: (type: string, fn: Handler) => {
    map.set(type, [...(map.get(type) ?? []), fn]);
  },
});
const fakeDocument = { visibilityState: "visible" as "visible" | "hidden", ...target(docHandlers) };
const fakeWindow = { ...target(winHandlers) };
const lsMap = new Map<string, string>();
const fakeLocalStorage = {
  getItem: (k: string) => (lsMap.has(k) ? lsMap.get(k)! : null),
  setItem: (k: string, v: string) => void lsMap.set(k, String(v)),
  removeItem: (k: string) => void lsMap.delete(k),
};
const g = globalThis as Record<string, unknown>;
g.document = fakeDocument;
g.window = fakeWindow;
g.androidBridge = { postMessage() {} }; // Capacitor.getPlatform() === "android"
Object.defineProperty(globalThis, "localStorage", { value: fakeLocalStorage, configurable: true, writable: true });

let clock = 10_000_000;
const realNow = Date.now;
Date.now = () => clock;
after(() => {
  Date.now = realNow;
});

const core = await import("@capacitor/core");
// The App plugin the real queue subscribes to (appStateChange): captured so the REAL listener runs.
const appStateCallbacks: Array<(s: { isActive: boolean }) => void> = [];
core.registerPlugin("App", {
  android: {
    addListener: async (event: string, cb: (s: { isActive: boolean }) => void) => {
      if (event === "appStateChange") appStateCallbacks.push(cb);
      return { remove: async () => {} };
    },
    getInfo: async () => ({ version: "0.57.0", build: "57" }),
  },
});

const queueMod = await import("../analyticsQueue.ts");
const analyticsMod = await import("../analytics.ts");
const identity = await import("../analyticsIdentity.ts");
const clientConfig = await import("../analyticsClientConfig.ts");
const classes = await import("../analyticsEventClasses.ts");
const schema = await import("../analyticsSchema.ts");
const controller = await import("./interstitialController.ts");
const segment = await import("./playSegmentSummary.ts");
const adsMod = await import("./interstitialAds.ts");
const cfgMod = await import("./interstitialConfig.ts");
const expMod = await import("./interstitialExperiment.ts");
const cellsMod = await import("./interstitialCells.ts");
const rewardedMod = await import("./rewardedAds.ts");
const ingest = await import("../../../worker/analyticsIngest.ts");
const shadow = await import("../../../worker/analyticsShadow.ts");
const doMod = await import("../../../worker/analyticsDO.ts");
const ledger = await import("../../../worker/analyticsExactLedger.ts");
type GameType = import("../analyticsSchema.ts").GameType;
type Spec = import("./interstitialConfigSchema.ts").InterstitialExperimentSpec;

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
await flush();
await flush();
const realAppListenerInstalled = appStateCallbacks.length === 1;

// ---- fixtures ----------------------------------------------------------------------------------------------

function findId(arm: "treatment" | "control"): string {
  for (let i = 0; i < 100_000; i++) {
    const id = i.toString(16).padStart(12, "0");
    if (expMod.assignArm(id, 5) === arm) return id;
  }
  throw new Error("no id");
}
const TREATMENT_ID = findId("treatment");
const CONTROL_ID = findId("control");
const BASE = { enabled: true, rolloutPercent: 5, gamesBetweenAds: 7, maxOpportunitiesPerSession: 1, countryEligible: true };
const response = (status: number, body?: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
async function setConfig(config: Record<string, unknown> = {}) {
  const served = { status: 200, body: { ...BASE, ...config } };
  cfgMod._resetInterstitialConfigForTests(async () => response(served.status, served.body) as never);
  await cfgMod.refreshInterstitialConfig();
}
const xcell = (id: string, cadence: number, cap: number, weight: number) => ({ id, cadence, cap, weight }) as Spec["cells"][number];
const xspec = (cells: Spec["cells"]): Spec => ({ enabled: true, rolloutPercentInTreatment: 100, version: 1, cells });
function idInCell(spec: Spec, cellId: string): string {
  for (let i = 0; i < 200_000; i++) {
    const id = `a1${i.toString(16).padStart(10, "0")}`; // a REAL analytics id shape: 12 hex chars
    if (expMod.assignArm(id, 5) === "treatment" && cellsMod.isInExperimentGate(id, spec.version, spec.rolloutPercentInTreatment) && cellsMod.pickCell(id, spec).id === cellId) return id;
  }
  throw new Error("no id");
}

function fakeInterstitialAdapter() {
  let listener: (e: never) => void = () => {};
  let control: { resolve: () => void; reject: (e: unknown) => void } | null = null;
  adsMod.registerInterstitialAdapter({
    name: "fake",
    load: () => new Promise<void>((resolve, reject) => void (control = { resolve, reject })),
    show: () => Promise.resolve(),
    setListener: (l: never) => void (listener = l),
  } as never);
  return { resolveLoad: () => control?.resolve(), fire: (e: { type: string; code?: number }) => listener(e as never) };
}
function manualEnv() {
  return {
    now: () => 0,
    setTimeout: () => 0,
    clearTimeout: () => {},
    isHidden: () => false,
    onVisibilityChange: () => () => {},
    platform: () => "android",
  };
}

// The cloudflare provider's trackEvent (analytics.ts:257-274), which is not exported: same calls, same order.
let tracked: Array<{ name: string; params: Record<string, unknown> }> = [];
function pipelineTrack(name: string, params: unknown) {
  tracked.push({ name, params: params as Record<string, unknown> });
  const rates = clientConfig.getClientConfig();
  const sessionId = identity.getSessionId();
  if (!classes.shouldKeepEvent(name, sessionId, rates)) return;
  const envelope: Record<string, unknown> = analyticsMod.buildAnalyticsEnvelope(name as never, analyticsMod.sanitizeParams(params as never));
  const keep = classes.appliedKeepPercent(name, rates);
  if (keep < 100) envelope.clientKeepPercent = keep;
  queueMod.enqueueAnalyticsEvent(envelope);
}

type Sent = { events: Array<Record<string, unknown>>; keepalive: boolean };
let sent: Sent[] = [];
let ad: ReturnType<typeof fakeInterstitialAdapter>;
let installation: string;

beforeEach(async () => {
  clock = 10_000_000;
  lsMap.clear();
  fakeDocument.visibilityState = "visible";
  installation = TREATMENT_ID;
  lsMap.set("cydi.installationId.v1", installation);
  tracked = [];
  sent = [];
  clientConfig._resetClientConfigForTests();
  queueMod._resetAnalyticsQueueForTests();
  queueMod._setAnalyticsSenderForTests(async (events, opts) => {
    sent.push({ events: JSON.parse(JSON.stringify(events)), keepalive: opts.keepalive });
    return { status: 204 };
  });
  rewardedMod._resetRewardedAdsForTests();
  adsMod._resetInterstitialAdsForTests(manualEnv() as never);
  adsMod.registerInterstitialGates({ consent: () => true, remoteAds: () => true, interstitialEnabled: () => true });
  ad = fakeInterstitialAdapter();
  controller._resetInterstitialControllerForTests({ track: pipelineTrack as never });
  await setConfig();
});
afterEach(() => {
  queueMod._resetAnalyticsQueueForTests(); // clears the 120 s / 20 s timers so the process can exit
});

// ---- platform lifecycle drivers ----------------------------------------------------------------------------

const fire = (map: Map<string, Handler[]>, type: string) => (map.get(type) ?? []).forEach((h) => h());
/** The REAL Capacitor App listener the queue installed (falls back to nothing: asserted by realAppListenerInstalled). */
const appState = (isActive: boolean) => appStateCallbacks.forEach((cb) => cb({ isActive }));
function visibility(state: "visible" | "hidden") {
  fakeDocument.visibilityState = state;
  fire(docHandlers, "visibilitychange");
}
const pagehide = () => fire(winHandlers, "pagehide");
/** One real backgrounding as the Mi 8 may deliver it: every trigger fires. */
function backgroundAll() {
  appState(false);
  visibility("hidden");
  pagehide();
}
function foreground() {
  appState(true);
  visibility("visible");
}

function completeRound(gameType: GameType = "shapeChallenge") {
  controller.beginInterstitialResultCycle();
  controller.recordInterstitialGameCompleted(gameType);
}
function playRounds(n: number) {
  for (let i = 0; i < n; i++) {
    completeRound();
    controller.runInterstitialCheckpoint();
  }
}
const allEvents = () => sent.flatMap((b) => b.events);
const summaryEnvs = () => allEvents().filter((e) => e.eventName === "session_summary");
const summaryParams = () => summaryEnvs().map((e) => e.params as Record<string, unknown>);

/** Validate an emitted summary envelope against the real schema validator, the Worker ingest and the AE mapping. */
function assertAccepted(env: Record<string, unknown>) {
  assert.equal(schema.validateEventParams("session_summary", env.params).valid, true, JSON.stringify(env.params));
  assert.equal(classes.classifyEvent("session_summary"), "telemetry");
  assert.equal(ledger.EXACT_LEDGER_EVENTS.has("session_summary"), false);
  const body = JSON.stringify({ events: [env] });
  const checked = ingest.checkedEnvelopes(ingest.parseIngest("/events", body));
  assert.equal(checked.length, 1);
  assert.equal(checked[0].eventName, "session_summary", "the Worker's DO acceptance path accepts it");
  const rows = shadow.buildShadowDataPoints("/events", body, "DE", () => 0.5);
  assert.equal(rows.length, 1, "exactly one Analytics Engine row");
  assert.equal(rows[0].blobs[0], "session_summary");
  const single = JSON.stringify(env);
  assert.ok(single.length < doMod.MAX_BODY_BYTES, `${single.length} < ${doMod.MAX_BODY_BYTES}`);
  // An exact event would be persisted to the outbox: a summary never is.
  assert.equal(queueMod._analyticsOutboxForTests().some((e) => e.envelope.eventName === "session_summary"), false);
}

test("harness sanity: the REAL Capacitor appStateChange listener and the document/window listeners are installed", () => {
  assert.equal(core.Capacitor.isNativePlatform(), true);
  assert.equal(realAppListenerInstalled, true, "analyticsQueue.ts installed its App.addListener('appStateChange') handler");
  assert.ok((docHandlers.get("visibilitychange") ?? []).length >= 1);
  assert.ok((winHandlers.get("pagehide") ?? []).length >= 1);
});

// ================================================== I - segment summary ======================================

test("I(a) foreground, games, interstitial shown, ad-pause appState(false)/(true), game, background => ONE summary, shown 1", async () => {
  foreground();
  playRounds(6);
  ad.resolveLoad();
  await flush();
  completeRound(); // 7th completion: due
  const pending = controller.runInterstitialCheckpoint();
  assert.ok(pending);
  appState(false); // the Mi 8: appStateChange(false) the moment the ad opens
  ad.fire({ type: "showed" });
  appState(false);
  visibility("hidden");
  assert.equal(summaryEnvs().length, 0, "an AdMob pause never closes the segment");
  ad.fire({ type: "dismissed" });
  await pending;
  appState(true);
  visibility("visible");
  completeRound(); // 8th
  controller.runInterstitialCheckpoint();
  clock += segment.FULL_SCREEN_AD_BACKGROUND_GRACE_MS + 1000; // genuinely leaves later
  backgroundAll();
  assert.equal(summaryEnvs().length, 1, "ONE summary for the whole segment");
  assert.deepEqual(summaryParams()[0], { arm: "treatment", classicGames: 8, checkpoints: 1, shown: 1, notReady: 0, secondReached: 0, rewardedShown: 0, rewardedDeferred: 0, cadence: 7, cap: 1 });
  assertAccepted(summaryEnvs()[0]);
});

test("I(b) foreground, game, background, foreground, game, background => TWO summaries, one game each; counters reset exactly at the boundary", () => {
  foreground();
  completeRound();
  backgroundAll();
  assert.equal(summaryEnvs().length, 1);
  assert.deepEqual(segment._playSegmentCountersForTests(), { classicGames: 0, checkpoints: 0, shown: 0, notReady: 0, secondReached: 0, rewardedShown: 0, rewardedDeferred: 0 });
  clock += 5000;
  foreground();
  completeRound();
  backgroundAll();
  assert.equal(summaryEnvs().length, 2);
  assert.deepEqual(summaryParams().map((p) => p.classicGames), [1, 1]);
  summaryEnvs().forEach(assertAccepted);
});

test("I(c) duplicate lifecycle callbacks (false,false,false / true,true / hidden+pagehide) => exactly one summary", () => {
  foreground();
  completeRound();
  appState(false);
  appState(false);
  appState(false);
  visibility("hidden");
  pagehide();
  pagehide();
  assert.equal(summaryEnvs().length, 1);
  appState(true);
  appState(true);
  visibility("visible");
  assert.equal(summaryEnvs().length, 1, "foreground callbacks never emit");
  appState(false);
  assert.equal(summaryEnvs().length, 1, "no game in the new segment -> nothing");
});

test("I(d) background with zero Classic games: nothing (also for Daily / practice only)", () => {
  foreground();
  backgroundAll();
  foreground();
  completeRound("dailyChallenge");
  completeRound("seoPractice");
  completeRound("megaChallenge" as GameType);
  backgroundAll();
  assert.equal(summaryEnvs().length, 0);
  assert.equal(allEvents().length, 0, "and no other event either");
});

test("I(e) background right after a dismissal: inside the 3 s grace it does not end the segment, after it does", async () => {
  foreground();
  playRounds(6);
  ad.resolveLoad();
  await flush();
  completeRound();
  const pending = controller.runInterstitialCheckpoint();
  ad.fire({ type: "showed" });
  ad.fire({ type: "dismissed" });
  await pending;
  clock += segment.FULL_SCREEN_AD_BACKGROUND_GRACE_MS - 1;
  appState(false);
  assert.equal(summaryEnvs().length, 0, "grace - 1 ms: still the ad");
  clock += 1; // exactly 3000 ms after the dismissal
  appState(false);
  assert.equal(summaryEnvs().length, 1, "at exactly the grace the background is genuine (strictly-less-than rule)");
  assert.equal(summaryParams()[0].shown, 1);
  assertAccepted(summaryEnvs()[0]);
});

test("I(f) a rewarded ad pause does not close the segment; rewardedShown is counted; a later genuine background emits once", async () => {
  let finish: (v: null) => void = () => {};
  rewardedMod.registerAdAdapter({ name: "rw", initialize: async () => {}, loadRewarded: async () => {}, showRewarded: () => new Promise((resolve) => (finish = resolve as (v: null) => void)) } as never);
  foreground();
  playRounds(2);
  const shown = rewardedMod.showRewardedAd("shape_challenge_double_reward");
  await flush();
  appState(false);
  visibility("hidden");
  assert.equal(summaryEnvs().length, 0, "rewarded on screen");
  finish(null);
  await shown;
  appState(true);
  visibility("visible");
  appState(false);
  assert.equal(summaryEnvs().length, 0, "within the grace after the rewarded ad");
  clock += segment.FULL_SCREEN_AD_BACKGROUND_GRACE_MS + 1;
  backgroundAll();
  assert.equal(summaryEnvs().length, 1);
  assert.equal(summaryParams()[0].rewardedShown, 1);
  assertAccepted(summaryEnvs()[0]);
});

test("I(g) several checkpoints in one segment (cap 2): counts, secondReached, no double count", async () => {
  await setConfig({ maxOpportunitiesPerSession: 2 });
  foreground();
  playRounds(14);
  clock += 10_000;
  backgroundAll();
  assert.equal(summaryEnvs().length, 1);
  assert.deepEqual(summaryParams()[0], { arm: "treatment", classicGames: 14, checkpoints: 2, shown: 0, notReady: 2, secondReached: 1, rewardedShown: 0, rewardedDeferred: 0, cadence: 7, cap: 2 });
  assertAccepted(summaryEnvs()[0]);
});

test("I(h) control arm and treatment arm both report; control never has shown / notReady", () => {
  foreground();
  playRounds(7);
  backgroundAll();
  const t = summaryParams()[0];
  assert.equal(t.arm, "treatment");
  assert.equal(t.checkpoints, 1);
  assert.equal(t.notReady, 1);
  summaryEnvs().forEach(assertAccepted);

  // control
  tracked = [];
  sent = [];
  lsMap.clear();
  installation = CONTROL_ID;
  lsMap.set("cydi.installationId.v1", installation);
  controller._resetInterstitialControllerForTests({ track: pipelineTrack as never });
  return setConfig().then(() => {
    foreground();
    playRounds(7);
    backgroundAll();
    assert.deepEqual(summaryParams()[0], { arm: "control", classicGames: 7, checkpoints: 1, shown: 0, notReady: 0, secondReached: 0, rewardedShown: 0, rewardedDeferred: 0, cadence: 7, cap: 1 });
    assertAccepted(summaryEnvs()[0]);
  });
});

test("I(i) participant carries ifxCell/ifxVersion and the cell's cadence/cap; baseline carries neither key", async () => {
  const spec = xspec([xcell("A", 5, 2, 50), xcell("B", 10, 1, 50)]);
  installation = idInCell(spec, "A");
  lsMap.set("cydi.installationId.v1", installation);
  controller._resetInterstitialControllerForTests({ track: pipelineTrack as never });
  await setConfig({ experiments: { interstitial: spec } });
  foreground();
  playRounds(10);
  backgroundAll();
  const p = summaryParams()[0];
  assert.equal(p.ifxCell, "A");
  assert.equal(p.ifxVersion, 1);
  assert.equal(p.cadence, 5);
  assert.equal(p.cap, 2);
  assert.equal("ifxCap" in p, false);
  assertAccepted(summaryEnvs()[0]);
  const row = shadow.buildShadowDataPoints("/events", JSON.stringify({ events: [summaryEnvs()[0]] }), "DE", () => 0.5)[0];
  assert.deepEqual([row.doubles[8], row.doubles[9], row.doubles[10], row.doubles[11]], [5, 2, 1, 1], "cadence / cap / version / cell A");
  // identifiers never ride in params or AE row
  assert.equal(JSON.stringify([p, row.blobs, row.doubles]).includes(installation), false);

  // baseline (experiment off)
  sent = [];
  lsMap.clear();
  installation = TREATMENT_ID;
  lsMap.set("cydi.installationId.v1", installation);
  controller._resetInterstitialControllerForTests({ track: pipelineTrack as never });
  await setConfig();
  foreground();
  playRounds(3);
  backgroundAll();
  const b = summaryParams()[0];
  assert.equal("ifxCell" in b || "ifxVersion" in b, false);
  assert.equal(b.cadence, 7);
  assertAccepted(summaryEnvs()[0]);
});

test("I(j) web (non-native) emits nothing, but the queue still flushes", () => {
  segment._resetPlaySegmentSummaryForTests({ track: pipelineTrack as never, isNative: () => false });
  foreground();
  playRounds(3);
  backgroundAll();
  assert.equal(summaryEnvs().length, 0);
  // Observation: on web the hook returns early, so the (memory-only, capped at 99) counters just keep counting; nothing is ever sent.
  assert.equal(segment._playSegmentCountersForTests().classicGames, 3);
});

test("I(k) an installation without an arm (country ineligible / kill switch / rollout-unassigned) emits nothing and counts nothing", async () => {
  for (const config of [{ countryEligible: false }, { enabled: false }]) {
    sent = [];
    controller._resetInterstitialControllerForTests({ track: pipelineTrack as never });
    await setConfig(config);
    foreground();
    playRounds(4);
    assert.equal(segment._playSegmentCountersForTests().classicGames, 0, `${JSON.stringify(config)}: nothing counted`);
    backgroundAll();
    assert.equal(summaryEnvs().length, 0, JSON.stringify(config));
  }
  // rollout-unassigned: an id outside rolloutPercent
  let outside = "";
  for (let i = 0; i < 100_000 && !outside; i++) {
    const id = `ff${i.toString(16).padStart(10, "0")}`;
    if (expMod.assignArm(id, 5) === "unassigned") outside = id;
  }
  assert.ok(outside);
  lsMap.set("cydi.installationId.v1", outside);
  sent = [];
  controller._resetInterstitialControllerForTests({ track: pipelineTrack as never });
  await setConfig();
  foreground();
  playRounds(4);
  backgroundAll();
  assert.equal(summaryEnvs().length, 0, "outside the rollout percentage: no summary (the baseline population is NOT sampled)");
});

test("I(l) the summary is enqueued BEFORE the queue's own lifecycle flush and leaves in the SAME keepalive request; no timer left", () => {
  foreground();
  completeRound(); // enqueues game-related telemetry? (none here) - add a telemetry event ahead of it
  queueMod.enqueueAnalyticsEvent({ eventName: "shape_started", params: {}, marker: 1 });
  assert.equal(queueMod._analyticsQueueStateForTests().queued, 1);
  backgroundAll();
  const withSummary = sent.filter((b) => b.events.some((e) => e.eventName === "session_summary"));
  assert.equal(withSummary.length, 1);
  assert.equal(withSummary[0].keepalive, true, "the backgrounding request");
  assert.equal(withSummary[0].events.at(-1)?.eventName, "session_summary", "after what was already queued, in the same batch");
  assert.equal(withSummary[0].events[0].marker, 1);
  assert.equal(queueMod._analyticsQueueStateForTests().queued, 0);
  assert.equal(queueMod._analyticsQueueStateForTests().timerArmed, false, "never waits for the 120 s timer");
  // The summary is the ONLY thing in an otherwise EMPTY queue: it still goes out immediately.
  sent = [];
  foreground();
  completeRound();
  backgroundAll();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].events.length, 1);
  assert.equal(sent[0].events[0].eventName, "session_summary");
  assert.equal(sent[0].keepalive, true);
});

test("I(l2) a hook registered as a SEPARATE listener would lose the race: only registerBeforeLifecycleFlush guarantees the order", () => {
  // Documents WHY the design uses the hook: an event enqueued after the lifecycle flush stays in the queue.
  foreground();
  queueMod.flushAnalyticsQueue("lifecycle");
  queueMod.enqueueAnalyticsEvent({ eventName: "session_summary", params: {} });
  assert.equal(queueMod._analyticsQueueStateForTests().queued, 1);
  assert.equal(queueMod._analyticsQueueStateForTests().timerArmed, true);
});

test("I(m) a pre-existing ad grace never leaks across segments: a game, genuine background, then a new segment is clean", async () => {
  foreground();
  playRounds(6);
  ad.resolveLoad();
  await flush();
  completeRound();
  const pending = controller.runInterstitialCheckpoint();
  ad.fire({ type: "showed" });
  ad.fire({ type: "dismissed" });
  await pending;
  clock += 10_000;
  backgroundAll();
  assert.equal(summaryEnvs().length, 1);
  foreground();
  completeRound();
  clock += 10_000;
  backgroundAll();
  assert.equal(summaryEnvs().length, 2);
  assert.deepEqual([summaryParams()[1].classicGames, summaryParams()[1].shown, summaryParams()[1].checkpoints], [1, 0, 0]);
});

// ---- the getSessionId() side effect -------------------------------------------------------------------------

const sessionStamp = () => (JSON.parse(lsMap.get("cydi.analyticsSession.v1") ?? "{}") as { id?: string; lastActivity?: number });

test("I(n) FINDING: with no Classic game the background touches no session state; WITH a game the summary refreshes the session activity stamp", () => {
  // No game: the lifecycle path itself never calls getSessionId().
  foreground();
  const before = { ...sessionStamp() };
  clock += 10 * 60_000;
  backgroundAll();
  assert.deepEqual(sessionStamp(), before, "no summary -> no getSessionId() at background time (stamp untouched)");

  // With a game: the stamp is moved to the background moment (participation() + trackEvent() both call getSessionId()).
  foreground();
  clock += 1000;
  completeRound(); // identity.getSessionId() is not called by the segment recorder itself; the controller read it for its cadence state
  const afterGame = sessionStamp().lastActivity;
  clock += 20 * 60_000; // 20 min idle in the foreground (still inside the 30 min session timeout)
  backgroundAll();
  assert.equal(summaryEnvs().length, 1);
  assert.equal(sessionStamp().lastActivity, clock, "KNOWN DEVIATION: the background moment became the session's last activity");
  assert.ok((afterGame ?? 0) < clock);
});

test("I(o) FIXED: a foreground idle > 30 min before the background DROPS the summary - no new analytics session, stamp untouched", () => {
  foreground();
  completeRound();
  const before = { ...sessionStamp() };
  clock += 31 * 60_000; // screen left on, no events
  backgroundAll();
  assert.equal(summaryEnvs().length, 0, "the summary is dropped instead of starting a phantom session");
  assert.deepEqual(sessionStamp(), before, "the stored session (id and activity stamp) is untouched: no rotation, no refresh");
});

// ---- keep% / sampling ---------------------------------------------------------------------------------------

test("I(p) telemetry sampling drops the whole summary with its session, and a kept one carries clientKeepPercent; never in the exact outbox", () => {
  // keep 0% -> dropped before it is queued
  clientConfig.applyConfigHeader(JSON.stringify({ v: 1, telemetryKeepPercent: 0, diagnosticKeepPercent: 0 }), clock);
  foreground();
  completeRound();
  backgroundAll();
  assert.equal(summaryEnvs().length, 0);
  // keep 100% in-bucket -> sent; with a partial percent the envelope carries the weight
  clientConfig._resetClientConfigForTests();
  clientConfig.applyConfigHeader(JSON.stringify({ v: 1, telemetryKeepPercent: 99, diagnosticKeepPercent: 99 }), clock);
  let kept = 0;
  for (let i = 0; i < 40; i++) {
    sent = [];
    lsMap.delete("cydi.analyticsSession.v1");
    foreground();
    completeRound();
    backgroundAll();
    if (summaryEnvs().length) {
      kept++;
      assert.equal(summaryEnvs()[0].clientKeepPercent, 99);
      assertAccepted(summaryEnvs()[0]);
    }
    clock += 40 * 60_000;
  }
  assert.ok(kept > 0, "some sessions are kept at 99%");
});

test("I(q) maximum envelope (worst participant, all counters 99, long ids/build) stays under MAX_BODY_BYTES", () => {
  const worst = { arm: "treatment", classicGames: 99, checkpoints: 99, shown: 99, notReady: 0, secondReached: 1, rewardedShown: 99, rewardedDeferred: 99, cadence: 20, cap: 3, ifxCell: "F", ifxVersion: 1_000_000 };
  const env = { ...analyticsMod.buildAnalyticsEnvelope("session_summary", worst as never), clientKeepPercent: 10, isInternal: true };
  const len = JSON.stringify(env).length;
  assert.ok(len < doMod.MAX_BODY_BYTES, `${len} < ${doMod.MAX_BODY_BYTES}`);
  assert.equal(schema.validateEventParams("session_summary", worst).valid, true);
  console.log(`# worst-case session_summary envelope: ${len} bytes (limit ${doMod.MAX_BODY_BYTES})`);
});

test("I(r) a hostile / invalid session_summary is rejected by the validator and writes no AE row", () => {
  const ok = { arm: "treatment", classicGames: 2, checkpoints: 1, shown: 0, notReady: 1, secondReached: 0, rewardedShown: 0, rewardedDeferred: 0, cadence: 7, cap: 1 };
  for (const bad of [
    { ...ok, classicGames: 0 },
    { ...ok, classicGames: 100 },
    { ...ok, shown: 1, notReady: 1 },
    { ...ok, arm: "control", notReady: 1 },
    { ...ok, ifxCell: "A" },
    { ...ok, extra: 1 },
    { ...ok, installationId: "x" },
    { ...ok, cadence: 4 },
    { ...ok, cap: 4 },
  ]) {
    assert.equal(schema.validateEventParams("session_summary", bad).valid, false, JSON.stringify(bad));
    const body = JSON.stringify({ events: [{ eventName: "session_summary", params: bad, platform: "android", installationId: "a".repeat(12), sessionId: "b".repeat(12) }] });
    assert.equal(shadow.buildShadowDataPoints("/events", body, "DE").length, 0);
  }
});

test("I(s) process-kill limitation is documented in the code and nothing is persisted", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("./playSegmentSummary.ts", import.meta.url), "utf8");
  assert.match(src, /process dies without a lifecycle callback/);
  assert.match(src, /the final segment's summary is lost/);
  foreground();
  playRounds(3);
  const before = [...lsMap.entries()].map(([k, v]) => `${k}=${v}`).sort().join("|");
  // a cold start (kill) = a fresh module state with nothing to report
  controller._resetInterstitialControllerForTests({ track: pipelineTrack as never });
  backgroundAll();
  assert.equal(summaryEnvs().length, 0, "the killed process's final segment is lost");
  const after2 = [...lsMap.entries()].map(([k, v]) => `${k}=${v}`).sort().join("|");
  assert.equal(after2.includes("session_summary"), false);
  void before;
});

// ================================================== J - next-game context ====================================

/** A fresh controller whose analytics session is a stub we can rotate, in the same real pipeline. */
let stubSession = "sess00000001";
function useStubSession() {
  stubSession = "sess00000001";
  controller._resetInterstitialControllerForTests({ track: pipelineTrack as never, sessionId: () => stubSession });
}
const GAME = { gameType: "shapeChallenge", category: "geometric", contentKey: "circle" };
const checkpointsOf = () => tracked.filter((t) => t.name === "interstitial_checkpoint").map((t) => t.params);
const continuations = () => tracked.filter((t) => t.name === "interstitial_continuation").map((t) => t.params);
/** Mirrors ShapeChallengeScreen.tsx:957-960 + 1237-1238 exactly (game_started effect and game_completed). */
function startClassic() {
  controller.recordInterstitialGameStarted("shapeChallenge");
}
function completeClassicLikeScreen(practice = false) {
  const gt: GameType = practice ? "seoPractice" : "shapeChallenge";
  const ctx = practice ? null : controller.takeNextGameContext(gt);
  const params = { ...GAME, gameType: gt, ...ctx };
  assert.equal(schema.validateEventParams("game_completed", params).valid, true, JSON.stringify(params));
  completeRound(gt);
  return params as Record<string, unknown>;
}
/** 7 completed Classic rounds -> the cadence-7 checkpoint (not_ready: nothing is loaded). */
function reachCheckpoint() {
  for (let i = 0; i < 7; i++) {
    completeRound();
    controller.runInterstitialCheckpoint();
  }
  assert.equal(checkpointsOf().length >= 1, true);
}

test("J1 checkpoint -> next game starts -> completes: nextOutcome present exactly once, continuation row emitted once", () => {
  useStubSession();
  reachCheckpoint();
  startClassic();
  assert.equal(continuations().length, 1);
  const first = completeClassicLikeScreen();
  assert.equal(first.nextOutcome, "not_ready");
  startClassic(); // the following game
  const second = completeClassicLikeScreen();
  assert.equal("nextOutcome" in second, false, "one-shot");
  assert.equal(continuations().length, 1);
});

test("J2 checkpoint -> next game starts -> abandoned: no later completion carries it; the continuation row exists", () => {
  useStubSession();
  reachCheckpoint();
  startClassic(); // continuation emitted, context set
  assert.equal(continuations().length, 1);
  // abandoned (Back to Map); the player later starts another Classic game
  startClassic();
  const later = completeClassicLikeScreen();
  assert.equal("nextOutcome" in later, false);
  assert.equal(controller.takeNextGameContext("shapeChallenge"), null);
});

test("J3 checkpoint -> app background: marker and context are memory/storage-held; same analytics session continues, >30 min drops it", () => {
  useStubSession();
  reachCheckpoint();
  backgroundAll(); // summary emitted for the segment; marker is persisted, not touched by the background
  foreground();
  startClassic();
  assert.equal(continuations().length, 1, "marker survives a background within the same analytics session");
  backgroundAll(); // START -> background (context set, in memory)
  foreground();
  assert.equal(completeClassicLikeScreen().nextOutcome, "not_ready", "context survives a background in the same process and session");
  // session rotated by a long background: a pending context is dropped (analytics session boundary)
  reachCheckpoint2();
  function reachCheckpoint2() {
    stubSession = "sess00000002";
    tracked = [];
    // session-cap 1: a new session may consume a new opportunity once progress counts on
    for (let i = 0; i < 8; i++) {
      completeRound();
      controller.runInterstitialCheckpoint();
    }
  }
  startClassic();
  stubSession = "sess00000003";
  assert.equal(controller.takeNextGameContext("shapeChallenge"), null, "context of another analytics session is dropped");
});

test("J3b a process kill (cold start) loses the context: memory only, no persisted copy of it", () => {
  useStubSession();
  reachCheckpoint();
  startClassic();
  const persistedBefore = [...lsMap.entries()].filter(([k]) => k.startsWith("cydi.interstitial") || k.startsWith("cydi.ifx")).map(([, v]) => v).join("|");
  assert.equal(persistedBefore.includes("nextOutcome"), false);
  useStubSession(); // a fresh process
  assert.equal(controller.takeNextGameContext("shapeChallenge"), null);
});

test("J4 unrelated modes (Daily / Mega / Special / artist / custom): their start/completion neither consume nor carry the context", () => {
  useStubSession();
  reachCheckpoint(); // marker written
  for (const gt of ["dailyChallenge", "megaChallenge", "specialChallenge", "artistPack", "customChallenge", "seoPractice", "passPlay", "playTogether"] as GameType[]) {
    controller.recordInterstitialGameStarted(gt);
    assert.equal(controller.takeNextGameContext(gt), null, `${gt} does not take it`);
  }
  assert.equal(continuations().length, 0, "marker untouched by non-Classic starts (no continuation yet)");
  startClassic(); // the next CLASSIC game consumes the marker (the context is 'next Classic game', whenever it comes in the session)
  assert.equal(continuations().length, 1);
  // now a Daily game is played mid-way: the pending context survives it and is not leaked into the Daily completion
  controller.recordInterstitialGameStarted("dailyChallenge" as GameType);
  assert.equal(controller.takeNextGameContext("dailyChallenge" as GameType), null);
  assert.equal(completeClassicLikeScreen().nextOutcome, "not_ready");
});

test("J4b context pending, then a later Classic start (no fresh marker) clears it: no stale leak into a later Classic game", () => {
  useStubSession();
  reachCheckpoint();
  startClassic(); // context set
  controller.recordInterstitialGameStarted("dailyChallenge" as GameType);
  startClassic(); // abandoned game replaced by a new Classic game: the old context is cleared
  assert.equal("nextOutcome" in completeClassicLikeScreen(), false);
});

test("J5 practice (seoPractice): start and completion neither consume nor carry the context", () => {
  useStubSession();
  reachCheckpoint();
  controller.recordInterstitialGameStarted("seoPractice");
  const practice = completeClassicLikeScreen(true);
  assert.equal("nextOutcome" in practice, false);
  startClassic();
  assert.equal(completeClassicLikeScreen().nextOutcome, "not_ready", "the next real Classic game still gets it");
});

test("J6 Try Again after a checkpoint: it is a Classic game_started like Next Shape, so it consumes the marker and its completion carries the outcome", () => {
  useStubSession();
  reachCheckpoint();
  // handleTryAgainFromResult -> runInterstitialCheckpoint -> handleTryAgain -> phase 'preview' -> game_started (same effect as Next Shape)
  startClassic();
  const retried = completeClassicLikeScreen();
  assert.equal(retried.nextOutcome, "not_ready");
  assert.equal(continuations().length, 1);
});

test("J7 new analytics session: marker from the previous session is dropped without an event and sets no context", () => {
  useStubSession();
  reachCheckpoint();
  stubSession = "sess00000002";
  startClassic();
  assert.equal(continuations().length, 0);
  assert.equal("nextOutcome" in completeClassicLikeScreen(), false);
});

test("J8 two checkpoints without a game_started between them: the LATEST marker wins, nothing stale", async () => {
  useStubSession();
  await setConfig({ maxOpportunitiesPerSession: 2 });
  controller._resetInterstitialControllerForTests({ track: pipelineTrack as never, sessionId: () => stubSession });
  for (let i = 0; i < 7; i++) {
    completeRound();
    controller.runInterstitialCheckpoint();
  }
  // Second opportunity: complete 7 more rounds with NO game_started in between (e.g. the starts were lost)
  registerRewardedSuppress();
  function registerRewardedSuppress() {
    rewardedMod.registerAdAdapter({ name: "rw", initialize: async () => {}, loadRewarded: async () => {}, showRewarded: async () => null } as never);
  }
  for (let i = 0; i < 6; i++) completeRound();
  completeRound();
  await rewardedMod.showRewardedAd("shape_challenge_double_reward"); // a rewarded ad this cycle -> the second checkpoint is "suppressed"
  controller.runInterstitialCheckpoint();
  assert.deepEqual(checkpointsOf().map((c) => c.outcome), ["not_ready", "suppressed"]);
  startClassic();
  assert.equal(continuations().length, 1);
  assert.equal(continuations()[0].outcome, "suppressed", "latest wins");
  assert.equal(completeClassicLikeScreen().nextOutcome, "suppressed");
});

test("J9 no persistent identifier and no extra row: the continuation is the only added row, the field rides on game_completed", () => {
  useStubSession();
  reachCheckpoint();
  const before = tracked.length;
  startClassic();
  const added = tracked.slice(before).map((t) => t.name);
  assert.deepEqual(added, ["interstitial_continuation"], "no new event type from the context itself");
  const blob = JSON.stringify(controller.takeNextGameContext("shapeChallenge"));
  assert.equal(blob.includes(stubSession), false);
  assert.equal(blob.includes(installation), false);
  const persistedKeys = [...lsMap.keys()].filter((k) => k.includes("nextGame") || k.includes("next_game"));
  assert.deepEqual(persistedKeys, []);
});

test("J10 game_completed payloads: old form, coin block, nextOutcome, nextOutcome+ifxCell, invalid combos; AE slots; economy columns undisturbed", () => {
  const valid = (p: unknown) => schema.validateEventParams("game_completed", p).valid;
  const COINS = { coinsEarned: 40, balanceBucket: "100_499" };
  assert.equal(valid(GAME), true, "old form");
  assert.equal(valid({ ...GAME, ...COINS }), true, "with coin block");
  assert.equal(valid({ ...GAME, nextOutcome: "shown" }), true);
  assert.equal(valid({ ...GAME, ...COINS, nextOutcome: "control_suppressed", ifxCell: "E" }), true);
  for (const o of schema.NEXT_GAME_OUTCOMES) assert.equal(valid({ ...GAME, nextOutcome: o }), true, o);
  for (const bad of [
    { ...GAME, ifxCell: "A" }, // cell without outcome
    { ...GAME, nextOutcome: "bogus" },
    { ...GAME, nextOutcome: "shown", ifxCell: "Z" },
    { ...GAME, gameType: "dailyChallenge", nextOutcome: "shown" }, // Classic only
    { ...GAME, gameType: "seoPractice", nextOutcome: "shown" },
    { ...GAME, nextOutcome: "shown", installationId: "x" },
    { ...GAME, nextOutcome: "shown", extra: 1 },
    { ...GAME, coinsEarned: 40 }, // half a coin block
  ]) assert.equal(valid(bad), false, JSON.stringify(bad));

  const env = (params: unknown) => JSON.stringify({ eventName: "game_completed", params, platform: "android", installationId: "a".repeat(12), sessionId: "b".repeat(12), appVersion: "0.57.0" });
  const row = (params: unknown) => shadow.buildShadowDataPoints("/event", env(params), "DE", () => 0.5)[0];
  const plain = row({ ...GAME, ...COINS });
  const next = row({ ...GAME, ...COINS, nextOutcome: "shown", ifxCell: "C" });
  assert.equal(next.blobs[18], "shown", "blob19 = nextOutcome");
  assert.equal(next.doubles[11], 3, "double12 = ifxCell C");
  assert.equal(plain.blobs[18], "");
  assert.equal(plain.doubles[11], 0);
  for (let i = 0; i < 20; i++) if (i !== 11) assert.equal(next.doubles[i], plain.doubles[i], `double${i + 1}`);
  for (let i = 0; i < 20; i++) if (i !== 18) assert.equal(next.blobs[i], plain.blobs[i], `blob${i + 1}`);
  assert.equal(next.doubles[13], plain.doubles[13], "double14 balance bucket");
  assert.equal(next.doubles[17], 40, "double18 coinsEarned");
  assert.equal(next.doubles.length, 20);
  assert.equal(next.blobs.length, 20);
  // game_completed stays EXACT/ledger-class exactly as before (not changed by the field)
  assert.equal(classes.classifyEvent("game_completed"), "telemetry");
  // DO counters accept the new field without a counter of their own
  const counters = doMod.incrementEvent({}, "game_completed", { ...GAME, ...COINS, nextOutcome: "shown" } as never, "android");
  assert.ok(counters.game_completed);
});
