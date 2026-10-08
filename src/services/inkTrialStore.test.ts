// Rewarded Ink Trial (0.58.0) - the device state: grant, the per-surface session pin, idempotent consumption, the
// lifecycle rows (at most 5 per Trial, each exactly once), ownership winning, the overlay, the post-session pending
// offer and the persisted Classic rotation pointer.

import { strict as assert } from "node:assert";
import { beforeEach, test } from "node:test";
import { _resetInkTrialConfigForTests } from "./ads/inkTrialConfig";
import {
  POST_SESSION_PENDING_TTL_MS,
  _resetInkTrialStoreForTests,
  advanceClassicRotation,
  clearPostSessionPending,
  closeInkTrialOnPurchase,
  consumeInkTrialUse,
  getActiveInkTrial,
  getInkTrialHistory,
  grantInkTrialExtension,
  isInkExtensionAvailable,
  isInkTrialExtended,
  getNextEligibleInk,
  getPendingCtaInk,
  grantInkTrial,
  hasPostSessionPending,
  markInkCtaShown,
  markInkTrialStarted,
  peekClassicRotationSlot,
  recordInkCtaOutcome,
  resolveEffectiveInk,
  setInkTrialOverlay,
  setPostSessionPending,
  subscribeInkTrial,
  type InkTrialStorage,
} from "./inkTrialStore";
import { validateEventParams } from "./analyticsSchema";
import type { InkTrialInk, InkTrialStage } from "./analyticsSchema";
import type { InkSurface } from "./ads/inkTrialConfigSchema";

type Row = { stage: InkTrialStage; ink: InkTrialInk; surface: InkSurface; ext?: true };
let rows: Row[];
let owned: Set<string>;
let clock: number;
let raw: string | null;
const storage: InkTrialStorage = { get: () => raw, set: (v) => (raw = v) };

beforeEach(() => {
  rows = [];
  owned = new Set();
  clock = 1_000_000;
  raw = null;
  _resetInkTrialConfigForTests({ config: null });
  _resetInkTrialStoreForTests({
    storage,
    isOwned: (ink) => owned.has(ink),
    track: (stage, ink, surface, extra) => rows.push({ stage, ink, surface, ...(extra?.inkExtension ? { ext: true as const } : {}) }),
    now: () => clock,
  });
});

test("grant: 5 plays, auto-equipped as an overlay, one `granted` row; refused when not eligible", () => {
  assert.equal(grantInkTrial("rainbow", "classic"), true);
  assert.deepEqual(getActiveInkTrial(), { ink: "rainbow", usesLeft: 5 });
  assert.deepEqual(resolveEffectiveInk("classic", "black"), { color: "rainbow", trialInk: "rainbow" });
  assert.deepEqual(rows, [{ stage: "granted", ink: "rainbow", surface: "classic" }]);
  assert.equal(grantInkTrial("rainbow", "classic"), false, "never twice");
  assert.equal(grantInkTrial("diamondBlue", "classic"), false, "no conflicting Trial while Rainbow is active");
});

test("the overlay never writes permanent state: the permanent selection is returned untouched when it is off", () => {
  grantInkTrial("rainbow", "classic");
  setInkTrialOverlay(false);
  assert.deepEqual(resolveEffectiveInk("classic", "purple"), { color: "purple", trialInk: null });
  setInkTrialOverlay(true);
  assert.deepEqual(resolveEffectiveInk("classic", "purple"), { color: "rainbow", trialInk: "rainbow" });
});

test("started: once per Trial, on the first play that draws with it (or on its first consumed play)", () => {
  grantInkTrial("rainbow", "classic");
  markInkTrialStarted("rainbow", "classic");
  markInkTrialStarted("rainbow", "playTogether");
  assert.deepEqual(rows.map((r) => r.stage), ["granted", "started"]);

  // A Trial that was switched to mid-play: its first consumption is its start.
  rows = [];
  raw = null;
  _resetInkTrialStoreForTests({ storage, isOwned: (ink) => owned.has(ink), track: (stage, ink, surface) => rows.push({ stage, ink, surface }) });
  grantInkTrial("rainbow", "classic");
  consumeInkTrialUse("rainbow", "k1", "classic");
  assert.deepEqual(rows.map((r) => r.stage), ["granted", "started"]);
});

test("consumption: idempotent per key; 5 uses then `completed` once, the overlay ends and the CTA is owed", () => {
  grantInkTrial("rainbow", "classic");
  assert.equal(consumeInkTrialUse("rainbow", "mp:ROOM:1", "playTogether").consumed, true);
  assert.equal(consumeInkTrialUse("rainbow", "mp:ROOM:1", "playTogether").consumed, false, "a repeated final snapshot consumes nothing");
  for (const key of ["a", "b", "c"]) consumeInkTrialUse("rainbow", key, "classic");
  assert.deepEqual(getActiveInkTrial(), { ink: "rainbow", usesLeft: 1 });
  const last = consumeInkTrialUse("rainbow", "d", "twoPlayers");
  assert.deepEqual(last, { consumed: true, usesLeft: 0, exhausted: true });
  assert.equal(getActiveInkTrial(), null);
  assert.deepEqual(resolveEffectiveInk("classic", "black"), { color: "black", trialInk: null }, "the temporary appearance ends");
  assert.equal(getPendingCtaInk(), "rainbow");
  assert.equal(consumeInkTrialUse("rainbow", "e", "classic").consumed, false, "nothing after the end");
  assert.deepEqual(rows.map((r) => r.stage), ["granted", "started", "completed"]);
  assert.equal(rows[2].surface, "twoPlayers", "completed is reported where the last play happened");
});

test("after exhaustion the next ink (Diamond Blue) is evaluated; Rainbow is never offered again", () => {
  grantInkTrial("rainbow", "classic");
  for (const key of ["1", "2", "3", "4", "5"]) consumeInkTrialUse("rainbow", key, "classic");
  assert.equal(getNextEligibleInk(), "diamondBlue");
  assert.equal(grantInkTrial("rainbow", "classic"), false);
});

test("CTA: shown once, one outcome; at most 5 lifecycle rows per Trial, all valid by the shared schema", () => {
  grantInkTrial("rainbow", "playTogether");
  for (const key of ["1", "2", "3", "4", "5"]) consumeInkTrialUse("rainbow", key, "playTogether");
  markInkCtaShown("rainbow", "playTogether");
  markInkCtaShown("rainbow", "classic");
  recordInkCtaOutcome("rainbow", "declined", "playTogether");
  recordInkCtaOutcome("rainbow", "dismissed", "playTogether");
  assert.deepEqual(rows.map((r) => r.stage), ["granted", "started", "completed", "cta_shown", "cta_declined"]);
  assert.equal(getPendingCtaInk(), null);
  for (const r of rows) assert.equal(validateEventParams("ink_trial", { inkStage: r.stage, ink: r.ink, inkSurface: r.surface }).valid, true);
});

test("ownership wins at once: a purchase closes the Trial, nothing more is consumed, the permanent ink is used", () => {
  grantInkTrial("rainbow", "classic");
  consumeInkTrialUse("rainbow", "1", "classic");
  owned.add("rainbow");
  assert.equal(getActiveInkTrial(), null, "owning it ends the Trial even before the store is told");
  closeInkTrialOnPurchase("rainbow");
  assert.equal(consumeInkTrialUse("rainbow", "2", "classic").consumed, false);
  assert.equal(getPendingCtaInk(), null, "no CTA for an ink you own");
  assert.equal(getNextEligibleInk(), "diamondBlue");
});

test("Trial history for the purchase row: none -> active (also paused) -> ended; a closed Trial reads as ended", () => {
  assert.equal(getInkTrialHistory("rainbow"), "none");
  grantInkTrial("rainbow", "classic");
  assert.equal(getInkTrialHistory("rainbow"), "active");
  setInkTrialOverlay(false);
  assert.equal(getInkTrialHistory("rainbow"), "active", "a paused Trial is still running");
  setInkTrialOverlay(true);
  for (let i = 1; i <= 5; i++) consumeInkTrialUse("rainbow", `k${i}`, "classic");
  assert.equal(getInkTrialHistory("rainbow"), "ended");
  assert.equal(getInkTrialHistory("diamondBlue"), "none");
  grantInkTrial("diamondBlue", "twoPlayers");
  closeInkTrialOnPurchase("diamondBlue");
  assert.equal(getInkTrialHistory("diamondBlue"), "ended");
});

test("Daily: an active Trial applies only while the remote config enables the Daily surface (OFF by default)", () => {
  grantInkTrial("rainbow", "classic");
  assert.deepEqual(resolveEffectiveInk("daily", "black"), { color: "black", trialInk: null });
  _resetInkTrialConfigForTests({
    config: { enabled: true, version: 1, rolloutPercent: 100, surfaces: { classic: true, playTogether: true, twoPlayers: true, daily: true }, classicRotation: ["coin", "ink"] },
  });
  assert.deepEqual(resolveEffectiveInk("daily", "black"), { color: "rainbow", trialInk: "rainbow" });
});

test("D8: with the config absent a granted Trial keeps working on Classic, Play Together and 2 Players", () => {
  grantInkTrial("rainbow", "classic");
  _resetInkTrialConfigForTests({ config: null });
  for (const surface of ["classic", "playTogether", "twoPlayers"] as const) {
    assert.deepEqual(resolveEffectiveInk(surface, "black"), { color: "rainbow", trialInk: "rainbow" });
  }
});

test("post-session pending: set by a completed session, one per rematch chain, cleared on render, expires after 2 h", () => {
  assert.equal(hasPostSessionPending("playTogether"), false);
  setPostSessionPending("playTogether");
  setPostSessionPending("playTogether");
  assert.equal(hasPostSessionPending("playTogether"), true);
  assert.equal(hasPostSessionPending("twoPlayers"), false, "surfaces are separate");
  clearPostSessionPending("playTogether");
  assert.equal(hasPostSessionPending("playTogether"), false);
  setPostSessionPending("twoPlayers");
  clock += POST_SESSION_PENDING_TTL_MS;
  assert.equal(hasPostSessionPending("twoPlayers"), false);
});

test("the Classic rotation pointer persists across runs (a reload keeps the coin/ink alternation)", () => {
  const pattern = ["coin", "ink"] as const;
  assert.equal(peekClassicRotationSlot(pattern), "coin");
  advanceClassicRotation(pattern);
  assert.equal(peekClassicRotationSlot(pattern), "ink");
  // A new app run reads the same storage.
  _resetInkTrialStoreForTests({ storage, isOwned: () => false });
  assert.equal(peekClassicRotationSlot(pattern), "ink");
});

test("corrupt storage is a fresh state, never a crash; listeners hear every write", () => {
  raw = "{not json";
  assert.equal(getNextEligibleInk(), "rainbow");
  let heard = 0;
  const off = subscribeInkTrial(() => heard++);
  grantInkTrial("rainbow", "classic");
  off();
  grantInkTrial("diamondBlue", "classic");
  assert.equal(heard, 1);
});

test("a Play Together pin survives a remount: the session that started with the Trial ink is found by its key", async () => {
  const { pinInkTrialSession, getPinnedInkTrialSession } = await import("./inkTrialStore");
  grantInkTrial("rainbow", "playTogether");
  pinInkTrialSession("ROOM:3", "rainbow");
  pinInkTrialSession("ROOM:3", "rainbow");
  _resetInkTrialStoreForTests({ storage, isOwned: (ink) => owned.has(ink) });
  assert.equal(getPinnedInkTrialSession("ROOM:3"), "rainbow");
  assert.equal(getPinnedInkTrialSession("ROOM:4"), null);
  for (let i = 0; i < 15; i++) pinInkTrialSession(`R:${i}`, "rainbow");
  assert.equal(getPinnedInkTrialSession("ROOM:3"), null, "bounded: only the newest pins are kept");
});

test("cta_shown carries deferredInterstitial (false by default, e.g. Play Together / 2 Players)", async () => {
  const extras: unknown[] = [];
  _resetInkTrialStoreForTests({ storage, isOwned: () => false, track: (_s, _i, _u, extra) => extras.push(extra) });
  grantInkTrial("rainbow", "classic");
  for (const key of ["1", "2", "3", "4", "5"]) consumeInkTrialUse("rainbow", key, "classic");
  markInkCtaShown("rainbow", "classic", true);
  assert.deepEqual(extras.at(-1), { deferredInterstitial: true });
});

// --- 0.58.0: the one-time +5 extension -------------------------------------------------------------------------

/** Grant Rainbow and use `n` plays on `surface` (one key per play/session). */
function playRainbow(n: number, surface: InkSurface = "classic", prefix = "p") {
  for (let i = 1; i <= n; i++) consumeInkTrialUse("rainbow", `${prefix}${i}`, surface);
}

test("extension: offered exactly once - on the FIRST Keep-it card - and grants exactly 5 more plays", () => {
  grantInkTrial("rainbow", "classic");
  assert.equal(isInkExtensionAvailable("rainbow"), false, "not while the first 5 are running");
  playRainbow(5);
  assert.equal(getPendingCtaInk(), "rainbow", "first exhaustion owes the Keep-it card (it owns the Result)");
  assert.equal(isInkExtensionAvailable("rainbow"), true);
  markInkCtaShown("rainbow", "classic");
  assert.equal(grantInkTrialExtension("rainbow", "classic"), true);
  assert.deepEqual(getActiveInkTrial(), { ink: "rainbow", usesLeft: 5 });
  assert.equal(isInkTrialExtended("rainbow"), true);
  assert.equal(grantInkTrialExtension("rainbow", "classic"), false, "never twice");
  assert.deepEqual(resolveEffectiveInk("classic", "black"), { color: "rainbow", trialInk: "rainbow" }, "re-equipped");
});

test("extension: its own lifecycle rows (inkExtension), then a FINAL card with no further extension - 10 plays max", () => {
  grantInkTrial("rainbow", "playTogether");
  playRainbow(5, "playTogether");
  markInkCtaShown("rainbow", "playTogether");
  grantInkTrialExtension("rainbow", "playTogether");
  playRainbow(5, "playTogether", "x");
  assert.equal(getActiveInkTrial(), null);
  assert.equal(getPendingCtaInk(), "rainbow", "final exhaustion owes the final card (it owns the Result too)");
  assert.equal(isInkExtensionAvailable("rainbow"), false, "no second extension after 10 plays");
  markInkCtaShown("rainbow", "playTogether");
  assert.equal(grantInkTrialExtension("rainbow", "playTogether"), false);
  recordInkCtaOutcome("rainbow", "declined", "playTogether");
  assert.deepEqual(
    rows.map((r) => `${r.stage}${r.ext ? "+ext" : ""}`),
    ["granted", "started", "completed", "cta_shown", "granted+ext", "started+ext", "completed+ext", "cta_shown+ext", "cta_declined+ext"],
    "the first card's outcome IS the extension grant (no cta_* row for it); at most 10 rows per Trial",
  );
  assert.equal(consumeInkTrialUse("rainbow", "y1", "playTogether").consumed, false, "nothing left to consume");
  for (const r of rows) {
    const params = { inkStage: r.stage, ink: r.ink, inkSurface: r.surface, ...(r.ext ? { inkExtension: true } : {}) };
    assert.equal(validateEventParams("ink_trial", params).valid, true, JSON.stringify(params));
  }
});

test("extension: gone once the first card is answered without it (NOT NOW, VIEW IN SHOP, leaving)", () => {
  for (const outcome of ["declined", "shop", "dismissed"] as const) {
    _resetInkTrialStoreForTests({ storage: { get: () => null, set: () => {} }, isOwned: () => false, track: () => {} });
    grantInkTrial("rainbow", "classic");
    playRainbow(5);
    markInkCtaShown("rainbow", "classic");
    recordInkCtaOutcome("rainbow", outcome, "classic");
    assert.equal(isInkExtensionAvailable("rainbow"), false, outcome);
    assert.equal(grantInkTrialExtension("rainbow", "classic"), false, outcome);
  }
});

test("extension: VIEW IN SHOP is its own outcome row (cta_shop)", () => {
  grantInkTrial("rainbow", "classic");
  playRainbow(5);
  markInkCtaShown("rainbow", "classic");
  recordInkCtaOutcome("rainbow", "shop", "classic");
  assert.equal(rows.at(-1)?.stage, "cta_shop");
});

test("extension: survives a restart mid-extension; a record stored before the extension existed reads as never extended", () => {
  grantInkTrial("rainbow", "classic");
  playRainbow(5);
  markInkCtaShown("rainbow", "classic");
  grantInkTrialExtension("rainbow", "classic");
  playRainbow(2, "classic", "x");
  const saved = raw;
  _resetInkTrialStoreForTests({ storage: { get: () => saved, set: (v) => (raw = v) }, isOwned: () => false, track: () => {} });
  assert.deepEqual(getActiveInkTrial(), { ink: "rainbow", usesLeft: 3 });
  assert.equal(isInkTrialExtended("rainbow"), true);
  const legacy = JSON.stringify({ v: 1, trials: { rainbow: { status: "exhausted", usesLeft: 0, started: true, ctaShown: false, ctaOutcome: null } } });
  _resetInkTrialStoreForTests({ storage: { get: () => legacy, set: () => {} }, isOwned: () => false, track: () => {} });
  assert.equal(isInkTrialExtended("rainbow"), false);
  assert.equal(isInkExtensionAvailable("rainbow"), true, "an old exhausted Trial's first card can still offer it");
});

test("extension: one use per completed multiplayer session (any round count, a repeated snapshot uses nothing)", () => {
  grantInkTrial("rainbow", "twoPlayers");
  playRainbow(5, "twoPlayers");
  markInkCtaShown("rainbow", "twoPlayers");
  grantInkTrialExtension("rainbow", "twoPlayers");
  assert.equal(consumeInkTrialUse("rainbow", "pp:game-1", "twoPlayers").usesLeft, 4);
  assert.equal(consumeInkTrialUse("rainbow", "pp:game-1", "twoPlayers").consumed, false, "same session key: no second use");
  assert.equal(consumeInkTrialUse("rainbow", "pp:game-2", "twoPlayers").usesLeft, 3);
});

test("extension: a purchase during the extension closes the Trial (bought while active -> history active)", () => {
  grantInkTrial("rainbow", "classic");
  playRainbow(5);
  markInkCtaShown("rainbow", "classic");
  grantInkTrialExtension("rainbow", "classic");
  assert.equal(getInkTrialHistory("rainbow"), "active");
  owned.add("rainbow");
  closeInkTrialOnPurchase("rainbow");
  assert.equal(getActiveInkTrial(), null);
  assert.equal(getPendingCtaInk(), null, "no card for an ink you own");
  assert.equal(grantInkTrialExtension("rainbow", "classic"), false);
});

test("extension: the first card's state between the two phases reads as ended for the purchase row; the final one too", () => {
  grantInkTrial("rainbow", "classic");
  playRainbow(5);
  assert.equal(getInkTrialHistory("rainbow"), "ended", "first 5 used, extension not taken (yet)");
  markInkCtaShown("rainbow", "classic");
  grantInkTrialExtension("rainbow", "classic");
  playRainbow(5, "classic", "x");
  assert.equal(getInkTrialHistory("rainbow"), "ended", "all 10 used");
});
