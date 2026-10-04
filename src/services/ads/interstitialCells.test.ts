// The multi-cell experiment's assignment, persistence and session snapshot (pure logic).

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  IFX_STATE_KEY,
  isInExperimentGate,
  isSecondOpportunityAllowed,
  parseIfxState,
  pickCell,
  resolveExperimentCell,
  resolveSessionSnapshot,
  type SessionSnapshot,
} from "./interstitialCells";
import { assignArm, assignmentBucket, isSecondOpportunityEligible, stableBucket, type InterstitialStorage } from "./interstitialExperiment";
import type { InterstitialExperimentSpec } from "./interstitialConfigSchema";

function population(n: number): string[] {
  let a = 0x9e3779b9;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
  return Array.from({ length: n }, () => next().toString(16).padStart(8, "0") + next().toString(16).padStart(8, "0"));
}

const cell = (id: string, cadence: number, cap: number, weight: number) => ({ id, cadence, cap, weight }) as InterstitialExperimentSpec["cells"][number];
const spec = (over: Partial<InterstitialExperimentSpec> = {}): InterstitialExperimentSpec => ({
  enabled: true,
  rolloutPercentInTreatment: 100,
  version: 1,
  cells: [cell("A", 7, 2, 50), cell("B", 5, 2, 30), cell("C", 10, 1, 20)],
  ...over,
});

function memory(initial: string | null = null): InterstitialStorage & { raw: () => string | null; failing: boolean } {
  const m = {
    value: initial,
    failing: false,
    read() {
      return this.value;
    },
    write(v: string) {
      if (this.failing) return false;
      this.value = v;
      return true;
    },
    raw() {
      return this.value;
    },
  };
  return m;
}

const BASE = { cadence: 7 as const, cap: 2 };
const S1 = "sess00000001";
const S2 = "sess00000002";

// --- Distribution, determinism, monotonicity ----------------------------------------------------

test("gate and cell draws are deterministic per installation", () => {
  for (const id of population(50)) {
    assert.equal(isInExperimentGate(id, 1, 30), isInExperimentGate(id, 1, 30));
    assert.equal(pickCell(id, spec()).id, pickCell(id, spec()).id);
  }
});

test("weights distribute over 10k synthetic ids within tolerance (and a 0-weight cell is never drawn)", () => {
  const ids = population(10_000);
  const s = spec({ cells: [cell("A", 7, 2, 50), cell("B", 5, 2, 30), cell("C", 10, 1, 20), cell("D", 7, 1, 0)] });
  const counts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const id of ids) counts[pickCell(id, s).id]++;
  assert.equal(counts.D, 0);
  for (const [id, share] of [["A", 50], ["B", 30], ["C", 20]] as const) {
    assert.ok(Math.abs(counts[id] / 100 - share) < 2.5, `${id}: ${counts[id] / 100}% vs ${share}%`);
  }
});

test("the gate is monotonic: raising the percentage only adds participants, and the size tracks the percentage", () => {
  const ids = population(10_000);
  const at = (p: number) => new Set(ids.filter((id) => isInExperimentGate(id, 4, p)));
  const p0 = at(0);
  const p10 = at(10);
  const p30 = at(30);
  const p100 = at(100);
  assert.equal(p0.size, 0);
  assert.equal(p100.size, ids.length);
  for (const id of p10) assert.ok(p30.has(id));
  for (const id of p30) assert.ok(p100.has(id));
  assert.ok(Math.abs(p10.size / 100 - 10) < 2, `10% -> ${p10.size / 100}%`);
  assert.ok(Math.abs(p30.size / 100 - 30) < 2.5, `30% -> ${p30.size / 100}%`);
});

test("arm, gate and cell hashes are independent (joint distribution sanity)", () => {
  const ids = population(20_000);
  const N = ids.length;
  // arm: treatment at rollout 50 (~50%); gate at 40%; cell A weight 50%.
  const s = spec({ cells: [cell("A", 7, 2, 50), cell("B", 5, 2, 50)] });
  let treatment = 0;
  let gate = 0;
  let treatmentAndGate = 0;
  let cellA = 0;
  let gateAndCellA = 0;
  let treatmentAndCellA = 0;
  for (const id of ids) {
    const t = assignArm(id, 50) === "treatment";
    const g = isInExperimentGate(id, 1, 40);
    const a = pickCell(id, s).id === "A";
    if (t) treatment++;
    if (g) gate++;
    if (a) cellA++;
    if (t && g) treatmentAndGate++;
    if (g && a) gateAndCellA++;
    if (t && a) treatmentAndCellA++;
  }
  const near = (joint: number, x: number, y: number, label: string) => {
    const expected = (x / N) * (y / N) * N;
    assert.ok(Math.abs(joint - expected) / N < 0.015, `${label}: ${joint} vs expected ${expected.toFixed(0)}`);
  };
  near(treatmentAndGate, treatment, gate, "arm x gate");
  near(gateAndCellA, gate, cellA, "gate x cell");
  near(treatmentAndCellA, treatment, cellA, "arm x cell");
  // The salts really are separate streams.
  assert.notEqual(stableBucket("cydi-interstitial-ifx-gate-v1", ids[0]), assignmentBucket(ids[0]));
  assert.notEqual(stableBucket("cydi-interstitial-ifx-gate-v1", ids[1]), stableBucket("cydi-interstitial-ifx-cell-v1", ids[1]));
});

// --- Persistence semantics ------------------------------------------------------------------------

test("a weights edit within the same version never reshuffles existing participants", () => {
  const ids = population(2000);
  const before = spec();
  const assigned = new Map(ids.map((id) => [id, resolveExperimentCell(id, before, null)]));
  const edited = spec({ cells: [cell("A", 7, 2, 10), cell("B", 5, 2, 10), cell("C", 10, 1, 80)] });
  const changedByDraw = ids.filter((id) => pickCell(id, edited).id !== assigned.get(id)!.cell!.id).length;
  assert.ok(changedByDraw > 100, "sanity: a fresh draw under the new weights WOULD move people");
  for (const id of ids) {
    const again = resolveExperimentCell(id, edited, assigned.get(id)!.assignment);
    assert.equal(again.cell!.id, assigned.get(id)!.cell!.id, "same version keeps the cell");
  }
});

test("a version change deliberately re-assigns", () => {
  const ids = population(2000);
  const v1 = spec({ version: 1, cells: [cell("A", 7, 2, 50), cell("B", 5, 2, 50)] });
  const v2 = { ...v1, version: 2 };
  let moved = 0;
  for (const id of ids) {
    const first = resolveExperimentCell(id, v1, null);
    const second = resolveExperimentCell(id, v2, first.assignment);
    assert.deepEqual(second.assignment, { version: 2, cellId: pickCell(id, v2).id });
    assert.equal(second.cell!.id, pickCell(id, v2).id);
    if (second.cell!.id !== first.cell!.id) moved++;
  }
  assert.ok(moved > 700 && moved < 1300, `about half moved on a new version, got ${moved}`);
});

test("a persisted cell id missing from the config means baseline for that version, with no re-draw", () => {
  const id = population(1)[0];
  const first = resolveExperimentCell(id, spec(), null);
  const removed = spec({ cells: spec().cells.filter((c) => c.id !== first.cell!.id).map((c, i, all) => ({ ...c, weight: i === 0 ? 100 - 50 * (all.length - 1) : 50 })) });
  const res = resolveExperimentCell(id, removed, first.assignment);
  assert.equal(res.cell, null);
  assert.deepEqual(res.assignment, first.assignment, "not re-assigned within that version");
});

// --- Session snapshot ---------------------------------------------------------------------------

function input(over: Partial<Parameters<typeof resolveSessionSnapshot>[1]> = {}): Parameters<typeof resolveSessionSnapshot>[1] {
  return { sessionId: S1, installationId: population(1)[0], arm: "treatment", base: BASE, spec: spec(), ...over };
}

test("a participant gets its cell's cadence and cap, persisted with the assignment", () => {
  const id = population(1)[0];
  const store = memory();
  const snap = resolveSessionSnapshot(store, input({ installationId: id }));
  const picked = pickCell(id, spec());
  assert.deepEqual(snap, { sessionId: S1, experimentVersion: 1, cellId: picked.id, cadence: picked.cadence, cap: picked.cap });
  const persisted = parseIfxState(store.raw());
  assert.deepEqual(persisted.snapshot, snap);
  assert.deepEqual(persisted.assignment, { version: 1, cellId: picked.id });
});

test("every kind of non-participant gets exactly the base cadence and cap with a null cell", () => {
  const baseline: Omit<SessionSnapshot, "sessionId"> = { experimentVersion: null, cellId: null, cadence: 7, cap: 2 };
  const cases: Record<string, Parameters<typeof resolveSessionSnapshot>[1]> = {
    "experiments absent": input({ spec: null }),
    "disabled": input({ spec: spec({ enabled: false }) }),
    "rollout 0": input({ spec: spec({ rolloutPercentInTreatment: 0 }) }),
    "control arm": input({ arm: "control" }),
    "no stable id": input({ installationId: null }),
  };
  for (const [name, inp] of Object.entries(cases)) {
    const store = memory();
    assert.deepEqual(resolveSessionSnapshot(store, inp), { sessionId: S1, ...baseline }, name);
    assert.equal(parseIfxState(store.raw()).assignment, null, `${name}: nothing assigned`);
  }
});

test("outside the rollout gate: baseline, and a raised rollout later adds the installation", () => {
  const ids = population(400);
  const outside = ids.find((id) => !isInExperimentGate(id, 1, 10))!;
  assert.equal(resolveSessionSnapshot(memory(), input({ installationId: outside, spec: spec({ rolloutPercentInTreatment: 10 }) })).cellId, null);
  assert.notEqual(resolveSessionSnapshot(memory(), input({ installationId: outside, spec: spec({ rolloutPercentInTreatment: 100 }) })).cellId, null);
});

test("the snapshot is reused for the whole session, including a cold start, whatever the remote spec says now", () => {
  const id = population(1)[0];
  const store = memory();
  const first = resolveSessionSnapshot(store, input({ installationId: id }));
  assert.notEqual(first.cellId, null);
  for (const changed of [null, spec({ enabled: false }), spec({ version: 9, cells: [cell("A", 10, 1, 50), cell("B", 3, 5, 50)] }), spec({ rolloutPercentInTreatment: 0 })]) {
    assert.deepEqual(resolveSessionSnapshot(store, input({ installationId: id, spec: changed })), first);
  }
});

test("a new analytics session re-evaluates: disabling or lowering takes effect, and re-enabling restores the SAME cell", () => {
  const id = population(1)[0];
  const store = memory();
  const s1 = resolveSessionSnapshot(store, input({ installationId: id }));
  const off = resolveSessionSnapshot(store, input({ installationId: id, sessionId: S2, spec: spec({ enabled: false }) }));
  assert.deepEqual(off, { sessionId: S2, experimentVersion: null, cellId: null, cadence: 7, cap: 2 });
  const back = resolveSessionSnapshot(store, input({ installationId: id, sessionId: "sess00000003" }));
  assert.equal(back.cellId, s1.cellId, "the persisted assignment survives a session spent in baseline");
});

test("a non-participant snapshot pins the DECISION, not the numbers: the frozen base config still rules cadence and cap", () => {
  const store = memory();
  const a = resolveSessionSnapshot(store, input({ spec: null, base: { cadence: 7, cap: 2 } }));
  assert.equal(a.cadence, 7);
  const b = resolveSessionSnapshot(store, input({ spec: null, base: { cadence: 5, cap: 1 } }));
  assert.deepEqual([b.cadence, b.cap, b.cellId], [5, 1, null], "0.56 behaviour: a cold start under a changed base config");
  // ...but turning the experiment on mid-session cannot turn a baseline session into a participant one.
  const c = resolveSessionSnapshot(store, input({ spec: spec(), base: { cadence: 5, cap: 1 } }));
  assert.equal(c.cellId, null);
});

test("a corrupt or foreign stored record degrades to 'nothing stored' field by field", () => {
  assert.deepEqual(parseIfxState(null), { assignment: null, snapshot: null });
  assert.deepEqual(parseIfxState("{nope"), { assignment: null, snapshot: null });
  assert.deepEqual(parseIfxState("[]"), { assignment: null, snapshot: null });
  const good = { version: 2, cellId: "B" };
  // 0.57: any integer EFFECTIVE cadence 3..20 survives a reload (a cell may run 3..10, the base 5/7/10/12/15/20) and
  // any cap 1..5; outside those ranges the snapshot is dropped.
  for (const [cadence, cap] of [[6, 2], [3, 5], [4, 3], [8, 4], [9, 1], [20, 2], [12, 1]]) {
    assert.deepEqual(parseIfxState(JSON.stringify({ assignment: good, snapshot: { sessionId: S1, experimentVersion: 2, cellId: "B", cadence, cap } })), {
      assignment: good,
      snapshot: { sessionId: S1, experimentVersion: 2, cellId: "B", cadence, cap },
    }, `${cadence}/${cap} survives`);
  }
  for (const cadence of [2, 21, 0, 7.5, "7"]) {
    assert.deepEqual(parseIfxState(JSON.stringify({ assignment: good, snapshot: { sessionId: S1, experimentVersion: 2, cellId: "B", cadence, cap: 2 } })), { assignment: good, snapshot: null }, `cadence ${String(cadence)}`);
  }
  for (const cap of [0, 6, 2.5, "2"]) {
    assert.deepEqual(parseIfxState(JSON.stringify({ assignment: good, snapshot: { sessionId: S1, experimentVersion: 2, cellId: "B", cadence: 7, cap } })), { assignment: good, snapshot: null }, `cap ${String(cap)}`);
  }
  assert.equal(parseIfxState(JSON.stringify({ assignment: { version: 0, cellId: "B" } })).assignment, null);
  assert.equal(parseIfxState(JSON.stringify({ assignment: { version: 1, cellId: "Z" } })).assignment, null);
  assert.equal(parseIfxState(JSON.stringify({ snapshot: { sessionId: S1, experimentVersion: 2, cellId: null, cadence: 7, cap: 2 } })).snapshot, null);
  assert.equal(parseIfxState(JSON.stringify({ snapshot: { sessionId: S1, experimentVersion: null, cellId: null, cadence: 7, cap: 6 } })).snapshot, null);
  assert.equal(IFX_STATE_KEY, "cydi.interstitial.ifx.v1");
  assert.notEqual(IFX_STATE_KEY, "cydi.interstitial.v1");
});

test("nothing that can reach analytics contains the installation id or a bucket: snapshot and record hold only version, cell, cadence, cap", () => {
  const id = population(1)[0];
  const store = memory();
  const snap = resolveSessionSnapshot(store, input({ installationId: id }));
  assert.deepEqual(Object.keys(snap).sort(), ["cadence", "cap", "cellId", "experimentVersion", "sessionId"]);
  const raw = store.raw()!;
  assert.equal(raw.includes(id), false);
  assert.equal(raw.includes("bucket"), false);
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ["assignment", "snapshot"]);
});

// --- Second opportunity --------------------------------------------------------------------------

test("second-opportunity gate: BYPASSED for participants (cap-2 cell, gate 0 or 50), unchanged for everyone else", () => {
  const ids = population(300);
  const participant: SessionSnapshot = { sessionId: S1, experimentVersion: 1, cellId: "A", cadence: 7, cap: 2 };
  const baseline: SessionSnapshot = { sessionId: S1, experimentVersion: null, cellId: null, cadence: 7, cap: 2 };
  for (const id of ids) {
    for (const pct of [0, 50, 100]) {
      assert.equal(isSecondOpportunityAllowed(participant, id, pct), true, `participant, ${pct}%`);
      assert.equal(isSecondOpportunityAllowed(baseline, id, pct), isSecondOpportunityEligible(id, pct), `baseline, ${pct}%`);
    }
  }
  assert.equal(isSecondOpportunityAllowed(participant, null, 0), true);
  assert.equal(isSecondOpportunityAllowed(baseline, null, 0), false);
  assert.ok(ids.some((id) => !isSecondOpportunityEligible(id, 50)), "sanity: 50% really excludes some installations");
});

// --- Structure: Rewarded is never touched ---------------------------------------------------------

function codeOnly(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");
}

test("the experiment modules never import or mention anything Rewarded (the lane logic stays in the controller)", () => {
  for (const file of ["./interstitialCells.ts", "./interstitialExperiment.ts"]) {
    const code = codeOnly(file);
    assert.equal(/rewarded/i.test(code), false, `${file} must not reference Rewarded`);
    assert.equal(/from\s+"\.\/(rewardedAds|admobAdapter|DoubleCoins)/.test(code), false, file);
    assert.equal(/from\s+"\.\.\/\.\.\/components/.test(code), false, file);
  }
  const cells = codeOnly("./interstitialCells.ts");
  for (const imported of [...cells.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1])) {
    assert.ok(["./interstitialExperiment", "./interstitialConfigSchema"].includes(imported), `unexpected import ${imported}`);
  }
});
