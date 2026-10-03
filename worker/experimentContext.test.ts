// 0.57 telemetry: the multi-cell experiment context (ifxCell / ifxVersion / ifxCap), the next-game
// context on game_completed (nextOutcome + ifxCell), the effective-cadence range (any integer 5..20) and the
// play-segment summary event. What is pinned here: every OLD payload (0.55 / 0.56 clients) stays valid, the new
// optional forms validate only as complete and bounded, nothing identifying can ride along, and each new
// field lands in its documented Analytics Engine slot without moving any other slot.
import test from "node:test";
import assert from "node:assert/strict";

const { validateEventParams, ANALYTICS_EVENT_NAMES, NEXT_GAME_OUTCOMES } = await import("../src/services/analyticsSchema.ts");
const { buildShadowDataPoints, AE_SCHEMA_VERSION } = await import("./analyticsShadow.ts");
const { incrementEvent, MAX_BODY_BYTES } = await import("./analyticsDO.ts");
const { classifyEvent, CLIENT_EXACT_EVENTS } = await import("../src/services/analyticsEventClasses.ts");
const { EXACT_LEDGER_EVENTS } = await import("./analyticsExactLedger.ts");
const { INTERSTITIAL_CELL_IDS } = await import("../src/services/ads/interstitialConfigSchema.ts");

const valid = (name: string, params: unknown) => validateEventParams(name as never, params).valid;
const IFX = { ifxCell: "B", ifxVersion: 3, ifxCap: 2 };
const GAME = { gameType: "shapeChallenge", category: "geometric", contentKey: "circle" };
const COINS = { coinsEarned: 40, balanceBucket: "100_499" };
const PLACEMENT = { placement: "shape_challenge_double_reward" };
const ECON = { balanceBucket: "100_499", baseReward: 40, adAvailable: true, nextTarget: "category", shortfallBucket: "short_50_75", adClosesGap: false, gamesBucket: "10_24" };
const X3 = { ...PLACEMENT, ...ECON, multiplier: 3, arm: "x3", offerNumber: 2, sessionGames: 8, bonusCoins: 80, interstitialArm: "treatment" };

const env = (eventName: string, params: unknown) => ({ eventName, params, platform: "android", appVersion: "0.57.0", appVersionCode: 57, installationId: "inst-SECRET-1234567890", sessionId: "sess-SECRET-1234567890", isInternal: false });
const point = (name: string, params: unknown) => buildShadowDataPoints("/event", JSON.stringify(env(name, params)), "de", () => 0.5)[0];

// --- Task 0: the effective cadence is any integer 5..20 -------------------------------------------------

test("analytics accepts gamesBetweenAds 5..20 on checkpoint and continuation; old values stay valid", () => {
  for (let c = 5; c <= 20; c++) {
    assert.equal(valid("interstitial_checkpoint", { arm: "treatment", outcome: "shown", gamesBetweenAds: c }), true, `checkpoint ${c}`);
    assert.equal(valid("interstitial_continuation", { arm: "control", outcome: "control", gamesBetweenAds: c }), true, `continuation ${c}`);
  }
  for (const c of [5, 7, 10, 12, 15, 20]) assert.equal(valid("interstitial_checkpoint", { arm: "control", outcome: "control", gamesBetweenAds: c }), true);
  for (const bad of [4, 21, 0, -7, 6.5, "6", null, undefined]) {
    assert.equal(valid("interstitial_checkpoint", { arm: "treatment", outcome: "shown", gamesBetweenAds: bad }), false, `checkpoint ${String(bad)}`);
    assert.equal(valid("interstitial_continuation", { arm: "treatment", outcome: "shown", gamesBetweenAds: bad }), false, `continuation ${String(bad)}`);
  }
});

test("the DO per-cadence counter takes 6 and is bounded at the 16 keys 5..20", () => {
  const c = incrementEvent({}, "interstitial_checkpoint", { arm: "treatment", outcome: "shown", gamesBetweenAds: 6 }, "android");
  assert.deepEqual(c.interstitial_checkpoint?.byCadence, { "6": 1 });
  const hostile = incrementEvent({}, "interstitial_checkpoint", { arm: "treatment", outcome: "shown", gamesBetweenAds: 21 }, "android");
  assert.equal(hostile.interstitial_checkpoint?.byCadence, undefined);
});

// --- Task 1: ifx context on the interstitial events ------------------------------------------------------

test("interstitial_checkpoint / _continuation: old key sets valid; ifx* valid only as the complete, bounded trio", () => {
  const base = { arm: "treatment", outcome: "shown", gamesBetweenAds: 6 };
  for (const name of ["interstitial_checkpoint", "interstitial_continuation"]) {
    assert.equal(valid(name, base), true, `${name} old form`);
    assert.equal(valid(name, { ...base, ...IFX }), true, `${name} with ifx`);
    for (const cell of INTERSTITIAL_CELL_IDS) assert.equal(valid(name, { ...base, ...IFX, ifxCell: cell }), true, `${name} cell ${cell}`);
    for (const partial of [{ ifxCell: "B" }, { ifxCell: "B", ifxVersion: 3 }, { ifxVersion: 3, ifxCap: 2 }, { ifxCap: 2 }]) {
      assert.equal(valid(name, { ...base, ...partial }), false, `${name} partial ${JSON.stringify(partial)}`);
    }
    for (const bad of [{ ifxCell: "G" }, { ifxCell: "b" }, { ifxCell: 1 }, { ifxVersion: 0 }, { ifxVersion: 1_000_001 }, { ifxVersion: 1.5 }, { ifxCap: 0 }, { ifxCap: 4 }, { ifxCap: "2" }]) {
      assert.equal(valid(name, { ...base, ...IFX, ...bad }), false, `${name} ${JSON.stringify(bad)}`);
    }
    assert.equal(valid(name, { ...base, ...IFX, installationId: "x" }), false, `${name}: no extra keys`);
    assert.equal(valid(name, { ...base, ...IFX, bucket: 12 }), false, `${name}: no bucket`);
  }
  // The checkpoint's diagnostics and reason still combine with the context.
  assert.equal(valid("interstitial_checkpoint", { arm: "treatment", outcome: "not_ready", gamesBetweenAds: 7, attempt: 2, code: 3, notReadyCause: "failed", ...IFX }), true);
  assert.equal(valid("interstitial_checkpoint", { arm: "treatment", outcome: "show_failed", gamesBetweenAds: 7, reason: "timeout", ...IFX }), true);
  assert.equal(valid("interstitial_checkpoint", { arm: "control", outcome: "control", gamesBetweenAds: 7, attempt: 1 }), false, "control still carries no diagnostics");
});

test("reward offer funnel: ifxCell is an optional addition to the experiment block only", () => {
  for (const ev of ["reward_offer_shown", "reward_ad_started", "reward_ad_completed", "reward_ad_failed", "reward_skipped", "reward_bonus_offer_shown", "reward_bonus_skipped"]) {
    assert.equal(valid(ev, X3), true, `${ev} old experiment block`);
    assert.equal(valid(ev, { ...X3, ifxCell: "C" }), true, `${ev} with ifxCell`);
    assert.equal(valid(ev, { ...X3, ifxCell: "Z" }), false, `${ev} bad cell`);
    assert.equal(valid(ev, { ...X3, ifxCell: "C", ifxVersion: 3 }), false, `${ev}: ifxCell alone, no version`);
    assert.equal(valid(ev, { ...X3, interstitialArm: "none", ifxCell: "C" }), false, `${ev}: a cell needs an interstitial arm`);
  }
  // Not part of the economy-only or placement-only forms.
  const { arm, offerNumber, sessionGames, bonusCoins, interstitialArm, ...economyOnly } = X3;
  void arm; void offerNumber; void sessionGames; void bonusCoins; void interstitialArm;
  assert.equal(valid("reward_offer_shown", { ...economyOnly, multiplier: 2, ifxCell: "C" }), false);
  assert.equal(valid("reward_offer_shown", { ...PLACEMENT, ifxCell: "C" }), false);
  assert.equal(valid("reward_skipped", { ...X3, ifxCell: "C", skipStage: "ad" }), true, "skipStage still combines");
});

// --- Task 2: game_completed next-game context ------------------------------------------------------------

test("game_completed: old forms valid; nextOutcome (+ ifxCell) valid for Classic only; ifxCell alone is not a form", () => {
  assert.equal(valid("game_completed", GAME), true);
  assert.equal(valid("game_completed", { ...GAME, ...COINS }), true);
  for (const outcome of NEXT_GAME_OUTCOMES) {
    assert.equal(valid("game_completed", { ...GAME, nextOutcome: outcome }), true, outcome);
    assert.equal(valid("game_completed", { ...GAME, ...COINS, nextOutcome: outcome, ifxCell: "A" }), true, `${outcome} + coins + cell`);
  }
  assert.deepEqual([...NEXT_GAME_OUTCOMES], ["shown", "not_ready", "show_failed", "suppressed", "control", "control_suppressed"]);
  assert.equal(valid("game_completed", { ...GAME, ifxCell: "A" }), false, "ifxCell needs nextOutcome");
  assert.equal(valid("game_completed", { ...GAME, nextOutcome: "capped" }), false);
  assert.equal(valid("game_completed", { ...GAME, nextOutcome: "shown", ifxCell: "Z" }), false);
  assert.equal(valid("game_completed", { ...GAME, nextOutcome: "shown", ifxVersion: 1 }), false, "no other ifx keys");
  assert.equal(valid("game_completed", { ...GAME, gameType: "dailyChallenge", nextOutcome: "shown" }), false, "Classic only");
  assert.equal(valid("game_completed", { ...GAME, coinsEarned: 40, nextOutcome: "shown" }), false, "the coin block stays all-or-nothing");
  assert.equal(valid("game_completed", { ...GAME, ...COINS, nextOutcome: "shown", extra: 1 }), false);
});

// --- Task 3: session_summary -------------------------------------------------------------------------------

const SUMMARY = { arm: "treatment", classicGames: 9, checkpoints: 2, shown: 1, notReady: 1, secondReached: 1, rewardedShown: 3, rewardedDeferred: 1, cadence: 6, cap: 2 };

test("session_summary: exact keys, bounded, consistent", () => {
  assert.equal(valid("session_summary", SUMMARY), true);
  assert.equal(valid("session_summary", { ...SUMMARY, ifxCell: "C", ifxVersion: 4 }), true);
  assert.equal(valid("session_summary", { ...SUMMARY, arm: "control", shown: 0, notReady: 0 }), true);
  assert.equal(valid("session_summary", { ...SUMMARY, classicGames: 99, checkpoints: 99, shown: 0, notReady: 0, rewardedShown: 99, rewardedDeferred: 99 }), true);
  for (const bad of [
    { classicGames: 0 },
    { classicGames: 100 },
    { checkpoints: -1 },
    { checkpoints: 100 },
    { shown: 2, notReady: 1 }, // 3 > 2 checkpoints
    { arm: "control" }, // control cannot show or be not-ready
    { arm: "none" },
    { secondReached: 2 },
    { secondReached: true },
    { rewardedShown: 100 },
    { rewardedDeferred: 1.5 },
    { cadence: 4 },
    { cadence: 21 },
    { cap: 0 },
    { cap: 4 },
    { ifxCell: "C" }, // cell without version
    { ifxVersion: 4 },
    { ifxCell: "C", ifxVersion: 0 },
    { ifxCell: "Q", ifxVersion: 4 },
    { ifxCell: "C", ifxVersion: 4, ifxCap: 2 }, // the cap already travels as `cap`
    { installationId: "x" },
    { sessionId: "x" },
  ]) {
    assert.equal(valid("session_summary", { ...SUMMARY, ...bad }), false, JSON.stringify(bad));
  }
  const { cap, ...missing } = SUMMARY;
  void cap;
  assert.equal(valid("session_summary", missing), false, "every required key is required");
  assert.equal(valid("session_summary", {}), false);
  assert.equal(valid("session_summary", null), false);
});

test("session_summary is a TELEMETRY event: not exact, not in the ledger list, a known event name", () => {
  assert.equal(ANALYTICS_EVENT_NAMES.includes("session_summary"), true);
  assert.equal(classifyEvent("session_summary"), "telemetry");
  assert.equal(CLIENT_EXACT_EVENTS.has("session_summary"), false);
  assert.equal(EXACT_LEDGER_EVENTS.has("session_summary"), false);
});

test("a worst-case session_summary envelope fits the single-event body cap", () => {
  const worst = { ...SUMMARY, classicGames: 99, checkpoints: 99, shown: 99, notReady: 0, rewardedShown: 99, rewardedDeferred: 99, ifxCell: "F", ifxVersion: 1_000_000 };
  const body = JSON.stringify({ ...env("session_summary", worst), appBuild: "abcdef123456", attribution: undefined });
  assert.ok(body.length < MAX_BODY_BYTES, `${body.length} < ${MAX_BODY_BYTES}`);
  assert.equal(buildShadowDataPoints("/event", body, "US").length, 1);
});

// --- Analytics Engine slots ---------------------------------------------------------------------------------

test("AE: ifx* on interstitial rows land in double10 (cap) / double11 (version) / double12 (cell); old rows keep 0", () => {
  const cp = point("interstitial_checkpoint", { arm: "treatment", outcome: "shown", gamesBetweenAds: 6, attempt: 1, latency: "lt5s", ...IFX });
  assert.equal(cp.doubles[9], 2, "double10 = ifxCap");
  assert.equal(cp.doubles[10], 3, "double11 = ifxVersion");
  assert.equal(cp.doubles[11], 2, "double12 = ifxCell B");
  // Every slot the row already used is unchanged.
  assert.equal(cp.doubles[8], 6, "double9 = effective cadence");
  assert.equal(cp.doubles[2], 1, "double3 = attempt");
  assert.equal(cp.doubles[3], 1, "double4 = latency bucket");
  assert.equal(cp.blobs[17], "treatment");
  assert.equal(cp.blobs[18], "shown");
  assert.equal(cp.doubles[0], AE_SCHEMA_VERSION);
  assert.equal(AE_SCHEMA_VERSION, 3);
  assert.equal(cp.doubles.length, 20);
  assert.equal(cp.blobs.length, 20);
  const cont = point("interstitial_continuation", { arm: "treatment", outcome: "not_ready", gamesBetweenAds: 12, ...IFX, ifxCell: "F" });
  assert.deepEqual([cont.doubles[8], cont.doubles[9], cont.doubles[10], cont.doubles[11]], [12, 2, 3, 6]);
  const old = point("interstitial_checkpoint", { arm: "treatment", outcome: "shown", gamesBetweenAds: 7, attempt: 1 });
  assert.deepEqual([old.doubles[9], old.doubles[10], old.doubles[11]], [0, 0, 0]);
  assert.deepEqual(INTERSTITIAL_CELL_IDS.map((c) => point("interstitial_continuation", { arm: "treatment", outcome: "shown", gamesBetweenAds: 6, ...IFX, ifxCell: c }).doubles[11]), [1, 2, 3, 4, 5, 6]);
});

test("AE: reward offer ifxCell lands in double12; the experiment slots are unchanged", () => {
  const withCell = point("reward_offer_shown", { ...X3, ifxCell: "D" });
  const without = point("reward_offer_shown", X3);
  assert.equal(withCell.doubles[11], 4, "double12 = ifxCell D");
  assert.equal(without.doubles[11], 0);
  for (let i = 0; i < 20; i++) if (i !== 11) assert.equal(withCell.doubles[i], without.doubles[i], `double${i + 1} unchanged`);
  assert.deepEqual(withCell.blobs, without.blobs, "no blob changes");
  assert.equal(withCell.doubles[4], 8, "sessionGames");
  assert.equal(withCell.doubles[5], 2, "offerNumber");
  assert.equal(withCell.doubles[9], 80, "bonusCoins");
  assert.equal(withCell.blobs[18], "treatment", "interstitialArm");
});

test("AE: game_completed nextOutcome lands in blob19 and ifxCell in double12; coins and every other slot are unchanged", () => {
  const plain = point("game_completed", { ...GAME, ...COINS });
  const next = point("game_completed", { ...GAME, ...COINS, nextOutcome: "control_suppressed", ifxCell: "E" });
  assert.equal(next.blobs[18], "control_suppressed", "blob19 = nextOutcome");
  assert.equal(next.doubles[11], 5, "double12 = ifxCell E");
  assert.equal(plain.blobs[18], "");
  assert.equal(plain.doubles[11], 0);
  for (let i = 0; i < 20; i++) if (i !== 11) assert.equal(next.doubles[i], plain.doubles[i], `double${i + 1} unchanged`);
  for (let i = 0; i < 20; i++) if (i !== 18) assert.equal(next.blobs[i], plain.blobs[i], `blob${i + 1} unchanged`);
  assert.equal(next.doubles[17], 40, "double18 = coinsEarned (economy reports unaffected)");
  assert.ok(next.doubles[13] > 0, "double14 = balanceBucket");
  // nextOutcome without a cell (non-participant).
  const control = point("game_completed", { ...GAME, nextOutcome: "control" });
  assert.deepEqual([control.blobs[18], control.doubles[11]], ["control", 0]);
  // Invalid forms never reach AE.
  assert.deepEqual(buildShadowDataPoints("/event", JSON.stringify(env("game_completed", { ...GAME, ifxCell: "E" })), "US"), []);
});

test("AE: session_summary has its own explicit double layout; slots 1 / 13 / 20 and the economy block are unchanged", () => {
  const s = point("session_summary", { ...SUMMARY, ifxCell: "C", ifxVersion: 4 });
  assert.equal(s.blobs[0], "session_summary");
  assert.equal(s.blobs[7], "classic", "mode");
  assert.equal(s.blobs[17], "treatment", "blob18 = arm");
  assert.equal(s.blobs[18], "", "no outcome");
  assert.equal(s.blobs[19], "", "no detail");
  assert.deepEqual(s.doubles.slice(0, 12), [AE_SCHEMA_VERSION, 9, 2, 1, 1, 1, 3, 1, 6, 2, 4, 3]);
  // double2 classicGames, 3 checkpoints, 4 shown, 5 notReady, 6 secondReached, 7 rewardedShown, 8 rewardedDeferred,
  // 9 cadence, 10 cap, 11 ifxVersion, 12 ifxCell.
  assert.equal(s.doubles[12], 1, "double13 = batchSize");
  assert.deepEqual(s.doubles.slice(13, 19), [0, 0, 0, 0, 0, 0], "double14..19 = no economy context");
  assert.equal(s.doubles[19], 1, "double20 = sampleWeight");
  assert.equal(s.doubles.length, 20);
  // Non-participant: the ifx slots are 0.
  const np = point("session_summary", { ...SUMMARY, arm: "control", shown: 0, notReady: 0 });
  assert.deepEqual([np.doubles[10], np.doubles[11], np.blobs[17]], [0, 0, "control"]);
  // No identifier in the row.
  const text = JSON.stringify([s.blobs, s.doubles, s.indexes]);
  assert.equal(text.includes("SECRET"), false);
});
