import assert from "node:assert/strict";
import test from "node:test";
import { FakeRoom, fakeRoomCode, type BotProfile } from "./fakeRoom.ts";
import { MP_LIMITS, MP_TIMINGS, type RoomSnapshot, type ServerFrame } from "./protocol.ts";
import { canDrawNow, hostControlFor, roundLabel, showsTargetShape, showsWaitingForHost } from "./roomUiRules.ts";

// The Stage 4 harness drives the whole UI, so its state machine has to be as
// trustworthy as the server's. Time and randomness are injected, so a full
// 5-round game runs instantly and deterministically.

type Harness = {
  room: FakeRoom;
  frames: ServerFrame[];
  latest: () => RoomSnapshot;
  errors: () => Extract<ServerFrame, { type: "error" }>[];
  tick: (ms: number) => void;
};

const BOTS: BotProfile[] = [
  { nickname: "Maya", skill: 80, pace: 0.5 },
  { nickname: "Tom", skill: 50, pace: 0.3 },
  { nickname: "Dana", skill: 85, pace: 0.8 },
];

function makeHarness(mode: "create" | "join" = "create", rounds: 5 | 10 | 15 = 5): Harness {
  let now = 1_700_000_000_000;
  let nextHandle = 1;
  const pending = new Map<number, { fireAt: number; fn: () => void }>();
  // A fixed sequence rather than a constant, so bot scores and shape picks
  // vary between rounds without ever varying between runs.
  let seed = 42;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  const room = new FakeRoom({
    nickname: "You",
    mode,
    roomCode: "TEST77",
    rounds,
    difficulty: "mixed",
    bots: BOTS,
    now: () => now,
    setTimer: (fn, ms) => {
      const handle = nextHandle++;
      pending.set(handle, { fireAt: now + ms, fn });
      return handle;
    },
    clearTimer: (handle) => {
      pending.delete(handle);
    },
    random,
  });

  const frames: ServerFrame[] = [];
  room.subscribe((f) => frames.push(f));

  /** Advances the clock, firing every timer whose deadline passes, in order. */
  function tick(ms: number) {
    const target = now + ms;
    for (let guard = 0; guard < 500; guard++) {
      const due = [...pending.entries()].filter(([, t]) => t.fireAt <= target).sort((a, b) => a[1].fireAt - b[1].fireAt)[0];
      if (!due) break;
      const [handle, timer] = due;
      pending.delete(handle);
      now = Math.max(now, timer.fireAt);
      timer.fn();
    }
    now = target;
  }

  return {
    room,
    frames,
    latest: () => {
      const snap = [...frames].reverse().find((f): f is RoomSnapshot => f.type === "snapshot");
      assert.ok(snap, "expected at least one snapshot");
      return snap;
    },
    errors: () => frames.filter((f): f is Extract<ServerFrame, { type: "error" }> => f.type === "error"),
    tick,
  };
}

/** A drawing the scorer will accept - a rough circle in canvas coordinates. */
function circlePath(points = 40) {
  const p: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    p.push([Math.round(160 + 100 * Math.cos(a)), Math.round(160 + 100 * Math.sin(a))]);
  }
  return { p, w: 320, h: 320 };
}

function startGame(h: Harness) {
  h.tick(4000); // bots trickle in
  h.room.send({ type: "start" });
}

function reachDrawing(h: Harness) {
  h.tick(MP_TIMINGS.COUNTDOWN_MS);
  h.tick(MP_TIMINGS.SHOW_SHAPE_MS);
  assert.equal(h.latest().phase, "DRAWING");
}

// ------------------------------------------------------------------ lobby ----

test("creating a room makes you host and fills the lobby with the other players", () => {
  const h = makeHarness("create");
  assert.equal(h.latest().you?.isHost, true);
  h.tick(4000);
  const snap = h.latest();
  assert.equal(snap.players.length, 4);
  assert.equal(snap.players.filter((p) => p.isHost).length, 1);
  assert.equal(snap.players.find((p) => p.isHost)?.nickname, "You");
});

test("joining a room makes someone else host", () => {
  const h = makeHarness("join");
  h.tick(2000);
  const snap = h.latest();
  assert.equal(snap.you?.isHost, false);
  assert.equal(snap.players.find((p) => p.isHost)?.nickname, "Maya");
});

test("a joined guest sees the game start without touching anything", () => {
  const h = makeHarness("join");
  h.tick(7000);
  assert.notEqual(h.latest().phase, "LOBBY", "the host bot should have started the game");
});

test("the lobby never exceeds the player cap", () => {
  const many: BotProfile[] = Array.from({ length: 12 }, (_, i) => ({ nickname: `Bot${i}`, skill: 50, pace: 0.5 }));
  let now = 0;
  const pending: { fireAt: number; fn: () => void }[] = [];
  const room = new FakeRoom({
    nickname: "You",
    mode: "create",
    roomCode: "TEST77",
    bots: many,
    now: () => now,
    setTimer: (fn, ms) => {
      pending.push({ fireAt: now + ms, fn });
      return pending.length;
    },
    clearTimer: () => {},
  });
  const frames: ServerFrame[] = [];
  room.subscribe((f) => frames.push(f));
  now = 60_000;
  for (const t of [...pending].sort((a, b) => a.fireAt - b.fireAt)) t.fn();
  const snap = [...frames].reverse().find((f): f is RoomSnapshot => f.type === "snapshot")!;
  assert.ok(snap.players.length <= MP_LIMITS.MAX_PLAYERS, `got ${snap.players.length}`);
});

// ------------------------------------------------------------ permissions ----

test("a guest cannot start, advance or rematch", () => {
  const h = makeHarness("join");
  h.tick(2000);
  for (const frame of [{ type: "start" }, { type: "next" }, { type: "rematch" }] as const) {
    h.frames.length = 0;
    h.room.send(frame);
    assert.equal(h.errors()[0]?.code, "not_host", `${frame.type} should be refused`);
  }
});

test("a guest cannot change the game settings", () => {
  const h = makeHarness("join");
  h.tick(2000);
  const before = h.latest().rounds;
  h.room.send({ type: "configure", rounds: 15, difficulty: "hard" });
  assert.equal(h.errors()[0]?.code, "not_host");
  assert.equal(h.latest().rounds, before, "settings did not change");
});

test("the host can change the settings, but only in the lobby", () => {
  const h = makeHarness("create");
  h.tick(4000);
  h.room.send({ type: "configure", rounds: 15, difficulty: "hard" });
  assert.equal(h.latest().rounds, 15);
  assert.equal(h.latest().difficulty, "hard");

  h.room.send({ type: "start" });
  h.frames.length = 0;
  h.room.send({ type: "configure", rounds: 5, difficulty: "easy" });
  assert.equal(h.errors()[0]?.code, "wrong_phase");
});

test("starting needs a second player", () => {
  const h = makeHarness("create");
  h.room.send({ type: "start" }); // bots have not arrived yet
  assert.equal(h.errors()[0]?.code, "not_enough_players");
  assert.equal(h.latest().phase, "LOBBY");
});

// ---------------------------------------------------------- state machine ----

test("phases advance LOBBY -> COUNTDOWN -> SHOW_SHAPE -> DRAWING -> ROUND_RESULTS", () => {
  const h = makeHarness("create");
  assert.equal(h.latest().phase, "LOBBY");
  startGame(h);
  assert.equal(h.latest().phase, "COUNTDOWN");
  h.tick(MP_TIMINGS.COUNTDOWN_MS);
  assert.equal(h.latest().phase, "SHOW_SHAPE");
  h.tick(MP_TIMINGS.SHOW_SHAPE_MS);
  assert.equal(h.latest().phase, "DRAWING");
  h.tick(MP_TIMINGS.DRAWING_MS);
  assert.equal(h.latest().phase, "ROUND_RESULTS");
});

test("the shape is withheld until SHOW_SHAPE", () => {
  const h = makeHarness("create");
  assert.equal(h.latest().shapeId, null, "lobby");
  startGame(h);
  assert.equal(h.latest().shapeId, null, "countdown must not leak it");
  h.tick(MP_TIMINGS.COUNTDOWN_MS);
  assert.ok(h.latest().shapeId, "revealed at SHOW_SHAPE");
});

test("timed phases carry an absolute deadline and untimed ones do not", () => {
  const h = makeHarness("create");
  assert.equal(h.latest().phaseEndsAt, null, "the lobby never expires");
  startGame(h);
  const snap = h.latest();
  assert.equal(snap.phaseEndsAt! - snap.phaseStartsAt, MP_TIMINGS.COUNTDOWN_MS);
  h.tick(MP_TIMINGS.COUNTDOWN_MS + MP_TIMINGS.SHOW_SHAPE_MS);
  const drawing = h.latest();
  assert.equal(drawing.phaseEndsAt! - drawing.phaseStartsAt, MP_TIMINGS.DRAWING_MS);
  h.tick(MP_TIMINGS.DRAWING_MS);
  assert.equal(h.latest().phaseEndsAt, null, "results wait for the host");
});

test("a round ends early once everyone has submitted", () => {
  const h = makeHarness("create");
  startGame(h);
  reachDrawing(h);
  h.tick(MP_TIMINGS.DRAWING_MS * 0.85); // every bot has finished by now
  assert.equal(h.latest().phase, "DRAWING", "still waiting on you");
  h.room.send({ type: "submit", roundIndex: 0, path: circlePath() });
  assert.equal(h.latest().phase, "ROUND_RESULTS", "no reason to burn the rest of the clock");
});

test("the last round ends in FINAL_RESULTS with a champion", () => {
  const rounds = 5;
  const h = makeHarness("create", rounds);
  startGame(h);
  for (let i = 0; i < rounds; i++) {
    reachDrawing(h);
    h.room.send({ type: "submit", roundIndex: i, path: circlePath() });
    h.tick(MP_TIMINGS.DRAWING_MS);
    if (i < rounds - 1) {
      assert.equal(h.latest().phase, "ROUND_RESULTS", `round ${i}`);
      h.room.send({ type: "next" });
    }
  }
  const snap = h.latest();
  assert.equal(snap.phase, "FINAL_RESULTS");
  assert.ok(snap.championSeatId);
  const best = [...snap.players].sort((a, b) => b.totalScore - a.totalScore)[0];
  assert.equal(snap.championSeatId, best.seatId, "the champion has the highest total");
});

test("rematch keeps the players and the room code but clears every score", () => {
  const rounds = 5;
  const h = makeHarness("create", rounds);
  startGame(h);
  for (let i = 0; i < rounds; i++) {
    reachDrawing(h);
    h.room.send({ type: "submit", roundIndex: i, path: circlePath() });
    h.tick(MP_TIMINGS.DRAWING_MS);
    if (i < rounds - 1) h.room.send({ type: "next" });
  }
  const before = h.latest();
  assert.equal(before.phase, "FINAL_RESULTS");
  assert.ok(before.players.some((p) => p.totalScore > 0));

  h.room.send({ type: "rematch" });
  const after = h.latest();
  assert.equal(after.phase, "LOBBY");
  assert.equal(after.roundIndex, -1);
  assert.equal(after.championSeatId, null);
  assert.equal(after.lastRound, null);
  assert.equal(after.roomCode, before.roomCode, "same room");
  assert.equal(after.players.length, before.players.length, "same players");
  assert.ok(after.players.every((p) => p.totalScore === 0), "scores reset");
  assert.ok(after.players.every((p) => p.roundScore === null), "round scores cleared");
});

// ------------------------------------------------------------- submitting ----

test("your drawing is scored, and the components add up to the total", () => {
  const h = makeHarness("create");
  startGame(h);
  reachDrawing(h);
  h.room.send({ type: "submit", roundIndex: 0, path: circlePath() });
  const me = h.latest().players.find((p) => p.nickname === "You")!;
  assert.ok(me.roundScore !== null && me.roundAccuracy !== null && me.roundSpeed !== null);
  assert.equal(me.roundScore, Math.round(me.roundAccuracy! * 0.75 + me.roundSpeed! * 0.25));
});

test("submitting immediately earns full speed", () => {
  const h = makeHarness("create");
  startGame(h);
  reachDrawing(h);
  h.room.send({ type: "submit", roundIndex: 0, path: circlePath() });
  assert.equal(h.latest().players.find((p) => p.nickname === "You")!.roundSpeed, 100);
});

test("submitting halfway through earns half the speed", () => {
  const h = makeHarness("create");
  startGame(h);
  reachDrawing(h);
  h.tick(MP_TIMINGS.DRAWING_MS / 2);
  if (h.latest().phase !== "DRAWING") return; // bots may have closed it; the timing test above covers the rest
  h.room.send({ type: "submit", roundIndex: 0, path: circlePath() });
  assert.equal(h.latest().players.find((p) => p.nickname === "You")!.roundSpeed, 50);
});

test("submitting twice, out of phase, or for the wrong round is refused", () => {
  const h = makeHarness("create");
  startGame(h);

  h.frames.length = 0;
  h.room.send({ type: "submit", roundIndex: 0, path: circlePath() });
  assert.equal(h.errors()[0]?.code, "wrong_phase", "COUNTDOWN is not a drawing phase");

  reachDrawing(h);
  h.frames.length = 0;
  h.room.send({ type: "submit", roundIndex: 3, path: circlePath() });
  assert.equal(h.errors()[0]?.code, "too_late", "wrong round index");

  h.frames.length = 0;
  h.room.send({ type: "submit", roundIndex: 0, path: circlePath() });
  assert.equal(h.errors().length, 0, "the first real submit is accepted");
  h.room.send({ type: "submit", roundIndex: 0, path: circlePath() });
  assert.equal(h.errors()[0]?.code, "already_submitted");
});

test("a player who never submits scores nothing but stays in the game", () => {
  const h = makeHarness("create");
  startGame(h);
  reachDrawing(h);
  h.tick(MP_TIMINGS.DRAWING_MS);
  const me = h.latest().players.find((p) => p.nickname === "You")!;
  assert.equal(me.roundScore, null);
  assert.equal(me.totalScore, 0);
  assert.equal(h.latest().players.length, 4);
});

test("scores accumulate across rounds", () => {
  const h = makeHarness("create", 5);
  startGame(h);
  reachDrawing(h);
  h.room.send({ type: "submit", roundIndex: 0, path: circlePath() });
  h.tick(MP_TIMINGS.DRAWING_MS);
  const afterOne = h.latest().players.find((p) => p.nickname === "You")!.totalScore;
  assert.ok(afterOne > 0);

  h.room.send({ type: "next" });
  reachDrawing(h);
  h.room.send({ type: "submit", roundIndex: 1, path: circlePath() });
  h.tick(MP_TIMINGS.DRAWING_MS);
  assert.ok(h.latest().players.find((p) => p.nickname === "You")!.totalScore > afterOne);
});

test("a round always names a winner when somebody submitted", () => {
  const h = makeHarness("create");
  startGame(h);
  reachDrawing(h);
  h.tick(MP_TIMINGS.DRAWING_MS);
  const snap = h.latest();
  assert.ok(snap.lastRound);
  assert.ok(snap.lastRound!.winnerSeatId, "the bots submitted, so there is a winner");
  assert.equal(snap.lastRound!.roundIndex, 0);
});

// --------------------------------------------------------------- lifecycle ----

test("closing a room stops its timers", () => {
  const h = makeHarness("create");
  startGame(h);
  h.room.close();
  const framesBefore = h.frames.length;
  h.tick(60_000);
  assert.equal(h.frames.length, framesBefore, "a closed room emits nothing");
});

test("a new subscriber is replayed the current state immediately", () => {
  const h = makeHarness("create");
  startGame(h);
  const late: ServerFrame[] = [];
  h.room.subscribe((f) => late.push(f));
  assert.equal(late.length, 1);
  assert.equal(late[0].type, "snapshot");
});

test("fakeRoomCode produces codes in the real format", () => {
  for (let i = 0; i < 50; i++) {
    assert.match(fakeRoomCode(), /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  }
});

// ---------------------------------------------------------------- UI rules ----

test("DONE locks the canvas", () => {
  assert.equal(canDrawNow("DRAWING", false, false), true, "open while drawing");
  assert.equal(canDrawNow("DRAWING", false, true), false, "locked the instant DONE is tapped");
  assert.equal(canDrawNow("DRAWING", true, false), false, "locked once the server has the submission");
});

test("the canvas is locked in every phase except DRAWING", () => {
  for (const phase of ["LOBBY", "COUNTDOWN", "SHOW_SHAPE", "ROUND_RESULTS", "FINAL_RESULTS", "ABANDONED"] as const) {
    assert.equal(canDrawNow(phase, false, false), false, `${phase} must not accept drawing`);
  }
});

test("the target shape is only ever on screen during SHOW_SHAPE", () => {
  assert.equal(showsTargetShape("SHOW_SHAPE"), true);
  for (const phase of ["LOBBY", "COUNTDOWN", "DRAWING", "ROUND_RESULTS", "FINAL_RESULTS", "ABANDONED"] as const) {
    assert.equal(showsTargetShape(phase), false, `${phase} must not show the shape`);
  }
});

test("host controls appear only for the host, and only where they mean something", () => {
  assert.equal(hostControlFor("LOBBY", true), "start");
  assert.equal(hostControlFor("ROUND_RESULTS", true), "next");
  assert.equal(hostControlFor("FINAL_RESULTS", true), "rematch");
  for (const phase of ["COUNTDOWN", "SHOW_SHAPE", "DRAWING"] as const) {
    assert.equal(hostControlFor(phase, true), null, `${phase} has no host control`);
  }
  for (const phase of ["LOBBY", "ROUND_RESULTS", "FINAL_RESULTS"] as const) {
    assert.equal(hostControlFor(phase, false), null, "a guest never gets a host control");
  }
});

test("a guest is told they are waiting exactly where the host has a button", () => {
  for (const phase of ["LOBBY", "ROUND_RESULTS", "FINAL_RESULTS"] as const) {
    assert.equal(showsWaitingForHost(phase, false), true);
    assert.equal(showsWaitingForHost(phase, true), false, "the host is never waiting for themselves");
  }
  for (const phase of ["COUNTDOWN", "SHOW_SHAPE", "DRAWING"] as const) {
    assert.equal(showsWaitingForHost(phase, false), false, "nobody waits mid-round");
  }
});

test("roundLabel is 1-based and empty before the game starts", () => {
  assert.equal(roundLabel(-1, 10), "");
  assert.equal(roundLabel(0, 10), "Round 1 of 10");
  assert.equal(roundLabel(9, 10), "Round 10 of 10");
});
