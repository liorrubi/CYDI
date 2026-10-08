// Rewarded Ink Trial config (0.57.1): its own validator, riding the v3 interstitial config answer as a top-level
// `ink` key. Fail-closed (absent / invalid / 404 = OFF), never able to touch the interstitial base or experiment,
// tolerant of future keys, and an installation-stable rollout bucket of its own.

import { strict as assert } from "node:assert";
import { beforeEach, test } from "node:test";
import {
  INK_TRIAL_KV_KEY,
  isValidStoredInkTrialConfig,
  parseClientInkTrialConfig,
  parseStoredInkTrialConfig,
  type InkTrialConfig,
} from "./inkTrialConfigSchema";
import {
  _resetInkTrialConfigForTests,
  doesActiveTrialApplyOn,
  getClassicRotation,
  getInkTrialConfig,
  inkRolloutBucket,
  installInkTrialConfigObserver,
  isInInkRollout,
  isInkOfferSurfaceOn,
} from "./inkTrialConfig";
import { _resetInterstitialConfigForTests, getFrozenInterstitialConfig, getInterstitialExperimentSpec, isInterstitialLiveEnabled, refreshInterstitialConfig } from "./interstitialConfig";
import type { ApiResponse } from "../nativeApi";

const INK: InkTrialConfig = {
  enabled: true,
  version: 1,
  rolloutPercent: 100,
  surfaces: { classic: true, playTogether: true, twoPlayers: true, daily: false },
  classicRotation: ["coin", "ink"],
};
const BASE = { enabled: true, rolloutPercent: 80, gamesBetweenAds: 7, maxOpportunitiesPerSession: 2, countryEligible: true };

function response(status: number, body?: unknown): ApiResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

let answer: () => Promise<ApiResponse>;
beforeEach(() => {
  answer = async () => response(200, BASE);
  _resetInterstitialConfigForTests(() => answer());
  _resetInkTrialConfigForTests({ config: null });
  installInkTrialConfigObserver();
});

test("its own KV key, never the interstitial's", () => {
  assert.equal(INK_TRIAL_KV_KEY, "config:ads:ink");
});

test("stored (admin PUT) validator is strict: exact keys, exact surfaces, closed values", () => {
  assert.equal(isValidStoredInkTrialConfig(INK), true);
  assert.equal(isValidStoredInkTrialConfig({ ...INK, extra: 1 }), false);
  assert.equal(isValidStoredInkTrialConfig({ ...INK, surfaces: { classic: true } }), false);
  assert.equal(isValidStoredInkTrialConfig({ ...INK, rolloutPercent: 101 }), false);
  assert.equal(isValidStoredInkTrialConfig({ ...INK, rolloutPercent: 25.5 }), false);
  assert.equal(isValidStoredInkTrialConfig({ ...INK, classicRotation: [] }), false);
  assert.equal(isValidStoredInkTrialConfig({ ...INK, classicRotation: ["coin", "coin", "coin", "coin", "coin", "coin", "ink"] }), false);
  assert.equal(isValidStoredInkTrialConfig({ ...INK, classicRotation: ["coin", "x3"] }), false);
  assert.equal(isValidStoredInkTrialConfig({ ...INK, version: 0 }), false);
  for (const pct of [0, 25, 50, 100]) assert.equal(isValidStoredInkTrialConfig({ ...INK, rolloutPercent: pct }), true, `${pct}% is supported`);
  assert.equal(parseStoredInkTrialConfig("{bad"), null);
});

test("client parser: unknown keys tolerated (top level and surfaces), unnamed surface = OFF, a bad known value = OFF", () => {
  const parsed = parseClientInkTrialConfig({ ...INK, futureKnob: 3, surfaces: { classic: true, futureMode: true } });
  assert.ok(parsed);
  assert.deepEqual(parsed.surfaces, { classic: true, playTogether: false, twoPlayers: false, daily: false });
  assert.equal(parseClientInkTrialConfig({ ...INK, enabled: "yes" }), null);
  assert.equal(parseClientInkTrialConfig({ ...INK, surfaces: { classic: 1 } }), null);
  assert.equal(parseClientInkTrialConfig(undefined), null);
});

test("no answer yet / a v3 body without `ink` / a 404 -> Ink OFF everywhere; the default rotation is 1:1", async () => {
  assert.equal(getInkTrialConfig(), null);
  assert.equal(isInkOfferSurfaceOn("classic"), false);
  await refreshInterstitialConfig();
  assert.equal(getInkTrialConfig(), null);
  answer = async () => response(404);
  await refreshInterstitialConfig();
  assert.equal(isInkOfferSurfaceOn("playTogether"), false);
  assert.deepEqual(getClassicRotation(), ["coin", "ink"]);
});

test("a v3 body WITH `ink` turns the surfaces on; a later answer without it turns them off (D8 is the store's job)", async () => {
  answer = async () => response(200, { ...BASE, ink: INK });
  await refreshInterstitialConfig();
  assert.equal(isInkOfferSurfaceOn("classic"), true);
  assert.equal(isInkOfferSurfaceOn("daily"), false, "Daily acquisition stays OFF");
  answer = async () => response(200, BASE);
  await refreshInterstitialConfig();
  assert.equal(isInkOfferSurfaceOn("classic"), false);
});

test("a network error is not an answer: the last Ink answer stands (exactly like the interstitial config)", async () => {
  answer = async () => response(200, { ...BASE, ink: INK });
  await refreshInterstitialConfig();
  answer = async () => {
    throw new Error("offline");
  };
  await refreshInterstitialConfig();
  assert.equal(isInkOfferSurfaceOn("classic"), true);
  answer = async () => response(503);
  await refreshInterstitialConfig();
  assert.equal(isInkOfferSurfaceOn("classic"), true);
});

test("an invalid `ink` can never invalidate the interstitial base or its experiment", async () => {
  const experiments = { interstitial: { enabled: true, rolloutPercentInTreatment: 100, version: 1, cells: [{ id: "A", cadence: 7, cap: 2, weight: 50 }, { id: "B", cadence: 5, cap: 2, weight: 50 }] } };
  answer = async () => response(200, { ...BASE, experiments, ink: { enabled: "garbage" } });
  await refreshInterstitialConfig();
  assert.equal(getInkTrialConfig(), null);
  assert.equal(isInterstitialLiveEnabled(), true);
  assert.equal(getFrozenInterstitialConfig()?.gamesBetweenAds, 7);
  assert.ok(getInterstitialExperimentSpec() !== null);
});

test("rollout: 100 = everyone (even without an id), 0 = no one, otherwise a stable bucket of Ink's own", () => {
  assert.equal(isInInkRollout(100, null), true);
  assert.equal(isInInkRollout(0, "abc"), false);
  assert.equal(isInInkRollout(50, null), false);
  const bucket = inkRolloutBucket("installation-1");
  assert.ok(bucket >= 0 && bucket < 100);
  assert.equal(inkRolloutBucket("installation-1"), bucket, "stable");
  assert.equal(isInInkRollout(bucket + 1, "installation-1"), true);
  assert.equal(isInInkRollout(bucket, "installation-1"), false);
  // Spread: 1,000 ids land in roughly half under 50.
  let under = 0;
  for (let i = 0; i < 1000; i++) if (inkRolloutBucket(`id-${i}`) < 50) under++;
  assert.ok(under > 400 && under < 600, `${under}`);
});

test("rollout gates offers per installation; an active Trial on Classic / Play Together / 2 Players ignores the config", () => {
  _resetInkTrialConfigForTests({ config: { ...INK, rolloutPercent: 0 } });
  assert.equal(isInkOfferSurfaceOn("classic"), false);
  _resetInkTrialConfigForTests({ config: null });
  for (const s of ["classic", "playTogether", "twoPlayers"] as const) assert.equal(doesActiveTrialApplyOn(s), true);
  assert.equal(doesActiveTrialApplyOn("daily"), false);
});
