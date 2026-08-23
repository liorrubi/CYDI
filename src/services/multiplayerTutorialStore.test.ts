import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

// Node has no localStorage by default, so the store gets a minimal one. It is
// installed before the module under test is imported, because the store reads
// through `localStorage` at call time (not at module load) - which is itself
// worth knowing: a module-scope read would break in exactly this situation.
class MemoryStorage {
  map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

const storage = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;

const {
  markGuestTutorialShown,
  markHostTutorialShown,
  markRoundCoachShown,
  resetMultiplayerTutorials,
  shouldShowGuestTutorial,
  shouldShowHostTutorial,
  shouldShowRoundCoach,
} = await import("./multiplayerTutorialStore.ts");

beforeEach(() => storage.clear());

test("each tutorial is shown once and then never again", () => {
  assert.equal(shouldShowHostTutorial(), true);
  markHostTutorialShown();
  assert.equal(shouldShowHostTutorial(), false);
  assert.equal(shouldShowHostTutorial(), false, "still false on a later session");
});

test("host and guest tutorials are tracked separately", () => {
  // Being a guest once must not consume the explanation you need the first
  // time you host - they teach different things and expose different controls.
  markGuestTutorialShown();
  assert.equal(shouldShowGuestTutorial(), false);
  assert.equal(shouldShowHostTutorial(), true, "hosting is still unexplained");

  storage.clear();
  markHostTutorialShown();
  assert.equal(shouldShowHostTutorial(), false);
  assert.equal(shouldShowGuestTutorial(), true);
});

test("the in-round coach marks have their own flag", () => {
  markHostTutorialShown();
  markGuestTutorialShown();
  assert.equal(shouldShowRoundCoach(), true, "the coach marks are independent of the intro");
  markRoundCoachShown();
  assert.equal(shouldShowRoundCoach(), false);
});

test("the flags are separate from CYDI's own onboarding keys", () => {
  // A long-time player has already dismissed every existing tutorial; reusing
  // those keys would mean the person most likely to host never gets told how.
  markHostTutorialShown();
  markGuestTutorialShown();
  markRoundCoachShown();
  const keys = [...storage.map.keys()];
  assert.ok(
    keys.every((k) => k.startsWith("cydi.mp.")),
    `multiplayer must only write cydi.mp.* keys, got ${keys.join(", ")}`,
  );
  // And nothing that belongs to progression.
  for (const forbidden of ["cydi.save", "cydi.coins", "cydi.challenges", "cydi.shapeChallenge"]) {
    assert.ok(!keys.some((k) => k.startsWith(forbidden)), `must not write ${forbidden}`);
  }
});

test("resetMultiplayerTutorials re-arms everything", () => {
  markHostTutorialShown();
  markGuestTutorialShown();
  markRoundCoachShown();
  resetMultiplayerTutorials();
  assert.equal(shouldShowHostTutorial(), true);
  assert.equal(shouldShowGuestTutorial(), true);
  assert.equal(shouldShowRoundCoach(), true);
});

test("unavailable storage degrades to showing the tutorial, never to hiding it", () => {
  const broken = {
    getItem() {
      throw new Error("storage disabled");
    },
    setItem() {
      throw new Error("storage disabled");
    },
    removeItem() {
      throw new Error("storage disabled");
    },
  };
  (globalThis as unknown as { localStorage: unknown }).localStorage = broken;
  try {
    // Private browsing must not permanently hide the explanation.
    assert.equal(shouldShowHostTutorial(), true);
    assert.doesNotThrow(() => markHostTutorialShown());
    assert.doesNotThrow(() => resetMultiplayerTutorials());
  } finally {
    (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;
  }
});
