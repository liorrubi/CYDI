import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeParams } from "./analytics.ts";
import { ANALYTICS_EVENT_NAMES, validateEventParams, type AnalyticsEventName } from "./analyticsSchema.ts";

// The Worker validates ingested events with this exact code, so these are the
// server's admission rules as much as the client's. The privacy properties in
// particular are worth pinning: a room code plus a timestamp would identify a
// specific group of people playing together.

const MP_EVENTS: AnalyticsEventName[] = [
  "mp_room_created",
  "mp_player_joined",
  "mp_game_started",
  "mp_round_completed",
  "mp_game_finished",
  "mp_rematch",
  "mp_disconnect",
];

test("every multiplayer event is registered", () => {
  for (const name of MP_EVENTS) {
    assert.ok(ANALYTICS_EVENT_NAMES.includes(name), `${name} is missing from ANALYTICS_EVENT_NAMES`);
  }
});

test("well-formed multiplayer events validate", () => {
  const good: Record<string, unknown> = {
    mp_room_created: { roundCount: 10, difficulty: "mixed" },
    mp_player_joined: { playerCount: 3 },
    mp_game_started: { playerCount: 4, roundCount: 5, difficulty: "hard" },
    mp_round_completed: { roundIndex: 0, playerCount: 4, submitted: true },
    mp_game_finished: { playerCount: 4, roundCount: 15 },
    mp_rematch: { playerCount: 4 },
    mp_disconnect: { phase: "DRAWING" },
  };
  for (const name of MP_EVENTS) {
    assert.equal(validateEventParams(name, good[name]).valid, true, name);
  }
});

test("out-of-range values are refused", () => {
  assert.equal(validateEventParams("mp_room_created", { roundCount: 7, difficulty: "mixed" }).valid, false, "7 is not an offered round count");
  assert.equal(validateEventParams("mp_room_created", { roundCount: 10, difficulty: "extreme" }).valid, false);
  assert.equal(validateEventParams("mp_game_started", { playerCount: 99, roundCount: 5, difficulty: "easy" }).valid, false, "past the room cap");
  assert.equal(validateEventParams("mp_game_started", { playerCount: 0, roundCount: 5, difficulty: "easy" }).valid, false);
  assert.equal(validateEventParams("mp_round_completed", { roundIndex: 15, playerCount: 2, submitted: true }).valid, false, "there is no round 16");
  assert.equal(validateEventParams("mp_round_completed", { roundIndex: -1, playerCount: 2, submitted: true }).valid, false);
  assert.equal(validateEventParams("mp_disconnect", { phase: "NOT_A_PHASE" }).valid, false);
});

test("missing or extra params fail the whole event", () => {
  assert.equal(validateEventParams("mp_player_joined", {}).valid, false);
  assert.equal(validateEventParams("mp_player_joined", { playerCount: 2, roomCode: "TEST77" }).valid, false, "an extra field is rejected outright");
  assert.equal(validateEventParams("mp_rematch", { playerCount: "4" }).valid, false, "strings are not counts");
});

test("identifying fields can never ride along on a multiplayer event", () => {
  // Two independent defences, tested together because both must hold: the
  // schema rejects unknown keys, and sanitizeParams strips identifier-shaped
  // ones before an event is ever sent.
  const leaky = { playerCount: 4, roomCode: "TEST77", nickname: "Lior", playerId: "abc", playerToken: "secret" };
  assert.equal(validateEventParams("mp_rematch", leaky).valid, false, "the schema refuses the extra keys");

  const cleaned = sanitizeParams(leaky as unknown as Record<string, string | number | boolean>);
  assert.equal("playerId" in cleaned, false);
  assert.equal("nickname" in cleaned, false, "nickname is a display name by another word");
  assert.equal("roomCode" in cleaned, false, "a room code plus a timestamp identifies a group of players");
  assert.equal("playerToken" in cleaned, false);
  assert.equal(cleaned.playerCount, 4, "the legitimate count survives");
});

test("no multiplayer event schema accepts a drawing", () => {
  for (const name of MP_EVENTS) {
    assert.equal(validateEventParams(name, { path: [[1, 2]], points: 10 }).valid, false, name);
  }
});
