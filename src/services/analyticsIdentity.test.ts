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
  isQaBuild,
  randomAnalyticsId,
  setInternalDevice,
  shouldReportAsInternal,
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

// --- QA/debug builds mark themselves ------------------------------------------
//
// The stored internal flag shares its storage with the installation and session
// ids, so a reinstall or an app-data clear wipes all three at once and a QA device
// silently rejoins the real-player numbers. isQaBuild() reads the flag Capacitor
// injects from the APK's own android:debuggable instead, which no storage wipe can
// touch. These tests pin both halves of the OR and, just as importantly, that
// isInternalDevice() itself did not change meaning.

/** Runs `body` with a stand-in for the browser global; the file's default state (no window at all) is restored afterwards. */
function withWindow(value: unknown, body: () => void): void {
  const g = globalThis as unknown as { window?: unknown };
  const had = "window" in g;
  const previous = g.window;
  g.window = value;
  try {
    body();
  } finally {
    if (had) g.window = previous;
    else delete g.window;
  }
}

test("with no window at all, nothing is a QA build", () => {
  // The Worker and these unit tests take this path; it must never throw.
  assert.equal(isQaBuild(), false);
});

test("Capacitor.DEBUG true is the QA signal, false is not", () => {
  withWindow({ Capacitor: { DEBUG: true } }, () => assert.equal(isQaBuild(), true));
  withWindow({ Capacitor: { DEBUG: false } }, () => assert.equal(isQaBuild(), false));
});

test("a browser with no injected Capacitor global is never a QA build", () => {
  // This is the website: window exists, Capacitor does not.
  withWindow({}, () => assert.equal(isQaBuild(), false));
  withWindow({ Capacitor: {} }, () => assert.equal(isQaBuild(), false));
  withWindow({ Capacitor: undefined }, () => assert.equal(isQaBuild(), false));
});

test("only a real boolean true counts - no truthy lookalike marks a build as ours", () => {
  for (const value of ["true", "1", 1, {}, [], "TRUE", "DEBUG"]) {
    withWindow({ Capacitor: { DEBUG: value } }, () => {
      assert.equal(isQaBuild(), false, `${JSON.stringify(value)} is not the QA signal`);
    });
  }
});

test("a QA build reports internal with nothing stored at all", () => {
  setInternalDevice(false);
  assert.equal(isInternalDevice(), false, "nothing persisted");
  withWindow({ Capacitor: { DEBUG: true } }, () => assert.equal(shouldReportAsInternal(), true));
});

test("a release build still honours the manual flag, both ways", () => {
  withWindow({ Capacitor: { DEBUG: false } }, () => {
    setInternalDevice(false);
    assert.equal(shouldReportAsInternal(), false, "a real player stays external");
    setInternalDevice(true);
    assert.equal(shouldReportAsInternal(), true, "a hand-marked device is internal");
  });
  setInternalDevice(false);
});

test("?internal=1 still works on a build that is not debuggable", () => {
  withWindow({ Capacitor: { DEBUG: false } }, () => {
    setInternalDevice(false);
    applyInternalFlagFromUrl("?internal=1");
    assert.equal(shouldReportAsInternal(), true);
    applyInternalFlagFromUrl("?internal=0");
    assert.equal(shouldReportAsInternal(), false);
  });
});

test("isInternalDevice keeps its old meaning - the stored flag and nothing else", () => {
  // The Settings toggle renders from this, so a debug build must not make it read
  // "on" for a choice the person never made, and turning it off must still be
  // honoured as a stored value even though the build keeps reporting internal.
  setInternalDevice(false);
  withWindow({ Capacitor: { DEBUG: true } }, () => {
    assert.equal(isInternalDevice(), false, "the build does not write the flag");
    assert.equal(shouldReportAsInternal(), true, "but it does report internal");
    setInternalDevice(true);
    assert.equal(isInternalDevice(), true);
    setInternalDevice(false);
    assert.equal(isInternalDevice(), false);
    assert.equal(shouldReportAsInternal(), true, "a QA build cannot opt out - by design");
  });
});
