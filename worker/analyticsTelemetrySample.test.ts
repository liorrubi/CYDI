// exactLedger.telemetrySamplePercent - the Phase 2 ROLLBACK sample rate.
//
// What must hold:
//  1. telemetryToDo:false (production since 27 Sep 2026): no telemetry reaches the DO,
//     whatever the sample rate says.
//  2. telemetryToDo:true + a rate: DO telemetry is sampled at that rate, even when the
//     legacy shed policy has expired or is NORMAL/monitor-only - the rollback stays cheap.
//  3. A live shed policy that keeps less still wins (the field can only reduce DO load).
//  4. Exact-ledger events are always forwarded, never sampled, recorded at keep 100.
//  5. Analytics Engine receives exactly the same writes whatever the DO sampling does.
//  6. Absent field = the behaviour before it existed.
import test from "node:test";
import assert from "node:assert/strict";

const { isValidExactLedgerConfig, telemetryToDoPolicy } = await import("./analyticsExactLedger.ts");
const { parseAnalyticsControl, isValidAnalyticsBreakerConfig, _resetAnalyticsBreakerCacheForTests } = await import("./analyticsBreaker.ts");
const { effectiveShedPolicy } = await import("./analyticsShedding.ts");
const { handleAnalyticsEvent } = await import("./index.ts");

const GAME = { gameType: "shapeChallenge", category: "geometric", contentKey: "circle" };
const env1 = (eventName: string, params: Record<string, unknown> = {}) => ({ eventName, params, platform: "android", appVersion: "0.53.0", installationId: "inst-1", sessionId: "sess-1" });
const APP_OPEN = env1("app_open");
const FIRST_OPEN = env1("first_open", { installAge: "h0_24" });
const GAME_STARTED = env1("game_started", GAME);
const SHAPE_DONE = env1("shape_completed", { category: "geometric", starRating: 3, passed: true, isNewBest: false });
const MP_STARTED = env1("mp_game_started", { playerCount: 2, roundCount: 10, difficulty: "mixed" });
const BATCH = { events: [APP_OPEN, GAME_STARTED, FIRST_OPEN, SHAPE_DONE] };
const EXACT = ["app_open", "first_open"];
const TELEMETRY = ["game_started", "shape_completed"];

class FakeKv {
  value: string | null;
  constructor(value: string | null) {
    this.value = value;
  }
  async get(): Promise<string | null> {
    return this.value;
  }
}

type DoCall = { path: string; names: string[]; keep: string | null };
class RecordingDo {
  calls: DoCall[] = [];
  idFromName(name: string) {
    return { name };
  }
  get() {
    return {
      fetch: async (url: string, init: RequestInit) => {
        const body = init.body instanceof ReadableStream ? await new Response(init.body).text() : String(init.body ?? "");
        const parsed = JSON.parse(body) as { events?: { eventName: string }[]; eventName?: string };
        const names = parsed.events ? parsed.events.map((e) => e.eventName) : [String(parsed.eventName)];
        this.calls.push({ path: new URL(url).pathname, names, keep: new Headers(init.headers).get("x-cydi-shed-keep") });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    };
  }
}

// Production's legacy shed block (27 Sep 2026): global ELEVATED 10%, preserveExtra, expiry.
const LIVE_SHED = { monitorOnly: false, globalMode: "ELEVATED", globalKeepPercent: 10, countries: {}, preserveExtra: ["app_open", "result_shared", "interstitial_checkpoint", "interstitial_continuation"], expiresAt: "2099-01-01T00:00:00Z" };
const SHEDS: Record<string, Record<string, unknown>> = {
  live: LIVE_SHED,
  expired: { ...LIVE_SHED, expiresAt: "2020-01-01T00:00:00Z" },
  normal: { monitorOnly: true, globalMode: "NORMAL", countries: {} },
  monitorOnly: { ...LIVE_SHED, monitorOnly: true },
  emergency: { ...LIVE_SHED, globalMode: "EMERGENCY" },
};
const cfg = (shed: Record<string, unknown> | undefined, ledger: Record<string, unknown>) => JSON.stringify(shed ? { disabled: false, shed, exactLedger: ledger } : { disabled: false, exactLedger: ledger });

async function ingest(kv: string, body: unknown, path: "/event" | "/events", random: number) {
  _resetAnalyticsBreakerCacheForTests();
  const analytics = new RecordingDo();
  const ae: string[] = [];
  const env = { CONTENT_KV: new FakeKv(kv), ANALYTICS_DO: analytics, ANALYTICS_AE: { writeDataPoint: (p: { blobs: string[] }) => void ae.push(p.blobs[0]) } } as unknown as Parameters<typeof handleAnalyticsEvent>[1];
  const real = Math.random;
  Math.random = () => random;
  try {
    const request = new Request(`https://playcydi.com/api/analytics${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const response = await handleAnalyticsEvent(request, env, path, { waitUntil: () => {} });
    return { status: response.status, calls: analytics.calls, ae: ae.sort() };
  } finally {
    Math.random = real;
  }
}

const doNames = (r: { calls: DoCall[] }) => r.calls.flatMap((c) => c.names).sort();
const RANDOMS = Array.from({ length: 100 }, (_, i) => i / 100 + 0.005);

// --------------------------------------------------------------- validation ----

test("telemetrySamplePercent: whole percent 0-100 only; absent stays valid; parse keeps it", () => {
  for (const ok of [0, 1, 10, 100]) assert.equal(isValidExactLedgerConfig({ enabled: true, telemetryToDo: true, telemetrySamplePercent: ok }), true, String(ok));
  for (const bad of [-1, 101, 10.5, "10", null, Number.NaN]) {
    assert.equal(isValidExactLedgerConfig({ enabled: true, telemetrySamplePercent: bad }), false, String(bad));
    assert.equal(isValidAnalyticsBreakerConfig({ disabled: false, exactLedger: { enabled: true, telemetrySamplePercent: bad } }), false);
  }
  assert.equal(isValidExactLedgerConfig({ enabled: true, telemetryToDo: false }), true, "backward compatible");
  const control = parseAnalyticsControl(cfg(LIVE_SHED, { enabled: true, telemetryToDo: false, telemetrySamplePercent: 10 }));
  assert.deepEqual(control.exactLedger, { enabled: true, telemetryToDo: false, telemetrySamplePercent: 10 });
  assert.equal(control.shed.globalKeepPercent, 10, "shed parsed alongside");
});

test("telemetryToDoPolicy: absent = shed policy; set = own rate; stricter enforced shed wins", () => {
  const now = Date.parse("2026-09-27T12:00:00Z");
  const pol = (name: string) => effectiveShedPolicy(SHEDS[name] as never, "IL", now);
  assert.equal(telemetryToDoPolicy({ enabled: true, telemetryToDo: true }, pol("live"))?.keepPercent, 10);
  assert.equal(telemetryToDoPolicy({ enabled: true, telemetryToDo: true }, pol("expired")), null, "absent + expired = everything (the costly rollback)");
  for (const name of ["expired", "normal", "monitorOnly"]) {
    const p = telemetryToDoPolicy({ enabled: true, telemetryToDo: true, telemetrySamplePercent: 10 }, pol(name));
    assert.equal(p?.keepPercent, 10, name);
    assert.equal(p?.source, "ledger");
    assert.equal(p?.monitorOnly, false);
  }
  assert.equal(telemetryToDoPolicy({ enabled: true, telemetryToDo: true, telemetrySamplePercent: 25 }, pol("live"))?.keepPercent, 10, "live shed 10% is stricter");
  assert.equal(telemetryToDoPolicy({ enabled: true, telemetryToDo: true, telemetrySamplePercent: 5 }, pol("live"))?.keepPercent, 5, "rate 5% is stricter");
  assert.equal(telemetryToDoPolicy({ enabled: true, telemetryToDo: true, telemetrySamplePercent: 10 }, pol("emergency"))?.keepPercent, 0, "EMERGENCY still 0%");
  assert.equal(telemetryToDoPolicy({ enabled: true, telemetryToDo: true, telemetrySamplePercent: 100 }, pol("expired")), null, "100% = send all");
});

// ------------------------------------------------------- Worker ingest path ----

test("telemetryToDo:false: no telemetry DO writes, whatever the sample percent or shed state", async () => {
  for (const shed of Object.keys(SHEDS)) {
    for (const rate of [undefined, 0, 10, 100]) {
      const ledger = rate === undefined ? { enabled: true, telemetryToDo: false } : { enabled: true, telemetryToDo: false, telemetrySamplePercent: rate };
      for (const random of [0.001, 0.5, 0.999]) {
        const r = await ingest(cfg(SHEDS[shed], ledger), BATCH, "/events", random);
        assert.deepEqual(doNames(r), EXACT, `${shed}/${rate}/${random}: exact only`);
        assert.equal(r.calls[0].keep, "100");
        const t = await ingest(cfg(SHEDS[shed], ledger), { events: [GAME_STARTED, SHAPE_DONE] }, "/events", random);
        assert.equal(t.calls.length, 0, "telemetry-only request: no DO request at all");
        assert.equal(t.status, 204);
      }
    }
  }
});

test("telemetryToDo:true + 10%: DO telemetry is sampled at 10% even with legacy shedding expired, NORMAL or monitor-only", async () => {
  for (const shed of ["expired", "normal", "monitorOnly"]) {
    const ledger = { enabled: true, telemetryToDo: true, telemetrySamplePercent: 10 };
    let telemetryKept = 0;
    for (const random of RANDOMS) {
      const r = await ingest(cfg(SHEDS[shed], ledger), BATCH, "/events", random);
      const names = doNames(r);
      for (const e of EXACT) assert.ok(names.includes(e), `${shed}: exact ${e} always`);
      telemetryKept += names.filter((n) => TELEMETRY.includes(n)).length;
      assert.equal(r.calls.length, 1, "one /ledger request");
      assert.equal(r.calls[0].path, "/ledger");
      assert.equal(r.calls[0].keep, "10", "the sampled request records its rate");
    }
    assert.equal(telemetryKept, 2 * 10, `${shed}: exactly 10% of telemetry across a uniform spread`);
  }
});

test("rollback safety: with legacy shedding expired, the rate cuts DO telemetry 10x versus the field absent", async () => {
  const count = async (ledger: Record<string, unknown>) => {
    let telemetry = 0;
    let doRequests = 0;
    for (const random of RANDOMS) {
      const r = await ingest(cfg(SHEDS.expired, ledger), { events: [GAME_STARTED, SHAPE_DONE] }, "/events", random);
      doRequests += r.calls.length;
      telemetry += doNames(r).length;
    }
    return { telemetry, doRequests };
  };
  const unguarded = await count({ enabled: true, telemetryToDo: true });
  const guarded = await count({ enabled: true, telemetryToDo: true, telemetrySamplePercent: 10 });
  assert.deepEqual(unguarded, { telemetry: 200, doRequests: 100 }, "absent + expired: every telemetry request reaches the DO");
  assert.deepEqual(guarded, { telemetry: 20, doRequests: 10 }, "10%: telemetry-only requests mostly never reach the DO");
});

test("a stricter live shed policy still wins (EMERGENCY 0% drops all DO telemetry)", async () => {
  for (const random of [0.001, 0.05, 0.5]) {
    const r = await ingest(cfg(SHEDS.emergency, { enabled: true, telemetryToDo: true, telemetrySamplePercent: 10 }), BATCH, "/events", random);
    assert.deepEqual(doNames(r), EXACT);
  }
});

test("exact events are always 100%, including telemetrySamplePercent 0 and single-event requests", async () => {
  for (const rate of [0, 10, 100]) {
    for (const random of [0.001, 0.999]) {
      const r = await ingest(cfg(SHEDS.expired, { enabled: true, telemetryToDo: true, telemetrySamplePercent: rate }), BATCH, "/events", random);
      for (const e of EXACT) assert.ok(doNames(r).includes(e), `rate ${rate}: ${e}`);
      const single = await ingest(cfg(SHEDS.expired, { enabled: true, telemetryToDo: true, telemetrySamplePercent: rate }), FIRST_OPEN, "/event", random);
      assert.deepEqual(doNames(single), ["first_open"]);
      assert.equal(single.calls[0].keep, "100", "an exact-only request is not a sample");
    }
  }
});

test("preserved telemetry (ALWAYS_PRESERVE, e.g. mp_game_started) is never sampled by the rollback rate", async () => {
  for (const random of [0.5, 0.999]) {
    const r = await ingest(cfg(SHEDS.expired, { enabled: true, telemetryToDo: true, telemetrySamplePercent: 10 }), { events: [MP_STARTED, GAME_STARTED] }, "/events", random);
    assert.deepEqual(doNames(r), ["mp_game_started"]);
  }
});

test("Analytics Engine is unaffected: identical AE writes for every DO sampling configuration", async () => {
  const configs = [
    { enabled: true, telemetryToDo: false },
    { enabled: true, telemetryToDo: false, telemetrySamplePercent: 10 },
    { enabled: true, telemetryToDo: true },
    { enabled: true, telemetryToDo: true, telemetrySamplePercent: 0 },
    { enabled: true, telemetryToDo: true, telemetrySamplePercent: 10 },
  ];
  for (const shed of Object.keys(SHEDS)) {
    for (const random of [0.001, 0.5, 0.999]) {
      for (const ledger of configs) {
        const r = await ingest(cfg(SHEDS[shed], ledger), BATCH, "/events", random);
        assert.deepEqual(r.ae, ["app_open", "first_open", "game_started", "shape_completed"], `${shed}/${JSON.stringify(ledger)}/${random}`);
      }
    }
  }
});

test("field absent = the behaviour before it existed (shed sample when live, everything when expired)", async () => {
  const live = await ingest(cfg(SHEDS.live, { enabled: true, telemetryToDo: true }), BATCH, "/events", 0.5);
  assert.deepEqual(doNames(live), EXACT);
  assert.equal(live.calls[0].keep, "10");
  const kept = await ingest(cfg(SHEDS.live, { enabled: true, telemetryToDo: true }), BATCH, "/events", 0.05);
  assert.deepEqual(doNames(kept), [...EXACT, ...TELEMETRY].sort());
  const expired = await ingest(cfg(SHEDS.expired, { enabled: true, telemetryToDo: true }), BATCH, "/events", 0.999);
  assert.deepEqual(doNames(expired), [...EXACT, ...TELEMETRY].sort());
  assert.equal(expired.calls[0].keep, "100");
});

test("exactLedger off ignores the rate: the legacy path is unchanged (why the ledger must not be casually disabled)", async () => {
  const withRate = await ingest(cfg(SHEDS.expired, { enabled: false, telemetryToDo: true, telemetrySamplePercent: 10 }), BATCH, "/events", 0.999);
  const without = await ingest(cfg(SHEDS.expired, { enabled: false }), BATCH, "/events", 0.999);
  assert.deepEqual(withRate.calls, without.calls);
  assert.equal(withRate.calls[0].path, "/events", "legacy route, all of it");
  assert.deepEqual(doNames(withRate), [...EXACT, ...TELEMETRY].sort());
});
