// Phase 1 Analytics Engine shadow write.
//
// Two properties matter more than the schema itself:
//  1. AE gets exactly what AnalyticsDO would accept - never a 400'd envelope.
//  2. The production path is untouched: same DO body, same keep header, same status,
//     whether the AE binding is absent, healthy or throwing.
import test from "node:test";
import assert from "node:assert/strict";

const { buildShadowDataPoints, writeAnalyticsShadow, AE_SCHEMA_VERSION, AE_INDEX_BUCKETS } = await import("./analyticsShadow.ts");
const { handleAnalyticsEvent } = await import("./index.ts");
const { _resetAnalyticsBreakerCacheForTests } = await import("./analyticsBreaker.ts");
const { validateEventParams } = await import("../src/services/analyticsSchema.ts");
const { REWARDED_AD_PLACEMENTS } = await import("../src/services/ads/adPlacements.ts");

const PLACEMENT = REWARDED_AD_PLACEMENTS[0];
const GAME = { gameType: "shapeChallenge", category: "geometric", contentKey: "circle" };

function envelope(eventName: string, params: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    eventName,
    params,
    platform: "android",
    appVersion: "0.53.0",
    appVersionCode: 48,
    installationId: "inst-SECRET-1234567890",
    sessionId: "sess-SECRET-1234567890",
    isInternal: false,
    ...extra,
  };
}

test("fixture envelopes are valid per the shared schema (guards the rest of this file)", () => {
  assert.equal(validateEventParams("game_started", GAME).valid, true);
  assert.equal(validateEventParams("rewarded_ad_unavailable", { placement: PLACEMENT, reason: "no_fill" }).valid, true);
  assert.equal(validateEventParams("app_open", {}).valid, true);
});

// ----------------------------------------------------------- acceptance ----

test("a valid single event becomes one data point with the documented positional schema", () => {
  const points = buildShadowDataPoints("/event", JSON.stringify(envelope("game_started", GAME)), "ir", () => 0.5);
  assert.equal(points.length, 1);
  const [p] = points;
  assert.deepEqual(p.blobs.slice(0, 11), ["game_started", "event", "IR", "android", "0.53.0", "48", "external", "classic", "shapeChallenge", "geometric", "circle"]);
  assert.equal(p.doubles[0], AE_SCHEMA_VERSION);
  assert.equal(p.doubles[12], 1, "batchSize");
  assert.deepEqual(p.indexes, ["b32"]);
});

test("anything AnalyticsDO would reject writes nothing", () => {
  assert.deepEqual(buildShadowDataPoints("/event", "", "US"), []);
  assert.deepEqual(buildShadowDataPoints("/event", "{not json", "US"), []);
  assert.deepEqual(buildShadowDataPoints("/event", JSON.stringify(envelope("no_such_event", {})), "US"), []);
  assert.deepEqual(buildShadowDataPoints("/event", JSON.stringify(envelope("game_started", { gameType: "nope" })), "US"), []);
  // Over the DO's single-event cap (1536) - the DO 400s it, so AE must not see it.
  const big = JSON.stringify(envelope("app_open", {}, { pad: "x".repeat(1600) }));
  assert.deepEqual(buildShadowDataPoints("/event", big, "US"), []);
  assert.deepEqual(buildShadowDataPoints("/events", JSON.stringify({ events: [] }), "US"), []);
  assert.deepEqual(buildShadowDataPoints("/events", JSON.stringify({ nope: 1 }), "US"), []);
  const tooMany = { events: Array.from({ length: 51 }, () => envelope("app_open", {})) };
  assert.deepEqual(buildShadowDataPoints("/events", JSON.stringify(tooMany), "US"), []);
});

test("a batch keeps its valid entries and skips invalid ones, exactly as the DO does", () => {
  const body = JSON.stringify({ events: [envelope("app_open", {}), envelope("bogus", {}), envelope("game_started", GAME)] });
  const points = buildShadowDataPoints("/events", body, "DE");
  assert.deepEqual(points.map((p) => p.blobs[0]), ["app_open", "game_started"]);
  assert.ok(points.every((p) => p.blobs[1] === "events" && p.doubles[12] === 3));
});

test("legacy alias is stored under the canonical name, like the DO counters", () => {
  const params = { productType: "penColor", tier: "basic", price: 100 };
  if (!validateEventParams("purchase_completed", params).valid) return; // schema-dependent fixture
  const [p] = buildShadowDataPoints("/event", JSON.stringify(envelope("purchase_completed", params)), "US");
  assert.equal(p.blobs[0], "shop_purchase_with_coins");
  assert.equal(p.blobs[19], "productType:penColor");
  assert.equal(p.doubles[7], 100);
});

test("ad placement and reason land in their own columns", () => {
  const [p] = buildShadowDataPoints("/event", JSON.stringify(envelope("rewarded_ad_unavailable", { placement: PLACEMENT, reason: "no_fill" })), "IR");
  assert.equal(p.blobs[15], PLACEMENT);
  assert.equal(p.blobs[16], "no_fill");
});

// -------------------------------------------------------------- privacy ----

test("no identifier, and no customChallenge content key, ever reaches AE", () => {
  const custom = { ...GAME, gameType: "customChallenge", contentKey: "ABCD1234" };
  const body = JSON.stringify({ events: [envelope("game_started", custom), envelope("app_open", {}, { attribution: { source: "youtube", medium: "social", campaign: "cydi_shorts", content: "vid123", term: "" } })] });
  const points = buildShadowDataPoints("/events", body, "US");
  const everything = JSON.stringify(points);
  assert.equal(everything.includes("SECRET"), false, "installation/session ids must never be written");
  assert.equal(points[0].blobs[10], "", "customChallenge content key dropped");
  assert.equal(everything.includes("ABCD1234"), false);
  assert.deepEqual(points[1].blobs.slice(11, 15), ["youtube", "social", "cydi_shorts", "vid123"]);
});

test("every data point fits Analytics Engine's limits, and the index is a random bucket", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const [p] = buildShadowDataPoints("/event", JSON.stringify(envelope("app_open", {})), "US");
    assert.ok(p.blobs.length <= 20 && p.doubles.length <= 20 && p.indexes.length === 1);
    assert.ok(new TextEncoder().encode(p.indexes[0]).length <= 96);
    assert.ok(new TextEncoder().encode(p.blobs.join("")).length <= 16 * 1024);
    assert.match(p.indexes[0], /^b\d{2}$/);
    seen.add(p.indexes[0]);
  }
  assert.ok(seen.size > 1 && seen.size <= AE_INDEX_BUCKETS);
});

// ------------------------------------------------------------ fail-open ----

test("writeAnalyticsShadow never throws: absent or failing binding writes nothing", () => {
  const body = JSON.stringify(envelope("app_open", {}));
  assert.equal(writeAnalyticsShadow(undefined, "/event", body, "US"), 0);
  const throwing = { writeDataPoint() { throw new Error("AE down"); } };
  assert.equal(writeAnalyticsShadow(throwing, "/event", body, "US"), 0);
  const written: unknown[] = [];
  assert.equal(writeAnalyticsShadow({ writeDataPoint: (p) => void written.push(p) }, "/event", body, "US"), 1);
  assert.equal(written.length, 1);
});

// -------------------------------------------------- production path unchanged ----

class FakeKv {
  value: string | null;
  constructor(value: string | null) {
    this.value = value;
  }
  async get(): Promise<string | null> {
    return this.value;
  }
}

class RecordingDo {
  calls: { body: string; keep: string | null }[] = [];
  idFromName(name: string) {
    return { name };
  }
  get() {
    return {
      fetch: async (_url: string, init: RequestInit) => {
        const body = init.body instanceof ReadableStream ? await new Response(init.body).text() : String(init.body ?? "");
        this.calls.push({ body, keep: new Headers(init.headers).get("x-cydi-shed-keep") });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    };
  }
}

// The live production profile: global ELEVATED at 10%, enforced.
const ELEVATED_10 = JSON.stringify({
  disabled: false,
  shed: { monitorOnly: false, globalMode: "ELEVATED", globalKeepPercent: 10, countries: {}, expiresAt: "2099-01-01T00:00:00Z" },
});

async function run(kv: string | null, ae: unknown, body: string, path: "/event" | "/events", random = 0.5) {
  _resetAnalyticsBreakerCacheForTests();
  const analytics = new RecordingDo();
  const env = { CONTENT_KV: new FakeKv(kv), ANALYTICS_DO: analytics, ANALYTICS_AE: ae } as unknown as Parameters<typeof handleAnalyticsEvent>[1];
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };
  const realRandom = Math.random;
  Math.random = () => random;
  try {
    const request = new Request(`https://playcydi.com/api/analytics${path}`, { method: "POST", headers: { "content-type": "application/json" }, body });
    const response = await handleAnalyticsEvent(request, env, path, ctx);
    await Promise.all(pending);
    return { status: response.status, calls: analytics.calls };
  } finally {
    Math.random = realRandom;
  }
}

test("ELEVATED: AE gets the unsampled stream, the DO gets exactly what it got before", async () => {
  const body = JSON.stringify({ events: [envelope("app_open", {}), envelope("game_started", GAME), envelope("shape_completed", { category: "geometric", starRating: 4, passed: true, isNewBest: false })] });
  for (const random of [0.01, 0.99]) {
    const baseline = await run(ELEVATED_10, undefined, body, "/events", random);
    const written: { blobs: string[] }[] = [];
    const withAe = await run(ELEVATED_10, { writeDataPoint: (p: { blobs: string[] }) => void written.push(p) }, body, "/events", random);
    const failing = await run(ELEVATED_10, { writeDataPoint() { throw new Error("AE down"); } }, body, "/events", random);
    assert.deepEqual(withAe, baseline, `DO path identical with AE present (random=${random})`);
    assert.deepEqual(failing, baseline, `DO path identical with AE throwing (random=${random})`);
    assert.equal(written.length, 3, "AE sees all three, before the 10% sample");
  }
});

test("ELEVATED single event dropped by sampling still reaches AE and still answers 204", async () => {
  const body = JSON.stringify(envelope("game_started", GAME));
  const written: unknown[] = [];
  const r = await run(ELEVATED_10, { writeDataPoint: (p: unknown) => void written.push(p) }, body, "/event", 0.99);
  assert.equal(r.status, 204);
  assert.equal(r.calls.length, 0, "the DO is not reached - unchanged behaviour");
  assert.equal(written.length, 1);
});

test("NORMAL: the DO still receives the original stream; the shadow runs via waitUntil", async () => {
  const body = JSON.stringify(envelope("app_open", {}));
  const written: unknown[] = [];
  const r = await run(null, { writeDataPoint: (p: unknown) => void written.push(p) }, body, "/event");
  assert.equal(r.status, 200);
  assert.deepEqual(r.calls, [{ body, keep: "100" }]);
  assert.equal(written.length, 1);
});

test("breaker disabled: nothing reaches the DO or AE", async () => {
  const written: unknown[] = [];
  const r = await run(JSON.stringify({ disabled: true }), { writeDataPoint: (p: unknown) => void written.push(p) }, JSON.stringify(envelope("app_open", {})), "/event");
  assert.equal(r.status, 204);
  assert.equal(r.calls.length, 0);
  assert.equal(written.length, 0);
});

// --- 0.56 ad-readiness diagnostics ride existing slots on ad rows only -----------------------------

test("rewarded + interstitial diagnostics map onto the documented AE slots (no new columns, schema stays 3)", () => {
  const point = (name: string, params: unknown) => buildShadowDataPoints("/event", JSON.stringify(envelope(name, params)), "de", () => 0.5)[0];
  const rw = point("rewarded_ad_unavailable", { placement: PLACEMENT, reason: "no_fill", source: "click", code: 3, stateAtTap: "failed", cause: "failed", latency: "10to20s" });
  assert.equal(rw.doubles[1], 5, "double2 = code + 2");
  assert.equal(rw.doubles[3], 3, "double4 = latency bucket position (10to20s)");
  assert.equal(rw.doubles[6], 2, "double7 = source click");
  assert.equal(rw.doubles[7], 4, "double8 = stateAtTap failed");
  assert.equal(rw.blobs[19], "cause:failed");
  assert.equal(rw.doubles[0], AE_SCHEMA_VERSION);
  assert.equal(AE_SCHEMA_VERSION, 3);
  assert.equal(rw.doubles.length, 20);

  const cp = point("interstitial_checkpoint", { arm: "treatment", outcome: "not_ready", gamesBetweenAds: 7, attempt: 2, code: 0, notReadyCause: "loading" });
  assert.equal(cp.doubles[2], 2, "double3 = attempt");
  assert.equal(cp.doubles[1], 2, "code 0 is distinguishable from no code");
  assert.equal(cp.doubles[8], 7);
  assert.equal(cp.blobs[19], "notReadyCause:loading");

  // An older client's row (no diagnostics) maps exactly as before: all those slots are 0.
  const old = point("rewarded_ad_unavailable", { placement: PLACEMENT, reason: "no_fill" });
  assert.deepEqual([old.doubles[1], old.doubles[2], old.doubles[3], old.doubles[6], old.doubles[7], old.blobs[19]], [0, 0, 0, 0, 0, ""]);
  // Non-ad rows are untouched by the reuse.
  const game = point("game_started", GAME);
  assert.equal(game.doubles[1], 0);
});

// --- 0.57 mpDailyOrdinal rides double9 on mp_game_started rows only --------------------------------

test("mp_game_started mpDailyOrdinal lands in double9; the base form and old rows keep 0", () => {
  const point = (name: string, params: unknown) => buildShadowDataPoints("/event", JSON.stringify(envelope(name, params)), "de", () => 0.5)[0];
  const base = { playerCount: 4, roundCount: 5, difficulty: "hard" };
  const withOrdinal = point("mp_game_started", { ...base, mpDailyOrdinal: 3 });
  assert.equal(withOrdinal.doubles[8], 3, "double9 = mpDailyOrdinal");
  assert.equal(withOrdinal.doubles[4], 5, "roundCount stays in double5");
  assert.equal(withOrdinal.doubles[6], 4, "playerCount stays in double7");
  assert.equal(withOrdinal.doubles.length, 20);
  assert.equal(withOrdinal.doubles[0], AE_SCHEMA_VERSION);
  assert.equal(point("mp_game_started", { ...base, mpDailyOrdinal: 7 }).doubles[8], 7);
  // Older client / repeat of a counted game: the field is absent, so the slot is 0 as before.
  assert.equal(point("mp_game_started", base).doubles[8], 0);
  // The slot's other meaning is untouched.
  assert.equal(point("interstitial_checkpoint", { arm: "treatment", outcome: "not_ready", gamesBetweenAds: 7, attempt: 1, code: 0, notReadyCause: "loading" }).doubles[8], 7);
  // Out-of-range or extra keys never reach AE.
  assert.deepEqual(buildShadowDataPoints("/event", JSON.stringify(envelope("mp_game_started", { ...base, mpDailyOrdinal: 8 })), "US"), []);
  assert.deepEqual(buildShadowDataPoints("/event", JSON.stringify(envelope("mp_game_started", { ...base, mpDailyOrdinal: 1, roomCode: "ABCDEF" })), "US"), []);
});
