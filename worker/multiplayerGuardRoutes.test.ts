// Multiplayer cost guard, Phase 1 - Worker integration.
//
// The guard module's own tests cover decisions. These cover the thing that actually
// matters operationally: that wiring it in changed nothing. Room creation must behave
// exactly as before, /ws must be untouched, and evaluating a policy that says
// would_reject must still cost the same number of RoomDO requests as no policy at all.
import test from "node:test";
import assert from "node:assert/strict";

const worker = (await import("./index.ts")).default;
const { MULTIPLAYER_GUARD_KV_KEY, _resetGuardCacheForTests } = await import("./multiplayerGuard.ts");

const TOKEN = "guard-test-token";

class FakeKv {
  store = new Map<string, string>();
  reads = 0;
  writes = 0;
  async get(key: string, _o?: { cacheTtl?: number }): Promise<string | null> {
    this.reads++;
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.writes++;
    this.store.set(key, value);
  }
}

/** Counts every RoomDO addressing and fetch, which is the cost the guard must not add to. */
class FakeRoomNamespace {
  idFromNameCalls = 0;
  fetches = 0;
  idFromName(name: string) {
    this.idFromNameCalls++;
    return { name };
  }
  get(_id: unknown) {
    return {
      fetch: async (): Promise<Response> => {
        this.fetches++;
        return new Response(JSON.stringify({ roomCode: "ABC123", createdAt: 1 }), { status: 200 });
      },
    };
  }
}

function makeEnv(kv = new FakeKv(), room = new FakeRoomNamespace()) {
  return {
    env: {
      CONTENT_KV: kv,
      ROOM_DO: room,
      ANALYTICS_DO: { idFromName: () => ({}), get: () => ({ fetch: async () => new Response("{}") }) },
      ASSETS: { fetch: async () => new Response("asset") },
      CONTENT_ADMIN_TOKEN: TOKEN,
      ANALYTICS_ADMIN_TOKEN: TOKEN,
    } as unknown as Parameters<typeof worker.fetch>[1],
    kv,
    room,
  };
}

const admin = { authorization: `Bearer ${TOKEN}` };
const createReq = (country = "IR") =>
  new Request("https://playcydi.com/api/room", { method: "POST", cf: { country } } as RequestInit & { cf: unknown });

const validConfig = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ monitorOnly: true, globalMode: "NORMAL", countries: {}, ...over });

test.beforeEach(() => _resetGuardCacheForTests());

// ------------------------------------------------------------------- auth ----

test("every guard endpoint is admin-only", async () => {
  const { env } = makeEnv();
  for (const [method, path] of [
    ["GET", "/api/config/multiplayer-guard"],
    ["PUT", "/api/config/multiplayer-guard"],
    ["GET", "/api/config/multiplayer-guard/status"],
  ] as const) {
    const res = await worker.fetch(new Request(`https://playcydi.com${path}`, { method, body: method === "PUT" ? "{}" : undefined }), env);
    assert.equal(res.status, 401, `${method} ${path} must require the admin token`);
  }
});

test("there is no public read of the country policy", async () => {
  const { env, kv } = makeEnv();
  kv.store.set(MULTIPLAYER_GUARD_KV_KEY, validConfig({ countries: { IR: { mode: "EMERGENCY" } } }));
  const res = await worker.fetch(new Request("https://playcydi.com/api/config/multiplayer-guard/status"), env);
  assert.equal(res.status, 401);
  assert.equal((await res.text()).includes("IR"), false, "an unauthenticated caller must learn nothing about the policy");
});

// ------------------------------------------------------------------ config ----

test("PUT stores a valid config and stamps activatedAt plus history", async () => {
  const { env, kv } = makeEnv();
  const body = validConfig({ countries: { IR: { mode: "ELEVATED", createAllowPercent: 50 } }, reason: "busy evening sample" });
  const res = await worker.fetch(
    new Request("https://playcydi.com/api/config/multiplayer-guard", { method: "PUT", headers: admin, body }), env);
  assert.equal(res.status, 200);
  const stored = JSON.parse(kv.store.get(MULTIPLAYER_GUARD_KV_KEY)!);
  assert.equal(stored.countries.IR.mode, "ELEVATED");
  assert.ok(stored.activatedAt, "activatedAt is stamped by the server, not the operator");
  assert.equal(stored.history.length, 1);
  assert.equal(stored.history[0].reason, "busy evening sample");
});

test("a malformed PUT is rejected and does NOT replace the stored config", async () => {
  const { env, kv } = makeEnv();
  kv.store.set(MULTIPLAYER_GUARD_KV_KEY, validConfig({ countries: { IR: { mode: "ELEVATED" } } }));
  const before = kv.store.get(MULTIPLAYER_GUARD_KV_KEY);
  for (const bad of ['{"globalMode":"PANIC"}', "{", JSON.stringify({ monitorOnly: true }), JSON.stringify({ monitorOnly: true, globalMode: "NORMAL", countries: { ir: { mode: "ELEVATED" } } })]) {
    const res = await worker.fetch(
      new Request("https://playcydi.com/api/config/multiplayer-guard", { method: "PUT", headers: admin, body: bad }), env);
    assert.equal(res.status, 400, `expected 400 for ${bad}`);
  }
  assert.equal(kv.store.get(MULTIPLAYER_GUARD_KV_KEY), before, "the previous policy must stand");
});

test("GET reports the effective config and flags an unusable stored value", async () => {
  const { env, kv } = makeEnv();
  kv.store.set(MULTIPLAYER_GUARD_KV_KEY, "{not json");
  const res = await worker.fetch(new Request("https://playcydi.com/api/config/multiplayer-guard", { headers: admin }), env);
  const body = (await res.json()) as { storedValid: boolean; config: { globalMode: string } };
  assert.equal(body.storedValid, false, "an operator must be told their policy is not being applied");
  assert.equal(body.config.globalMode, "NORMAL");
});

// ------------------------------------------------------------------ status ----

test("status reports effective per-country modes, expiry and monitorOnly", async () => {
  const { env, kv } = makeEnv();
  kv.store.set(MULTIPLAYER_GUARD_KV_KEY, validConfig({
    countries: { IR: { mode: "EMERGENCY" }, DE: { mode: "ELEVATED", createAllowPercent: 25 } },
    expiresAt: "2099-01-01T00:00:00Z",
    reason: "sample",
  }));
  const res = await worker.fetch(new Request("https://playcydi.com/api/config/multiplayer-guard/status", { headers: admin }), env);
  const s = (await res.json()) as Record<string, unknown>;
  assert.equal(res.status, 200);
  assert.equal(s.monitorOnly, true);
  assert.equal(s.enforcing, false, "status must state plainly that nothing is being enforced");
  assert.equal(s.expired, false);
  const countries = s.countries as Record<string, { effectiveMode: string; createAllowPercent: number }>;
  assert.equal(countries.IR.effectiveMode, "EMERGENCY");
  assert.equal(countries.DE.createAllowPercent, 25);
});

test("status shows an expired policy as lapsed to NORMAL", async () => {
  const { env, kv } = makeEnv();
  kv.store.set(MULTIPLAYER_GUARD_KV_KEY, validConfig({
    globalMode: "EMERGENCY", countries: { IR: { mode: "EMERGENCY" } }, expiresAt: "2020-01-01T00:00:00Z",
  }));
  const res = await worker.fetch(new Request("https://playcydi.com/api/config/multiplayer-guard/status", { headers: admin }), env);
  const s = (await res.json()) as Record<string, unknown>;
  assert.equal(s.expired, true);
  assert.equal(s.effectiveGlobalMode, "NORMAL");
  assert.equal((s.countries as Record<string, { effectiveMode: string }>).IR.effectiveMode, "NORMAL");
});

// -------------------------------------------- room creation is unchanged ----

test("room creation succeeds with no guard config at all", async () => {
  const { env, room } = makeEnv();
  const res = await worker.fetch(createReq(), env);
  assert.equal(res.status, 201);
  const body = (await res.json()) as { roomCode: string };
  // The code is generated by the Worker, not the DO, so it differs per call.
  assert.match(body.roomCode, /^[A-Z0-9]{6}$/);
  assert.equal(room.fetches, 1);
});

test("a would_reject policy still creates the room, at identical RoomDO cost", async () => {
  // The whole of phase 1 in one assertion: an EMERGENCY policy on the caller's
  // country changes the decision and nothing else - same status, same body, same
  // number of RoomDO requests as an unguarded creation.
  const baseline = makeEnv();
  const unguarded = await worker.fetch(createReq("IR"), baseline.env);
  const unguardedBody = (await unguarded.json()) as { roomCode: string };

  _resetGuardCacheForTests();
  const guarded = makeEnv();
  guarded.kv.store.set(MULTIPLAYER_GUARD_KV_KEY, validConfig({ countries: { IR: { mode: "EMERGENCY" } } }));
  const res = await worker.fetch(createReq("IR"), guarded.env);

  const guardedBody = (await res.json()) as { roomCode: string };
  assert.equal(res.status, unguarded.status, "status must be identical");
  assert.deepEqual(Object.keys(guardedBody), Object.keys(unguardedBody), "body shape must be identical");
  assert.match(guardedBody.roomCode, /^[A-Z0-9]{6}$/, "a real room code is still issued");
  assert.equal(guarded.room.fetches, baseline.room.fetches, "the guard must add no RoomDO request");
  assert.equal(guarded.room.idFromNameCalls, baseline.room.idFromNameCalls, "and no extra DO addressing");
});

test("an ELEVATED 0% policy still creates the room", async () => {
  const { env, room } = makeEnv();
  env.CONTENT_KV.store.set(MULTIPLAYER_GUARD_KV_KEY, validConfig({ countries: { IR: { mode: "ELEVATED", createAllowPercent: 0 } } }));
  const res = await worker.fetch(createReq("IR"), env);
  assert.equal(res.status, 201);
  assert.equal(room.fetches, 1);
});

test("an unconfigured country is untouched while another is under policy", async () => {
  const { env } = makeEnv();
  env.CONTENT_KV.store.set(MULTIPLAYER_GUARD_KV_KEY, validConfig({ countries: { IR: { mode: "EMERGENCY" } } }));
  assert.equal((await worker.fetch(createReq("DE"), env)).status, 201);
});

test("creation succeeds when the request carries no country at all", async () => {
  const { env } = makeEnv();
  env.CONTENT_KV.store.set(MULTIPLAYER_GUARD_KV_KEY, validConfig({ globalMode: "EMERGENCY" }));
  const res = await worker.fetch(new Request("https://playcydi.com/api/room", { method: "POST" }), env);
  assert.equal(res.status, 201);
});

test("telemetry failure cannot break room creation", async () => {
  const { env } = makeEnv();
  const realLog = console.log;
  console.log = () => {
    throw new Error("logging exploded");
  };
  try {
    const res = await worker.fetch(createReq("IR"), env);
    assert.equal(res.status, 201, "a broken monitor must never cost a player their game");
  } finally {
    console.log = realLog;
  }
});

test("a KV outage cannot break room creation", async () => {
  const { env } = makeEnv();
  (env.CONTENT_KV as unknown as FakeKv).get = async () => {
    throw new Error("kv down");
  };
  assert.equal((await worker.fetch(createReq("IR"), env)).status, 201);
});

test("repeated creations cost one KV read, not one per room", async () => {
  const { env, kv } = makeEnv();
  kv.store.set(MULTIPLAYER_GUARD_KV_KEY, validConfig({ countries: { IR: { mode: "EMERGENCY" } } }));
  kv.reads = 0;
  for (let i = 0; i < 25; i++) await worker.fetch(createReq("IR"), env);
  assert.equal(kv.reads, 1, "a KV read per room would trade the DO quota for the KV quota");
});

// ------------------------------------------------------------------- /ws ----

test("the /ws route is untouched by the guard", async () => {
  // Phase 1 deliberately leaves the socket path alone: a refused upgrade reconnects
  // about every 15s forever, which would move load onto the Workers quota.
  const { env, kv, room } = makeEnv();
  kv.store.set(MULTIPLAYER_GUARD_KV_KEY, validConfig({ countries: { IR: { mode: "EMERGENCY" } } }));
  kv.reads = 0;
  const res = await worker.fetch(
    new Request("https://playcydi.com/api/room/ABCDEF/ws", { cf: { country: "IR" } } as RequestInit & { cf: unknown }), env);
  assert.equal(res.status, 200, "forwarded to RoomDO exactly as before");
  assert.equal(room.fetches, 1);
  assert.equal(kv.reads, 0, "the guard is not consulted on the socket path at all");
});

test("the /info route is untouched by the guard", async () => {
  const { env, kv, room } = makeEnv();
  kv.store.set(MULTIPLAYER_GUARD_KV_KEY, validConfig({ countries: { IR: { mode: "EMERGENCY" } } }));
  kv.reads = 0;
  const res = await worker.fetch(
    new Request("https://playcydi.com/api/room/ABCDEF/info", { cf: { country: "IR" } } as RequestInit & { cf: unknown }), env);
  assert.equal(res.status, 200);
  assert.equal(room.fetches, 1);
  assert.equal(kv.reads, 0);
});
