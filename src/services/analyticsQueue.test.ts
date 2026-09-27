/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Client analytics batching (Phase 3).
//
// What must hold: far fewer, fuller requests (never above the Worker's 50-event / body
// limits); telemetry is never retried (no retry storms); exact events survive an app kill
// without ever being duplicated by default; lifecycle flushes send everything at once;
// nothing here ever throws into gameplay.
import test from "node:test";
import assert from "node:assert/strict";

// In-memory localStorage so the outbox can be exercised under node.
class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();

const {
  enqueueAnalyticsEvent,
  flushAnalyticsQueue,
  WORKER_MAX_BATCH_EVENTS,
  _setAnalyticsSenderForTests,
  _analyticsQueueStateForTests,
  _analyticsOutboxForTests,
  _resetAnalyticsQueueForTests,
  OUTBOX_MAX_AGE_MS,
} = await import("./analyticsQueue.ts");
const { applyConfigHeader, getClientConfig, SAFE_DEFAULTS, _resetClientConfigForTests, CONFIG_HEADER } = await import("./analyticsClientConfig.ts");

type Env = Record<string, unknown>;
type Sent = { events: Env[]; keepalive: boolean };

function capture(behaviour: "ok" | "reject" | "throw" = "ok", header: string | null = null) {
  const sent: Sent[] = [];
  _setAnalyticsSenderForTests(async (events, opts) => {
    sent.push({ events, keepalive: opts.keepalive });
    if (behaviour === "reject") throw new Error("network down");
    if (behaviour === "throw") throw new Error("boom");
    return { status: 204, header: (n) => (n === CONFIG_HEADER ? header : null) };
  });
  return sent;
}
const settle = () => new Promise((r) => setTimeout(r, 5));
const tel = (n: number) => ({ eventName: "game_started", params: { gameType: "shapeChallenge", category: "geometric", contentKey: "circle" }, seq: n });
const exact = (n: number) => ({ eventName: "app_open", params: {}, seq: n });

test.beforeEach(() => {
  _resetAnalyticsQueueForTests();
  _resetClientConfigForTests();
});
test.after(() => {
  _resetAnalyticsQueueForTests();
  _resetClientConfigForTests();
});

// ---------------------------------------------------------------- batching ----

test("defaults: 50-event batches, 2-minute telemetry window, never above the Worker limit", () => {
  assert.equal(SAFE_DEFAULTS.maxBatchEvents, 50);
  assert.equal(WORKER_MAX_BATCH_EVENTS, 50);
  assert.equal(SAFE_DEFAULTS.flushIntervalMs, 120_000);
  const sent = capture();
  for (let i = 0; i < 49; i++) enqueueAnalyticsEvent(tel(i));
  assert.equal(sent.length, 0, "49 telemetry events stay queued");
  enqueueAnalyticsEvent(tel(49));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].events.length, 50);
  assert.deepEqual(sent[0].events.map((e) => e.seq), Array.from({ length: 50 }, (_, i) => i), "in order, exactly once");
});

test("120 telemetry events become 3 requests (50, 50, then the 20 left on flush), never 12", () => {
  const sent = capture();
  for (let i = 0; i < 120; i++) enqueueAnalyticsEvent(tel(i));
  flushAnalyticsQueue();
  assert.deepEqual(sent.map((s) => s.events.length), [50, 50, 20]);
});

test("a remote maxBatchEvents above 50 is clamped to the Worker limit; a byte cap splits big batches", () => {
  applyConfigHeader(JSON.stringify({ v: 1, maxBatchEvents: 500, maxBatchBytes: 4000 }));
  assert.equal(getClientConfig().maxBatchEvents, 50);
  const sent = capture();
  const fat = (n: number) => ({ ...tel(n), pad: "x".repeat(900) });
  for (let i = 0; i < 12; i++) enqueueAnalyticsEvent(fat(i));
  flushAnalyticsQueue();
  for (const s of sent) assert.ok(JSON.stringify(s.events).length <= 4000 + 2, "each request body stays within maxBatchBytes");
  assert.equal(sent.reduce((t, s) => t + s.events.length, 0), 12, "nothing lost when splitting");
});

test("telemetry alone waits for the 2-minute window; an exact event pulls the send forward to 20 s", () => {
  capture();
  const t0 = Date.now();
  enqueueAnalyticsEvent(tel(1));
  const telDeadline = _analyticsQueueStateForTests().deadline;
  assert.ok(telDeadline - t0 >= 119_000 && telDeadline - t0 <= 121_000);
  enqueueAnalyticsEvent(exact(2));
  const exDeadline = _analyticsQueueStateForTests().deadline;
  assert.ok(exDeadline - t0 >= 19_000 && exDeadline - t0 <= 21_000, "exact deadline replaces the later one");
  assert.equal(_analyticsQueueStateForTests().queued, 2, "both ride in the same request");
});

test("mixed exact + telemetry share one request; the exact envelope gains only an eventId", () => {
  const sent = capture();
  const t = tel(1), e = exact(2);
  enqueueAnalyticsEvent(t);
  enqueueAnalyticsEvent(e);
  flushAnalyticsQueue();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].events[0], tel(1), "telemetry envelope untouched");
  const { eventId, ...rest } = sent[0].events[1];
  assert.deepEqual(rest, exact(2), "exact envelope untouched apart from eventId");
  assert.match(String(eventId), /^[0-9a-f]{24}$/);
});

// ---------------------------------------------------------------- lifecycle ----

test("a lifecycle flush sends everything at once with keepalive and forgets exact events first (at-most-once)", () => {
  const sent = capture();
  enqueueAnalyticsEvent(tel(1));
  enqueueAnalyticsEvent(exact(2));
  assert.equal(_analyticsQueueStateForTests().outbox, 1, "exact event persisted while queued");
  flushAnalyticsQueue("lifecycle");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].keepalive, true);
  assert.equal(_analyticsQueueStateForTests().outbox, 0, "removed before the possibly-dying request");
  assert.equal(_analyticsQueueStateForTests().timerArmed, false);
});

// ---------------------------------------------------------------- reliability ----

test("an exact event queued when the app is killed goes out on the next launch - once", async () => {
  capture();
  enqueueAnalyticsEvent(exact(1)); // queued, never sent...
  _resetAnalyticsQueueForTests({ keepStorage: true }); // ...app killed (memory gone, storage kept)
  const sent = capture();
  enqueueAnalyticsEvent(tel(2)); // next launch: first event restores the outbox
  flushAnalyticsQueue();
  await settle();
  const all = sent.flatMap((s) => s.events);
  assert.equal(all.filter((e) => e.eventName === "app_open").length, 1, "the lost exact event is delivered exactly once");
  assert.equal(_analyticsQueueStateForTests().outbox, 0, "and cleared after the server answered");
});

test("an exact event whose request was in flight when the app died is NOT resent (no duplicates by default)", async () => {
  _setAnalyticsSenderForTests(() => new Promise(() => {})); // request never answers
  enqueueAnalyticsEvent(exact(1));
  flushAnalyticsQueue("timer");
  assert.equal(_analyticsOutboxForTests()[0].inFlight, true);
  _resetAnalyticsQueueForTests({ keepStorage: true });
  const sent = capture();
  enqueueAnalyticsEvent(tel(2));
  flushAnalyticsQueue();
  await settle();
  assert.equal(sent.flatMap((s) => s.events).filter((e) => e.eventName === "app_open").length, 0);
});

test("network failure: telemetry is dropped, never retried; exact is dropped too by default", async () => {
  const sent = capture("reject");
  for (let i = 0; i < 50; i++) enqueueAnalyticsEvent(tel(i));
  enqueueAnalyticsEvent(exact(99));
  flushAnalyticsQueue();
  await settle();
  const before = sent.length;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(sent.length, before, "no retry storm");
  assert.equal(_analyticsQueueStateForTests().outbox, 0);
  assert.equal(_analyticsQueueStateForTests().timerArmed, false);
});

test("with exactRetryOnNetworkError on, exact events back off exponentially and give up after 5 attempts", async () => {
  applyConfigHeader(JSON.stringify({ v: 1, exactRetryOnNetworkError: true }));
  capture("reject");
  enqueueAnalyticsEvent(exact(1));
  flushAnalyticsQueue();
  await settle();
  const e1 = _analyticsOutboxForTests()[0];
  assert.equal(e1.attempts, 1);
  assert.ok(e1.nextAttemptAt - Date.now() >= 55_000, "first retry no sooner than ~60 s");
  assert.equal(_analyticsQueueStateForTests().queued, 0, "not re-queued immediately");
  // Simulate the remaining attempts elapsing.
  for (let i = 0; i < 6; i++) {
    const cur = _analyticsOutboxForTests();
    if (!cur.length) break;
    // make it due, then trigger a send via the next enqueue path
    (globalThis.localStorage as MemoryStorage).setItem("cydi.analyticsOutbox.v1", JSON.stringify(cur.map((e) => ({ ...e, nextAttemptAt: 0 }))));
    _resetAnalyticsQueueForTests({ keepStorage: true });
    capture("reject");
    enqueueAnalyticsEvent(tel(i));
    flushAnalyticsQueue();
    await settle();
  }
  assert.equal(_analyticsQueueStateForTests().outbox, 0, "gives up - bounded, never a loop");
});

test("recovery cutoff: an outbox entry older than 5 days is dropped, never resent; a younger one is resent once", async () => {
  assert.equal(OUTBOX_MAX_AGE_MS, 5 * 24 * 60 * 60_000, "inside the server's 7-day eventId dedup window");
  const now = Date.now();
  const entry = (id: string, createdAt: unknown) => ({ envelope: { eventName: "app_open", params: {}, eventId: id }, attempts: 0, nextAttemptAt: 0, inFlight: false, createdAt });
  (globalThis.localStorage as MemoryStorage).setItem(
    "cydi.analyticsOutbox.v1",
    JSON.stringify([
      entry("a".repeat(24), now - OUTBOX_MAX_AGE_MS + 60_000), // 5 days minus a minute: resent
      entry("b".repeat(24), now - OUTBOX_MAX_AGE_MS - 60_000), // just over 5 days: dropped
      entry("c".repeat(24), undefined), // no timestamp (0.53.99 test build): unknown age, dropped
      entry("d".repeat(24), now + 2 * 24 * 60 * 60_000), // clock moved back 2 days: dropped
    ]),
  );
  _resetAnalyticsQueueForTests({ keepStorage: true });
  const sent = capture();
  enqueueAnalyticsEvent(tel(1));
  flushAnalyticsQueue();
  await settle();
  const ids = sent.flatMap((s) => s.events).map((e) => e.eventId).filter(Boolean);
  assert.deepEqual(ids, ["a".repeat(24)]);
  assert.equal(_analyticsQueueStateForTests().outbox, 0, "nothing expired lingers in storage");
});

test("new exact events are stamped with createdAt so their age can be checked on a later launch", () => {
  capture();
  const t0 = Date.now();
  enqueueAnalyticsEvent(exact(1));
  const [e] = _analyticsOutboxForTests();
  assert.ok(e.createdAt >= t0 && e.createdAt <= Date.now());
});

test("the queue stays bounded even when every send hangs forever", () => {
  _setAnalyticsSenderForTests(() => new Promise(() => {}));
  for (let i = 0; i < 5_000; i++) enqueueAnalyticsEvent(tel(i));
  assert.ok(_analyticsQueueStateForTests().queued < 50);
});

test("a rejecting or throwing sender never reaches gameplay", async () => {
  capture("reject");
  for (let i = 0; i < 60; i++) enqueueAnalyticsEvent(tel(i));
  await settle();
  _setAnalyticsSenderForTests(() => {
    throw new Error("synchronous boom");
  });
  assert.doesNotThrow(() => {
    for (let i = 0; i < 60; i++) enqueueAnalyticsEvent(tel(i));
    enqueueAnalyticsEvent(exact(1));
    flushAnalyticsQueue();
  });
});

// ---------------------------------------------------------------- remote config ----

test("a valid config header on a response is applied and cached; garbage is ignored; defaults otherwise", async () => {
  capture("ok", JSON.stringify({ v: 1, flushIntervalMs: 60_000, telemetryKeepPercent: 25 }));
  enqueueAnalyticsEvent(tel(1));
  flushAnalyticsQueue();
  await settle();
  assert.equal(getClientConfig().flushIntervalMs, 60_000);
  assert.equal(getClientConfig().telemetryKeepPercent, 25);
  assert.equal(applyConfigHeader("<html>not json</html>"), false);
  assert.equal(applyConfigHeader(JSON.stringify({ v: 2 })), false, "unknown version ignored");
  assert.equal(getClientConfig().flushIntervalMs, 60_000, "a bad header never replaces a good config");
  _resetClientConfigForTests();
  assert.deepEqual(getClientConfig(), { ...SAFE_DEFAULTS }, "no remote config -> safe defaults");
});
