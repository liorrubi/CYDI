// Create Challenge feature-discovery rules. The prompt exists because a player who
// enters through Shape Challenge never passes the home screen again, so these tests
// pin down exactly when it appears - and, more importantly, when it must not.

import test from "node:test";
import assert from "node:assert/strict";

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
  createDiscoveryVariant,
  markCreateDiscoveryShown,
  markCreateFeatureDiscovered,
  CREATE_DISCOVERY_FIRST_ROUNDS,
  CREATE_DISCOVERY_REMINDER_ROUNDS,
} = await import("./tutorialStore.ts");
const { updateSaveData } = await import("./saveStore.ts");

function reset(rounds = 0): void {
  updateSaveData((data) => {
    data.progress.completedRounds = rounds;
    data.progress.createDiscoveryShown = false;
    data.progress.createDiscoveryReminderShown = false;
    data.progress.createFeatureDiscovered = false;
    data.progress.challenges = [];
  });
}

function setRounds(rounds: number): void {
  updateSaveData((data) => {
    data.progress.completedRounds = rounds;
  });
}

test("no prompt before the first threshold", () => {
  reset(0);
  assert.equal(createDiscoveryVariant(), null);
  setRounds(CREATE_DISCOVERY_FIRST_ROUNDS - 1);
  assert.equal(createDiscoveryVariant(), null);
});

test("the first prompt appears once the round threshold is reached", () => {
  reset(CREATE_DISCOVERY_FIRST_ROUNDS);
  assert.equal(createDiscoveryVariant(), "first");
});

test("after the first prompt, nothing until the reminder threshold", () => {
  reset(CREATE_DISCOVERY_FIRST_ROUNDS);
  markCreateDiscoveryShown("first");
  assert.equal(createDiscoveryVariant(), null);
  setRounds(CREATE_DISCOVERY_REMINDER_ROUNDS - 1);
  assert.equal(createDiscoveryVariant(), null);
});

test("exactly one reminder, then silence forever", () => {
  reset(CREATE_DISCOVERY_FIRST_ROUNDS);
  markCreateDiscoveryShown("first");
  setRounds(CREATE_DISCOVERY_REMINDER_ROUNDS);
  assert.equal(createDiscoveryVariant(), "reminder");

  markCreateDiscoveryShown("reminder");
  assert.equal(createDiscoveryVariant(), null);
  setRounds(CREATE_DISCOVERY_REMINDER_ROUNDS + 50);
  assert.equal(createDiscoveryVariant(), null, "never a third prompt");
});

test("reaching the Create screen stops discovery, even mid-sequence", () => {
  reset(CREATE_DISCOVERY_FIRST_ROUNDS);
  assert.equal(createDiscoveryVariant(), "first");

  markCreateFeatureDiscovered(); // entered by any route, saved or abandoned

  assert.equal(createDiscoveryVariant(), null);
  setRounds(CREATE_DISCOVERY_REMINDER_ROUNDS);
  assert.equal(createDiscoveryVariant(), null, "no reminder once the feature is known");
});

test("a player who already has a challenge never sees a prompt", () => {
  // Covers veterans from before these flags existed: their saved challenges are the
  // proof they know the feature, even though createFeatureDiscovered is false.
  reset(CREATE_DISCOVERY_REMINDER_ROUNDS);
  updateSaveData((data) => {
    data.progress.challenges = [
      { id: "x", name: "Mine", target: { points: [] }, createdAt: 0, updatedAt: 0, attempts: 0 },
    ] as never;
  });
  assert.equal(createDiscoveryVariant(), null);
});

test("deferring does not burn the prompt - only marking does", () => {
  // The screen defers when another tutorial owns the result view; it simply does not
  // call markCreateDiscoveryShown, so the same variant is still due next round.
  reset(CREATE_DISCOVERY_FIRST_ROUNDS);
  assert.equal(createDiscoveryVariant(), "first");
  assert.equal(createDiscoveryVariant(), "first", "still pending after a deferral");
  setRounds(CREATE_DISCOVERY_FIRST_ROUNDS + 2);
  assert.equal(createDiscoveryVariant(), "first");
});
