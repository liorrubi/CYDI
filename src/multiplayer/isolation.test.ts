import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// Neither multiplayer mode - Play Together (live) nor 2 Players (same device) -
// may touch coins, achievements, streaks, progression or ads. That is a product
// decision for v1 of each, and the cheapest way to keep it true is structural:
// scan the features' own source and fail if they so much as mention one of
// those modules. A future accidental import shows up here rather than as a coin
// balance that moved during a multiplayer round.

const FORBIDDEN = [
  "coinsStore",
  "achievementsStore",
  "achievements",
  "shapeRoundOutcome",
  "saveStore",
  "saveData",
  "tutorialStore", // the SINGLE-player one; multiplayer has multiplayerTutorialStore
  "services/ads",
  "adPlacements",
  "rewardedAds",
  "dailyStreakStore",
  "shapeChallengeProgress",
  "successfulDrawingsStore",
  "megaChallengeStore",
  "artistPackStore",
  "categoryUnlockStore",
];

/** Every file that makes up either feature. */
async function multiplayerSources(): Promise<{ path: string; source: string }[]> {
  const roots = [
    join(import.meta.dirname, "."), // src/multiplayer
    join(import.meta.dirname, "..", "components", "multiplayer"),
    join(import.meta.dirname, "..", "passplay"),
    join(import.meta.dirname, "..", "components", "passplay"),
  ];
  const files: { path: string; source: string }[] = [];
  for (const root of roots) {
    for (const name of await readdir(root)) {
      if (!name.endsWith(".ts") && !name.endsWith(".tsx")) continue;
      if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
      files.push({ path: join(root, name), source: await readFile(join(root, name), "utf8") });
    }
  }
  // The screens are the entry points and belong to the same boundary.
  for (const name of ["PlayTogetherScreen.tsx", "PassPlayScreen.tsx"]) {
    const screen = join(import.meta.dirname, "..", "screens", name);
    files.push({ path: screen, source: await readFile(screen, "utf8") });
  }
  return files;
}

test("neither multiplayer mode imports coins, achievements, progression or ads", async () => {
  const files = await multiplayerSources();
  assert.ok(files.length >= 12, `expected both features, found ${files.length} files`);

  const violations: string[] = [];
  for (const { path, source } of files) {
    // Only import statements matter - prose in a comment is fine, and the
    // isolation is precisely about the module graph.
    for (const match of source.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)) {
      const specifier = match[1];
      for (const forbidden of FORBIDDEN) {
        // multiplayerTutorialStore legitimately contains "TutorialStore".
        if (specifier.includes("multiplayerTutorialStore")) continue;
        if (specifier.includes(forbidden)) violations.push(`${path.split(/[\\/]/).pop()} imports ${specifier}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("neither multiplayer mode calls a progression mutator", async () => {
  const files = await multiplayerSources();
  const CALLS = ["addCoins(", "spendCoins(", "recordRoundCompleted(", "applyShapeRoundOutcome(", "markShapeCompleted(", "recordSuccessfulDrawing(", "recordDailyVisit("];
  const violations: string[] = [];
  for (const { path, source } of files) {
    for (const call of CALLS) {
      if (source.includes(call)) violations.push(`${path.split(/[\\/]/).pop()} calls ${call}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("neither multiplayer mode reaches for an ad", async () => {
  const files = await multiplayerSources();
  const violations: string[] = [];
  for (const { path, source } of files) {
    if (/\bshowRewardedAd\b|\bAdMob\b|\brequestAd\b/.test(source)) {
      violations.push(path.split(/[\\/]/).pop()!);
    }
  }
  assert.deepEqual(violations, []);
});

test("no product code imports the in-memory harness", async () => {
  // fakeRoom.ts is a dev/test tool. If a screen or component ever imports it
  // again, players get scripted bots instead of a real game - which is exactly
  // the kind of thing that ships unnoticed.
  const files = await multiplayerSources();
  const offenders = files
    .filter((f) => !f.path.endsWith("fakeRoom.ts") && !f.path.endsWith("roomTransport.ts"))
    .filter((f) => /from\s+["'][^"']*fakeRoom["']/.test(f.source))
    .map((f) => f.path.split(/[\\/]/).pop());
  assert.deepEqual(offenders, []);
});
