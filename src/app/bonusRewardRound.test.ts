// The periodic 3× bonus round's contract: WHICH round is a bonus round, and when the
// entitlement is spent. The component decides how it looks; this pins down the rules
// that decide coins, and the one guarantee that matters most - a technical ad failure
// must never cost a player their bonus.

import test from "node:test";
import assert from "node:assert/strict";

// saveStore persists to localStorage and announces changes on `window`; neither exists
// under plain node. Minimal in-memory stand-ins installed before the module loads, so
// the real store logic (and its persistence) runs unmodified.
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

const {
  BONUS_REWARD_ROUND_INTERVAL,
  BONUS_REWARD_MULTIPLIER,
  STANDARD_REWARD_MULTIPLIER,
  BONUS_REWARD_PLACEMENT,
  isBonusRewardRound,
  rewardMultiplier,
  resolveBonusRewardRound,
} = await import("./bonusRewardRound.ts");
const { getSaveData, updateSaveData } = await import("../services/saveStore.ts");
const { recordRoundCompleted } = await import("../services/tutorialStore.ts");

function reset(): void {
  updateSaveData((data) => {
    data.progress.completedRounds = 0;
    data.progress.lastBonusRewardRound = 0;
  });
}

/** The multiplier the offer after the Nth completed round would advertise. */
function multiplierAfterRounds(n: number): number {
  reset();
  for (let i = 0; i < n; i++) recordRoundCompleted();
  return rewardMultiplier(isBonusRewardRound(BONUS_REWARD_PLACEMENT));
}

test("rounds 1-6 keep the standard ×2", () => {
  for (let round = 1; round < BONUS_REWARD_ROUND_INTERVAL; round++) {
    assert.equal(multiplierAfterRounds(round), STANDARD_REWARD_MULTIPLIER, `round ${round}`);
  }
});

test("the 7th round is a ×3 bonus round", () => {
  assert.equal(multiplierAfterRounds(BONUS_REWARD_ROUND_INTERVAL), BONUS_REWARD_MULTIPLIER);
});

test("after a collected bonus the count starts a fresh cycle", () => {
  reset();
  for (let i = 0; i < BONUS_REWARD_ROUND_INTERVAL; i++) recordRoundCompleted();
  assert.equal(isBonusRewardRound(BONUS_REWARD_PLACEMENT), true);
  // Collected via a confirmed ad.
  resolveBonusRewardRound({ wasBonusRound: true, granted: true, forfeitedRealOffer: false });

  // The next six rounds are ordinary again...
  for (let i = 1; i < BONUS_REWARD_ROUND_INTERVAL; i++) {
    recordRoundCompleted();
    assert.equal(rewardMultiplier(isBonusRewardRound(BONUS_REWARD_PLACEMENT)), STANDARD_REWARD_MULTIPLIER, `round ${BONUS_REWARD_ROUND_INTERVAL + i}`);
  }
  // ...and the 14th is the next bonus.
  recordRoundCompleted();
  assert.equal(getSaveData().progress.completedRounds, BONUS_REWARD_ROUND_INTERVAL * 2);
  assert.equal(isBonusRewardRound(BONUS_REWARD_PLACEMENT), true);
});

test("the count survives a restart", () => {
  reset();
  for (let i = 0; i < BONUS_REWARD_ROUND_INTERVAL - 1; i++) recordRoundCompleted();

  // A restart re-reads the same persisted blob - nothing in memory carries over.
  const persisted = store.get("cydi.save.v1");
  assert.ok(persisted, "save was written to localStorage");
  assert.equal(JSON.parse(persisted!).progress.completedRounds, BONUS_REWARD_ROUND_INTERVAL - 1);

  // The round completed after the restart is still the 7th, not the 1st.
  recordRoundCompleted();
  assert.equal(isBonusRewardRound(BONUS_REWARD_PLACEMENT), true);
});

test("a failed or unavailable ad grants nothing and KEEPS the bonus for the next offer", () => {
  reset();
  for (let i = 0; i < BONUS_REWARD_ROUND_INTERVAL; i++) recordRoundCompleted();
  assert.equal(isBonusRewardRound(BONUS_REWARD_PLACEMENT), true);

  // Ad could not be served: nothing granted, and the player did not refuse a real
  // offer - there was none to refuse.
  resolveBonusRewardRound({ wasBonusRound: true, granted: false, forfeitedRealOffer: false });
  assert.equal(getSaveData().progress.lastBonusRewardRound, 0, "the bonus stays due");

  // The very next round is a bonus round again, even though 8 % 7 !== 0.
  recordRoundCompleted();
  assert.equal(getSaveData().progress.completedRounds % BONUS_REWARD_ROUND_INTERVAL, 1);
  assert.equal(isBonusRewardRound(BONUS_REWARD_PLACEMENT), true);
  assert.equal(rewardMultiplier(isBonusRewardRound(BONUS_REWARD_PLACEMENT)), BONUS_REWARD_MULTIPLIER);
});

test("a round that pays no coins shows no offer, and must not swallow the bonus", () => {
  reset();
  // The 7th round completes but earned no coins (a replay at the same star tier), so
  // ShapeChallengeScreen never renders an offer and nothing settles the bonus.
  for (let i = 0; i < BONUS_REWARD_ROUND_INTERVAL; i++) recordRoundCompleted();
  // Round 8 does pay - and is still the bonus offer.
  recordRoundCompleted();
  assert.equal(isBonusRewardRound(BONUS_REWARD_PLACEMENT), true);
});

test("the carried bonus is cleared once it is finally collected", () => {
  reset();
  for (let i = 0; i < BONUS_REWARD_ROUND_INTERVAL; i++) recordRoundCompleted();
  resolveBonusRewardRound({ wasBonusRound: true, granted: false, forfeitedRealOffer: false });
  recordRoundCompleted();
  assert.equal(isBonusRewardRound(BONUS_REWARD_PLACEMENT), true);

  resolveBonusRewardRound({ wasBonusRound: true, granted: true, forfeitedRealOffer: false });
  assert.equal(getSaveData().progress.lastBonusRewardRound, BONUS_REWARD_ROUND_INTERVAL + 1);
  assert.equal(isBonusRewardRound(BONUS_REWARD_PLACEMENT), false);
  // And the next cycle is a full interval from where it was actually settled.
  for (let i = 1; i < BONUS_REWARD_ROUND_INTERVAL; i++) {
    recordRoundCompleted();
    assert.equal(isBonusRewardRound(BONUS_REWARD_PLACEMENT), false, `round ${BONUS_REWARD_ROUND_INTERVAL + 1 + i}`);
  }
  recordRoundCompleted();
  assert.equal(isBonusRewardRound(BONUS_REWARD_PLACEMENT), true);
});

test("deliberately skipping a real 3× offer spends it - that is a choice, not a failure", () => {
  reset();
  for (let i = 0; i < BONUS_REWARD_ROUND_INTERVAL; i++) recordRoundCompleted();
  resolveBonusRewardRound({ wasBonusRound: true, granted: false, forfeitedRealOffer: true });
  assert.equal(getSaveData().progress.lastBonusRewardRound, BONUS_REWARD_ROUND_INTERVAL);

  recordRoundCompleted();
  assert.equal(isBonusRewardRound(BONUS_REWARD_PLACEMENT), false);
});

test("an ordinary round never settles a bonus that is still due", () => {
  reset();
  for (let i = 0; i < BONUS_REWARD_ROUND_INTERVAL; i++) recordRoundCompleted();
  resolveBonusRewardRound({ wasBonusRound: false, granted: true, forfeitedRealOffer: true });
  assert.equal(getSaveData().progress.lastBonusRewardRound, 0, "a non-bonus round must not consume a due bonus");
  assert.equal(isBonusRewardRound(BONUS_REWARD_PLACEMENT), true);
});

test("only the shape-challenge offer can be a bonus round - chest and other rewards are untouched", () => {
  reset();
  for (let i = 0; i < BONUS_REWARD_ROUND_INTERVAL; i++) recordRoundCompleted();
  assert.equal(isBonusRewardRound(BONUS_REWARD_PLACEMENT), true);

  for (const other of ["daily_chest_bonus", "shop_double_reward", "mega_challenge_bonus", "special_challenge_double_reward", "artist_pack_double_reward"] as const) {
    assert.equal(isBonusRewardRound(other), false, other);
    assert.equal(rewardMultiplier(isBonusRewardRound(other)), STANDARD_REWARD_MULTIPLIER, other);
  }
});

test("a save written before this feature existed starts a fresh cycle, not an instant bonus", () => {
  reset();
  // Veteran save: hundreds of rounds already counted, and no marker field at all.
  updateSaveData((data) => {
    data.progress.completedRounds = 412;
    delete (data.progress as Partial<Record<string, unknown>>).lastBonusRewardRound;
  });
  // It reads as due immediately (412 - 0 >= 7) - acceptable and deliberate: one bonus
  // on the next paying round, after which the marker exists and the cycle is normal.
  assert.equal(isBonusRewardRound(BONUS_REWARD_PLACEMENT), true);
  resolveBonusRewardRound({ wasBonusRound: true, granted: true, forfeitedRealOffer: false });
  assert.equal(getSaveData().progress.lastBonusRewardRound, 412);
  assert.equal(isBonusRewardRound(BONUS_REWARD_PLACEMENT), false);
});
