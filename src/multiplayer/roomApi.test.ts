// The two room calls send the version identity and recognise the server's two
// deliberate refusals - and only those: a bare 503 is not a capacity decision.
import test from "node:test";
import assert from "node:assert/strict";

const g = globalThis as unknown as Record<string, unknown>;
let lastUrl = "";
let reply: () => Response = () => new Response("{}", { status: 200 });
g.fetch = async (u: string) => {
  lastUrl = u;
  return reply();
};

const { createRoom, lookupRoom, CAPACITY_MESSAGE, UPDATE_REQUIRED_MESSAGE } = await import("./roomApi.ts");

const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status });
const sent = () => new URL(lastUrl, "https://x.test");

test("create and /info carry the platform and app version", async () => {
  reply = json(201, { roomCode: "ABC234" });
  await createRoom();
  assert.equal(sent().pathname, "/api/room");
  assert.equal(sent().searchParams.get("pf"), "web");
  assert.ok(sent().searchParams.get("av"));
  reply = json(200, { roomCode: "ABC234", phase: "LOBBY", players: 1, maxPlayers: 8, joinable: true, serverNow: 0 });
  await lookupRoom("ABC234");
  assert.equal(sent().pathname, "/api/room/ABC234/info");
  assert.equal(sent().searchParams.get("pf"), "web");
});

test("503 multiplayer_capacity -> the dedicated capacity message and code", async () => {
  reply = json(503, { error: "x", code: "multiplayer_capacity", retryable: true });
  assert.deepEqual(await createRoom(), { ok: false, error: CAPACITY_MESSAGE, code: "multiplayer_capacity" });
});

test("426 multiplayer_update_required -> update message and code, on create and on join", async () => {
  reply = json(426, { error: "x", code: "multiplayer_update_required" });
  assert.deepEqual(await createRoom(), { ok: false, error: UPDATE_REQUIRED_MESSAGE, code: "multiplayer_update_required" });
  assert.deepEqual(await lookupRoom("ABC234"), { ok: false, error: UPDATE_REQUIRED_MESSAGE, code: "multiplayer_update_required" });
});

test("a 503 without the code, or a mismatched status and code, stays a generic failure", async () => {
  reply = () => new Response("Service Unavailable", { status: 503 });
  const plain = await createRoom();
  assert.equal(plain.ok, false);
  assert.equal((plain as { code?: string }).code, undefined);
  reply = json(503, { code: "multiplayer_update_required" });
  assert.equal(((await createRoom()) as { code?: string }).code, undefined);
});
