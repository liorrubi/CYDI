/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Client-side analytics batching (A4).
//
// The properties that matter are all about what happens when things go wrong:
// a failed batch must not retry (there is no idempotency key server-side, so a
// retry would double-count), the queue must not grow without bound, and nothing
// in here may ever throw into the gameplay call that produced the event.
import test from "node:test";
import assert from "node:assert/strict";

const {
  enqueueAnalyticsEvent,
  flushAnalyticsQueue,
  MAX_BATCH_EVENTS,
  _setAnalyticsSenderForTests,
  _analyticsQueueStateForTests,
  _resetAnalyticsQueueForTests,
} = await import("./analyticsQueue.ts");

type Batch = Record<string, unknown>[];

/** Captures every batch the queue tries to send, without a network. */
function capture(behaviour: "ok" | "reject" | "throw" = "ok") {
  const batches: Batch[] = [];
  _setAnalyticsSenderForTests(async (events) => {
    batches.push(events);
    if (behaviour === "reject") throw new Error("network down");
    if (behaviour === "throw") throw new Error("boom");
  });
  return batches;
}

const event = (n: number) => ({ eventName: "app_open", params: {}, seq: n });

test.beforeEach(() => {
  _resetAnalyticsQueueForTests();
});
test.after(() => {
  _resetAnalyticsQueueForTests();
});

test("one event is queued, not sent", () => {
  const batches = capture();
  enqueueAnalyticsEvent(event(1));
  assert.equal(batches.length, 0, "a single event must not cost a request - that is the whole point");
  assert.equal(_analyticsQueueStateForTests().queued, 1);
  assert.equal(_analyticsQueueStateForTests().timerArmed, true, "and the timer guarantees it still goes out");
});

test("a partial batch stays queued", () => {
  const batches = capture();
  for (let i = 0; i < MAX_BATCH_EVENTS - 1; i++) enqueueAnalyticsEvent(event(i));
  assert.equal(batches.length, 0);
  assert.equal(_analyticsQueueStateForTests().queued, MAX_BATCH_EVENTS - 1);
});

test("a full batch flushes immediately, in order, exactly once", () => {
  const batches = capture();
  for (let i = 0; i < MAX_BATCH_EVENTS; i++) enqueueAnalyticsEvent(event(i));
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, MAX_BATCH_EVENTS);
  assert.deepEqual(batches[0].map((e) => e.seq), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(_analyticsQueueStateForTests().queued, 0);
  assert.equal(_analyticsQueueStateForTests().timerArmed, false, "the timer is cancelled by the flush");
});

test("twenty events become two batches, never twenty requests", () => {
  const batches = capture();
  for (let i = 0; i < 20; i++) enqueueAnalyticsEvent(event(i));
  assert.equal(batches.length, 2);
  assert.deepEqual(batches.map((b) => b.length), [10, 10]);
});

test("the timer flushes a partial batch", async () => {
  const batches = capture();
  enqueueAnalyticsEvent(event(1));
  enqueueAnalyticsEvent(event(2));
  assert.equal(batches.length, 0);
  // The queue arms a real timer; drive it directly rather than waiting 15s.
  flushAnalyticsQueue();
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 2);
});

test("an explicit flush with an empty queue sends nothing", () => {
  const batches = capture();
  flushAnalyticsQueue();
  assert.equal(batches.length, 0);
});

test("a lifecycle flush drains whatever is queued", () => {
  const batches = capture();
  enqueueAnalyticsEvent(event(1));
  // What the visibilitychange / pagehide listeners call.
  flushAnalyticsQueue();
  assert.equal(batches.length, 1);
  assert.equal(_analyticsQueueStateForTests().queued, 0);
});

test("the queue stays bounded even when every send hangs forever", () => {
  // A sender that never settles is the worst case for memory. The queue is emptied
  // synchronously at flush, before the request leaves, so depth is capped by the
  // flush threshold itself rather than by a separate ceiling.
  _setAnalyticsSenderForTests(async () => {
    await new Promise(() => {});
  });
  for (let i = 0; i < 5_000; i++) enqueueAnalyticsEvent(event(i));
  const state = _analyticsQueueStateForTests();
  assert.ok(state.queued < MAX_BATCH_EVENTS, `queue must stay bounded (got ${state.queued} after 5,000 events)`);
});

test("a failed batch is dropped, never retried", async () => {
  const batches = capture("reject");
  for (let i = 0; i < MAX_BATCH_EVENTS; i++) enqueueAnalyticsEvent(event(i));
  assert.equal(batches.length, 1);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(batches.length, 1, "a retry could double-count: the server has no idempotency key");
  assert.equal(_analyticsQueueStateForTests().queued, 0, "and the failed events are not re-queued");
});

test("a sender that rejects never surfaces an unhandled rejection", async () => {
  capture("reject");
  for (let i = 0; i < MAX_BATCH_EVENTS; i++) enqueueAnalyticsEvent(event(i));
  await new Promise((r) => setTimeout(r, 20));
  // Reaching here without the runner reporting an unhandled rejection is the assertion.
  assert.ok(true);
});

test("a sender that throws synchronously never reaches the caller", () => {
  _setAnalyticsSenderForTests(() => {
    throw new Error("synchronous boom");
  });
  assert.doesNotThrow(() => {
    for (let i = 0; i < MAX_BATCH_EVENTS; i++) enqueueAnalyticsEvent(event(i));
  }, "analytics must never break gameplay");
});

test("events queued during a flush join the next batch, not the one in flight", () => {
  const batches: Batch[] = [];
  _setAnalyticsSenderForTests(async (events) => {
    batches.push(events);
  });
  for (let i = 0; i < MAX_BATCH_EVENTS; i++) enqueueAnalyticsEvent(event(i));
  enqueueAnalyticsEvent(event(99));
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, MAX_BATCH_EVENTS);
  assert.equal(_analyticsQueueStateForTests().queued, 1);
  flushAnalyticsQueue();
  assert.deepEqual(batches[1].map((e) => e.seq), [99]);
});

test("the envelope is forwarded untouched", () => {
  const batches = capture();
  const envelope = {
    eventName: "first_open",
    params: { installAge: "h0_24" },
    platform: "android",
    appVersion: "0.51.0",
    appBuild: "abc1234",
    installationId: "aaaaaaaaaaaa",
    sessionId: "bbbbbbbbbbbb",
    isInternal: false,
    attribution: { source: "google-play", medium: "organic", campaign: "unknown", content: "unknown", term: "unknown" },
  };
  enqueueAnalyticsEvent(envelope);
  flushAnalyticsQueue();
  assert.deepEqual(batches[0][0], envelope, "batching must not reshape or drop a single field");
});
