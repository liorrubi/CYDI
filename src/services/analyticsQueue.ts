/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Client analytics batching (Phase 3) - every event goes out through /api/analytics/events.
//
// WHY. Each POST is one Worker request against the Free plan's account-wide daily cap.
// Measured 27 Sep 2026: current Android clients sent ~4 events per request (~14 requests per
// session) because the old queue flushed at 10 events or every 30 s. This queue sends far
// fewer, fuller requests:
//  - up to maxBatchEvents (50 = the Worker's validated maximum) and maxBatchBytes per request;
//  - telemetry waits up to flushIntervalMs (120 s default);
//  - an EXACT event pulls the next send forward to exactFlushDelayMs (20 s default), so a
//    business fact is not held for the whole interval, and nearby events share its request;
//  - the app going to the background (visibilitychange hidden, pagehide, native pause) flushes
//    everything at once.
//
// RELIABILITY FOR EXACT EVENTS. Exact events are written to a small persisted outbox when
// queued. If the app is killed before they were ever sent, they go out on the next launch -
// zero duplicate risk, because they never reached the network. Once a request carrying them
// gets ANY HTTP response, they are removed (the server has seen them). A network error drops
// them, as before - unless the remote switch exactRetryOnNetworkError is on, in which case they
// retry with capped exponential backoff (max 5 attempts). That switch stays off until the
// server de-duplicates by eventId, because a request can reach the server and still fail on
// the way back. Lifecycle sends remove exact events from the outbox BEFORE sending (the page or
// app may die mid-request, and at-most-once beats a possible duplicate).
//
// TELEMETRY IS NEVER RETRIED. A failed telemetry batch is dropped - no retry storms, ever.
//
// FAIL-SILENT. Nothing here may ever throw into gameplay code.

import { apiFetch } from "./nativeApi";
import { classifyEvent } from "./analyticsEventClasses";
import { applyConfigHeader, CONFIG_HEADER, getClientConfig } from "./analyticsClientConfig";

type Envelope = Record<string, unknown>;
export type SendResult = { status: number; header?: (name: string) => string | null } | void;
type Sender = (events: Envelope[], opts: { keepalive: boolean }) => Promise<SendResult>;
type FlushReason = "size" | "timer" | "exact" | "lifecycle" | "manual";

/** Worker hard limit (worker/analyticsDO.ts MAX_BATCH_EVENTS). The client never exceeds it, whatever config says. */
export const WORKER_MAX_BATCH_EVENTS = 50;
const OUTBOX_KEY = "cydi.analyticsOutbox.v1";
const OUTBOX_MAX = 200;
const MAX_EXACT_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 30 * 60_000;
/**
 * Outbox entries older than this are dropped, never resent. The server de-duplicates exact events
 * by eventId for 7 Israel days (today included, so at least 6 full days - worker/analyticsEventDedup.ts);
 * 5 days keeps every resend safely inside that window. An entry dated in the future beyond
 * MAX_CLOCK_SKEW_MS (device clock moved back) is treated as unknown age and dropped too.
 */
export const OUTBOX_MAX_AGE_MS = 5 * 24 * 60 * 60_000;
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60_000;

type OutboxEntry = { envelope: Envelope; attempts: number; nextAttemptAt: number; inFlight: boolean; createdAt: number };

/** Inside the server's dedup window? Entries without a timestamp (pre-cutoff builds) are of unknown age: no. */
function withinRecoveryWindow(e: OutboxEntry, now: number): boolean {
  if (typeof e.createdAt !== "number" || !Number.isFinite(e.createdAt)) return false;
  const age = now - e.createdAt;
  return age <= OUTBOX_MAX_AGE_MS && age >= -MAX_CLOCK_SKEW_MS;
}

let queue: Envelope[] = [];
let queueBytes = 2; // "[]"
let timer: ReturnType<typeof setTimeout> | null = null;
let deadline = Infinity;
let outbox: OutboxEntry[] = [];
let outboxLoaded = false;

async function postBatch(events: Envelope[], opts: { keepalive: boolean }): Promise<SendResult> {
  const res = await apiFetch("/api/analytics/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events }),
    keepalive: opts.keepalive,
  });
  return { status: res.status, header: (name) => res.header?.(name) ?? null };
}
let sender: Sender = postBatch;

// ------------------------------------------------------------------ outbox ----

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
function saveOutbox(): void {
  try {
    if (outbox.length > OUTBOX_MAX) outbox = outbox.slice(outbox.length - OUTBOX_MAX);
    const s = storage();
    if (!s) return;
    if (outbox.length === 0) s.removeItem(OUTBOX_KEY);
    else s.setItem(OUTBOX_KEY, JSON.stringify(outbox));
  } catch {
    /* storage unavailable: exact events still go out in-memory, just not across a kill */
  }
}
const idOf = (e: Envelope) => String(e.eventId ?? "");
function randomEventId(): string {
  const bytes = new Uint8Array(12);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Loads the outbox left by earlier runs. Never-sent entries are re-queued; entries whose send was
 * in flight when the app died are dropped (they may have reached the server) unless network-error
 * retry is on; entries waiting on backoff are re-queued once their time has come.
 */
function restoreOutbox(now: number): void {
  if (outboxLoaded) return;
  outboxLoaded = true;
  let stored: OutboxEntry[] = [];
  try {
    const raw = storage()?.getItem(OUTBOX_KEY);
    if (raw) stored = (JSON.parse(raw) as OutboxEntry[]).filter((e) => e && typeof e === "object" && e.envelope);
  } catch {
    stored = [];
  }
  const retry = getClientConfig(now).exactRetryOnNetworkError;
  outbox = stored.filter((e) => (!e.inFlight || retry) && withinRecoveryWindow(e, now)).map((e) => ({ ...e, inFlight: false }));
  saveOutbox();
  const due = outbox.filter((e) => e.nextAttemptAt <= now);
  for (const e of due) pushToQueue(e.envelope);
  const waiting = outbox.filter((e) => e.nextAttemptAt > now);
  if (due.length) scheduleAt(now + getClientConfig(now).exactFlushDelayMs);
  if (waiting.length) scheduleAt(Math.min(...waiting.map((e) => e.nextAttemptAt)));
}

// ------------------------------------------------------------------ queue ----

function clearTimer(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  deadline = Infinity;
}
function scheduleAt(at: number): void {
  if (at >= deadline) return;
  if (timer !== null) clearTimeout(timer);
  deadline = at;
  timer = setTimeout(() => flushAnalyticsQueue("timer"), Math.max(0, at - Date.now()));
}
function pushToQueue(envelope: Envelope): void {
  if (queue.some((e) => e === envelope)) return;
  const cfg = getClientConfig();
  const size = JSON.stringify(envelope).length + 1;
  const maxEvents = Math.min(cfg.maxBatchEvents, WORKER_MAX_BATCH_EVENTS);
  if (queue.length > 0 && (queue.length >= maxEvents || queueBytes + size > cfg.maxBatchBytes)) flushAnalyticsQueue("size");
  queue.push(envelope);
  queueBytes += size;
  if (queue.length >= maxEvents) flushAnalyticsQueue("size");
}

export function flushAnalyticsQueue(reason: FlushReason = "manual"): void {
  if (reason !== "size") clearTimer();
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  queueBytes = 2;
  const lifecycle = reason === "lifecycle";
  const exactIds = new Set(batch.filter((e) => classifyEvent(String(e.eventName)) === "exact").map(idOf));
  if (exactIds.size) {
    // Lifecycle: at-most-once - forget them before the (possibly dying) request leaves.
    if (lifecycle) outbox = outbox.filter((e) => !exactIds.has(idOf(e.envelope)));
    else for (const e of outbox) if (exactIds.has(idOf(e.envelope))) e.inFlight = true;
    saveOutbox();
  }
  try {
    void sender(batch, { keepalive: lifecycle })
      .then((res) => {
        try {
          if (res && typeof res.header === "function") applyConfigHeader(res.header(CONFIG_HEADER));
        } catch {
          /* a bad header never breaks ingest */
        }
        // Any HTTP response: the server has seen these events.
        if (exactIds.size && !lifecycle) {
          outbox = outbox.filter((e) => !exactIds.has(idOf(e.envelope)));
          saveOutbox();
        }
      })
      .catch(() => onNetworkError(exactIds, lifecycle));
  } catch {
    onNetworkError(exactIds, lifecycle);
  }
}

function onNetworkError(exactIds: Set<string>, lifecycle: boolean): void {
  try {
    if (!exactIds.size || lifecycle) return; // telemetry is never retried; lifecycle entries are already gone
    const now = Date.now();
    const retry = getClientConfig(now).exactRetryOnNetworkError;
    const kept: OutboxEntry[] = [];
    for (const e of outbox) {
      if (!exactIds.has(idOf(e.envelope))) {
        kept.push(e);
        continue;
      }
      if (!retry || e.attempts + 1 >= MAX_EXACT_ATTEMPTS) continue; // dropped
      const attempts = e.attempts + 1;
      const backoff = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (attempts - 1));
      kept.push({ ...e, attempts, inFlight: false, nextAttemptAt: now + backoff + Math.floor(Math.random() * 10_000) });
    }
    outbox = kept;
    saveOutbox();
    const waiting = outbox.filter((e) => e.nextAttemptAt > now);
    if (waiting.length) scheduleAt(Math.min(...waiting.map((e) => e.nextAttemptAt)));
  } catch {
    /* never throw */
  }
}

/** Retries whose backoff has elapsed ride in the next send. */
function requeueDueRetries(now: number): void {
  const before = outbox.length;
  outbox = outbox.filter((e) => withinRecoveryWindow(e, now));
  if (outbox.length !== before) saveOutbox();
  for (const e of outbox) if (e.attempts > 0 && !e.inFlight && e.nextAttemptAt <= now) pushToQueue(e.envelope);
}

export function enqueueAnalyticsEvent(envelope: Envelope): void {
  try {
    const now = Date.now();
    restoreOutbox(now);
    requeueDueRetries(now);
    const cfg = getClientConfig(now);
    if (classifyEvent(String(envelope.eventName)) === "exact") {
      if (!envelope.eventId) envelope.eventId = randomEventId();
      outbox.push({ envelope, attempts: 0, nextAttemptAt: 0, inFlight: false, createdAt: now });
      saveOutbox();
      pushToQueue(envelope);
      if (queue.length) scheduleAt(now + cfg.exactFlushDelayMs);
      return;
    }
    pushToQueue(envelope);
    if (queue.length) scheduleAt(now + cfg.flushIntervalMs);
  } catch {
    /* analytics must never break gameplay */
  }
}

function installLifecycleFlush(): void {
  const onHide = () => {
    if (document.visibilityState === "hidden") flushAnalyticsQueue("lifecycle");
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", () => flushAnalyticsQueue("lifecycle"));
  // Android: the WebView does not always fire visibilitychange on backgrounding (seen on the
  // Mi 8 under an interstitial), so the native app-state event flushes too.
  void (async () => {
    try {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform()) return;
      const { App } = await import("@capacitor/app");
      await App.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) flushAnalyticsQueue("lifecycle");
      });
    } catch {
      /* no native bridge: web lifecycle events above still apply */
    }
  })();
}

try {
  if (typeof document !== "undefined" && typeof window !== "undefined") installLifecycleFlush();
} catch {
  /* never throw at import time */
}

// ------------------------------------------------------------------ test hooks ----

/** Accepts the old `(events) => Promise<void>` shape too; a void result counts as an HTTP 204. */
export function _setAnalyticsSenderForTests(next?: (events: Envelope[], opts: { keepalive: boolean }) => Promise<SendResult>): void {
  sender = next ?? postBatch;
}
export function _analyticsQueueStateForTests(): { queued: number; timerArmed: boolean; bytes: number; outbox: number; deadline: number } {
  return { queued: queue.length, timerArmed: timer !== null, bytes: queueBytes, outbox: outbox.length, deadline };
}
export function _analyticsOutboxForTests(): OutboxEntry[] {
  return outbox.map((e) => ({ ...e }));
}
export function _resetAnalyticsQueueForTests(opts: { keepStorage?: boolean } = {}): void {
  clearTimer();
  queue = [];
  queueBytes = 2;
  outbox = [];
  outboxLoaded = false;
  sender = postBatch;
  if (!opts.keepStorage) {
    try {
      storage()?.removeItem(OUTBOX_KEY);
    } catch {
      /* ignore */
    }
  }
}
