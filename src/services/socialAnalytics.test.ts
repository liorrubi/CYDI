import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeParams } from "./analytics.ts";
import {
  ANALYTICS_EVENT_NAMES,
  GAME_MODE_PARAMS,
  SOCIAL_RANK_PARAMS,
  TUTORIAL_TYPE_PARAMS,
  validateEventParams,
  type AnalyticsEventName,
} from "./analyticsSchema.ts";
import { SOCIAL_RANKS } from "../social/socialRank.ts";

// The 0.39.0 events: mode choice, leave/resume, progression, tutorials. The
// Worker validates ingested events with this same code, so these are the
// server's admission rules as much as the client's.

const NEW_EVENTS: AnalyticsEventName[] = [
  "game_mode_selected",
  "mp_resume_offered",
  "mp_resume_success",
  "mp_resume_failed",
  "mp_leave_confirmed",
  "mp_leave_cancelled",
  "social_points_awarded",
  "social_rank_up",
  "tutorial_completed",
];

const GOOD: Record<string, unknown> = {
  game_mode_selected: { mode: "twoPlayers" },
  mp_resume_offered: {},
  mp_resume_success: {},
  mp_resume_failed: {},
  mp_leave_confirmed: {},
  mp_leave_cancelled: {},
  social_points_awarded: { source: "multiplayer", amount: 3 },
  social_rank_up: { source: "twoPlayers", newRank: "Challenger" },
  tutorial_completed: { tutorialType: "multiplayerHost" },
};

test("every new event is registered and validates", () => {
  for (const name of NEW_EVENTS) {
    assert.ok(ANALYTICS_EVENT_NAMES.includes(name), `${name} missing from ANALYTICS_EVENT_NAMES`);
    assert.equal(validateEventParams(name, GOOD[name]).valid, true, name);
  }
});

// ------------------------------------------------------------ mode choice ---

test("mode selection accepts exactly the three modes", () => {
  for (const mode of GAME_MODE_PARAMS) {
    assert.equal(validateEventParams("game_mode_selected", { mode }).valid, true, mode);
  }
  assert.equal(validateEventParams("game_mode_selected", { mode: "passPlay" }).valid, false, "the internal name is not the reported one");
  assert.equal(validateEventParams("game_mode_selected", {}).valid, false);
});

// -------------------------------------------------------- leave and resume --

test("the leave and resume events carry nothing at all", () => {
  for (const name of ["mp_resume_offered", "mp_resume_success", "mp_resume_failed", "mp_leave_confirmed", "mp_leave_cancelled"] as const) {
    assert.equal(validateEventParams(name, {}).valid, true, name);
    // A room code is the single most identifying thing these could carry, so
    // the schema refuses any payload rather than trusting the caller.
    assert.equal(validateEventParams(name, { roomCode: "ABC234" }).valid, false, `${name} accepted a room code`);
    assert.equal(validateEventParams(name, { reason: "timeout" }).valid, false, `${name} accepted an extra field`);
  }
});

// ------------------------------------------------------------ progression ---

test("an award reports only its source and size", () => {
  assert.equal(validateEventParams("social_points_awarded", { source: "twoPlayers", amount: 2 }).valid, true);
  assert.equal(validateEventParams("social_points_awarded", { source: "classic", amount: 2 }).valid, false, "Classic never awards");
  assert.equal(validateEventParams("social_points_awarded", { source: "multiplayer", amount: 0 }).valid, false, "a zero award is not an award");
  assert.equal(validateEventParams("social_points_awarded", { source: "multiplayer", amount: 999 }).valid, false, "absurd payouts are dropped");
  assert.equal(
    validateEventParams("social_points_awarded", { source: "multiplayer", amount: 3, awardId: "mp:ABC234:1:seat" }).valid,
    false,
    "an award id identifies a room and must never ride along",
  );
});

test("rank-up reports a real rank, and the schema stays in step with the ladder", () => {
  assert.deepEqual([...SOCIAL_RANK_PARAMS], SOCIAL_RANKS.map((r) => r.name), "schema and ladder disagree");
  for (const rank of SOCIAL_RANK_PARAMS) {
    assert.equal(validateEventParams("social_rank_up", { source: "multiplayer", newRank: rank }).valid, true, rank);
  }
  assert.equal(validateEventParams("social_rank_up", { source: "multiplayer", newRank: "Grandmaster" }).valid, false);
});

test("progression events are emitted only for an award that was actually banked", async () => {
  // The guard is `result.granted`, which the store sets false for every repeat -
  // reconnect, remount, re-delivered final snapshot. Pinned against the source
  // so the events cannot drift onto `points > 0` alone, which is true again on
  // every re-render of a finished match.
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  for (const file of ["../components/passplay/PassPlayGame.tsx", "../components/multiplayer/PlayTogetherRoom.tsx"]) {
    const source = await readFile(join(import.meta.dirname, file), "utf8");
    const index = source.indexOf('trackEvent("social_points_awarded"');
    assert.ok(index > 0, `${file} does not report an award`);
    const preceding = source.slice(Math.max(0, index - 260), index);
    assert.ok(/result\.granted/.test(preceding), `${file} must gate the award event on result.granted`);
  }
});

// -------------------------------------------------------------- tutorials ---

test("tutorial completion names one of the four explanations", () => {
  for (const tutorialType of TUTORIAL_TYPE_PARAMS) {
    assert.equal(validateEventParams("tutorial_completed", { tutorialType }).valid, true, tutorialType);
  }
  assert.equal(validateEventParams("tutorial_completed", { tutorialType: "roundCoach" }).valid, false);
  assert.equal(validateEventParams("tutorial_completed", { tutorialType: "twoPlayers", step: 3 }).valid, false, "no per-step reporting");
});

// ----------------------------------------------------------------- privacy --

test("no new event can carry an identifier, a name or a drawing", () => {
  const leaky = {
    mode: "classic", source: "multiplayer", amount: 3,
    nickname: "Lior", roomCode: "ABC234", seatId: "s1", playerId: "p1", playerToken: "t",
    gameId: "g1", awardId: "a1", path: [[1, 2]], url: "https://playcydi.com/join/ABC234",
  };
  for (const name of NEW_EVENTS) {
    assert.equal(validateEventParams(name, leaky).valid, false, `${name} accepted a leaky payload`);
  }
  // Second line of defence: the runtime sanitizer strips identifier-shaped keys
  // even if a caller invents one.
  const cleaned = sanitizeParams(leaky as unknown as Record<string, string | number | boolean>);
  for (const key of ["nickname", "roomCode", "seatId", "playerId", "playerToken"]) {
    assert.equal(key in cleaned, false, `${key} survived sanitizeParams`);
  }
  assert.equal(cleaned.amount, 3, "the legitimate fields survive");
});
