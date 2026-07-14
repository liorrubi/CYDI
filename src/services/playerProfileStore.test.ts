// Proves the anonymous identity that backs the "Privacy Request ID" Settings box:
// getPlayerId() returns a randomly generated id, persists it, and reuses the same
// id on every later call (so the value a user copies is stable and can be matched
// to their leaderboard records). Also covers the optional display name defaulting
// and length behavior. Uses a tiny in-memory localStorage stub since plain Node
// has none.

import { strict as assert } from "node:assert";
import { test, beforeEach } from "node:test";

function installLocalStorageStub() {
  const map = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
  return map;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

beforeEach(() => {
  installLocalStorageStub();
});

test("getPlayerId returns a random UUID and reuses the same value across calls", async () => {
  const { getPlayerId } = await import("./playerProfileStore.ts");
  const first = getPlayerId();
  assert.match(first, UUID_RE);
  assert.equal(getPlayerId(), first, "the id must be stable so a user can copy a value that identifies their records");
});

test("getPlayerId persists the id to storage under a stable key", async () => {
  const map = installLocalStorageStub();
  const { getPlayerId } = await import("./playerProfileStore.ts");
  const id = getPlayerId();
  assert.equal(map.get("cydi.playerId.v1"), id);
});

test("display name defaults to the anonymous label and is never blank", async () => {
  const { getDisplayName, ANONYMOUS_PLAYER_NAME } = await import("./playerProfileStore.ts");
  assert.equal(getDisplayName(), ANONYMOUS_PLAYER_NAME);
});

test("setPlayerName trims whitespace and caps length at 24 chars", async () => {
  const { setPlayerName, getPlayerName } = await import("./playerProfileStore.ts");
  setPlayerName("   Alice   ");
  assert.equal(getPlayerName(), "Alice");
  setPlayerName("x".repeat(50));
  assert.equal(getPlayerName().length, 24);
});
