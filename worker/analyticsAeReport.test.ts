// Hybrid reporting: exact events from the AnalyticsDO ledger, telemetry from Analytics Engine.
//
// Properties under test:
//  - Israel-day windows are DST-correct and never read AE before its coverage start.
//  - Every AE count is weighted (sum(_sample_interval)); exact events are never read from AE.
//  - The DO report keeps its shape; on AE days telemetry comes from AE, exact events from the DO.
//  - Any AE problem (not configured, error, truncation) falls back to today's DO-only report.
import test from "node:test";
import assert from "node:assert/strict";

const {
  israelMidnightUtc,
  coveredWindow,
  seriesSegments,
  buildAeQueries,
  aeRowsToCounters,
  stripTelemetry,
  telemetryEvents,
  AE_ROW_LIMIT,
} = await import("./analyticsAeReport.ts");
const { EXACT_LEDGER_EVENTS } = await import("./analyticsExactLedger.ts");
const { AnalyticsDO } = await import("./analyticsDO.ts");

// ------------------------------------------------------------------ time ----

test("Israel midnight is DST-correct (IDT +3, IST +2, and the changeover day)", () => {
  assert.equal(new Date(israelMidnightUtc("2026-09-26")).toISOString(), "2026-09-25T21:00:00.000Z");
  assert.equal(new Date(israelMidnightUtc("2026-10-25")).toISOString(), "2026-10-24T21:00:00.000Z");
  assert.equal(new Date(israelMidnightUtc("2026-10-26")).toISOString(), "2026-10-25T22:00:00.000Z");
  assert.equal(new Date(israelMidnightUtc("2026-11-15")).toISOString(), "2026-11-14T22:00:00.000Z");
});

test("coveredWindow never reaches before AE coverage (26 Sep) and never past now", () => {
  const now = Date.parse("2026-09-27T09:00:00Z");
  assert.equal(coveredWindow("2026-09-20", "2026-09-25", now), null);
  const w = coveredWindow("2026-09-24", "2026-09-27", now)!;
  assert.deepEqual(w.dates, ["2026-09-26", "2026-09-27"]);
  assert.equal(new Date(w.startMs).toISOString(), "2026-09-25T21:00:00.000Z");
  assert.equal(w.endMs, now, "clipped to now");
  assert.equal(coveredWindow("2026-09-28", "2026-09-29", now), null, "entirely in the future");
});

test("series segments split at a DST change so each day groups on its own offset", () => {
  const segs = seriesSegments(["2026-10-24", "2026-10-25", "2026-10-26"], Date.parse("2026-10-27T00:00:00Z"));
  assert.deepEqual(segs.map((s) => s.offsetHours), [3, 2]);
});

// ------------------------------------------------------------------ SQL ----

test("every query is weighted, excludes exact-ledger events, and is row-capped", () => {
  const q = buildAeQueries(Date.parse("2026-09-25T21:00:00Z"), Date.parse("2026-09-26T21:00:00Z"), [{ startMs: 0, endMs: 1, offsetHours: 3 }]);
  for (const [name, sql] of Object.entries(q)) {
    assert.match(sql, /sum\(_sample_interval\)/, `${name} weighted`);
    assert.doesNotMatch(sql, /count\(\)/, `${name} never count()`);
    assert.match(sql, new RegExp(`LIMIT ${AE_ROW_LIMIT}`), `${name} capped`);
    for (const exact of ["first_open", "app_open", "shop_purchase_with_coins", "mp_room_created"]) assert.ok(sql.includes(`NOT IN (`) && sql.includes(`'${exact}'`), `${name} excludes ${exact}`);
  }
  assert.ok(telemetryEvents().includes("game_started") && !telemetryEvents().includes("app_open" as never));
  assert.match(q.series0, /INTERVAL '3' HOUR/);
});

// ------------------------------------------------------------------ rows -> counters ----

test("AE rows become DO-shaped counters, per audience, weighted, with the DO's breakouts", () => {
  const t = aeRowsToCounters({
    base: [
      { ev: "game_started", aud: "external", platform: "android", ver: "0.53.0", n: "40" },
      { ev: "game_started", aud: "external", platform: "web", ver: "0.53.1", n: "10" },
      { ev: "game_started", aud: "internal", platform: "android", ver: "0.53.0", n: "2" },
      { ev: "app_open", aud: "external", platform: "android", ver: "0.53.0", n: "99" }, // exact: must be ignored
    ],
    country: [{ ev: "rewarded_ad_unavailable", aud: "external", country: "IR", ver: "0.53.0", n: 7 }],
    funnel: [
      { ev: "game_started", aud: "external", gameType: "shapeChallenge", category: "geometric", contentKey: "circle", n: 45 },
      { ev: "game_started", aud: "external", gameType: "customChallenge", category: "custom", contentKey: "", n: 5 },
    ],
    countryGameType: [{ ev: "game_started", aud: "external", country: "IR", gameType: "shapeChallenge", n: 30 }],
    attribution: [{ ev: "game_started", aud: "external", source: "youtube", campaign: "cydi_shorts", content: "vid1", n: 3 }],
    detail: [{ ev: "shape_completed", aud: "external", country: "DE", ver: "0.53.0", reason: "", detail: "", roundCount: 0, roundIndex: 0, n: 10, stars: 31, passed: 6 }],
  });
  const gs = t.counters.external.game_started!;
  assert.equal(gs.total, 50);
  assert.deepEqual(gs.byPlatform, { android: 40, web: 10 });
  assert.deepEqual(gs.byAppVersion, { "0.53.0": 40, "0.53.1": 10 });
  assert.deepEqual(gs.byContentKey, { circle: 45 }, "customChallenge keys never broken out");
  assert.deepEqual(gs.byCountryGameType, { "IR|shapeChallenge": 30 });
  assert.deepEqual(gs.bySource, { youtube: 3 });
  assert.equal(t.counters.internal.game_started!.total, 2);
  assert.equal(t.counters.external.app_open, undefined, "exact events are never read from AE");
  assert.deepEqual(t.counters.external.rewarded_ad_unavailable!.byCountryAppVersion, { "IR|0.53.0": 7 });
  const sc = t.counters.external.shape_completed!;
  assert.deepEqual([sc.sumStarRating, sc.passedCount, sc.scoredCount], [31, 6, 10]);
  assert.equal(t.truncated, false);
});

test("the base query carries app_open / first_open rows for the version mix only; every other query still excludes all exact events", () => {
  const q = buildAeQueries(Date.parse("2026-09-25T21:00:00Z"), Date.parse("2026-09-26T21:00:00Z"));
  assert.match(q.base, /OR blob1 IN \('app_open','first_open'\)/, "only the two exact version-mix events are added");
  assert.doesNotMatch(q.base.split(" OR blob1 IN ")[1], /shop_purchase_with_coins|rewarded_ad_shown/, "no other exact event rides along");
  for (const [name, sql] of Object.entries(q)) {
    if (name === "base") continue;
    assert.doesNotMatch(sql, / OR blob1 IN /, `${name} unchanged`);
  }
  assert.equal(Object.keys(q).length, 6, "still six queries without a series - nothing added");
});

test("version mix: exact rows feed `versions` but never a count; telemetry rows feed both", () => {
  const base = [
    { ev: "game_started", aud: "external", platform: "android", ver: "0.55.0", n: "40" },
    { ev: "game_completed", aud: "external", platform: "android", ver: "0.55.0", n: "35" },
    { ev: "app_open", aud: "external", platform: "android", ver: "0.55.0", n: "20" },
    { ev: "app_open", aud: "external", platform: "web", ver: "0.55.0", n: "5" },
    { ev: "first_open", aud: "external", platform: "android", ver: "0.55.0", n: "3" },
    { ev: "shape_completed", aud: "external", platform: "android", ver: "0.55.0", n: "30" },
    { ev: "app_open", aud: "internal", platform: "android", ver: "0.55.0", n: "9" },
  ];
  const withMix = aeRowsToCounters({ base });
  const withoutExact = aeRowsToCounters({ base: base.filter((r) => r.ev !== "app_open" && r.ev !== "first_open") });
  assert.deepEqual(withMix.counters, withoutExact.counters, "adding the exact rows moves no counter");
  assert.equal(withMix.counters.external.app_open, undefined);
  assert.deepEqual(withMix.versions.external, {
    "android|0.55.0": { game_started: 40, game_completed: 35, app_open: 20, first_open: 3 },
    "web|0.55.0": { app_open: 5 },
  }, "same version string, two platforms, kept apart; shape_completed is not a version-mix event");
  assert.deepEqual(withMix.versions.internal, { "android|0.55.0": { app_open: 9 } });
});

test("a result at the row limit is flagged truncated", () => {
  const rows = Array.from({ length: AE_ROW_LIMIT }, () => ({ ev: "game_started", aud: "external", platform: "android", ver: "x", n: 1 }));
  assert.equal(aeRowsToCounters({ base: rows }).truncated, true);
});

test("stripTelemetry keeps only exact-ledger events and the request counter", () => {
  const s = stripTelemetry({ app_open: { total: 3 }, game_started: { total: 9 }, analytics_requests: { total: 4 } } as never);
  assert.deepEqual(Object.keys(s).sort(), ["analytics_requests", "app_open"]);
  for (const k of Object.keys(s)) assert.ok(k === "analytics_requests" || EXACT_LEDGER_EVENTS.has(k));
});

// ------------------------------------------------------------------ DO integration ----

class FakeStorage {
  map = new Map<string, unknown>();
  async get(k: string | string[]): Promise<unknown> {
    if (Array.isArray(k)) return new Map(k.filter((x) => this.map.has(x)).map((x) => [x, structuredClone(this.map.get(x))]));
    return this.map.has(k) ? structuredClone(this.map.get(k)) : undefined;
  }
  async put(entries: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(entries)) this.map.set(key, structuredClone(value));
  }
  async deleteAlarm(): Promise<void> {}
}
class FakeState {
  storage = new FakeStorage();
  ready: Promise<unknown> = Promise.resolve();
  blockConcurrencyWhile(fn: () => Promise<unknown>) {
    this.ready = fn();
    return this.ready;
  }
}

const NOW = Date.parse("2026-09-27T09:00:00Z");
const realNow = Date.now;
test.before(() => {
  Date.now = () => NOW;
});
test.after(() => {
  Date.now = realNow;
});

// DO state: 25 Sep (pre-AE, DO telemetry only) and 26 Sep (AE-covered). game_started in the DO is the sampled count.
const SEED = {
  days: ["2026-09-25", "2026-09-26"],
  "day:2026-09-25": { game_started: { total: 3, byPlatform: { android: 3 } }, game_completed: { total: 2 }, app_open: { total: 7, byPlatform: { android: 7 } } },
  "day:2026-09-26": {
    game_started: { total: 5, byPlatform: { android: 5 } },
    game_completed: { total: 4 },
    app_open: { total: 10, byPlatform: { android: 10 } },
    result_shared: { total: 6 },
    analytics_requests: { total: 20 },
  },
};

async function makeDO(ae: ((sql: string) => Promise<Record<string, string | number>[]>) | null, env: Record<string, string> = { ANALYTICS_ADMIN_TOKEN: "t" }) {
  const state = new FakeState();
  for (const [k, v] of Object.entries(SEED)) state.storage.map.set(k, structuredClone(v));
  const obj = new AnalyticsDO(state as unknown as DurableObjectState, env);
  await state.ready;
  if (ae) obj.aeFetchOverride = ae;
  return obj;
}
const report = async (obj: InstanceType<typeof AnalyticsDO>, qs: string) =>
  (await (await obj.fetch(new Request(`https://analytics.internal/report?${qs}`, { headers: { authorization: "Bearer t" } }))).json()) as Record<string, any>;

/** A fake AE returning full (unsampled) 26 Sep telemetry: 50 starts, 40 completions. */
function fakeAe(opts: { fail?: boolean } = {}) {
  const calls: string[] = [];
  const fn = async (sql: string) => {
    calls.push(sql);
    if (opts.fail) throw new Error("AE SQL HTTP 503");
    if (sql.includes("GROUP BY day")) return [
      { day: "2026-09-26 00:00:00", ev: "game_started", aud: "external", n: 50 },
      { day: "2026-09-26 00:00:00", ev: "game_completed", aud: "external", n: 40 },
    ];
    if (sql.includes("GROUP BY ev, aud, platform, ver")) return [
      { ev: "game_started", aud: "external", platform: "android", ver: "0.53.0", n: 50 },
      { ev: "game_completed", aud: "external", platform: "android", ver: "0.53.0", n: 40 },
      // AE's copy of an exact event: the version mix may read it, no count may.
      { ev: "app_open", aud: "external", platform: "android", ver: "0.53.0", n: 11 },
    ];
    return [];
  };
  return { fn, calls };
}

test("hybrid daily report: telemetry from AE, exact events from the DO, same shape", async () => {
  const ae = fakeAe();
  const r = await report(await makeDO(ae.fn), "period=daily&date=2026-09-26");
  assert.equal(r.sources.mode, "hybrid");
  assert.deepEqual(r.sources.telemetryAeDates, ["2026-09-26"]);
  assert.equal(r.counts.game_started.total, 50, "AE, not the DO's 10% sample of 5");
  assert.equal(r.counts.app_open.total, 10, "exact event from the DO ledger");
  assert.equal(r.counts.result_shared.total, 6);
  assert.equal(r.counts.analytics_requests.total, 20, "request counter stays DO");
  assert.equal(r.completionRate, 40 / 50);
  assert.equal(r.shareRate, 6 / 40, "mixed: DO result_shared / AE game_completed");
  assert.equal(r.usage.gamesStarted, 50, "usage games follow the merged counters");
  for (const key of ["period", "startDate", "endDate", "audience", "counts", "completionRate", "shareRate", "averageScore", "passRate", "usage", "usageByAudience"]) assert.ok(key in r, `shape keeps ${key}`);
});

test("source=do, missing configuration and AE failure all return today's DO-only numbers", async () => {
  const forced = await report(await makeDO(fakeAe().fn), "period=daily&date=2026-09-26&source=do");
  const notConfigured = await report(await makeDO(null), "period=daily&date=2026-09-26");
  const failing = await report(await makeDO(fakeAe({ fail: true }).fn), "period=daily&date=2026-09-26");
  for (const r of [forced, notConfigured, failing]) {
    assert.equal(r.sources.mode, "durable-object");
    assert.equal(r.counts.game_started.total, 5);
    assert.equal(r.counts.app_open.total, 10);
  }
  assert.match(notConfigured.sources.reason, /not configured/);
  assert.match(failing.sources.reason, /DO fallback/);
  const { sources: _a, ...legacyA } = forced;
  const { sources: _b, ...legacyB } = notConfigured;
  assert.deepEqual(legacyA, legacyB, "fallbacks are byte-identical to the legacy report body");
});

test("a range spanning AE coverage mixes per day: 25 Sep from the DO, 26 Sep from AE; series follows", async () => {
  const r = await report(await makeDO(fakeAe().fn), "period=range&start=2026-09-25&end=2026-09-26&series=1");
  assert.equal(r.sources.telemetryEvents, "analytics-engine+durable-object");
  assert.deepEqual(r.sources.telemetryDoDates, ["2026-09-25"]);
  assert.equal(r.counts.game_started.total, 3 + 50);
  assert.equal(r.counts.app_open.total, 7 + 10, "exact events: DO every day, never doubled");
  const d25 = r.days.find((d: any) => d.date === "2026-09-25").counts;
  const d26 = r.days.find((d: any) => d.date === "2026-09-26").counts;
  assert.equal(d25.game_started.total, 3);
  assert.equal(d26.game_started.total, 50);
  assert.equal(d26.app_open.total, 10);
});

test("report cost is pinned: a 7-day page load is 7 AE queries, economy=only is the 8 economy queries alone, economy=1 is unchanged at 14", async () => {
  const range = "period=range&start=2026-09-26&end=2026-09-27";
  const pageLoad = fakeAe();
  const r = await report(await makeDO(pageLoad.fn), `${range}&series=1`);
  assert.equal(pageLoad.calls.length, 7, "6 main queries + 1 series segment");
  assert.ok(r.versions, "the version mix rides in the same response");
  assert.equal(r.sources.exactLedgerEvents.includes("app_open"), true);

  const only = fakeAe();
  const e = await report(await makeDO(only.fn), `${range}&economy=only`);
  assert.equal(only.calls.length, 8, "economy queries only");
  assert.ok(only.calls.every((sql) => sql.includes("double1 >= 2")), "every call is an economy (schema-2) query");
  assert.ok(e.economy && e.economy.spend, "economy block present");
  assert.equal("counts" in e, false, "no main report re-run");

  const legacy = fakeAe();
  const l = await report(await makeDO(legacy.fn), `${range}&economy=1`);
  assert.equal(legacy.calls.length, 14, "economy=1 keeps its old behaviour for any caller still using it");
  assert.deepEqual(l.economy.spend, e.economy.spend, "same exact half either way");
});

test("the version mix follows the audience and is null when AE was not used", async () => {
  const withAe = await report(await makeDO(fakeAe().fn), "period=daily&date=2026-09-26");
  assert.deepEqual(withAe.versions, { "android|0.53.0": { game_started: 50, game_completed: 40, app_open: 11 } });
  const doOnly = await report(await makeDO(fakeAe().fn), "period=daily&date=2026-09-26&source=do");
  assert.equal(doOnly.versions, null);
});

test("a range entirely before AE coverage never queries AE", async () => {
  const ae = fakeAe();
  const r = await report(await makeDO(ae.fn), "period=daily&date=2026-09-25");
  assert.equal(r.sources.mode, "durable-object");
  assert.match(r.sources.reason, /predates/);
  assert.equal(ae.calls.length, 0);
});

test("alltime stays the DO running total and says why", async () => {
  const r = await report(await makeDO(fakeAe().fn), "period=alltime");
  assert.equal(r.sources.mode, "durable-object");
  assert.match(r.sources.reason, /3 months/);
});
