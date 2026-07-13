// Proves the corruption-recovery fix in `saveStore.load()`: a save blob that
// parses as JSON but fails the (loose) `isSaveData` check - e.g. because
// `schemaVersion` got dropped by a bad write, not because it's a brand new
// device - must not be discarded in favor of the legacy per-feature import,
// which has no counterpart for fields like `megaChallenge`/`artistPacks` and
// would silently reset them even though the real progress was still there.
//
// This scenario needs its own process-isolated module instance (saveStore
// caches the loaded save after first read), so it lives in its own file
// rather than alongside other saveStore scenarios.

import test from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

const storage = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;

// app/constants.ts reads these as Vite build-time `define` globals - absent
// under plain `node --test`, so stub them before anything imports it transitively.
(globalThis as unknown as { __APP_BUILD__: string }).__APP_BUILD__ = "test";
(globalThis as unknown as { __APP_BUILD_TIME__: string }).__APP_BUILD_TIME__ = "test";

// Missing schemaVersion (as if a bad write dropped the field), but otherwise a
// real save blob - including a unified-save-only field with no legacy key.
storage.setItem(
  "cydi.save.v1",
  JSON.stringify({
    updatedAt: 12345,
    progress: {
      coins: 777,
      megaChallenge: { unlocked: true, unlockedCardIds: ["a", "b"], bestScores: {}, completionRewardClaimedIds: [], perfectCardIds: [], championCelebrated: false },
      achievements: ["first_shape"],
    },
    settings: { selectedPenColor: "classicBlack" },
  }),
);

const { getSaveData } = await import("./saveStore.ts");

test("a save blob with a missing schemaVersion is recovered field-by-field instead of reset via legacy import", () => {
  const data = getSaveData();
  assert.equal(data.progress.coins, 777, "coins from the corrupted-but-parseable blob should survive");
  assert.equal(data.progress.megaChallenge.unlocked, true, "a unified-save-only field with no legacy key should survive");
  assert.deepEqual(data.progress.megaChallenge.unlockedCardIds, ["a", "b"]);
  assert.deepEqual(data.progress.achievements, ["first_shape"]);
  // Fields absent from the corrupted blob still fall back to defaults rather than being undefined.
  assert.deepEqual(data.progress.challenges, []);
  assert.equal(typeof data.schemaVersion, "number");
});
