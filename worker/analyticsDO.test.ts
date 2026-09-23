/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// AnalyticsDO buffered persistence (P0.1).
//
// The change under test moves WHEN counters are written, never WHAT is counted.
// So the first and most important test here is equivalence: the same event
// sequence must leave storage holding exactly what the unbuffered read-modify-write
// path produced, byte for byte. Everything after that guards the buffer itself -
// that events between budget boundaries cost no writes, that no alarm is involved,
// that a fresh instance writes through so a trickle cannot be lost, that eviction
// costs at most one budget, that reports see unflushed state, that a day boundary
// cannot mix two buckets, and that an event arriving mid-write is not lost.
//
// Driven through a hand-rolled DurableObjectState double, same approach as
// roomDO.test.ts, so the suite stays inside the project's plain `node --test`
// runner.
import test from "node:test";
import assert from "node:assert/strict";
import { israelDateKey } from "../src/app/israelDate.ts";

const { AnalyticsDO, incrementEvent } = await import("./analyticsDO.ts");

// ------------------------------------------------------------------ doubles ----

class FakeStorage {
  map = new Map<string, unknown>();
  alarm: number | null = null;
  /** Invocations, not keys - "storage.put was called N times" is the quota-relevant count. */
  putCalls = 0;
  /** Keys persisted across all calls - the rows-written proxy. */
  keysWritten = 0;
  setAlarmCalls = 0;
  getCalls = 0;
  /** When set, put() yields to the microtask/timer queue so a request can interleave with a flush. */
  slowPut = false;

  async get<T>(keyOrKeys: string | string[]): Promise<T | undefined | Map<string, T>> {
    this.getCalls++;
    if (Array.isArray(keyOrKeys)) {
      const out = new Map<string, T>();
      for (const key of keyOrKeys) {
        if (this.map.has(key)) out.set(key, structuredClone(this.map.get(key)) as T);
      }
      return out;
    }
    const value = this.map.get(keyOrKeys);
    return value === undefined ? undefined : (structuredClone(value) as T);
  }

  async put(keyOrEntries: string | Record<string, unknown>, value?: unknown): Promise<void> {
    this.putCalls++;
    if (this.slowPut) await new Promise((resolve) => setTimeout(resolve, 5));
    if (typeof keyOrEntries === "string") {
      this.map.set(keyOrEntries, structuredClone(value));
      this.keysWritten++;
      return;
    }
    for (const [key, entry] of Object.entries(keyOrEntries)) {
      this.map.set(key, structuredClone(entry));
      this.keysWritten++;
    }
  }

  async setAlarm(time: number): Promise<void> {
    this.setAlarmCalls++;
    this.alarm = time;
  }
  async deleteAlarm(): Promise<void> {
    this.alarm = null;
  }
  async getAlarm(): Promise<number | null> {
    return this.alarm;
  }

  resetCounters(): void {
    this.putCalls = 0;
    this.keysWritten = 0;
    this.setAlarmCalls = 0;
    this.getCalls = 0;
  }
}

class FakeState {
  storage = new FakeStorage();
  ready: Promise<unknown> = Promise.resolve();
  blockConcurrencyWhile(fn: () => Promise<unknown>): Promise<unknown> {
    this.ready = fn();
    return this.ready;
  }
}

// ---------------------------------------------------------------- time control ----

// 2026-09-23T09:00:00Z -> mid-morning in Israel, comfortably inside one local day.
let clock = Date.UTC(2026, 8, 23, 9, 0, 0);
const realNow = Date.now;
test.before(() => {
  Date.now = () => clock;
});
test.after(() => {
  Date.now = realNow;
});
function setClock(t: number) {
  clock = t;
}

// ------------------------------------------------------------------ harness ----

const TOKEN = "test-analytics-token";

type Envelope = {
  eventName: string;
  params?: Record<string, unknown>;
  platform?: string;
  installationId?: string;
  sessionId?: string;
  isInternal?: boolean;
  appVersion?: string;
  appBuild?: string;
  attribution?: Record<string, string>;
};

async function makeDO(seed?: Record<string, unknown>) {
  const state = new FakeState();
  if (seed) for (const [key, value] of Object.entries(seed)) state.storage.map.set(key, value);
  const analytics = new AnalyticsDO(state as unknown as DurableObjectState, { ANALYTICS_ADMIN_TOKEN: TOKEN });
  await state.ready;
  state.storage.resetCounters();

  const send = async (envelope: Envelope, country = "IL") => {
    const response = await analytics.fetch(
      new Request("https://analytics.internal/event", {
        method: "POST",
        headers: { "content-type": "application/json", "x-cydi-country": country },
        body: JSON.stringify(envelope),
      }),
    );
    return response;
  };

  const report = async (query = "period=daily&audience=external") => {
    const response = await analytics.fetch(
      new Request(`https://analytics.internal/report?${query}`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    );
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()) as { counts: Record<string, { total: number }>; usage: { installations: number } | null };
  };

  return { analytics, state, storage: state.storage, send, report, flush: () => analytics.alarm() };
}

/** A small fixed sequence that touches every breakout family the DO maintains. */
const SEQUENCE: Envelope[] = [
  { eventName: "app_open", params: {}, platform: "android", appVersion: "0.50.0", appBuild: "fd79337", installationId: "aaaaaaaaaaaa", sessionId: "bbbbbbbbbbbb" },
  { eventName: "game_started", params: { gameType: "shapeChallenge", category: "animals", contentKey: "cat" }, platform: "android", appVersion: "0.50.0", appBuild: "fd79337", installationId: "aaaaaaaaaaaa", sessionId: "bbbbbbbbbbbb" },
  { eventName: "game_completed", params: { gameType: "shapeChallenge", category: "animals", contentKey: "cat" }, platform: "android", appVersion: "0.50.0", appBuild: "fd79337", installationId: "aaaaaaaaaaaa", sessionId: "bbbbbbbbbbbb" },
  { eventName: "shape_completed", params: { category: "animals", starRating: 4, passed: true, isNewBest: true }, platform: "android", appVersion: "0.50.0", appBuild: "fd79337", installationId: "aaaaaaaaaaaa", sessionId: "bbbbbbbbbbbb" },
  { eventName: "rewarded_ad_unavailable", params: { placement: "shape_challenge_double_reward", reason: "no_fill" }, platform: "android", appVersion: "0.50.0", appBuild: "fd79337", installationId: "cccccccccccc", sessionId: "dddddddddddd" },
  { eventName: "reward_offer_shown", params: { placement: "shape_challenge_double_reward" }, platform: "android", appVersion: "0.48.4", appBuild: "aaaaaaa", installationId: "cccccccccccc", sessionId: "dddddddddddd" },
  { eventName: "first_open", params: { installAge: "h0_24" }, platform: "android", appVersion: "0.50.0", appBuild: "fd79337", installationId: "eeeeeeeeeeee", sessionId: "ffffffffffff", attribution: { source: "google-play", medium: "organic", campaign: "unknown", content: "unknown", term: "unknown" } },
  { eventName: "app_open", params: {}, platform: "web", appVersion: "0.50.0", appBuild: "fd79337", installationId: "111111111111", sessionId: "222222222222" },
];

// -------------------------------------------------------------- equivalence ----

test("buffered writes store exactly what per-event writes produced", async () => {
  const { send, flush, storage } = await makeDO();
  for (const envelope of SEQUENCE) await send(envelope);
  await flush();

  // The same sequence, folded the way the unbuffered path folded it: one
  // incrementEvent per event, straight onto the accumulating object.
  let expected = {};
  for (const e of SEQUENCE) {
    expected = incrementEvent(
      expected,
      e.eventName as never,
      (e.params ?? {}) as Record<string, unknown>,
      (e.platform ?? "unknown") as never,
      e.appVersion ?? "unknown",
      e.appBuild ?? "unknown",
      e.attribution as never,
      "IL",
    );
  }

  const dateKey = israelDateKey(clock);
  assert.deepEqual(storage.map.get(`day:${dateKey}`), expected);
  // alltime is maintained by the same call with the same arguments, so it must
  // land on the identical object for a fresh instance.
  assert.deepEqual(storage.map.get("alltime"), expected);
});

test("every dimension survives the buffer", async () => {
  const { send, flush, storage } = await makeDO();
  for (const envelope of SEQUENCE) await send(envelope);
  await flush();
  const day = storage.map.get(`day:${israelDateKey(clock)}`) as Record<string, Record<string, unknown>>;

  assert.deepEqual(day.app_open.byPlatform, { android: 1, web: 1 });
  assert.deepEqual(day.app_open.byAppBuild, { fd79337: 2 });
  assert.deepEqual(day.game_started.byGameType, { shapeChallenge: 1 });
  assert.deepEqual(day.game_started.byCategory, { animals: 1 });
  assert.deepEqual(day.game_started.byContentKey, { cat: 1 });
  assert.deepEqual(day.shape_completed.scoredCount, 1);
  assert.deepEqual(day.rewarded_ad_unavailable.byReason, { no_fill: 1 });
  assert.deepEqual(day.rewarded_ad_unavailable.byCountry, { IL: 1 });
  assert.deepEqual(day.rewarded_ad_unavailable.byCountryReason, { "IL|no_fill": 1 });
  assert.deepEqual(day.rewarded_ad_unavailable.byCountryAppVersion, { "IL|0.50.0": 1 });
  assert.deepEqual(day.rewarded_ad_unavailable.byCountryAppVersionReason, { "IL|0.50.0|no_fill": 1 });
  assert.deepEqual(day.reward_offer_shown.byCountry, { IL: 1 });
  assert.deepEqual(day.first_open.byInstallAge, { h0_24: 1 });
  assert.deepEqual(day.first_open.bySource, { "google-play": 1 });

  // Usage id sets are buffered too and must still be there.
  const usage = storage.map.get(`usage:${israelDateKey(clock)}`) as { segments: Record<string, { installations: string[] }> };
  const installations = Object.values(usage.segments).flatMap((s) => s.installations);
  assert.deepEqual(installations.sort(), ["111111111111", "aaaaaaaaaaaa", "cccccccccccc", "eeeeeeeeeeee"]);
});

// ---------------------------------------------------------- write discipline ----

test("the first event on a fresh instance writes through, so a trickle can lose nothing", async () => {
  const { send, storage } = await makeDO();
  await send({ eventName: "app_open", params: {}, platform: "android" });
  assert.equal(storage.putCalls, 1, "a lone event followed by eviction must already be durable");
  assert.equal((storage.map.get("alltime") as Record<string, { total: number }>).app_open.total, 1);
});

test("events between budget boundaries cost no write at all", async () => {
  const { send, storage } = await makeDO();
  await send({ eventName: "app_open", params: {}, platform: "android" });
  storage.resetCounters();
  for (let i = 0; i < 4; i++) await send({ eventName: "app_open", params: {}, platform: "android" });
  assert.equal(storage.putCalls, 0, "an event inside the budget must not cost a write - that is the optimization");
  assert.equal(storage.keysWritten, 0);
});

test("the pending-event budget forces a write during a burst", async () => {
  const { send, storage } = await makeDO();
  await send({ eventName: "app_open", params: {}, platform: "android" });
  storage.resetCounters();
  // The clock is frozen, so only the 5-event ceiling can fire here.
  for (let i = 0; i < 5; i++) await send({ eventName: "app_open", params: {}, platform: "android" });
  assert.equal(storage.putCalls, 1, "a burst must not put more than the ceiling at risk");
  assert.equal((storage.map.get("alltime") as Record<string, { total: number }>).app_open.total, 6);
});

test("the time budget forces a write during a trickle", async () => {
  const { send, storage } = await makeDO();
  await send({ eventName: "app_open", params: {}, platform: "android" });
  storage.resetCounters();
  await send({ eventName: "app_open", params: {}, platform: "android" });
  assert.equal(storage.putCalls, 0);
  setClock(clock + 15_001);
  await send({ eventName: "app_open", params: {}, platform: "android" });
  assert.equal(storage.putCalls, 1, "15s of buffering is the ceiling, enforced by the next event");
  assert.equal((storage.map.get("alltime") as Record<string, { total: number }>).app_open.total, 3);
  setClock(Date.UTC(2026, 8, 23, 9, 0, 0));
});

test("no alarm is ever armed", async () => {
  // An alarm cannot rescue a buffer the runtime evicted with its instance, and one
  // short enough to beat eviction fires mid-stream and multiplies the writes. The
  // budgets are the whole mechanism, so nothing here may cost an alarm write.
  const { send, storage } = await makeDO();
  for (let i = 0; i < 100; i++) await send({ eventName: "app_open", params: {}, platform: "android" });
  assert.equal(storage.setAlarmCalls, 0);
  assert.equal(storage.alarm, null);
});

test("a stale alarm from an earlier version still flushes rather than throwing", async () => {
  const { send, storage, analytics } = await makeDO();
  await send({ eventName: "app_open", params: {}, platform: "android" }); // write-through
  await send({ eventName: "app_open", params: {}, platform: "android" }); // buffered
  await analytics.alarm();
  assert.equal((storage.map.get("alltime") as Record<string, { total: number }>).app_open.total, 2);
});

test("a flush writes exactly the intended key set, in one put", async () => {
  const { send, flush, storage } = await makeDO();
  await send({ eventName: "app_open", params: {}, platform: "android", installationId: "aaaaaaaaaaaa", sessionId: "bbbbbbbbbbbb" });
  await send({ eventName: "app_open", params: {}, platform: "android", isInternal: true, installationId: "cccccccccccc", sessionId: "dddddddddddd" });
  storage.resetCounters();
  await flush();

  const dateKey = israelDateKey(clock);
  assert.equal(storage.putCalls, 1, "one multi-key put per flush");
  assert.deepEqual(
    [...storage.map.keys()].sort(),
    ["alltime", "alltime:internal", `day:${dateKey}`, `dayint:${dateKey}`, "days", `usage:${dateKey}`].sort(),
  );
  assert.deepEqual(storage.map.get("days"), [dateKey]);
});

test("a flush with nothing dirty writes nothing", async () => {
  const { flush, storage } = await makeDO();
  await flush();
  assert.equal(storage.putCalls, 0);
});

test("repeat ids do not re-dirty the usage bucket", async () => {
  const { send, flush, storage } = await makeDO();
  await send({ eventName: "app_open", params: {}, platform: "android", installationId: "aaaaaaaaaaaa", sessionId: "bbbbbbbbbbbb" });
  await flush();
  storage.resetCounters();
  // Same installation and session: the id lists are unchanged, so only the two
  // counter keys should be rewritten.
  await send({ eventName: "game_started", params: { gameType: "shapeChallenge", category: "animals", contentKey: "cat" }, platform: "android", installationId: "aaaaaaaaaaaa", sessionId: "bbbbbbbbbbbb" });
  await flush();
  assert.equal(storage.keysWritten, 2, "only alltime + the day bucket");
});

// ------------------------------------------------------------- report merge ----

test("a report includes events that have not been flushed yet", async () => {
  const { send, report, storage } = await makeDO();
  await send({ eventName: "app_open", params: {}, platform: "android", installationId: "aaaaaaaaaaaa", sessionId: "bbbbbbbbbbbb" });
  storage.resetCounters();
  for (let i = 0; i < 4; i++) {
    await send({ eventName: "app_open", params: {}, platform: "android", installationId: "aaaaaaaaaaaa", sessionId: "bbbbbbbbbbbb" });
  }
  assert.equal(storage.putCalls, 0, "precondition: these four are still only in memory");

  const daily = await report();
  assert.equal(daily.counts.app_open.total, 5);
  assert.equal(daily.usage?.installations, 1);
});

test("range and alltime reports also see the buffer", async () => {
  const { send, report } = await makeDO();
  await send({ eventName: "app_open", params: {}, platform: "android" });
  await send({ eventName: "app_open", params: {}, platform: "android" });
  const dateKey = israelDateKey(clock);

  const range = await report(`period=range&start=${dateKey}&end=${dateKey}&audience=external`);
  assert.equal(range.counts.app_open.total, 2);

  const alltime = await report("period=alltime&audience=external");
  assert.equal(alltime.counts.app_open.total, 2);
});

test("a report after a flush matches the report before it", async () => {
  const { send, report, flush } = await makeDO();
  for (const envelope of SEQUENCE) await send(envelope);
  const before = await report();
  await flush();
  const after = await report();
  assert.deepEqual(after.counts, before.counts);
});

// ------------------------------------------------------------ date rollover ----

test("events either side of Israel midnight land in different day buckets", async () => {
  const { send, flush, storage } = await makeDO();
  // 22:00 UTC on the 23rd is already the 24th in Israel (UTC+3), so these two
  // timestamps are two hours apart and two Israel days apart.
  setClock(Date.UTC(2026, 8, 23, 18, 0, 0));
  const firstDay = israelDateKey(clock);
  // The first writes through (fresh instance); the second stays in the buffer, so
  // there is genuinely something pending when the day turns over.
  await send({ eventName: "app_open", params: {}, platform: "android" });
  await send({ eventName: "app_open", params: {}, platform: "android" });
  storage.resetCounters();

  setClock(Date.UTC(2026, 8, 23, 22, 0, 0));
  const secondDay = israelDateKey(clock);
  assert.notEqual(firstDay, secondDay, "precondition: the clock really did cross Israel midnight");

  // The rollover itself must persist the previous day before counting the new one.
  await send({ eventName: "game_started", params: { gameType: "shapeChallenge", category: "animals", contentKey: "cat" }, platform: "android" });
  assert.ok(storage.putCalls >= 1, "the pending buffer is flushed on rollover, not left behind today's traffic");
  assert.equal((storage.map.get(`day:${firstDay}`) as { app_open: { total: number } }).app_open.total, 2);

  await flush();
  const first = storage.map.get(`day:${firstDay}`) as Record<string, { total: number } | undefined>;
  const second = storage.map.get(`day:${secondDay}`) as Record<string, { total: number } | undefined>;
  assert.equal(first.app_open?.total, 2);
  assert.equal(first.game_started, undefined, "yesterday's bucket must not have gained today's event");
  assert.equal(second.game_started?.total, 1);
  assert.equal(second.app_open, undefined);
  assert.deepEqual(storage.map.get("days"), [firstDay, secondDay]);
  // alltime spans both, as it always has.
  const alltime = storage.map.get("alltime") as Record<string, { total: number }>;
  assert.equal(alltime.app_open.total, 2);
  assert.equal(alltime.game_started.total, 1);

  setClock(Date.UTC(2026, 8, 23, 9, 0, 0));
});

// ---------------------------------------------------------------- cold start ----

test("a new instance reloads persisted counters and keeps incrementing", async () => {
  const first = await makeDO();
  for (let i = 0; i < 3; i++) await first.send({ eventName: "app_open", params: {}, platform: "android", installationId: "aaaaaaaaaaaa", sessionId: "bbbbbbbbbbbb" });
  await first.flush();

  // Same storage contents, brand-new instance - the eviction case.
  const seed = Object.fromEntries(first.storage.map.entries());
  const second = await makeDO(seed);
  await second.send({ eventName: "app_open", params: {}, platform: "android", installationId: "aaaaaaaaaaaa", sessionId: "bbbbbbbbbbbb" });
  await second.flush();

  const dateKey = israelDateKey(clock);
  assert.equal((second.storage.map.get(`day:${dateKey}`) as Record<string, { total: number }>).app_open.total, 4);
  assert.equal((second.storage.map.get("alltime") as Record<string, { total: number }>).app_open.total, 4);
  const report = await second.report();
  assert.equal(report.counts.app_open.total, 4);
});

test("a cold instance reports persisted history before receiving any event", async () => {
  const first = await makeDO();
  await first.send({ eventName: "app_open", params: {}, platform: "android" });
  await first.flush();
  const second = await makeDO(Object.fromEntries(first.storage.map.entries()));
  const report = await second.report();
  assert.equal(report.counts.app_open.total, 1);
});

// --------------------------------------------------- concurrency around flush ----

test("an event arriving during a flush is not lost and is not marked clean", async () => {
  const { send, flush, storage, analytics } = await makeDO();
  await send({ eventName: "app_open", params: {}, platform: "android" }); // write-through
  await send({ eventName: "app_open", params: {}, platform: "android" }); // buffered

  storage.slowPut = true;
  const flushing = flush();
  // Lands while the put above is still in flight.
  await send({ eventName: "game_started", params: { gameType: "shapeChallenge", category: "animals", contentKey: "cat" }, platform: "android" });
  await flushing;
  storage.slowPut = false;

  // The interleaved event re-dirtied its keys rather than riding on a write that
  // had already been serialized, so the next flush must still pick it up.
  await analytics.alarm();

  const day = storage.map.get(`day:${israelDateKey(clock)}`) as Record<string, { total: number } | undefined>;
  assert.equal(day.app_open?.total, 2);
  assert.equal(day.game_started?.total, 1, "the mid-flush event must survive to storage");
});

test("a failed flush keeps the buffer dirty and retries on the next alarm", async () => {
  const { send, storage, analytics } = await makeDO();
  await send({ eventName: "app_open", params: {}, platform: "android" }); // write-through
  await send({ eventName: "app_open", params: {}, platform: "android" }); // buffered

  const workingPut = storage.put.bind(storage);
  storage.put = async () => {
    throw new Error("storage unavailable");
  };
  await assert.rejects(() => analytics.alarm(), /storage unavailable/);

  storage.put = workingPut;
  await analytics.alarm();
  const day = storage.map.get(`day:${israelDateKey(clock)}`) as Record<string, { total: number }>;
  assert.equal(day.app_open.total, 2, "a write that failed must not silently drop the buffer");
});

test("an instance evicted mid-buffer loses only what the budget allows", async () => {
  // The failure workerd exposed on 23 Sep 2026: the runtime drops an idle instance
  // within ~10s, and an armed alarm does not keep it resident - so anything the alarm
  // was meant to write later was already gone with the instance. Everything up to the
  // last budget boundary must therefore already be in storage, with no flush called.
  const first = await makeDO();
  // 1 write-through + four full 5-event budgets = 21 durable, 4 still buffered.
  for (let i = 0; i < 25; i++) await first.send({ eventName: "app_open", params: {}, platform: "android" });

  // Eviction: the instance and its buffer simply cease to exist. No alarm, no flush.
  const survivor = await makeDO(Object.fromEntries(first.storage.map.entries()));
  const report = await survivor.report();
  assert.equal(report.counts.app_open.total, 21, "everything up to the last budget boundary survived eviction");
});

// ----------------------------------------------------------------- rejection ----

test("invalid events are still rejected and never enter the buffer", async () => {
  const { send, storage, flush } = await makeDO();
  assert.equal((await send({ eventName: "not_a_real_event", params: {} })).status, 400);
  assert.equal((await send({ eventName: "game_started", params: { gameType: "nope" } })).status, 400);
  await flush();
  assert.equal(storage.putCalls, 0, "a rejected event must leave nothing dirty");
});

// ------------------------------------------------------ batch ingest (A4) ----
//
// Batching is transport only. The load-bearing property is that a batch entry and a
// single-event POST produce byte-identical counters, so the two endpoints can never
// drift into counting differently for a mixed population of old and new clients.

async function sendBatch(analytics: InstanceType<typeof AnalyticsDO>, events: unknown[], country = "IL") {
  return analytics.fetch(
    new Request("https://analytics.internal/events", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cydi-country": country },
      body: JSON.stringify({ events }),
    }),
  );
}

test("a batch counts exactly what the same events counted one at a time", async () => {
  const single = await makeDO();
  for (const envelope of SEQUENCE) await single.send(envelope);
  await single.flush();

  const batched = await makeDO();
  await sendBatch(batched.analytics, SEQUENCE);
  await batched.flush();

  const dateKey = israelDateKey(clock);
  assert.deepEqual(batched.storage.map.get(`day:${dateKey}`), single.storage.map.get(`day:${dateKey}`));
  assert.deepEqual(batched.storage.map.get("alltime"), single.storage.map.get("alltime"));
  assert.deepEqual(batched.storage.map.get(`usage:${dateKey}`), single.storage.map.get(`usage:${dateKey}`));
});

test("a batch of one is accepted", async () => {
  const { analytics, storage, flush } = await makeDO();
  const res = await sendBatch(analytics, [{ eventName: "app_open", params: {}, platform: "android" }]);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, accepted: 1, rejected: 0 });
  await flush();
  assert.equal((storage.map.get("alltime") as Record<string, { total: number }>).app_open.total, 1);
});

test("a full ten-event batch costs one DO request and at most one write", async () => {
  const { analytics, storage } = await makeDO();
  const events = Array.from({ length: 10 }, () => ({ eventName: "app_open", params: {}, platform: "android" }));
  storage.resetCounters();
  const res = await sendBatch(analytics, events);
  assert.deepEqual(await res.json(), { ok: true, accepted: 10, rejected: 0 });
  assert.ok(storage.putCalls <= 1, `ten events must not cost ten writes (got ${storage.putCalls})`);
});

test("a partial batch is accepted and stays buffered until a budget is due", async () => {
  const { analytics, report } = await makeDO();
  const res = await sendBatch(analytics, [
    { eventName: "app_open", params: {}, platform: "android" },
    { eventName: "app_open", params: {}, platform: "android" },
    { eventName: "app_open", params: {}, platform: "android" },
  ]);
  assert.deepEqual(await res.json(), { ok: true, accepted: 3, rejected: 0 });
  assert.equal((await report()).counts.app_open.total, 3, "still visible before it is written");
});

test("mixed valid and invalid entries keep the valid ones", async () => {
  const { analytics, report } = await makeDO();
  const res = await sendBatch(analytics, [
    { eventName: "app_open", params: {}, platform: "android" },
    { eventName: "not_a_real_event", params: {} },
    { eventName: "game_started", params: { gameType: "nope" } },
    { eventName: "app_open", params: {}, platform: "android" },
    "not even an object",
    null,
  ]);
  assert.deepEqual(await res.json(), { ok: true, accepted: 2, rejected: 4 }, "one bad entry must not cost the good ones");
  assert.equal((await report()).counts.app_open.total, 2);
});

test("a malformed batch body is rejected whole", async () => {
  const { analytics, storage } = await makeDO();
  for (const body of [{ events: "nope" }, { events: {} }, {}, { events: [] }]) {
    const res = await analytics.fetch(
      new Request("https://analytics.internal/events", {
        method: "POST",
        headers: { "content-type": "application/json", "x-cydi-country": "IL" },
        body: JSON.stringify(body),
      }),
    );
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
  }
  assert.equal(storage.putCalls, 0, "a rejected body must leave nothing dirty");
});

test("an oversized batch is rejected rather than silently truncated", async () => {
  const { analytics } = await makeDO();
  const events = Array.from({ length: 51 }, () => ({ eventName: "app_open", params: {}, platform: "android" }));
  const res = await sendBatch(analytics, events);
  assert.equal(res.status, 400);
  assert.equal((await res.json() as { error: string }).error, "batch too large");
});

test("the same batch sent twice counts twice - the client must not retry", async () => {
  // Documents WHY analyticsQueue.ts does not retry: there is no idempotency key
  // here, so a re-sent batch is indistinguishable from real activity.
  const { analytics, report } = await makeDO();
  const events = [{ eventName: "app_open", params: {}, platform: "android" }];
  await sendBatch(analytics, events);
  await sendBatch(analytics, events);
  assert.equal((await report()).counts.app_open.total, 2);
});

test("the single-event endpoint is byte-identical to before for old clients", async () => {
  const { send, flush, storage } = await makeDO();
  const res = await send({ eventName: "app_open", params: {}, platform: "android" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal((await send({ eventName: "nope", params: {} })).status, 400);
  assert.equal((await send({ eventName: "game_started", params: { gameType: "bad" } })).status, 400);
  await flush();
  assert.equal((storage.map.get("alltime") as Record<string, { total: number }>).app_open.total, 1);
});

test("old single events and new batches can interleave into the same counters", async () => {
  const { analytics, send, report } = await makeDO();
  await send({ eventName: "app_open", params: {}, platform: "android", installationId: "aaaaaaaaaaaa", sessionId: "bbbbbbbbbbbb" });
  await sendBatch(analytics, [
    { eventName: "app_open", params: {}, platform: "android", installationId: "cccccccccccc", sessionId: "dddddddddddd" },
    { eventName: "app_open", params: {}, platform: "web", installationId: "eeeeeeeeeeee", sessionId: "ffffffffffff" },
  ]);
  await send({ eventName: "app_open", params: {}, platform: "android", installationId: "aaaaaaaaaaaa", sessionId: "bbbbbbbbbbbb" });
  const daily = await report();
  assert.equal(daily.counts.app_open.total, 4);
  assert.equal(daily.usage?.installations, 3, "usage ids are recorded from both paths");
});
