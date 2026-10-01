// The interstitial config client: fail-closed, frozen-per-run values with a LIVE
// `enabled`, and a QA override that only a debuggable build can honour.

import { strict as assert } from "node:assert";
import { test, beforeEach } from "node:test";

import {
  INTERSTITIAL_QA_OVERRIDE_KEY,
  _resetInterstitialConfigForTests,
  getFrozenInterstitialConfig,
  getQaForcedArm,
  isInterstitialLiveEnabled,
  isRewardedLifecycleV2Enabled,
  refreshInterstitialConfig,
  refreshInterstitialConfigIfStale,
} from "./interstitialConfig";
import { isValidInterstitialClientConfig } from "./interstitialConfigSchema";
import type { ApiResponse } from "../nativeApi";

const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const GOOD = { enabled: true, rolloutPercent: 5, gamesBetweenAds: 7, maxOpportunitiesPerSession: 1, countryEligible: true };

let next: () => Promise<ApiResponse>;
let calls = 0;
const respond = (status: number, body?: unknown) => async (): Promise<ApiResponse> => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

function setDebugBuild(debug: boolean | undefined): void {
  (globalThis as Record<string, unknown>).window = debug === undefined ? undefined : { Capacitor: { DEBUG: debug } };
}

beforeEach(() => {
  store.clear();
  calls = 0;
  setDebugBuild(undefined);
  _resetInterstitialConfigForTests(() => {
    calls++;
    return next();
  });
});

test("fail-closed before any answer", () => {
  assert.equal(getFrozenInterstitialConfig(), null);
  assert.equal(isInterstitialLiveEnabled(), false);
});

test("a valid answer freezes the run's values and sets the live switch", async () => {
  next = respond(200, GOOD);
  assert.equal(await refreshInterstitialConfig(), true);
  assert.deepEqual(getFrozenInterstitialConfig(), { rolloutPercent: 5, gamesBetweenAds: 7, maxOpportunitiesPerSession: 1, countryEligible: true, secondOpportunityRolloutPercent: 100 });
  assert.equal(isInterstitialLiveEnabled(), true);
});

test("later refreshes move ONLY enabled - cadence, rollout, cap and country stay frozen", async () => {
  next = respond(200, GOOD);
  await refreshInterstitialConfig();
  next = respond(200, { ...GOOD, enabled: false, rolloutPercent: 50, gamesBetweenAds: 5, maxOpportunitiesPerSession: 3, countryEligible: false });
  await refreshInterstitialConfig();
  assert.equal(isInterstitialLiveEnabled(), false, "the emergency switch is live");
  assert.deepEqual(getFrozenInterstitialConfig(), { rolloutPercent: 5, gamesBetweenAds: 7, maxOpportunitiesPerSession: 1, countryEligible: true, secondOpportunityRolloutPercent: 100 });
  next = respond(200, GOOD);
  await refreshInterstitialConfig();
  assert.equal(isInterstitialLiveEnabled(), true);
});

test("malformed or missing config fails closed", async () => {
  for (const body of [null, {}, { ...GOOD, gamesBetweenAds: 8 }, { ...GOOD, extra: 1 }, { enabled: true }, "yes"]) {
    _resetInterstitialConfigForTests(respond(200, body));
    await refreshInterstitialConfig();
    assert.equal(isInterstitialLiveEnabled(), false, JSON.stringify(body));
  }
  _resetInterstitialConfigForTests(respond(404));
  await refreshInterstitialConfig();
  assert.equal(isInterstitialLiveEnabled(), false);
});

test("an answer of 404 or a malformed body switches a running experiment off", async () => {
  next = respond(200, GOOD);
  await refreshInterstitialConfig();
  next = respond(404);
  await refreshInterstitialConfig();
  assert.equal(isInterstitialLiveEnabled(), false);
});

test("a network error, timeout or 5xx is not an answer: the last answer stands", async () => {
  next = respond(200, GOOD);
  await refreshInterstitialConfig();
  next = respond(503);
  assert.equal(await refreshInterstitialConfig(), false);
  assert.equal(isInterstitialLiveEnabled(), true);
  next = async () => {
    throw new Error("offline");
  };
  assert.equal(await refreshInterstitialConfig(), false);
  assert.equal(isInterstitialLiveEnabled(), true);
});

test("resume refreshes are throttled", async () => {
  next = respond(200, GOOD);
  await refreshInterstitialConfig(1_000_000);
  assert.equal(refreshInterstitialConfigIfStale(1_000_000 + 60_000), null);
  assert.ok(refreshInterstitialConfigIfStale(1_000_000 + 11 * 60_000));
});

test("the QA override is ignored on a non-debuggable build", async () => {
  store.set(INTERSTITIAL_QA_OVERRIDE_KEY, JSON.stringify({ ...GOOD, qaForceArm: "treatment" }));
  setDebugBuild(false);
  next = respond(404);
  await refreshInterstitialConfig();
  assert.equal(isInterstitialLiveEnabled(), false);
  assert.equal(getQaForcedArm(), null);
  assert.equal(calls, 1, "the network was used");
});

test("a debuggable build honours the QA override instead of the network", async () => {
  store.set(INTERSTITIAL_QA_OVERRIDE_KEY, JSON.stringify({ ...GOOD, gamesBetweenAds: 10, qaForceArm: "treatment" }));
  setDebugBuild(true);
  next = respond(404);
  await refreshInterstitialConfig();
  assert.equal(calls, 0);
  assert.equal(isInterstitialLiveEnabled(), true);
  assert.equal(getFrozenInterstitialConfig()?.gamesBetweenAds, 10);
  assert.equal(getQaForcedArm(), "treatment");
  // A malformed override is OFF, never "fall back to the network".
  store.set(INTERSTITIAL_QA_OVERRIDE_KEY, "{broken");
  await refreshInterstitialConfig();
  assert.equal(isInterstitialLiveEnabled(), false);
  assert.equal(calls, 0);
});

// --- 0.56 remote controls ---------------------------------------------------------------

test("the 0.56 client asks the Worker for the v2 shape", async () => {
  let asked = "";
  _resetInterstitialConfigForTests(async (path) => {
    asked = path;
    return respond(200, GOOD);
  });
  await refreshInterstitialConfig();
  assert.equal(asked, "/api/config/ads/interstitial?v=2");
});

test("rollout 0-100 and the two optional keys are accepted; 101, bad types and unknown keys are not", () => {
  const ok = (v: unknown) => isValidInterstitialClientConfig(v);
  assert.equal(ok({ ...GOOD, rolloutPercent: 0 }), true);
  assert.equal(ok({ ...GOOD, rolloutPercent: 100 }), true);
  assert.equal(ok({ ...GOOD, rolloutPercent: 101 }), false);
  assert.equal(ok({ ...GOOD, rolloutPercent: -1 }), false);
  assert.equal(ok({ ...GOOD, secondOpportunityRolloutPercent: 20, rewardedLifecycleV2: false }), true);
  assert.equal(ok({ ...GOOD, secondOpportunityRolloutPercent: 101 }), false);
  assert.equal(ok({ ...GOOD, secondOpportunityRolloutPercent: 2.5 }), false);
  assert.equal(ok({ ...GOOD, rewardedLifecycleV2: "no" }), false);
  assert.equal(ok({ ...GOOD, somethingElse: 1 }), false);
});

test("secondOpportunityRolloutPercent freezes with the run; rewardedLifecycleV2 is live and defaults ON", async () => {
  assert.equal(isRewardedLifecycleV2Enabled(), true, "default: v2 on");
  next = respond(200, { ...GOOD, secondOpportunityRolloutPercent: 20, rewardedLifecycleV2: false });
  await refreshInterstitialConfig();
  assert.equal(getFrozenInterstitialConfig()?.secondOpportunityRolloutPercent, 20);
  assert.equal(isRewardedLifecycleV2Enabled(), false, "the kill switch reaches a running app");
  next = respond(200, { ...GOOD, secondOpportunityRolloutPercent: 80 });
  await refreshInterstitialConfig();
  assert.equal(getFrozenInterstitialConfig()?.secondOpportunityRolloutPercent, 20, "frozen for the run");
  assert.equal(isRewardedLifecycleV2Enabled(), true, "an answer without the key means the default (on)");
});
