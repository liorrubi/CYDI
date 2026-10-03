import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

class MemoryStorage {
  map = new Map<string, string>();
  throwOnSet = false;
  throwOnGet = false;
  getItem(k: string) {
    if (this.throwOnGet) throw new Error("denied");
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    if (this.throwOnSet) throw new Error("quota");
    this.map.set(k, v);
  }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); this.throwOnSet = false; this.throwOnGet = false; }
}
const storage = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;

const { MP_DAILY_ORDINAL_CAP, localDayKey, multiplayerGameKey, recordMultiplayerGame } = await import("./dailyOrdinalStore");
const { validateEventParams } = await import("../services/analyticsSchema");

const KEY = "cydi.mp.dailyOrdinal.v1";
const noon = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0);

beforeEach(() => storage.clear());

test("local day key is the device's own calendar day, zero padded", () => {
  assert.equal(localDayKey(noon(2026, 1, 5)), "2026-01-05");
  assert.equal(localDayKey(new Date(2026, 11, 31, 23, 59, 59)), "2026-12-31");
  assert.equal(localDayKey(new Date(2027, 0, 1, 0, 0, 1)), "2027-01-01", "just after local midnight is the new day");
});

test("games on the same day count 1, 2, 3 in order", () => {
  const t = noon(2026, 10, 3);
  assert.equal(recordMultiplayerGame("ABC234:1", t), 1);
  assert.equal(recordMultiplayerGame("ABC234:2", t), 2, "a rematch has a new gameSerial");
  assert.equal(recordMultiplayerGame("XYZ789:1", t), 3);
});

test("the same game seen again (remount, reconnect, resume) is not counted and sends nothing", () => {
  const t = noon(2026, 10, 3);
  assert.equal(recordMultiplayerGame("ABC234:1", t), 1);
  assert.equal(recordMultiplayerGame("ABC234:1", t), null);
  assert.equal(recordMultiplayerGame("ABC234:1", t), null);
  assert.equal(recordMultiplayerGame("ABC234:2", t), 2, "the next game still continues from 1");
});

test("a resume across local midnight is still the same game", () => {
  assert.equal(recordMultiplayerGame("ABC234:1", noon(2026, 10, 3, 23)), 1);
  assert.equal(recordMultiplayerGame("ABC234:1", noon(2026, 10, 4, 0)), null);
});

test("a new local day resets the count", () => {
  assert.equal(recordMultiplayerGame("AAA222:1", noon(2026, 10, 3)), 1);
  assert.equal(recordMultiplayerGame("AAA222:2", noon(2026, 10, 3)), 2);
  assert.equal(recordMultiplayerGame("AAA222:3", noon(2026, 10, 4)), 1);
  assert.equal(recordMultiplayerGame("AAA222:4", noon(2026, 10, 4)), 2);
});

test("host and guest in the same room each count their own device's game", () => {
  // Two devices = two storages; model them by swapping the stored state.
  const t = noon(2026, 10, 3);
  assert.equal(recordMultiplayerGame("ROOM22:1", t), 1, "host");
  const hostState = storage.getItem(KEY)!;
  storage.clear();
  assert.equal(recordMultiplayerGame("ROOM22:1", t), 1, "guest, own device");
  storage.setItem(KEY, hostState);
  assert.equal(recordMultiplayerGame("ROOM22:1", t), null, "host remount is still idempotent");
});

test("the ordinal caps at 7 (7 means 7+) and stays valid on the wire", () => {
  const t = noon(2026, 10, 3);
  const seen: Array<number | null> = [];
  for (let i = 1; i <= 10; i++) seen.push(recordMultiplayerGame(`ROOM22:${i}`, t));
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 7, 7, 7, 7]);
  assert.equal(MP_DAILY_ORDINAL_CAP, 7);
  const stored = JSON.parse(storage.getItem(KEY)!) as { count: number };
  assert.equal(stored.count, 7, "the stored count is capped too");
  for (const ordinal of seen) {
    assert.equal(validateEventParams("mp_game_started", { playerCount: 3, roundCount: 5, difficulty: "mixed", mpDailyOrdinal: ordinal }).valid, true);
  }
});

test("corrupt or hostile storage is treated as an empty day, never thrown", () => {
  const t = noon(2026, 10, 3);
  for (const bad of ["{ not json", "null", "42", JSON.stringify({ day: "yesterday", count: 3, lastKey: "x" }), JSON.stringify({ day: "2026-10-03", count: -1, lastKey: "x" }), JSON.stringify({ day: "2026-10-03", count: 2.5, lastKey: "x" }), JSON.stringify({ day: "2026-10-03", count: "3", lastKey: "x" }), JSON.stringify({ day: "2026-10-03", count: 3, lastKey: 7 }), JSON.stringify({ day: "2026-10-03", count: 3, lastKey: "k".repeat(200) })]) {
    storage.setItem(KEY, bad);
    assert.equal(recordMultiplayerGame("ABC234:1", t), 1, `fresh start from ${bad.slice(0, 30)}`);
  }
  storage.setItem(KEY, JSON.stringify({ day: "2026-10-03", count: 9999, lastKey: "old" }));
  assert.equal(recordMultiplayerGame("ABC234:1", t), 7, "an absurd stored count is clamped");
});

test("unavailable storage sends no ordinal instead of a misleading 1", () => {
  const t = noon(2026, 10, 3);
  storage.throwOnSet = true;
  assert.equal(recordMultiplayerGame("ABC234:1", t), null);
  storage.throwOnSet = false;
  storage.throwOnGet = true;
  assert.equal(recordMultiplayerGame("ABC234:1", t), null);
});

test("an empty or oversized game key is never counted", () => {
  assert.equal(recordMultiplayerGame("", noon(2026, 10, 3)), null);
  assert.equal(recordMultiplayerGame("x".repeat(100), noon(2026, 10, 3)), null);
});

test("the game key combines room and serial locally, tolerating an older server with no serial", () => {
  assert.equal(multiplayerGameKey("ABC234", 3), "ABC234:3");
  assert.equal(multiplayerGameKey("ABC234", undefined), "ABC234:?");
});

test("stored state holds only the day, a count and the local key - nothing else", () => {
  recordMultiplayerGame("ABC234:1", noon(2026, 10, 3));
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem(KEY)!)).sort(), ["count", "day", "lastKey"]);
});
