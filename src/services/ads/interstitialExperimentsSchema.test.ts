// The v3 multi-cell experiment's wire format and SAFETY ENVELOPE. This module is shared by the
// client and the Worker, so what is pinned here is what both enforce.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  INTERSTITIAL_CADENCES,
  isEffectiveInterstitialCadence,
  isValidInterstitialClientConfig,
  isValidInterstitialExperimentSpec,
  isValidStoredInterstitialExperiments,
  parseClientInterstitialExperiment,
  parseInterstitialV3Body,
  parseStoredInterstitialExperiments,
} from "./interstitialConfigSchema";

const cell = (id: string, cadence: number, cap: number, weight: number) => ({ id, cadence, cap, weight });
const SPEC = {
  enabled: true,
  rolloutPercentInTreatment: 20,
  version: 1,
  cells: [cell("A", 7, 2, 50), cell("B", 5, 2, 50)],
};
const valid = (spec: unknown) => isValidInterstitialExperimentSpec(spec);
const withCells = (cells: unknown[]) => ({ ...SPEC, cells });

test("a well-formed spec validates, including the dark launch state (enabled false, rollout 0)", () => {
  assert.equal(valid(SPEC), true);
  assert.equal(valid({ ...SPEC, enabled: false, rolloutPercentInTreatment: 0 }), true, "launch state is valid and a no-op");
  assert.equal(valid({ ...SPEC, rolloutPercentInTreatment: 100 }), true);
  assert.equal(valid({ ...SPEC, version: 1_000_000 }), true);
});

test("cadence: any integer 5..20 (the range analytics validates too); the BASE config set stays the closed legacy one", () => {
  for (const c of INTERSTITIAL_CADENCES) assert.ok(c >= 5 && c <= 20, "the legacy set sits inside the envelope");
  for (const bad of [4, 21, 0, -5, 7.5, "7", "6", null, NaN, Infinity]) {
    assert.equal(valid(withCells([cell("A", bad as number, 1, 50), cell("B", 7, 1, 50)])), false, `cadence ${String(bad)}`);
  }
  for (let c = 5; c <= 20; c++) assert.equal(valid(withCells([cell("A", c, 1, 50), cell("B", 7, 1, 50)])), true, `cadence ${c}`);
  // The configurable test grid: 7/2 vs 6/2 vs 5/2 needs no APK.
  assert.equal(valid(withCells([cell("A", 7, 2, 40), cell("B", 6, 2, 30), cell("C", 5, 2, 30)])), true);
  assert.equal(isEffectiveInterstitialCadence(6) && isEffectiveInterstitialCadence(5) && isEffectiveInterstitialCadence(20), true);
  assert.equal(isEffectiveInterstitialCadence(4) || isEffectiveInterstitialCadence(21) || isEffectiveInterstitialCadence(7.5) || isEffectiveInterstitialCadence("7"), false);
  // Base config: unchanged closed set (v1/v2 compatibility) - 6 is not a legal base cadence.
  assert.equal(isValidInterstitialClientConfig({ enabled: true, rolloutPercent: 10, gamesBetweenAds: 6, maxOpportunitiesPerSession: 1, countryEligible: true }), false);
  assert.equal(isValidInterstitialClientConfig({ enabled: true, rolloutPercent: 10, gamesBetweenAds: 7, maxOpportunitiesPerSession: 1, countryEligible: true }), true);
});

test("cap: 1..3 integer", () => {
  for (const bad of [0, 4, -1, 1.5, "2"]) {
    assert.equal(valid(withCells([cell("A", 20, bad as number, 50), cell("B", 7, 1, 50)])), false, `cap ${String(bad)}`);
  }
  assert.equal(valid(withCells([cell("A", 7, 3, 50), cell("B", 7, 1, 50)])), true);
});

test("joint rule cadence >= 2 * cap: 5/2 and 7/3 ok, 5/3 rejected", () => {
  assert.equal(valid(withCells([cell("A", 5, 2, 50), cell("B", 7, 1, 50)])), true);
  assert.equal(valid(withCells([cell("A", 7, 3, 50), cell("B", 7, 1, 50)])), true);
  assert.equal(valid(withCells([cell("A", 5, 3, 50), cell("B", 7, 1, 50)])), false);
  assert.equal(valid(withCells([cell("A", 5, 3, 50), cell("B", 5, 3, 50)])), false);
});

test("weights: integers 0..100 summing to exactly 100, at least two cells above zero", () => {
  assert.equal(valid(withCells([cell("A", 7, 1, 50), cell("B", 7, 1, 49)])), false, "sum 99");
  assert.equal(valid(withCells([cell("A", 7, 1, 51), cell("B", 7, 1, 50)])), false, "sum 101");
  assert.equal(valid(withCells([cell("A", 7, 1, 50.5), cell("B", 7, 1, 49.5)])), false, "non-integer");
  assert.equal(valid(withCells([cell("A", 7, 1, -10), cell("B", 7, 1, 110)])), false, "out of range");
  assert.equal(valid(withCells([cell("A", 7, 1, 100), cell("B", 7, 1, 0)])), false, "only one cell above zero");
  assert.equal(valid(withCells([cell("A", 7, 1, 60), cell("B", 7, 1, 40), cell("C", 5, 2, 0)])), true, "a 0-weight cell is allowed");
});

test("cells: 2..6, unique ids from A..F", () => {
  assert.equal(valid(withCells([cell("A", 7, 1, 100)])), false, "one cell");
  assert.equal(valid(withCells([])), false);
  const six = ["A", "B", "C", "D", "E", "F"].map((id, i) => cell(id, 7, 1, i < 4 ? 17 : 16));
  assert.equal(six.reduce((s, c) => s + c.weight, 0), 100);
  assert.equal(valid(withCells(six)), true, "six cells");
  assert.equal(valid(withCells([...six, cell("G", 7, 1, 0)])), false, "seven cells");
  assert.equal(valid(withCells([cell("A", 7, 1, 50), cell("A", 7, 1, 50)])), false, "duplicate ids");
  assert.equal(valid(withCells([cell("a", 7, 1, 50), cell("B", 7, 1, 50)])), false, "lower-case id");
  assert.equal(valid(withCells([cell("G", 7, 1, 50), cell("B", 7, 1, 50)])), false, "id outside A..F");
  assert.equal(valid({ ...SPEC, cells: "nope" }), false);
});

test("version 1..1000000 and rollout 0..100, integers; booleans are booleans", () => {
  for (const v of [0, -1, 1_000_001, 1.5, "1", null]) assert.equal(valid({ ...SPEC, version: v }), false, `version ${String(v)}`);
  for (const r of [-1, 101, 2.5, "10", null]) assert.equal(valid({ ...SPEC, rolloutPercentInTreatment: r }), false, `rollout ${String(r)}`);
  assert.equal(valid({ ...SPEC, enabled: "true" }), false);
});

test("the subtree is strict: unknown or missing keys (spec or cell) fail the whole experiment", () => {
  assert.equal(valid({ ...SPEC, extra: 1 }), false);
  const { enabled: _enabled, ...missing } = SPEC;
  assert.equal(valid(missing), false);
  assert.equal(valid(withCells([{ ...cell("A", 7, 1, 50), extra: 1 }, cell("B", 7, 1, 50)])), false);
  assert.equal(valid(withCells([{ id: "A", cadence: 7, cap: 1 }, cell("B", 7, 1, 100)])), false);
  assert.equal(valid(null), false);
  assert.equal(valid([]), false);
});

test("all-or-nothing: ONE bad cell turns the whole experiment off (nothing partially applied)", () => {
  const mixed = withCells([cell("A", 7, 1, 50), cell("B", 5, 3, 25), cell("C", 10, 1, 25)]);
  assert.equal(valid(mixed), false);
  assert.equal(parseClientInterstitialExperiment({ interstitial: mixed }), null);
});

test("client parse: tolerant beside `interstitial`, strict inside it, returns a detached copy", () => {
  assert.equal(parseClientInterstitialExperiment(undefined), null);
  assert.equal(parseClientInterstitialExperiment({ interstitial: SPEC, inkTrial: { x: 1 } })?.version, 1);
  assert.equal(parseClientInterstitialExperiment({ inkTrial: {} }), null);
  const parsed = parseClientInterstitialExperiment({ interstitial: SPEC });
  assert.deepEqual(parsed, SPEC);
  assert.notEqual(parsed, SPEC);
  assert.notEqual(parsed?.cells, SPEC.cells);
});

test("stored/PUT form: exactly { interstitial: valid }, strict at the top level", () => {
  assert.equal(isValidStoredInterstitialExperiments({ interstitial: SPEC }), true);
  assert.equal(isValidStoredInterstitialExperiments({ interstitial: SPEC, inkTrial: {} }), false);
  assert.equal(isValidStoredInterstitialExperiments({ interstital: SPEC }), false, "a typo is rejected, not silently ignored");
  assert.equal(isValidStoredInterstitialExperiments(SPEC), false);
  assert.deepEqual(parseStoredInterstitialExperiments(JSON.stringify({ interstitial: SPEC })), { interstitial: SPEC });
  assert.equal(parseStoredInterstitialExperiments("{nope"), null);
  assert.equal(parseStoredInterstitialExperiments(JSON.stringify({ interstitial: { ...SPEC, version: 0 } })), null);
});

test("v3 body: base strict as before, extras tolerated, experiments never invalidate the base", () => {
  const GOOD = { enabled: true, rolloutPercent: 80, gamesBetweenAds: 7, maxOpportunitiesPerSession: 2, countryEligible: true };
  assert.equal(isValidInterstitialClientConfig(GOOD), true, "the v2 body is untouched");
  assert.deepEqual(parseInterstitialV3Body(GOOD), { config: GOOD, experiment: null });
  const v3 = parseInterstitialV3Body({ ...GOOD, experiments: { interstitial: SPEC }, brandNewKey: 5 });
  assert.deepEqual(v3?.config, GOOD, "extras are dropped from the base, not validated");
  assert.deepEqual(v3?.experiment, SPEC);
  assert.deepEqual(parseInterstitialV3Body({ ...GOOD, experiments: { interstitial: { ...SPEC, version: 0 } } }), { config: GOOD, experiment: null });
  assert.equal(parseInterstitialV3Body({ ...GOOD, gamesBetweenAds: 6, experiments: { interstitial: SPEC } }), null);
  assert.equal(parseInterstitialV3Body(null), null);
  assert.equal(parseInterstitialV3Body([GOOD]), null);
});
