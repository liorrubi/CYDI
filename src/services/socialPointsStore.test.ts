import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// Node has no localStorage. Same pattern as multiplayerTutorialStore.test.ts:
// installed before the module under test is imported, because the store reads
// through `globalThis.localStorage` at call time rather than at module load.
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
// coinsStore writes through saveStore, which announces changes on `window`.
// Only needed so the coins-are-untouched test can move a real coin balance.
(globalThis as unknown as { window: unknown }).window = {
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};

const {
  awardPassPlayMatch,
  awardSocialPoints,
  getSocialPoints,
  hasAwarded,
  resetSocialPoints,
  subscribeSocialPoints,
} = await import("./socialPointsStore");
const { multiplayerAwardId, multiplayerAwards, PASS_PLAY_MATCH_POINTS } = await import("../social/socialRewards");
const { addCoins, getCoins } = await import("./coinsStore");

beforeEach(() => {
  storage.clear();
  resetSocialPoints();
});

/** What one client does at the end of a live match: work out its own award and bank it under the match's key. */
function finishMultiplayerMatch(roomCode: string, gameSerial: number, seatId: string, totals: Record<string, number>) {
  const entries = Object.entries(totals).map(([id, totalScore]) => ({ id, totalScore }));
  const points = multiplayerAwards(entries).get(seatId) ?? 0;
  return awardSocialPoints(multiplayerAwardId(roomCode, gameSerial, seatId), points);
}

// ------------------------------------------------------------- basic maths ---

test("a new device starts on zero", () => {
  assert.equal(getSocialPoints(), 0);
});

test("winning a live match banks 3 points", () => {
  const result = finishMultiplayerMatch("ABC234", 1, "me", { me: 90, them: 40 });
  assert.deepEqual({ granted: result.granted, points: result.points, total: result.total }, { granted: true, points: 3, total: 3 });
  assert.equal(getSocialPoints(), 3);
});

test("coming second banks 2, and coming third banks 1", () => {
  finishMultiplayerMatch("ABC234", 1, "me", { winner: 90, me: 60, third: 10 });
  assert.equal(getSocialPoints(), 2);
  finishMultiplayerMatch("ABC234", 2, "me", { winner: 90, second: 60, me: 10 });
  assert.equal(getSocialPoints(), 3);
});

test("a finished Pass & Play match banks 2, whoever won it", () => {
  const result = awardPassPlayMatch("game-1", PASS_PLAY_MATCH_POINTS);
  assert.equal(result.points, 2);
  assert.equal(getSocialPoints(), 2);
});

// ------------------------------------------------------- anti-double-award ---

test("the same finished match cannot pay twice, however many times it is seen", () => {
  const totals = { me: 90, them: 40 };
  finishMultiplayerMatch("ABC234", 1, "me", totals);

  // A repeated final snapshot, a reconnect, a remount, a back/forward
  // navigation and a duplicate event are all the same thing to the store: the
  // same award id arriving again.
  for (let i = 0; i < 5; i++) {
    const repeat = finishMultiplayerMatch("ABC234", 1, "me", totals);
    assert.equal(repeat.granted, false);
    assert.equal(repeat.points, 0);
  }
  assert.equal(getSocialPoints(), 3, "still just the one match");
});

test("a Pass & Play match cannot pay twice either", () => {
  awardPassPlayMatch("game-1", PASS_PLAY_MATCH_POINTS);
  awardPassPlayMatch("game-1", PASS_PLAY_MATCH_POINTS);
  awardPassPlayMatch("game-1", PASS_PLAY_MATCH_POINTS);
  assert.equal(getSocialPoints(), 2);
});

test("a completed rematch is a new match and earns again", () => {
  finishMultiplayerMatch("ABC234", 1, "me", { me: 90, them: 40 });
  finishMultiplayerMatch("ABC234", 2, "me", { me: 30, them: 80 });
  assert.equal(getSocialPoints(), 3 + 2, "won the first, lost the rematch");

  awardPassPlayMatch("game-1", PASS_PLAY_MATCH_POINTS);
  awardPassPlayMatch("game-2", PASS_PLAY_MATCH_POINTS);
  assert.equal(getSocialPoints(), 5 + 4);
});

test("nothing is banked for a match that was never finished", () => {
  // Joining, playing a round and quitting, an abandoned room, a reconnect that
  // goes nowhere: none of them reach a final result, so no award id is ever
  // presented and the tally cannot move.
  assert.equal(getSocialPoints(), 0);
  assert.equal(hasAwarded(multiplayerAwardId("ABC234", 1, "me")), false);
});

test("an award of zero points is still recorded, so it cannot be retried into a real one", () => {
  const id = multiplayerAwardId("ABC234", 1, "me");
  assert.equal(awardSocialPoints(id, 0).granted, true);
  assert.equal(awardSocialPoints(id, 3).granted, false);
  assert.equal(getSocialPoints(), 0);
});

test("a negative award can never take points away", () => {
  awardPassPlayMatch("game-1", PASS_PLAY_MATCH_POINTS);
  awardSocialPoints("bogus", -100);
  assert.equal(getSocialPoints(), 2);
});

// ------------------------------------------------------------- persistence ---

test("the total survives a reload of the module against the same storage", async () => {
  finishMultiplayerMatch("ABC234", 1, "me", { me: 90, them: 40 });
  awardPassPlayMatch("game-1", PASS_PLAY_MATCH_POINTS);
  assert.equal(getSocialPoints(), 5);

  // A fresh import is the closest thing to a page reload: same storage, new
  // module instance, no in-memory state carried over.
  const reloaded = await import(`./socialPointsStore.ts?reload=${Date.now()}`);
  assert.equal(reloaded.getSocialPoints(), 5);
  assert.equal(reloaded.hasAwarded(multiplayerAwardId("ABC234", 1, "me")), true, "and so does the anti-double-award record");
});

test("a corrupt record reads as zero rather than poisoning every later total", () => {
  storage.setItem("cydi.social.v1", "{ this is not json");
  assert.equal(getSocialPoints(), 0);
  awardPassPlayMatch("game-1", PASS_PLAY_MATCH_POINTS);
  assert.equal(getSocialPoints(), 2);

  storage.setItem("cydi.social.v1", JSON.stringify({ total: "lots", awarded: null }));
  assert.equal(getSocialPoints(), 0);
});

test("the remembered-award list stays bounded", () => {
  for (let i = 0; i < 200; i++) awardPassPlayMatch(`game-${i}`, 1);
  const stored = JSON.parse(storage.getItem("cydi.social.v1")!) as { total: number; awarded: string[] };
  assert.equal(stored.total, 200, "every match still counted");
  assert.ok(stored.awarded.length <= 60, `remembered ${stored.awarded.length} ids`);
  assert.ok(stored.awarded.includes("pp:game-199"), "and the most recent are the ones kept");
});

test("listeners are told when the total moves", () => {
  const seen: number[] = [];
  const stop = subscribeSocialPoints((profile) => seen.push(profile.total));
  awardPassPlayMatch("game-1", PASS_PLAY_MATCH_POINTS);
  awardPassPlayMatch("game-1", PASS_PLAY_MATCH_POINTS); // repeat: no notification
  stop();
  awardPassPlayMatch("game-2", PASS_PLAY_MATCH_POINTS);
  assert.deepEqual(seen, [2]);
});

// -------------------------------------------------- separate from the economy --

test("earning Social Points never moves the coin balance", () => {
  addCoins(25);
  const before = getCoins();
  finishMultiplayerMatch("ABC234", 1, "me", { me: 90, them: 40 });
  awardPassPlayMatch("game-1", PASS_PLAY_MATCH_POINTS);
  assert.equal(getCoins(), before);
  assert.equal(getSocialPoints(), 5);
});

test("Social Points live in their own storage key, not in SaveData", () => {
  awardPassPlayMatch("game-1", PASS_PLAY_MATCH_POINTS);
  assert.ok(storage.getItem("cydi.social.v1"), "written to its own key");
  const save = storage.getItem("cydi.saveData.v1");
  if (save) assert.ok(!save.includes("social"), "and never leaks into the progression record");
});

test("the store cannot reach the economy: no import of coins, save data or ads", async () => {
  for (const file of ["socialPointsStore.ts", join("..", "social", "socialRewards.ts")]) {
    const source = await readFile(join(import.meta.dirname, file), "utf8");
    for (const forbidden of ["coinsStore", "saveStore", "saveData", "services/ads", "rewardedAds", "achievementsStore"]) {
      assert.ok(!source.includes(`from "${forbidden}`) && !source.includes(`/${forbidden}"`), `${file} must not import ${forbidden}`);
    }
    // Prestige, never currency: nothing here may subtract. Checked against the
    // CODE with comments stripped - the comments discuss spending precisely
    // because there is none of it.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const pattern of [/\bspend\w*\s*\(/i, /\bdeduct\w*\s*\(/i, /-=/]) {
      assert.ok(!pattern.test(code), `${file} must have no spending path (matched ${pattern})`);
    }
  }
});

// ------------------------------------------------- only the social modes earn --

test("no Classic screen can award Social Points", async () => {
  // The award calls are the whole surface. If one ever appears in Shape
  // Challenge, the Daily Challenge, the Shop or anywhere else in Classic, this
  // fails - which is the point: Social Points are for playing WITH people.
  const ALLOWED = new Set(["PassPlayGame.tsx", "PlayTogetherRoom.tsx", "socialPointsStore.ts", "socialPointsStore.test.ts"]);
  const src = join(import.meta.dirname, "..");
  const offenders: string[] = [];

  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || ALLOWED.has(entry.name)) continue;
      const source = await readFile(path, "utf8");
      if (/\bawardSocialPoints\s*\(|\bawardPassPlayMatch\s*\(/.test(source)) offenders.push(entry.name);
    }
  }
  await walk(src);
  assert.deepEqual(offenders, []);
});
