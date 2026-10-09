// 0.59.0 coin-offer flags (Classic x3 A/B + Category Unlock Now) - Worker compatibility with the real shipped code:
//   C1  `coin` rides ONLY the v3 body, from its own KV key; legacy (0.55) and ?v=2 (0.56) bodies are byte-identical;
//       an absent / invalid key omits `coin` and never touches the base, the experiment or `ink`.
//   C2  the admin PUT: auth, strict validation, whole-object write.
//   C3  released clients: the shipped v3 parser (0.57 / 0.58) reads the same interstitial config with `coin` present.
import assert from "node:assert/strict";
import test from "node:test";

const worker = (await import("./index.ts")).default;
const interstitial = await import("../src/services/ads/interstitialConfigSchema.ts");
const { INK_TRIAL_KV_KEY } = await import("../src/services/ads/inkTrialConfigSchema.ts");
const { COIN_OFFER_KV_KEY } = await import("../src/services/ads/coinOfferConfigSchema.ts");

class FakeKv {
  store = new Map<string, string>();
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string) {
    this.store.set(key, value);
  }
}
const req = (path: string, init: RequestInit = {}) => {
  const r = new Request(`https://playcydi.com${path}`, init);
  Object.defineProperty(r, "cf", { value: { country: "DE" }, configurable: true });
  return r;
};
const STORED = { enabled: true, rolloutPercent: 80, gamesBetweenAds: 7, maxOpportunitiesPerSession: 2, blockedCountries: ["IR"] };
const INK = { enabled: true, version: 1, rolloutPercent: 100, surfaces: { classic: true, playTogether: true, twoPlayers: true, daily: false }, classicRotation: ["coin", "ink"], maxExtensions: 99 };
const COIN = { version: 1, runX3: true, unlockNow: true };

function setup() {
  const kv = new FakeKv();
  kv.store.set(interstitial.INTERSTITIAL_CONFIG_KV_KEY, JSON.stringify(STORED));
  kv.store.set(INK_TRIAL_KV_KEY, JSON.stringify(INK));
  const env = { CONTENT_KV: kv, CONTENT_ADMIN_TOKEN: "t" } as never;
  const get = async (q: string) => {
    const res = await worker.fetch(req(`/api/config/ads/interstitial${q}`), env);
    assert.equal(res.status, 200);
    return res.text();
  };
  return { kv, env, get };
}

test("C1: `coin` rides the v3 body only; legacy and ?v=2 are byte-identical; `ink` and the base are untouched", async () => {
  const { kv, get } = setup();
  const before = { legacy: await get(""), v2: await get("?v=2"), v3: JSON.parse(await get("?v=3")) };
  assert.equal("coin" in before.v3, false, "absent key = OFF = no `coin`");
  kv.store.set(COIN_OFFER_KV_KEY, JSON.stringify(COIN));
  assert.equal(await get(""), before.legacy);
  assert.equal(await get("?v=2"), before.v2);
  const v3 = JSON.parse(await get("?v=3"));
  assert.deepEqual(v3.coin, COIN);
  const { coin: _coin, ...rest } = v3;
  assert.deepEqual(rest, before.v3, "everything else in the v3 body is unchanged");
});

test("C1: an invalid or unreadable stored value omits `coin` and breaks nothing", async () => {
  const { kv, get } = setup();
  const clean = JSON.parse(await get("?v=3"));
  for (const bad of ["{not json", JSON.stringify({ ...COIN, extra: true }), JSON.stringify({ version: 1, runX3: "yes", unlockNow: true })]) {
    kv.store.set(COIN_OFFER_KV_KEY, bad);
    assert.deepEqual(JSON.parse(await get("?v=3")), clean, bad);
  }
});

test("C2: PUT /api/config/ads/coin - admin only, strictly validated, whole object stored", async () => {
  const { kv, env } = setup();
  const put = (body: unknown, token?: string) =>
    worker.fetch(req("/api/config/ads/coin", { method: "PUT", body: JSON.stringify(body), headers: token ? { authorization: `Bearer ${token}` } : {} }), env);
  assert.equal((await put(COIN)).status, 401);
  assert.equal((await put(COIN, "wrong")).status, 401);
  assert.equal((await put({ ...COIN, runX3: 1 }, "t")).status, 400);
  assert.equal(kv.store.has(COIN_OFFER_KV_KEY), false, "nothing written on a rejected body");
  const ok = await put({ version: 2, runX3: false, unlockNow: true }, "t");
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(kv.store.get(COIN_OFFER_KV_KEY)!), { version: 2, runX3: false, unlockNow: true });
});

test("C3: the shipped v3 parser reads the identical interstitial config with `coin` present (released 0.57 / 0.58 clients)", async () => {
  const { kv, get } = setup();
  const without = interstitial.parseInterstitialV3Body(JSON.parse(await get("?v=3")));
  kv.store.set(COIN_OFFER_KV_KEY, JSON.stringify(COIN));
  const withCoin = interstitial.parseInterstitialV3Body(JSON.parse(await get("?v=3")));
  assert.ok(without && withCoin);
  assert.deepEqual(withCoin, without);
});
