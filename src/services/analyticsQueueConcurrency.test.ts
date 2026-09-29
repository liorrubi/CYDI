/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Web outbox under concurrent pages (analyticsQueue.ts, "CONCURRENT PAGES").
//
// Every same-origin page shares one localStorage outbox. Before the fix, N pages opened at
// once sent 1+2+...+N copies of N exact events (13 pages: 91 envelopes for 13 events): the
// exact ledger de-duplicated them by eventId, Analytics Engine counted every copy.
//
// Each "page" here is its own instance of the queue module (a distinct import URL) sharing
// ONE storage, exactly like tabs and iframes. The fake server records every envelope it
// receives - what Analytics Engine would store - and counts each eventId once, like the
// exact ledger.
import test from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}
const shared = new MemoryStorage();
(globalThis as { localStorage?: unknown }).localStorage = shared;

const KEY = "cydi.analyticsOutbox.v1";
type Env = Record<string, unknown>;
type Page = Awaited<ReturnType<typeof loadPage>>;
let pageSeq = 0;

async function loadPage() {
  // A distinct URL = a distinct module instance = a distinct page (its own memory and owner).
  return import(`./analyticsQueue.ts?page=${++pageSeq}`);
}

/** The server: `received` = every envelope (Analytics Engine); `ledger` = eventIds counted once. */
function server() {
  const received: Env[] = [];
  const ledger = new Set<string>();
  let requests = 0;
  let mode: "ok" | "down" = "ok";
  const sender = async (events: Env[]) => {
    requests++;
    if (mode === "down") throw new Error("offline");
    for (const e of events) {
      received.push(e);
      if (e.eventId) ledger.add(String(e.eventId));
    }
    return { status: 200, header: () => null };
  };
  return {
    sender,
    received,
    ledger,
    get requests() {
      return requests;
    },
    setMode(m: "ok" | "down") {
      mode = m;
    },
    exactReceived: () => received.filter((e) => e.eventName === "app_open"),
  };
}
const settle = () => new Promise((r) => setTimeout(r, 5));
const appOpen = (n: number) => ({ eventName: "app_open", params: {}, seq: n });
const stored = (): { owner?: string | null; envelope: Env; createdAt: number; inFlight: boolean; attempts: number; nextAttemptAt: number }[] =>
  JSON.parse(shared.getItem(KEY) ?? "[]");

async function openPages(n: number, srv: ReturnType<typeof server>, coordinated = true): Promise<Page[]> {
  const pages: Page[] = [];
  for (let i = 0; i < n; i++) {
    const p = await loadPage();
    p._resetAnalyticsQueueForTests({ keepStorage: true });
    p._setAnalyticsQueueCoordinatedForTests(coordinated);
    p._setAnalyticsSenderForTests(srv.sender);
    pages.push(p);
  }
  return pages;
}

test.beforeEach(() => shared.m.clear());

// ------------------------------------------------------------ the regression ----

test("13 pages opened at once: 13 envelopes for 13 events (was 91) - one request per page, nothing lost", async () => {
  const srv = server();
  const pages = await openPages(13, srv);
  // Every page records its app_open before any of them flushes - the burst that multiplied.
  pages.forEach((p, i) => p.enqueueAnalyticsEvent(appOpen(i)));
  pages.forEach((p) => p.flushAnalyticsQueue("timer"));
  await settle();
  assert.equal(srv.exactReceived().length, 13, "Analytics Engine gets each event once");
  assert.equal(srv.ledger.size, 13, "the ledger still counts all 13");
  assert.equal(srv.requests, 13);
  assert.equal(stored().length, 0, "every page's outbox is clear after the answers");
});

test("the same 13-page burst without owners reproduces the old 1+2+...+13 = 91 (control)", async () => {
  // Legacy mode = the pre-fix shared-outbox behaviour on the web (and still Android's, where it is safe).
  const srv = server();
  const pages: Page[] = [];
  for (let i = 0; i < 13; i++) {
    const p = await loadPage();
    p._resetAnalyticsQueueForTests({ keepStorage: true });
    p._setAnalyticsQueueCoordinatedForTests(false);
    p._setAnalyticsSenderForTests(srv.sender);
    p.enqueueAnalyticsEvent(appOpen(i)); // each page loads, restoring what the earlier ones left
    pages.push(p);
  }
  pages.forEach((p) => p.flushAnalyticsQueue("timer"));
  await settle();
  assert.equal(srv.exactReceived().length, 91, "the production numbers: 91 copies");
  assert.equal(srv.ledger.size, 13);
});

test("two pages opened at once each send only their own event", async () => {
  const srv = server();
  const [a, b] = await openPages(2, srv);
  a.enqueueAnalyticsEvent(appOpen(1));
  b.enqueueAnalyticsEvent(appOpen(2));
  a.flushAnalyticsQueue("timer");
  b.flushAnalyticsQueue("timer");
  await settle();
  assert.deepEqual(srv.exactReceived().map((e) => e.seq).sort(), [1, 2]);
  assert.equal(srv.ledger.size, 2);
});

test("one normal page: its event is sent once and the outbox clears", async () => {
  const srv = server();
  const [p] = await openPages(1, srv);
  p.enqueueAnalyticsEvent(appOpen(1));
  assert.equal(stored().length, 1, "persisted while queued");
  p.flushAnalyticsQueue("timer");
  await settle();
  assert.equal(srv.exactReceived().length, 1);
  assert.equal(stored().length, 0);
});

test("sequential navigation: page 1 sends, then page 2 loads - no resend of page 1's event", async () => {
  const srv = server();
  const [p1] = await openPages(1, srv);
  p1.enqueueAnalyticsEvent(appOpen(1));
  p1.flushAnalyticsQueue("timer");
  await settle();
  p1._pageHideForTests();
  const [p2] = await openPages(1, srv);
  p2.enqueueAnalyticsEvent(appOpen(2));
  p2.flushAnalyticsQueue("timer");
  await settle();
  assert.deepEqual(srv.exactReceived().map((e) => e.seq), [1, 2]);
});

test("reload before the 20 s flush: pagehide sends the event (keepalive, at-most-once); the new page does not resend it", async () => {
  const srv = server();
  const [p1] = await openPages(1, srv);
  p1.enqueueAnalyticsEvent(appOpen(1));
  p1._pageHideForTests(); // the reload
  const [p2] = await openPages(1, srv);
  p2.enqueueAnalyticsEvent(appOpen(2));
  p2.flushAnalyticsQueue("timer");
  await settle();
  assert.deepEqual(srv.exactReceived().map((e) => e.seq), [1, 2], "each exactly once");
});

test("quick close: a tab closed right after loading still delivers its event, once", async () => {
  const srv = server();
  const [p] = await openPages(1, srv);
  p.enqueueAnalyticsEvent(appOpen(1));
  p._pageHideForTests();
  await settle();
  assert.equal(srv.exactReceived().length, 1);
  assert.equal(stored().length, 0);
});

test("one of two tabs closes while the other stays open: nothing is lost, nothing doubles", async () => {
  const srv = server();
  const [a, b] = await openPages(2, srv);
  a.enqueueAnalyticsEvent(appOpen(1));
  b.enqueueAnalyticsEvent(appOpen(2));
  a._pageHideForTests(); // a closes before its timer
  b.enqueueAnalyticsEvent(appOpen(3)); // b keeps working
  b.flushAnalyticsQueue("timer");
  await settle();
  assert.deepEqual(srv.exactReceived().map((e) => e.seq).sort(), [1, 2, 3]);
  assert.equal(srv.exactReceived().length, 3);
});

// ---------------------------------------------------------------- reliability ----

test("offline then reconnect (retry on): the failed event is retried by its own page after its backoff, arrives once, and the other page never touches it", async () => {
  const srv = server();
  const [a, b] = await openPages(2, srv);
  const { applyConfigHeader, _resetClientConfigForTests } = await import("./analyticsClientConfig.ts");
  applyConfigHeader(JSON.stringify({ v: 1, exactRetryOnNetworkError: true }));
  const realNow = Date.now;
  let clock = realNow();
  Date.now = () => clock; // one clock for both pages
  try {
    srv.setMode("down");
    a.enqueueAnalyticsEvent(appOpen(1));
    a.flushAnalyticsQueue("timer");
    await settle();
    const waiting = stored().find((e) => e.envelope.seq === 1)!;
    assert.equal(waiting.attempts, 1, "backing off, still in the outbox");
    srv.setMode("ok");
    // b works meanwhile - including after a's backoff has elapsed but within the grace.
    b.enqueueAnalyticsEvent(appOpen(2));
    b.flushAnalyticsQueue("timer");
    clock = waiting.nextAttemptAt + 30_000;
    b.enqueueAnalyticsEvent(appOpen(3));
    b.flushAnalyticsQueue("timer");
    await settle();
    assert.deepEqual(srv.exactReceived().map((e) => e.seq), [2, 3], "b sent only its own");
    // a's backoff is over: its next activity re-queues the retry, which goes out once.
    a.enqueueAnalyticsEvent(appOpen(4));
    a.flushAnalyticsQueue("timer");
    await settle();
    assert.equal(srv.exactReceived().filter((e) => e.seq === 1).length, 1, "the retried event arrives exactly once");
    assert.equal(srv.exactReceived().length, 4, "4 events, 4 envelopes");
    assert.equal(srv.ledger.size, 4);
    assert.equal(stored().length, 0);
  } finally {
    Date.now = realNow;
    _resetClientConfigForTests();
  }
});

test("failed send, retry off (the default): dropped as before - no page picks it up later", async () => {
  const srv = server();
  const [a] = await openPages(1, srv);
  srv.setMode("down");
  a.enqueueAnalyticsEvent(appOpen(1));
  a.flushAnalyticsQueue("timer");
  await settle();
  assert.equal(stored().length, 0, "unchanged semantics: a network error drops it unless retry is on");
});

test("browser restart with a pending event: the next page adopts it and sends it once, keeping its eventId", async () => {
  const srv = server();
  const [dead] = await openPages(1, srv);
  dead._setAnalyticsSenderForTests(() => new Promise(() => {})); // never gets to send...
  dead.enqueueAnalyticsEvent(appOpen(1)); // ...the browser dies without a pagehide
  const originalId = stored()[0].envelope.eventId;
  // Time passes (a restart): the entry is well past its owner's due time.
  shared.setItem(KEY, JSON.stringify(stored().map((e) => ({ ...e, createdAt: Date.now() - 10 * 60_000 }))));
  const [next] = await openPages(1, srv);
  next.enqueueAnalyticsEvent(appOpen(2));
  next.flushAnalyticsQueue("timer");
  await settle();
  const sent1 = srv.exactReceived().filter((e) => e.seq === 1);
  assert.equal(sent1.length, 1);
  assert.equal(sent1[0].eventId, originalId, "same eventId: the ledger de-duplication still works");
});

test("an entry of a page that is still alive is never taken before its grace, even by a page that loads later", async () => {
  const srv = server();
  const [slow] = await openPages(1, srv);
  slow._setAnalyticsSenderForTests(() => new Promise(() => {})); // alive, request pending
  slow.enqueueAnalyticsEvent(appOpen(1));
  slow.flushAnalyticsQueue("timer"); // in flight
  const [other] = await openPages(1, srv);
  other.enqueueAnalyticsEvent(appOpen(2));
  other.flushAnalyticsQueue("timer");
  await settle();
  assert.deepEqual(srv.exactReceived().map((e) => e.seq), [2]);
  assert.equal(stored().filter((e) => e.envelope.seq === 1).length, 1, "left alone in the store");
});

test("a page that died mid-request: its in-flight entry is dropped after the grace (it may have reached the server) - the old relaunch rule", async () => {
  const srv = server();
  const [dead] = await openPages(1, srv);
  dead._setAnalyticsSenderForTests(() => new Promise(() => {}));
  dead.enqueueAnalyticsEvent(appOpen(1));
  dead.flushAnalyticsQueue("timer");
  shared.setItem(KEY, JSON.stringify(stored().map((e) => ({ ...e, sentAt: Date.now() - 10 * 60_000 }))));
  const [next] = await openPages(1, srv);
  next.enqueueAnalyticsEvent(appOpen(2));
  next.flushAnalyticsQueue("timer");
  await settle();
  assert.deepEqual(srv.exactReceived().map((e) => e.seq), [2], "not resent by default");
  assert.equal(stored().length, 0, "and no longer stored");
});

test("stale entries (past the 5-day recovery window) are dropped by any page, never sent", async () => {
  const srv = server();
  const { OUTBOX_MAX_AGE_MS } = await loadPage();
  shared.setItem(KEY, JSON.stringify([{ envelope: { eventName: "app_open", params: {}, eventId: "e".repeat(24), seq: 9 }, attempts: 0, nextAttemptAt: 0, inFlight: false, createdAt: Date.now() - OUTBOX_MAX_AGE_MS - 60_000, owner: "deadbeefdeadbeef" }]));
  const [p] = await openPages(1, srv);
  p.enqueueAnalyticsEvent(appOpen(1));
  p.flushAnalyticsQueue("timer");
  await settle();
  assert.deepEqual(srv.exactReceived().map((e) => e.seq), [1]);
  assert.equal(stored().length, 0);
});

test("entries written by a build without owners are adopted at once, like any relaunch always did", async () => {
  const srv = server();
  shared.setItem(KEY, JSON.stringify([{ envelope: { eventName: "app_open", params: {}, eventId: "a".repeat(24), seq: 7 }, attempts: 0, nextAttemptAt: 0, inFlight: false, createdAt: Date.now() - 1_000 }]));
  const [p] = await openPages(1, srv);
  p.enqueueAnalyticsEvent(appOpen(1));
  p.flushAnalyticsQueue("timer");
  await settle();
  assert.deepEqual(srv.exactReceived().map((e) => e.seq).sort(), [1, 7]);
});

test("a released entry (its page hid mid-backoff) is adopted at once by the next page and sent once", async () => {
  const srv = server();
  const { applyConfigHeader, _resetClientConfigForTests } = await import("./analyticsClientConfig.ts");
  applyConfigHeader(JSON.stringify({ v: 1, exactRetryOnNetworkError: true }));
  try {
    const [a] = await openPages(1, srv);
    srv.setMode("down");
    a.enqueueAnalyticsEvent(appOpen(1));
    a.flushAnalyticsQueue("timer");
    await settle(); // backing off
    srv.setMode("ok");
    a._pageHideForTests(); // closes: releases what it still holds
    assert.equal(stored()[0].owner, null, "released, not owned");
    shared.setItem(KEY, JSON.stringify(stored().map((e) => ({ ...e, nextAttemptAt: 0 })))); // backoff over
    const [b] = await openPages(1, srv);
    b.enqueueAnalyticsEvent(appOpen(2));
    b.flushAnalyticsQueue("timer");
    await settle();
    assert.deepEqual(srv.exactReceived().map((e) => e.seq).sort(), [1, 2]);
  } finally {
    _resetClientConfigForTests();
  }
});

test("back from the bfcache: the page takes back its released entry, or forgets it if another page adopted it", async () => {
  const srv = server();
  const [a] = await openPages(1, srv);
  a._setAnalyticsSenderForTests(() => new Promise(() => {}));
  a.enqueueAnalyticsEvent(appOpen(1));
  a.flushAnalyticsQueue("timer"); // in flight, never answered
  a._pageHideForTests(); // into the bfcache: released
  a._pageShowFromCacheForTests(); // back: nobody adopted it -> a owns it again
  assert.equal(a._analyticsOutboxForTests().length, 1);
  assert.notEqual(stored()[0].owner, null, "owned again");
  a._pageHideForTests(); // hidden again...
  const [b] = await openPages(1, srv);
  b.enqueueAnalyticsEvent(appOpen(2)); // ...b adopts the released entry (dropped: it was in flight, retry off)
  a._pageShowFromCacheForTests(); // a returns and must not keep a second copy
  assert.equal(a._analyticsOutboxForTests().length, 0, "never two senders for one entry");
});

test("Android keeps the original single-page behaviour: a killed app's event goes out on the very next launch", async () => {
  const srv = server();
  const [p] = await openPages(1, srv, false);
  p._setAnalyticsSenderForTests(() => new Promise(() => {}));
  p.enqueueAnalyticsEvent(appOpen(1)); // killed before sending
  const [next] = await openPages(1, srv, false);
  next.enqueueAnalyticsEvent(appOpen(2));
  next.flushAnalyticsQueue("timer");
  await settle();
  assert.deepEqual(srv.exactReceived().map((e) => e.seq).sort(), [1, 2], "no grace on native");
});

test("pages never overwrite each other's stored entries (a merge, not a last-writer-wins)", async () => {
  const srv = server();
  const pages = await openPages(3, srv);
  pages.forEach((p) => p._setAnalyticsSenderForTests(() => new Promise(() => {})));
  pages.forEach((p, i) => p.enqueueAnalyticsEvent(appOpen(i)));
  assert.equal(stored().length, 3, "all three pages' pending events are in storage together");
  assert.equal(new Set(stored().map((e) => e.owner)).size, 3);
});
