// Exact-event dedup by client eventId (AnalyticsDO, analyticsEventDedup.ts).
//
// What must hold:
//  1. New ids are counted once; the seen mark is persisted in the same put as the count.
//  2. A duplicate delivery (later request, same batch, after a hibernation, on /event) is
//     answered 2xx and never counted twice; the request itself still counts as a request.
//  3. No eventId, or a malformed one: counted exactly as today, no `seen:` key touched.
//  4. Retention: ids expire after DEDUP_RETENTION_DAYS; expired days are deleted.
//  5. Bounded: a full day stops recording (fail-open) instead of growing past the cap.
//  6. The Worker forwards eventId untouched on both the Phase 2 and today's route.
import test from "node:test";
import assert from "node:assert/strict";
import { israelDateKey } from "../src/app/israelDate.ts";

const { AnalyticsDO } = await import("./analyticsDO.ts");
const { handleAnalyticsEvent } = await import("./index.ts");
const { _resetAnalyticsBreakerCacheForTests } = await import("./analyticsBreaker.ts");
const { normalizeEventId, containsEventId, retentionCutoff, DEDUP_RETENTION_DAYS, MAX_SEEN_IDS_PER_DAY, SEEN_INDEX_KEY, seenStorageKey } = await import("./analyticsEventDedup.ts");

const ID_A = "0123456789abcdef01234567";
const ID_B = "fedcba9876543210fedcba98";
const ID_C = "aaaaaaaaaaaaaaaaaaaaaaaa";
const env1 = (eventName: string, params: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ eventName, params, platform: "android", appVersion: "0.54.0", installationId: "inst-1", sessionId: "sess-1", ...extra });
const appOpen = (eventId?: unknown) => env1("app_open", {}, eventId === undefined ? {} : { eventId });
const firstOpen = (eventId?: unknown) => env1("first_open", { installAge: "h0_24" }, eventId === undefined ? {} : { eventId });

class FakeStorage {
  map = new Map<string, unknown>();
  reads: string[] = [];
  puts: string[][] = [];
  failNextPut = false;
  async get<T>(k: string | string[]): Promise<unknown> {
    this.reads.push(...(Array.isArray(k) ? k : [k]));
    if (Array.isArray(k)) return new Map(k.filter((x) => this.map.has(x)).map((x) => [x, structuredClone(this.map.get(x)) as T]));
    return this.map.has(k) ? structuredClone(this.map.get(k)) : undefined;
  }
  async put(entries: Record<string, unknown>): Promise<void> {
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error("storage unavailable");
    }
    this.puts.push(Object.keys(entries));
    for (const [key, value] of Object.entries(entries)) this.map.set(key, structuredClone(value));
  }
  async delete(keys: string[]): Promise<void> {
    for (const k of keys) this.map.delete(k);
  }
  async deleteAlarm(): Promise<void> {}
}
class FakeState {
  storage: FakeStorage;
  ready: Promise<unknown> = Promise.resolve();
  constructor(storage: FakeStorage) {
    this.storage = storage;
  }
  blockConcurrencyWhile(fn: () => Promise<unknown>) {
    this.ready = fn();
    return this.ready;
  }
}
/** A fresh instance over the same storage == the next request after a hibernation. */
async function instance(storage: FakeStorage) {
  const state = new FakeState(storage);
  const obj = new AnalyticsDO(state as unknown as DurableObjectState, { ANALYTICS_ADMIN_TOKEN: "t" });
  await state.ready;
  return obj;
}
type Obj = InstanceType<typeof AnalyticsDO>;
const post = async (obj: Obj, route: string, body: unknown) => {
  const r = await obj.fetch(new Request(`https://analytics.internal${route}`, { method: "POST", headers: { "x-cydi-country": "DE", "x-cydi-shed-keep": "100" }, body: JSON.stringify(body) }));
  return { status: r.status, body: (await r.json()) as { ok?: boolean; accepted?: number; rejected?: number; duplicates?: number; error?: string } };
};
const ledger = (obj: Obj, events: unknown[]) => post(obj, "/ledger", { events });
const today = () => israelDateKey(Date.now());
const day = (storage: FakeStorage) => (storage.map.get(`day:${today()}`) as Record<string, { total: number }> | undefined) ?? {};
const total = (storage: FakeStorage, event: string) => day(storage)[event]?.total ?? 0;
const alltime = (storage: FakeStorage, event: string) => ((storage.map.get("alltime") as Record<string, { total: number }> | undefined)?.[event]?.total) ?? 0;
const seenKeys = (storage: FakeStorage) => [...storage.map.keys()].filter((k) => k.startsWith("seen:"));

// ------------------------------------------------------------------ helpers ----

test("eventId format: only 24 lowercase hex; aligned matches only; retention window spans months", () => {
  assert.equal(normalizeEventId(ID_A), ID_A);
  for (const bad of [undefined, null, 42, "", ID_A.toUpperCase(), ID_A.slice(1), ID_A + "0", "g".repeat(24), { id: ID_A }]) assert.equal(normalizeEventId(bad), null);
  assert.equal(containsEventId(ID_A + ID_B, ID_B), true);
  // ID_B's tail + ID_A's head must not look like an id straddling two entries.
  const straddle = (ID_B + ID_A).slice(12, 36);
  assert.equal(containsEventId(ID_B + ID_A, straddle), false);
  assert.equal(retentionCutoff("2026-10-03"), "2026-09-27");
  assert.equal(retentionCutoff("2026-03-01", 7), "2026-02-23");
  assert.equal(DEDUP_RETENTION_DAYS, 7);
});

// ------------------------------------------------------------ new + duplicate ----

test("new ids are counted once, and the seen mark lands in the SAME put as the counters", async () => {
  const storage = new FakeStorage();
  const obj = await instance(storage);
  const r = await ledger(obj, [appOpen(ID_A), firstOpen(ID_B)]);
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.accepted, r.body.rejected, r.body.duplicates], [2, 0, undefined]);
  assert.equal(total(storage, "app_open"), 1);
  assert.equal(total(storage, "first_open"), 1);
  assert.equal(storage.map.get(seenStorageKey(today())), ID_A + ID_B);
  assert.deepEqual(storage.map.get(SEEN_INDEX_KEY), [today()]);
  const put = storage.puts.at(-1)!;
  assert.ok(put.includes(`day:${today()}`) && put.includes(seenStorageKey(today())), "count and seen mark persisted atomically together");
});

test("the same batch delivered twice (the Stage-0 kill race) counts once; the resend is a normal 200", async () => {
  const storage = new FakeStorage();
  const obj = await instance(storage);
  const batch = [appOpen(ID_A), appOpen(ID_B), firstOpen(ID_C)];
  await ledger(obj, batch);
  const again = await ledger(obj, batch);
  assert.equal(again.status, 200);
  assert.equal(again.body.ok, true);
  assert.deepEqual([again.body.accepted, again.body.rejected, again.body.duplicates], [3, 0, 3], "accepted, so the client never resends it");
  assert.equal(total(storage, "app_open"), 2);
  assert.equal(total(storage, "first_open"), 1);
  assert.equal(alltime(storage, "app_open"), 2, "since-launch totals are protected too");
  assert.equal(total(storage, "analytics_requests"), 2, "the duplicate request is still counted as a request");
});

test("a resend that mixes old and new ids counts only the new ones", async () => {
  const storage = new FakeStorage();
  const obj = await instance(storage);
  await ledger(obj, [appOpen(ID_A)]);
  const r = await ledger(obj, [appOpen(ID_A), appOpen(ID_B)]);
  assert.deepEqual([r.body.accepted, r.body.duplicates], [2, 1]);
  assert.equal(total(storage, "app_open"), 2);
});

test("the same id twice inside one batch counts once", async () => {
  const storage = new FakeStorage();
  const obj = await instance(storage);
  const r = await ledger(obj, [appOpen(ID_A), appOpen(ID_A)]);
  assert.deepEqual([r.body.accepted, r.body.duplicates], [2, 1]);
  assert.equal(total(storage, "app_open"), 1);
});

test("dedup survives a hibernation: a resend to a fresh instance is still recognised", async () => {
  const storage = new FakeStorage();
  await ledger(await instance(storage), [appOpen(ID_A)]);
  const r = await ledger(await instance(storage), [appOpen(ID_A)]);
  assert.equal(r.body.duplicates, 1);
  assert.equal(total(storage, "app_open"), 1);
});

test("single-event route and today's buffered /events route dedup too (exact-ledger rollback path)", async () => {
  const storage = new FakeStorage();
  const obj = await instance(storage);
  const a = await post(obj, "/event", appOpen(ID_A));
  const b = await post(obj, "/event", appOpen(ID_A));
  assert.deepEqual([a.status, b.status, b.body.ok], [200, 200, true], "a duplicate single event is never a 400");
  const c = await post(obj, "/events", { events: [appOpen(ID_A), appOpen(ID_B)] });
  assert.deepEqual([c.status, c.body.accepted, c.body.duplicates], [200, 2, 1]);
  await ledger(obj, [firstOpen()]); // durable flush of everything buffered above
  assert.equal(total(storage, "app_open"), 2, "ID_A once, ID_B once, across /event, /events and a resend");
});

test("a failed put never double counts: retry on the same instance or after a hibernation counts once", async () => {
  // Same instance: the failed keys stay dirty, the retry is a duplicate in memory, the next flush persists one count.
  const s1 = new FakeStorage();
  const o1 = await instance(s1);
  s1.failNextPut = true;
  await assert.rejects(ledger(o1, [appOpen(ID_A)]));
  const retry = await ledger(o1, [appOpen(ID_A)]);
  assert.equal(retry.status, 200);
  assert.equal(total(s1, "app_open"), 1);
  assert.equal(s1.map.get(seenStorageKey(today())), ID_A);
  // Hibernation after the failure: memory (count AND seen mark) is gone together, so the retry counts once.
  const s2 = new FakeStorage();
  s2.failNextPut = true;
  await assert.rejects(ledger(await instance(s2), [appOpen(ID_A)]));
  await ledger(await instance(s2), [appOpen(ID_A)]);
  assert.equal(total(s2, "app_open"), 1);
});

// ---------------------------------------------------------------- legacy ----

test("legacy clients (no eventId) behave exactly as today: every delivery counts, no seen key read or written", async () => {
  const storage = new FakeStorage();
  const obj = await instance(storage);
  await ledger(obj, [appOpen(), firstOpen()]);
  await post(obj, "/event", appOpen());
  const r = await ledger(obj, [appOpen(), firstOpen()]); // durable: persists the buffered /event too
  assert.deepEqual([r.body.accepted, r.body.duplicates], [2, undefined], "no duplicates field for legacy traffic");
  assert.equal(total(storage, "app_open"), 3);
  assert.equal(total(storage, "first_open"), 2);
  assert.deepEqual(seenKeys(storage), []);
  assert.equal(storage.reads.some((k) => k.startsWith("seen:")), false, "legacy traffic pays no extra storage read");
});

test("a malformed eventId is treated as no id: counted every time, never stored", async () => {
  const storage = new FakeStorage();
  const obj = await instance(storage);
  for (const bad of [ID_A.toUpperCase(), "short", 123456789012]) {
    await ledger(obj, [appOpen(bad)]);
    await ledger(obj, [appOpen(bad)]);
  }
  assert.equal(total(storage, "app_open"), 6);
  assert.deepEqual(seenKeys(storage), []);
});

test("an invalid envelope carrying an id is rejected and does not burn the id", async () => {
  const storage = new FakeStorage();
  const obj = await instance(storage);
  const bad = await ledger(obj, [firstOpen(ID_A), { ...firstOpen(ID_A), params: { installAge: "bogus" } }].reverse());
  assert.deepEqual([bad.body.accepted, bad.body.rejected, bad.body.duplicates], [1, 1, undefined], "the valid copy is still counted");
  assert.equal(total(storage, "first_open"), 1);
});

// ------------------------------------------------------------- retention ----

const shiftDays = (dateKey: string, delta: number) => {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
};

test("retention: an id from 6 days ago is still a duplicate; one from 7+ days ago counts again and its day is deleted", async () => {
  const storage = new FakeStorage();
  const inWindow = shiftDays(today(), -(DEDUP_RETENTION_DAYS - 1));
  const expired = shiftDays(today(), -DEDUP_RETENTION_DAYS);
  storage.map.set(SEEN_INDEX_KEY, [expired, inWindow]);
  storage.map.set(seenStorageKey(expired), ID_A);
  storage.map.set(seenStorageKey(inWindow), ID_B);
  const obj = await instance(storage);
  const r = await ledger(obj, [appOpen(ID_A), appOpen(ID_B)]);
  assert.deepEqual([r.body.accepted, r.body.duplicates], [2, 1]);
  assert.equal(total(storage, "app_open"), 1, "only the expired id counted again");
  assert.equal(storage.map.has(seenStorageKey(expired)), false, "expired day deleted");
  assert.deepEqual(storage.map.get(SEEN_INDEX_KEY), [inWindow, today()]);
});

test("bounded: a day at MAX_SEEN_IDS_PER_DAY stops recording (fail-open) and never grows", async () => {
  const storage = new FakeStorage();
  const full = "0".repeat(24 * MAX_SEEN_IDS_PER_DAY);
  storage.map.set(SEEN_INDEX_KEY, [today()]);
  storage.map.set(seenStorageKey(today()), full);
  const obj = await instance(storage);
  await ledger(obj, [appOpen(ID_A)]);
  await ledger(obj, [appOpen(ID_A)]);
  assert.equal(total(storage, "app_open"), 2, "counted as today once the day is full");
  assert.equal((storage.map.get(seenStorageKey(today())) as string).length, full.length);
  assert.ok(full.length <= 1.5 * 1024 * 1024, "well under the 2 MB value limit");
});

// ---------------------------------------------------- Worker passthrough ----

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
  bodies: { path: string; body: string }[] = [];
  idFromName(name: string) {
    return { name };
  }
  get() {
    return {
      fetch: async (url: string, init: RequestInit) => {
        const body = init.body instanceof ReadableStream ? await new Response(init.body).text() : String(init.body ?? "");
        this.bodies.push({ path: new URL(url).pathname, body });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    };
  }
}

test("the Worker forwards eventId untouched on the Phase 2 /ledger route and on today's /events route", async () => {
  for (const control of [{ disabled: false, exactLedger: { enabled: true } }, { disabled: false }]) {
    _resetAnalyticsBreakerCacheForTests();
    const analytics = new RecordingDo();
    const env = { CONTENT_KV: new FakeKv(JSON.stringify(control)), ANALYTICS_DO: analytics, ANALYTICS_AE: { writeDataPoint() {} } } as unknown as Parameters<typeof handleAnalyticsEvent>[1];
    const request = new Request("https://playcydi.com/api/analytics/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events: [appOpen(ID_A), appOpen()] }) });
    const res = await handleAnalyticsEvent(request, env, "/events", { waitUntil: () => {} });
    assert.ok(res.status >= 200 && res.status < 300);
    assert.equal(analytics.bodies.length, 1);
    const forwarded = JSON.parse(analytics.bodies[0].body).events as { eventId?: string }[];
    assert.deepEqual(forwarded.map((e) => e.eventId), [ID_A, undefined], `${analytics.bodies[0].path}: id kept, legacy envelope unchanged`);
  }
});
