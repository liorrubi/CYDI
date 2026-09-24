// Analytics load shedding - policy engine and Worker integration.
//
// The load-bearing assertions are the integration ones at the bottom: a shed request
// must cost ZERO AnalyticsDO fetches. Dropping a batch after the DO has been invoked
// saves nothing, so "the DO was never called" is the only proof that matters.
import test from "node:test";
import assert from "node:assert/strict";

const worker = (await import("./index.ts")).default;
const {
  ALWAYS_PRESERVE,
  SHED_OFF,
  decideShedding,
  effectiveShedPolicy,
  isValidAnalyticsShedConfig,
  shedEnforcementError,
} = await import("./analyticsShedding.ts");
const { ANALYTICS_BREAKER_KV_KEY, parseAnalyticsControl, isValidAnalyticsBreakerConfig, _resetAnalyticsBreakerCacheForTests } =
  await import("./analyticsBreaker.ts");
const { _resetGuardCacheForTests } = await import("./multiplayerGuard.ts");

const FUTURE = "2099-01-01T00:00:00.000Z";
const PAST = "2020-01-01T00:00:00.000Z";

/** A sheddable, high-volume gameplay event, and a must-preserve one. */
const SHEDDABLE = (n = 1) => Array.from({ length: n }, () => ({ eventName: "mp_round_completed", params: {}, platform: "android" }));
const PRESERVED = (name = "first_open") => ({ eventName: name, params: {}, platform: "android" });

const cfg = (over: Record<string, unknown> = {}) => ({ monitorOnly: true, globalMode: "NORMAL", countries: {}, ...over }) as never;
/** Deterministic dice: always keep / always shed, so sampling tests assert policy, not luck. */
const ALWAYS_KEEP = () => 0;
const ALWAYS_SHED = () => 0.999999;

test.beforeEach(() => {
  _resetAnalyticsBreakerCacheForTests();
  _resetGuardCacheForTests();
});

// ------------------------------------------------------------- classification ----

test("the preserve list holds only irreplaceable or revenue events, and no high-volume telemetry", () => {
  for (const name of ["first_open", "install_attributed", "purchase_completed", "shop_purchase_with_coins", "mp_room_created", "mp_game_started"]) {
    assert.ok(ALWAYS_PRESERVE.includes(name), `${name} must be preserved`);
  }
  // The four biggest streams by volume. Any of these creeping onto the list would
  // quietly destroy the saving, since a batch with one preserved event still costs a
  // full DO request.
  for (const name of ["mp_round_completed", "game_started", "game_completed", "shape_completed", "reward_skipped"]) {
    assert.ok(!ALWAYS_PRESERVE.includes(name), `${name} must stay sheddable`);
  }
  // A deliberate, reversible judgement call - see the comment on ALWAYS_PRESERVE.
  assert.ok(!ALWAYS_PRESERVE.includes("rewarded_ad_unavailable"));
});

// -------------------------------------------------------------- config model ----

test("an absent, malformed or wrongly-shaped config means collect everything", () => {
  for (const raw of [null, "not json", "[]", '"x"', "{}", '{"shed":{"globalMode":"EMERGENCY"}}']) {
    const control = parseAnalyticsControl(raw);
    assert.equal(control.disabled, false, `${raw} must not disable ingest`);
    assert.deepEqual(control.shed, SHED_OFF, `${raw} must shed nothing`);
  }
});

test("a broken shed block cannot take the emergency breaker down with it", () => {
  // The breaker is what someone reaches for when the account is on fire; a mistyped
  // policy beside it must not disarm it.
  const control = parseAnalyticsControl('{"disabled":true,"shed":{"globalMode":"NONSENSE"}}');
  assert.equal(control.disabled, true, "the breaker still works");
  assert.deepEqual(control.shed, SHED_OFF, "the unusable policy is ignored");
});

test("the plain breaker config stays valid forever", () => {
  assert.equal(isValidAnalyticsBreakerConfig({ disabled: true }), true);
  assert.equal(isValidAnalyticsBreakerConfig({ disabled: false }), true);
  assert.equal(parseAnalyticsControl('{"disabled":true}').disabled, true);
  // Unknown keys are still refused, so the config cannot accumulate junk.
  assert.equal(isValidAnalyticsBreakerConfig({ disabled: true, other: 1 }), false);
  assert.equal(isValidAnalyticsBreakerConfig({ shed: { monitorOnly: true, globalMode: "NORMAL", countries: {} } }), false);
});

test("the admin validator refuses a shed policy an operator mistyped", () => {
  const ok = { disabled: false, shed: { monitorOnly: true, globalMode: "ELEVATED", countries: {} } };
  assert.equal(isValidAnalyticsBreakerConfig(ok), true, "monitor-only models are unconstrained");
  for (const shed of [
    { monitorOnly: true, globalMode: "PANIC", countries: {} },
    { monitorOnly: true, globalMode: "NORMAL", countries: { ir: { mode: "EMERGENCY" } } },
    { monitorOnly: true, globalMode: "NORMAL", countries: { IR: { mode: "EMERGENCY", keepPercent: 140 } } },
    { monitorOnly: true, globalMode: "NORMAL", countries: {}, expiresAt: "soon" },
    { globalMode: "NORMAL", countries: {} },
  ]) {
    assert.equal(isValidAnalyticsBreakerConfig({ disabled: false, shed }), false, JSON.stringify(shed));
  }
});

test("live shedding must state a shed rate and an end time", () => {
  assert.equal(shedEnforcementError(cfg({ monitorOnly: true, globalMode: "ELEVATED" })), null, "monitor-only is unconstrained");

  const noPercent = shedEnforcementError(cfg({ monitorOnly: false, countries: { IR: { mode: "ELEVATED" } }, expiresAt: FUTURE }));
  assert.match(String(noPercent), /explicit keepPercent/);

  const noExpiry = shedEnforcementError(cfg({ monitorOnly: false, countries: { IR: { mode: "EMERGENCY" } } }));
  assert.match(String(noExpiry), /expiresAt/);

  assert.equal(shedEnforcementError(cfg({ monitorOnly: false, countries: { IR: { mode: "EMERGENCY" } }, expiresAt: FUTURE })), null);
  assert.equal(
    shedEnforcementError(cfg({ monitorOnly: false, countries: { IR: { mode: "ELEVATED", keepPercent: 25 } }, expiresAt: FUTURE })),
    null,
  );
  assert.equal(isValidAnalyticsShedConfig({ monitorOnly: false, globalMode: "EMERGENCY", countries: {} }), false, "validation enforces the same rules");
});

// ------------------------------------------------------------ policy resolution ----

test("a country policy applies to that country and to nobody else", () => {
  const config = cfg({ countries: { IR: { mode: "EMERGENCY" } } });
  assert.equal(effectiveShedPolicy(config, "IR").mode, "EMERGENCY");
  assert.equal(effectiveShedPolicy(config, "IR").source, "country");
  for (const other of ["DE", "US", "AZ", "IL"]) assert.equal(effectiveShedPolicy(config, other).mode, "NORMAL", other);
});

test("an unknown country is only ever affected by an explicit ZZ policy", () => {
  // "We could not tell where this came from" is not evidence that it came from the
  // country under policy.
  const targeted = cfg({ countries: { IR: { mode: "EMERGENCY" } } });
  for (const raw of [undefined, null, "XX", "T1", "", "nonsense", 42]) {
    assert.equal(effectiveShedPolicy(targeted, raw).mode, "NORMAL", String(raw));
    assert.equal(effectiveShedPolicy(targeted, raw).country, "ZZ");
  }
  assert.equal(effectiveShedPolicy(cfg({ countries: { ZZ: { mode: "EMERGENCY" } } }), undefined).mode, "EMERGENCY");
});

test("a global mode covers every country, and a country entry overrides it", () => {
  const config = cfg({ globalMode: "EMERGENCY", countries: { DE: { mode: "NORMAL" } } });
  assert.equal(effectiveShedPolicy(config, "IR").source, "global");
  assert.equal(effectiveShedPolicy(config, "IR").mode, "EMERGENCY");
  assert.equal(effectiveShedPolicy(config, "DE").mode, "NORMAL", "an explicit NORMAL exempts a country");
});

test("an expired policy lapses to NORMAL, lazily and with no write", () => {
  const config = cfg({ globalMode: "EMERGENCY", expiresAt: PAST });
  const policy = effectiveShedPolicy(config, "IR");
  assert.equal(policy.mode, "NORMAL");
  assert.equal(policy.source, "expired");
  assert.equal(effectiveShedPolicy(cfg({ globalMode: "EMERGENCY", expiresAt: FUTURE }), "IR").mode, "EMERGENCY");
});

test("EMERGENCY keeps nothing by default; ELEVATED invents no rate", () => {
  assert.equal(effectiveShedPolicy(cfg({ countries: { IR: { mode: "EMERGENCY" } } }), "IR").keepPercent, 0);
  assert.equal(effectiveShedPolicy(cfg({ countries: { IR: { mode: "EMERGENCY", keepPercent: 10 } } }), "IR").keepPercent, 10);
  // Only reachable monitor-only, since validation refuses a live ELEVATED with no rate.
  assert.equal(effectiveShedPolicy(cfg({ countries: { IR: { mode: "ELEVATED" } } }), "IR").keepPercent, 100);
});

// -------------------------------------------------------------- the decision ----

test("NORMAL forwards the body untouched and does not even look at it", () => {
  const policy = effectiveShedPolicy(SHED_OFF, "IR");
  const decision = decideShedding(policy, "/events", "this is not even json", SHED_OFF, ALWAYS_SHED);
  assert.equal(decision.action, "forward");
  assert.equal(decision.wouldDrop, false);
  assert.equal(decision.body, undefined);
});

test("a batch of only sheddable events is dropped whole", () => {
  const config = cfg({ countries: { IR: { mode: "EMERGENCY" } } });
  const policy = effectiveShedPolicy(config, "IR");
  const decision = decideShedding(policy, "/events", JSON.stringify({ events: SHEDDABLE(8) }), config, ALWAYS_SHED);
  assert.equal(decision.action, "drop");
  assert.equal(decision.wouldDrop, true);
  assert.equal(decision.dropped, 8);
  assert.equal(decision.preserved, 0);
});

test("a mixed batch keeps the must-preserve events and strips the rest", () => {
  const config = cfg({ countries: { IR: { mode: "EMERGENCY" } } });
  const policy = effectiveShedPolicy(config, "IR");
  const events = [...SHEDDABLE(4), PRESERVED("first_open"), ...SHEDDABLE(3), PRESERVED("shop_purchase_with_coins")];
  const decision = decideShedding(policy, "/events", JSON.stringify({ events }), config, ALWAYS_SHED);

  assert.equal(decision.action, "forward_filtered");
  assert.equal(decision.preserved, 2);
  assert.equal(decision.dropped, 7);
  // It still costs one DO request - the honest accounting the log line reports.
  assert.equal(decision.wouldDrop, false);
  const rewritten = JSON.parse(String(decision.body)) as { events: { eventName: string }[] };
  assert.deepEqual(
    rewritten.events.map((e) => e.eventName),
    ["first_open", "shop_purchase_with_coins"],
  );
});

test("every must-preserve event survives EMERGENCY with keepPercent 0", () => {
  const config = cfg({ countries: { IR: { mode: "EMERGENCY", keepPercent: 0 } } });
  const policy = effectiveShedPolicy(config, "IR");
  for (const name of ALWAYS_PRESERVE) {
    const decision = decideShedding(policy, "/event", JSON.stringify(PRESERVED(name)), config, ALWAYS_SHED);
    assert.equal(decision.action, "forward", `${name} must never be shed`);
    assert.equal(decision.preserved, 1);
  }
});

test("preserveExtra reverses a classification with no deploy", () => {
  const config = cfg({ countries: { IR: { mode: "EMERGENCY" } }, preserveExtra: ["mp_round_completed"] });
  const policy = effectiveShedPolicy(config, "IR");
  const decision = decideShedding(policy, "/events", JSON.stringify({ events: SHEDDABLE(3) }), config, ALWAYS_SHED);
  assert.equal(decision.action, "forward");
  assert.equal(decision.preserved, 3);
});

test("keepPercent samples the sheddable events and leaves the rest alone", () => {
  const config = cfg({ countries: { IR: { mode: "ELEVATED", keepPercent: 50 } } });
  const policy = effectiveShedPolicy(config, "IR");
  const body = JSON.stringify({ events: SHEDDABLE(6) });
  assert.equal(decideShedding(policy, "/events", body, config, ALWAYS_KEEP).action, "forward");
  assert.equal(decideShedding(policy, "/events", body, config, ALWAYS_SHED).action, "drop");

  // Alternating dice: half the sheddable events survive, so the request still goes.
  let i = 0;
  const alternating = () => (i++ % 2 === 0 ? 0 : 0.99);
  const mixed = decideShedding(policy, "/events", body, config, alternating);
  assert.equal(mixed.action, "forward_filtered");
  assert.equal(mixed.keptSampled, 3);
  assert.equal(mixed.dropped, 3);
});

test("a single-event request is shed as a whole, which is where the old clients live", () => {
  const config = cfg({ countries: { IR: { mode: "EMERGENCY" } } });
  const policy = effectiveShedPolicy(config, "IR");
  assert.equal(decideShedding(policy, "/event", JSON.stringify(SHEDDABLE(1)[0]), config, ALWAYS_SHED).action, "drop");
  assert.equal(decideShedding(policy, "/event", JSON.stringify(PRESERVED()), config, ALWAYS_SHED).action, "forward");
});

test("anything unexpected about the body forwards it untouched", () => {
  const config = cfg({ countries: { IR: { mode: "EMERGENCY" } } });
  const policy = effectiveShedPolicy(config, "IR");
  for (const body of ["", "{", "null", "[1,2,3]", "{}", '{"events":"nope"}', '{"events":[]}']) {
    const decision = decideShedding(policy, "/events", body, config, ALWAYS_SHED);
    assert.equal(decision.action, "forward", JSON.stringify(body));
    assert.equal(decision.wouldDrop, false);
  }
  // An entry with no usable name is kept rather than guessed at.
  const odd = decideShedding(policy, "/events", JSON.stringify({ events: [null, 7, { eventName: 5 }] }), config, ALWAYS_SHED);
  assert.equal(odd.action, "forward");
});

// -------------------------------------------------- Worker integration (the point) ----

class FakeKv {
  store = new Map<string, string>();
  reads = 0;
  async get(key: string, _o?: { cacheTtl?: number }): Promise<string | null> {
    this.reads++;
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

/** Counts every AnalyticsDO invocation, which is the quantity this whole feature exists to reduce. */
class FakeAnalyticsNamespace {
  fetches = 0;
  bodies: string[] = [];
  idFromName() {
    return {};
  }
  get() {
    return {
      fetch: async (_url: string, init?: { body?: unknown }) => {
        this.fetches++;
        this.bodies.push(typeof init?.body === "string" ? init.body : "<stream>");
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    };
  }
}

class FakeRoomNamespace {
  fetches = 0;
  idFromNameCalls = 0;
  idFromName(name: string) {
    this.idFromNameCalls++;
    return { name };
  }
  get() {
    return {
      fetch: async (): Promise<Response> => {
        this.fetches++;
        return new Response(JSON.stringify({ roomCode: "ABCDEF", createdAt: 1 }), { status: 200 });
      },
    };
  }
}

function makeEnv(shed?: Record<string, unknown>, disabled = false) {
  const kv = new FakeKv();
  const analytics = new FakeAnalyticsNamespace();
  const room = new FakeRoomNamespace();
  if (shed !== undefined || disabled) {
    kv.store.set(ANALYTICS_BREAKER_KV_KEY, JSON.stringify(shed === undefined ? { disabled } : { disabled, shed }));
  }
  return {
    env: {
      CONTENT_KV: kv,
      ANALYTICS_DO: analytics,
      ROOM_DO: room,
      ASSETS: { fetch: async () => new Response("asset") },
      CONTENT_ADMIN_TOKEN: "content",
      ANALYTICS_ADMIN_TOKEN: "analytics",
      GUARD_ADMIN_TOKEN: "guard",
    } as unknown as Parameters<typeof worker.fetch>[1],
    kv,
    analytics,
    room,
  };
}

function withCountry(request: Request, country: string | undefined): Request {
  if (country !== undefined) Object.defineProperty(request, "cf", { value: { country }, configurable: true });
  return request;
}
const batchReq = (country: string | undefined, events: unknown[]) =>
  withCountry(new Request("https://playcydi.com/api/analytics/events", { method: "POST", body: JSON.stringify({ events }) }), country);
const singleReq = (country: string | undefined, envelope: unknown) =>
  withCountry(new Request("https://playcydi.com/api/analytics/event", { method: "POST", body: JSON.stringify(envelope) }), country);

const emergency = (code = "IR") => ({ monitorOnly: false, globalMode: "NORMAL", countries: { [code]: { mode: "EMERGENCY" } }, expiresAt: FUTURE });

test("with no config at all, ingest behaves exactly as it does today", async () => {
  const { env, analytics } = makeEnv();
  const res = await worker.fetch(batchReq("IR", SHEDDABLE(5)), env);
  assert.equal(res.status, 200);
  assert.equal(analytics.fetches, 1);
  assert.equal(analytics.bodies[0], "<stream>", "NORMAL must not materialize the body");
});

test("a shed batch costs ZERO AnalyticsDO requests", async () => {
  const { env, analytics } = makeEnv(emergency());
  const res = await worker.fetch(batchReq("IR", SHEDDABLE(9)), env);
  assert.equal(res.status, 204, "the client must see success, so it never retries");
  assert.equal(analytics.fetches, 0, "this is the entire point: the DO was never invoked");
});

test("a batch carrying one must-preserve event still reaches the DO, filtered", async () => {
  const { env, analytics } = makeEnv(emergency());
  await worker.fetch(batchReq("IR", [...SHEDDABLE(5), PRESERVED("install_attributed")]), env);
  assert.equal(analytics.fetches, 1);
  const forwarded = JSON.parse(analytics.bodies[0]) as { events: { eventName: string }[] };
  assert.deepEqual(
    forwarded.events.map((e) => e.eventName),
    ["install_attributed"],
  );
});

test("a country under no policy is completely untouched while another is shed", async () => {
  const { env, analytics } = makeEnv(emergency("IR"));
  for (const country of ["DE", "US", "AZ", undefined]) {
    await worker.fetch(batchReq(country, SHEDDABLE(5)), env);
  }
  assert.equal(analytics.fetches, 4, "every non-targeted country still ingests");
  assert.ok(
    analytics.bodies.every((b) => b === "<stream>"),
    "and streams, never re-serialized",
  );
});

test("monitor-only measures and never drops", async () => {
  const { env, analytics } = makeEnv({ monitorOnly: true, globalMode: "NORMAL", countries: { IR: { mode: "EMERGENCY" } } });
  const res = await worker.fetch(batchReq("IR", SHEDDABLE(9)), env);
  assert.equal(res.status, 200);
  assert.equal(analytics.fetches, 1, "monitor-only must cost exactly what today costs");
  const forwarded = JSON.parse(analytics.bodies[0]) as { events: unknown[] };
  assert.equal(forwarded.events.length, 9, "and forward the ORIGINAL body, unfiltered");
});

test("the breaker still wins outright, and shedding cannot re-open it", async () => {
  const { env, analytics } = makeEnv({ monitorOnly: true, globalMode: "NORMAL", countries: {} }, true);
  const res = await worker.fetch(batchReq("DE", [PRESERVED("first_open")]), env);
  assert.equal(res.status, 204);
  assert.equal(analytics.fetches, 0);
});

test("both levers come from ONE cached KV read, not one per request", async () => {
  const { env, kv, analytics } = makeEnv(emergency());
  for (let i = 0; i < 25; i++) await worker.fetch(batchReq("IR", SHEDDABLE(3)), env);
  assert.equal(kv.reads, 1, "25 ingest requests, one KV read");
  assert.equal(analytics.fetches, 0);
});

test("an expired policy stops shedding with no deploy and no write", async () => {
  const { env, analytics } = makeEnv({ monitorOnly: false, globalMode: "EMERGENCY", countries: {}, expiresAt: PAST });
  await worker.fetch(batchReq("IR", SHEDDABLE(4)), env);
  assert.equal(analytics.fetches, 1);
  assert.equal(analytics.bodies[0], "<stream>");
});

test("a KV outage cannot stop analytics", async () => {
  const { env, analytics } = makeEnv(emergency());
  (env as unknown as { CONTENT_KV: { get: () => Promise<string> } }).CONTENT_KV = {
    get: async () => {
      throw new Error("kv down");
    },
  };
  const res = await worker.fetch(batchReq("IR", SHEDDABLE(4)), env);
  assert.equal(res.status, 200);
  assert.equal(analytics.fetches, 1, "fail-open: a lookup failure must never shed");
});

test("single-event ingest from an old client is shed the same way", async () => {
  const { env, analytics } = makeEnv(emergency());
  assert.equal((await worker.fetch(singleReq("IR", SHEDDABLE(1)[0]), env)).status, 204);
  assert.equal(analytics.fetches, 0);
  assert.equal((await worker.fetch(singleReq("IR", PRESERVED()), env)).status, 200);
  assert.equal(analytics.fetches, 1, "the preserved one still gets through");
});

test("shedding never touches multiplayer", async () => {
  // Same emergency config, live. Room creation and /ws must not notice.
  const { env, room } = makeEnv(emergency());
  const create = await worker.fetch(withCountry(new Request("https://playcydi.com/api/room", { method: "POST" }), "IR"), env);
  assert.equal(create.status, 201, "Play Together is a different guard and a different namespace");
  assert.equal(room.fetches, 1);
});

test("no client-visible failure, whatever the mode", async () => {
  for (const shed of [undefined, emergency(), { monitorOnly: true, globalMode: "EMERGENCY", countries: {} }]) {
    const { env } = makeEnv(shed as Record<string, unknown> | undefined);
    const res = await worker.fetch(batchReq("IR", [...SHEDDABLE(3), PRESERVED()]), env);
    assert.ok(res.status === 200 || res.status === 204, `status ${res.status} must read as success to the client`);
  }
});
