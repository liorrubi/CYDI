// 0.57.0 pre-deploy verification of the v3 remote experiments config and the multi-cell
// interstitial experiment (sections E / F / G / H of the verification brief). ADDITIVE ONLY: it
// drives the shipped modules through their public API, never changes them, and complements the
// existing interstitial*.test.ts files rather than repeating them.
//
//   E  client side of the config: ?v=3 against an OLD Worker, every safety-envelope violation
//      failing to baseline / OFF, the pre-v3 schema section byte-identical to 0.56 (b45248b).
//   F  assignment statistics on 100,000 synthetic installation ids, versioning semantics and
//      "nothing identifying leaves the device".
//   G  long-session / multi-session simulations of the cap and cadence through the real controller.
//   H  single-ad-lane static guards (no Rewarded coupling in the experiment code, no Ink Trial / CTA logic).

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test, beforeEach } from "node:test";

import {
  _resetInterstitialControllerForTests,
  beginInterstitialResultCycle,
  getEffectiveInterstitialContext,
  getInterstitialControllerDebugInfo,
  recordInterstitialGameCompleted,
  recordInterstitialGameStarted,
  runInterstitialCheckpoint,
} from "./interstitialController";
import {
  _resetInterstitialAdsForTests,
  registerInterstitialAdapter,
  registerInterstitialGates,
  type InterstitialEnv,
  type InterstitialNativeEvent,
} from "./interstitialAds";
import {
  _resetInterstitialConfigForTests,
  getFrozenInterstitialConfig,
  getInterstitialExperimentSpec,
  isInterstitialLiveEnabled,
  isRewardedLifecycleV2Enabled,
  refreshInterstitialConfig,
} from "./interstitialConfig";
import {
  IFX_STATE_KEY,
  isInExperimentGate,
  parseIfxState,
  pickCell,
  resolveExperimentCell,
  resolveSessionSnapshot,
} from "./interstitialCells";
import { assignArm, assignmentBucket, isSecondOpportunityEligible, parseInterstitialState, stableBucket, type InterstitialStorage } from "./interstitialExperiment";
import {
  IFX_MAX_CADENCE,
  IFX_MAX_CAP,
  IFX_MAX_CELLS,
  IFX_MAX_VERSION,
  IFX_MIN_CADENCE,
  IFX_MIN_CAP,
  IFX_MIN_CELLS,
  isValidInterstitialClientConfig,
  isValidInterstitialExperimentSpec,
  parseClientInterstitialExperiment,
  parseInterstitialV3Body,
  type InterstitialExperimentSpec,
} from "./interstitialConfigSchema";
import { validateEventParams, type AnalyticsEventName } from "../analyticsSchema";
import type { ApiResponse } from "../nativeApi";

// --- Shared fixtures ------------------------------------------------------------------------------

/** Real analytics ids are 12 hex chars (48 random bits): a seeded PRNG gives the same shape, reproducibly. */
function population(n: number, seed = 0x9e3779b9): string[] {
  let a = seed | 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
  return Array.from({ length: n }, () => next().toString(16).padStart(8, "0") + (next() & 0xffff).toString(16).padStart(4, "0"));
}

const xcell = (id: string, cadence: number, cap: number, weight: number) => ({ id, cadence, cap, weight }) as InterstitialExperimentSpec["cells"][number];
const xspec = (over: Partial<InterstitialExperimentSpec> = {}): InterstitialExperimentSpec => ({
  enabled: true,
  rolloutPercentInTreatment: 100,
  version: 1,
  cells: [xcell("A", 7, 2, 50), xcell("B", 5, 2, 50)],
  ...over,
});

/** The live production baseline (config:ads:interstitial): rollout 80, cadence 7, cap 2, no optional keys. */
const PROD_BASE = { enabled: true, rolloutPercent: 80, gamesBetweenAds: 7, maxOpportunitiesPerSession: 2, countryEligible: true };

function response(status: number, body?: unknown): ApiResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

function memoryStorage(): InterstitialStorage & { raw: () => string | null } {
  let value: string | null = null;
  return { read: () => value, write: (v) => ((value = v), true), raw: () => value };
}

// ===================================================================================================
// E - client-side config verification
// ===================================================================================================

test("E: the pre-v3 section of interstitialConfigSchema.ts is byte-identical to the 0.56 release base (b45248b)", () => {
  const text = readFileSync(new URL("./interstitialConfigSchema.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const preV3 = text.split("// --- v3: remote multi-cell interstitial experiment (0.57+)")[0].trimEnd() + "\n";
  const sha = createHash("sha256").update(preV3).digest("hex");
  // sha256 of `git show b45248b:src/services/ads/interstitialConfigSchema.ts`: every validator a 0.53-0.56 client
  // (and the live Worker's legacy / ?v=2 path) uses is exactly the 0.56 code - v3 only APPENDS.
  assert.equal(sha, "05ad739864bbf0daeacaedfe1dab2cade41ffb32ae35a424d5c9d6837a727bc1");
});

test("E: ?v=3 answered by an OLD Worker (legacy 5-key body, rollout capped at 50, no optional keys): the 0.57 client keeps working with experiments OFF", async () => {
  // What the live 0.56 Worker answers for any `v` other than the literal "2": toClientConfig(config, country, false).
  const stored = { ...PROD_BASE, rolloutPercent: 80, secondOpportunityRolloutPercent: 40, rewardedLifecycleV2: false };
  const oldWorkerBody = {
    enabled: stored.enabled,
    rolloutPercent: Math.min(stored.rolloutPercent, 50),
    gamesBetweenAds: stored.gamesBetweenAds,
    maxOpportunitiesPerSession: stored.maxOpportunitiesPerSession,
    countryEligible: true,
  };
  let askedPath = "";
  _resetInterstitialConfigForTests(async (path) => ((askedPath = path), response(200, oldWorkerBody)));
  assert.equal(await refreshInterstitialConfig(), true);
  assert.equal(askedPath, "/api/config/ads/interstitial?v=3");
  assert.deepEqual(parseInterstitialV3Body(oldWorkerBody)?.experiment, null);
  assert.equal(getInterstitialExperimentSpec(), null, "experiments OFF");
  assert.equal(isInterstitialLiveEnabled(), true, "the interstitial itself keeps working");
  assert.deepEqual(getFrozenInterstitialConfig(), {
    rolloutPercent: 50, // DOCUMENTED SIDE EFFECT 1: stored 80 -> 50
    gamesBetweenAds: 7,
    maxOpportunitiesPerSession: 2,
    countryEligible: true,
    secondOpportunityRolloutPercent: 100, // DOCUMENTED SIDE EFFECT 2: the stored 40 is lost (absent = 100)
  });
  assert.equal(isRewardedLifecycleV2Enabled(), true, "DOCUMENTED SIDE EFFECT 3: a stored rewardedLifecycleV2:false kill switch is not delivered");

  // Side effect 1 quantified: capped at 50, the arms move. Everything in buckets [50, 80) is TREATMENT under the new
  // Worker (rollout 80) but CONTROL under an old Worker (rollout 50): ~30% of installations lose the interstitial.
  const ids = population(100_000);
  let flipped = 0;
  let controlToTreatment = 0;
  for (const id of ids) {
    const at80 = assignArm(id, 80);
    const at50 = assignArm(id, 50);
    if (at80 === "treatment" && at50 === "control") flipped++;
    if (at80 === "control" && at50 === "treatment") controlToTreatment++;
  }
  assert.ok(Math.abs(flipped / ids.length - 0.3) < 0.01, `treatment->control share ${(flipped / ids.length).toFixed(4)}`);
  assert.equal(controlToTreatment, 0);
});

test("E: an old-Worker answer still drives the baseline 7/2 sequence (no crash, no experiment)", async () => {
  const id = population(2000).find((x) => assignArm(x, 50) === "treatment")!;
  const sim = await simulateWith({ installation: id, servedBody: { ...PROD_BASE, rolloutPercent: 50 }, sessions: [40] });
  assert.deepEqual(sim.opportunities.map((o) => o.game), [7, 14]);
  assert.equal(sim.participation, "baseline");
});

type Case = [name: string, mutate: (spec: Record<string, unknown>) => Record<string, unknown>];
const cellsOf = (...cells: unknown[]) => (spec: Record<string, unknown>) => ({ ...spec, cells });
const VALID_SPEC = xspec({ cells: [xcell("A", 7, 2, 50), xcell("B", 5, 2, 50)] }) as unknown as Record<string, unknown>;

const BAD_SPEC_CASES: Case[] = [
  ["cadence 4", cellsOf(xcell("A", 4, 1, 50), xcell("B", 7, 2, 50))],
  ["cadence 21", cellsOf(xcell("A", 21, 1, 50), xcell("B", 7, 2, 50))],
  ["cadence 6.5 (non-integer)", cellsOf(xcell("A", 6.5, 2, 50), xcell("B", 7, 2, 50))],
  ['cadence "7" (string)', cellsOf({ ...xcell("A", 7, 2, 50), cadence: "7" }, xcell("B", 7, 2, 50))],
  ["cap 0", cellsOf(xcell("A", 7, 0, 50), xcell("B", 7, 2, 50))],
  ["cap 4", cellsOf(xcell("A", 20, 4, 50), xcell("B", 7, 2, 50))],
  ["cap 2.5 (non-integer)", cellsOf(xcell("A", 20, 2.5, 50), xcell("B", 7, 2, 50))],
  ["cap -1", cellsOf(xcell("A", 7, -1, 50), xcell("B", 7, 2, 50))],
  ["5/3 (cadence < 2 * cap)", cellsOf(xcell("A", 5, 3, 50), xcell("B", 7, 2, 50))],
  ["5/4", cellsOf(xcell("A", 5, 4, 50), xcell("B", 7, 2, 50))],
  ["6/4 (cap 4)", cellsOf(xcell("A", 6, 4, 50), xcell("B", 7, 2, 50))],
  ["1 cell", cellsOf(xcell("A", 7, 2, 100))],
  ["0 cells", cellsOf()],
  ["7 cells", cellsOf(...["A", "B", "C", "D", "E", "F", "G"].map((id, i) => xcell(id, 7, 2, i < 2 ? 15 : 14)))],
  ["cells not an array", (s) => ({ ...s, cells: { A: 1 } })],
  ["duplicate cell ids", cellsOf(xcell("A", 7, 2, 50), xcell("A", 5, 2, 50))],
  ["unknown cell id G", cellsOf(xcell("G", 7, 2, 50), xcell("B", 5, 2, 50))],
  ["lower-case cell id", cellsOf(xcell("a", 7, 2, 50), xcell("B", 5, 2, 50))],
  ["negative weight", cellsOf(xcell("A", 7, 2, 120), xcell("B", 5, 2, -20))],
  ["weights 99", cellsOf(xcell("A", 7, 2, 50), xcell("B", 5, 2, 49))],
  ["weights 101", cellsOf(xcell("A", 7, 2, 51), xcell("B", 5, 2, 50))],
  ["fractional weights summing to 100", cellsOf(xcell("A", 7, 2, 33.5), xcell("B", 5, 2, 66.5))],
  ["only one cell with weight > 0", cellsOf(xcell("A", 7, 2, 100), xcell("B", 5, 2, 0))],
  ["weight 101 on one cell", cellsOf(xcell("A", 7, 2, 101), xcell("B", 5, 2, -1))],
  ["version 0", (s) => ({ ...s, version: 0 })],
  ["version -1", (s) => ({ ...s, version: -1 })],
  ["version 1000001", (s) => ({ ...s, version: 1_000_001 })],
  ["version 1.5", (s) => ({ ...s, version: 1.5 })],
  ['version "1" (string)', (s) => ({ ...s, version: "1" })],
  ["rolloutPercentInTreatment 101", (s) => ({ ...s, rolloutPercentInTreatment: 101 })],
  ["rolloutPercentInTreatment -1", (s) => ({ ...s, rolloutPercentInTreatment: -1 })],
  ["rolloutPercentInTreatment 12.5", (s) => ({ ...s, rolloutPercentInTreatment: 12.5 })],
  ['enabled "true" (non-boolean)', (s) => ({ ...s, enabled: "true" })],
  ["enabled 1 (non-boolean)", (s) => ({ ...s, enabled: 1 })],
  ["extra key in the spec", (s) => ({ ...s, note: "x" })],
  ["missing key in the spec", (s) => ({ enabled: s.enabled, version: s.version, cells: s.cells })],
  ["extra key in a cell", cellsOf({ ...xcell("A", 7, 2, 50), label: "x" }, xcell("B", 5, 2, 50))],
  ["missing key in a cell", cellsOf({ id: "A", cadence: 7, cap: 2 }, xcell("B", 5, 2, 50))],
];

test("E: every safety-envelope violation is rejected by the client parser, so the experiment is OFF (and the base config still applies)", async () => {
  assert.equal(isValidInterstitialExperimentSpec(VALID_SPEC), true);
  for (const [name, mutate] of BAD_SPEC_CASES) {
    const bad = mutate({ ...VALID_SPEC });
    assert.equal(isValidInterstitialExperimentSpec(bad), false, name);
    assert.equal(parseClientInterstitialExperiment({ interstitial: bad }), null, name);
    const parsed = parseInterstitialV3Body({ ...PROD_BASE, experiments: { interstitial: bad } });
    assert.notEqual(parsed, null, `${name}: the base is NOT invalidated by a bad experiment`);
    assert.equal(parsed?.experiment, null, name);
    assert.deepEqual(parsed?.config, PROD_BASE, name);
  }
});

test("E: each violation, served on ?v=3, leaves the production baseline 80/7/2 exactly as before (experiments OFF)", async () => {
  const id = population(2000).find((x) => assignArm(x, 80) === "treatment" && isInExperimentGate(x, 1, 100))!;
  for (const [name, mutate] of BAD_SPEC_CASES) {
    const sim = await simulateWith({ installation: id, servedBody: { ...PROD_BASE, experiments: { interstitial: mutate({ ...VALID_SPEC }) } }, sessions: [30] });
    assert.deepEqual(sim.opportunities.map((o) => o.game), [7, 14], name);
    assert.equal(sim.participation, "baseline", name);
    assert.equal(sim.maxPerSession, 2, name);
  }
});

test("E: experiments missing, enabled:false, rollout 0 and the dark-launch state all mean baseline; baseline is 7/2 for everybody who takes part today", async () => {
  const id = population(2000).find((x) => assignArm(x, 80) === "treatment" && isInExperimentGate(x, 1, 100))!;
  for (const [name, experiments] of [
    ["missing", undefined],
    ["enabled false", { interstitial: xspec({ enabled: false }) }],
    ["rollout 0", { interstitial: xspec({ rolloutPercentInTreatment: 0 }) }],
    ["launch (disabled, rollout 0)", { interstitial: xspec({ enabled: false, rolloutPercentInTreatment: 0 }) }],
    ["non-object experiments", "boom"],
    ["experiments null", null],
    ["experiments array", []],
  ] as const) {
    const sim = await simulateWith({ installation: id, servedBody: { ...PROD_BASE, ...(experiments === undefined ? {} : { experiments }) }, sessions: [30, 30] });
    assert.deepEqual(sim.opportunities.filter((o) => o.session === 0).map((o) => o.game), [7, 14], name);
    assert.equal(sim.participation, "baseline", name);
    assert.ok(sim.checkpoints.every((c) => c.ifxCell === undefined && c.gamesBetweenAds === 7), `${name}: no ifx context, cadence 7`);
  }
});

test("E: control arm and installations outside the global rollout are untouched by a fully-on experiment; treatment outside the gate is 7/2", async () => {
  const spec = xspec({ rolloutPercentInTreatment: 30, cells: [xcell("A", 5, 2, 50), xcell("B", 6, 2, 50)] });
  const ids = population(4000);
  const control = ids.find((x) => assignArm(x, 80) === "control")!;
  const unassigned = ids.find((x) => assignArm(x, 5) === "unassigned")!; // outside the global rollout of 5
  const outsideGate = ids.find((x) => assignArm(x, 80) === "treatment" && !isInExperimentGate(x, 1, 30))!;
  const inside = ids.find((x) => assignArm(x, 80) === "treatment" && isInExperimentGate(x, 1, 30))!;

  const cs = await simulateWith({ installation: control, servedBody: { ...PROD_BASE, experiments: { interstitial: spec } }, sessions: [30] });
  assert.deepEqual(cs.opportunities.map((o) => [o.game, o.outcome]), [[7, "control"], [14, "control"]], "control: same 7/2 moments, nothing shown, no cell");
  assert.ok(cs.checkpoints.every((c) => c.arm === "control" && c.ifxCell === undefined && c.gamesBetweenAds === 7));
  assert.equal(cs.adLoads, 0);

  assert.ok(unassigned !== undefined);
  const us = await simulateWith({ installation: unassigned, servedBody: { ...PROD_BASE, rolloutPercent: 5, experiments: { interstitial: spec } }, sessions: [30] });
  assert.equal(us.opportunities.length, 0, "unassigned: takes no part at all");

  const og = await simulateWith({ installation: outsideGate, servedBody: { ...PROD_BASE, experiments: { interstitial: spec } }, sessions: [30] });
  assert.deepEqual(og.opportunities.map((o) => o.game), [7, 14], "treatment outside the experiment gate: 7/2");
  assert.equal(og.participation, "baseline");

  const ins = await simulateWith({ installation: inside, servedBody: { ...PROD_BASE, experiments: { interstitial: spec } }, sessions: [30] });
  assert.equal(ins.participation, "cell");
});

test("E: cadence 6 is accepted by the client config parser, the base-config parser keeps the closed set, and the client analytics validator takes 5..20", () => {
  const six = xspec({ cells: [xcell("A", 7, 2, 34), xcell("B", 6, 2, 33), xcell("C", 5, 2, 33)] });
  assert.equal(isValidInterstitialExperimentSpec(six), true);
  assert.equal(parseClientInterstitialExperiment({ interstitial: six })?.cells[1].cadence, 6);
  // The BASE config's cadence stays the legacy closed set: a stored/served base cadence 6 is invalid.
  assert.equal(isValidInterstitialClientConfig({ ...PROD_BASE, gamesBetweenAds: 6 }), false);
  for (let c = IFX_MIN_CADENCE; c <= IFX_MAX_CADENCE; c++) {
    assert.equal(validateEventParams("interstitial_checkpoint", { arm: "treatment", outcome: "shown", gamesBetweenAds: c, ifxCell: "B", ifxVersion: 1, ifxCap: 2 }).valid, true, `cadence ${c}`);
    assert.equal(validateEventParams("interstitial_continuation", { arm: "control", outcome: "control", gamesBetweenAds: c }).valid, true, `continuation ${c}`);
  }
  for (const bad of [4, 21, 6.5, "6"]) assert.equal(validateEventParams("interstitial_checkpoint", { arm: "treatment", outcome: "shown", gamesBetweenAds: bad }).valid, false);
});

test("E: the experiment mix examples (50/50, 34/33/33, 70/30, 40/30/30 over 7/2, 6/2, 5/2) are valid specs and bounded by the documented envelope", () => {
  const examples: InterstitialExperimentSpec["cells"][] = [
    [xcell("A", 7, 2, 50), xcell("B", 5, 2, 50)],
    [xcell("A", 7, 2, 34), xcell("B", 6, 2, 33), xcell("C", 5, 2, 33)],
    [xcell("A", 7, 2, 70), xcell("B", 5, 2, 30)],
    [xcell("A", 7, 2, 40), xcell("B", 6, 2, 30), xcell("C", 5, 2, 30)],
  ];
  for (const cells of examples) {
    assert.equal(isValidInterstitialExperimentSpec(xspec({ cells })), true);
    assert.ok(cells.every((c) => c.cadence >= IFX_MIN_CADENCE && c.cap <= 2 && c.cadence >= 2 * c.cap));
  }
  // The documented bound constants (values quoted in the report).
  assert.deepEqual([IFX_MIN_CADENCE, IFX_MAX_CADENCE, IFX_MIN_CAP, IFX_MAX_CAP, IFX_MIN_CELLS, IFX_MAX_CELLS, IFX_MAX_VERSION], [5, 20, 1, 3, 2, 6, 1_000_000]);
});

// ===================================================================================================
// F - assignment, versioning, independence, nothing identifying emitted
// ===================================================================================================

const N = 100_000;
const IDS = population(N);

test("F: same installation => same arm, same gate, same cell (re-evaluated from scratch, 100k ids)", () => {
  const s = xspec({ cells: [xcell("A", 7, 2, 34), xcell("B", 6, 2, 33), xcell("C", 5, 2, 33)], rolloutPercentInTreatment: 40 });
  for (const id of IDS) {
    assert.equal(assignArm(id, 80), assignArm(id, 80));
    assert.equal(isInExperimentGate(id, 1, 40), isInExperimentGate(id, 1, 40));
    assert.equal(pickCell(id, s).id, pickCell(id, s).id);
  }
  // Through the persisted path, on a cold storage each time: the same id lands in the same cell every session.
  for (const id of IDS.slice(0, 2000)) {
    const a = resolveSessionSnapshot(memoryStorage(), { sessionId: "sessA", installationId: id, arm: "treatment", base: { cadence: 7, cap: 2 }, spec: s });
    const b = resolveSessionSnapshot(memoryStorage(), { sessionId: "sessB", installationId: id, arm: "treatment", base: { cadence: 7, cap: 2 }, spec: s });
    assert.equal(a.cellId, b.cellId);
  }
});

/** Expected share of each cell among participants vs observed, over 100k ids. Tolerance: 4.5 binomial sigmas. */
const WEIGHT_SETS: [string, [string, number, number][]][] = [
  ["50/50", [["A", 7, 50], ["B", 5, 50]]],
  ["34/33/33", [["A", 7, 34], ["B", 6, 33], ["C", 5, 33]]],
  ["70/30", [["A", 7, 70], ["B", 5, 30]]],
  ["40/30/30", [["A", 7, 40], ["B", 6, 30], ["C", 5, 30]]],
  ["25/25/25/25/0/0 (0-weight cells never drawn)", [["A", 7, 25], ["B", 6, 25], ["C", 5, 25], ["D", 10, 25], ["E", 12, 0], ["F", 15, 0]]],
];

test("F: observed vs expected cell shares for several weight sets (100k ids, participants only), and the gate size tracks the rollout", () => {
  for (const rollout of [100, 30]) {
    for (const [label, cells] of WEIGHT_SETS) {
      const spec = xspec({ rolloutPercentInTreatment: rollout, cells: cells.map(([id, cad, w]) => xcell(id, cad, 2, w)) });
      const counts = new Map<string, number>();
      let participants = 0;
      for (const id of IDS) {
        if (assignArm(id, 80) !== "treatment" || !isInExperimentGate(id, 1, rollout)) continue;
        participants++;
        counts.set(pickCell(id, spec).id, (counts.get(pickCell(id, spec).id) ?? 0) + 1);
      }
      for (const [id, , w] of cells) {
        const p = w / 100;
        const observed = counts.get(id) ?? 0;
        const sigma = Math.sqrt(participants * p * (1 - p));
        assert.ok(Math.abs(observed - participants * p) <= 4.5 * sigma + (w === 0 ? 0 : 0), `${label} @${rollout}% cell ${id}: ${observed} vs ${(participants * p).toFixed(0)}`);
        if (w === 0) assert.equal(observed, 0);
      }
      // participants = treatment (80%) x gate (rollout%)
      const expectedParticipants = (N * 0.8 * rollout) / 100;
      assert.ok(Math.abs(participants - expectedParticipants) <= 4.5 * Math.sqrt(N * 0.8 * (rollout / 100) * (1 - (0.8 * rollout) / 100)) + 1, `${label}: participants ${participants} vs ${expectedParticipants}`);
    }
  }
});

test("F: a weights edit within the SAME version keeps every persisted cell; new users follow the new weights", () => {
  const v1 = xspec({ version: 5, cells: [xcell("A", 7, 2, 50), xcell("B", 5, 2, 50)] });
  const v1edited = xspec({ version: 5, cells: [xcell("A", 7, 2, 80), xcell("B", 5, 2, 20)] });
  let kept = 0;
  const counts = { A: 0, B: 0 };
  for (const id of IDS) {
    const first = resolveExperimentCell(id, v1, null);
    const after = resolveExperimentCell(id, v1edited, first.assignment); // returning installation
    if (after.cell?.id === first.cell.id) kept++;
    const fresh = resolveExperimentCell(id, v1edited, null); // brand-new installation under the edited weights
    counts[fresh.cell!.id as "A" | "B"]++;
  }
  assert.equal(kept, N, "a persisted participant never moves within a version");
  const sigma = Math.sqrt(N * 0.8 * 0.2);
  assert.ok(Math.abs(counts.A - 0.8 * N) <= 4.5 * sigma, `new users: A ${counts.A} vs ${0.8 * N}`);
});

test("F: a version change deliberately re-assigns (cells re-drawn, gate re-drawn); the same version keeps both", () => {
  const cells = [xcell("A", 7, 2, 34), xcell("B", 6, 2, 33), xcell("C", 5, 2, 33)];
  const v1 = xspec({ version: 1, cells });
  const v2 = xspec({ version: 2, cells });
  let sameCell = 0;
  let sameGate = 0;
  for (const id of IDS) {
    const persisted = resolveExperimentCell(id, v1, null).assignment;
    assert.equal(resolveExperimentCell(id, v1, persisted).cell?.id, persisted.cellId, "same version: kept");
    if (resolveExperimentCell(id, v2, persisted).cell!.id === persisted.cellId) sameCell++;
    if (isInExperimentGate(id, 1, 50) === isInExperimentGate(id, 2, 50)) sameGate++;
  }
  // Independent redraw: P(same cell) = sum p_i^2 = 0.34^2 + 2 * 0.33^2 = 0.3334; P(same gate) = 0.5.
  assert.ok(Math.abs(sameCell / N - 0.3334) < 0.01, `same cell after a version bump ${sameCell / N}`);
  assert.ok(Math.abs(sameGate / N - 0.5) < 0.01, `same gate after a version bump ${sameGate / N}`);
});

test("F: monotonic rollout - raising rolloutPercentInTreatment only adds participants (and keeps their cells); the global arm rollout only adds too", () => {
  const spec = (p: number) => xspec({ version: 3, rolloutPercentInTreatment: p, cells: [xcell("A", 7, 2, 50), xcell("B", 5, 2, 50)] });
  const steps = [0, 1, 5, 10, 20, 50, 80, 100];
  let prev = new Map<string, string>();
  for (const p of steps) {
    const cur = new Map<string, string>();
    for (const id of IDS) if (assignArm(id, 80) === "treatment" && isInExperimentGate(id, 3, p)) cur.set(id, pickCell(id, spec(p)).id);
    for (const [id, cellId] of prev) assert.equal(cur.get(id), cellId, `@${p}%: ${id} stays, same cell`);
    assert.ok(cur.size >= prev.size);
    prev = cur;
  }
  // arms: at a fixed rollout <= 50 treatment and control only grow; above 50 treatment only grows.
  const rollouts = [5, 20, 50, 80, 100];
  let treat = new Set<string>();
  for (const r of rollouts) {
    const cur = new Set(IDS.filter((id) => assignArm(id, r) === "treatment"));
    for (const id of treat) assert.ok(cur.has(id), `treatment @${r}`);
    treat = cur;
  }
});

function chiSquare(table: number[][]): number {
  const rows = table.map((r) => r.reduce((a, b) => a + b, 0));
  const cols = table[0].map((_, j) => table.reduce((a, r) => a + r[j], 0));
  const total = rows.reduce((a, b) => a + b, 0);
  let chi = 0;
  for (let i = 0; i < table.length; i++) for (let j = 0; j < cols.length; j++) {
    const expected = (rows[i] * cols[j]) / total;
    chi += (table[i][j] - expected) ** 2 / expected;
  }
  return chi;
}

test("F: arm bucket, gate bucket and cell bucket are practically independent (chi-square on 4x4 quartile grids, p = 0.001)", () => {
  const quartile = (bucket: number) => Math.min(3, Math.floor(bucket / 2500));
  const spec = xspec({ cells: [xcell("A", 7, 2, 25), xcell("B", 6, 2, 25), xcell("C", 5, 2, 25), xcell("D", 10, 2, 25)] });
  const ARM = IDS.map((id) => quartile(assignmentBucket(id)));
  const GATE = IDS.map((id) => [25, 50, 75].reduce((q, p) => q + (isInExperimentGate(id, 1, p) ? 0 : 1), 0)); // 0 = in the first 25% ... 3 = last
  const CELL = IDS.map((id) => ["A", "B", "C", "D"].indexOf(pickCell(id, spec).id));
  const grid = (x: number[], y: number[]) => {
    const t = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
    for (let i = 0; i < N; i++) t[x[i]][y[i]]++;
    return t;
  };
  const CRITICAL_DF9_P001 = 27.88;
  const stats = { armGate: chiSquare(grid(ARM, GATE)), armCell: chiSquare(grid(ARM, CELL)), gateCell: chiSquare(grid(GATE, CELL)) };
  for (const [name, chi] of Object.entries(stats)) assert.ok(chi < CRITICAL_DF9_P001, `${name}: chi2 ${chi.toFixed(2)} (df 9, critical ${CRITICAL_DF9_P001})`);
  // The three-way joint (64 cells, df 63, critical at p = 0.001 is ~103.4).
  const joint = new Array(64).fill(0);
  for (let i = 0; i < N; i++) joint[ARM[i] * 16 + GATE[i] * 4 + CELL[i]]++;
  const expected = N / 64;
  const chi3 = joint.reduce((a, o) => a + (o - expected) ** 2 / expected, 0);
  assert.ok(chi3 < 105, `3-way chi2 ${chi3.toFixed(2)}`);
  // Also against the legacy second-opportunity bucket (4x4 vs arm).
  const SECOND = IDS.map((id) => quartile(stableBucket("cydi-interstitial-second-v1", id)));
  assert.ok(chiSquare(grid(SECOND, GATE)) < CRITICAL_DF9_P001);
  assert.ok(chiSquare(grid(SECOND, ARM)) < CRITICAL_DF9_P001);
});

test("F: no bucket value and no installationId is emitted - params of every ifx-bearing event, persisted records, and the call sites", async () => {
  const spec = xspec({ cells: [xcell("A", 6, 2, 50), xcell("B", 5, 2, 50)] });
  const id = IDS.find((x) => assignArm(x, 80) === "treatment" && isInExperimentGate(x, 1, 100))!;
  const bucketValues = [assignmentBucket(id), stableBucket("cydi-interstitial-ifx-gate-v1", id), stableBucket("cydi-interstitial-ifx-cell-v1", id), stableBucket("cydi-interstitial-second-v1", id)];
  const sim = await simulateWith({ installation: id, servedBody: { ...PROD_BASE, experiments: { interstitial: spec } }, sessions: [20, 20], mode: "ready", continueGames: true });
  assert.equal(sim.participation, "cell");
  const ALLOWED_KEYS: Record<string, string[]> = {
    interstitial_checkpoint: ["arm", "outcome", "gamesBetweenAds", "attempt", "code", "latency", "notReadyCause", "reason", "ifxCell", "ifxVersion", "ifxCap"],
    interstitial_continuation: ["arm", "outcome", "gamesBetweenAds", "ifxCell", "ifxVersion", "ifxCap"],
  };
  const seen = new Set<string>();
  for (const t of sim.tracked) {
    const json = JSON.stringify(t.params);
    assert.ok(!json.includes(id), `${t.name}: installation id leaked`);
    assert.ok(!/bucket|installation/i.test(Object.keys(t.params).join(",")), `${t.name}: key names`);
    if (ALLOWED_KEYS[t.name]) for (const k of Object.keys(t.params)) assert.ok(ALLOWED_KEYS[t.name].includes(k), `${t.name}: unexpected key ${k}`);
    // numeric ifx values are the version / cap only, never a 0..9999 bucket
    for (const [k, v] of Object.entries(t.params)) if (typeof v === "number" && k.startsWith("ifx")) assert.ok(v <= 3 || v === 1, `${t.name}.${k}=${v}`);
    for (const b of bucketValues) if (b > 99) assert.ok(!new RegExp(`(^|[^0-9])${b}([^0-9]|$)`).test(json), `${t.name}: bucket value ${b} present`);
    seen.add(t.name);
  }
  assert.ok(seen.has("interstitial_checkpoint") && seen.has("interstitial_continuation"));
  const ctx = JSON.stringify(getEffectiveInterstitialContext());
  assert.ok(!ctx.includes(id));
  assert.deepEqual(Object.keys(getEffectiveInterstitialContext() as object).sort(), ["cadence", "cap", "cellId", "experimentVersion"]);
  // Persisted: the ifx record holds { assignment: {version, cellId}, snapshot: {sessionId, experimentVersion, cellId, cadence, cap} } only.
  const rawIfx = sim.ifxRaw!;
  assert.ok(!rawIfx.includes(id));
  const parsed = JSON.parse(rawIfx);
  assert.deepEqual(Object.keys(parsed).sort(), ["assignment", "snapshot"]);
  assert.deepEqual(Object.keys(parsed.assignment).sort(), ["cellId", "version"]);
  assert.deepEqual(Object.keys(parsed.snapshot).sort(), ["cadence", "cap", "cellId", "experimentVersion", "sessionId"]);
  assert.ok(!sim.stateRaw!.includes(id));
  assert.equal(IFX_STATE_KEY, "cydi.interstitial.ifx.v1");
  // Static call-site check: no track()/trackEvent() call in the experiment modules mentions the id or a bucket.
  for (const file of ["interstitialController.ts", "interstitialCells.ts", "playSegmentSummary.ts"]) {
    const src = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    for (const line of src.split(/\r?\n/)) {
      if (/\b(track|trackEvent)\(/.test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("*")) {
        assert.ok(!/installationId|bucket|hash/i.test(line), `${file}: ${line.trim()}`);
      }
    }
  }
  // Every analytics validator rejects the keys outright.
  assert.equal(validateEventParams("interstitial_checkpoint", { arm: "treatment", outcome: "shown", gamesBetweenAds: 6, ifxCell: "A", ifxVersion: 1, ifxCap: 2, installationId: "x" } as never).valid, false);
  assert.equal(validateEventParams("interstitial_checkpoint", { arm: "treatment", outcome: "shown", gamesBetweenAds: 6, ifxCell: "A", ifxVersion: 1, ifxCap: 2, ifxBucket: 4000 } as never).valid, false);
});

// ===================================================================================================
// G - cap / cadence simulation through the real controller
// ===================================================================================================

/** ready: every load succeeds; retry: the first attempt of an opportunity fails, the retry succeeds; nofill: every load fails; slow: a load never completes before the break. */
type Mode = "ready" | "retry" | "nofill" | "slow";
type Opportunity = { session: number; game: number; globalGame: number; outcome: string; attempt?: number; loadGames: number[]; returnedPromise: boolean };

type SimInput = {
  installation: string;
  servedBody: Record<string, unknown>;
  sessions: number[];
  mode?: Mode;
  /** Fire game_started after each checkpoint (continuation events) so telemetry paths run. */
  continueGames?: boolean;
};

function manualEnv(): InterstitialEnv {
  return { now: () => 0, setTimeout: () => 0, clearTimeout: () => {}, isHidden: () => false, onVisibilityChange: () => () => {}, platform: () => "android" };
}

function fakeAdapter() {
  const calls = { load: 0, show: 0 };
  let listener: (e: InterstitialNativeEvent) => void = () => {};
  let control: { resolve: () => void; reject: (e: unknown) => void } | null = null;
  registerInterstitialAdapter({
    name: "fake",
    load: () => {
      calls.load++;
      return new Promise<void>((resolve, reject) => {
        control = { resolve, reject };
      });
    },
    show: () => {
      calls.show++;
      return Promise.resolve();
    },
    setListener: (l) => {
      listener = l;
    },
  });
  return { calls, resolveLoad: () => control?.resolve(), rejectLoad: (code?: number) => control?.reject({ code }), fire: (e: InterstitialNativeEvent) => listener(e) };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

async function simulateWith(input: SimInput) {
  const tracked: { name: AnalyticsEventName; params: Record<string, unknown> }[] = [];
  const storage = memoryStorage();
  const ifxStore = memoryStorage();
  let session = "sess00000000";
  _resetInterstitialAdsForTests(manualEnv());
  registerInterstitialGates({ consent: () => true, remoteAds: () => true, interstitialEnabled: () => true });
  const ad = fakeAdapter();
  _resetInterstitialControllerForTests({
    track: (name, params) => tracked.push({ name, params: params as Record<string, unknown> }),
    storage,
    ifxStorage: ifxStore,
    sessionId: () => session,
    installationId: () => input.installation,
  });
  _resetInterstitialConfigForTests(async () => response(200, input.servedBody));
  await refreshInterstitialConfig();

  const mode = input.mode ?? "ready";
  const opportunities: Opportunity[] = [];
  const perSession: number[] = [];
  let globalGame = 0;
  let lastLoadCount = 0;
  let windowLoads: number[] = [];
  let loadsInWindow = 0;
  let participation: "baseline" | "cell" | "none" = "none";
  for (let s = 0; s < input.sessions.length; s++) {
    session = `sess${String(s + 1).padStart(8, "0")}`;
    perSession.push(0);
    for (let g = 1; g <= input.sessions[s]; g++) {
      globalGame++;
      beginInterstitialResultCycle();
      recordInterstitialGameCompleted("shapeChallenge");
      if (g === 1) {
        const ctx = getInterstitialControllerDebugInfo().participation;
        if (s === 0) participation = ctx === null ? "none" : ctx.cellId !== null ? "cell" : "baseline";
      }
      if (ad.calls.load > lastLoadCount) {
        windowLoads.push(globalGame);
        loadsInWindow += ad.calls.load - lastLoadCount;
        lastLoadCount = ad.calls.load;
        // The ad load finishes while the player looks at the Result screen (before the tap).
        if (mode === "ready") ad.resolveLoad();
        else if (mode === "retry") loadsInWindow === 1 ? ad.rejectLoad(3) : ad.resolveLoad();
        else if (mode === "nofill") ad.rejectLoad(3);
        await flush();
      }
      const before = tracked.filter((t) => t.name === "interstitial_checkpoint").length;
      const pending = runInterstitialCheckpoint();
      // A promise is returned ONLY while an ad is presented (the checkpoint event for `shown` is recorded at Showed).
      if (pending !== null) {
        ad.fire({ type: "showed" });
        ad.fire({ type: "dismissed" });
        assert.equal(await pending, true);
        lastLoadCount = ad.calls.load;
      }
      const cps = tracked.filter((t) => t.name === "interstitial_checkpoint");
      if (cps.length > before) {
        const p = cps[cps.length - 1].params;
        if (p.outcome !== "shown") assert.equal(pending, null, "no waiting unless an ad is actually presented");
        opportunities.push({ session: s, game: g, globalGame, outcome: String(p.outcome), attempt: p.attempt as number | undefined, loadGames: windowLoads, returnedPromise: pending !== null });
        perSession[s]++;
        windowLoads = [];
        loadsInWindow = 0;
      } else {
        assert.equal(pending, null);
      }
      if (input.continueGames) recordInterstitialGameStarted("shapeChallenge");
    }
  }
  return {
    opportunities,
    perSession,
    maxPerSession: Math.max(0, ...perSession),
    participation,
    adLoads: ad.calls.load,
    adShows: ad.calls.show,
    tracked,
    checkpoints: tracked.filter((t) => t.name === "interstitial_checkpoint").map((t) => t.params),
    ifxRaw: ifxStore.raw(),
    stateRaw: storage.raw(),
  };
}

/** An installation that is treatment, inside the gate and drawn into `cellId` by `spec`. */
function idInCell(spec: InterstitialExperimentSpec, cellId: string): string {
  for (const id of IDS) if (assignArm(id, 80) === "treatment" && isInExperimentGate(id, spec.version, 100) && pickCell(id, spec).id === cellId) return id;
  throw new Error("no id");
}

const PARTICIPANT_CONFIGS: [label: string, cadence: number, cap: number][] = [
  ["7/2", 7, 2],
  ["6/2", 6, 2],
  ["5/2", 5, 2],
  ["10/2", 10, 2],
  ["7/1", 7, 1],
];

/** Independent model of the rule (cadence counted from the last consumed opportunity, cap per analytics session). */
function model(cadence: number, cap: number, sessions: number[]) {
  const out: { session: number; game: number }[] = [];
  let since = 0;
  sessions.forEach((n, s) => {
    let used = 0;
    for (let g = 1; g <= n; g++) {
      since++;
      if (used < cap && since >= cadence) {
        out.push({ session: s, game: g });
        used++;
        since = 0;
      }
    }
  });
  return out;
}

test("G: checkpoint games, per-session maximum and 'never a third ad' for 7/2, 6/2, 5/2, 10/2 and 7/1 - as experiment cells AND as the base config", async () => {
  const EXPECT: Record<string, { s1: number[]; later: number[] }> = {
    // single long session of 100 games: only the first `cap` opportunities occur; later sessions start with since carried over
    "7/2": { s1: [7, 14], later: [1, 8] },
    "6/2": { s1: [6, 12], later: [1, 7] },
    "5/2": { s1: [5, 10], later: [1, 6] },
    "10/2": { s1: [10, 20], later: [1, 11] },
    "7/1": { s1: [7], later: [1] },
  };
  for (const [label, cadence, cap] of PARTICIPANT_CONFIGS) {
    const spec = xspec({ cells: [xcell("A", cadence, cap, 50), xcell("B", 20, 1, 50)] });
    const id = idInCell(spec, "A");
    const inputs: [string, SimInput][] = [
      ["cell", { installation: id, servedBody: { ...PROD_BASE, experiments: { interstitial: spec } }, sessions: [100, 100, 100] }],
    ];
    // as the base config (closed legacy cadence set only): 7/2, 10/2, 5/2 and 7/1 - 6 is not a legal BASE cadence
    if ([5, 7, 10].includes(cadence)) {
      const treatmentId = IDS.find((x) => assignArm(x, 80) === "treatment")!;
      inputs.push(["base", { installation: treatmentId, servedBody: { ...PROD_BASE, gamesBetweenAds: cadence, maxOpportunitiesPerSession: cap }, sessions: [100, 100, 100] }]);
    }
    for (const [via, input] of inputs) {
      const sim = await simulateWith(input);
      const tag = `${label} via ${via}`;
      assert.deepEqual(sim.opportunities.filter((o) => o.session === 0).map((o) => o.game), EXPECT[label].s1, `${tag}: session 1`);
      assert.deepEqual(sim.opportunities.filter((o) => o.session === 1).map((o) => o.game), EXPECT[label].later, `${tag}: session 2 (cadence progress carries over)`);
      assert.deepEqual(sim.opportunities.filter((o) => o.session === 2).map((o) => o.game), EXPECT[label].later, `${tag}: session 3`);
      assert.deepEqual(sim.perSession.map((n) => Math.min(n, cap)), sim.perSession, `${tag}: never more than cap per session`);
      assert.equal(sim.maxPerSession, cap, `${tag}: exactly cap reached, never a third`);
      assert.equal(sim.adShows, sim.opportunities.length, `${tag}: every opportunity showed (ads always load in this scenario)`);
      assert.ok(sim.opportunities.every((o) => o.outcome === "shown"), tag);
      // against the independent model
      assert.deepEqual(sim.opportunities.map((o) => ({ session: o.session, game: o.game })), model(cadence, cap, [100, 100, 100]), tag);
    }
  }
});

test("G: many short sessions (3 games each) and mixed session lengths keep the cadence progress and reset only the cap", async () => {
  const sessions = [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 25, 1, 1, 30, 2, 2, 2, 40];
  for (const [label, cadence, cap] of PARTICIPANT_CONFIGS) {
    const spec = xspec({ cells: [xcell("A", cadence, cap, 50), xcell("B", 20, 1, 50)] });
    const sim = await simulateWith({ installation: idInCell(spec, "A"), servedBody: { ...PROD_BASE, experiments: { interstitial: spec } }, sessions });
    assert.deepEqual(sim.opportunities.map((o) => ({ session: o.session, game: o.game })), model(cadence, cap, sessions), label);
    assert.ok(sim.perSession.every((n) => n <= cap), `${label}: ${sim.perSession.join(",")}`);
    // spacing: consecutive opportunities are always >= cadence completed games apart (no two ads back to back)
    for (let i = 1; i < sim.opportunities.length; i++) assert.ok(sim.opportunities[i].globalGame - sim.opportunities[i - 1].globalGame >= cadence, `${label}: spacing at ${i}`);
  }
});

test("G: load schedule - attempt 1 two games before the break, ONE retry the game before, never a third, never waiting at the break", async () => {
  for (const [label, cadence, cap] of [["7/2", 7, 2], ["6/2", 6, 2], ["5/2", 5, 2], ["10/2", 10, 2]] as const) {
    const spec = xspec({ cells: [xcell("A", cadence, cap, 50), xcell("B", 20, 1, 50)] });
    const id = idInCell(spec, "A");
    const run = (mode: Mode) => simulateWith({ installation: id, servedBody: { ...PROD_BASE, experiments: { interstitial: spec } }, sessions: [4 * cadence], mode });

    const ready = await run("ready");
    assert.deepEqual(ready.opportunities.map((o) => o.loadGames), [[cadence - 2], [2 * cadence - 2]], `${label} ready: one load per opportunity at cadence-2`);
    assert.ok(ready.opportunities.every((o) => o.outcome === "shown" && o.attempt === 1), `${label} ready`);

    const retry = await run("retry");
    assert.deepEqual(retry.opportunities.map((o) => o.loadGames), [[cadence - 2, cadence - 1], [2 * cadence - 2, 2 * cadence - 1]], `${label} retry: attempt 1 at cadence-2, retry at cadence-1`);
    assert.ok(retry.opportunities.every((o) => o.outcome === "shown" && o.attempt === 2), `${label} retry: the second attempt is the one shown`);

    const nofill = await run("nofill");
    assert.deepEqual(nofill.opportunities.map((o) => o.loadGames), [[cadence - 2, cadence - 1], [2 * cadence - 2, 2 * cadence - 1]], `${label} no fill: two attempts per opportunity, never a third`);
    assert.ok(nofill.opportunities.every((o) => o.outcome === "not_ready" && o.attempt === 2 && !o.returnedPromise), `${label}: not ready -> consumed at once, the break returns null (no spinner / wait)`);
    assert.equal(nofill.perSession[0], cap, `${label}: a not_ready still consumes the opportunity, so still no third`);
    assert.equal(nofill.adShows, 0);
    assert.equal(nofill.adLoads, 2 * cap, `${label}: no load after the cap is used`);

    const slow = await run("slow");
    assert.deepEqual(slow.opportunities[0].loadGames, [cadence - 2], `${label} slow: a load still in flight is never joined by a second one`);
    assert.ok(slow.opportunities.every((o) => o.outcome === "not_ready" && !o.returnedPromise), `${label} slow: the break never waits for a load`);
    assert.equal(slow.adShows, 0);
    assert.ok(slow.perSession[0] <= cap);
  }
});

test("G: second opportunity vs secondOpportunityRolloutPercent 0 / 50 / 100 - participants never blocked, non-participants keep the legacy gate", async () => {
  const spec = xspec({ cells: [xcell("A", 6, 2, 50), xcell("B", 5, 2, 50)] });
  for (const pct of [0, 50, 100]) {
    // an installation the legacy gate EXCLUDES at this percentage (none exists at 100)
    const candidates = IDS.filter((x) => assignArm(x, 80) === "treatment" && isInExperimentGate(x, 1, 100));
    const excluded = candidates.find((x) => !isSecondOpportunityEligible(x, pct));
    const included = candidates.find((x) => isSecondOpportunityEligible(x, pct))!;
    for (const id of [excluded, included]) {
      if (id === undefined) {
        assert.ok(pct === 100 || pct === 0, "only the degenerate percentages have an empty side"); // 100: nobody excluded; 0: nobody included
        continue;
      }
      const cadence = pickCell(id, spec).cadence;
      const part = await simulateWith({ installation: id, servedBody: { ...PROD_BASE, secondOpportunityRolloutPercent: pct, experiments: { interstitial: spec } }, sessions: [4 * cadence] });
      assert.deepEqual(part.opportunities.map((o) => o.game), [cadence, 2 * cadence], `participant @${pct}% legacy gate (${isSecondOpportunityEligible(id, pct) ? "included" : "excluded"})`);
      const base = await simulateWith({ installation: id, servedBody: { ...PROD_BASE, secondOpportunityRolloutPercent: pct }, sessions: [40] });
      assert.deepEqual(
        base.opportunities.map((o) => o.game),
        isSecondOpportunityEligible(id, pct) ? [7, 14] : [7],
        `non-participant @${pct}%: legacy gate exactly as 0.56`,
      );
    }
  }
});

test("G: session reset + snapshot - a config change mid-session cannot alter cadence/cap; a cold start in the same session keeps the snapshot; a new session re-snapshots", async () => {
  const spec = xspec({ version: 1, cells: [xcell("A", 5, 2, 50), xcell("B", 20, 1, 50)] });
  const id = idInCell(spec, "A");
  const tracked: unknown[] = [];
  const storage = memoryStorage();
  const ifxStore = memoryStorage();
  let session = "sess00000001";
  let served: Record<string, unknown> = { ...PROD_BASE, experiments: { interstitial: spec } };
  const boot = async () => {
    _resetInterstitialAdsForTests(manualEnv());
    registerInterstitialGates({ consent: () => true, remoteAds: () => true, interstitialEnabled: () => true });
    fakeAdapter();
    _resetInterstitialControllerForTests({ track: (n, p) => tracked.push([n, p]), storage, ifxStorage: ifxStore, sessionId: () => session, installationId: () => id });
    _resetInterstitialConfigForTests(async () => response(200, served));
    await refreshInterstitialConfig();
  };
  await boot();
  assert.deepEqual(getEffectiveInterstitialContext(), { experimentVersion: 1, cellId: "A", cadence: 5, cap: 2 });
  // (1) a LIVE mid-session refresh to a hostile config (version bump, 20/1 cells, then removed): nothing moves this session
  served = { ...PROD_BASE, experiments: { interstitial: xspec({ version: 2, cells: [xcell("A", 20, 1, 50), xcell("B", 20, 1, 50)] }) } };
  await refreshInterstitialConfig();
  assert.equal(getInterstitialExperimentSpec()?.version, 2, "the live spec did change");
  assert.deepEqual(getEffectiveInterstitialContext(), { experimentVersion: 1, cellId: "A", cadence: 5, cap: 2 }, "live change: snapshot pinned");
  served = { ...PROD_BASE };
  await refreshInterstitialConfig();
  assert.equal(getInterstitialExperimentSpec(), null);
  assert.deepEqual(getEffectiveInterstitialContext(), { experimentVersion: 1, cellId: "A", cadence: 5, cap: 2 }, "experiments removed live: snapshot pinned");
  // (2) a cold start INSIDE the same session, under the hostile config
  served = { ...PROD_BASE, experiments: { interstitial: xspec({ version: 2, cells: [xcell("A", 20, 1, 50), xcell("B", 20, 1, 50)] }) } };
  await boot();
  assert.deepEqual(getEffectiveInterstitialContext(), { experimentVersion: 1, cellId: "A", cadence: 5, cap: 2 }, "snapshot persisted per session");
  assert.deepEqual(parseIfxState(ifxStore.raw()).snapshot, { sessionId: "sess00000001", experimentVersion: 1, cellId: "A", cadence: 5, cap: 2 });
  // (3) a new analytics session (30-minute idle in the real app) re-snapshots under the current config (version 2: re-drawn)
  session = "sess00000002";
  const ctx = getEffectiveInterstitialContext()!;
  assert.equal(ctx.experimentVersion, 2);
  assert.equal(ctx.cadence, 20);
  assert.equal(ctx.cap, 1);
  assert.equal(parseInterstitialState(storage.raw()).session, null, "the opportunity counter is untouched by snapshots");
  assert.equal(SESSION_IDLE_TIMEOUT_MS_FROM_SOURCE(), 30 * 60 * 1000);
});

function SESSION_IDLE_TIMEOUT_MS_FROM_SOURCE(): number {
  const src = readFileSync(new URL("../analyticsIdentity.ts", import.meta.url), "utf8");
  const m = /SESSION_IDLE_TIMEOUT_MS = (\d+) \* (\d+) \* (\d+)/.exec(src);
  return m ? Number(m[1]) * Number(m[2]) * Number(m[3]) : -1;
}

// ===================================================================================================
// H - single ad lane: static guards (the behavioural lane tests live in interstitialController.test.ts)
// ===================================================================================================

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("H: the experiment code never imports, reads or mutates Rewarded state", () => {
  for (const file of ["interstitialCells.ts", "interstitialExperiment.ts", "interstitialConfigSchema.ts", "interstitialConfig.ts"]) {
    const src = read(`./${file}`);
    assert.ok(!/from\s+"[^"]*rewarded[^"]*"/i.test(src), `${file} imports nothing Rewarded`);
    assert.ok(!/import\([^)]*rewarded/i.test(src), `${file} has no dynamic Rewarded import`);
  }
  // The controller is the only meeting point and uses exactly one Rewarded symbol: the read-only lifecycle subscription.
  const controller = read("./interstitialController.ts");
  const rewardedImports = [...controller.matchAll(/import\s*\{([^}]*)\}\s*from\s*"\.\/rewardedAds"/g)].map((m) => m[1].trim());
  assert.deepEqual(rewardedImports, ["subscribeRewardedAdEvents"]);
  // Rewarded cadence is independent of the interstitial and of the experiment. The ONLY thing it knows about the
  // interstitial is the boolean `interstitialDue` its caller passes to decideResultOffer (unchanged since 0.56): no
  // import of the interstitial / experiment modules, no cell, version or cadence value.
  const cadence = read("../../app/rewardedOfferCadence.ts");
  assert.ok(!/froms+"[^"]*interstitial/i.test(cadence), "no import from any interstitial module");
  assert.ok(!/ifx|InterstitialCell|interstitialCells|getEffectiveInterstitialContext|gamesBetweenAds|IFX_/.test(cadence), "no experiment / cell / cadence coupling");
  assert.deepEqual([...cadence.matchAll(/^import .*from "([^"]+)"/gm)].map((m) => m[1]).sort(), ["../services/analyticsIdentity", "../services/analyticsSchema"]);
});

test("H: no Ink Trial / pending-purchase CTA logic exists in the 0.57.0 tree (only hostile-key test fixtures mention `inkTrial`)", () => {
  const needles = /inktrial|ink[-_ ]trial|pendingPurchaseCta|ctaClaimed/i;
  const files = [
    "services/ads/interstitialController.ts",
    "services/ads/interstitialCells.ts",
    "services/ads/interstitialConfig.ts",
    "services/ads/interstitialConfigSchema.ts",
    "services/ads/interstitialExperiment.ts",
    "services/ads/playSegmentSummary.ts",
    "services/ads/rewardedAds.ts",
    "services/analyticsSchema.ts",
    "app/rewardedOfferCadence.ts",
    "screens/ShapeChallengeScreen.tsx",
    "components/DoubleCoinsOffer.tsx",
  ];
  for (const f of files) assert.ok(!needles.test(read(`../../${f}`)), f);
  assert.ok(!needles.test(read("../../../worker/index.ts")));
});

beforeEach(() => {
  // every test boots its own world; nothing is shared between tests
});
