/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// RoomDO behaviour tests: state machine, permissions, deadlines, scoring and
// hostile payloads.
//
// The DO is exercised through a hand-rolled DurableObjectState/WebSocket
// double rather than a real workerd instance. That covers everything this
// object actually does - storage get/put/deleteAll, setAlarm/deleteAlarm,
// getWebSockets, and per-socket attachments - and keeps the suite inside the
// project's plain `node --test` runner. The one path it cannot exercise is the
// 101 upgrade itself (WebSocketPair is a runtime primitive), which the Stage 2
// spike already proved end-to-end against real workerd on Chrome and Android.
import assert from "node:assert/strict";
import test from "node:test";
import { RoomDO } from "./roomDO.ts";
import { getShapeById } from "../src/engine/shapeLibrary.ts";
import { resampleAllSegments, splitIntoSegments } from "../src/engine/normalizePath.ts";
import { MP_LIMITS, MP_TIMINGS, toWirePath } from "../src/multiplayer/protocol.ts";
import type { RoomSnapshot, ServerFrame } from "../src/multiplayer/protocol.ts";

// ------------------------------------------------------------------ doubles ----

class FakeWS {
  sent: ServerFrame[] = [];
  attachment: unknown = null;
  closed = false;
  send(raw: string) {
    this.sent.push(JSON.parse(raw) as ServerFrame);
  }
  serializeAttachment(value: unknown) {
    this.attachment = structuredClone(value);
  }
  deserializeAttachment() {
    return this.attachment;
  }
  close() {
    this.closed = true;
  }
  /** Most recent frame of a given type, which is what assertions almost always want. */
  last<T extends ServerFrame["type"]>(type: T): Extract<ServerFrame, { type: T }> | undefined {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      if (this.sent[i].type === type) return this.sent[i] as Extract<ServerFrame, { type: T }>;
    }
    return undefined;
  }
  snapshot(): RoomSnapshot {
    const s = this.last("snapshot");
    assert.ok(s, "expected a snapshot");
    return s;
  }
}

class FakeStorage {
  map = new Map<string, unknown>();
  alarm: number | null = null;
  // Clone on both sides so the DO can never accidentally rely on a shared
  // object reference surviving a save/load, the way real serialization can't.
  async get<T>(key: string): Promise<T | undefined> {
    const v = this.map.get(key);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }
  async put(key: string, value: unknown) {
    this.map.set(key, structuredClone(value));
  }
  async deleteAll() {
    this.map.clear();
  }
  async setAlarm(time: number) {
    this.alarm = time;
  }
  async deleteAlarm() {
    this.alarm = null;
  }
}

class FakeState {
  storage = new FakeStorage();
  sockets: FakeWS[] = [];
  acceptWebSocket(ws: FakeWS) {
    this.sockets.push(ws);
  }
  getWebSockets(): FakeWS[] {
    return this.sockets.filter((w) => !w.closed);
  }
}

// ---------------------------------------------------------------- time control ----

let clock = 1_700_000_000_000;
const realNow = Date.now;
function setClock(t: number) {
  clock = t;
}
function advance(ms: number) {
  clock += ms;
}
test.before(() => {
  Date.now = () => clock;
});
test.after(() => {
  Date.now = realNow;
});

// ------------------------------------------------------------------ harness ----

const ROOM = "TEST77";

type Harness = {
  room: RoomDO;
  state: FakeState;
  connect(): FakeWS;
  join(ws: FakeWS, nickname: string, playerId: string, playerToken?: string): Promise<void>;
  send(ws: FakeWS, frame: unknown): Promise<void>;
  fireAlarm(): Promise<void>;
};

async function makeRoom(): Promise<Harness> {
  setClock(1_700_000_000_000);
  const state = new FakeState();
  const room = new RoomDO(state as unknown as DurableObjectState);
  const res = await room.fetch(new Request(`https://room.internal/create?code=${ROOM}`, { method: "POST" }));
  assert.equal(res.status, 200);

  const send = async (ws: FakeWS, frame: unknown) => {
    await room.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(frame));
  };

  return {
    room,
    state,
    connect() {
      const ws = new FakeWS();
      state.acceptWebSocket(ws);
      // Mirrors what fetch("/ws") does for a fresh, not-yet-joined socket.
      ws.serializeAttachment({ seatId: null, rateWindowStart: Date.now(), rateCount: 0 });
      return ws;
    },
    join: async (ws, nickname, playerId, playerToken) => {
      await send(ws, { type: "join", nickname, playerId, playerToken });
    },
    send,
    fireAlarm: async () => {
      await room.alarm();
    },
  };
}

/** Host + one guest, both joined and in the lobby. */
async function makeLobby() {
  const h = await makeRoom();
  const host = h.connect();
  const guest = h.connect();
  await h.join(host, "Host", "player-host");
  await h.join(guest, "Guest", "player-guest");
  return { ...h, host, guest };
}

/** COUNTDOWN -> SHOW_SHAPE -> DRAWING, for a round that has just been started. */
async function advanceToDrawing(h: Awaited<ReturnType<typeof makeLobby>>) {
  advance(MP_TIMINGS.COUNTDOWN_MS);
  await h.fireAlarm();
  advance(MP_TIMINGS.SHOW_SHAPE_MS);
  await h.fireAlarm();
  assert.equal(h.host.snapshot().phase, "DRAWING");
}

/**
 * Drives a started game to the DRAWING phase of round 0.
 *
 * `rounds` must be one of the offered options - the server rejects anything
 * else, and an earlier version of this helper silently played 5-round games
 * while the test thought it had asked for 1.
 */
async function makeDrawing(rounds: 5 | 10 | 15 = 5) {
  const h = await makeLobby();
  await h.send(h.host, { type: "configure", rounds, difficulty: "mixed" });
  assert.equal(h.host.last("error"), undefined, "configure was rejected");
  assert.equal(h.host.snapshot().rounds, rounds);
  await h.send(h.host, { type: "start" });
  await advanceToDrawing(h);
  return h;
}

/** Plays the round currently in DRAWING to completion, and returns the phase it lands in. */
async function playRound(h: Awaited<ReturnType<typeof makeLobby>>, roundIndex: number) {
  const shapeId = h.host.snapshot().shapeId!;
  await h.send(h.host, { type: "submit", roundIndex, path: perfectAttempt(shapeId) });
  await h.send(h.guest, { type: "submit", roundIndex, path: poorAttempt() });
  return h.host.snapshot().phase;
}

/** A near-perfect attempt: the target's own geometry, resampled to the wire budget exactly as the client will. */
function perfectAttempt(shapeId: string, canvas = 320) {
  const shape = getShapeById(shapeId);
  assert.ok(shape, `unknown shape ${shapeId}`);
  const target = shape.generate(canvas);
  const segs = splitIntoSegments(target.points, target.breaks).filter((s) => s.length > 1);
  const { points, segmentStarts } = resampleAllSegments(segs, 200);
  return toWirePath({ points, canvasWidth: canvas, canvasHeight: canvas, breaks: segmentStarts });
}

/** A deliberately wrong attempt - a short straight line, which matches almost nothing. */
function poorAttempt(canvas = 320) {
  return toWirePath({
    points: Array.from({ length: 20 }, (_, i) => ({ x: 10 + i, y: 10, t: i })),
    canvasWidth: canvas,
    canvasHeight: canvas,
    breaks: [],
  });
}

// ------------------------------------------------------------------- joining ----

test("the first player to join becomes host", async () => {
  const h = await makeRoom();
  const ws = h.connect();
  await h.join(ws, "Lior", "p1");

  const joined = ws.last("joined");
  assert.ok(joined);
  assert.ok(joined.playerToken.length > 0, "the server issues a token");
  assert.equal(ws.snapshot().you?.isHost, true);
});

test("later players are not host", async () => {
  const h = await makeLobby();
  assert.equal(h.host.snapshot().you?.isHost, true);
  assert.equal(h.guest.snapshot().you?.isHost, false);
});

test("a room fills at MAX_PLAYERS and refuses the next join", async () => {
  const h = await makeRoom();
  for (let i = 0; i < MP_LIMITS.MAX_PLAYERS; i++) {
    const ws = h.connect();
    await h.join(ws, `P${i}`, `player-${i}`);
    assert.equal(ws.last("error"), undefined, `player ${i} should have been admitted`);
  }
  const extra = h.connect();
  await h.join(extra, "TooMany", "player-extra");
  assert.equal(extra.last("error")?.code, "room_full");
});

test("duplicate nicknames are disambiguated so the leaderboard never shows two identical rows", async () => {
  const h = await makeRoom();
  const a = h.connect();
  const b = h.connect();
  await h.join(a, "Dana", "p1");
  await h.join(b, "Dana", "p2");
  const names = b.snapshot().players.map((p) => p.nickname);
  assert.equal(new Set(names).size, names.length, `expected distinct names, got ${names.join(", ")}`);
});

test("a player's own playerId is never echoed to anyone", async () => {
  const h = await makeLobby();
  const wire = JSON.stringify(h.guest.sent);
  assert.ok(!wire.includes("player-host"), "another player's id leaked into a frame");
  assert.ok(!wire.includes("player-guest"), "a player's own id is not needed on the wire either");
});

// --------------------------------------------------------------- permissions ----

test("a non-host cannot start, configure, advance or rematch", async () => {
  const h = await makeLobby();
  for (const frame of [
    { type: "start" },
    { type: "configure", rounds: 10, difficulty: "easy" },
    { type: "next" },
    { type: "rematch" },
  ]) {
    h.guest.sent.length = 0;
    await h.send(h.guest, frame);
    assert.equal(h.guest.last("error")?.code, "not_host", `${frame.type} should be host-only`);
  }
});

test("an unjoined socket cannot do anything but join and ping", async () => {
  const h = await makeRoom();
  const stranger = h.connect();
  await h.send(stranger, { type: "start" });
  assert.equal(stranger.last("error")?.code, "not_joined");

  await h.send(stranger, { type: "submit", roundIndex: 0, path: poorAttempt() });
  assert.equal(stranger.last("error")?.code, "not_joined");

  await h.send(stranger, { type: "ping", clientSentAt: 123 });
  assert.equal(stranger.last("pong")?.clientSentAt, 123, "ping works before joining, for clock sync");
});

test("starting needs at least two players", async () => {
  const h = await makeRoom();
  const host = h.connect();
  await h.join(host, "Solo", "p1");
  await h.send(host, { type: "start" });
  assert.equal(host.last("error")?.code, "not_enough_players");
  assert.equal(host.snapshot().phase, "LOBBY");
});

// ------------------------------------------------------------- state machine ----

test("the phase sequence is LOBBY -> COUNTDOWN -> SHOW_SHAPE -> DRAWING -> ROUND_RESULTS", async () => {
  const h = await makeLobby();
  assert.equal(h.host.snapshot().phase, "LOBBY");

  await h.send(h.host, { type: "start" });
  assert.equal(h.host.snapshot().phase, "COUNTDOWN");

  advance(MP_TIMINGS.COUNTDOWN_MS);
  await h.fireAlarm();
  assert.equal(h.host.snapshot().phase, "SHOW_SHAPE");

  advance(MP_TIMINGS.SHOW_SHAPE_MS);
  await h.fireAlarm();
  assert.equal(h.host.snapshot().phase, "DRAWING");

  advance(MP_TIMINGS.DRAWING_MS + MP_LIMITS.SUBMIT_GRACE_MS);
  await h.fireAlarm();
  assert.equal(h.host.snapshot().phase, "ROUND_RESULTS");
});

test("the last round ends in FINAL_RESULTS, with the highest total as champion", async () => {
  const rounds = 5;
  const h = await makeDrawing(rounds);

  for (let i = 0; i < rounds; i++) {
    const phase = await playRound(h, i);
    if (i < rounds - 1) {
      assert.equal(phase, "ROUND_RESULTS", `round ${i} should not end the game`);
      await h.send(h.host, { type: "next" });
      await advanceToDrawing(h);
    } else {
      assert.equal(phase, "FINAL_RESULTS", "the last round ends the game");
    }
  }

  const snap = h.host.snapshot();
  assert.equal(snap.roundIndex, rounds - 1);
  const best = [...snap.players].sort((a, b) => b.totalScore - a.totalScore)[0];
  assert.equal(snap.championSeatId, best.seatId, "the champion is whoever has the highest total");
  assert.equal(best.nickname, "Host", "the accurate player wins");
});

test("the host advances to the next round, and roundIndex increments", async () => {
  const h = await makeDrawing(5);
  advance(MP_TIMINGS.DRAWING_MS + MP_LIMITS.SUBMIT_GRACE_MS);
  await h.fireAlarm();
  assert.equal(h.host.snapshot().roundIndex, 0);

  await h.send(h.host, { type: "next" });
  const snap = h.host.snapshot();
  assert.equal(snap.phase, "COUNTDOWN");
  assert.equal(snap.roundIndex, 1);
});

test("rematch returns to the lobby with scores cleared", async () => {
  const rounds = 5;
  const h = await makeDrawing(rounds);
  for (let i = 0; i < rounds; i++) {
    await playRound(h, i);
    if (i < rounds - 1) {
      await h.send(h.host, { type: "next" });
      await advanceToDrawing(h);
    }
  }
  assert.equal(h.host.snapshot().phase, "FINAL_RESULTS");
  assert.ok(h.host.snapshot().players.some((p) => p.totalScore > 0));

  await h.send(h.host, { type: "rematch" });
  const snap = h.host.snapshot();
  assert.equal(snap.phase, "LOBBY");
  assert.equal(snap.roundIndex, -1);
  assert.equal(snap.championSeatId, null);
  assert.ok(snap.players.every((p) => p.totalScore === 0), "scores reset");
  assert.equal(snap.players.length, 2, "players stay in the room");
});

test("a round ends early once every connected player has submitted", async () => {
  const h = await makeDrawing(5);
  const shapeId = h.host.snapshot().shapeId!;
  await h.send(h.host, { type: "submit", roundIndex: 0, path: perfectAttempt(shapeId) });
  assert.equal(h.host.snapshot().phase, "DRAWING", "still waiting on the guest");

  await h.send(h.guest, { type: "submit", roundIndex: 0, path: poorAttempt() });
  assert.equal(h.host.snapshot().phase, "ROUND_RESULTS", "no reason to burn the rest of the clock");
});

test("the shape is withheld until SHOW_SHAPE", async () => {
  const h = await makeLobby();
  assert.equal(h.host.snapshot().shapeId, null, "lobby");

  await h.send(h.host, { type: "start" });
  assert.equal(h.host.snapshot().shapeId, null, "countdown must not leak the shape");

  advance(MP_TIMINGS.COUNTDOWN_MS);
  await h.fireAlarm();
  assert.ok(h.host.snapshot().shapeId, "revealed at SHOW_SHAPE");
});

// ----------------------------------------------------------------- deadlines ----

test("timed phases carry an absolute server deadline; untimed ones carry none", async () => {
  const h = await makeLobby();
  assert.equal(h.host.snapshot().phaseEndsAt, null, "the lobby never expires");

  await h.send(h.host, { type: "start" });
  const snap = h.host.snapshot();
  assert.equal(snap.phaseEndsAt, snap.phaseStartsAt + MP_TIMINGS.COUNTDOWN_MS);
  assert.equal(snap.serverNow, clock, "snapshots carry the server clock for offset measurement");
});

test("the DRAWING alarm is set past the deadline by exactly the submit grace", async () => {
  const h = await makeDrawing();
  const snap = h.host.snapshot();
  assert.equal(h.state.storage.alarm, snap.phaseEndsAt! + MP_LIMITS.SUBMIT_GRACE_MS);
});

test("non-drawing phases schedule their alarm on the deadline itself", async () => {
  const h = await makeLobby();
  await h.send(h.host, { type: "start" });
  assert.equal(h.state.storage.alarm, h.host.snapshot().phaseEndsAt);
});

test("an alarm that fires early does not advance the phase", async () => {
  const h = await makeDrawing();
  advance(1000);
  await h.fireAlarm();
  assert.equal(h.host.snapshot().phase, "DRAWING", "the deadline has not passed yet");
});

// ------------------------------------------------------------------- scoring ----

test("an accurate trace scores far higher than a wrong one", async () => {
  const h = await makeDrawing();
  const shapeId = h.host.snapshot().shapeId!;

  await h.send(h.host, { type: "submit", roundIndex: 0, path: perfectAttempt(shapeId) });
  await h.send(h.guest, { type: "submit", roundIndex: 0, path: poorAttempt() });

  const players = h.host.snapshot().players;
  const good = players.find((p) => p.nickname === "Host")!;
  const bad = players.find((p) => p.nickname === "Guest")!;
  assert.ok(good.roundAccuracy! > 80, `expected a high accuracy, got ${good.roundAccuracy}`);
  assert.ok(bad.roundAccuracy! < good.roundAccuracy!, "a straight line must not beat a real trace");
});

test("the score is 75% accuracy + 25% speed, computed server-side", async () => {
  const h = await makeDrawing();
  const shapeId = h.host.snapshot().shapeId!;

  // Submit exactly halfway through the window -> speed should be 50, whatever
  // the window happens to be.
  advance(MP_TIMINGS.DRAWING_MS / 2);
  await h.send(h.host, { type: "submit", roundIndex: 0, path: perfectAttempt(shapeId) });

  const me = h.host.snapshot().players.find((p) => p.nickname === "Host")!;
  assert.equal(me.roundSpeed, 50, "speed comes from the server clock, not the client");
  assert.equal(me.roundScore, Math.round(me.roundAccuracy! * 0.75 + 50 * 0.25));
});

test("the three published numbers always add up, even at a fractional speed", async () => {
  // Regression: speed used to be rounded for display but combined raw, so a
  // raw 99.7 showed as 100 while contributing 24.9 - and the total came out a
  // point below what the visible accuracy and speed implied.
  const h = await makeDrawing();
  const shapeId = h.host.snapshot().shapeId!;
  advance(97); // a deliberately awkward offset -> speed is not a whole number
  await h.send(h.host, { type: "submit", roundIndex: 0, path: perfectAttempt(shapeId) });

  const me = h.host.snapshot().players.find((p) => p.nickname === "Host")!;
  assert.equal(Number.isInteger(me.roundSpeed!), true);
  assert.equal(me.roundScore, Math.round(me.roundAccuracy! * 0.75 + me.roundSpeed! * 0.25));
});

test("a submit inside the grace window still scores accuracy but earns zero speed", async () => {
  const h = await makeDrawing();
  const shapeId = h.host.snapshot().shapeId!;

  advance(MP_TIMINGS.DRAWING_MS + 500); // past the deadline, inside the grace
  await h.send(h.host, { type: "submit", roundIndex: 0, path: perfectAttempt(shapeId) });

  const me = h.host.snapshot().players.find((p) => p.nickname === "Host")!;
  assert.equal(me.roundSpeed, 0, "the grace is for network flight time, not extra thinking time");
  assert.ok(me.roundAccuracy! > 80, "the drawing itself still counts");
});

test("a submit past the grace window is rejected outright", async () => {
  const h = await makeDrawing();
  const shapeId = h.host.snapshot().shapeId!;

  advance(MP_TIMINGS.DRAWING_MS + MP_LIMITS.SUBMIT_GRACE_MS + 1);
  await h.send(h.host, { type: "submit", roundIndex: 0, path: perfectAttempt(shapeId) });
  assert.equal(h.host.last("error")?.code, "too_late");
});

test("a player who never submits scores zero for the round but stays in the game", async () => {
  const h = await makeDrawing();
  await h.send(h.host, { type: "submit", roundIndex: 0, path: perfectAttempt(h.host.snapshot().shapeId!) });
  advance(MP_TIMINGS.DRAWING_MS + MP_LIMITS.SUBMIT_GRACE_MS);
  await h.fireAlarm();

  const guest = h.host.snapshot().players.find((p) => p.nickname === "Guest")!;
  assert.equal(guest.totalScore, 0);
  assert.equal(guest.roundScore, null);
  assert.equal(h.host.snapshot().players.length, 2);
});

test("a total only moves when the round is scored, not when a single player submits", async () => {
  const h = await makeDrawing(5);
  await playRound(h, 0);
  const afterOne = h.host.snapshot().players.find((p) => p.nickname === "Host")!.totalScore;
  assert.ok(afterOne > 0);

  await h.send(h.host, { type: "next" });
  await advanceToDrawing(h);

  // Only the host has submitted, so round two is still open.
  await h.send(h.host, { type: "submit", roundIndex: 1, path: perfectAttempt(h.host.snapshot().shapeId!) });
  const mid = h.host.snapshot().players.find((p) => p.nickname === "Host")!;
  assert.equal(mid.totalScore, afterOne, "the total does not move until the round closes");
  assert.ok(mid.roundScore! > 0, "but the pending round score is visible");

  await h.send(h.guest, { type: "submit", roundIndex: 1, path: poorAttempt() });
  const afterTwo = h.host.snapshot().players.find((p) => p.nickname === "Host")!.totalScore;
  assert.ok(afterTwo > afterOne, "round two adds to the total once it closes");
});

test("the round winner is the highest score, ties broken by who submitted first", async () => {
  const h = await makeDrawing();
  const shapeId = h.host.snapshot().shapeId!;
  await h.send(h.host, { type: "submit", roundIndex: 0, path: perfectAttempt(shapeId) });
  advance(2000);
  await h.send(h.guest, { type: "submit", roundIndex: 0, path: poorAttempt() });

  const snap = h.host.snapshot();
  const hostSeat = snap.players.find((p) => p.nickname === "Host")!.seatId;
  assert.equal(snap.lastRound?.winnerSeatId, hostSeat);
  assert.equal(snap.lastRound?.roundIndex, 0);
  assert.equal(snap.lastRound?.shapeId, shapeId);
});

test("a round nobody submitted to has no winner", async () => {
  const h = await makeDrawing();
  advance(MP_TIMINGS.DRAWING_MS + MP_LIMITS.SUBMIT_GRACE_MS);
  await h.fireAlarm();
  assert.equal(h.host.snapshot().lastRound?.winnerSeatId, null);
});

// ------------------------------------------------------------ invalid submits ----

test("submitting twice in one round is refused", async () => {
  const h = await makeDrawing();
  const shapeId = h.host.snapshot().shapeId!;
  await h.send(h.host, { type: "submit", roundIndex: 0, path: perfectAttempt(shapeId) });
  await h.send(h.host, { type: "submit", roundIndex: 0, path: perfectAttempt(shapeId) });
  assert.equal(h.host.last("error")?.code, "already_submitted");
});

test("a submit for the wrong round is refused rather than scored against the wrong shape", async () => {
  const h = await makeDrawing();
  await h.send(h.host, { type: "submit", roundIndex: 3, path: perfectAttempt(h.host.snapshot().shapeId!) });
  assert.equal(h.host.last("error")?.code, "too_late");
});

test("a submit outside DRAWING is refused", async () => {
  const h = await makeLobby();
  await h.send(h.host, { type: "submit", roundIndex: 0, path: poorAttempt() });
  assert.equal(h.host.last("error")?.code, "wrong_phase");
});

test("malformed frames are rejected without disturbing the room", async () => {
  const h = await makeDrawing();
  const before = h.host.snapshot().phase;

  for (const bad of [
    { type: "submit", roundIndex: 0, path: { p: [], w: 320, h: 320 } },
    { type: "submit", roundIndex: 0, path: { p: [[1, 2]], w: 320, h: 320 } },
    { type: "submit", roundIndex: 0, path: { p: Array.from({ length: 300 }, () => [1, 1]), w: 320, h: 320 } },
    { type: "submit", roundIndex: 0, path: { p: [[Number.NaN, 1], [2, 2]], w: 320, h: 320 } },
    { type: "submit", roundIndex: 0, path: { p: [[1, 1], [2, 2]], w: 0, h: 320 } },
    { type: "submit", roundIndex: 0, path: { p: [[1, 1], [2, 2], [3, 3]], w: 320, h: 320, b: [0] } },
    { type: "totally-made-up" },
    { nope: true },
  ]) {
    h.host.sent.length = 0;
    await h.send(h.host, bad);
    assert.equal(h.host.last("error")?.code, "bad_frame", `expected rejection of ${JSON.stringify(bad).slice(0, 60)}`);
  }

  // Read the phase from the guest, whose frame log was never cleared.
  assert.equal(h.guest.snapshot().phase, before, "a barrage of junk frames must not move the room");
  const fresh = h.connect();
  await h.join(fresh, "Late", "p-late");
  // The room survived the barrage: it is still mid-game, so a new join is
  // refused for phase reasons rather than because the room fell over.
  assert.equal(fresh.last("error")?.code, "wrong_phase");
});

test("non-JSON and oversized frames are rejected", async () => {
  const h = await makeLobby();
  await h.room.webSocketMessage(h.host as unknown as WebSocket, "definitely not json");
  assert.equal(h.host.last("error")?.code, "bad_frame");

  await h.room.webSocketMessage(h.host as unknown as WebSocket, "x".repeat(MP_LIMITS.MAX_FRAME_BYTES + 1));
  assert.equal(h.host.last("error")?.code, "bad_frame");
});

test("a socket that floods is rate limited", async () => {
  const h = await makeLobby();
  h.host.sent.length = 0;
  for (let i = 0; i < 40; i++) await h.send(h.host, { type: "ping" });
  assert.equal(h.host.last("error")?.code, "rate_limited");
});

// ------------------------------------------------------- reconnect & host loss ----

test("a full snapshot is enough to resync - it carries phase, deadlines and standings", async () => {
  const h = await makeDrawing();
  const snap = h.host.snapshot();
  for (const key of ["phase", "phaseStartsAt", "phaseEndsAt", "serverNow", "roundIndex", "rounds", "difficulty", "players", "you"]) {
    assert.ok(key in snap, `snapshot is missing ${key}`);
  }
  assert.equal(snap.players.length, 2);
});

test("a reconnecting player reclaims their seat and score with their token", async () => {
  const h = await makeDrawing();
  const token = h.host.last("joined")!.playerToken;
  const seatId = h.host.snapshot().you!.seatId;
  await h.send(h.host, { type: "submit", roundIndex: 0, path: perfectAttempt(h.host.snapshot().shapeId!) });
  advance(MP_TIMINGS.DRAWING_MS + MP_LIMITS.SUBMIT_GRACE_MS);
  await h.fireAlarm();
  const scoreBefore = h.host.snapshot().players.find((p) => p.seatId === seatId)!.totalScore;

  h.host.closed = true; // the old socket drops
  await h.room.webSocketClose(h.host as unknown as WebSocket);

  const reconnected = h.connect();
  await h.join(reconnected, "Host", "player-host", token);
  const snap = reconnected.snapshot();
  assert.equal(snap.you?.seatId, seatId, "same seat");
  assert.equal(snap.you?.isHost, true, "still host");
  assert.equal(snap.players.find((p) => p.seatId === seatId)!.totalScore, scoreBefore, "score preserved");
});

test("a wrong or missing token cannot steal a seat mid-game", async () => {
  const h = await makeDrawing();
  const attacker = h.connect();

  await h.join(attacker, "Host", "player-host", "not-the-real-token");
  assert.equal(attacker.last("error")?.code, "wrong_phase", "no token match, so treated as a new mid-game join");

  attacker.sent.length = 0;
  await h.join(attacker, "Host", "player-host");
  assert.equal(attacker.last("error")?.code, "wrong_phase");
  assert.equal(attacker.last("joined"), undefined, "never issued a seat");
});

test("a token only works together with its own playerId", async () => {
  const h = await makeDrawing();
  const hostToken = h.host.last("joined")!.playerToken;
  const attacker = h.connect();
  await h.join(attacker, "Thief", "some-other-id", hostToken);
  assert.equal(attacker.last("joined"), undefined, "a leaked token alone is not enough");
});

test("leaving the lobby frees the seat, and the host role moves on", async () => {
  const h = await makeLobby();
  const hostSeat = h.host.snapshot().you!.seatId;
  h.host.closed = true;
  await h.room.webSocketClose(h.host as unknown as WebSocket);

  const snap = h.guest.snapshot();
  assert.equal(snap.players.length, 1, "a lobby drop-out releases the seat");
  assert.ok(!snap.players.some((p) => p.seatId === hostSeat));
  assert.equal(snap.players[0].isHost, true, "the remaining player is promoted");
});

test("a host who drops mid-game keeps the role for the grace period, then loses it", async () => {
  const h = await makeDrawing();
  const hostSeat = h.host.snapshot().you!.seatId;

  h.host.closed = true;
  await h.room.webSocketClose(h.host as unknown as WebSocket);

  let snap = h.guest.snapshot();
  assert.equal(snap.players.find((p) => p.seatId === hostSeat)!.isHost, true, "still host during the grace");
  assert.equal(snap.players.find((p) => p.seatId === hostSeat)!.connected, false);

  advance(MP_LIMITS.HOST_GRACE_MS + 1);
  await h.fireAlarm();

  snap = h.guest.snapshot();
  assert.equal(snap.players.find((p) => p.seatId === hostSeat)!.isHost, false);
  assert.equal(snap.you?.isHost, true, "the remaining player now hosts");
});

test("a host who reconnects inside the grace period keeps the role", async () => {
  const h = await makeDrawing();
  const token = h.host.last("joined")!.playerToken;
  h.host.closed = true;
  await h.room.webSocketClose(h.host as unknown as WebSocket);

  advance(MP_LIMITS.HOST_GRACE_MS / 2);
  const back = h.connect();
  await h.join(back, "Host", "player-host", token);
  assert.equal(back.snapshot().you?.isHost, true);

  advance(MP_LIMITS.HOST_GRACE_MS);
  await h.fireAlarm();
  assert.equal(back.snapshot().you?.isHost, true, "the grace was cancelled by the reconnect");
});

test("an empty room is disposed of after the idle TTL", async () => {
  const h = await makeLobby();
  h.host.closed = true;
  await h.room.webSocketClose(h.host as unknown as WebSocket);
  h.guest.closed = true;
  await h.room.webSocketClose(h.guest as unknown as WebSocket);

  advance(MP_LIMITS.IDLE_TTL_MS + 1);
  await h.fireAlarm();

  assert.equal(h.state.storage.map.size, 0, "the room is gone");
  const late = h.connect();
  await h.join(late, "Nobody", "p-late");
  assert.equal(late.last("error")?.code, "room_closed");
});

// ---------------------------------------------------------------- room lifecycle ----

test("a room code can only be claimed once", async () => {
  const h = await makeRoom();
  const again = await h.room.fetch(new Request(`https://room.internal/create?code=${ROOM}`, { method: "POST" }));
  assert.equal(again.status, 409, "the Worker retries with a different code on 409");
});

test("/info reports joinability without opening a socket", async () => {
  const h = await makeLobby();
  const res = await h.room.fetch(new Request(`https://room.internal/info?code=${ROOM}`));
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.phase, "LOBBY");
  assert.equal(body.players, 2);
  assert.equal(body.joinable, true);

  await h.send(h.host, { type: "start" });
  const res2 = await h.room.fetch(new Request(`https://room.internal/info?code=${ROOM}`));
  assert.equal(((await res2.json()) as Record<string, unknown>).joinable, false, "a running game is not joinable");
});

test("multiplayer never touches coins, achievements or progression", async () => {
  // Structural: the DO's module graph must not reach any progression module.
  // A future accidental import would fail here rather than in production.
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("./roomDO.ts", import.meta.url), "utf8"));
  const forbidden = ["coinsStore", "achievementsStore", "shapeRoundOutcome", "saveStore", "tutorialStore", "services/ads"];
  for (const name of forbidden) {
    assert.ok(!source.includes(name), `roomDO.ts must not reference ${name}`);
  }
});

// ---------------------------------------------------------- empty submits ----

test("an empty submission is scored as a real zero, not rejected", async () => {
  const h = await makeDrawing();
  await h.send(h.host, { type: "submit", roundIndex: 0, path: null });

  assert.equal(h.host.last("error"), undefined, "an empty canvas at the deadline is a valid result");
  const me = h.host.snapshot().players.find((p) => p.nickname === "Host")!;
  assert.equal(me.roundScore, 0);
  assert.equal(me.roundAccuracy, 0);
  assert.equal(me.roundSpeed, 0, "no speed bonus for drawing nothing");
  assert.equal(me.submitted, true, "they are finished, so the room can stop waiting");
});

test("an empty submission lets the round close early instead of stalling the room", async () => {
  const h = await makeDrawing();
  await h.send(h.host, { type: "submit", roundIndex: 0, path: perfectAttempt(h.host.snapshot().shapeId!) });
  assert.equal(h.host.snapshot().phase, "DRAWING", "still waiting on the guest");

  await h.send(h.guest, { type: "submit", roundIndex: 0, path: null });
  assert.equal(h.host.snapshot().phase, "ROUND_RESULTS", "an empty submit still ends the round");
});

test("an empty submission still counts as this round's submission", async () => {
  const h = await makeDrawing();
  await h.send(h.host, { type: "submit", roundIndex: 0, path: null });
  await h.send(h.host, { type: "submit", roundIndex: 0, path: perfectAttempt(h.host.snapshot().shapeId!) });
  assert.equal(h.host.last("error")?.code, "already_submitted", "no second bite after an empty submit");
});

test("an empty submission never wins a round over a real drawing", async () => {
  const h = await makeDrawing();
  const shapeId = h.host.snapshot().shapeId!;
  await h.send(h.guest, { type: "submit", roundIndex: 0, path: null });
  await h.send(h.host, { type: "submit", roundIndex: 0, path: perfectAttempt(shapeId) });
  const snap = h.host.snapshot();
  const hostSeat = snap.players.find((p) => p.nickname === "Host")!.seatId;
  assert.equal(snap.lastRound?.winnerSeatId, hostSeat);
});

// ------------------------------------------------------- the drawing window ----

test("the drawing phase is exactly the configured 20-second window", async () => {
  const h = await makeDrawing();
  const snap = h.host.snapshot();
  assert.equal(snap.phaseEndsAt! - snap.phaseStartsAt, 20_000);
});

test("speed is scored against the 20-second window on the server", async () => {
  const h = await makeDrawing();
  const shapeId = h.host.snapshot().shapeId!;
  advance(15_000); // three quarters through a 20s window -> 25
  await h.send(h.host, { type: "submit", roundIndex: 0, path: perfectAttempt(shapeId) });
  assert.equal(h.host.snapshot().players.find((p) => p.nickname === "Host")!.roundSpeed, 25);
});

test("the round still runs its full window before auto-closing", async () => {
  const h = await makeDrawing();
  advance(19_000);
  await h.fireAlarm();
  assert.equal(h.host.snapshot().phase, "DRAWING", "19s in, the round is still open");
  advance(1_000 + MP_LIMITS.SUBMIT_GRACE_MS);
  await h.fireAlarm();
  assert.equal(h.host.snapshot().phase, "ROUND_RESULTS");
});

test("a submit in the grace after the 20s deadline still scores accuracy but no speed", async () => {
  const h = await makeDrawing();
  const shapeId = h.host.snapshot().shapeId!;
  advance(20_000 + 800);
  await h.send(h.host, { type: "submit", roundIndex: 0, path: perfectAttempt(shapeId) });
  const me = h.host.snapshot().players.find((p) => p.nickname === "Host")!;
  assert.equal(me.roundSpeed, 0);
  assert.ok(me.roundAccuracy! > 80, "the drawing itself still counts");
});
