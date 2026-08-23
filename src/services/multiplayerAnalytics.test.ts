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

// --------------------------------------------------------- 2 Players ---------
// Same rules, and if anything they matter more: both players type a name into
// the same device, so a leaked name would be a real person sitting next to
// another real person.

const PP_EVENTS: AnalyticsEventName[] = [
  "pp_game_started",
  "pp_round_completed",
  "pp_game_finished",
  "pp_rematch",
  "pp_abandoned",
];

test("every Pass & Play event is registered", () => {
  for (const name of PP_EVENTS) {
    assert.ok(ANALYTICS_EVENT_NAMES.includes(name), `${name} is missing from ANALYTICS_EVENT_NAMES`);
  }
});

test("well-formed Pass & Play events validate", () => {
  const good: Record<string, unknown> = {
    pp_game_started: { playerCount: 2, roundCount: 10, difficulty: "mixed" },
    pp_round_completed: { roundIndex: 3, playerCount: 2, submitted: true },
    pp_game_finished: { playerCount: 2, roundCount: 5 },
    pp_rematch: { playerCount: 2 },
    pp_abandoned: { roundIndex: 2, playerCount: 2, roundCount: 15 },
  };
  for (const name of PP_EVENTS) {
    assert.equal(validateEventParams(name, good[name]).valid, true, name);
  }
});

test("Pass & Play events refuse out-of-range values", () => {
  assert.equal(validateEventParams("pp_game_started", { playerCount: 2, roundCount: 7, difficulty: "mixed" }).valid, false);
  assert.equal(validateEventParams("pp_game_started", { playerCount: 2, roundCount: 5, difficulty: "extreme" }).valid, false);
  assert.equal(validateEventParams("pp_round_completed", { roundIndex: 15, playerCount: 2, submitted: false }).valid, false);
  assert.equal(validateEventParams("pp_abandoned", { roundIndex: -1, playerCount: 2, roundCount: 5 }).valid, false);
});

test("a player name can never ride along on a Pass & Play event", () => {
  const leaky = { playerCount: 2, roundCount: 5, difficulty: "mixed", nickname: "Maya", opponent: "Tom" };
  assert.equal(validateEventParams("pp_game_started", leaky).valid, false, "the schema refuses the extra keys");

  const cleaned = sanitizeParams(leaky as unknown as Record<string, string | number | boolean>);
  assert.equal("nickname" in cleaned, false);
  assert.equal(cleaned.playerCount, 2, "the legitimate count survives");
});

test("no Pass & Play event schema accepts a drawing or a score", () => {
  for (const name of PP_EVENTS) {
    assert.equal(validateEventParams(name, { path: [[1, 2]], score: 87 }).valid, false, name);
  }
});

test("neither mode's events carry anything but counts, settings and flags", () => {
  // A whitelist, so adding a param to one of these events is a deliberate act
  // that has to be defended here rather than something that slips in.
  const ALLOWED_KEYS = new Set(["playerCount", "roundCount", "roundIndex", "difficulty", "submitted", "phase"]);
  const samples: Record<string, Record<string, unknown>> = {
    mp_room_created: { roundCount: 10, difficulty: "mixed" },
    mp_player_joined: { playerCount: 3 },
    mp_game_started: { playerCount: 4, roundCount: 5, difficulty: "hard" },
    mp_round_completed: { roundIndex: 0, playerCount: 4, submitted: true },
    mp_game_finished: { playerCount: 4, roundCount: 15 },
    mp_rematch: { playerCount: 4 },
    mp_disconnect: { phase: "DRAWING" },
    pp_game_started: { playerCount: 2, roundCount: 10, difficulty: "mixed" },
    pp_round_completed: { roundIndex: 3, playerCount: 2, submitted: true },
    pp_game_finished: { playerCount: 2, roundCount: 5 },
    pp_rematch: { playerCount: 2 },
    pp_abandoned: { roundIndex: 2, playerCount: 2, roundCount: 15 },
  };
  for (const [name, params] of Object.entries(samples)) {
    const result = validateEventParams(name as AnalyticsEventName, params);
    assert.equal(result.valid, true, name);
    for (const key of Object.keys(result.valid ? result.params : {})) {
      assert.ok(ALLOWED_KEYS.has(key), `${name} accepted an unexpected param: ${key}`);
    }
  }
});
