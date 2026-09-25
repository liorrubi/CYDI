// Analytics Phase 2: durable exact ledger in AnalyticsDO, telemetry in Analytics Engine.
//
// What must hold:
//  1. Flag off (the default, and production today): ingest behaves exactly as before.
//  2. Flag on: exact events reach the DO once, via the durable `/ledger` route, and
//     survive a hibernation; telemetry reaches AE; AE failure changes nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { israelDateKey } from "../src/app/israelDate.ts";

const { EXACT_LEDGER_EVENTS, isValidExactLedgerConfig, splitForLedger } = await import("./analyticsExactLedger.ts");
const { ALWAYS_PRESERVE } = await import("./analyticsShedding.ts");
const { parseAnalyticsControl, isValidAnalyticsBreakerConfig, _resetAnalyticsBreakerCacheForTests } = await import("./analyticsBreaker.ts");
const { handleAnalyticsEvent } = await import("./index.ts");
const { AnalyticsDO } = await import("./analyticsDO.ts");
const { isAnalyticsEventName } = await import("../src/services/analyticsSchema.ts");

const GAME = { gameType: "shapeChallenge", category: "geometric", contentKey: "circle" };
const env1 = (eventName: string, params: Record<string, unknown> = {}) => ({ eventName, params, platform: "android", appVersion: "0.53.0", installationId: "inst-1", sessionId: "sess-1" });
const APP_OPEN = env1("app_open");
const FIRST_OPEN = env1("first_open", { installAge: "h0_24" });
const GAME_STARTED = env1("game_started", GAME);
const SHAPE_DONE = env1("shape_completed", { category: "geometric", starRating: 3, passed: true, isNewBest: false });

// --------------------------------------------------------------- the list ----

test("EXACT_LEDGER_EVENTS: real event names, acquisition + money + ad outcomes, mp_game_started deliberately out", () => {
  for (const name of EXACT_LEDGER_EVENTS) assert.ok(isAnalyticsEventName(name), `${name} is a real event`);
  for (const name of ["first_open", "install_attributed", "app_open", "shop_purchase_with_coins", "purchase_completed", "rewarded_ad_completed", "interstitial_dismissed", "mp_room_created", "tutorial_completed"]) {
    assert.ok(EXACT_LEDGER_EVENTS.has(name), `${name} is exact`);
  }
  assert.equal(EXACT_LEDGER_EVENTS.has("mp_game_started"), false);
  assert.equal(EXACT_LEDGER_EVENTS.has("game_started"), false);
  // Everything exact is already protected from sampling today (ALWAYS_PRESERVE or the interstitial A/B pair).
  const preservedToday = new Set([...ALWAYS_PRESERVE, "interstitial_checkpoint", "interstitial_continuation"]);
  for (const name of EXACT_LEDGER_EVENTS) assert.ok(preservedToday.has(name), `${name} is preserved today`);
});

// ---------------------------------------------------------------- the gate ----

test("gate: absent, malformed or false means off; breaker keeps working next to it", () => {
  assert.equal(parseAnalyticsControl(null).exactLedger.enabled, false);
  assert.equal(parseAnalyticsControl('{"disabled":false}').exactLedger.enabled, false);
  assert.equal(parseAnalyticsControl('{"disabled":false,"exactLedger":{"enabled":"yes"}}').exactLedger.enabled, false);
  assert.equal(parseAnalyticsControl('{"disabled":false,"exactLedger":{"enabled":true}}').exactLedger.enabled, true);
  // A broken Phase 2 block never takes the breaker down with it.
  assert.equal(parseAnalyticsControl('{"disabled":true,"exactLedger":{"enabled":"yes"}}').disabled, true);
  assert.equal(isValidExactLedgerConfig({ enabled: true, telemetryToDo: true }), true);
  assert.equal(isValidExactLedgerConfig({ enabled: true, extra: 1 }), false);
  assert.equal(isValidAnalyticsBreakerConfig({ disabled: false, exactLedger: { enabled: true } }), true);
  assert.equal(isValidAnalyticsBreakerConfig({ disabled: false, exactLedger: { enabled: 1 } }), false);
  assert.equal(isValidAnalyticsBreakerConfig({ disabled: false, other: 1 }), false);
});

test("splitForLedger: exact vs telemetry by name; whole-body rejects return null", () => {
  const s = splitForLedger("/events", JSON.stringify({ events: [APP_OPEN, GAME_STARTED, FIRST_OPEN, env1("nope")] }));
  assert.deepEqual(s?.exact.map((e) => (e as { eventName: string }).eventName), ["app_open", "first_open"]);
  assert.deepEqual(s?.telemetry.map((e) => (e as { eventName: string }).eventName), ["game_started", "nope"]);
  assert.equal(splitForLedger("/events", "{bad"), null);
  assert.equal(splitForLedger("/events", JSON.stringify({ events: [] })), null);
  assert.equal(splitForLedger("/event", ""), null);
});

// ------------------------------------------------------------ Worker routing ----

class FakeKv {
  value: string | null;
  constructor(value: string | null) {
    this.value = value;
  }
  async get(): Promise<string | null> {
    return this.value;
  }
}

type DoCall = { path: string; body: string; keep: string | null };
class RecordingDo {
  calls: DoCall[] = [];
  idFromName(name: string) {
    return { name };
  }
  get() {
    return {
      fetch: async (url: string, init: RequestInit) => {
        const body = init.body instanceof ReadableStream ? await new Response(init.body).text() : String(init.body ?? "");
        this.calls.push({ path: new URL(url).pathname, body, keep: new Headers(init.headers).get("x-cydi-shed-keep") });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    };
  }
}

// Today's production analytics control, verbatim in shape: global ELEVATED 10%, preserveExtra as live.
const SHED = { monitorOnly: false, globalMode: "ELEVATED", globalKeepPercent: 10, countries: {}, preserveExtra: ["app_open", "result_shared", "interstitial_checkpoint", "interstitial_continuation"], expiresAt: "2099-01-01T00:00:00Z" };
const PROD = JSON.stringify({ disabled: false, shed: SHED });
const withLedger = (ledger: Record<string, unknown>) => JSON.stringify({ disabled: false, shed: SHED, exactLedger: ledger });

async function ingest(kv: string | null, body: unknown, path: "/event" | "/events", opts: { random?: number; ae?: unknown } = {}) {
  _resetAnalyticsBreakerCacheForTests();
  const analytics = new RecordingDo();
  const aeWrites: { blobs: string[] }[] = [];
  const ae = opts.ae ?? { writeDataPoint: (p: { blobs: string[] }) => void aeWrites.push(p) };
  const env = { CONTENT_KV: new FakeKv(kv), ANALYTICS_DO: analytics, ANALYTICS_AE: ae } as unknown as Parameters<typeof handleAnalyticsEvent>[1];
  const real = Math.random;
  Math.random = () => opts.random ?? 0.5;
  try {
    const request = new Request(`https://playcydi.com/api/analytics${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
    const response = await handleAnalyticsEvent(request, env, path, { waitUntil: () => {} });
    return { status: response.status, calls: analytics.calls, ae: aeWrites.map((p) => p.blobs[0]) };
  } finally {
    Math.random = real;
  }
}

const names = (call: DoCall) => (JSON.parse(call.body).events as { eventName: string }[]).map((e) => e.eventName);
const BATCH = { events: [APP_OPEN, GAME_STARTED, FIRST_OPEN, SHAPE_DONE] };

test("flag OFF: production behaviour unchanged (absent block == enabled:false == today)", async () => {
  for (const random of [0.01, 0.99]) {
    const today = await ingest(PROD, BATCH, "/events", { random });
    const off = await ingest(withLedger({ enabled: false }), BATCH, "/events", { random });
    const offTelemetry = await ingest(withLedger({ enabled: false, telemetryToDo: true }), BATCH, "/events", { random });
    assert.deepEqual(off.calls, today.calls);
    assert.deepEqual(offTelemetry.calls, today.calls);
    assert.equal(off.status, today.status);
    assert.ok(today.calls.every((c) => c.path === "/events"), "today's route");
  }
  // Single-event legacy route, sampled away, answers 204 exactly as before.
  const legacy = await ingest(withLedger({ enabled: false }), GAME_STARTED, "/event", { random: 0.99 });
  assert.equal(legacy.status, 204);
  assert.equal(legacy.calls.length, 0);
});

test("flag ON: exact -> one durable /ledger request; telemetry -> AE only", async () => {
  const r = await ingest(withLedger({ enabled: true }), BATCH, "/events", { random: 0.01 });
  assert.equal(r.status, 200);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].path, "/ledger");
  assert.deepEqual(names(r.calls[0]), ["app_open", "first_open"]);
  assert.equal(r.calls[0].keep, "100", "exact events are never a sample");
  assert.deepEqual(r.ae.sort(), ["app_open", "first_open", "game_started", "shape_completed"], "AE still gets everything");
});

test("flag ON: a telemetry-only request costs no DO request at all", async () => {
  const r = await ingest(withLedger({ enabled: true }), { events: [GAME_STARTED, SHAPE_DONE] }, "/events");
  assert.equal(r.status, 204);
  assert.equal(r.calls.length, 0);
  assert.deepEqual(r.ae.sort(), ["game_started", "shape_completed"]);
  const single = await ingest(withLedger({ enabled: true }), GAME_STARTED, "/event");
  assert.equal(single.status, 204);
  assert.equal(single.calls.length, 0);
  assert.deepEqual(single.ae, ["game_started"]);
});

test("flag ON: legacy single exact event goes to /ledger", async () => {
  const r = await ingest(withLedger({ enabled: true }), FIRST_OPEN, "/event");
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].path, "/ledger");
  assert.deepEqual(names(r.calls[0]), ["first_open"]);
});

test("flag ON + telemetryToDo: the shed sample rides in the same /ledger request", async () => {
  const kept = await ingest(withLedger({ enabled: true, telemetryToDo: true }), BATCH, "/events", { random: 0.01 });
  assert.equal(kept.calls.length, 1);
  assert.deepEqual(names(kept.calls[0]).sort(), ["app_open", "first_open", "game_started", "shape_completed"]);
  assert.equal(kept.calls[0].keep, "10", "a sampled request records its rate, as today");
  const dropped = await ingest(withLedger({ enabled: true, telemetryToDo: true }), BATCH, "/events", { random: 0.99 });
  assert.equal(dropped.calls.length, 1);
  assert.deepEqual(names(dropped.calls[0]).sort(), ["app_open", "first_open"], "exact never sampled");
});

test("no duplicate exact counts: every exact envelope is forwarded exactly once", async () => {
  for (const cfg of [{ enabled: true }, { enabled: true, telemetryToDo: true }]) {
    for (const random of [0.01, 0.5, 0.99]) {
      const r = await ingest(withLedger(cfg), BATCH, "/events", { random });
      const forwarded = r.calls.flatMap(names);
      assert.equal(forwarded.filter((n) => n === "app_open").length, 1);
      assert.equal(forwarded.filter((n) => n === "first_open").length, 1);
      assert.equal(r.calls.length, 1, "one DO request per ingest request, never two");
    }
  }
});

test("AE failure is fail-open: DO calls and status identical with AE absent, healthy or throwing", async () => {
  for (const cfg of [PROD, withLedger({ enabled: true })]) {
    const healthy = await ingest(cfg, BATCH, "/events", { random: 0.01 });
    const throwing = await ingest(cfg, BATCH, "/events", { random: 0.01, ae: { writeDataPoint() { throw new Error("AE down"); } } });
    const absent = await ingest(cfg, BATCH, "/events", { random: 0.01, ae: null });
    assert.deepEqual(throwing.calls, healthy.calls);
    assert.deepEqual(absent.calls, healthy.calls);
    assert.equal(throwing.status, healthy.status);
  }
});

test("flag ON: a body the DO would reject whole still goes the old way; breaker still wins", async () => {
  const bad = await ingest(withLedger({ enabled: true }), "{not json", "/events");
  assert.equal(bad.calls.length, 1);
  assert.equal(bad.calls[0].path, "/events");
  const off = await ingest(JSON.stringify({ disabled: true, exactLedger: { enabled: true } }), BATCH, "/events");
  assert.equal(off.status, 204);
  assert.equal(off.calls.length, 0);
  assert.equal(off.ae.length, 0);
});

// ------------------------------------------------- DO durability (the bug and the fix) ----

class FakeStorage {
  map = new Map<string, unknown>();
  async get<T>(k: string | string[]): Promise<unknown> {
    if (Array.isArray(k)) return new Map(k.filter((x) => this.map.has(x)).map((x) => [x, structuredClone(this.map.get(x)) as T]));
    return this.map.has(k) ? structuredClone(this.map.get(k)) : undefined;
  }
  async put(entries: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(entries)) this.map.set(key, structuredClone(value));
  }
  async deleteAlarm(): Promise<void> {}
}
class FakeState {
  storage: FakeStorage;
  ready: Promise<unknown> = Promise.resolve();
  constructor(storage: FakeStorage) {
    this.storage = storage;
  }
  blockConcurrencyWhile(fn: () => Promise<unknown>) {
    this.ready = fn();
    return this.ready;
  }
}

/** A fresh instance over the same storage == what the next request after a hibernation gets. */
async function instance(storage: FakeStorage) {
  const state = new FakeState(storage);
  const obj = new AnalyticsDO(state as unknown as DurableObjectState, { ANALYTICS_ADMIN_TOKEN: "t" });
  await state.ready;
  return obj;
}
const post = (obj: InstanceType<typeof AnalyticsDO>, route: string, events: unknown[]) =>
  obj.fetch(new Request(`https://analytics.internal${route}`, { method: "POST", headers: { "x-cydi-country": "DE", "x-cydi-shed-keep": "100" }, body: JSON.stringify({ events }) }));
const persistedTotal = (storage: FakeStorage, event: string) =>
  ((storage.map.get(`day:${israelDateKey(Date.now())}`) as Record<string, { total: number }> | undefined)?.[event]?.total) ?? 0;

test("DO today (/events): a second event within 15 s is lost when the object hibernates - the bug", async () => {
  const storage = new FakeStorage();
  const obj = await instance(storage);
  await post(obj, "/events", [APP_OPEN]); // fresh instance: lastFlushAt=0, so this one is flushed
  await post(obj, "/events", [APP_OPEN]); // within 15 s and under 5 events: buffered only
  await instance(storage); // hibernation: memory discarded, next request gets a new instance
  assert.equal(persistedTotal(storage, "app_open"), 1, "the buffered event never reached storage");
});

test("DO Phase 2 (/ledger): every exact event is persisted before the response and survives hibernation", async () => {
  const storage = new FakeStorage();
  const obj = await instance(storage);
  const r1 = await post(obj, "/ledger", [APP_OPEN]);
  const r2 = await post(obj, "/ledger", [APP_OPEN, FIRST_OPEN]);
  assert.equal(r1.status, 200);
  assert.equal((await r2.json() as { durable?: boolean }).durable, true);
  await instance(storage); // hibernation
  assert.equal(persistedTotal(storage, "app_open"), 2);
  assert.equal(persistedTotal(storage, "first_open"), 1);
  const requests = (storage.map.get(`day:${israelDateKey(Date.now())}`) as Record<string, { total: number }>).analytics_requests?.total;
  assert.equal(requests, 2, "one request counted per /ledger call, no double counting");
});

test("DO /ledger keeps DO validation: an invalid exact envelope is rejected, not counted", async () => {
  const storage = new FakeStorage();
  const obj = await instance(storage);
  const r = await post(obj, "/ledger", [env1("first_open", { installAge: "bogus" }), APP_OPEN]);
  const body = await r.json() as { accepted: number; rejected: number };
  assert.deepEqual([body.accepted, body.rejected], [1, 1]);
  assert.equal(persistedTotal(storage, "first_open"), 0);
  assert.equal(persistedTotal(storage, "app_open"), 1);
});
