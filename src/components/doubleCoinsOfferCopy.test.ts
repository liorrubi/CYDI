// 0.57.0: the Classic coin offer names concrete amounts (KEEP N / WATCH AD FOR M) on Android and web,
// with no multiplier wording anywhere in that flow, and a dismissed ad is a skip rather than a failure.
// This runner has no DOM, so these are source-level guards on DoubleCoinsOffer.tsx plus the pure math.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./DoubleCoinsOffer.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
// Strip comments so the guards read only what ships.
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the explicit-amount button labels are exactly KEEP N and WATCH AD FOR M, in the shipped casing", () => {
  assert.ok(code.includes("`WATCH AD FOR ${adFinalAmount} 🪙`"), "watch label");
  assert.ok(code.includes("`KEEP ${amount} 🪙`"), "keep label");
  assert.equal(/\bTOTAL\b/i.test(code), false, "no 'total' wording");
});

test("no 3x / triple / tripled wording remains in the offer flow", () => {
  assert.equal(/3×|×3|tripl/i.test(code), false, "no multiplier wording in the offer's copy");
  assert.equal(/plus100|PLUS_BONUS_COINS/.test(code), false, "no +100 copy");
});

test("the explicit-amount copy applies to the Classic offer on web too (not gated on the Android nudges)", () => {
  assert.ok(code.includes("const isExplicitAmountOffer = experiment !== undefined || isBonusRound;"));
  assert.ok(code.includes("(nudgesEnabled || isExplicitAmountOffer) && canAttemptDouble"), "headline");
  assert.ok(code.includes('isExplicitAmountOffer ? `KEEP ${amount} 🪙` : nudgesEnabled ?'), "keep label is platform-independent for the Classic offer");
  // Other placements keep their long-standing x2 copy.
  assert.ok(code.includes('"🎬 Watch Ad to Double"'));
  assert.ok(code.includes('"Tip: one short ad doubles your coins."'));
});

test("a dismissed ad is handled as a skip before the failure branch: no failed event, no notice", () => {
  const dismissed = code.indexOf("else if (outcome.dismissed)");
  const failed = code.indexOf('recordOutcome("failed")');
  assert.ok(dismissed > 0 && failed > dismissed, "dismissed branch precedes the failure branch");
  const branch = code.slice(dismissed, failed);
  assert.ok(branch.includes("adDismissedRef.current = true"));
  assert.ok(branch.includes('recordOutcome("skipped")'));
  assert.equal(/ad_failed|setAdUnavailableNotice/.test(branch), false);
  // The skip event carries the stage, set only around the emit.
  assert.ok(code.includes('skipStageRef.current = adDismissedRef.current ? "ad" : "offer";'));
  assert.equal((code.match(/trackEvent\(isBonusRound \? "reward_bonus_skipped" : "reward_skipped"/g) ?? []).length, 1, "one skip emit site, shared by Keep and the exit reporter");
});

test("the amounts add up: base 35 is credited, the ad grants only the difference, M = base x 3", async () => {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  const { rewardedFinalAmount, rewardedBonusCoins } = await import("../app/rewardedOfferCadence.ts");
  assert.equal(rewardedFinalAmount("x3", 35), 105);
  // ShapeChallengeScreen.handleDoubleOfferResolved credits finalAmount - base.
  assert.equal(rewardedFinalAmount("x3", 35) - 35, 70);
  assert.equal(rewardedBonusCoins("x3", 35), 70);
});
