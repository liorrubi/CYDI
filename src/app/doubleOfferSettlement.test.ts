// An earned ×2/×3 bonus is settled exactly once however the player leaves the result
// screen, and a genuinely unearned offer still ends as a skip. Stage-0 regression
// (vc47): Next Shape after a completed rewarded ad lost the +140 and logged reward_skipped.
import test from "node:test";
import assert from "node:assert/strict";

const { createOfferSettlement, offerExitAction } = await import("./doubleOfferSettlement.ts");

/** Models ShapePlay: the base is already credited; onResolved adds only the extra. */
function screen(base: number, wasBonusRound = true) {
  const credits: number[] = [];
  const bonusCalls: { granted: boolean }[] = [];
  let offerOpen = true;
  let earnedFinalize: (() => void) | null = null;
  let skips = 0;
  const settlement = createOfferSettlement(wasBonusRound, {
    resolveBonusRewardRound: (o) => bonusCalls.push({ granted: o.granted }),
    onResolved: (finalAmount) => {
      if (offerOpen && finalAmount > base) credits.push(finalAmount - base);
      offerOpen = false;
      earnedFinalize = null;
    },
  });
  return {
    credits,
    bonusCalls,
    skips: () => skips,
    /** DoubleCoinsOffer's reward-earned branch (bonus round: 3x). */
    rewardEarned: () => {
      earnedFinalize = () => settlement.settle({ granted: true, finalAmount: base * 3 }, null);
    },
    /** The offer's own Continue button. */
    continueButton: () => settlement.settle({ granted: true, finalAmount: base * 3 }, null),
    /** Next Shape / Try Again / Back to Map -> forfeitDoubleOffer(). */
    exit: () => {
      const action = offerExitAction(offerOpen, earnedFinalize);
      if (action === "finalize") {
        const f = earnedFinalize!;
        earnedFinalize = null;
        f();
      } else if (action === "skip") {
        skips++;
        offerOpen = false;
      }
      return action;
    },
  };
}

test("an earned bonus is credited when the player leaves via Next Shape / Try Again / Back to Map", () => {
  for (let i = 0; i < 3; i++) {
    const s = screen(70);
    s.rewardEarned();
    assert.equal(s.exit(), "finalize");
    assert.deepEqual(s.credits, [140], "70 base + 140 extra = the 210 the offer promised");
    assert.equal(s.skips(), 0, "an earned reward is never a reward_skipped");
    assert.deepEqual(s.bonusCalls, [{ granted: true }], "the bonus round is settled as granted, like Continue");
  }
});

test("no double credit: Continue then exit, exit then Continue, or exit twice", () => {
  const a = screen(70);
  a.rewardEarned();
  a.continueButton();
  assert.equal(a.exit(), "none");
  assert.deepEqual(a.credits, [140]);

  const b = screen(70);
  b.rewardEarned();
  b.exit();
  assert.equal(b.continueButton(), false, "the settlement is once-only");
  assert.deepEqual(b.credits, [140]);
  assert.equal(b.bonusCalls.length, 1);

  const c = screen(70);
  c.rewardEarned();
  c.exit();
  c.exit();
  assert.deepEqual(c.credits, [140]);
});

test("an offer that was NOT earned still ends as a skip, and credits nothing extra", () => {
  const s = screen(70);
  assert.equal(s.exit(), "skip");
  assert.equal(s.skips(), 1);
  assert.deepEqual(s.credits, []);
  assert.deepEqual(s.bonusCalls, []);
  assert.equal(s.exit(), "none", "skipped once only");
});

test("offerExitAction: no offer open means nothing happens", () => {
  assert.equal(offerExitAction(false, null), "none");
  assert.equal(offerExitAction(false, () => {}), "none");
  assert.equal(offerExitAction(true, null), "skip");
  assert.equal(offerExitAction(true, () => {}), "finalize");
});
