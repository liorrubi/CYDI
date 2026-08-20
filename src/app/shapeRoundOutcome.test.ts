// What a finished Shape Challenge round is allowed to change - and, for the SEO
// landing pages' practice round, the guarantee that it changes nothing.
//
// A practice round is the only way to reach a shape (or a whole paid category)
// the player has not unlocked, so anything it persisted would be an exploit:
// free progression, free coins, or - subtlest of all - a best score that quietly
// consumes the reward the player should still earn later by legitimate play.
// These tests run the REAL stores against an in-memory localStorage, so they
// prove the persisted save, not just the returned value.

import test from "node:test";
import assert from "node:assert/strict";
// Type-only, so it is erased and cannot load the module before the stubs below.
import type { ShapeRoundInput } from "./shapeRoundOutcome.ts";

// saveStore persists to localStorage and announces changes on `window`; neither
// exists under plain node. Minimal in-memory stand-ins installed before the
// modules load, so the real store logic (and its persistence) runs unmodified.
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};
(globalThis as Record<string, unknown>).window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
};

const { applyShapeRoundOutcome, resolveShapeRound, roundCompletedEvent, roundGameType } = await import(
  "./shapeRoundOutcome.ts"
);
const { validateEventParams } = await import("../services/analyticsSchema.ts");
const { getSaveData, updateSaveData } = await import("../services/saveStore.ts");
const { getProgress, isShapeCompleted } = await import("../services/shapeChallengeProgress.ts");
const { getCoins } = await import("../services/coinsStore.ts");
const { getSuccessfulDrawingsCount } = await import("../services/successfulDrawingsStore.ts");
const { unlockCategory, isCategoryUnlocked } = await import("../services/categoryUnlockStore.ts");

/** The Heart is the first shape of Symbols - a category that has to be bought with coins. */
const HEART: Omit<ShapeRoundInput, "progress" | "score" | "practice"> = {
  category: "symbols",
  shapeId: "sym-heart",
  levelIndex: 0,
  frontierIndex: 0,
  passScore: 70,
};

function round(score: number, practice: boolean, overrides: Partial<ShapeRoundInput> = {}) {
  return resolveShapeRound({ ...HEART, progress: getProgress(), score, practice, ...overrides });
}

/** A brand-new player: nothing played, nothing bought, no coins. */
function resetSave(): void {
  updateSaveData((data) => {
    data.progress.coins = 0;
    data.progress.shapeChallenge = { levelIndexByCategory: {}, completedShapeIdsByCategory: {}, bestScores: {} };
    data.progress.unlockedCategories = [];
    data.progress.achievements = [];
    data.progress.completedRounds = 0;
    data.progress.lastBonusRewardRound = 0;
    data.progress.successfulDrawings = 0;
  });
}

/** The entire persisted save, for byte-exact before/after comparison. */
function snapshot(): string {
  return JSON.stringify(getSaveData());
}

test("a high-scoring Heart practice round persists nothing at all", () => {
  resetSave();
  const before = snapshot();

  const outcome = round(99, true);
  let progressChanges = 0;
  const offerAmount = applyShapeRoundOutcome(outcome, () => progressChanges++);

  // The score itself is real - it is shown to the player exactly like any other.
  assert.equal(outcome.passed, true, "a 99 must still read as a pass on screen");
  // ...but nothing about it is kept, so there is no "new best" to celebrate.
  assert.equal(outcome.isNewBest, false);
  assert.equal(outcome.persist, null, "a practice round must have nothing to persist");

  // Each item the practice round must not touch, named explicitly.
  assert.equal(offerAmount, 0, "coins/rewards: no payout, so no ×2/×3 ad offer either");
  assert.equal(getCoins(), 0, "coins");
  assert.equal(getProgress().bestScores["sym-heart"], undefined, "best score");
  assert.equal(isShapeCompleted(getProgress(), "symbols", "sym-heart"), false, "completed/frontier state");
  assert.equal(isCategoryUnlocked("symbols"), false, "category unlocks");
  assert.equal(getSaveData().progress.completedRounds, 0, "round counter (and with it the ×3 bonus cadence)");
  assert.equal(getSaveData().progress.lastBonusRewardRound, 0, "×3 bonus entitlement");
  assert.equal(getSuccessfulDrawingsCount(), 0, "successful-drawing counter (chest/Special Challenge gates)");
  assert.equal(progressChanges, 0, "achievements: the progress-change hook that banks them never fires");

  // The catch-all: the whole save blob is untouched, so nothing not named above
  // slipped through either.
  assert.equal(snapshot(), before, "the persisted save must be byte-identical");
});

test("ten practice rounds in a row are still worth nothing", () => {
  resetSave();
  const before = snapshot();
  for (let i = 0; i < 10; i++) applyShapeRoundOutcome(round(100, true), () => {});
  assert.equal(snapshot(), before);
});

test("legitimate play after buying Symbols behaves as if the practice round never happened", () => {
  resetSave();
  applyShapeRoundOutcome(round(99, true), () => {});

  // The player later buys the category the honest way and plays the same shape.
  unlockCategory("symbols");
  const outcome = round(99, false);
  let progressChanges = 0;
  const offerAmount = applyShapeRoundOutcome(outcome, () => progressChanges++);

  assert.equal(outcome.persist?.advancesFrontier, true, "the frontier pass must count this time");
  assert.equal(isShapeCompleted(getProgress(), "symbols", "sym-heart"), true, "the shape is now completed");
  assert.equal(getProgress().bestScores["sym-heart"], 99, "the best score is now kept");
  assert.equal(getSaveData().progress.completedRounds, 1, "exactly one counted round - the legitimate one");
  assert.equal(getSuccessfulDrawingsCount(), 1);
  assert.equal(progressChanges, 1, "achievement detection runs for the legitimate round");
  assert.ok(offerAmount > 0 && getCoins() === offerAmount, "and it pays out in full");
});

test("an earlier practice score does not shrink the coins a later legitimate round pays", () => {
  // Baseline: what a first legitimate 99 on the Heart is worth with no history.
  resetSave();
  unlockCategory("symbols");
  const baseline = applyShapeRoundOutcome(round(99, false), () => {});
  assert.ok(baseline > 0, "the baseline reward must be non-zero for this test to mean anything");

  // Same player, same shape, same score - but a 99 practice round came first.
  resetSave();
  applyShapeRoundOutcome(round(99, true), () => {});
  unlockCategory("symbols");
  const afterPractice = applyShapeRoundOutcome(round(99, false), () => {});

  assert.equal(afterPractice, baseline, "the practice round must not have consumed any of the reward");
  assert.equal(getCoins(), baseline);
});

test("for contrast: a SAVED best really does consume that reward - which is why practice must not save one", () => {
  // The exact leak the practice round has to avoid. If a practice 99 were
  // persisted as a best score, the legitimate round above would land here
  // instead: same 5-star drawing, zero coins, because the tier was already paid.
  resetSave();
  unlockCategory("symbols");
  applyShapeRoundOutcome(round(99, false), () => {});
  const coinsAfterFirst = getCoins();

  const replay = applyShapeRoundOutcome(round(99, false), () => {});
  assert.equal(replay, 0, "replaying at the same star tier earns nothing");
  assert.equal(getCoins(), coinsAfterFirst);
});

test("a failed practice round is just as inert as a passing one", () => {
  resetSave();
  const before = snapshot();
  const outcome = round(20, true);
  applyShapeRoundOutcome(outcome, () => {});
  assert.equal(outcome.passed, false);
  assert.equal(outcome.persist, null);
  assert.equal(snapshot(), before);
});

test("a practice round on an already-cleared shape leaves the existing best score alone", () => {
  // The star landing page can be opened by a player who already cleared star-5.
  // A weaker practice attempt must not overwrite - or even re-save - their best.
  resetSave();
  unlockCategory("symbols");
  applyShapeRoundOutcome(round(95, false), () => {});
  const before = snapshot();

  applyShapeRoundOutcome(round(40, true), () => {});
  assert.equal(getProgress().bestScores["sym-heart"], 95);
  assert.equal(snapshot(), before);
});

// --- Analytics: a practice round is reported, but never as normal play. ---

test("a practice round reports its own game type and its own completion event", () => {
  assert.equal(roundGameType(true), "seoPractice");
  assert.equal(roundCompletedEvent(true), "shape_practice_completed");
  // ...and normal play is untouched by the split.
  assert.equal(roundGameType(false), "shapeChallenge");
  assert.equal(roundCompletedEvent(false), "shape_completed");
  // Nothing is suppressed: both kinds of round still emit a full event.
  assert.notEqual(roundGameType(true), roundGameType(false));
  assert.notEqual(roundCompletedEvent(true), roundCompletedEvent(false));
});

test("what the practice round actually sends passes the real analytics validators", () => {
  // Ties the mapping to the shared schema, so a typo in either one cannot ship:
  // the Worker rejects an unknown game type or event name outright.
  for (const practice of [true, false]) {
    const funnelParams = { gameType: roundGameType(practice), category: "symbols", contentKey: "sym-heart" };
    assert.equal(validateEventParams("game_started", funnelParams).valid, true, `game_started practice=${practice}`);
    assert.equal(validateEventParams("game_completed", funnelParams).valid, true, `game_completed practice=${practice}`);
    const result = validateEventParams(roundCompletedEvent(practice), {
      category: "symbols",
      starRating: 5,
      passed: true,
      isNewBest: false,
    });
    assert.equal(result.valid, true, `round result practice=${practice}`);
  }
});
