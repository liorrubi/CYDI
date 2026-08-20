import test from "node:test";
import assert from "node:assert/strict";

// The module reads localStorage at call time, so a fake store installed before the
// import is enough - no DOM and no browser needed. `window` stays undefined here,
// which is exactly the guard the module's self-init uses.
const store = new Map<string, string>();
let storageThrows = false;

function guard() {
  if (storageThrows) throw new Error("storage disabled");
}

(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (key: string) => {
    guard();
    return store.get(key) ?? null;
  },
  setItem: (key: string, value: string) => {
    guard();
    store.set(key, value);
  },
  removeItem: (key: string) => {
    guard();
    store.delete(key);
  },
};

const {
  applyInternalFlagFromUrl,
  getInstallationId,
  getSessionId,
  isAnalyticsId,
  isInternalDevice,
  randomAnalyticsId,
  setInternalDevice,
  SESSION_IDLE_TIMEOUT_MS,
} = await import("./analyticsIdentity.ts");

test("generated ids are anonymous fixed-length hex, and not repeated", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const id = randomAnalyticsId();
    assert.equal(isAnalyticsId(id), true, `${id} must match the id format`);
    ids.add(id);
  }
  assert.equal(ids.size, 200, "random ids must not collide in a small sample");
});

test("the installation id is created once and then stays put", () => {
  store.clear();
  const first = getInstallationId();
  assert.equal(isAnalyticsId(first), true);
  assert.equal(getInstallationId(), first);
  assert.equal(store.get("cydi.installationId.v1"), first, "it must be persisted, not just held in memory");
});

test("a corrupted stored installation id is replaced with a valid one", () => {
  store.clear();
  store.set("cydi.installationId.v1", "not-an-id");
  const id = getInstallationId();
  assert.equal(isAnalyticsId(id), true);
  assert.equal(store.get("cydi.installationId.v1"), id);
});

test("a session continues while active and rolls over after the idle timeout", () => {
  store.clear();
  const start = 1_000_000;
  const first = getSessionId(start);
  assert.equal(isAnalyticsId(first), true);
  assert.equal(getSessionId(start + 60_000), first, "activity a minute later is the same session");
  assert.equal(
    getSessionId(start + 60_000 + SESSION_IDLE_TIMEOUT_MS),
    first,
    "the timeout is measured from the LAST activity, not from the session start",
  );

  const afterIdle = getSessionId(start + 60_000 + SESSION_IDLE_TIMEOUT_MS + SESSION_IDLE_TIMEOUT_MS + 1);
  assert.notEqual(afterIdle, first, "a long gap must start a new session");
  assert.equal(getSessionId(start + 60_000 + 2 * SESSION_IDLE_TIMEOUT_MS + 2), afterIdle);
});

test("a backwards device clock starts a new session instead of freezing the old one", () => {
  store.clear();
  const first = getSessionId(5_000_000);
  assert.notEqual(getSessionId(1_000), first);
});

test("a corrupted session value starts a fresh session rather than throwing", () => {
  store.clear();
  store.set("cydi.analyticsSession.v1", "{not json");
  const id = getSessionId(1_000);
  assert.equal(isAnalyticsId(id), true);
});

test("the internal flag is off by default and toggles both ways", () => {
  store.clear();
  assert.equal(isInternalDevice(), false, "a real player's device must never be internal by default");
  setInternalDevice(true);
  assert.equal(isInternalDevice(), true);
  setInternalDevice(false);
  assert.equal(isInternalDevice(), false);
  assert.equal(store.has("cydi.analyticsInternal.v1"), false, "unmarking must clear the key, not leave a stale value");
});

test("?internal=1 marks a browser and ?internal=0 unmarks it; anything else is ignored", () => {
  store.clear();
  applyInternalFlagFromUrl("?internal=1");
  assert.equal(isInternalDevice(), true);
  applyInternalFlagFromUrl("?utm_source=reddit");
  assert.equal(isInternalDevice(), true, "an unrelated query string must not change the flag");
  applyInternalFlagFromUrl("?internal=0");
  assert.equal(isInternalDevice(), false);
  applyInternalFlagFromUrl("");
  assert.equal(isInternalDevice(), false);
});

test("blocked storage never throws, and keeps one identity for the run", () => {
  store.clear();
  storageThrows = true;
  try {
    const installation = getInstallationId();
    assert.equal(isAnalyticsId(installation), true);
    assert.equal(getInstallationId(), installation, "the run must not look like a new installation per event");
    const session = getSessionId(2_000);
    assert.equal(getSessionId(2_500), session);
    assert.equal(isInternalDevice(), false);
  } finally {
    storageThrows = false;
  }
});
