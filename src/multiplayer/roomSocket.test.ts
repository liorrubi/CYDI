import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

// RoomSocket lives on browser globals (WebSocket, window timers, document
// visibility, localStorage). They are stubbed here rather than mocked away,
// because the behaviour worth testing IS the interaction with them: reclaiming
// a seat with a stored token, backing off, and noticing a socket that looks
// open but has stopped answering.

class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;

  url: string;
  readyState = 0;
  sent: unknown[] = [];
  closedWith: number | null = null;
  private listeners = new Map<string, ((e: unknown) => void)[]>();

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(fn);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code?: number) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.closedWith = code ?? 1000;
    this.emit("close", {});
  }
  emit(type: string, event: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }
  /** Test helper: complete the handshake. */
  open() {
    this.readyState = 1;
    this.emit("open", {});
  }
  /** Test helper: deliver a server frame. */
  deliver(frame: unknown) {
    this.emit("message", { data: JSON.stringify(frame) });
  }
  frames(type: string) {
    return this.sent.filter((f) => (f as { type: string }).type === type);
  }
}

// --- controllable timers -----------------------------------------------------
type Timer = { id: number; fireAt: number; fn: () => void; interval: number | null };
let clock = 0;
let timers: Timer[] = [];
let nextTimerId = 1;

function schedule(fn: () => void, ms: number, interval: number | null): number {
  const id = nextTimerId++;
  timers.push({ id, fireAt: clock + ms, fn, interval });
  return id;
}
function cancel(id: number) {
  timers = timers.filter((t) => t.id !== id);
}
function tick(ms: number) {
  const target = clock + ms;
  for (let guard = 0; guard < 1000; guard++) {
    const due = timers.filter((t) => t.fireAt <= target).sort((a, b) => a.fireAt - b.fireAt)[0];
    if (!due) break;
    clock = Math.max(clock, due.fireAt);
    if (due.interval === null) cancel(due.id);
    else due.fireAt = clock + due.interval;
    due.fn();
  }
  clock = target;
}

const storage = new Map<string, string>();
let visibility: "visible" | "hidden" = "visible";
const visibilityListeners: (() => void)[] = [];

const g = globalThis as unknown as Record<string, unknown>;
g.WebSocket = FakeSocket;
g.window = {
  setTimeout: (fn: () => void, ms: number) => schedule(fn, ms, null),
  clearTimeout: (id: number) => cancel(id),
  setInterval: (fn: () => void, ms: number) => schedule(fn, ms, ms),
  clearInterval: (id: number) => cancel(id),
};
g.document = {
  get visibilityState() {
    return visibility;
  },
  addEventListener: (type: string, fn: () => void) => {
    if (type === "visibilitychange") visibilityListeners.push(fn);
  },
  removeEventListener: (type: string, fn: () => void) => {
    const i = visibilityListeners.indexOf(fn);
    if (i >= 0) visibilityListeners.splice(i, 1);
  },
};
g.localStorage = {
  getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
  setItem: (k: string, v: string) => void storage.set(k, v),
  removeItem: (k: string) => void storage.delete(k),
};
g.crypto ??= { randomUUID: () => "test-player-id" };
// getApiWebSocketOrigin reads location.origin on web.
g.location = { origin: "https://example.test" };

const { RoomSocket, clearRoomToken, hasRoomToken, roomSocketUrl } = await import("./roomSocket.ts");

function setVisibility(next: "visible" | "hidden") {
  visibility = next;
  for (const fn of [...visibilityListeners]) fn();
}

beforeEach(() => {
  FakeSocket.instances = [];
  timers = [];
  clock = 0;
  storage.clear();
  visibility = "visible";
  visibilityListeners.length = 0;
});

function connectSocket(roomCode = "TEST77") {
  const socket = new RoomSocket({ roomCode, nickname: "Lior", now: () => clock });
  const frames: unknown[] = [];
  const statuses: string[] = [];
  socket.subscribe((f) => frames.push(f));
  socket.subscribeStatus((s) => statuses.push(s));
  return { socket, frames, statuses, ws: () => FakeSocket.instances[FakeSocket.instances.length - 1] };
}

/** Brings a socket all the way to a usable, joined state. */
function completeHandshake(h: ReturnType<typeof connectSocket>, token = "token-abc") {
  h.ws().open();
  h.ws().deliver({ type: "joined", seatId: "seat-1", playerToken: token, roomCode: "TEST77", serverNow: clock });
}

// ------------------------------------------------------------------------ url ----

test("the socket URL is absolute and derived from the API origin", () => {
  const url = roomSocketUrl("TEST77");
  // Never relative: on native, the page origin is the WebView's virtual
  // https://localhost and a relative URL would point nowhere real.
  assert.match(url, /^wss?:\/\//);
  assert.ok(url.endsWith("/api/room/TEST77/ws"), url);
  assert.ok(!url.includes("localhost/api"), "must not resolve against the WebView origin");
});

// ------------------------------------------------------------------- joining ----

test("a join frame is sent as soon as the socket opens", () => {
  const h = connectSocket();
  h.ws().open();
  const join = h.ws().frames("join")[0] as { nickname: string; playerToken?: string };
  assert.ok(join, "expected a join frame");
  assert.equal(join.nickname, "Lior");
  assert.equal(join.playerToken, undefined, "no token on a first join");
});

test("the seat token is stored and replayed on the next connection", () => {
  const h = connectSocket();
  completeHandshake(h, "secret-token");
  assert.equal(hasRoomToken("TEST77"), true);

  h.ws().close();
  tick(1000);
  h.ws().open(); // the join frame only goes out once the new socket is up
  const join = h.ws().frames("join")[0] as { playerToken?: string };
  assert.equal(join.playerToken, "secret-token", "the reconnect must reclaim the same seat");
});

test("status only becomes open once the server has actually seated us", () => {
  const h = connectSocket();
  assert.deepEqual(h.statuses, ["connecting"]);
  h.ws().open();
  assert.ok(!h.statuses.includes("open"), "an open socket is not yet a joined player");
  h.ws().deliver({ type: "joined", seatId: "s", playerToken: "t", roomCode: "TEST77", serverNow: 0 });
  assert.equal(h.statuses[h.statuses.length - 1], "open");
});

test("clearRoomToken gives up the seat", () => {
  const h = connectSocket();
  completeHandshake(h);
  clearRoomToken("TEST77");
  assert.equal(hasRoomToken("TEST77"), false);
});

// ---------------------------------------------------------------- reconnect ----

test("a dropped socket reconnects, with a growing backoff", () => {
  const h = connectSocket();
  completeHandshake(h);
  const before = FakeSocket.instances.length;

  h.ws().close();
  assert.equal(FakeSocket.instances.length, before, "does not reconnect instantly");
  tick(600);
  assert.equal(FakeSocket.instances.length, before + 1, "first retry is quick");

  // Failing repeatedly without ever joining must stretch the delay.
  h.ws().close();
  tick(300);
  assert.equal(FakeSocket.instances.length, before + 1, "second retry waits longer than the first");
  tick(1200);
  assert.equal(FakeSocket.instances.length, before + 2);
});

test("a successful join resets the backoff", () => {
  const h = connectSocket();
  completeHandshake(h);
  h.ws().close();
  tick(600);
  completeHandshake(h, "token-2"); // reconnected and seated
  h.ws().close();
  const count = FakeSocket.instances.length;
  tick(600);
  assert.equal(FakeSocket.instances.length, count + 1, "back to the short delay after a good connection");
});

test("status reports reconnecting while the socket is down", () => {
  const h = connectSocket();
  completeHandshake(h);
  h.ws().close();
  assert.equal(h.statuses[h.statuses.length - 1], "reconnecting");
});

test("frames sent while disconnected are dropped, not queued", () => {
  const h = connectSocket();
  completeHandshake(h);
  h.ws().close();
  h.socket.send({ type: "next" });
  tick(600);
  completeHandshake(h, "t2");
  // Replaying a stale "next round" after reconnecting would advance a game the
  // player is no longer looking at.
  assert.equal(h.ws().frames("next").length, 0);
});

// ------------------------------------------------------------------ liveness ----

test("a silent but open socket is probed, and replaced when it does not answer", () => {
  const h = connectSocket();
  completeHandshake(h);
  const socket = h.ws();

  tick(26_000); // the watchdog ticks every 5s, so the first check past the 20s silence threshold is at 25s
  assert.equal(socket.frames("ping").length, 1, "a probe is sent before giving up on it");
  assert.equal(FakeSocket.instances.length, 1, "not replaced yet");

  tick(5_500); // the probe timeout is its own timer, so it fires on time
  assert.equal(socket.closedWith !== null, true, "the dead socket is discarded");
  assert.equal(FakeSocket.instances.length, 2, "and replaced immediately");
});

test("a socket that answers its probe is left alone", () => {
  const h = connectSocket();
  completeHandshake(h);
  const socket = h.ws();

  tick(26_000);
  assert.equal(socket.frames("ping").length, 1);
  socket.deliver({ type: "pong", clientSentAt: 1, serverNow: clock });
  tick(10_000);
  assert.equal(FakeSocket.instances.length, 1, "still the same, healthy socket");
});

test("a hidden tab is not probed", () => {
  const h = connectSocket();
  completeHandshake(h);
  const socket = h.ws();
  setVisibility("hidden");
  tick(60_000);
  // A backgrounded WebView is throttled and legitimately quiet; probing it
  // would manufacture reconnects for a connection that is fine.
  assert.equal(socket.frames("ping").length, 0);
  assert.equal(FakeSocket.instances.length, 1);
});

test("returning from the background probes immediately instead of waiting", () => {
  const h = connectSocket();
  completeHandshake(h);
  const socket = h.ws();
  setVisibility("hidden");
  tick(30_000);
  assert.equal(socket.frames("ping").length, 0);

  setVisibility("visible");
  assert.equal(socket.frames("ping").length, 1, "checked the moment the player is looking again");
});

test("returning from the background to a dead socket reconnects at once", () => {
  const h = connectSocket();
  completeHandshake(h);
  setVisibility("hidden");
  h.ws().close();
  const count = FakeSocket.instances.length;
  setVisibility("visible");
  assert.equal(FakeSocket.instances.length, count + 1, "no backoff wait when the player is watching");
});

test("a resumed client never replays missed phases - it just waits for the next snapshot", () => {
  const h = connectSocket();
  completeHandshake(h);
  h.ws().deliver({ type: "snapshot", phase: "DRAWING", roundIndex: 0 });
  setVisibility("hidden");
  tick(45_000);
  setVisibility("visible");

  const before = h.frames.length;
  // Whatever it missed, the client sends nothing to catch up.
  assert.deepEqual(h.ws().frames("submit"), []);
  assert.deepEqual(h.ws().frames("next"), []);

  h.ws().deliver({ type: "snapshot", phase: "ROUND_RESULTS", roundIndex: 2 });
  assert.equal(h.frames.length, before + 1);
  assert.equal((h.frames[h.frames.length - 1] as { phase: string }).phase, "ROUND_RESULTS");
});

// ---------------------------------------------------------------- subscribe ----

test("a late subscriber is replayed the most recent snapshot", () => {
  const h = connectSocket();
  completeHandshake(h);
  h.ws().deliver({ type: "snapshot", phase: "LOBBY", roundIndex: -1 });

  const late: unknown[] = [];
  h.socket.subscribe((f) => late.push(f));
  assert.equal(late.length, 1);
  assert.equal((late[0] as { phase: string }).phase, "LOBBY");
});

test("closing stops the timers and the socket", () => {
  const h = connectSocket();
  completeHandshake(h);
  const socket = h.ws();
  h.socket.close();
  assert.equal(socket.closedWith, 1000);
  tick(120_000);
  assert.equal(FakeSocket.instances.length, 1, "a closed transport never reconnects");
});

test("closing reports the closed status", () => {
  const h = connectSocket();
  completeHandshake(h);
  h.socket.close();
  assert.equal(h.statuses[h.statuses.length - 1], "closed");
});
