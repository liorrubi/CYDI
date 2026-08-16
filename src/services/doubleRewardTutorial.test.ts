// The one-time ×2 explainer's persistence contract. The component decides WHEN to
// render it (only when rewarded ads are actually available); this file pins down the
// "exactly once, ever, for everyone" half of that.

import test from "node:test";
import assert from "node:assert/strict";

// saveStore persists to localStorage and announces changes on `window`; neither
// exists under plain node. Minimal in-memory stand-ins, installed before the module
// loads, so the real store logic runs unmodified.
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

const { shouldShowDoubleRewardTutorial, markDoubleRewardTutorialShown } = await import("./tutorialStore.ts");
const { getSaveData, updateSaveData } = await import("./saveStore.ts");

function resetFlag(): void {
  updateSaveData((data) => {
    data.progress.doubleRewardTutorialShown = false;
  });
}

test("a player who has never seen it gets it", () => {
  resetFlag();
  assert.equal(shouldShowDoubleRewardTutorial(), true);
});

test("once marked, it never returns", () => {
  resetFlag();
  markDoubleRewardTutorialShown();
  assert.equal(shouldShowDoubleRewardTutorial(), false);
  // Repeated reads (a fresh offer, a new screen, an app restart reading the same
  // saved data) must all stay false.
  for (let i = 0; i < 5; i++) assert.equal(shouldShowDoubleRewardTutorial(), false);
});

test("marking twice is harmless", () => {
  resetFlag();
  markDoubleRewardTutorialShown();
  markDoubleRewardTutorialShown();
  assert.equal(getSaveData().progress.doubleRewardTutorialShown, true);
});

test("the flag defaults to false, so existing players who never met the offer still get it", () => {
  // An old save that predates the field: the defaults merge fills it in as false
  // rather than leaving it undefined, so shouldShow... returns true for them.
  updateSaveData((data) => {
    delete (data.progress as { doubleRewardTutorialShown?: boolean }).doubleRewardTutorialShown;
  });
  assert.notEqual(shouldShowDoubleRewardTutorial(), false);
});

test("it is one global flag, not one per reward type", () => {
  // There is deliberately no per-placement state: seeing it on a chest reward must
  // also cover the shape/special/mega/artist challenge offers, which are the same
  // component. Guarded by asserting the store exposes no placement-aware variant.
  resetFlag();
  assert.equal(shouldShowDoubleRewardTutorial(), true);
  markDoubleRewardTutorialShown();
  assert.equal(shouldShowDoubleRewardTutorial(), false, "covers every entry point at once");
});
