// 0.57.0 pre-deploy verification (sections K): installed 0.55 / 0.56 clients vs the 3/5/10 round change,
// and the mpDailyOrdinal idempotence contract. Added by the compat-verify pass; touches no existing file.
//
// What is real here and what is a mirror:
//  - protocol / UI constants, parseClientFrame, roundLabel, createPassPlayGame, recordMultiplayerGame and
//    validateEventParams are the real shipped functions.
//  - PlayTogetherRoom.tsx is a React component and the repo has no DOM test runner, so the one effect that
//    decides the ordinal (PlayTogetherRoom.tsx, the "analytics" useEffect) is mirrored by `RoomAnalyticsMirror`
//    below, and a source-text guard fails this file the moment the real effect stops containing the lines the
//    mirror was written from.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { beforeEach } from "node:test";

class MemoryStorage {
  map = new Map<string, string>();
  throwOnGet = false;
  throwOnSet = false;
  getItem(k: string) {
    if (this.throwOnGet) throw new Error("denied");
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    if (this.throwOnSet) throw new Error("quota");
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
    this.throwOnGet = false;
    this.throwOnSet = false;
  }
}
const storage = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;

const protocol = await import("./protocol");
const { parseClientFrame, ROUND_COUNT_OPTIONS_UI, ROUND_COUNT_ACCEPTED, DEFAULT_ROUND_COUNT, isRoundCount } = protocol;
const { recordMultiplayerGame, multiplayerGameKey, localDayKey } = await import("./dailyOrdinalStore");
const { roundLabel } = await import("./roomUiRules");
const { validateEventParams } = await import("../services/analyticsSchema");
const passPlay = await import("../passplay/passPlayGame");

const ROOT = new URL("../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, ROOT), "utf8");

beforeEach(() => storage.clear());

// ---------------------------------------------------------------- K1: constants and consumers ----

test("UI offers 3/5/10, default is 5 and is one of the offered lengths, the accepted set is a superset that keeps 15", () => {
  assert.deepEqual([...ROUND_COUNT_OPTIONS_UI], [3, 5, 10]);
  assert.equal(DEFAULT_ROUND_COUNT, 5);
  assert.ok((ROUND_COUNT_OPTIONS_UI as readonly number[]).includes(DEFAULT_ROUND_COUNT));
  assert.deepEqual([...ROUND_COUNT_ACCEPTED], [3, 5, 10, 15]);
  for (const n of ROUND_COUNT_OPTIONS_UI) assert.ok(ROUND_COUNT_ACCEPTED.includes(n));
  assert.equal(isRoundCount(15), true, "installed clients still send 15");
  for (const bad of [0, 1, 2, 4, 6, 20, "5", null, undefined, 5.5]) assert.equal(isRoundCount(bad), false, String(bad));
});

test("every consumer of the round list reads the UI list and the DEFAULT; nothing reads a removed name or a literal 10/15 default", () => {
  for (const f of ["src/screens/PlayTogetherScreen.tsx", "src/screens/PassPlayScreen.tsx", "src/components/multiplayer/PlayTogetherRoom.tsx"]) {
    const src = read(f);
    assert.match(src, /ROUND_COUNT_OPTIONS_UI/, `${f} must render the UI list`);
    assert.doesNotMatch(src, /ROUND_COUNT_OPTIONS\b(?!_)/, `${f} still references the removed ROUND_COUNT_OPTIONS`);
    assert.doesNotMatch(src, /useState<RoundCount>\((10|15|5)\)/, `${f} must use DEFAULT_ROUND_COUNT, not a literal`);
  }
  assert.match(read("src/screens/PlayTogetherScreen.tsx"), /useState<RoundCount>\(DEFAULT_ROUND_COUNT\)/);
  assert.match(read("src/screens/PassPlayScreen.tsx"), /useState<RoundCount>\(DEFAULT_ROUND_COUNT\)/);
  assert.match(read("src/multiplayer/fakeRoom.ts"), /options\.rounds \?\? DEFAULT_ROUND_COUNT/);
  // The Pass & Play site component is purely presentational: it renders whatever list it is handed.
  const entry = read("src/site/PassPlayEntry.tsx");
  assert.match(entry, /roundOptions\.map/);
  assert.doesNotMatch(entry, /\b15\b/);
  assert.match(read("src/screens/PassPlayScreen.tsx"), /roundOptions=\{ROUND_COUNT_OPTIONS_UI\}/);
  // The new host's lobby copy matches the chips.
  assert.match(read("src/screens/PlayTogetherScreen.tsx"), /3, 5 or 10 rounds/);
});

test("the Play Together host sends configure only when the room's length differs from the chosen one (default 5 == the Worker's fresh-room default, so no frame)", () => {
  const src = read("src/screens/PlayTogetherScreen.tsx");
  assert.match(src, /frame\.rounds !== rounds \|\| frame\.difficulty !== difficulty/);
});

// ------------------------------------------------ K2: old client -> new Worker frame parsing ----

test("the exact configure frames an installed 0.55/0.56 client sends parse on the new Worker (rounds 5/10/15, any difficulty)", () => {
  for (const rounds of [5, 10, 15]) {
    for (const difficulty of ["easy", "medium", "hard", "mixed"]) {
      const parsed = parseClientFrame(JSON.parse(JSON.stringify({ type: "configure", rounds, difficulty })));
      assert.deepEqual(parsed, { type: "configure", rounds, difficulty }, `${rounds}/${difficulty} must not be bad_frame`);
    }
  }
});

test("a difficulty click by a (promoted) host of ANY version resends the room's current length, including 3 and 15, and the Worker accepts it", () => {
  for (const rounds of [3, 15]) {
    assert.deepEqual(parseClientFrame({ type: "configure", rounds, difficulty: "hard" }), { type: "configure", rounds, difficulty: "hard" });
  }
});

test("other lengths are still refused", () => {
  for (const rounds of [0, 1, 2, 4, 7, 20, -5, 3.5, "5", null]) assert.equal(parseClientFrame({ type: "configure", rounds, difficulty: "mixed" }), null);
});

// ------------------------------------------------------ K3: round labels / Pass & Play lengths ----

test("labels, progress and last-round logic are generic in the length (3, 5, 10 and 15 all read 'Round x of N')", () => {
  for (const n of [3, 5, 10, 15]) {
    assert.equal(roundLabel(0, n), `Round 1 of ${n}`);
    assert.equal(roundLabel(n - 1, n), `Round ${n} of ${n}`);
    assert.equal(passPlay.roundLabel(n - 1, n), `Round ${n} of ${n}`);
    assert.equal(roundLabel(-1, n), "");
  }
});

test("Pass & Play builds, ends and rematches a 3-round and a 15-round game (15 = an old save-less path, kept valid)", () => {
  for (const rounds of [3, 5, 10, 15] as const) {
    const game = passPlay.createPassPlayGame({ names: ["A", "B"], rounds, difficulty: "mixed" }, () => 0.3);
    assert.equal(game.rounds, rounds);
    assert.equal(game.shapeSequence.length, rounds, "one shape per round");
    assert.equal(passPlay.isLastRound(game), false);
    assert.equal(passPlay.isLastRound({ ...game, roundIndex: rounds - 1 }), true);
    assert.equal(passPlay.rematch(game, () => 0.3).rounds, rounds, "a rematch keeps the chosen length");
  }
});

// ----------------------------------------------- K4: analytics payloads from an old / new client ----

test("every roundCount an old or new client can report validates for every round-carrying event", () => {
  for (const roundCount of [3, 5, 10, 15]) {
    assert.equal(validateEventParams("mp_room_created", { roundCount, difficulty: "mixed" }).valid, true, `mp_room_created ${roundCount}`);
    assert.equal(validateEventParams("mp_game_started", { playerCount: 3, roundCount, difficulty: "mixed" }).valid, true, `mp_game_started ${roundCount}`);
    assert.equal(validateEventParams("mp_game_finished", { playerCount: 3, roundCount }).valid, true, `mp_game_finished ${roundCount}`);
    assert.equal(validateEventParams("pp_game_started", { playerCount: 2, roundCount, difficulty: "easy" }).valid, true, `pp_game_started ${roundCount}`);
    assert.equal(validateEventParams("pp_game_finished", { playerCount: 2, roundCount }).valid, true, `pp_game_finished ${roundCount}`);
    assert.equal(validateEventParams("pp_abandoned", { roundIndex: roundCount - 1, playerCount: 2, roundCount }).valid, true, `pp_abandoned ${roundCount}`);
  }
  for (const roundCount of [0, 1, 2, 4, 20]) assert.equal(validateEventParams("mp_game_finished", { playerCount: 2, roundCount }).valid, false);
});

// --------------------------------------- K5: mpDailyOrdinal - mirror of the PlayTogetherRoom effect ----

type Snap = { phase: string; roundIndex: number; roomCode: string; gameSerial: number; rounds: number; players: number };
const snap = (phase: string, roundIndex: number, gameSerial = 1, roomCode = "ABC234", rounds = 5): Snap => ({ phase, roundIndex, roomCode, gameSerial, rounds, players: 2 });

/** Mirrors the "analytics" useEffect in PlayTogetherRoom.tsx (reportedStartRef / joinedFinishedRef handling only). One instance = one mount. */
class RoomAnalyticsMirror {
  reportedStart = false;
  joinedFinished: boolean | null = null;
  events: Array<Record<string, unknown>> = [];
  private now: () => Date;
  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }
  onSnapshot(s: Snap) {
    if (this.joinedFinished === null) this.joinedFinished = s.phase === "FINAL_RESULTS" || s.phase === "ABANDONED";
    if (s.phase === "LOBBY") {
      this.joinedFinished = false;
      this.reportedStart = false;
      return;
    }
    if (!this.reportedStart && s.roundIndex >= 0) {
      this.reportedStart = true;
      const ordinal = this.joinedFinished ? null : recordMultiplayerGame(multiplayerGameKey(s.roomCode, s.gameSerial), this.now());
      this.events.push({ playerCount: s.players, roundCount: s.rounds, difficulty: "mixed", ...(ordinal === null ? {} : { mpDailyOrdinal: ordinal }) });
    }
  }
  get ordinals() {
    return this.events.map((e) => e.mpDailyOrdinal ?? null);
  }
}

test("source guard: the real effect still contains the lines the mirror is built from", () => {
  const src = read("src/components/multiplayer/PlayTogetherRoom.tsx");
  for (const needle of [
    'if (joinedFinishedRef.current === null) joinedFinishedRef.current = snapshot.phase === "FINAL_RESULTS" || snapshot.phase === "ABANDONED";',
    'if (snapshot.phase === "LOBBY") {',
    "joinedFinishedRef.current = false;",
    "if (!reportedStartRef.current && snapshot.roundIndex >= 0) {",
    "const ordinal = joinedFinishedRef.current ? null : recordMultiplayerGame(multiplayerGameKey(snapshot.roomCode, snapshot.gameSerial));",
    "...(ordinal === null ? {} : { mpDailyOrdinal: ordinal }),",
  ]) {
    assert.ok(src.includes(needle), `PlayTogetherRoom.tsx no longer contains: ${needle}`);
  }
});

test("host or guest: one increment per game; renders and repeated snapshots of the same game never increment", () => {
  const m = new RoomAnalyticsMirror();
  m.onSnapshot(snap("LOBBY", -1));
  m.onSnapshot(snap("COUNTDOWN", 0));
  for (let i = 0; i < 5; i++) m.onSnapshot(snap("DRAWING", 0));
  m.onSnapshot(snap("ROUND_RESULTS", 0));
  m.onSnapshot(snap("DRAWING", 1));
  m.onSnapshot(snap("FINAL_RESULTS", 4));
  assert.deepEqual(m.ordinals, [1]);
  assert.equal(m.events.length, 1, "mp_game_started itself fires once per mount per game");
});

test("remount of a counted game (navigate away and back / Return to Game / process kill and resume): event still fires, ordinal omitted", () => {
  const first = new RoomAnalyticsMirror();
  first.onSnapshot(snap("LOBBY", -1));
  first.onSnapshot(snap("DRAWING", 0));
  assert.deepEqual(first.ordinals, [1]);

  const remount = new RoomAnalyticsMirror();
  remount.onSnapshot(snap("DRAWING", 2));
  assert.deepEqual(remount.ordinals, [null], "same roomCode:gameSerial -> no second increment");
  assert.equal(remount.events.length, 1, "the pre-existing re-fire of mp_game_started on remount is unchanged (3-key payload)");
  assert.equal(validateEventParams("mp_game_started", remount.events[0]).valid, true, "and that 3-key payload is valid");
});

test("a reconnect on the same mount changes nothing (no snapshot-driven re-count)", () => {
  const m = new RoomAnalyticsMirror();
  m.onSnapshot(snap("DRAWING", 0));
  m.onSnapshot(snap("DRAWING", 0));
  m.onSnapshot(snap("ROUND_RESULTS", 0));
  assert.deepEqual(m.ordinals, [1]);
});

test("resume into an already finished or abandoned game: never consumes an ordinal", () => {
  for (const phase of ["FINAL_RESULTS", "ABANDONED"]) {
    storage.clear();
    const m = new RoomAnalyticsMirror();
    m.onSnapshot(snap(phase, 4));
    assert.deepEqual(m.ordinals, [null], phase);
    assert.equal(storage.map.size, 0, "nothing was written");
  }
});

test("a guest joining the lobby of a room whose host later starts counts exactly once", () => {
  const guest = new RoomAnalyticsMirror();
  guest.onSnapshot(snap("LOBBY", -1));
  guest.onSnapshot(snap("LOBBY", -1));
  guest.onSnapshot(snap("COUNTDOWN", 0));
  assert.deepEqual(guest.ordinals, [1]);
});

test("gameSerial change in the same room (new game) and rematch: the facts", () => {
  // The Worker bumps gameSerial on every Start (worker/roomDO.ts handleStart) and NOT on rematch
  // (handleRematch returns the room to LOBBY). On the client a LOBBY snapshot re-arms the start report, and
  // the next Start arrives with serial + 1. So rematch -> Start is a NEW key and DOES increment.
  const m = new RoomAnalyticsMirror();
  m.onSnapshot(snap("LOBBY", -1, 0));
  m.onSnapshot(snap("DRAWING", 0, 1));
  m.onSnapshot(snap("FINAL_RESULTS", 4, 1));
  m.onSnapshot(snap("FINAL_RESULTS", 4, 1)); // repeat of the final snapshot
  assert.deepEqual(m.ordinals, [1]);
  m.onSnapshot(snap("LOBBY", -1, 1)); // host pressed Rematch: back in the lobby, serial unchanged
  assert.deepEqual(m.ordinals, [1], "the rematch itself (lobby) does not count");
  m.onSnapshot(snap("COUNTDOWN", 0, 2)); // host pressed Start: serial 2
  assert.deepEqual(m.ordinals, [1, 2], "the rematch game, once actually started, is the player's 2nd game");
  m.onSnapshot(snap("DRAWING", 0, 2));
  assert.deepEqual(m.ordinals, [1, 2]);
});

test("a game of another room in between is a new game; the last counted key only protects against an immediate repeat", () => {
  const a = new RoomAnalyticsMirror();
  a.onSnapshot(snap("DRAWING", 0, 1, "AAA222"));
  const b = new RoomAnalyticsMirror();
  b.onSnapshot(snap("DRAWING", 0, 1, "BBB333"));
  assert.deepEqual([...a.ordinals, ...b.ordinals], [1, 2]);
  // Documented limit: only the LAST key is kept, so remounting game A after game B was counted would count again.
  // Not reachable in the product (a device sits in one room; leaving clears the resume breadcrumb).
  const aAgain = new RoomAnalyticsMirror();
  aAgain.onSnapshot(snap("DRAWING", 0, 1, "AAA222"));
  assert.deepEqual(aAgain.ordinals, [3]);
});

test("local midnight: a game resumed across midnight is the same game; the next game of the new day restarts at 1", () => {
  const before = () => new Date(2026, 9, 3, 23, 59);
  const after = () => new Date(2026, 9, 4, 0, 5);
  const evening = new RoomAnalyticsMirror(before);
  evening.onSnapshot(snap("DRAWING", 0, 1, "NIGHT1"));
  const resumed = new RoomAnalyticsMirror(after);
  resumed.onSnapshot(snap("DRAWING", 3, 1, "NIGHT1"));
  const next = new RoomAnalyticsMirror(after);
  next.onSnapshot(snap("DRAWING", 0, 1, "NEWDAY"));
  assert.deepEqual([evening.ordinals[0], resumed.ordinals[0], next.ordinals[0]], [1, null, 1]);
  assert.equal(localDayKey(after()), "2026-10-04");
});

test("7+ saturates: the 8th and 20th game of the day report 7, stored count never exceeds 7", () => {
  const out: Array<number | null> = [];
  for (let i = 1; i <= 20; i++) {
    const m = new RoomAnalyticsMirror();
    m.onSnapshot(snap("DRAWING", 0, 1, `R${String(i).padStart(5, "0")}`));
    out.push(m.ordinals[0] as number | null);
  }
  assert.deepEqual(out.slice(0, 9), [1, 2, 3, 4, 5, 6, 7, 7, 7]);
  assert.ok(out.every((v) => v !== null && v >= 1 && v <= 7));
  assert.equal(JSON.parse(storage.map.get("cydi.mp.dailyOrdinal.v1")!).count, 7);
  for (const v of out) assert.equal(validateEventParams("mp_game_started", { playerCount: 2, roundCount: 5, difficulty: "mixed", mpDailyOrdinal: v }).valid, true);
});

test("corrupt, hostile or unavailable storage: never throws, never sends a wrong number", () => {
  const key = "cydi.mp.dailyOrdinal.v1";
  for (const raw of ["not json", "null", "[]", "{}", '{"day":"x","count":1,"lastKey":"a"}', '{"day":"2026-10-03","count":-1,"lastKey":"a"}', '{"day":"2026-10-03","count":1.5,"lastKey":"a"}', '{"day":"2026-10-03","count":1,"lastKey":' + JSON.stringify("k".repeat(200)) + "}", '{"day":"2026-10-03","count":999,"lastKey":"a"}']) {
    storage.clear();
    storage.setItem(key, raw);
    const m = new RoomAnalyticsMirror(() => new Date(2026, 9, 3, 12));
    m.onSnapshot(snap("DRAWING", 0, 1, "CORR01"));
    const v = m.ordinals[0] as number | null;
    assert.ok(v !== null && v >= 1 && v <= 7, `${raw} -> ${v}`);
  }
  storage.clear();
  storage.throwOnGet = true;
  const noRead = new RoomAnalyticsMirror();
  noRead.onSnapshot(snap("DRAWING", 0));
  assert.deepEqual(noRead.ordinals, [null], "unreadable storage omits the field, the event still fires");
  assert.equal(noRead.events.length, 1);
  storage.clear();
  storage.throwOnSet = true;
  const noWrite = new RoomAnalyticsMirror();
  noWrite.onSnapshot(snap("DRAWING", 0));
  assert.deepEqual(noWrite.ordinals, [null]);
});

test("the roomCode:gameSerial key stays on the device: not in the event, not accepted by the schema, not read or written anywhere else", () => {
  const m = new RoomAnalyticsMirror();
  m.onSnapshot(snap("DRAWING", 0, 1, "SECRT7"));
  const wire = JSON.stringify(m.events);
  assert.ok(!wire.includes("SECRT7") && !wire.includes("lastKey") && !wire.includes("SECRT7:"), wire);
  assert.deepEqual(Object.keys(m.events[0]).sort(), ["difficulty", "mpDailyOrdinal", "playerCount", "roundCount"]);
  const base = { playerCount: 2, roundCount: 5, difficulty: "mixed" };
  for (const extra of [{ mpDailyOrdinal: 1, gameKey: "SECRT7:1" }, { mpDailyOrdinal: 1, roomCode: "SECRT7" }, { gameKey: "SECRT7:1" }]) {
    assert.equal(validateEventParams("mp_game_started", { ...base, ...extra }).valid, false, JSON.stringify(extra));
  }
  for (const bad of [0, 8, -1, 1.5, "1", null, true]) assert.equal(validateEventParams("mp_game_started", { ...base, mpDailyOrdinal: bad }).valid, false, String(bad));
  // The only importer of the store is the room component, and only the ordinal is passed to trackEvent.
  const users = ["src/screens/PlayTogetherScreen.tsx", "src/services/analytics.ts", "src/services/saveStore.ts", "src/services/saveTransfer.ts"].map((f) => read(f));
  for (const u of users) assert.doesNotMatch(u, /dailyOrdinal|multiplayerGameKey|lastKey/);
  const room = read("src/components/multiplayer/PlayTogetherRoom.tsx");
  const call = room.slice(room.indexOf('trackEvent("mp_game_started"'), room.indexOf('trackEvent("mp_game_started"') + 260);
  assert.match(call, /playerCount[\s\S]*roundCount[\s\S]*difficulty[\s\S]*mpDailyOrdinal: ordinal/);
  assert.doesNotMatch(call, /roomCode|gameSerial|multiplayerGameKey/);
});
