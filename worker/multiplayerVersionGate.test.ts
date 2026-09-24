// The minimum-version gate on /api/room, /info and /ws: OFF by default, enforced
// before any RoomDO is addressed, Android-only, and read from KV at most once per
// cache window rather than per room operation.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

const worker = (await import("./index.ts")).default;
const { _resetVersionGateCacheForTests } = await import("./multiplayerVersionGate.ts");
const { _resetGuardCacheForTests } = await import("./multiplayerGuard.ts");
const { MP_VERSION_GATE_KV_KEY, MP_UPDATE_REQUIRED_CLOSE_CODE } = await import("../src/multiplayer/versionGate.ts");

class FakeKv {
  store = new Map<string, string>();
  reads = new Map<string, number>();
  async get(key: string): Promise<string | null> {
    this.reads.set(key, (this.reads.get(key) ?? 0) + 1);
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

class FakeRoomNamespace {
  fetches = 0;
  idFromName(name: string) {
    return { name };
  }
  get() {
    return {
      fetch: async (): Promise<Response> => {
        this.fetches++;
        return new Response(JSON.stringify({ roomCode: "ABC234", phase: "LOBBY", players: 1, maxPlayers: 8, joinable: true, serverNow: 0 }), { status: 200 });
      },
    };
  }
}

function makeEnv(gate?: object) {
  const kv = new FakeKv();
  if (gate) kv.store.set(MP_VERSION_GATE_KV_KEY, JSON.stringify(gate));
  const room = new FakeRoomNamespace();
  return { kv, room, env: { CONTENT_KV: kv, ROOM_DO: room } as never };
}

const post = (q: string, headers: Record<string, string> = {}) => new Request(`https://playcydi.com/api/room${q}`, { method: "POST", headers });
const info = (q: string, headers: Record<string, string> = {}) => new Request(`https://playcydi.com/api/room/ABC234/info${q}`, { headers });

beforeEach(() => {
  _resetVersionGateCacheForTests();
  _resetGuardCacheForTests();
});

test("no gate config: every client, including a pre-0.53.0 build, proceeds to the room", async () => {
  const { env, room } = makeEnv();
  assert.equal((await worker.fetch(post(""), env)).status, 201);
  assert.equal((await worker.fetch(info(""), env)).status, 200);
  assert.ok(room.fetches >= 2);
});

test("gate explicitly OFF behaves exactly like no gate", async () => {
  const { env } = makeEnv({ enabled: false, minAndroidVersionCode: 999 });
  assert.equal((await worker.fetch(post("?pf=android&avc=1"), env)).status, 201);
});

test("gate ON: an outdated Android build gets 426 multiplayer_update_required and no RoomDO is touched", async () => {
  const { env, room } = makeEnv({ enabled: true, minAndroidVersionCode: 48 });
  for (const req of [post("?pf=android&av=0.53.0&avc=47"), post(""), info("?pf=android&avc=45"), info("", { origin: "https://localhost" })]) {
    const res = await worker.fetch(req, env);
    assert.equal(res.status, 426);
    assert.equal(((await res.json()) as { code: string }).code, "multiplayer_update_required");
  }
  assert.equal(room.fetches, 0, "refused before any RoomDO request");
});

test("gate ON: current Android and every web client proceed", async () => {
  const { env, room } = makeEnv({ enabled: true, minAndroidVersionCode: 48 });
  assert.equal((await worker.fetch(post("?pf=android&av=0.53.0&avc=48"), env)).status, 201);
  assert.equal((await worker.fetch(post("?pf=web&av=0.52.1"), env)).status, 201);
  assert.equal((await worker.fetch(post("", { "sec-fetch-site": "same-origin" }), env)).status, 201, "an old web tab");
  assert.ok(room.fetches >= 3);
});

test("gate ON: an outdated /ws upgrade is accepted and closed with 4426, never forwarded", async () => {
  const { env, room } = makeEnv({ enabled: true, minAndroidVersionCode: 48 });
  const closed: { code: number; reason: string }[] = [];
  const g = globalThis as unknown as Record<string, unknown>;
  const RealResponse = g.Response;
  g.WebSocketPair = class {
    0 = { side: "client" };
    1 = { accept() {}, close: (code: number, reason: string) => closed.push({ code, reason }) };
  };
  // workerd allows a 101 Response carrying a webSocket; undici does not - model workerd.
  g.Response = class extends (RealResponse as typeof Response) {
    constructor(body: BodyInit | null, init?: ResponseInit & { webSocket?: unknown }) {
      super(body, init?.status === 101 ? { ...init, status: 200 } : init);
      if (init?.status === 101) Object.defineProperty(this, "status", { value: 101 });
    }
  };
  try {
    const res = await worker.fetch(
      new Request("https://playcydi.com/api/room/ABC234/ws?pf=android&avc=46", { headers: { upgrade: "websocket" } }),
      env,
    );
    assert.equal(res.status, 101);
    assert.deepEqual(closed, [{ code: MP_UPDATE_REQUIRED_CLOSE_CODE, reason: "multiplayer_update_required" }]);
    assert.equal(room.fetches, 0);
  } finally {
    g.Response = RealResponse;
    delete g.WebSocketPair;
  }
});

test("the gate config is cached: many room operations, one KV read", async () => {
  const { env, kv } = makeEnv({ enabled: true, minAndroidVersionCode: 48 });
  for (let i = 0; i < 10; i++) await worker.fetch(info("?pf=android&avc=48"), env);
  assert.equal(kv.reads.get(MP_VERSION_GATE_KV_KEY), 1);
});

test("a malformed gate config fails open", async () => {
  const { env, kv } = makeEnv();
  kv.store.set(MP_VERSION_GATE_KV_KEY, "{not json");
  assert.equal((await worker.fetch(post(""), env)).status, 201);
});
