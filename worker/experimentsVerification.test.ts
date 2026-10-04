// 0.57.0 pre-deploy verification, Worker side of the v3 remote experiments config (section E of the brief):
// the legacy and ?v=2 bodies are byte-identical to the 0.56 release base (b45248b) whatever is stored under
// config:ads:experiments, a 0.56 client still validates every body it can ever be served, the PUT /
// GET ?v=3 pair fails safe for every safety-envelope violation, and cadence 6 (any effective integer 3..20) travels
// through the Worker analytics validator, the Analytics Engine mapping and the Durable Object counters.
// ADDITIVE ONLY - drives the shipped Worker through its public fetch / exports.
import test from "node:test";
import assert from "node:assert/strict";

const worker = (await import("./index.ts")).default;
const { INTERSTITIAL_CONFIG_KV_KEY, INTERSTITIAL_EXPERIMENTS_KV_KEY, isValidStoredInterstitialExperiments, parseInterstitialV3Body } = await import(
  "../src/services/ads/interstitialConfigSchema.ts"
);
const { validateEventParams } = await import("../src/services/analyticsSchema.ts");
const { buildShadowDataPoints } = await import("./analyticsShadow.ts");
const { incrementEvent } = await import("./analyticsDO.ts");

const TOKEN = "content-admin-test-token";

class FakeKv {
  store = new Map<string, string>();
  reads: string[] = [];
  async get(key: string): Promise<string | null> {
    this.reads.push(key);
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}
const makeEnv = () => {
  const kv = new FakeKv();
  return { kv, env: { CONTENT_KV: kv, CONTENT_ADMIN_TOKEN: TOKEN } as never };
};
function request(path: string, init: RequestInit = {}, country?: string): Request {
  const req = new Request(`https://playcydi.com${path}`, init);
  if (country !== undefined) Object.defineProperty(req, "cf", { value: { country }, configurable: true });
  return req;
}
const get = async (env: never, path: string, country?: string) => {
  const res = await worker.fetch(request(path, {}, country), env);
  return { status: res.status, text: await res.text(), headers: res.headers };
};
const put = (env: never, path: string, body: unknown) =>
  worker.fetch(request(path, { method: "PUT", headers: { authorization: `Bearer ${TOKEN}` }, body: typeof body === "string" ? body : JSON.stringify(body) }), env);

// --- The 0.56 base (b45248b), reproduced verbatim as the oracle ------------------------------------------------------

type Stored = { enabled: boolean; rolloutPercent: number; gamesBetweenAds: number; maxOpportunitiesPerSession: number; blockedCountries: string[]; secondOpportunityRolloutPercent?: number; rewardedLifecycleV2?: boolean };

/** `toClientConfig` + the GET handler of b45248b: v2 = (`v` === "2"). Anything else is the legacy five-key body. */
function base056Body(stored: Stored, country: unknown, v: string | null): string {
  const v2 = v === "2";
  const NEVER = new Set(["XX", "T1", "ZZ"]);
  const eligible = typeof country === "string" && /^[A-Z]{2}$/.test(country) && !NEVER.has(country) && !stored.blockedCountries.includes(country);
  const base = {
    enabled: stored.enabled,
    rolloutPercent: v2 ? stored.rolloutPercent : Math.min(stored.rolloutPercent, 50),
    gamesBetweenAds: stored.gamesBetweenAds,
    maxOpportunitiesPerSession: stored.maxOpportunitiesPerSession,
    countryEligible: eligible,
  };
  if (!v2) return JSON.stringify(base);
  return JSON.stringify({
    ...base,
    ...(stored.secondOpportunityRolloutPercent !== undefined ? { secondOpportunityRolloutPercent: stored.secondOpportunityRolloutPercent } : {}),
    ...(stored.rewardedLifecycleV2 !== undefined ? { rewardedLifecycleV2: stored.rewardedLifecycleV2 } : {}),
  });
}

/** What a 0.56 client validates (isValidInterstitialClientConfig of b45248b), copied verbatim. */
function valid056(value: unknown): boolean {
  const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isRecord(value)) return false;
  const required = ["enabled", "rolloutPercent", "gamesBetweenAds", "maxOpportunitiesPerSession", "countryEligible"];
  const optional = ["secondOpportunityRolloutPercent", "rewardedLifecycleV2"];
  const keys = Object.keys(value);
  if (!(required.every((k) => keys.includes(k)) && keys.every((k) => required.includes(k) || optional.includes(k)))) return false;
  const pct = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100;
  return (
    typeof value.enabled === "boolean" &&
    pct(value.rolloutPercent) &&
    [5, 7, 10, 12, 15, 20].includes(value.gamesBetweenAds as number) &&
    [1, 2].includes(value.maxOpportunitiesPerSession as number) &&
    typeof value.countryEligible === "boolean" &&
    (!("secondOpportunityRolloutPercent" in value) || pct(value.secondOpportunityRolloutPercent)) &&
    (!("rewardedLifecycleV2" in value) || typeof value.rewardedLifecycleV2 === "boolean")
  );
}
/** What a pre-0.56 client validates (isValidLegacyInterstitialClientConfig): exact five keys, rollout 0-50. */
function validLegacy(value: unknown): boolean {
  if (!valid056(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 5 && (v.rolloutPercent as number) <= 50;
}

const xcell = (id: string, cadence: number, cap: number, weight: number) => ({ id, cadence, cap, weight });
const EXPERIMENT = { enabled: true, rolloutPercentInTreatment: 20, version: 1, cells: [xcell("A", 7, 2, 50), xcell("B", 5, 2, 50)] };
const EXPERIMENTS = { interstitial: EXPERIMENT };
const PROD: Stored = { enabled: true, rolloutPercent: 80, gamesBetweenAds: 7, maxOpportunitiesPerSession: 2, blockedCountries: ["CU", "IR", "KP", "SY"] };

const EXPERIMENT_STATES: [string, string | null][] = [
  ["missing", null],
  ["valid", JSON.stringify(EXPERIMENTS)],
  ["invalid (cells empty)", JSON.stringify({ interstitial: { ...EXPERIMENT, cells: [] } })],
  ["garbage", "{{not json"],
  ["valid but with a foreign key", JSON.stringify({ ...EXPERIMENTS, inkTrial: { enabled: true } })],
];

// --- E: legacy / ?v=2 byte-identical to the 0.56 base ------------------------------------------------------------

test("E: legacy, ?v=2 and every other `v` value are BYTE-IDENTICAL to the 0.56 base for any stored config, country and experiments state; v3 never reads its key on them", async () => {
  const rollouts = [0, 5, 50, 80, 100];
  const stores: Stored[] = [];
  for (const rolloutPercent of rollouts) for (const gamesBetweenAds of [5, 7, 20]) for (const maxOpportunitiesPerSession of [1, 2]) {
    stores.push({ ...PROD, rolloutPercent, gamesBetweenAds, maxOpportunitiesPerSession });
    stores.push({ ...PROD, enabled: false, rolloutPercent, gamesBetweenAds, maxOpportunitiesPerSession, secondOpportunityRolloutPercent: 40, rewardedLifecycleV2: false });
  }
  let compared = 0;
  for (const stored of stores) {
    for (const [state, raw] of EXPERIMENT_STATES) {
      const { kv, env } = makeEnv();
      kv.store.set(INTERSTITIAL_CONFIG_KV_KEY, JSON.stringify(stored));
      if (raw !== null) kv.store.set(INTERSTITIAL_EXPERIMENTS_KV_KEY, raw);
      for (const country of ["DE", "IR", "XX", undefined]) {
        for (const v of [null, "2", "1", "", "foo", "22", "03"]) {
          const path = `/api/config/ads/interstitial${v === null ? "" : `?v=${v}`}`;
          const res = await get(env, path, country);
          assert.equal(res.status, 200);
          assert.equal(res.text, base056Body(stored, country, v), `${path} country=${String(country)} experiments=${state}`);
          assert.match(res.headers.get("cache-control") ?? "", /private, max-age=60/);
          compared++;
        }
      }
      assert.equal(kv.reads.includes(INTERSTITIAL_EXPERIMENTS_KV_KEY), false, "no read of the experiments key on legacy / v2 paths");
    }
  }
  assert.ok(compared > 7000, `compared ${compared} bodies`);
});

test("E: the production baseline (80 / 7 / 2, blocked CU IR KP SY, no optional keys) on every path", async () => {
  const { kv, env } = makeEnv();
  kv.store.set(INTERSTITIAL_CONFIG_KV_KEY, JSON.stringify(PROD));
  kv.store.set(INTERSTITIAL_EXPERIMENTS_KV_KEY, JSON.stringify({ interstitial: { ...EXPERIMENT, enabled: false, rolloutPercentInTreatment: 0 } }));
  assert.deepEqual(JSON.parse((await get(env, "/api/config/ads/interstitial", "DE")).text), { enabled: true, rolloutPercent: 50, gamesBetweenAds: 7, maxOpportunitiesPerSession: 2, countryEligible: true });
  const v2 = JSON.parse((await get(env, "/api/config/ads/interstitial?v=2", "DE")).text);
  assert.deepEqual(v2, { enabled: true, rolloutPercent: 80, gamesBetweenAds: 7, maxOpportunitiesPerSession: 2, countryEligible: true });
  const v3 = JSON.parse((await get(env, "/api/config/ads/interstitial?v=3", "DE")).text);
  const { experiments, ...rest } = v3;
  assert.deepEqual(rest, v2, "v3 = v2 + experiments, nothing else moves (rollout 80, no optional keys, cadence 7, cap 2)");
  assert.deepEqual(experiments, { interstitial: { ...EXPERIMENT, enabled: false, rolloutPercentInTreatment: 0 } });
  for (const country of ["IR", "CU", "KP", "SY"]) assert.equal(JSON.parse((await get(env, "/api/config/ads/interstitial?v=3", country)).text).countryEligible, false, country);
  assert.equal("secondOpportunityRolloutPercent" in v3, false, "absent => 100 on the client");
  assert.equal("rewardedLifecycleV2" in v3, false, "absent => rewarded lifecycle v2 stays on");
});

test("E: ?v=3 is exactly the 0.56 ?v=2 body (+ experiments when valid) for every state, and a 0.56 client validates every legacy / v2 body it can be served", async () => {
  for (const stored of [PROD, { ...PROD, secondOpportunityRolloutPercent: 0, rewardedLifecycleV2: false }, { ...PROD, rolloutPercent: 100, maxOpportunitiesPerSession: 1 as number }]) {
    for (const [state, raw] of EXPERIMENT_STATES) {
      const { kv, env } = makeEnv();
      kv.store.set(INTERSTITIAL_CONFIG_KV_KEY, JSON.stringify(stored));
      if (raw !== null) kv.store.set(INTERSTITIAL_EXPERIMENTS_KV_KEY, raw);
      const v2Text = base056Body(stored, "DE", "2");
      const v3 = await get(env, "/api/config/ads/interstitial?v=3", "DE");
      const v3Json = JSON.parse(v3.text);
      const { experiments, ...rest } = v3Json;
      assert.deepEqual(rest, JSON.parse(v2Text), `v3 base == 0.56 v2 body (${state})`);
      assert.equal(experiments !== undefined, state === "valid", `experiments only when valid (${state})`);
      if (experiments !== undefined) assert.deepEqual(experiments, EXPERIMENTS);
      else assert.equal(v3.text, v2Text, `v3 without experiments is byte-identical to the 0.56 v2 body (${state})`);

      // 0.56 clients: ?v=2 body (experiments absent / present in KV / invalid in KV) always validates; a pre-0.56 client validates the plain body.
      const v2 = await get(env, "/api/config/ads/interstitial?v=2", "DE");
      assert.equal(valid056(JSON.parse(v2.text)), true, `0.56 validator accepts ?v=2 (experiments ${state})`);
      assert.equal(v2.text, v2Text);
      const legacy = await get(env, "/api/config/ads/interstitial", "DE");
      assert.equal(validLegacy(JSON.parse(legacy.text)), true, `pre-0.56 validator accepts the plain body (experiments ${state})`);
      // the 0.57 client also reads the v3 body whatever it carries
      assert.notEqual(parseInterstitialV3Body(v3Json), null, `0.57 client accepts ?v=3 (${state})`);
    }
  }
  // Documented: a v3 body that CARRIES experiments is NOT acceptable to a 0.56 client (exact-key validation). That is
  // harmless only because 0.56 never asks for ?v=3 - and why `experiments` can never be added to the v2 / plain bodies.
  assert.equal(valid056({ ...JSON.parse(base056Body(PROD, "DE", "2")), experiments: EXPERIMENTS }), false);
});

test("E: an OLD Worker answers ?v=3 with the legacy body: rollout capped at 50, optional keys dropped (the documented Worker-first side effect)", () => {
  const stored: Stored = { ...PROD, secondOpportunityRolloutPercent: 40, rewardedLifecycleV2: false };
  const oldAnswer = JSON.parse(base056Body(stored, "DE", "3")); // the old Worker treats `v=3` as legacy
  assert.deepEqual(oldAnswer, { enabled: true, rolloutPercent: 50, gamesBetweenAds: 7, maxOpportunitiesPerSession: 2, countryEligible: true });
  const parsed = parseInterstitialV3Body(oldAnswer);
  assert.notEqual(parsed, null, "still a valid base for the 0.57 client");
  assert.equal(parsed?.experiment, null, "experiments OFF");
  assert.equal(parsed?.config.rolloutPercent, 50, "SIDE EFFECT: 80 -> 50 (installations in buckets 50-80 move treatment -> control)");
  assert.equal("secondOpportunityRolloutPercent" in (parsed?.config ?? {}), false, "SIDE EFFECT: optional keys lost");
});

// --- E: the envelope, enforced at the Worker --------------------------------------------------------------------

const with2 = (cells: unknown[]) => ({ interstitial: { ...EXPERIMENT, cells } });
const BAD: Record<string, unknown> = {
  "cadence 2": with2([xcell("A", 2, 1, 50), xcell("B", 7, 2, 50)]),
  "cadence 0": with2([xcell("A", 0, 1, 50), xcell("B", 7, 2, 50)]),
  "cadence 11": with2([xcell("A", 11, 1, 50), xcell("B", 7, 2, 50)]),
  "cadence 12 (legal for the BASE, not for a cell)": with2([xcell("A", 12, 1, 50), xcell("B", 7, 2, 50)]),
  "cadence 20": with2([xcell("A", 20, 1, 50), xcell("B", 7, 2, 50)]),
  "cadence 21": with2([xcell("A", 21, 1, 50), xcell("B", 7, 2, 50)]),
  "cadence 6.5": with2([xcell("A", 6.5, 2, 50), xcell("B", 7, 2, 50)]),
  'cadence "7"': with2([{ ...xcell("A", 7, 2, 50), cadence: "7" }, xcell("B", 7, 2, 50)]),
  "cap 0": with2([xcell("A", 7, 0, 50), xcell("B", 7, 2, 50)]),
  "cap 6": with2([xcell("A", 7, 6, 50), xcell("B", 7, 2, 50)]),
  "cap 2.5": with2([xcell("A", 7, 2.5, 50), xcell("B", 7, 2, 50)]),
  "3/6": with2([xcell("A", 3, 6, 50), xcell("B", 7, 2, 50)]),
  "negative weight": with2([xcell("A", 7, 2, 120), xcell("B", 5, 2, -20)]),
  "weights 99": with2([xcell("A", 7, 2, 50), xcell("B", 5, 2, 49)]),
  "weights 101": with2([xcell("A", 7, 2, 51), xcell("B", 5, 2, 50)]),
  "fractional weights": with2([xcell("A", 7, 2, 33.5), xcell("B", 5, 2, 66.5)]),
  "one cell": with2([xcell("A", 7, 2, 100)]),
  "7 cells": with2(["A", "B", "C", "D", "E", "F", "G"].map((id, i) => xcell(id, 7, 2, i < 2 ? 15 : 14))),
  "duplicate ids": with2([xcell("A", 7, 2, 50), xcell("A", 5, 2, 50)]),
  "unknown cell id": with2([xcell("G", 7, 2, 50), xcell("B", 5, 2, 50)]),
  "one positive weight": with2([xcell("A", 7, 2, 100), xcell("B", 5, 2, 0)]),
  "version 0": { interstitial: { ...EXPERIMENT, version: 0 } },
  "version -1": { interstitial: { ...EXPERIMENT, version: -1 } },
  "version 1000001": { interstitial: { ...EXPERIMENT, version: 1_000_001 } },
  "version 1.5": { interstitial: { ...EXPERIMENT, version: 1.5 } },
  'version "1"': { interstitial: { ...EXPERIMENT, version: "1" } },
  "rollout 101": { interstitial: { ...EXPERIMENT, rolloutPercentInTreatment: 101 } },
  "rollout -1": { interstitial: { ...EXPERIMENT, rolloutPercentInTreatment: -1 } },
  'enabled "true"': { interstitial: { ...EXPERIMENT, enabled: "true" } },
  "extra key in spec": { interstitial: { ...EXPERIMENT, note: 1 } },
  "extra key in cell": with2([{ ...xcell("A", 7, 2, 50), label: "x" }, xcell("B", 5, 2, 50)]),
  "extra top-level key": { ...EXPERIMENTS, other: {} },
  "interstitial missing": {},
  "interstitial array": { interstitial: [] },
};

test("E: every envelope violation is a 400 on PUT with nothing written, and is omitted (OFF) when it reaches KV by hand; the base still answers", async () => {
  for (const [name, value] of Object.entries(BAD)) {
    const { kv, env } = makeEnv();
    assert.equal((await put(env, "/api/config/ads/experiments", value)).status, 400, name);
    assert.equal(kv.store.has(INTERSTITIAL_EXPERIMENTS_KV_KEY), false, `${name}: not written`);
    kv.store.set(INTERSTITIAL_CONFIG_KV_KEY, JSON.stringify(PROD));
    kv.store.set(INTERSTITIAL_EXPERIMENTS_KV_KEY, JSON.stringify(value));
    const v3 = await get(env, "/api/config/ads/interstitial?v=3", "DE");
    assert.equal(v3.status, 200, name);
    assert.equal(v3.text, base056Body(PROD, "DE", "2"), `${name}: v3 == v2 (experiments OFF), base 80/7/2 intact`);
  }
});

test("E: valid shapes accepted by the Worker: 7/2 vs 5/2, 7/2 vs 6/2 vs 5/2 (34/33/33, 40/30/30), 70/30, a 0-weight cell, 6 cells, 7/3 and 6/3, 10/1, the owner's independent cadence/cap list - and nothing else moves", async () => {
  const sets: unknown[][] = [
    [xcell("A", 7, 2, 50), xcell("B", 5, 2, 50)],
    [xcell("A", 7, 2, 34), xcell("B", 6, 2, 33), xcell("C", 5, 2, 33)],
    [xcell("A", 7, 2, 40), xcell("B", 6, 2, 30), xcell("C", 5, 2, 30)],
    [xcell("A", 7, 2, 70), xcell("B", 5, 2, 30)],
    [xcell("A", 7, 2, 60), xcell("B", 5, 2, 40), xcell("C", 10, 1, 0)],
    ["A", "B", "C", "D", "E", "F"].map((id, i) => xcell(id, 7, 1, i < 4 ? 17 : 16)),
    [xcell("A", 7, 3, 50), xcell("B", 6, 3, 50)],
    [xcell("A", 10, 1, 50), xcell("B", 5, 2, 50)],
    // no joint rule (owner decision, 4 Oct 2026): 7/2, 6/2, 5/2, 5/3, 7/4, 5/4, 3/2, 3/5 are all inside the envelope
    [xcell("A", 7, 2, 17), xcell("B", 6, 2, 17), xcell("C", 5, 2, 17), xcell("D", 5, 3, 17), xcell("E", 7, 4, 16), xcell("F", 5, 4, 16)],
    [xcell("A", 3, 2, 50), xcell("B", 3, 5, 50)],
    [xcell("A", 3, 3, 20), xcell("B", 4, 4, 20), xcell("C", 6, 5, 20), xcell("D", 8, 3, 20), xcell("E", 9, 4, 20)],
  ];
  for (const cells of sets) {
    const { kv, env } = makeEnv();
    kv.store.set(INTERSTITIAL_CONFIG_KV_KEY, JSON.stringify(PROD));
    const body = { interstitial: { ...EXPERIMENT, cells } };
    assert.equal((await put(env, "/api/config/ads/experiments", body)).status, 200);
    assert.equal(isValidStoredInterstitialExperiments(body), true);
    assert.deepEqual(JSON.parse((await get(env, "/api/config/ads/interstitial?v=3", "DE")).text).experiments, body);
  }
});

// --- E: cadence 6 through the Worker analytics validator, AE mapping and DO counters ----------------------------------

const env = (eventName: string, params: unknown) => ({ eventName, params, platform: "android", appVersion: "0.57.0", appVersionCode: 57, installationId: "inst-SECRET-1234567890", sessionId: "sess-SECRET-1234567890", isInternal: false });

test("E: cadence 3..20 (6 included) passes the shared validator the Worker and the DO use, reaches AE (double9) and the DO per-cadence counter; 2 / 21 / 6.5 / '6' do not", () => {
  let acc = {} as ReturnType<typeof incrementEvent>;
  for (let c = 3; c <= 20; c++) {
    const params = { arm: "treatment", outcome: "shown", gamesBetweenAds: c, ifxCell: "B", ifxVersion: 1, ifxCap: 2 };
    assert.equal(validateEventParams("interstitial_checkpoint" as never, params).valid, true, `validator ${c}`);
    const points = buildShadowDataPoints("/event", JSON.stringify(env("interstitial_checkpoint", params)), "de", () => 0.5);
    assert.equal(points.length, 1, `AE accepts ${c}`);
    assert.equal(points[0].doubles[8], c, `AE double9 = cadence ${c}`);
    acc = incrementEvent(acc as never, "interstitial_checkpoint" as never, params as never, "android") as typeof acc;
  }
  const byCadence = (acc as unknown as { interstitial_checkpoint: { byCadence: Record<string, number> } }).interstitial_checkpoint.byCadence;
  assert.deepEqual(Object.keys(byCadence).sort((a, b) => Number(a) - Number(b)), Array.from({ length: 18 }, (_, i) => String(i + 3)), "bounded at 18 keys");
  assert.equal(byCadence["6"], 1);
  for (const bad of [2, 21, 0, 6.5, "6", null]) {
    const params = { arm: "treatment", outcome: "shown", gamesBetweenAds: bad };
    assert.equal(validateEventParams("interstitial_checkpoint" as never, params as never).valid, false, `validator ${String(bad)}`);
    assert.equal(buildShadowDataPoints("/event", JSON.stringify(env("interstitial_checkpoint", params)), "de", () => 0.5).length, 0, `AE rejects ${String(bad)}`);
  }
});
