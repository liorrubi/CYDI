// The analytics ingest circuit breaker (P0.2).
//
// The property under test is asymmetric and easy to get backwards: this switch is
// FAIL-OPEN. Only an explicit, well-formed { disabled: true } may stop collection.
// Every other outcome - missing key, malformed JSON, wrong shape, KV outage - has
// to keep ingest running, because losing telemetry to a failed lookup is a worse
// failure than the one the switch exists to prevent.
import test from "node:test";
import assert from "node:assert/strict";

const { parseAnalyticsBreaker, isAnalyticsIngestDisabled, isValidAnalyticsBreakerConfig, _resetAnalyticsBreakerCacheForTests } =
  await import("./analyticsBreaker.ts");
const { handleAnalyticsEvent } = await import("./index.ts");

// ------------------------------------------------------------------ doubles ----

class FakeKv {
  reads = 0;
  value: string | null;
  throws: boolean;
  constructor(value: string | null, throws = false) {
    this.value = value;
    this.throws = throws;
  }
  async get(_key: string, _options?: { cacheTtl?: number }): Promise<string | null> {
    this.reads++;
    if (this.throws) throw new Error("kv unavailable");
    return this.value;
  }
}

/** Counts every time the Durable Object is actually reached - the number the breaker exists to drive to zero. */
class FakeAnalyticsNamespace {
  fetches = 0;
  idFromName(_name: string) {
    return { name: _name };
  }
  get(_id: unknown) {
    return {
      fetch: async (): Promise<Response> => {
        this.fetches++;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    };
  }
}

function eventRequest(): Request {
  return new Request("https://playcydi.com/api/analytics/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eventName: "app_open", params: {} }),
  });
}

async function ingest(kvValue: string | null, opts: { throws?: boolean } = {}) {
  _resetAnalyticsBreakerCacheForTests();
  const kv = new FakeKv(kvValue, opts.throws ?? false);
  const analytics = new FakeAnalyticsNamespace();
  const env = { CONTENT_KV: kv, ANALYTICS_DO: analytics } as unknown as Parameters<typeof handleAnalyticsEvent>[1];
  const response = await handleAnalyticsEvent(eventRequest(), env);
  return { response, analytics, kv };
}

// ------------------------------------------------------------------- parsing ----

test("only an exact { disabled: boolean } is a valid instruction", () => {
  assert.equal(isValidAnalyticsBreakerConfig({ disabled: true }), true);
  assert.equal(isValidAnalyticsBreakerConfig({ disabled: false }), true);
  assert.equal(isValidAnalyticsBreakerConfig({ disabled: "true" }), false);
  assert.equal(isValidAnalyticsBreakerConfig({ disabled: true, extra: 1 }), false);
  assert.equal(isValidAnalyticsBreakerConfig({}), false);
  assert.equal(isValidAnalyticsBreakerConfig([{ disabled: true }]), false);
  assert.equal(isValidAnalyticsBreakerConfig(null), false);
});

test("anything unparseable reads as 'keep collecting', never as 'stop'", () => {
  assert.equal(parseAnalyticsBreaker('{"disabled":true}'), true);
  assert.equal(parseAnalyticsBreaker('{"disabled":false}'), false);
  assert.equal(parseAnalyticsBreaker(null), false);
  assert.equal(parseAnalyticsBreaker("not json at all"), false);
  assert.equal(parseAnalyticsBreaker('{"disabled":"yes"}'), false);
  assert.equal(parseAnalyticsBreaker('{"enabled":true}'), false);
  assert.equal(parseAnalyticsBreaker("true"), false);
  assert.equal(parseAnalyticsBreaker(""), false);
});

// ------------------------------------------------------------------- ingest ----

test("breaker ON returns 204 and never reaches the Durable Object", async () => {
  const { response, analytics } = await ingest('{"disabled":true}');
  assert.equal(response.status, 204);
  assert.equal(analytics.fetches, 0, "a shed event must not cost a DO request - that is the whole point");
});

test("breaker OFF ingests normally", async () => {
  const { response, analytics } = await ingest('{"disabled":false}');
  assert.equal(response.status, 200);
  assert.equal(analytics.fetches, 1);
});

test("a missing flag ingests normally", async () => {
  const { response, analytics } = await ingest(null);
  assert.equal(response.status, 200);
  assert.equal(analytics.fetches, 1);
});

test("a malformed flag ingests normally", async () => {
  for (const malformed of ["{", '{"disabled":"true"}', '{"disabled":true,"extra":1}', "[]"]) {
    const { response, analytics } = await ingest(malformed);
    assert.equal(response.status, 200, `malformed value ${malformed} must not stop ingest`);
    assert.equal(analytics.fetches, 1);
  }
});

test("a KV read failure ingests normally and is not cached as a decision", async () => {
  _resetAnalyticsBreakerCacheForTests();
  const kv = new FakeKv(null, true);
  const analytics = new FakeAnalyticsNamespace();
  const env = { CONTENT_KV: kv, ANALYTICS_DO: analytics } as unknown as Parameters<typeof handleAnalyticsEvent>[1];

  assert.equal((await handleAnalyticsEvent(eventRequest(), env)).status, 200);
  assert.equal((await handleAnalyticsEvent(eventRequest(), env)).status, 200);
  assert.equal(analytics.fetches, 2);
  // Both attempts hit KV: a thrown read must not be remembered, or one outage
  // would pin the answer for the whole cache window.
  assert.equal(kv.reads, 2);
});

test("a missing CONTENT_KV binding ingests normally", async () => {
  _resetAnalyticsBreakerCacheForTests();
  const analytics = new FakeAnalyticsNamespace();
  const env = { ANALYTICS_DO: analytics } as unknown as Parameters<typeof handleAnalyticsEvent>[1];
  const response = await handleAnalyticsEvent(eventRequest(), env);
  assert.equal(response.status, 200);
  assert.equal(analytics.fetches, 1);
});

// -------------------------------------------------------------------- cache ----

test("the flag is read once per window, not once per event", async () => {
  _resetAnalyticsBreakerCacheForTests();
  const kv = new FakeKv('{"disabled":true}');
  for (let i = 0; i < 50; i++) await isAnalyticsIngestDisabled(kv, 1_000_000);
  assert.equal(kv.reads, 1, "50 events must not cost 50 KV reads - that would trade one exhausted quota for another");
});

test("the cached answer expires so a flip is picked up without a deploy", async () => {
  _resetAnalyticsBreakerCacheForTests();
  const kv = new FakeKv('{"disabled":false}');
  assert.equal(await isAnalyticsIngestDisabled(kv, 1_000_000), false);
  assert.equal(await isAnalyticsIngestDisabled(kv, 1_020_000), false);
  assert.equal(kv.reads, 1);
  // Past the 30s window the next event re-reads.
  assert.equal(await isAnalyticsIngestDisabled(kv, 1_031_000), false);
  assert.equal(kv.reads, 2);
});

// ------------------------------------------------ batch ingest (A4) ----------

function batchRequest(): Request {
  return new Request("https://playcydi.com/api/analytics/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events: [{ eventName: "app_open", params: {} }] }),
  });
}

async function ingestBatch(kvValue: string | null) {
  _resetAnalyticsBreakerCacheForTests();
  const kv = new FakeKv(kvValue);
  const analytics = new FakeAnalyticsNamespace();
  const env = { CONTENT_KV: kv, ANALYTICS_DO: analytics } as unknown as Parameters<typeof handleAnalyticsEvent>[1];
  const response = await handleAnalyticsEvent(batchRequest(), env, "/events");
  return { response, analytics };
}

test("breaker ON sheds the BATCH endpoint too, with zero DO access", async () => {
  const { response, analytics } = await ingestBatch('{"disabled":true}');
  assert.equal(response.status, 204);
  assert.equal(analytics.fetches, 0, "a batch is 10 events' worth of DO work - it must be shed as well");
});

test("breaker OFF lets a batch through", async () => {
  const { response, analytics } = await ingestBatch('{"disabled":false}');
  assert.equal(response.status, 200);
  assert.equal(analytics.fetches, 1);
});

test("a missing flag lets a batch through", async () => {
  const { response, analytics } = await ingestBatch(null);
  assert.equal(response.status, 200);
  assert.equal(analytics.fetches, 1);
});

test("one breaker read covers both endpoints", async () => {
  _resetAnalyticsBreakerCacheForTests();
  const kv = new FakeKv('{"disabled":true}');
  const analytics = new FakeAnalyticsNamespace();
  const env = { CONTENT_KV: kv, ANALYTICS_DO: analytics } as unknown as Parameters<typeof handleAnalyticsEvent>[1];
  assert.equal((await handleAnalyticsEvent(eventRequest(), env, "/event")).status, 204);
  assert.equal((await handleAnalyticsEvent(batchRequest(), env, "/events")).status, 204);
  assert.equal(kv.reads, 1, "the cached decision is shared, not read per endpoint");
  assert.equal(analytics.fetches, 0);
});
