import assert from "node:assert/strict";
import test from "node:test";
import {
  competitionRanks,
  multiplayerAwardId,
  multiplayerAwards,
  passPlayAwardId,
  PASS_PLAY_MATCH_POINTS,
  SOCIAL_POINTS_ICON,
} from "./socialRewards";

const entries = (...totals: number[]) => totals.map((totalScore, i) => ({ id: `s${i}`, totalScore }));

test("a live match pays 3 for first, 2 for second and 1 for everyone else", () => {
  const awards = multiplayerAwards(entries(120, 90, 70, 40));
  assert.deepEqual([...awards.values()].sort((a, b) => b - a), [3, 2, 1, 1]);
  assert.equal(awards.get("s0"), 3);
  assert.equal(awards.get("s1"), 2);
  assert.equal(awards.get("s2"), 1);
  assert.equal(awards.get("s3"), 1);
});

test("the smallest possible match still pays both players", () => {
  const awards = multiplayerAwards(entries(50, 20));
  assert.equal(awards.get("s0"), 3);
  assert.equal(awards.get("s1"), 2);
});

test("finishing order is read from the scores, not from the order they arrive in", () => {
  const awards = multiplayerAwards([
    { id: "last", totalScore: 10 },
    { id: "first", totalScore: 99 },
    { id: "second", totalScore: 50 },
  ]);
  assert.equal(awards.get("first"), 3);
  assert.equal(awards.get("second"), 2);
  assert.equal(awards.get("last"), 1);
});

// --------------------------------------------------------------------- ties --

test("players tied at the top both take the winner's award, and nobody takes second", () => {
  const awards = multiplayerAwards(entries(100, 100, 40));
  assert.equal(awards.get("s0"), 3);
  assert.equal(awards.get("s1"), 3);
  // Standard competition ranking: the third player is 3rd, not 2nd.
  assert.equal(awards.get("s2"), 1);
});

test("a tie for second pays both of them the runner-up award", () => {
  const awards = multiplayerAwards(entries(100, 60, 60, 10));
  assert.equal(awards.get("s0"), 3);
  assert.equal(awards.get("s1"), 2);
  assert.equal(awards.get("s2"), 2);
  assert.equal(awards.get("s3"), 1);
});

test("an all-square match pays everyone the winner's award", () => {
  const awards = multiplayerAwards(entries(70, 70, 70));
  assert.deepEqual([...awards.values()], [3, 3, 3]);
});

test("a match where nobody scored still pays the completion point to everyone", () => {
  const awards = multiplayerAwards(entries(0, 0));
  assert.deepEqual([...awards.values()], [3, 3]);
});

test("ranking never depends on the order entries are listed in", () => {
  const forwards = multiplayerAwards(entries(80, 80, 30));
  const backwards = multiplayerAwards([
    { id: "s2", totalScore: 30 },
    { id: "s1", totalScore: 80 },
    { id: "s0", totalScore: 80 },
  ]);
  for (const id of ["s0", "s1", "s2"]) assert.equal(forwards.get(id), backwards.get(id), id);
});

test("competition ranking skips the places a tie consumes", () => {
  const ranks = competitionRanks(entries(10, 10, 10, 5));
  assert.deepEqual([ranks.get("s0"), ranks.get("s1"), ranks.get("s2"), ranks.get("s3")], [1, 1, 1, 4]);
});

// ------------------------------------------------------------- award ids -----

test("an award id is stable for a match and different for a rematch", () => {
  const first = multiplayerAwardId("ABC234", 1, "seat-1");
  assert.equal(first, multiplayerAwardId("ABC234", 1, "seat-1"), "same match, same key");
  assert.notEqual(first, multiplayerAwardId("ABC234", 2, "seat-1"), "a rematch is a new match");
  assert.notEqual(first, multiplayerAwardId("ABC234", 1, "seat-2"), "each seat is paid separately");
  assert.notEqual(first, multiplayerAwardId("ZZZ999", 1, "seat-1"), "a different room is a different match");
});

test("a Pass & Play award id is the match's own id", () => {
  assert.equal(passPlayAwardId("game-a"), passPlayAwardId("game-a"));
  assert.notEqual(passPlayAwardId("game-a"), passPlayAwardId("game-b"));
});

// ----------------------------------------------------------------- product ---

test("a finished Pass & Play match is worth 2, flat", () => {
  assert.equal(PASS_PLAY_MATCH_POINTS, 2);
});

test("the icon is a medal, not the crown that already means the daily champion", () => {
  assert.equal(SOCIAL_POINTS_ICON, "🎖️");
  assert.notEqual(SOCIAL_POINTS_ICON, "👑");
});
