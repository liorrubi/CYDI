/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Client-side analytics batching (A4).
//
// Every event used to be its own HTTP request, which meant its own Worker
// invocation and its own Durable Object request. On 23 Sep 2026 that was ~50,000
// DO requests in a day, roughly half of the account-wide Free-plan allowance, spent
// by telemetry. Batching does not change what is counted or how - the same envelope
// is built by analytics.ts and counted by the same incrementEvent on the server -
// it only stops paying a round trip per increment.
//
// Deliberately NOT retried. The ingest endpoint has no idempotency key, so a batch
// that was actually applied but whose response was lost would be counted twice if we
// sent it again - and a silently doubled counter is worse than a missing one, because
// nothing downstream can detect it. A failed batch is therefore dropped, exactly as a
// failed single event already was. That also removes any possibility of a retry storm.
//
// Never throws into a caller and never awaits anything on the gameplay path.

import { apiFetch } from "./nativeApi";

/** Flush at ten events, matching the server's own budget granularity. */
export const MAX_BATCH_EVENTS = 10;
/** ...or after this long, so a slow trickle still reports within a sensible window. */
export const FLUSH_INTERVAL_MS = 15_000;
/**
 * The queue is bounded at MAX_BATCH_EVENTS by construction, with no separate cap.
 *
 * flushAnalyticsQueue() empties the array synchronously before the request leaves,
 * so depth can never exceed the flush threshold no matter how long a send takes or
 * how badly the network is failing. An explicit ceiling on top of that would be
 * unreachable code, and the accompanying test would be asserting nothing.
 */

type Envelope = Record<string, unknown>;
type Sender = (events: Envelope[]) => Promise<void>;

let queue: Envelope[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/** POSTs one batch. Separate so tests can drive the queue without a network. */
async function postBatch(events: Envelope[]): Promise<void> {
  await apiFetch("/api/analytics/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events }),
    // Lets the batch survive the page/app going away mid-flight, which is exactly
    // when the lifecycle flush below fires.
    keepalive: true,
  });
}

let sender: Sender = postBatch;

function clearTimer(): void {
  if (timer === null) return;
  clearTimeout(timer);
  timer = null;
}

/**
 * Send everything queued right now.
 *
 * The queue is emptied BEFORE the request goes out, so events arriving during the
 * flight join the next batch instead of riding on one that was already serialized -
 * the same reasoning as the server-side buffer. A failure loses that batch; see the
 * no-retry note at the top.
 */
export function flushAnalyticsQueue(): void {
  clearTimer();
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  try {
    void sender(batch).catch(() => {});
  } catch {
    // Sender threw synchronously (no fetch, no bridge) - drop, never propagate.
  }
}

/** Queue one envelope, flushing when a budget is reached. Never throws. */
export function enqueueAnalyticsEvent(envelope: Envelope): void {
  try {
    queue.push(envelope);
    if (queue.length >= MAX_BATCH_EVENTS) {
      flushAnalyticsQueue();
      return;
    }
    if (timer === null) timer = setTimeout(flushAnalyticsQueue, FLUSH_INTERVAL_MS);
  } catch {
    // Nothing here may reach the caller - analytics must never break gameplay.
  }
}

/**
 * Flush when the app is about to stop running.
 *
 * `visibilitychange` is what fires in the Android WebView when the activity is
 * paused (backgrounded, a full-screen ad opening over it, the screen locking), and
 * `pagehide` covers the web tab being closed. Both use keepalive so the request
 * outlives the page. What this cannot cover is a process kill with no lifecycle
 * event at all - those queued events are lost, which is the accepted cost of
 * batching and is bounded by MAX_BATCH_EVENTS and FLUSH_INTERVAL_MS.
 */
function installLifecycleFlush(): void {
  const onHide = () => {
    if (document.visibilityState === "hidden") flushAnalyticsQueue();
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", () => flushAnalyticsQueue());
}

try {
  if (typeof document !== "undefined" && typeof window !== "undefined") installLifecycleFlush();
} catch {
  // No DOM (unit tests, Worker) - the exported functions still work on their own.
}

// --- test hooks ---------------------------------------------------------------

/** Test-only: replace the network sender. */
export function _setAnalyticsSenderForTests(next: Sender = postBatch): void {
  sender = next;
}

/** Test-only: current queue depth and whether the flush timer is armed. */
export function _analyticsQueueStateForTests(): { queued: number; timerArmed: boolean } {
  return { queued: queue.length, timerArmed: timer !== null };
}

/** Test-only: reset module state between cases. */
export function _resetAnalyticsQueueForTests(): void {
  clearTimer();
  queue = [];
  sender = postBatch;
}
