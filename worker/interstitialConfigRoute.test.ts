// GET/PUT /api/config/ads/interstitial - the experiment's own route. Proves the
// country decision is server-side from request.cf.country, the client learns only a
// boolean, a missing/malformed config fails closed, and /api/config/ads (which
// released clients validate strictly) is byte-for-byte untouched.
import test from "node:test";
import assert from "node:assert/strict";

const worker = (await import("./index.ts")).default;
const { INTERSTITIAL_CONFIG_KV_KEY, isValidInterstitialClientConfig } = await import("../src/services/ads/interstitialConfigSchema.ts");
const { ADS_CONFIG_KV_KEY, isValidRemoteAdsConfig } = await import("../src/services/ads/remoteAdsConfigSchema.ts");

const CONTENT_TOKEN = "content-admin-test-token";

class FakeKv {
  store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

function makeEnv(kv = new FakeKv()) {
  return { kv, env: { CONTENT_KV: kv, CONTENT_ADMIN_TOKEN: CONTENT_TOKEN } as never };
}

function request(path: string, init: RequestInit = {}, country?: string): Request {
  const req = new Request(`https://playcydi.com${path}`, init);
  if (country !== undefined) Object.defineProperty(req, "cf", { value: { country }, configurable: true });
  return req;
}

const STORED = {
  enabled: false,
  rolloutPercent: 5,
  gamesBetweenAds: 7,
  maxOpportunitiesPerSession: 1,
  blockedCountries: ["IR"],
};

test("no config published -> 404 (the client treats that as off)", async () => {
  const { env } = makeEnv();
  const res = await worker.fetch(request("/api/config/ads/interstitial", {}, "DE"), env);
  assert.equal(res.status, 404);
});

test("the response carries only countryEligible - never the blocked list or the country", async () => {
  const { kv, env } = makeEnv();
  kv.store.set(INTERSTITIAL_CONFIG_KV_KEY, JSON.stringify(STORED));
  const res = await worker.fetch(request("/api/config/ads/interstitial", {}, "DE"), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { enabled: false, rolloutPercent: 5, gamesBetweenAds: 7, maxOpportunitiesPerSession: 1, countryEligible: true });
  assert.equal(isValidInterstitialClientConfig(body), true);
  assert.match(res.headers.get("cache-control") ?? "", /private/, "per-country answer must not be shared-cached");
});

test("a blocked network country, an unknown one, Tor and a missing cf are all ineligible", async () => {
  const { kv, env } = makeEnv();
  kv.store.set(INTERSTITIAL_CONFIG_KV_KEY, JSON.stringify(STORED));
  for (const country of ["IR", "XX", "T1", "ZZ", "", "de"]) {
    const res = await worker.fetch(request("/api/config/ads/interstitial", {}, country), env);
    assert.equal(((await res.json()) as { countryEligible: boolean }).countryEligible, false, `country ${JSON.stringify(country)}`);
  }
  const res = await worker.fetch(request("/api/config/ads/interstitial"), env);
  assert.equal(((await res.json()) as { countryEligible: boolean }).countryEligible, false, "no cf at all");
});

test("the client cannot supply its own country", async () => {
  const { kv, env } = makeEnv();
  kv.store.set(INTERSTITIAL_CONFIG_KV_KEY, JSON.stringify(STORED));
  const res = await worker.fetch(
    request("/api/config/ads/interstitial?country=DE", { headers: { "x-cydi-country": "DE", "cf-ipcountry": "DE" } }, "IR"),
    env,
  );
  assert.equal(((await res.json()) as { countryEligible: boolean }).countryEligible, false);
});

test("a stored config that fails validation is a 500, never a partial answer", async () => {
  const { kv, env } = makeEnv();
  kv.store.set(INTERSTITIAL_CONFIG_KV_KEY, JSON.stringify({ ...STORED, gamesBetweenAds: 6 }));
  const res = await worker.fetch(request("/api/config/ads/interstitial", {}, "DE"), env);
  assert.equal(res.status, 500);
});

test("PUT needs the content admin token and a fully valid body", async () => {
  const { kv, env } = makeEnv();
  const put = (body: unknown, token?: string) =>
    worker.fetch(
      request("/api/config/ads/interstitial", {
        method: "PUT",
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: JSON.stringify(body),
      }),
      env,
    );
  assert.equal((await put(STORED)).status, 401);
  assert.equal((await put(STORED, "wrong")).status, 401);
  for (const bad of [
    { ...STORED, rolloutPercent: 101 },
    { ...STORED, secondOpportunityRolloutPercent: 101 },
    { ...STORED, rewardedLifecycleV2: "off" },
    { ...STORED, gamesBetweenAds: 8 },
    { ...STORED, maxOpportunitiesPerSession: 3 },
    { ...STORED, maxOpportunitiesPerSession: 4 },
    { ...STORED, blockedCountries: ["ir"] },
    { ...STORED, extra: true },
    { enabled: true },
  ]) {
    assert.equal((await put(bad, CONTENT_TOKEN)).status, 400, JSON.stringify(bad));
  }
  assert.equal(kv.store.has(INTERSTITIAL_CONFIG_KV_KEY), false);
  assert.equal((await put(STORED, CONTENT_TOKEN)).status, 200);
  assert.deepEqual(JSON.parse(kv.store.get(INTERSTITIAL_CONFIG_KV_KEY)!), STORED);
});

test("/api/config/ads is untouched: same key, same exact { enabled } shape released clients require", async () => {
  const { kv, env } = makeEnv();
  kv.store.set(ADS_CONFIG_KV_KEY, JSON.stringify({ enabled: true }));
  kv.store.set(INTERSTITIAL_CONFIG_KV_KEY, JSON.stringify({ ...STORED, enabled: true }));
  const res = await worker.fetch(request("/api/config/ads", {}, "DE"), env);
  const body = await res.json();
  assert.deepEqual(body, { enabled: true });
  assert.equal(isValidRemoteAdsConfig(body), true);
  assert.notEqual(ADS_CONFIG_KV_KEY, INTERSTITIAL_CONFIG_KV_KEY);
});

// --- 0.56: full range + optional keys, without ever breaking a released client ------------------

const { isValidLegacyInterstitialClientConfig } = await import("../src/services/ads/interstitialConfigSchema.ts");

test("a stored rollout above 50 (and the optional keys) is accepted, and a released client still gets a config it validates", async () => {
  const { kv, env } = makeEnv();
  const wide = { ...STORED, enabled: true, rolloutPercent: 100, secondOpportunityRolloutPercent: 20, rewardedLifecycleV2: false };
  const put = await worker.fetch(
    request("/api/config/ads/interstitial", { method: "PUT", headers: { authorization: `Bearer ${CONTENT_TOKEN}` }, body: JSON.stringify(wide) }),
    env,
  );
  assert.equal(put.status, 200);
  assert.ok(kv.store.has(INTERSTITIAL_CONFIG_KV_KEY));

  // Released clients ask for the plain path: exactly five keys, rollout capped at their schema maximum of 50.
  const legacy = await (await worker.fetch(request("/api/config/ads/interstitial", {}, "DE"), env)).json();
  assert.deepEqual(legacy, { enabled: true, rolloutPercent: 50, gamesBetweenAds: 7, maxOpportunitiesPerSession: 1, countryEligible: true });
  assert.equal(isValidLegacyInterstitialClientConfig(legacy), true, "an installed 0.53-0.55 client keeps working");

  // 0.56 clients ask for ?v=2 and get the whole shape.
  const v2 = await (await worker.fetch(request("/api/config/ads/interstitial?v=2", {}, "DE"), env)).json();
  assert.deepEqual(v2, {
    enabled: true,
    rolloutPercent: 100,
    gamesBetweenAds: 7,
    maxOpportunitiesPerSession: 1,
    countryEligible: true,
    secondOpportunityRolloutPercent: 20,
    rewardedLifecycleV2: false,
  });
  assert.equal(isValidInterstitialClientConfig(v2), true);
  assert.equal(isValidLegacyInterstitialClientConfig(v2), false, "the v2 shape is for v2 clients only");
});

test("the launch configuration (50 / cadence 7 / max 1, no optional keys) serves byte-identical bodies on both paths", async () => {
  const { kv, env } = makeEnv();
  kv.store.set(INTERSTITIAL_CONFIG_KV_KEY, JSON.stringify({ ...STORED, enabled: true, rolloutPercent: 50 }));
  const a = await (await worker.fetch(request("/api/config/ads/interstitial", {}, "DE"), env)).text();
  const b = await (await worker.fetch(request("/api/config/ads/interstitial?v=2", {}, "DE"), env)).text();
  assert.equal(a, b);
  assert.deepEqual(JSON.parse(a), { enabled: true, rolloutPercent: 50, gamesBetweenAds: 7, maxOpportunitiesPerSession: 1, countryEligible: true });
});

test("optional v2 keys alone never change the legacy response: still the exact five keys, byte-identical to the key-less config", async () => {
  const { kv, env } = makeEnv();
  kv.store.set(INTERSTITIAL_CONFIG_KV_KEY, JSON.stringify({ ...STORED, enabled: true, rolloutPercent: 50 }));
  const plain = await (await worker.fetch(request("/api/config/ads/interstitial", {}, "DE"), env)).text();
  kv.store.set(INTERSTITIAL_CONFIG_KV_KEY, JSON.stringify({ ...STORED, enabled: true, rolloutPercent: 50, rewardedLifecycleV2: false, secondOpportunityRolloutPercent: 0 }));
  const withKeys = await (await worker.fetch(request("/api/config/ads/interstitial", {}, "DE"), env)).text();
  assert.equal(withKeys, plain);
  const v2 = await (await worker.fetch(request("/api/config/ads/interstitial?v=2", {}, "DE"), env)).json();
  assert.equal(v2.rewardedLifecycleV2, false);
});

test("a PUT that omits the optional keys replaces the object: an existing value is NOT preserved (send them every time)", async () => {
  const { kv, env } = makeEnv();
  const put = (body: unknown) =>
    worker.fetch(request("/api/config/ads/interstitial", { method: "PUT", headers: { authorization: `Bearer ${CONTENT_TOKEN}` }, body: JSON.stringify(body) }), env);
  await put({ ...STORED, rewardedLifecycleV2: false });
  await put(STORED);
  assert.equal("rewardedLifecycleV2" in JSON.parse(kv.store.get(INTERSTITIAL_CONFIG_KV_KEY)!), false);
});

// --- 0.57 v3: the multi-cell experiments block, served on ?v=3 only --------------------------------

const { INTERSTITIAL_EXPERIMENTS_KV_KEY, isValidStoredInterstitialExperiments } = await import("../src/services/ads/interstitialConfigSchema.ts");

const xcell = (id: string, cadence: number, cap: number, weight: number) => ({ id, cadence, cap, weight });
const EXPERIMENT = { enabled: true, rolloutPercentInTreatment: 20, version: 1, cells: [xcell("A", 7, 2, 50), xcell("B", 5, 2, 50)] };
const EXPERIMENTS = { interstitial: EXPERIMENT };
/** The live production baseline: global treatment rollout 80%, cadence 7, max 2 opportunities. */
const LIVE = { ...STORED, enabled: true, rolloutPercent: 80, maxOpportunitiesPerSession: 2 };
const LIVE_PATHS = ["/api/config/ads/interstitial", "/api/config/ads/interstitial?v=2"] as const;

class SpyKv extends FakeKv {
  reads: string[] = [];
  override async get(key: string): Promise<string | null> {
    this.reads.push(key);
    return super.get(key);
  }
}

async function bodyText(env: never, path: string, country = "DE") {
  const res = await worker.fetch(request(path, {}, country), env);
  return { status: res.status, text: await res.text(), headers: res.headers };
}

test("v3: the exact v2 body plus `experiments` when the separate key exists and validates", async () => {
  const { kv, env } = makeEnv();
  kv.store.set(INTERSTITIAL_CONFIG_KV_KEY, JSON.stringify({ ...LIVE, secondOpportunityRolloutPercent: 40, rewardedLifecycleV2: true }));
  kv.store.set(INTERSTITIAL_EXPERIMENTS_KV_KEY, JSON.stringify(EXPERIMENTS));
  const v2 = JSON.parse((await bodyText(env, "/api/config/ads/interstitial?v=2")).text);
  const v3res = await bodyText(env, "/api/config/ads/interstitial?v=3");
  const v3 = JSON.parse(v3res.text);
  assert.equal(v3res.status, 200);
  assert.deepEqual({ ...v3, experiments: undefined }, { ...v2, experiments: undefined }, "every v2 key is identical");
  assert.deepEqual(v3.experiments, EXPERIMENTS);
  assert.equal(Object.keys(v3).length, Object.keys(v2).length + 1);
  assert.match(v3res.headers.get("cache-control") ?? "", /private, max-age=60/, "same cache headers as the interstitial config");
  assert.equal(isValidInterstitialClientConfig(v2), true);
});

test("v3 without experiments (key missing) is the v2 body byte for byte", async () => {
  const { kv, env } = makeEnv();
  kv.store.set(INTERSTITIAL_CONFIG_KV_KEY, JSON.stringify(LIVE));
  const v2 = await bodyText(env, "/api/config/ads/interstitial?v=2");
  const v3 = await bodyText(env, "/api/config/ads/interstitial?v=3");
  assert.equal(v3.text, v2.text);
  assert.equal("experiments" in JSON.parse(v3.text), false);
});

test("v3 with an INVALID experiments value omits it - never a 500 because of experiments", async () => {
  const bad: unknown[] = [
    "{not json",
    JSON.stringify({ interstitial: { ...EXPERIMENT, version: 0 } }),
    JSON.stringify({ interstitial: EXPERIMENT, inkTrial: {} }),
    JSON.stringify({ interstital: EXPERIMENT }),
    JSON.stringify([]),
    JSON.stringify(null),
  ];
  for (const raw of bad) {
    const { kv, env } = makeEnv();
    kv.store.set(INTERSTITIAL_CONFIG_KV_KEY, JSON.stringify(LIVE));
    kv.store.set(INTERSTITIAL_EXPERIMENTS_KV_KEY, raw as string);
    const v2 = await bodyText(env, "/api/config/ads/interstitial?v=2");
    const v3 = await bodyText(env, "/api/config/ads/interstitial?v=3");
    assert.equal(v3.status, 200, String(raw));
    assert.equal(v3.text, v2.text, String(raw));
  }
});

test("v3: an experiments read failure is swallowed (the base config still answers)", async () => {
  const { kv, env } = makeEnv();
  kv.store.set(INTERSTITIAL_CONFIG_KV_KEY, JSON.stringify(LIVE));
  const v2 = await bodyText(env, "/api/config/ads/interstitial?v=2");
  const original = kv.get.bind(kv);
  kv.get = async (key: string) => {
    if (key === INTERSTITIAL_EXPERIMENTS_KV_KEY) throw new Error("kv down");
    return original(key);
  };
  assert.equal((await bodyText(env, "/api/config/ads/interstitial?v=3")).text, v2.text);
});

test("v3: no stored interstitial config is still a 404 (experiments alone never create an answer)", async () => {
  const { kv, env } = makeEnv();
  kv.store.set(INTERSTITIAL_EXPERIMENTS_KV_KEY, JSON.stringify(EXPERIMENTS));
  assert.equal((await bodyText(env, "/api/config/ads/interstitial?v=3")).status, 404);
});

test("the legacy and ?v=2 responses are byte-identical with experiments present, missing or invalid - and never read that key", async () => {
  const legacyAndV2: Record<string, string> = {};
  for (const [name, raw] of [
    ["missing", null],
    ["valid", JSON.stringify(EXPERIMENTS)],
    ["invalid", JSON.stringify({ interstitial: { ...EXPERIMENT, cells: [] } })],
    ["garbage", "{{"],
  ] as const) {
    const kv = new SpyKv();
    const env = { CONTENT_KV: kv, CONTENT_ADMIN_TOKEN: CONTENT_TOKEN } as never;
    kv.store.set(INTERSTITIAL_CONFIG_KV_KEY, JSON.stringify({ ...LIVE, secondOpportunityRolloutPercent: 40, rewardedLifecycleV2: false }));
    if (raw !== null) kv.store.set(INTERSTITIAL_EXPERIMENTS_KV_KEY, raw);
    for (const path of LIVE_PATHS) {
      const res = await bodyText(env, path);
      assert.equal(res.status, 200);
      const key = path;
      if (name === "missing") legacyAndV2[key] = res.text;
      else assert.equal(res.text, legacyAndV2[key], `${path} with experiments ${name}`);
      assert.equal("experiments" in JSON.parse(res.text), false);
    }
    assert.equal(kv.reads.includes(INTERSTITIAL_EXPERIMENTS_KV_KEY), false, "plain and ?v=2 never touch the experiments key");
  }
  // The legacy body is still exactly what a pre-0.56 client validates (rollout capped at 50, five keys).
  assert.deepEqual(JSON.parse(legacyAndV2["/api/config/ads/interstitial"]), {
    enabled: true,
    rolloutPercent: 50,
    gamesBetweenAds: 7,
    maxOpportunitiesPerSession: 2,
    countryEligible: true,
  });
});

test("the stored interstitial key is untouched by experiments: separate keys, and a PUT of one never writes the other", async () => {
  assert.notEqual(INTERSTITIAL_EXPERIMENTS_KV_KEY, INTERSTITIAL_CONFIG_KV_KEY);
  assert.equal(INTERSTITIAL_EXPERIMENTS_KV_KEY, "config:ads:experiments");
  const { kv, env } = makeEnv();
  const auth = { authorization: `Bearer ${CONTENT_TOKEN}` };
  await worker.fetch(request("/api/config/ads/interstitial", { method: "PUT", headers: auth, body: JSON.stringify(LIVE) }), env);
  assert.equal(kv.store.has(INTERSTITIAL_EXPERIMENTS_KV_KEY), false);
  const before = kv.store.get(INTERSTITIAL_CONFIG_KV_KEY);
  const put = await worker.fetch(request("/api/config/ads/experiments", { method: "PUT", headers: auth, body: JSON.stringify(EXPERIMENTS) }), env);
  assert.equal(put.status, 200);
  assert.equal(kv.store.get(INTERSTITIAL_CONFIG_KV_KEY), before);
  assert.deepEqual(JSON.parse(kv.store.get(INTERSTITIAL_EXPERIMENTS_KV_KEY)!), EXPERIMENTS);
  // An interstitial body carrying experiments (the old hazard) is still rejected by the interstitial PUT.
  const hazard = await worker.fetch(request("/api/config/ads/interstitial", { method: "PUT", headers: auth, body: JSON.stringify({ ...LIVE, experiments: EXPERIMENTS }) }), env);
  assert.equal(hazard.status, 400);
});

test("experiments PUT: admin gate, validation before write, whole-object replace", async () => {
  const { kv, env } = makeEnv();
  const put = (body: unknown, token?: string) =>
    worker.fetch(
      request("/api/config/ads/experiments", { method: "PUT", headers: token ? { authorization: `Bearer ${token}` } : {}, body: typeof body === "string" ? body : JSON.stringify(body) }),
      env,
    );
  assert.equal((await put(EXPERIMENTS)).status, 401);
  assert.equal((await put(EXPERIMENTS, "wrong")).status, 401);
  assert.equal((await put("{nope", CONTENT_TOKEN)).status, 400);
  assert.equal(kv.store.has(INTERSTITIAL_EXPERIMENTS_KV_KEY), false);
  assert.equal((await put(EXPERIMENTS, CONTENT_TOKEN)).status, 200);
  const launch = { interstitial: { ...EXPERIMENT, enabled: false, rolloutPercentInTreatment: 0, version: 2 } };
  assert.equal((await put(launch, CONTENT_TOKEN)).status, 200);
  assert.deepEqual(JSON.parse(kv.store.get(INTERSTITIAL_EXPERIMENTS_KV_KEY)!), launch, "replaced, not merged");
});

test("safety-envelope matrix: every violation is rejected on PUT (nothing written) and omitted on GET", async () => {
  const six = ["A", "B", "C", "D", "E", "F"].map((id, i) => xcell(id, 7, 1, i < 4 ? 17 : 16));
  const withCells = (cells: unknown[]) => ({ interstitial: { ...EXPERIMENT, cells } });
  const matrix: Record<string, unknown> = {
    "cadence 4": withCells([xcell("A", 4, 1, 50), xcell("B", 7, 1, 50)]),
    "cadence 21": withCells([xcell("A", 21, 1, 50), xcell("B", 7, 1, 50)]),
    "cadence 7.5 (not an integer)": withCells([xcell("A", 7.5, 1, 50), xcell("B", 7, 1, 50)]),
    "cadence 6 with cap 4 (joint rule)": withCells([xcell("A", 6, 4, 50), xcell("B", 7, 1, 50)]),
    "cap 0": withCells([xcell("A", 7, 0, 50), xcell("B", 7, 1, 50)]),
    "cap 4": withCells([xcell("A", 20, 4, 50), xcell("B", 7, 1, 50)]),
    "5/3": withCells([xcell("A", 5, 3, 50), xcell("B", 7, 1, 50)]),
    "weights 99": withCells([xcell("A", 7, 1, 50), xcell("B", 7, 1, 49)]),
    "weights 101": withCells([xcell("A", 7, 1, 51), xcell("B", 7, 1, 50)]),
    "one cell": withCells([xcell("A", 7, 1, 100)]),
    "seven cells": withCells([...six, xcell("G", 7, 1, 0)]),
    "duplicate ids": withCells([xcell("A", 7, 1, 50), xcell("A", 7, 1, 50)]),
    "one positive weight": withCells([xcell("A", 7, 1, 100), xcell("B", 7, 1, 0)]),
    "version 0": { interstitial: { ...EXPERIMENT, version: 0 } },
    "version 1000001": { interstitial: { ...EXPERIMENT, version: 1_000_001 } },
    "rollout 101": { interstitial: { ...EXPERIMENT, rolloutPercentInTreatment: 101 } },
    "rollout -1": { interstitial: { ...EXPERIMENT, rolloutPercentInTreatment: -1 } },
    "unknown top-level key": { ...EXPERIMENTS, inkTrial: {} },
  };
  const auth = { authorization: `Bearer ${CONTENT_TOKEN}` };
  for (const [name, value] of Object.entries(matrix)) {
    const { kv, env } = makeEnv();
    const res = await worker.fetch(request("/api/config/ads/experiments", { method: "PUT", headers: auth, body: JSON.stringify(value) }), env);
    assert.equal(res.status, 400, name);
    assert.equal(kv.store.has(INTERSTITIAL_EXPERIMENTS_KV_KEY), false, `${name}: nothing written`);
    // And if it got into KV by hand (wrangler kv), the v3 answer simply omits it.
    kv.store.set(INTERSTITIAL_CONFIG_KV_KEY, JSON.stringify(LIVE));
    kv.store.set(INTERSTITIAL_EXPERIMENTS_KV_KEY, JSON.stringify(value));
    const v2 = await bodyText(env, "/api/config/ads/interstitial?v=2");
    assert.equal((await bodyText(env, "/api/config/ads/interstitial?v=3")).text, v2.text, `${name}: omitted on GET`);
  }
  for (const ok of [
    EXPERIMENTS,
    { interstitial: { ...EXPERIMENT, enabled: false, rolloutPercentInTreatment: 0 } },
    { interstitial: withCells(six).interstitial },
    { interstitial: { ...EXPERIMENT, cells: [xcell("A", 5, 2, 60), xcell("B", 7, 3, 40)] } },
    // 0.57: any integer cadence 5..20 - the 7/2 vs 6/2 vs 5/2 grid, no APK needed.
    { interstitial: { ...EXPERIMENT, cells: [xcell("A", 7, 2, 40), xcell("B", 6, 2, 30), xcell("C", 5, 2, 30)] } },
  ]) {
    assert.equal(isValidStoredInterstitialExperiments(ok), true, JSON.stringify(ok));
  }
});

test("the launch state (enabled false, rollout 0) is valid, is served on v3, and is a no-op for the base fields", async () => {
  const { kv, env } = makeEnv();
  const launch = { interstitial: { ...EXPERIMENT, enabled: false, rolloutPercentInTreatment: 0 } };
  kv.store.set(INTERSTITIAL_CONFIG_KV_KEY, JSON.stringify(LIVE));
  kv.store.set(INTERSTITIAL_EXPERIMENTS_KV_KEY, JSON.stringify(launch));
  const v2 = JSON.parse((await bodyText(env, "/api/config/ads/interstitial?v=2")).text);
  const v3 = JSON.parse((await bodyText(env, "/api/config/ads/interstitial?v=3")).text);
  assert.deepEqual(v3.experiments, launch);
  const { experiments: _ignored, ...base } = v3;
  assert.deepEqual(base, v2);
});

test("an interstitial config PUT/stored value WITHOUT blockedCountries is rejected (protection against accidental deletion)", async () => {
  const { kv, env } = makeEnv();
  const { blockedCountries: _blocked, ...withoutBlocked } = LIVE;
  const res = await worker.fetch(
    request("/api/config/ads/interstitial", { method: "PUT", headers: { authorization: `Bearer ${CONTENT_TOKEN}` }, body: JSON.stringify(withoutBlocked) }),
    env,
  );
  assert.equal(res.status, 400);
  assert.equal(kv.store.has(INTERSTITIAL_CONFIG_KV_KEY), false);
  // The same object hand-written into KV is a 500 on GET (fail closed), never a partial answer.
  kv.store.set(INTERSTITIAL_CONFIG_KV_KEY, JSON.stringify(withoutBlocked));
  assert.equal((await bodyText(env, "/api/config/ads/interstitial?v=3")).status, 500);
});
