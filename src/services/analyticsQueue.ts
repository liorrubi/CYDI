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
// CONCURRENT PAGES (web). The outbox lives in localStorage, which every same-origin tab and
// iframe shares. Before 29 Sep 2026 each page loaded the whole shared outbox on its first
// event and re-sent every pending entry in it - including entries other LIVE pages were about
// to send themselves - and saved its own copy over everyone else's. Thirteen pages opened at
// once sent 1+2+...+13 = 91 copies of 13 events: the exact ledger dropped the repeats by
// eventId, Analytics Engine (written before that de-duplication) counted every one.
// So on the web each entry now has an owner - a random token for this page, kept in the
// entry only, never sent - and:
//  - a page only ever sends its own entries;
//  - saving merges this page's entries into what is stored, never overwriting the others;
//  - a page adopts someone else's entry only when it is clearly orphaned: released by its page
//    on pagehide, written by a build that predates owners, or still unsent well after its
//    owner should have sent it (the owner died without a pagehide). Adopted entries keep their
//    eventId, attempts and backoff, and follow exactly the recovery rules below.
// Android runs one WebView, so it has no concurrent pages: it keeps the original behaviour.
//
// TELEMETRY IS NEVER RETRIED. A failed telemetry batch is dropped - no retry storms, ever.
//
// FAIL-SILENT. Nothing here may ever throw into gameplay code.

import { Capacitor } from "@capacitor/core";
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

/**
 * `owner`: the page that sends this entry (web only). Absent = written by a build without
 * owners; null = released by its page on pagehide. Either way it is free to adopt.
 * `sentAt`: when the owner put it on the wire, so a page that died mid-request is recognisable.
 */
type OutboxEntry = { envelope: Envelope; attempts: number; nextAttemptAt: number; inFlight: boolean; createdAt: number; owner?: string | null; sentAt?: number };

/**
 * How long past its due time a live page's entry may stay unsent before another page treats
 * it as orphaned. A visible page sends an exact event within exactFlushDelayMs (20 s) and a
 * hidden one flushes everything the moment it is hidden, so an entry still waiting two
 * minutes after it was due belongs to a page that is gone.
 */
export const ORPHAN_GRACE_MS = 120_000;
/** How often a page looks for orphans while it is running (it always looks on its first event). */
const ADOPT_CHECK_INTERVAL_MS = 15_000;

/** This page's owner token: random, in memory only, stored inside outbox entries and never sent. */
let pageOwner = randomOwnerToken();
function randomOwnerToken(): string {
  const bytes = new Uint8Array(8);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Web pages share storage and need owners; the Android WebView is a single page and keeps the original behaviour. */
let coordinatedOverride: boolean | null = null;
function coordinated(): boolean {
  if (coordinatedOverride !== null) return coordinatedOverride;
  try {
    return !Capacitor.isNativePlatform();
  } catch {
    return true;
  }
}
let lastAdoptCheck = -Infinity;

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
function readStored(): OutboxEntry[] {
  try {
    const raw = storage()?.getItem(OUTBOX_KEY);
    return raw ? (JSON.parse(raw) as OutboxEntry[]).filter((e) => e && typeof e === "object" && e.envelope) : [];
  } catch {
    return [];
  }
}
function writeStored(entries: OutboxEntry[]): void {
  const s = storage();
  if (!s) return;
  if (entries.length === 0) s.removeItem(OUTBOX_KEY);
  else s.setItem(OUTBOX_KEY, JSON.stringify(entries));
}
/**
 * Web: the stored outbox is shared by every open page, so this page writes back its own
 * entries and leaves everyone else's exactly as stored (an entry this page adopted is its own
 * from then on). Android: one page, so the in-memory list simply is the outbox.
 */
function saveOutbox(): void {
  try {
    if (outbox.length > OUTBOX_MAX) outbox = outbox.slice(outbox.length - OUTBOX_MAX);
    if (!coordinated()) {
      writeStored(outbox);
      return;
    }
    const mine = new Set(outbox.map((e) => idOf(e.envelope)));
    const now = Date.now();
    const others = readStored().filter((e) => e.owner !== pageOwner && !mine.has(idOf(e.envelope)) && withinRecoveryWindow(e, now));
    let merged = [...others, ...outbox.map((e) => ({ ...e, owner: pageOwner }))];
    if (merged.length > OUTBOX_MAX) merged = merged.sort((a, b) => a.createdAt - b.createdAt).slice(merged.length - OUTBOX_MAX);
    writeStored(merged);
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
  if (coordinated()) {
    adoptOrphans(now);
    return;
  }
  const stored = readStored();
  const retry = getClientConfig(now).exactRetryOnNetworkError;
  outbox = stored.filter((e) => (!e.inFlight || retry) && withinRecoveryWindow(e, now)).map((e) => ({ ...e, inFlight: false }));
  saveOutbox();
  queueRecovered(outbox, now);
}

/** Recovered entries go out like new ones: due now -> the exact-event delay; waiting -> their backoff time. */
function queueRecovered(entries: OutboxEntry[], now: number): void {
  const due = entries.filter((e) => e.nextAttemptAt <= now);
  for (const e of due) pushToQueue(e.envelope);
  const waiting = entries.filter((e) => e.nextAttemptAt > now);
  if (due.length) scheduleAt(now + getClientConfig(now).exactFlushDelayMs);
  if (waiting.length) scheduleAt(Math.min(...waiting.map((e) => e.nextAttemptAt)));
}

/**
 * Web only: is this entry, stored by another page, safe to take over? Only when nobody else
 * will send it - released or pre-owner entries at once, a live-looking owner's entries only
 * once they are ORPHAN_GRACE_MS past the moment that owner was due to act on them.
 */
function orphaned(e: OutboxEntry, now: number): boolean {
  if (e.owner === pageOwner) return false;
  if (e.owner === undefined || e.owner === null) return true;
  if (e.inFlight) return now >= (typeof e.sentAt === "number" ? e.sentAt : e.createdAt) + ORPHAN_GRACE_MS;
  const dueAt = e.attempts > 0 ? e.nextAttemptAt : e.createdAt + getClientConfig(now).exactFlushDelayMs;
  return now >= dueAt + ORPHAN_GRACE_MS;
}

/**
 * Web only: take over orphaned entries. They follow exactly the rules a relaunch always
 * applied: an entry that was on the wire when its page died is dropped (it may have reached
 * the server) unless network-error retry is on; anything past the recovery window is dropped;
 * the rest keep their eventId, attempts and backoff and are queued like recovered entries.
 */
function adoptOrphans(now: number): void {
  lastAdoptCheck = now;
  const stored = readStored();
  const candidates = stored.filter((e) => orphaned(e, now));
  if (candidates.length === 0) return;
  const retry = getClientConfig(now).exactRetryOnNetworkError;
  const known = new Set(outbox.map((e) => idOf(e.envelope)));
  const taken = candidates
    .filter((e) => (!e.inFlight || retry) && withinRecoveryWindow(e, now) && !known.has(idOf(e.envelope)))
    .map((e) => ({ ...e, inFlight: false, owner: pageOwner, sentAt: undefined }));
  // Every candidate leaves the shared store: adopted ones as this page's own, the rest
  // (died in flight, or too old) because no page may send them any more.
  const dropped = new Set(candidates.map((e) => idOf(e.envelope)));
  writeStored(stored.filter((e) => !dropped.has(idOf(e.envelope))));
  outbox.push(...taken);
  saveOutbox();
  queueRecovered(taken, now);
}

/** A running page re-checks for orphans now and then (a page that died without a pagehide). */
function maybeAdopt(now: number): void {
  if (coordinated() && outboxLoaded && now - lastAdoptCheck >= ADOPT_CHECK_INTERVAL_MS) adoptOrphans(now);
}

/**
 * pagehide (web): the page may never come back, so whatever of its own it still holds - an
 * entry waiting on a backoff, or one whose request will not complete - is released for the
 * next page to adopt at once, instead of waiting out ORPHAN_GRACE_MS.
 */
function releaseOwnership(): void {
  try {
    if (!coordinated() || outbox.length === 0) return;
    const mine = new Set(outbox.map((e) => idOf(e.envelope)));
    const stored = readStored().filter((e) => !mine.has(idOf(e.envelope)));
    writeStored([...stored, ...outbox.map((e) => ({ ...e, owner: null }))]);
  } catch {
    /* never throw */
  }
}

/**
 * pageshow from the back/forward cache (web): this page released its entries on pagehide.
 * Take back the ones still unclaimed; forget any another page adopted meanwhile (that page
 * sends them now), so an entry never has two senders.
 */
function reclaimOwnership(): void {
  try {
    if (!coordinated() || outbox.length === 0) return;
    const stored = new Map(readStored().map((e) => [idOf(e.envelope), e]));
    outbox = outbox.filter((e) => {
      const s = stored.get(idOf(e.envelope));
      return s !== undefined && (s.owner === null || s.owner === undefined || s.owner === pageOwner);
    });
    const kept = new Set(outbox.map((e) => idOf(e.envelope)));
    queue = queue.filter((env) => classifyEvent(String(env.eventName)) !== "exact" || kept.has(idOf(env)));
    queueBytes = queue.reduce((t, env) => t + JSON.stringify(env).length + 1, 2);
    saveOutbox();
  } catch {
    /* never throw */
  }
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

// ------------------------------------------------------------ lifecycle hooks ----

/**
 * Pre-flush hooks. A lifecycle flush (visibilitychange hidden, pagehide, native appStateChange inactive) is
 * the LAST chance to send telemetry - it is never persisted and never retried - so a module that must
 * report something at that moment (the play-session segment summary) registers here and is called
 * synchronously, BEFORE the queue is swapped out: whatever it enqueues rides in that very request. A hook
 * registered through a separate lifecycle listener of its own could run after the flush, and its event
 * would wait for the 120 s timer and be lost on kill.
 *
 * The hook runs for EVERY lifecycle trigger (several can fire for one backgrounding, and also for a pause
 * that is not a real exit, such as an AdMob full-screen ad), so it must decide for itself whether this is
 * the moment it cares about and must be idempotent. Keyed by name: re-registering replaces. A throwing hook
 * can never stop the flush or the other hooks.
 */
const lifecycleHooks = new Map<string, () => void>();

export function registerBeforeLifecycleFlush(name: string, hook: () => void): () => void {
  lifecycleHooks.set(name, hook);
  return () => {
    if (lifecycleHooks.get(name) === hook) lifecycleHooks.delete(name);
  };
}

function runLifecycleHooks(): void {
  for (const hook of [...lifecycleHooks.values()]) {
    try {
      hook();
    } catch {
      /* a hook never breaks the flush */
    }
  }
}

export function flushAnalyticsQueue(reason: FlushReason = "manual"): void {
  // Before the queue is taken (see registerBeforeLifecycleFlush); anything the hooks enqueue is in this batch.
  if (reason === "lifecycle") runLifecycleHooks();
  if (reason !== "size") clearTimer();
  // A page that only waits still picks up entries a dead page left behind.
  if (reason === "timer") maybeAdopt(Date.now());
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  queueBytes = 2;
  const lifecycle = reason === "lifecycle";
  const exactIds = new Set(batch.filter((e) => classifyEvent(String(e.eventName)) === "exact").map(idOf));
  if (exactIds.size) {
    // Lifecycle: at-most-once - forget them before the (possibly dying) request leaves.
    if (lifecycle) outbox = outbox.filter((e) => !exactIds.has(idOf(e.envelope)));
    else {
      const sentAt = Date.now();
      for (const e of outbox) if (exactIds.has(idOf(e.envelope))) {
        e.inFlight = true;
        e.sentAt = sentAt;
      }
    }
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
    maybeAdopt(now);
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
  window.addEventListener("pagehide", () => {
    flushAnalyticsQueue("lifecycle");
    releaseOwnership();
  });
  // Back from the back/forward cache: take back what was released on pagehide and is unclaimed.
  window.addEventListener("pageshow", (event) => {
    if ((event as PageTransitionEvent).persisted) reclaimOwnership();
  });
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
/** Forces the web (true) or Android (false) outbox behaviour; undefined restores platform detection. */
export function _setAnalyticsQueueCoordinatedForTests(value?: boolean): void {
  coordinatedOverride = value ?? null;
}
/** The pagehide and bfcache-pageshow steps, which node tests cannot trigger as DOM events. */
export function _pageHideForTests(): void {
  flushAnalyticsQueue("lifecycle");
  releaseOwnership();
}
export function _pageShowFromCacheForTests(): void {
  reclaimOwnership();
}
export function _resetAnalyticsQueueForTests(opts: { keepStorage?: boolean } = {}): void {
  clearTimer();
  queue = [];
  queueBytes = 2;
  outbox = [];
  outboxLoaded = false;
  lastAdoptCheck = -Infinity;
  // A reset is a new page: a fresh owner token, exactly like a reload.
  pageOwner = randomOwnerToken();
  sender = postBatch;
  if (!opts.keepStorage) {
    try {
      storage()?.removeItem(OUTBOX_KEY);
    } catch {
      /* ignore */
    }
  }
}
