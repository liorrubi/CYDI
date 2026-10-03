// Rewarded Ads Experiment v1: cadence, collision, back semantics and arm assignment.

import test from "node:test";
import assert from "node:assert/strict";

const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

const {
  assignRewardedArm,
  getRewardedArm,
  getLegacyRewardedAssignment,
  decideResultOffer,
  rewardedFinalAmount,
  rewardedBonusCoins,
  recordRewardedGameCompleted,
  markRewardedOfferShown,
  upcomingOfferContext,
  getRewardedCadenceDebugInfo,
  setRewardedContinuation,
  takeRewardedContinuation,
  _resetRewardedCadenceForTests,
  REWARDED_CADENCE_KEY,
} = await import("./rewardedOfferCadence.ts");

let session = "sess-a";
function reset() {
  store.clear();
  session = "sess-a";
  _resetRewardedCadenceForTests({ sessionId: () => session, installationId: () => "install-1" });
}

/** Plays `n` games, rendering an offer whenever one is due (no collisions). Returns the game numbers that showed an offer. */
function playShowingEveryDueOffer(n: number): number[] {
  const shown: number[] = [];
  for (let game = 1; game <= n; game++) {
    if (recordRewardedGameCompleted()) {
      markRewardedOfferShown();
      shown.push(game);
    }
  }
  return shown;
}

test("first offer after 3 games, then every 5: games 3, 8, 13, 18", () => {
  reset();
  assert.deepEqual(playShowingEveryDueOffer(20), [3, 8, 13, 18]);
});

test("no session cap", () => {
  reset();
  assert.equal(playShowingEveryDueOffer(203).length, 41);
});

test("a due offer that is deferred stays pending and does not restart the counter", () => {
  reset();
  recordRewardedGameCompleted();
  recordRewardedGameCompleted();
  assert.equal(recordRewardedGameCompleted(), true, "due at game 3");
  // Game 3's result is deferred (interstitial due) - nothing is marked shown.
  assert.equal(recordRewardedGameCompleted(), true, "still due at game 4");
  markRewardedOfferShown(); // rendered on game 4
  const info = getRewardedCadenceDebugInfo();
  assert.equal(info.gamesSinceLastOffer, 0);
  assert.equal(info.offersShown, 1);
  // Next offer is 5 games after the one actually shown (game 9), not after game 3.
  const due: boolean[] = [];
  for (let i = 0; i < 5; i++) due.push(recordRewardedGameCompleted());
  assert.deepEqual(due, [false, false, false, false, true]);
});

test("rendering is the exposure: Back after an offer restarts the count, the same offer never re-shows", () => {
  reset();
  playShowingEveryDueOffer(3); // offer shown on game 3, then the player leaves via Back
  assert.equal(getRewardedCadenceDebugInfo().due, false);
  assert.equal(upcomingOfferContext().offerNumber, 2);
});

test("Back before an offer was rendered changes nothing", () => {
  reset();
  for (let i = 0; i < 3; i++) recordRewardedGameCompleted();
  // due, but the player left before any result rendered it - no markRewardedOfferShown()
  const info = getRewardedCadenceDebugInfo();
  assert.equal(info.due, true);
  assert.equal(info.gamesSinceLastOffer, 3);
  assert.equal(info.offersShown, 0);
});

test("a new session restarts from the first-offer threshold of 3", () => {
  reset();
  playShowingEveryDueOffer(6); // offer at 3, then 3 more games
  session = "sess-b";
  assert.equal(getRewardedCadenceDebugInfo().threshold, 3);
  assert.deepEqual(playShowingEveryDueOffer(8), [3, 8]);
});

test("state persists across reloads within one session", () => {
  reset();
  recordRewardedGameCompleted();
  recordRewardedGameCompleted();
  // simulate an app restart in the same analytics session: memory cleared, storage kept
  _resetRewardedCadenceForTests({ sessionId: () => session, installationId: () => "install-1" });
  assert.equal(recordRewardedGameCompleted(), true);
  assert.ok(store.get(REWARDED_CADENCE_KEY));
});

test("offer context reports the offer number in the session and session games", () => {
  reset();
  playShowingEveryDueOffer(8);
  assert.deepEqual(upcomingOfferContext(), { offerNumber: 3, sessionGames: 8 });
});

test("interstitial wins a collision; no coins / no ad keep the offer pending", () => {
  const base = { due: true, interstitialDue: false, coinsEarned: 40, canOfferAd: true };
  assert.equal(decideResultOffer(base), "show");
  assert.equal(decideResultOffer({ ...base, interstitialDue: true }), "pending_interstitial");
  assert.equal(decideResultOffer({ ...base, coinsEarned: 0 }), "pending_no_coins");
  assert.equal(decideResultOffer({ ...base, canOfferAd: false }), "pending_no_ad");
  assert.equal(decideResultOffer({ ...base, due: false }), "not_due");
});

test("the arms differ only in reward value", () => {
  assert.equal(rewardedFinalAmount("x3", 40), 120);
  assert.equal(rewardedBonusCoins("x3", 40), 80);
  assert.equal(rewardedFinalAmount("plus100", 40), 140);
  assert.equal(rewardedBonusCoins("plus100", 40), 100);
});

test("+100 is retired: every installation resolves to x3, whatever the legacy hash would say", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    _resetRewardedCadenceForTests({ sessionId: () => session, installationId: () => `id-${i}` });
    seen.add(getRewardedArm());
  }
  assert.deepEqual([...seen], ["x3"]);
  _resetRewardedCadenceForTests({ sessionId: () => session, installationId: () => null });
  assert.equal(getRewardedArm(), "x3");
  assert.equal(getRewardedCadenceDebugInfo().arm, "x3");
  // Find an installation the legacy hash put in the plus100 arm: it is still x3 now.
  let plusId: string | null = null;
  for (let i = 0; i < 100 && plusId === null; i++) if (assignRewardedArm(`id-${i}`) === "plus100") plusId = `id-${i}`;
  assert.ok(plusId);
  _resetRewardedCadenceForTests({ sessionId: () => session, installationId: () => plusId });
  assert.equal(getLegacyRewardedAssignment(), "plus100", "the legacy assignment function is kept for history");
  assert.equal(getRewardedArm(), "x3", "but nothing live uses it");
  reset();
});

test("the legacy assignment function stays stable per installation and splits roughly 50/50 (history only)", () => {
  assert.equal(assignRewardedArm("abc"), assignRewardedArm("abc"));
  assert.equal(assignRewardedArm(null), "x3");
  let plus = 0;
  for (let i = 0; i < 2000; i++) if (assignRewardedArm(`id-${i}`) === "plus100") plus++;
  assert.ok(plus > 900 && plus < 1100, `plus100 share ${plus}/2000`);
});

test("continuation marker is consumed once and dropped across sessions", () => {
  reset();
  setRewardedContinuation("plus100", 2, "skipped");
  assert.deepEqual(takeRewardedContinuation(), { arm: "plus100", offerNumber: 2, outcome: "skipped" });
  assert.equal(takeRewardedContinuation(), null);
  setRewardedContinuation("x3", 1, "completed");
  session = "sess-c";
  assert.equal(takeRewardedContinuation(), null);
});
