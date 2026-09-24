// The interstitial experiment's pure logic: stable, monotonic arm assignment and a
// cadence that only gameplay completion can advance.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  assignArm,
  assignmentBucket,
  consumeOpportunity,
  opportunitiesInSession,
  parseInterstitialState,
  recordEligibleCompletion,
  type InterstitialPersistedState,
} from "./interstitialExperiment";
import type { InterstitialCadence } from "./interstitialConfigSchema";

const S1 = "sessaaaaaaaa";
const S2 = "sessbbbbbbbb";

function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => i.toString(16).padStart(12, "0"));
}

function fresh(): InterstitialPersistedState {
  return parseInterstitialState(null);
}

/** Plays `n` eligible completions and returns the final decision state + which completions were due. */
function play(state: InterstitialPersistedState, n: number, cadence: InterstitialCadence, cap = 3, session = S1) {
  const dueAt: number[] = [];
  let s = state;
  for (let i = 1; i <= n; i++) {
    const d = recordEligibleCompletion(s, cadence, cap, session, "treatment");
    s = d.state;
    if (d.due) {
      dueAt.push(i);
      s = consumeOpportunity(s, session);
    }
  }
  return { state: s, dueAt };
}

// --- Assignment ---------------------------------------------------------------------

test("bucketing is deterministic for the same installationId", () => {
  for (const id of ids(50)) {
    assert.equal(assignmentBucket(id), assignmentBucket(id));
    assert.equal(assignArm(id, 20), assignArm(id, 20));
  }
  const b = assignmentBucket("0123456789ab");
  assert.ok(b >= 0 && b < 10_000);
});

test("rollout expansion 5 -> 20 -> 50 is monotonic: every earlier assignment is kept, only additions", () => {
  const population = ids(5000);
  const at = (p: number) => new Map(population.map((id) => [id, assignArm(id, p)]));
  const p5 = at(5);
  const p20 = at(20);
  const p50 = at(50);
  for (const id of population) {
    if (p5.get(id) !== "unassigned") assert.equal(p20.get(id), p5.get(id), `${id} kept its arm 5 -> 20`);
    if (p20.get(id) !== "unassigned") assert.equal(p50.get(id), p20.get(id), `${id} kept its arm 20 -> 50`);
  }
  const count = (m: Map<string, string>, arm: string) => [...m.values()].filter((a) => a === arm).length;
  assert.ok(count(p20, "treatment") > count(p5, "treatment"));
  assert.ok(count(p50, "treatment") > count(p20, "treatment"));
  // At 50 everybody is in exactly one arm.
  assert.equal(count(p50, "unassigned"), 0);
});

test("arms are roughly the requested size and equal to each other", () => {
  const population = ids(20_000);
  const arms = population.map((id) => assignArm(id, 5));
  const treatment = arms.filter((a) => a === "treatment").length / population.length;
  const control = arms.filter((a) => a === "control").length / population.length;
  assert.ok(Math.abs(treatment - 0.05) < 0.01, `treatment share ${treatment}`);
  assert.ok(Math.abs(control - 0.05) < 0.01, `control share ${control}`);
});

test("0% rollout assigns nobody; no persisted id is always unassigned", () => {
  for (const id of ids(200)) assert.equal(assignArm(id, 0), "unassigned");
  assert.equal(assignArm(null, 50), "unassigned");
  assert.equal(assignArm(null, 5), "unassigned");
});

// --- Cadence ------------------------------------------------------------------------

test("normal cadence 7: the 7th, 14th and 21st completions are due", () => {
  assert.deepEqual(play(fresh(), 21, 7).dueAt, [7, 14, 21]);
});

test("preload is requested from cadence-1, for treatment only", () => {
  let s = fresh();
  const preloadAt: number[] = [];
  for (let i = 1; i <= 7; i++) {
    const d = recordEligibleCompletion(s, 7, 1, S1, "treatment");
    s = d.state;
    if (d.preload) preloadAt.push(i);
  }
  assert.deepEqual(preloadAt, [6, 7]);
  const control = recordEligibleCompletion({ ...fresh(), eligibleGamesSinceLastOpportunity: 5 }, 7, 1, S1, "control");
  assert.equal(control.preload, false);
});

test("7 -> 10 with progress 6: progress is kept and four more completions are required", () => {
  const six = { ...fresh(), eligibleGamesSinceLastOpportunity: 6 };
  const { dueAt, state } = play(six, 4, 10);
  assert.deepEqual(dueAt, [4], "the 4th completion after the change (10 total) is due");
  assert.equal(state.eligibleGamesSinceLastOpportunity, 0);
  // Before it: 7, 8, 9 are not due.
  let s: InterstitialPersistedState = six;
  for (const expected of [7, 8, 9]) {
    const d = recordEligibleCompletion(s, 10, 3, S1, "treatment");
    assert.equal(d.state.eligibleGamesSinceLastOpportunity, expected);
    assert.equal(d.due, false);
    s = d.state;
  }
});

test("10 -> 5 with progress 8: nothing at startup; the NEXT completion is due", () => {
  const eight = { ...fresh(), eligibleGamesSinceLastOpportunity: 8 };
  // Loading/parsing the persisted state under a new cadence is not a completion and changes nothing.
  const reloaded = parseInterstitialState(JSON.stringify(eight));
  assert.equal(reloaded.eligibleGamesSinceLastOpportunity, 8);
  const d = recordEligibleCompletion(reloaded, 5, 1, S1, "treatment");
  assert.equal(d.due, true);
  assert.equal(d.state.eligibleGamesSinceLastOpportunity, 9);
});

test("a config change can never create an opportunity by itself - only a completion returns `due`", () => {
  // The only function that can answer due=true is recordEligibleCompletion, and it
  // always advances the counter by exactly one. Re-reading state under any cadence
  // (startup, config fetch, new session) is a pure parse with no decision in it.
  const over = { ...fresh(), eligibleGamesSinceLastOpportunity: 50 };
  for (const raw of [JSON.stringify(over)]) {
    const parsed = parseInterstitialState(raw);
    assert.deepEqual(parsed, over);
  }
  const d = recordEligibleCompletion(over, 5, 1, S2, "treatment");
  assert.equal(d.state.eligibleGamesSinceLastOpportunity, 51);
});

test("progress is preserved across a cadence change in both directions", () => {
  let s = play(fresh(), 3, 7).state;
  assert.equal(s.eligibleGamesSinceLastOpportunity, 3);
  s = play(s, 2, 12).state;
  assert.equal(s.eligibleGamesSinceLastOpportunity, 5);
  const { dueAt } = play(s, 3, 7);
  assert.deepEqual(dueAt, [2], "5 + 2 = 7 under cadence 7");
});

test("the session cap closes further opportunities in that session and the next session reopens", () => {
  let s = consumeOpportunity({ ...fresh(), eligibleGamesSinceLastOpportunity: 7 }, S1);
  assert.equal(opportunitiesInSession(s, S1), 1);
  assert.equal(s.eligibleGamesSinceLastOpportunity, 0);
  // Cap 1: seven more completions in the same session are never due, and do not preload.
  for (let i = 0; i < 7; i++) {
    const d = recordEligibleCompletion(s, 7, 1, S1, "treatment");
    assert.equal(d.due, false);
    assert.equal(d.preload, false);
    s = d.state;
  }
  assert.equal(s.eligibleGamesSinceLastOpportunity, 7, "progress keeps counting while capped");
  // A new session: the next completion is due immediately.
  const d = recordEligibleCompletion(s, 7, 1, S2, "treatment");
  assert.equal(d.due, true);
  assert.equal(opportunitiesInSession(d.state, S2), 0);
});

test("corrupt persisted state falls back field by field", () => {
  assert.deepEqual(parseInterstitialState("not json"), fresh());
  const partial = parseInterstitialState(
    JSON.stringify({ eligibleGamesSinceLastOpportunity: -3, session: { sessionId: S1, opportunities: 2 }, marker: { bogus: 1 } }),
  );
  assert.equal(partial.eligibleGamesSinceLastOpportunity, 0);
  assert.deepEqual(partial.session, { sessionId: S1, opportunities: 2 });
  assert.equal(partial.marker, null);
});
