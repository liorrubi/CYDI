// Proves the DoS guard added to `importSaveCode`: a pasted backup code is
// user-supplied external data just like an incoming share link, so a crafted
// code carrying an absurd number of drawing points must be rejected before it
// ever reaches localStorage or a render/score pass - otherwise it would freeze
// the tab exactly like an unguarded share-link decode would.

import test from "node:test";
import assert from "node:assert/strict";

// importSaveCode's happy path writes to localStorage/dispatches a window
// event via saveStore - stub both minimally so the "legitimate code still
// imports" case can run under plain Node (no DOM).
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
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
(globalThis as unknown as { window: { dispatchEvent: () => void } }).window = { dispatchEvent: () => {} };

// app/constants.ts reads these as Vite build-time `define` globals - absent
// under plain `node --test`, so stub them before anything imports it transitively.
(globalThis as unknown as { __APP_BUILD__: string }).__APP_BUILD__ = "test";
(globalThis as unknown as { __APP_BUILD_TIME__: string }).__APP_BUILD_TIME__ = "test";

const { importSaveCode } = await import("./saveTransfer.ts");
const { SAVE_SCHEMA_VERSION } = await import("./saveData.ts");
const { MAX_SHARE_POINTS } = await import("./shareLink.ts");

function makePayload(pointCount: number) {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    updatedAt: Date.now(),
    progress: {
      coins: 100,
      shapeChallenge: { levelIndexByCategory: {}, bestScores: {} },
      achievements: [],
      unlockedCategories: [],
      unlockedPenColors: [],
      unlockedPenSkins: [],
      dailyStreak: { lastVisitDate: "", currentStreak: 0, longestStreak: 0 },
      dailyChest: { lastOpenedDate: "" },
      specialChallenge: { lastFreeDate: "", bestScores: {} },
      megaChallenge: {
        unlocked: false,
        unlockedCardIds: [],
        bestScores: {},
        completionRewardClaimedIds: [],
        perfectCardIds: [],
        championCelebrated: false,
      },
      artistPacks: { bestScores: {} },
      paidChestDoubles: { date: "", count: 0 },
      shopChestCooldowns: {},
      successfulDrawings: 0,
      completedRounds: 0,
      achievementsTutorialShown: false,
      myChallengesTutorialShown: false,
      onboardingTutorialShown: false,
      challenges: [
        {
          id: "c1",
          name: "Test challenge",
          target: {
            points: Array.from({ length: pointCount }, (_, i) => ({ x: i, y: i, t: 0 })),
            canvasWidth: 320,
            canvasHeight: 320,
          },
          createdAt: 0,
          updatedAt: 0,
          attempts: 0,
        },
      ],
      sharedChallengeIds: [],
    },
    settings: { selectedPenColor: "classicBlack", selectedPenSkin: "basicPencil", difficulty: "normal", soundEnabled: true },
  };
}

function encodeBackupCode(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf-8").toString("base64");
}

test("importSaveCode rejects a backup code whose challenge exceeds the share-link point cap", () => {
  const code = encodeBackupCode(makePayload(MAX_SHARE_POINTS + 1));
  const result = importSaveCode(code);
  assert.equal(result.ok, false);
});

test("importSaveCode accepts a backup code within the point cap", () => {
  const code = encodeBackupCode(makePayload(MAX_SHARE_POINTS));
  const result = importSaveCode(code);
  assert.equal(result.ok, true);
});
