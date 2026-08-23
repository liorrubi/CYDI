import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

class MemoryStorage {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
const storage = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;

const { clearActiveRoom, getActiveRoomHint, rememberActiveRoom } = await import("./resumeStore");
const guard = await import("../app/navigationGuard");

beforeEach(() => { storage.clear(); guard.clearNavigationGuard(); });

test("a device with no game in progress is offered nothing", () => {
  assert.equal(getActiveRoomHint(), null);
});

test("joining a room leaves a breadcrumb that survives a restart", () => {
  rememberActiveRoom("ABC234");
  assert.equal(getActiveRoomHint()?.roomCode, "ABC234");
});

test("leaving deliberately removes it, so Home offers nothing", () => {
  rememberActiveRoom("ABC234");
  clearActiveRoom();
  assert.equal(getActiveRoomHint(), null);
});

test("a stale breadcrumb expires rather than advertising a dead game", () => {
  storage.setItem("cydi.mp.resume.v1", JSON.stringify({ roomCode: "ABC234", savedAt: Date.now() - 2 * 60 * 60_000 }));
  assert.equal(getActiveRoomHint(), null, "older than the room could possibly live");
});

test("a corrupt breadcrumb is ignored instead of throwing on the home screen", () => {
  storage.setItem("cydi.mp.resume.v1", "{ not json");
  assert.equal(getActiveRoomHint(), null);
  storage.setItem("cydi.mp.resume.v1", JSON.stringify({ roomCode: 42 }));
  assert.equal(getActiveRoomHint(), null);
});

test("the newest room wins if one is somehow started over another", () => {
  rememberActiveRoom("AAA222");
  rememberActiveRoom("BBB333");
  assert.equal(getActiveRoomHint()?.roomCode, "BBB333");
});

// ------------------------------------------------------------ back guard ----

test("with no screen objecting, back behaves exactly as before", () => {
  assert.equal(guard.runNavigationGuard(), false);
});

test("a live game takes the back press instead of leaving the room", () => {
  let asked = 0;
  guard.registerNavigationGuard(() => { asked++; return true; });
  assert.equal(guard.runNavigationGuard(), true);
  assert.equal(asked, 1);
});

test("a guard that declines lets back through", () => {
  guard.registerNavigationGuard(() => false);
  assert.equal(guard.runNavigationGuard(), false);
});

test("unregistering restores normal back, and a later screen's guard replaces an earlier one", () => {
  const stop = guard.registerNavigationGuard(() => true);
  stop();
  assert.equal(guard.runNavigationGuard(), false);

  guard.registerNavigationGuard(() => true);
  let second = false;
  guard.registerNavigationGuard(() => { second = true; return true; });
  guard.runNavigationGuard();
  assert.equal(second, true, "only the screen in front is asked");
});

test("a stale unregister cannot disarm the guard that replaced it", () => {
  const stopFirst = guard.registerNavigationGuard(() => true);
  guard.registerNavigationGuard(() => true);
  stopFirst();
  assert.equal(guard.runNavigationGuard(), true, "the current screen is still protected");
});

test("a throwing guard never traps the player in the screen", () => {
  guard.registerNavigationGuard(() => { throw new Error("boom"); });
  assert.equal(guard.runNavigationGuard(), false);
});
