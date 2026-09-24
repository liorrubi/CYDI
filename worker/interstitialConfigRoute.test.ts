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
    { ...STORED, rolloutPercent: 51 },
    { ...STORED, gamesBetweenAds: 8 },
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
