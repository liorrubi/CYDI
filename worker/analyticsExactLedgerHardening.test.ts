// Phase 2 hardening (review blockers):
//  1. each ingest body is parsed once, and the parsed-input APIs match the string APIs;
//  2. Ops Panel writes preserve a stored exactLedger block unless they set it;
//  3. unknown / invalid single events keep production's exact HTTP behaviour under Phase 2.
import test from "node:test";
import assert from "node:assert/strict";

const { handleAnalyticsEvent, default: worker } = await import("./index.ts");
const { _resetAnalyticsBreakerCacheForTests } = await import("./analyticsBreaker.ts");
const { isAnalyticsEventName } = await import("../src/services/analyticsSchema.ts");
const { buildShadowDataPoints, buildShadowDataPointsFromParsed } = await import("./analyticsShadow.ts");
const { decideShedding, decideSheddingParsed, effectiveShedPolicy } = await import("./analyticsShedding.ts");
const { parseIngest, UNPARSEABLE } = await import("./analyticsIngest.ts");

const GAME = { gameType: "shapeChallenge", category: "geometric", contentKey: "circle" };
const env1 = (eventName: string, params: Record<string, unknown> = {}) => ({ eventName, params, platform: "android", appVersion: "0.53.0" });
const APP_OPEN = env1("app_open");
const GAME_STARTED = env1("game_started", GAME);

const SHED = { monitorOnly: false, globalMode: "ELEVATED", globalKeepPercent: 10, countries: {}, preserveExtra: ["app_open", "result_shared", "interstitial_checkpoint", "interstitial_continuation"], expiresAt: "2099-01-01T00:00:00Z" };
const PROD = JSON.stringify({ disabled: false, shed: SHED });
const withLedger = (ledger: Record<string, unknown>) => JSON.stringify({ disabled: false, shed: SHED, exactLedger: ledger });
const noShedLedger = (ledger: Record<string, unknown>) => JSON.stringify({ disabled: false, exactLedger: ledger });

class FakeKv {
  value: string | null;
  constructor(value: string | null) {
    this.value = value;
  }
  async get(): Promise<string | null> {
    return this.value;
  }
  async put(_key: string, value: string): Promise<void> {
    this.value = value;
  }
}

type DoCall = { path: string; body: string; keep: string | null };

/** Answers like the real AnalyticsDO for the single-event route: 400 for an unknown name or invalid params. */
class RealisticDo {
  calls: DoCall[] = [];
  idFromName(name: string) {
    return { name };
  }
  get() {
    return {
      fetch: async (url: string, init: RequestInit) => {
        const body = init.body instanceof ReadableStream ? await new Response(init.body).text() : String(init.body ?? "");
        const path = new URL(url).pathname;
        this.calls.push({ path, body, keep: new Headers(init.headers).get("x-cydi-shed-keep") });
        if (path === "/event") {
          const b = JSON.parse(body) as { eventName?: unknown; params?: { installAge?: string } };
          if (!isAnalyticsEventName(b.eventName)) return new Response('{"error":"invalid event"}', { status: 400 });
          if (b.eventName === "first_open" && b.params?.installAge === "bogus") return new Response('{"error":"invalid params"}', { status: 400 });
        }
        return new Response('{"ok":true}', { status: 200 });
      },
    };
  }
}

async function ingest(kv: string | null, body: unknown, path: "/event" | "/events", random: number) {
  _resetAnalyticsBreakerCacheForTests();
  const analytics = new RealisticDo();
  const env = { CONTENT_KV: new FakeKv(kv), ANALYTICS_DO: analytics, ANALYTICS_AE: { writeDataPoint() {} } } as unknown as Parameters<typeof handleAnalyticsEvent>[1];
  const real = Math.random;
  Math.random = () => random;
  try {
    const response = await handleAnalyticsEvent(new Request(`https://playcydi.com/api/analytics${path}`, { method: "POST", body: JSON.stringify(body) }), env, path, { waitUntil: () => {} });
    return { status: response.status, calls: analytics.calls };
  } finally {
    Math.random = real;
  }
}

// ---- 3. legacy response semantics -------------------------------------------------

test("an unknown single event answers exactly as production does, Phase 2 on or off (NORMAL and ELEVATED)", async () => {
  const unknown = env1("not_a_real_event");
  const cases: [string | null, string, string][] = [
    [null, noShedLedger({ enabled: true }), noShedLedger({ enabled: true, telemetryToDo: true })],
    [PROD, withLedger({ enabled: true }), withLedger({ enabled: true, telemetryToDo: true })],
  ];
  for (const [off, on, onT] of cases) {
    for (const random of [0.01, 0.99]) {
      const a = await ingest(off, unknown, "/event", random);
      assert.deepEqual(await ingest(on, unknown, "/event", random), a, `Phase 2 == production (random=${random})`);
      assert.deepEqual(await ingest(onT, unknown, "/event", random), a);
    }
  }
  // Concretely: NORMAL -> the DO's 400 every time; ELEVATED -> 400 when the dice keep it, 204 when they drop it.
  assert.equal((await ingest(noShedLedger({ enabled: true }), unknown, "/event", 0.5)).status, 400);
  assert.equal((await ingest(withLedger({ enabled: true }), unknown, "/event", 0.01)).status, 400);
  assert.equal((await ingest(withLedger({ enabled: true }), unknown, "/event", 0.99)).status, 204);
});

test("an exact-named single event with invalid params still gets the DO's 400 - never a /ledger 200", async () => {
  const badExact = env1("first_open", { installAge: "bogus" });
  for (const random of [0.01, 0.99]) {
    const off = await ingest(PROD, badExact, "/event", random);
    const on = await ingest(withLedger({ enabled: true }), badExact, "/event", random);
    assert.deepEqual(on, off);
    assert.equal(on.status, 400);
    assert.ok(on.calls.every((c) => c.path === "/event"));
  }
});

// ---- 1. one parse per request -------------------------------------------------------

async function countBodyParses(kv: string, body: unknown, path: "/event" | "/events", random: number): Promise<number> {
  const text = JSON.stringify(body);
  const realParse = JSON.parse;
  let n = 0;
  JSON.parse = ((s: string, reviver?: Parameters<typeof JSON.parse>[1]) => {
    if (s === text) n++;
    return realParse(s, reviver);
  }) as typeof JSON.parse;
  const realRandom = Math.random;
  Math.random = () => random;
  try {
    _resetAnalyticsBreakerCacheForTests();
    // A DO double that never parses - so every counted parse is the Worker's own.
    const analytics = { idFromName: (n: string) => ({ n }), get: () => ({ fetch: async () => new Response("{}", { status: 200 }) }) };
    const env = { CONTENT_KV: new FakeKv(kv), ANALYTICS_DO: analytics, ANALYTICS_AE: { writeDataPoint() {} } } as unknown as Parameters<typeof handleAnalyticsEvent>[1];
    await handleAnalyticsEvent(new Request(`https://playcydi.com/api/analytics${path}`, { method: "POST", body: text }), env, path, { waitUntil: () => {} });
  } finally {
    JSON.parse = realParse;
    Math.random = realRandom;
  }
  return n;
}

test("the Worker parses each ingest body exactly once", async () => {
  const big = { events: Array.from({ length: 50 }, (_, i) => (i % 5 === 0 ? APP_OPEN : GAME_STARTED)) };
  for (const random of [0.01, 0.99]) {
    assert.equal(await countBodyParses(PROD, big, "/events", random), 1, "flag off, ELEVATED (production today)");
    assert.equal(await countBodyParses(PROD, GAME_STARTED, "/event", random), 1, "flag off, single event");
    assert.equal(await countBodyParses(withLedger({ enabled: true }), big, "/events", random), 1, "Phase 2");
    assert.equal(await countBodyParses(withLedger({ enabled: true, telemetryToDo: true }), big, "/events", random), 1, "Phase 2 + telemetryToDo");
    assert.equal(await countBodyParses(withLedger({ enabled: true }), env1("not_a_real_event"), "/event", random), 1, "Phase 2 legacy fallback");
  }
});

test("parsed-input APIs produce exactly what the string APIs did", () => {
  const bodies: ["/event" | "/events", string][] = [
    ["/events", JSON.stringify({ events: [APP_OPEN, GAME_STARTED, env1("first_open", { installAge: "h0_24" })] })],
    ["/events", JSON.stringify({ events: [APP_OPEN, env1("nope"), GAME_STARTED] })],
    ["/event", JSON.stringify(GAME_STARTED)],
    ["/event", "{not json"],
    ["/event", ""],
    ["/events", JSON.stringify({ events: [] })],
    ["/event", JSON.stringify({ ...APP_OPEN, pad: "x".repeat(1600) })],
  ];
  const policy = effectiveShedPolicy(SHED as never, "DE");
  const withoutSurvivors = (d: Record<string, unknown>) => {
    const { survivors: _ignored, ...rest } = d;
    return rest;
  };
  for (const [path, text] of bodies) {
    const parsed = parseIngest(path, text);
    for (const r of [0.05, 0.5, 0.95]) {
      assert.deepEqual(buildShadowDataPointsFromParsed(parsed, "DE", () => r), buildShadowDataPoints(path, text, "DE", () => r), `AE ${path} ${text.slice(0, 30)}`);
      assert.deepEqual(
        withoutSurvivors(decideSheddingParsed(policy, path, parsed.json, SHED as never, () => r)),
        withoutSurvivors(decideShedding(policy, path, text, SHED as never, () => r)),
        `shed ${path} ${text.slice(0, 30)}`,
      );
    }
  }
  assert.equal(parseIngest("/event", "{bad").json, UNPARSEABLE);
});

// ---- 2. Ops Panel compatibility -------------------------------------------------------

async function putBreaker(stored: object | null, body: object, who: "ops" | "operator") {
  _resetAnalyticsBreakerCacheForTests();
  const kv = new FakeKv(stored === null ? null : JSON.stringify(stored));
  const env = { CONTENT_KV: kv, ANALYTICS_GUARD_ADMIN_TOKEN: "operator-token", OPS_ANALYTICS_GUARD_ADMIN_TOKEN: "ops-token" } as unknown as Parameters<typeof worker.fetch>[1];
  const res = await worker.fetch(
    new Request("https://playcydi.com/api/config/analytics-breaker", {
      method: "PUT",
      headers: { authorization: `Bearer ${who === "ops" ? "ops-token" : "operator-token"}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, stored: kv.value === null ? null : (JSON.parse(kv.value) as Record<string, any>) };
}

test("an Ops Panel write that omits exactLedger preserves the stored block, whatever its state", async () => {
  for (const ledger of [{ enabled: true }, { enabled: false }, { enabled: true, telemetryToDo: true }]) {
    const r = await putBreaker({ disabled: false, shed: SHED, exactLedger: ledger }, { disabled: false, shed: { ...SHED, globalKeepPercent: 25 } }, "ops");
    assert.equal(r.status, 200);
    assert.deepEqual(r.stored?.exactLedger, ledger, "carried through unchanged");
    assert.equal(r.stored?.shed.globalKeepPercent, 25, "the panel's own change still applied");
  }
});

test("an Ops Panel write that sets exactLedger changes it; none is invented when none was stored; breaker stays locked", async () => {
  const explicit = await putBreaker({ disabled: false, shed: SHED, exactLedger: { enabled: true } }, { disabled: false, shed: SHED, exactLedger: { enabled: false } }, "ops");
  assert.deepEqual(explicit.stored?.exactLedger, { enabled: false });
  const none = await putBreaker({ disabled: false, shed: SHED }, { disabled: false, shed: SHED }, "ops");
  assert.equal(none.stored && "exactLedger" in none.stored, false);
  const breaker = await putBreaker({ disabled: false, shed: SHED, exactLedger: { enabled: true } }, { disabled: true }, "ops");
  assert.equal(breaker.status, 403);
});

test("operator (CLI) writes keep full-replace semantics - omitting the block is the documented rollback", async () => {
  const r = await putBreaker({ disabled: false, shed: SHED, exactLedger: { enabled: true } }, { disabled: false, shed: SHED }, "operator");
  assert.equal(r.status, 200);
  assert.equal(r.stored && "exactLedger" in r.stored, false);
});
