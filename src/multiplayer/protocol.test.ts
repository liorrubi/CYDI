import assert from "node:assert/strict";
import test from "node:test";
import {
  combineRoundScore,
  fromWirePath,
  isRoomCode,
  MP_LIMITS,
  MP_TIMINGS,
  parseClientFrame,
  parseWirePath,
  sanitizeNickname,
  speedScore,
  toWirePath,
} from "./protocol.ts";

// ---------------------------------------------------------------- nicknames ----

test("sanitizeNickname keeps ordinary names untouched", () => {
  assert.equal(sanitizeNickname("Lior"), "Lior");
  assert.equal(sanitizeNickname("  Dana  "), "Dana");
  assert.equal(sanitizeNickname("שחקן"), "שחקן");
});

// Written as explicit codepoints rather than pasted invisible characters: the
// literals would be unreadable in review, and a stray editor or Git filter
// could silently strip them, leaving a test that asserts nothing.
const CH = {
  NUL: String.fromCodePoint(0x00),
  TAB: String.fromCodePoint(0x09),
  LF: String.fromCodePoint(0x0a),
  SOH: String.fromCodePoint(0x01),
  DEL: String.fromCodePoint(0x7f),
  C1: String.fromCodePoint(0x9f),
  ZWSP: String.fromCodePoint(0x200b),
  ZWJ: String.fromCodePoint(0x200d),
  RLO: String.fromCodePoint(0x202e),
  LRI: String.fromCodePoint(0x2066),
  PDI: String.fromCodePoint(0x2069),
  BOM: String.fromCodePoint(0xfeff),
};

test("sanitizeNickname strips control characters", () => {
  assert.equal(sanitizeNickname(`Li${CH.NUL}or`), "Lior");
  assert.equal(sanitizeNickname(`a${CH.LF}b${CH.TAB}c`), "abc");
  assert.equal(sanitizeNickname(`x${CH.DEL}y${CH.C1}z${CH.SOH}`), "xyz");
});

test("sanitizeNickname strips zero-width and bidi-override codepoints", () => {
  // A bidi override can visually reorder the rest of a leaderboard row.
  assert.equal(sanitizeNickname(`ab${CH.RLO}cd`), "abcd");
  // Zero-width joiners let two players pick visually identical names.
  assert.equal(sanitizeNickname(`Li${CH.ZWSP}or`), "Lior");
  assert.equal(sanitizeNickname(`Li${CH.ZWJ}or`), "Lior");
  assert.equal(sanitizeNickname(`${CH.BOM}Lior`), "Lior");
  assert.equal(sanitizeNickname(`a${CH.LRI}b${CH.PDI}c`), "abc");
});

test("sanitizeNickname caps length AFTER stripping, so invisible padding cannot eat the budget", () => {
  const padded = CH.ZWSP.repeat(50) + "Lior";
  assert.equal(sanitizeNickname(padded), "Lior");
  assert.equal(sanitizeNickname("A".repeat(40)).length, MP_LIMITS.MAX_NICKNAME_LENGTH);
});

test("sanitizeNickname rejects non-strings and empty results", () => {
  assert.equal(sanitizeNickname(undefined), "");
  assert.equal(sanitizeNickname(42), "");
  assert.equal(sanitizeNickname(CH.NUL + CH.SOH), "", "a name of nothing but control chars is empty");
});

// --------------------------------------------------------------- room codes ----

test("isRoomCode accepts 6 chars from the unambiguous alphabet only", () => {
  assert.equal(isRoomCode("TEST77"), true);
  assert.equal(isRoomCode("ABCDEF"), true);
  assert.equal(isRoomCode("TEST7"), false, "too short");
  assert.equal(isRoomCode("TEST777"), false, "too long");
  assert.equal(isRoomCode("TES0T7"), false, "0 is excluded");
  assert.equal(isRoomCode("TESIT7"), false, "I is excluded");
  assert.equal(isRoomCode("test77"), false, "lowercase");
  assert.equal(isRoomCode(123456), false);
});

// ---------------------------------------------------------------- wire path ----

const validPath = { p: [[1, 2], [3, 4], [5, 6]] as [number, number][], w: 320, h: 320 };

test("parseWirePath accepts a well-formed path", () => {
  const parsed = parseWirePath(validPath);
  assert.ok(parsed);
  assert.equal(parsed.p.length, 3);
  assert.equal(parsed.w, 320);
});

test("parseWirePath enforces the point cap", () => {
  const tooMany = { ...validPath, p: Array.from({ length: MP_LIMITS.MAX_SUBMIT_POINTS + 1 }, () => [1, 1] as [number, number]) };
  assert.equal(parseWirePath(tooMany), null);

  const atCap = { ...validPath, p: Array.from({ length: MP_LIMITS.MAX_SUBMIT_POINTS }, () => [1, 1] as [number, number]) };
  assert.ok(parseWirePath(atCap), "exactly at the cap is allowed");
});

test("parseWirePath rejects degenerate and non-finite geometry", () => {
  assert.equal(parseWirePath({ ...validPath, p: [[1, 2]] }), null, "a single point is not a path");
  assert.equal(parseWirePath({ ...validPath, p: [[Number.NaN, 2], [3, 4]] }), null);
  assert.equal(parseWirePath({ ...validPath, p: [[Infinity, 2], [3, 4]] }), null);
  assert.equal(parseWirePath({ ...validPath, p: [[1e9, 2], [3, 4]] }), null, "absurd coordinate");
  assert.equal(parseWirePath({ ...validPath, p: [["1", 2], [3, 4]] }), null);
  assert.equal(parseWirePath({ ...validPath, p: [[1, 2, 3], [3, 4]] }), null, "3-tuple");
});

test("parseWirePath rejects bad canvas dimensions", () => {
  assert.equal(parseWirePath({ ...validPath, w: 0 }), null);
  assert.equal(parseWirePath({ ...validPath, w: -320 }), null);
  assert.equal(parseWirePath({ ...validPath, h: 99999 }), null);
  assert.equal(parseWirePath({ ...validPath, w: "320" }), null);
});

test("parseWirePath rejects break indices that would produce empty or reversed segments", () => {
  assert.equal(parseWirePath({ ...validPath, b: [0] }), null, "0 would make an empty first segment");
  assert.equal(parseWirePath({ ...validPath, b: [2, 1] }), null, "must be increasing");
  assert.equal(parseWirePath({ ...validPath, b: [1, 1] }), null, "must be strictly increasing");
  assert.equal(parseWirePath({ ...validPath, b: [3] }), null, "past the end");
  assert.equal(parseWirePath({ ...validPath, b: [1.5] }), null, "must be an integer");
  assert.ok(parseWirePath({ ...validPath, b: [1, 2] }), "a valid break list is kept");
});

test("parseWirePath rejects non-objects", () => {
  assert.equal(parseWirePath(null), null);
  assert.equal(parseWirePath("nope"), null);
  assert.equal(parseWirePath(undefined), null);
});

test("wire path round-trips, preserving breaks", () => {
  const original = {
    points: [{ x: 1.4, y: 2.6, t: 0 }, { x: 3, y: 4, t: 5 }, { x: 5, y: 6, t: 9 }],
    canvasWidth: 320,
    canvasHeight: 320,
    breaks: [2],
  };
  const back = fromWirePath(toWirePath(original));
  assert.deepEqual(back.points.map((p) => [p.x, p.y]), [[1, 3], [3, 4], [5, 6]], "coordinates round to integers");
  assert.deepEqual(back.breaks, [2]);
  assert.equal(back.canvasWidth, 320);
});

test("toWirePath omits an empty breaks array rather than sending []", () => {
  const wire = toWirePath({ points: [{ x: 1, y: 1, t: 0 }], canvasWidth: 320, canvasHeight: 320, breaks: [] });
  assert.equal(wire.b, undefined);
});

// ------------------------------------------------------------ client frames ----

test("parseClientFrame accepts each valid frame", () => {
  assert.deepEqual(parseClientFrame({ type: "join", nickname: "Lior", playerId: "abc" }), {
    type: "join",
    nickname: "Lior",
    playerId: "abc",
    playerToken: undefined,
  });
  assert.deepEqual(parseClientFrame({ type: "configure", rounds: 10, difficulty: "hard" }), {
    type: "configure",
    rounds: 10,
    difficulty: "hard",
  });
  assert.deepEqual(parseClientFrame({ type: "start" }), { type: "start" });
  assert.deepEqual(parseClientFrame({ type: "next" }), { type: "next" });
  assert.deepEqual(parseClientFrame({ type: "rematch" }), { type: "rematch" });
  assert.deepEqual(parseClientFrame({ type: "ping", clientSentAt: 5 }), { type: "ping", clientSentAt: 5 });
});

test("parseClientFrame rejects unknown and malformed frames", () => {
  assert.equal(parseClientFrame({ type: "nonsense" }), null);
  assert.equal(parseClientFrame({}), null);
  assert.equal(parseClientFrame(null), null);
  assert.equal(parseClientFrame("start"), null);
  assert.equal(parseClientFrame([{ type: "start" }]), null);
});

test("parseClientFrame rejects a join without a usable identity", () => {
  assert.equal(parseClientFrame({ type: "join", nickname: "", playerId: "abc" }), null);
  assert.equal(parseClientFrame({ type: "join", nickname: CH.ZWSP, playerId: "abc" }), null, "invisible-only nickname");
  assert.equal(parseClientFrame({ type: "join", nickname: "Lior" }), null, "missing playerId");
  assert.equal(parseClientFrame({ type: "join", nickname: "Lior", playerId: "x".repeat(65) }), null);
  assert.equal(parseClientFrame({ type: "join", nickname: "Lior", playerId: "abc", playerToken: 5 }), null);
});

test("parseClientFrame rejects out-of-range configuration", () => {
  assert.equal(parseClientFrame({ type: "configure", rounds: 7, difficulty: "hard" }), null, "7 is not an offered round count");
  assert.equal(parseClientFrame({ type: "configure", rounds: 10, difficulty: "extreme" }), null);
  assert.equal(parseClientFrame({ type: "configure", rounds: "10", difficulty: "hard" }), null);
});

test("parseClientFrame accepts an explicit empty submission but not a missing path", () => {
  // `path: null` is the deadline firing on an empty canvas - a real result
  // worth zero. A MISSING path is just a malformed frame, and conflating the
  // two would let a bug silently score someone zero.
  assert.deepEqual(parseClientFrame({ type: "submit", roundIndex: 0, path: null }), {
    type: "submit",
    roundIndex: 0,
    path: null,
  });
  assert.equal(parseClientFrame({ type: "submit", roundIndex: 0 }), null, "missing path is malformed");
  assert.equal(parseClientFrame({ type: "submit", roundIndex: 0, path: undefined }), null);
});

test("parseClientFrame rejects a submit with a bad round index or path", () => {
  assert.equal(parseClientFrame({ type: "submit", roundIndex: -1, path: validPath }), null);
  assert.equal(parseClientFrame({ type: "submit", roundIndex: 1.5, path: validPath }), null);
  assert.equal(parseClientFrame({ type: "submit", roundIndex: 0, path: { p: [] } }), null);
  assert.ok(parseClientFrame({ type: "submit", roundIndex: 0, path: validPath }));
});

// ------------------------------------------------------------------ scoring ----

test("the drawing window is 20 seconds", () => {
  // Pinned deliberately. Every other timing in the mode derives from this, and
  // the speed score is measured against it, so a change here silently
  // re-balances scoring - it should be a decision, not a drive-by edit.
  assert.equal(MP_TIMINGS.DRAWING_MS, 20_000);
  assert.equal(MP_TIMINGS.SHOW_SHAPE_MS, 3_000, "the look at the shape is unchanged");
  assert.equal(MP_TIMINGS.COUNTDOWN_MS, 3_000);
});

test("speedScore is 100 at the instant the round starts and 0 at the deadline", () => {
  assert.equal(speedScore(0), 100);
  assert.equal(speedScore(MP_TIMINGS.DRAWING_MS), 0);
});

test("speedScore is measured against the 20-second window", () => {
  // The published formula, with the real numbers rather than the constant, so
  // this fails if the window moves without the formula being reconsidered.
  assert.equal(speedScore(0), 100);
  assert.equal(speedScore(5_000), 75);
  assert.equal(speedScore(10_000), 50);
  assert.equal(speedScore(15_000), 25);
  assert.equal(speedScore(20_000), 0);
  assert.equal(speedScore(20_001), 0, "past the deadline is still zero, never negative");
});

test("speedScore falls off linearly", () => {
  assert.equal(speedScore(MP_TIMINGS.DRAWING_MS / 2), 50);
  assert.equal(speedScore(MP_TIMINGS.DRAWING_MS / 4), 75);
});

test("speedScore clamps outside the window", () => {
  assert.equal(speedScore(-500), 100, "a negative elapsed cannot exceed 100");
  assert.equal(speedScore(MP_TIMINGS.DRAWING_MS * 3), 0);
  assert.equal(speedScore(1000, 0), 0, "a zero-length window scores nothing");
});

test("combineRoundScore applies the published 75/25 split", () => {
  assert.equal(combineRoundScore(100, 100), 100);
  assert.equal(combineRoundScore(0, 0), 0);
  assert.equal(combineRoundScore(100, 0), 75, "accuracy alone is worth 75");
  assert.equal(combineRoundScore(0, 100), 25, "speed alone is worth 25");
  assert.equal(combineRoundScore(80, 40), Math.round(80 * 0.75 + 40 * 0.25));
});

test("combineRoundScore clamps its inputs and returns an integer", () => {
  assert.equal(combineRoundScore(150, 150), 100);
  assert.equal(combineRoundScore(-20, -20), 0);
  assert.equal(Number.isInteger(combineRoundScore(83, 41)), true);
});
