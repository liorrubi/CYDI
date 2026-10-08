// 0.57.1 Rewarded Ink Trial - Worker / shared-schema compatibility, with the real shipped code:
//   M1  the config route: `ink` rides ONLY the v3 body, from its own KV key; legacy (0.55) and ?v=2 (0.56) bodies are
//       byte-for-byte what they were; an absent / invalid key omits `ink` and never touches the base or experiments.
//   M2  the admin PUT: auth, strict validation, whole-object write.
//   M3  analytics: the Ink offer shape on every reward funnel event, its strict negatives, the optional rotationSlot
//       on the Classic coin offer, every 0.57 shape still valid, the ink_trial lifecycle event.
//   M4  AE slots (no new column), exact-ledger classification, DO breakdowns bounded by closed sets.
import assert from "node:assert/strict";
import test from "node:test";

const worker = (await import("./index.ts")).default;
const { validateEventParams, INK_TRIAL_STAGES } = await import("../src/services/analyticsSchema.ts");
const { EXACT_LEDGER_EVENTS, splitForLedger } = await import("./analyticsExactLedger.ts");
const { ALWAYS_PRESERVE } = await import("./analyticsShedding.ts");
const { buildShadowDataPoints } = await import("./analyticsShadow.ts");
const { incrementEvent } = await import("./analyticsDO.ts");
const interstitial = await import("../src/services/ads/interstitialConfigSchema.ts");
const { INK_TRIAL_KV_KEY } = await import("../src/services/ads/inkTrialConfigSchema.ts");

class FakeKv {
  store = new Map<string, string>();
  gets: string[] = [];
  async get(key: string) {
    this.gets.push(key);
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string) {
    this.store.set(key, value);
  }
}
const req = (path: string, init: RequestInit = {}, country = "DE") => {
  const r = new Request(`https://playcydi.com${path}`, init);
  Object.defineProperty(r, "cf", { value: { country }, configurable: true });
  return r;
};
const STORED = { enabled: true, rolloutPercent: 80, gamesBetweenAds: 7, maxOpportunitiesPerSession: 2, blockedCountries: ["IR"] };
const EXPERIMENTS = { interstitial: { enabled: true, rolloutPercentInTreatment: 100, version: 1, cells: [{ id: "A", cadence: 7, cap: 2, weight: 50 }, { id: "B", cadence: 5, cap: 3, weight: 50 }] } };
const INK = { enabled: true, version: 1, rolloutPercent: 100, surfaces: { classic: true, playTogether: true, twoPlayers: true, daily: false }, classicRotation: ["coin", "ink"] };

function setup() {
  const kv = new FakeKv();
  kv.store.set(interstitial.INTERSTITIAL_CONFIG_KV_KEY, JSON.stringify(STORED));
  kv.store.set(interstitial.INTERSTITIAL_EXPERIMENTS_KV_KEY, JSON.stringify(EXPERIMENTS));
  const env = { CONTENT_KV: kv, CONTENT_ADMIN_TOKEN: "t" } as never;
  const get = async (q: string) => {
    kv.gets.length = 0;
    const res = await worker.fetch(req(`/api/config/ads/interstitial${q}`), env);
    assert.equal(res.status, 200);
    return { text: await res.text(), reads: kv.gets.length };
  };
  return { kv, env, get };
}

// ================================================================ M1: config route ====

test("M1: `ink` rides the v3 body only; legacy and ?v=2 bodies are unchanged by its presence; no extra request", async () => {
  const { kv, get } = setup();
  const before = { legacy: (await get("")).text, v2: (await get("?v=2")).text, v3: JSON.parse((await get("?v=3")).text) };
  kv.store.set(INK_TRIAL_KV_KEY, JSON.stringify(INK));
  const legacy = await get("");
  const v2 = await get("?v=2");
  const v3 = await get("?v=3");
  assert.equal(legacy.text, before.legacy, "0.55 body byte-identical");
  assert.equal(v2.text, before.v2, "0.56 body byte-identical");
  assert.equal(legacy.reads, 1);
  assert.equal(v2.reads, 1, "the ink key is never read for legacy / v2");
  const body = JSON.parse(v3.text);
  assert.deepEqual(body.ink, INK);
  const { ink: _ink, ...rest } = body;
  assert.deepEqual(rest, before.v3, "v3 = the 0.57 body + ink, nothing else changes");
  assert.equal(v3.reads, 3);
  // A 0.57 client parses it exactly as before (unknown top-level keys are ignored).
  const parsed = interstitial.parseInterstitialV3Body(body);
  assert.ok(parsed && parsed.experiment !== null);
});

test("M1: an invalid or unreadable stored ink omits the key and never breaks the base or the experiment", async () => {
  const { kv, get } = setup();
  for (const bad of ["{nope", JSON.stringify({ ...INK, extra: 1 }), JSON.stringify({ ...INK, rolloutPercent: 150 })]) {
    kv.store.set(INK_TRIAL_KV_KEY, bad);
    const body = JSON.parse((await get("?v=3")).text);
    assert.equal(body.ink, undefined);
    assert.deepEqual(body.experiments, EXPERIMENTS);
    assert.equal(body.rolloutPercent, 80);
  }
});

// ================================================================ M2: admin PUT ====

test("M2: PUT /api/config/ads/ink - admin only, strictly validated, whole object stored", async () => {
  const { kv, env } = setup();
  const put = (body: unknown, token = "t") =>
    worker.fetch(req("/api/config/ads/ink", { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }), env);
  assert.equal((await put(INK, "wrong")).status, 401);
  assert.equal((await put({ ...INK, surfaces: { classic: true } })).status, 400);
  assert.equal(kv.store.has(INK_TRIAL_KV_KEY), false, "nothing written on a rejected PUT");
  const ok = await put({ ...INK, rolloutPercent: 25, classicRotation: ["coin", "coin", "ink"] });
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(kv.store.get(INK_TRIAL_KV_KEY)!), { ...INK, rolloutPercent: 25, classicRotation: ["coin", "coin", "ink"] });
});

// ================================================================ M3: analytics schema ====

const econ = { balanceBucket: "100_499", baseReward: 20, multiplier: 3, adAvailable: true, nextTarget: "category", shortfallBucket: "short_0_10", adClosesGap: true, gamesBucket: "10_24" };
const exp = { arm: "x3", offerNumber: 2, sessionGames: 4, bonusCoins: 40, interstitialArm: "treatment" };
const inkClassic = { placement: "shape_challenge_ink_trial", ink: "rainbow", offerNumber: 2, sessionGames: 4, adAvailable: true, interstitialArm: "treatment", ifxCell: "C", rotationSlot: "ink" };
const inkPT = { placement: "play_together_ink_trial", ink: "diamondBlue", offerNumber: 3, sessionGames: 1, adAvailable: false };
const FUNNEL = ["reward_offer_shown", "reward_ad_started", "reward_ad_completed", "reward_ad_failed", "reward_skipped"] as const;
const valid = (e: string, p: unknown) => validateEventParams(e as never, p).valid;

test("M3: the Ink offer shape validates on every reward funnel event (Classic, Play Together, 2 Players)", () => {
  for (const e of FUNNEL) {
    assert.equal(valid(e, inkClassic), true, `${e} classic`);
    assert.equal(valid(e, inkPT), true, `${e} play together`);
    assert.equal(valid(e, { ...inkPT, placement: "two_players_ink_trial" }), true, `${e} 2 players`);
  }
  assert.equal(valid("reward_skipped", { ...inkPT, skipStage: "ad" }), true);
  assert.equal(valid("reward_skipped", { ...inkClassic, skipStage: "offer" }), true);
});

test("M3: strict negatives - wrong placement, unknown ink, extra key, rotationSlot off Classic, ifxCell without an arm", () => {
  assert.equal(valid("reward_offer_shown", { ...inkPT, placement: "shape_challenge_double_reward" }), false);
  assert.equal(valid("reward_offer_shown", { ...inkPT, ink: "purple" }), false);
  assert.equal(valid("reward_offer_shown", { ...inkPT, extra: 1 }), false);
  assert.equal(valid("reward_offer_shown", { ...inkPT, rotationSlot: "ink" }), false);
  assert.equal(valid("reward_offer_shown", { ...inkPT, ifxCell: "A" }), false);
  assert.equal(valid("reward_offer_shown", { ...inkClassic, interstitialArm: "none" }), false, "ifxCell needs a participant arm");
  assert.equal(valid("reward_offer_shown", { ...inkPT, offerNumber: 0 }), false);
  assert.equal(valid("reward_offer_shown", { ...inkPT, ...econ }), false, "never mixed with the coin economy block");
});

test("M3: the Classic coin offer may carry rotationSlot; every 0.57 shape is still valid unchanged", () => {
  const coin = { placement: "shape_challenge_double_reward", ...econ, ...exp };
  assert.equal(valid("reward_offer_shown", coin), true, "0.57 shape");
  assert.equal(valid("reward_offer_shown", { ...coin, rotationSlot: "ink" }), true, "fallback: scheduled ink, rendered coin");
  assert.equal(valid("reward_offer_shown", { ...coin, ifxCell: "B", rotationSlot: "coin" }), true);
  assert.equal(valid("reward_skipped", { ...coin, rotationSlot: "coin", skipStage: "offer" }), true);
  assert.equal(valid("reward_offer_shown", { ...coin, rotationSlot: "x3" }), false);
  assert.equal(valid("reward_offer_shown", { placement: "daily_chest_bonus", ...econ, multiplier: 2, rotationSlot: "coin" }), false, "only the rotation's own offer");
  assert.equal(valid("reward_offer_shown", { placement: "shape_challenge_double_reward" }), true, "placement-only stays valid");
});

test("M3: ink_trial - exact keys, closed stages / inks / surfaces", () => {
  for (const stage of INK_TRIAL_STAGES) assert.equal(valid("ink_trial", { inkStage: stage, ink: "rainbow", inkSurface: "classic" }), true);
  assert.equal(valid("ink_trial", { inkStage: "used", ink: "rainbow", inkSurface: "classic" }), false, "no per-use stage");
  assert.equal(valid("ink_trial", { inkStage: "granted", ink: "black", inkSurface: "classic" }), false);
  assert.equal(valid("ink_trial", { inkStage: "granted", ink: "rainbow", inkSurface: "mega" }), false);
  assert.equal(valid("ink_trial", { inkStage: "granted", ink: "rainbow", inkSurface: "classic", price: 10000 }), false);
});

// ================================================================ M4: AE / ledger / DO ====

function point(event: string, params: Record<string, unknown>) {
  const env = { eventName: event, params, platform: "android", appVersion: "0.57.1", appVersionCode: 59, installationId: "i", sessionId: "s", isInternal: false };
  const pts = buildShadowDataPoints("/events", JSON.stringify({ events: [env] }), "US", () => 0.5);
  assert.equal(pts.length, 1);
  return pts[0];
}
const d = (p: { doubles: number[] }, n: number) => p.doubles[n - 1];
const b = (p: { blobs: string[] }, n: number) => p.blobs[n - 1];

test("M4: AE slots - Ink offer rows: placement, ink in the arm slot, rotationSlot detail, offer/session numbers; no new column", () => {
  const offer = point("reward_offer_shown", inkClassic);
  assert.equal(offer.blobs.length, 20);
  assert.equal(offer.doubles.length, 20);
  assert.deepEqual([b(offer, 16), b(offer, 18), b(offer, 19), b(offer, 20)], ["shape_challenge_ink_trial", "rainbow", "treatment", "rotationSlot:ink"]);
  assert.deepEqual([d(offer, 5), d(offer, 6), d(offer, 12), d(offer, 16), d(offer, 17)], [4, 2, 3, 0, 2], "sessionGames, offerNumber, ifxCell C=3, multiplier 0, offerFlags (adAvailable)");
  const skip = point("reward_skipped", { ...inkClassic, skipStage: "ad" });
  assert.equal(b(skip, 20), "skipStage:ad", "skip rows keep skipStage first");
  const coin = point("reward_offer_shown", { placement: "shape_challenge_double_reward", ...econ, ...exp, rotationSlot: "ink" });
  assert.deepEqual([b(coin, 18), b(coin, 20)], ["x3", "rotationSlot:ink"]);
  const life = point("ink_trial", { inkStage: "cta_purchased", ink: "diamondBlue", inkSurface: "playTogether" });
  assert.deepEqual([b(life, 1), b(life, 18), b(life, 19), b(life, 20)], ["ink_trial", "diamondBlue", "playTogether", "inkStage:cta_purchased"]);
});

test("M4: ink_trial is an exact (ledger) event and never shed; the offer stays telemetry like the coin offer", () => {
  assert.equal(EXACT_LEDGER_EVENTS.has("ink_trial"), true);
  assert.equal(ALWAYS_PRESERVE.includes("ink_trial"), true);
  assert.equal(EXACT_LEDGER_EVENTS.has("reward_offer_shown"), false);
  const env = (eventName: string, params: Record<string, unknown>) => ({ eventName, params, platform: "android", appVersion: "0.57.1", sessionId: "s", installationId: "i" });
  const split = splitForLedger("/events", JSON.stringify({ events: [env("ink_trial", { inkStage: "granted", ink: "rainbow", inkSurface: "classic" }), env("reward_offer_shown", inkPT)] }));
  assert.ok(split);
  assert.deepEqual(split.exact.map((e) => (e as { eventName: string }).eventName), ["ink_trial"]);
  assert.deepEqual(split.telemetry.map((e) => (e as { eventName: string }).eventName), ["reward_offer_shown"]);
});

test("M4: DO breakdowns - byPlacement keeps coin and Ink taps apart; byInkTrial is stage|ink|surface", () => {
  let counters = {} as Record<string, Record<string, unknown>>;
  counters = incrementEvent(counters as never, "reward_ad_started", inkPT, "android", "0.57.1") as never;
  counters = incrementEvent(counters as never, "reward_ad_started", { placement: "shape_challenge_double_reward", ...econ, ...exp }, "android", "0.57.1") as never;
  assert.deepEqual(counters.reward_ad_started.byPlacement, { play_together_ink_trial: 1, shape_challenge_double_reward: 1 });
  counters = incrementEvent(counters as never, "ink_trial", { inkStage: "granted", ink: "rainbow", inkSurface: "playTogether" }, "android", "0.57.1") as never;
  assert.deepEqual(counters.ink_trial.byInkTrial, { "granted|rainbow|playTogether": 1 });
  // A bad value never opens a key (direct call, bypassing validation).
  counters = incrementEvent(counters as never, "ink_trial", { inkStage: "x", ink: "rainbow", inkSurface: "classic" }, "android", "0.57.1") as never;
  assert.deepEqual(counters.ink_trial.byInkTrial, { "granted|rainbow|playTogether": 1 });
  // Untouched events gain no new map.
  counters = incrementEvent(counters as never, "app_open", {}, "android", "0.57.1") as never;
  assert.equal(counters.app_open.byPlacement, undefined);
});
