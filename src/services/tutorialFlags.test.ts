import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

class MemoryStorage {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
const storage = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;

const mp = await import("./multiplayerTutorialStore");
const modeIntro = await import("./modeIntroStore");

beforeEach(() => storage.clear());

// Each mode teaches itself once. The whole point of separate flags is that
// finishing one tour never silently consumes another.

test("a brand new player is owed every first-run explanation", () => {
  assert.equal(modeIntro.shouldShowModeIntro(), true);
  assert.equal(mp.shouldShowHostTutorial(), true);
  assert.equal(mp.shouldShowGuestTutorial(), true);
  assert.equal(mp.shouldShowPassPlayTutorial(), true);
  assert.equal(mp.shouldShowRoundCoach(), true);
  assert.equal(mp.shouldShowPassPlayRoundCoach(), true);
  assert.equal(mp.shouldShowSocialRankIntro(), true);
});

test("a Multiplayer veteran still gets the 2 Players tutorial", () => {
  mp.markHostTutorialShown();
  mp.markGuestTutorialShown();
  mp.markRoundCoachShown();
  assert.equal(mp.shouldShowPassPlayTutorial(), true, "a different game deserves its own explanation");
  assert.equal(mp.shouldShowPassPlayRoundCoach(), true, "and its own in-round hints");
});

test("a 2 Players veteran still gets both Multiplayer tutorials", () => {
  mp.markPassPlayTutorialShown();
  mp.markPassPlayRoundCoachShown();
  assert.equal(mp.shouldShowHostTutorial(), true);
  assert.equal(mp.shouldShowGuestTutorial(), true);
  assert.equal(mp.shouldShowRoundCoach(), true);
});

test("hosting once does not consume the guest explanation, or the other way round", () => {
  mp.markHostTutorialShown();
  assert.equal(mp.shouldShowGuestTutorial(), true, "a guest has different controls and needs telling");
  storage.clear();
  mp.markGuestTutorialShown();
  assert.equal(mp.shouldShowHostTutorial(), true, "and hosting is the half they have never seen");
});

test("the mode intro is independent of every in-game tutorial", () => {
  modeIntro.markModeIntroShown();
  assert.equal(modeIntro.shouldShowModeIntro(), false);
  assert.equal(mp.shouldShowPassPlayTutorial(), true);
  assert.equal(mp.shouldShowHostTutorial(), true);
});

test("each flag is a separate key, so none of them can clear another", () => {
  modeIntro.markModeIntroShown();
  mp.markHostTutorialShown();
  mp.markGuestTutorialShown();
  mp.markPassPlayTutorialShown();
  mp.markRoundCoachShown();
  mp.markPassPlayRoundCoachShown();
  mp.markSocialRankIntroShown();
  assert.equal(new Set(storage.map.keys()).size, 7, `expected 7 distinct keys, got ${[...storage.map.keys()].join(", ")}`);
});

test("every tutorial shows once and then stays quiet", () => {
  mp.markPassPlayTutorialShown();
  assert.equal(mp.shouldShowPassPlayTutorial(), false);
  assert.equal(mp.shouldShowPassPlayTutorial(), false, "asking twice must not re-arm it");
  mp.markPassPlayRoundCoachShown();
  assert.equal(mp.shouldShowPassPlayRoundCoach(), false);
});

// ------------------------------------------------------------------ replay ---

test("Start Tutorial re-arms every first-run explanation, not just the Classic one", () => {
  modeIntro.markModeIntroShown();
  mp.markHostTutorialShown();
  mp.markGuestTutorialShown();
  mp.markPassPlayTutorialShown();
  mp.markRoundCoachShown();
  mp.markPassPlayRoundCoachShown();
  mp.markSocialRankIntroShown();

  // Exactly what App's handleStartTutorialFromInstructions calls.
  modeIntro.resetModeIntro();
  mp.resetMultiplayerTutorials();

  assert.equal(modeIntro.shouldShowModeIntro(), true);
  assert.equal(mp.shouldShowHostTutorial(), true);
  assert.equal(mp.shouldShowGuestTutorial(), true);
  assert.equal(mp.shouldShowPassPlayTutorial(), true);
  assert.equal(mp.shouldShowRoundCoach(), true);
  assert.equal(mp.shouldShowPassPlayRoundCoach(), true);
  assert.equal(mp.shouldShowSocialRankIntro(), true);
});

// ------------------------------------------------------- social rank intro ---

test("the Social Rank explanation waits for a real payout", () => {
  // The flag alone is not enough: the card only offers the line when points
  // were actually awarded, which is what keeps it out of a pre-game screen and
  // off a revisited match.
  assert.equal(mp.shouldShowSocialRankIntro(), true, "owed");
  mp.markSocialRankIntroShown();
  assert.equal(mp.shouldShowSocialRankIntro(), false, "and never a second time");
});
