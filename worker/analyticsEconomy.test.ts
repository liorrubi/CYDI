// Coin-economy analytics, server side (schema validators, exact ledger, Analytics Engine
// schema 2, economy report block).
//
// What must hold:
//  1. The new events and the optional economy blocks validate; a partial block, an exact
//     balance or an unknown enum is rejected; every older client payload stays valid.
//  2. Buckets split exactly at the economy's thresholds (1,000 and 10,000).
//  3. coin_spent / progression_milestone are exact: routed to the durable /ledger and
//     persisted before the response, never shed.
//  4. AE rows carry bucket POSITIONS, never a balance.
//  5. The report's economy block answers the economy questions from those rows.
import test from "node:test";
import assert from "node:assert/strict";
import { israelDateKey } from "../src/app/israelDate.ts";

const { validateEventParams, isAnalyticsEventName } = await import("../src/services/analyticsSchema.ts");
const B = await import("../src/services/economyBuckets.ts");
const { EXACT_LEDGER_EVENTS, splitForLedger } = await import("./analyticsExactLedger.ts");
const { ALWAYS_PRESERVE } = await import("./analyticsShedding.ts");
const { buildShadowDataPointsFromParsed } = await import("./analyticsShadow.ts");
const { parseIngest } = await import("./analyticsIngest.ts");
const { AnalyticsDO, incrementEvent, economyBreakoutKeys } = await import("./analyticsDO.ts");
const { economyTelemetryFromRows, buildEconomyAeQueries } = await import("./analyticsEconomyReport.ts");

const ECON = { balanceBucket: "800_999", baseReward: 80, multiplier: 2, adAvailable: true, nextTarget: "category", shortfallBucket: "short_10_25", adClosesGap: false, gamesBucket: "10_24" };
const SPENT = { coinSink: "category_unlock", price: 1000, balanceBucket: "100_499", gamesBucket: "25_49", playerAgeBucket: "d2_3", spendOrdinal: "first" };
const MILESTONE = { milestone: "category_unlocked", categoryOrdinal: 1, balanceBucket: "100_499", gamesBucket: "25_49", playerAgeBucket: "d2_3" };
const GAME = { gameType: "shapeChallenge", category: "geometric", contentKey: "circle" };
const valid = (name: string, params: unknown) => validateEventParams(name as never, params).valid;

// ---------------------------------------------------------------- buckets ----

test("balance buckets split exactly at the 1,000 category and 10,000 Mega thresholds", () => {
  const cases: [number, string][] = [
    [0, "0_99"], [99, "0_99"], [100, "100_499"], [499, "100_499"], [500, "500_799"], [799, "500_799"],
    [800, "800_999"], [999, "800_999"], [1000, "1k_2.5k"], [2499, "1k_2.5k"], [2500, "2.5k_5k"], [4999, "2.5k_5k"],
    [5000, "5k_8k"], [7999, "5k_8k"], [8000, "8k_10k"], [9999, "8k_10k"], [10000, "10k_20k"], [19999, "10k_20k"],
    [20000, "20k_plus"], [1e9, "20k_plus"], [-5, "0_99"], [Number.NaN, "0_99"],
  ];
  for (const [balance, bucket] of cases) assert.equal(B.balanceBucket(balance), bucket, `${balance}`);
});

test("shortfall is a share of the target price, so 'close' means the same for 1,000 and 10,000", () => {
  assert.equal(B.shortfallBucket(1000, 1000), "affordable");
  assert.equal(B.shortfallBucket(999, 1000), "short_0_10");
  assert.equal(B.shortfallBucket(900, 1000), "short_0_10", "missing exactly 10% is still the closest bucket");
  assert.equal(B.shortfallBucket(899, 1000), "short_10_25");
  assert.equal(B.shortfallBucket(9000, 10000), "short_0_10");
  assert.equal(B.shortfallBucket(8999, 10000), "short_10_25");
  assert.equal(B.shortfallBucket(5000, 10000), "short_25_50");
  assert.equal(B.shortfallBucket(0, 10000), "short_75_100");
  assert.equal(B.shortfallBucket(50, null), "no_target");
  assert.deepEqual([B.gamesBucket(9), B.gamesBucket(10), B.gamesBucket(249), B.gamesBucket(250)], ["0_9", "10_24", "100_249", "250_plus"]);
  const day = 86_400_000;
  assert.deepEqual([0, 1, 3, 4, 7, 8, 30, 31].map((d) => B.playerAgeBucket(0, d * day + 1)), ["d0", "d1", "d2_3", "d4_7", "d4_7", "d8_14", "d15_30", "d31_plus"]);
  assert.equal(B.playerAgeBucket(null, 5), "unknown");
  assert.deepEqual([null, 1, 2, 3, 4].map((n) => B.spendOrdinal(n)), ["unknown", "first", "2_3", "2_3", "4_plus"]);
});

// -------------------------------------------------------------- validators ----

test("new economy events validate, and reject exact balances, unknown enums and extra keys", () => {
  for (const name of ["coin_spent", "progression_milestone", "coin_earned"]) assert.ok(isAnalyticsEventName(name));
  assert.ok(valid("coin_spent", SPENT));
  assert.ok(valid("progression_milestone", MILESTONE));
  assert.ok(valid("progression_milestone", { ...MILESTONE, milestone: "mega_unlocked", categoryOrdinal: 0 }));
  assert.ok(valid("coin_earned", { coinSource: "achievement", amount: 250, balanceBucket: "1k_2.5k" }));
  assert.equal(valid("coin_spent", { ...SPENT, balance: 1234 }), false, "an exact balance key is never accepted");
  assert.equal(valid("coin_spent", { ...SPENT, balanceBucket: 1234 }), false, "a number where a bucket belongs is rejected");
  assert.equal(valid("coin_spent", { ...SPENT, coinSink: "free text" }), false);
  assert.equal(valid("progression_milestone", { ...MILESTONE, categoryOrdinal: 0 }), false, "category_unlocked needs its ordinal");
  assert.equal(valid("progression_milestone", { ...MILESTONE, milestone: "mega_unlocked" }), false, "other milestones carry ordinal 0");
  assert.equal(valid("coin_earned", { coinSource: "shape_stars", amount: 80, balanceBucket: "0_99" }), false, "game sources ride game_completed, not coin_earned");
});

test("legacy payloads stay valid: placement-only reward events and three-key game_completed", () => {
  for (const name of ["reward_offer_shown", "reward_ad_started", "reward_ad_completed", "reward_ad_failed", "reward_skipped", "reward_bonus_offer_shown", "reward_bonus_skipped"]) {
    assert.ok(valid(name, { placement: "shape_challenge_double_reward" }), `${name} legacy`);
    assert.ok(valid(name, { placement: "shape_challenge_double_reward", ...ECON }), `${name} with economy`);
  }
  assert.ok(valid("game_completed", GAME));
  assert.ok(valid("game_completed", { ...GAME, coinsEarned: 80, balanceBucket: "1k_2.5k" }));
  assert.ok(valid("game_started", GAME));
  assert.equal(valid("game_started", { ...GAME, coinsEarned: 1, balanceBucket: "0_99" }), false, "only game_completed carries coins");
  assert.equal(valid("rewarded_ad_requested", { placement: "shape_challenge_double_reward", ...ECON }), false, "SDK lifecycle events are unchanged");
});

test("economy blocks are all-or-nothing: a partial block or a bad value fails the whole event", () => {
  const { gamesBucket: _g, ...partial } = ECON;
  assert.equal(valid("reward_offer_shown", { placement: "shape_challenge_double_reward", ...partial }), false);
  assert.equal(valid("reward_offer_shown", { placement: "shape_challenge_double_reward", ...ECON, multiplier: 4 }), false);
  assert.equal(valid("reward_offer_shown", { placement: "shape_challenge_double_reward", ...ECON, adAvailable: "yes" }), false);
  assert.equal(valid("game_completed", { ...GAME, coinsEarned: 80 }), false);
  assert.equal(valid("game_completed", { ...GAME, coinsEarned: -1, balanceBucket: "0_99" }), false);
});

// ------------------------------------------------------------ exact ledger ----

test("coin_spent and progression_milestone are exact: split to the ledger, always preserved; coin_earned is telemetry", () => {
  for (const name of ["coin_spent", "progression_milestone"]) {
    assert.ok(EXACT_LEDGER_EVENTS.has(name));
    assert.ok(ALWAYS_PRESERVE.includes(name), `${name} can never be shed`);
  }
  assert.equal(EXACT_LEDGER_EVENTS.has("coin_earned"), false);
  const env = (eventName: string, params: unknown) => ({ eventName, params, platform: "android" });
  const split = splitForLedger("/events", JSON.stringify({ events: [env("coin_spent", SPENT), env("coin_earned", { coinSource: "daily_chest", amount: 90, balanceBucket: "0_99" }), env("game_completed", { ...GAME, coinsEarned: 35, balanceBucket: "100_499" })] }));
  assert.deepEqual(split?.exact.map((e) => (e as { eventName: string }).eventName), ["coin_spent"]);
  assert.equal(split?.telemetry.length, 2);
});

class FakeStorage {
  map = new Map<string, unknown>();
  async get<T>(k: string | string[]): Promise<unknown> {
    if (Array.isArray(k)) return new Map(k.filter((x) => this.map.has(x)).map((x) => [x, structuredClone(this.map.get(x)) as T]));
    return this.map.has(k) ? structuredClone(this.map.get(k)) : undefined;
  }
  async put(entries: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(entries)) this.map.set(key, structuredClone(value));
  }
  async delete(keys: string[]): Promise<void> {
    for (const k of keys) this.map.delete(k);
  }
  async deleteAlarm(): Promise<void> {}
}
async function instance(storage: FakeStorage, ae?: (sql: string) => Promise<Record<string, string | number>[]>) {
  const state = { storage, ready: Promise.resolve() as Promise<unknown>, blockConcurrencyWhile(fn: () => Promise<unknown>) { this.ready = fn(); return this.ready; } };
  const obj = new AnalyticsDO(state as unknown as DurableObjectState, { ANALYTICS_ADMIN_TOKEN: "t" });
  await state.ready;
  if (ae) obj.aeFetchOverride = ae;
  return obj;
}
const env1 = (eventName: string, params: unknown) => ({ eventName, params, platform: "android", appVersion: "0.54.0", installationId: "inst-1", sessionId: "sess-1" });

test("exact economy events are durable: persisted by /ledger before the response, surviving a hibernation", async () => {
  const storage = new FakeStorage();
  const obj = await instance(storage);
  const r = await obj.fetch(new Request("https://analytics.internal/ledger", { method: "POST", headers: { "x-cydi-country": "DE", "x-cydi-shed-keep": "100" }, body: JSON.stringify({ events: [env1("coin_spent", SPENT), env1("progression_milestone", MILESTONE)] }) }));
  assert.equal(r.status, 200);
  await instance(storage); // hibernation: memory gone
  const day = storage.map.get(`day:${israelDateKey(Date.now())}`) as Record<string, { total: number; byEconomy?: Record<string, number>; economySum?: Record<string, number> }>;
  assert.equal(day.coin_spent.total, 1);
  assert.equal(day.coin_spent.byEconomy?.["sink:category_unlock"], 1);
  assert.equal(day.coin_spent.byEconomy?.["sinkOrdinal:category_unlock|first"], 1);
  assert.equal(day.coin_spent.economySum?.["price:category_unlock"], 1000);
  assert.equal(day.progression_milestone.byEconomy?.["categoryOrdinalGames:1|25_49"], 1);
});

test("economy breakouts are bounded: a direct call with an out-of-enum value opens no key", () => {
  assert.equal(economyBreakoutKeys("coin_spent", { ...SPENT, coinSink: "hack" }), null);
  const next = incrementEvent({}, "coin_spent", { ...SPENT, balanceBucket: "999999" }, "android");
  assert.equal(next.coin_spent?.total, 1);
  assert.equal(next.coin_spent?.byEconomy, undefined);
});

// --------------------------------------------------------- Analytics Engine ----

test("AE schema 2: economy context lands as bucket positions and codes, never a balance", () => {
  const body = JSON.stringify({ events: [
    env1("reward_offer_shown", { placement: "shape_challenge_double_reward", ...ECON, adAvailable: true, adClosesGap: true, multiplier: 3 }),
    env1("game_completed", { ...GAME, coinsEarned: 55, balanceBucket: "10k_20k" }),
    env1("coin_spent", SPENT),
    env1("reward_skipped", { placement: "shape_challenge_double_reward" }),
  ] });
  const points = buildShadowDataPointsFromParsed(parseIngest("/events", body), "DE", () => 0);
  const [offer, game, spent, legacy] = points;
  assert.equal(offer.doubles[0], 2, "schema version 2");
  assert.deepEqual(offer.doubles.slice(13), [4, 3, 1, 3, 4, 80, 2], "800_999 / short_10_25 / category / x3 / ad+closes / base 80 / 10_24");
  assert.deepEqual(game.doubles.slice(13), [9, 0, 0, 0, 0, 55, 0], "10k_20k bucket position 9, coinsEarned 55");
  assert.equal(spent.blobs[19], "coinSink:category_unlock");
  assert.equal(spent.doubles[7], 1000, "price in the existing price column");
  assert.deepEqual(legacy.doubles.slice(13), [0, 0, 0, 0, 0, 0, 0], "a legacy event carries no economy context");
  for (const p of points) assert.equal(p.doubles.length, 20);
});

// ----------------------------------------------------------------- report ----

test("economy report: offer -> start -> completion conversion by balance, shortfall, reward size and gap", () => {
  const rows = (ev: string, k: number, avail: number, n: number) => ({ ev, aud: "external", k, avail, n });
  const funnelBalance = [
    rows("reward_offer_shown", 1, 1, 100), rows("reward_offer_shown", 1, 0, 50), rows("reward_ad_started", 1, 1, 40), rows("reward_ad_completed", 1, 1, 30), rows("reward_skipped", 1, 1, 60),
    rows("reward_bonus_offer_shown", 9, 1, 10), rows("reward_bonus_ad_started", 9, 1, 1), rows("reward_bonus_ad_completed", 9, 1, 1),
    { ev: "reward_offer_shown", aud: "internal", k: 1, avail: 1, n: 999 },
  ];
  const t = economyTelemetryFromRows({
    funnelBalance,
    funnelShortfall: [rows("reward_offer_shown", 101, 1, 20), rows("reward_ad_started", 101, 1, 15)],
    funnelReward: [rows("reward_offer_shown", 23, 1, 10), rows("reward_ad_completed", 23, 1, 2)],
    funnelGap: [rows("reward_offer_shown", 1, 1, 5), rows("reward_ad_completed", 1, 1, 4)],
    funnelGames: [],
    earnGames: [{ aud: "external", gameType: "shapeChallenge", k: 5, n: 10, coins: 400 }],
    earnRare: [{ aud: "external", detail: "coinSource:achievement", n: 2, coins: 300 }],
    earnAd: [{ aud: "external", m: 2, n: 30, coins: 1200 }],
  }, "external");
  const poor = t.rewardFunnel.byBalance["0_99"];
  assert.deepEqual([poor.offers, poor.offersWithAd, poor.starts, poor.completions, poor.skips], [150, 100, 40, 30, 60], "internal rows excluded");
  assert.equal(poor.startRate, 0.4, "rates are over offers that had an ad behind them");
  assert.equal(t.rewardFunnel.byBalance["10k_20k"].completionRate, 0.1);
  assert.equal(t.rewardFunnel.total.offers, 160);
  assert.equal(t.rewardFunnel.byTargetShortfall["category|affordable"].starts, 15);
  assert.equal(t.rewardFunnel.byMultiplierRewardSize["x2|100_249"].completions, 2);
  assert.equal(t.rewardFunnel.byAdClosesGap.ad_closes_gap.completionRate, 0.8);
  assert.deepEqual(t.sourceMix.shape_stars, { events: 10, coins: 400 });
  assert.deepEqual(t.sourceMix.achievement, { events: 2, coins: 300 });
  assert.deepEqual(t.sourceMix.ad_multiplier_x2, { events: 30, coins: 1200 });
  assert.equal(t.balanceAtGameCompleted["1k_2.5k"], 10);
  const q = buildEconomyAeQueries(0, 86_400_000);
  assert.equal(Object.keys(q).length, 8);
  for (const sql of Object.values(q)) assert.match(sql, /double1 >= 2/, "only schema-2 rows");
});

test("economy report block: exact half from the DO, telemetry from AE, AE failure never fails the report", async () => {
  const storage = new FakeStorage();
  const obj = await instance(storage, async () => { throw new Error("AE SQL HTTP 503"); });
  await obj.fetch(new Request("https://analytics.internal/ledger", { method: "POST", headers: { "x-cydi-country": "DE", "x-cydi-shed-keep": "100" }, body: JSON.stringify({ events: [env1("coin_spent", SPENT), env1("coin_spent", { ...SPENT, coinSink: "pen_skin", price: 5000, spendOrdinal: "2_3" }), env1("progression_milestone", { ...MILESTONE, milestone: "mega_unlocked", categoryOrdinal: 0 })] }) }));
  const d = israelDateKey(Date.now());
  const res = await obj.fetch(new Request(`https://analytics.internal/report?period=range&start=${d}&end=${d}&economy=1`, { headers: { authorization: "Bearer t" } }));
  const body = (await res.json()) as { economy: { spend: { bySink: Record<string, { count: number; coins: number }>; ordinalBySink: Record<string, Record<string, number>> }; milestones: { counts: Record<string, number> }; telemetry: unknown; telemetryReason?: string } };
  assert.equal(res.status, 200);
  assert.deepEqual(body.economy.spend.bySink.pen_skin, { count: 1, coins: 5000 });
  assert.equal(body.economy.spend.ordinalBySink.category_unlock.first, 1);
  assert.equal(body.economy.milestones.counts.mega_unlocked, 1);
  assert.equal(body.economy.telemetry, null);
  assert.match(String(body.economy.telemetryReason), /Analytics Engine/);
  const plain = (await (await obj.fetch(new Request(`https://analytics.internal/report?period=range&start=${d}&end=${d}`, { headers: { authorization: "Bearer t" } }))).json()) as Record<string, unknown>;
  assert.equal("economy" in plain, false, "opt-in: a normal report runs no economy queries");
});
