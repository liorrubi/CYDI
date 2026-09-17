// Pinning the landing decision to the session, which is what makes "every later event
// in this visit keeps the source it arrived with" true - including across the separate
// document loads the SEO pages are.
//
// Same approach as analyticsIdentity.test.ts: a fake localStorage installed before the
// import is enough, no DOM and no browser. `window` stays undefined, so the module's
// self-init is skipped and the landing snapshot is supplied explicitly per test.
import test from "node:test";
import assert from "node:assert/strict";

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

const { captureLanding, getAttribution, resetAttributionForTests } = await import("./analyticsAttributionStore.ts");
const { ATTRIBUTION_DIRECT } = await import("./analyticsAttribution.ts");
const { SESSION_IDLE_TIMEOUT_MS } = await import("./analyticsIdentity.ts");

const ORIGIN = "https://playcydi.com";
const SHORT_URL = "?utm_source=youtube&utm_medium=shorts&utm_campaign=cydi_shorts&utm_content=N4H7VTj59A0";

function freshVisit(search: string, referrer = "", at = Date.now()) {
  storageThrows = false;
  store.clear();
  resetAttributionForTests();
  captureLanding({ search, referrer, origin: ORIGIN, at });
}

/** The analytics session id in storage right now - the thing attribution is pinned to. */
function storedSessionId(): string {
  return JSON.parse(store.get("cydi.analyticsSession.v1") as string).id;
}

test("the landing UTM is what the first event of the visit carries", () => {
  freshVisit(SHORT_URL);
  const a = getAttribution();
  assert.equal(a.source, "youtube");
  assert.equal(a.medium, "shorts");
  assert.equal(a.campaign, "cydi_shorts");
  assert.equal(a.content, "N4H7VTj59A0");
});

test("every later event in the same visit keeps the landing attribution", () => {
  freshVisit(SHORT_URL);
  const first = getAttribution();
  // Repeated calls are what the envelope does once per event.
  for (let i = 0; i < 5; i++) assert.deepEqual(getAttribution(), first);
});

test("an in-app navigation that loses the UTM does not reset the visit to direct", () => {
  freshVisit(SHORT_URL);
  const landed = getAttribution();
  // The router has replaced the URL and the next document's referrer is our own
  // site - the exact shape of a second page view inside one visit.
  captureLanding({ search: "", referrer: "https://playcydi.com/", origin: ORIGIN });
  assert.deepEqual(getAttribution(), landed);
  assert.equal(getAttribution().campaign, "cydi_shorts");
});

test("a visit from an external referrer with no UTM is attributed to that referrer", () => {
  freshVisit("", "https://m.youtube.com/shorts/N4H7VTj59A0");
  const a = getAttribution();
  assert.equal(a.source, "youtube");
  assert.equal(a.medium, "referral");
});

test("a direct visit stays direct", () => {
  freshVisit("");
  assert.equal(getAttribution().source, ATTRIBUTION_DIRECT);
});

test("the attribution is persisted, so a reload within the session reads it back", () => {
  freshVisit(SHORT_URL);
  const landed = getAttribution();
  assert.ok(store.has("cydi.analyticsAttribution.v1"), "written to storage");
  const persisted = JSON.parse(store.get("cydi.analyticsAttribution.v1") as string);
  assert.deepEqual(persisted.attribution, landed);
  assert.equal(typeof persisted.sessionId, "string");
});

test("nothing but the five labels is ever persisted - no landing URL, no referrer", () => {
  freshVisit("?utm_source=youtube&utm_content=N4H7VTj59A0&secret=personal-value", "https://m.youtube.com/shorts/abc?u=xyz");
  getAttribution();
  const raw = store.get("cydi.analyticsAttribution.v1") as string;
  assert.ok(!raw.includes("secret"), "an unrelated query param must not be stored");
  assert.ok(!raw.includes("personal-value"), "an unrelated query value must not be stored");
  assert.ok(!raw.includes("https://"), "no full URL of any kind is stored");
  assert.deepEqual(Object.keys(JSON.parse(raw).attribution).sort(), ["campaign", "content", "medium", "source", "term"]);
});

test("a blocked localStorage still gives one consistent attribution for the document", () => {
  freshVisit(SHORT_URL);
  storageThrows = true;
  const first = getAttribution();
  assert.equal(first.source, "youtube");
  assert.deepEqual(getAttribution(), first);
});

test("a corrupt stored record is ignored rather than thrown, and the visit re-resolves", () => {
  freshVisit(SHORT_URL);
  store.set("cydi.analyticsAttribution.v1", "{not json");
  assert.equal(getAttribution().source, "youtube");
  store.set("cydi.analyticsAttribution.v1", JSON.stringify({ sessionId: 5, attribution: { source: 1 } }));
  assert.equal(getAttribution().source, "youtube");
});

test("with no landing captured at all the visit is direct, never a crash", () => {
  storageThrows = false;
  store.clear();
  resetAttributionForTests();
  assert.equal(getAttribution().source, ATTRIBUTION_DIRECT);
});

// --- Lifetime: exactly one session, no longer and no shorter ---
//
// The two failure modes these pin down are opposites, and both are silent:
// re-crediting the Short for unrelated visits days later, and dropping the campaign
// during ordinary navigation inside one visit.

test("attribution holds for the WHOLE session, however long the visit stays active", () => {
  const t0 = 1_000_000_000_000;
  freshVisit(SHORT_URL, "", t0);
  assert.equal(getAttribution(t0).campaign, "cydi_shorts");
  const session = storedSessionId();

  // Activity every 20 minutes for four hours: each call refreshes the session, so it
  // never rolls over and the campaign must survive all of it.
  let now = t0;
  for (let i = 0; i < 12; i++) {
    now += 20 * 60 * 1000;
    assert.equal(getAttribution(now).campaign, "cydi_shorts", `+${(i + 1) * 20} minutes`);
  }
  assert.equal(storedSessionId(), session, "still the same session");
});

test("a reload inside the visit keeps the campaign, even though the URL no longer has it", () => {
  const t0 = 1_000_000_000_000;
  freshVisit(SHORT_URL, "", t0);
  assert.equal(getAttribution(t0).campaign, "cydi_shorts");
  const session = storedSessionId();

  // A reload re-runs module init: a NEW landing snapshot, now without the UTM (the
  // router has cleaned the address bar) and with our own origin as the referrer.
  const t1 = t0 + 5 * 60 * 1000;
  captureLanding({ search: "", referrer: "https://playcydi.com/", origin: ORIGIN, at: t1 });
  resetAttributionForTests_memoryOnly();
  assert.equal(getAttribution(t1).campaign, "cydi_shorts", "read back from storage, not re-resolved");
  assert.equal(storedSessionId(), session);
});

// The reload case above must exercise the STORAGE path, not the in-memory shortcut,
// so the memory copy is dropped without touching localStorage.
function resetAttributionForTests_memoryOnly() {
  const saved = store.get("cydi.analyticsAttribution.v1");
  const savedSession = store.get("cydi.analyticsSession.v1");
  resetAttributionForTests();
  if (saved !== undefined) store.set("cydi.analyticsAttribution.v1", saved);
  if (savedSession !== undefined) store.set("cydi.analyticsSession.v1", savedSession);
}

test("a new session after the idle timeout is NOT credited to the original campaign", () => {
  // The risk this closes: a tab left open for days. Its landing snapshot still holds
  // the UTM tags, so without the freshness cap every session rollover would be
  // counted as another arrival from the Short.
  const t0 = 1_000_000_000_000;
  freshVisit(SHORT_URL, "", t0);
  assert.equal(getAttribution(t0).campaign, "cydi_shorts");
  const firstSession = storedSessionId();

  const nextDay = t0 + 26 * 60 * 60 * 1000;
  const later = getAttribution(nextDay);
  assert.notEqual(storedSessionId(), firstSession, "the session really did roll over");
  assert.equal(later.source, ATTRIBUTION_DIRECT, "a day later is not an arrival from YouTube");
  assert.equal(later.campaign, "unknown");
});

test("the boundary is the session idle timeout, on both sides of it", () => {
  const t0 = 1_000_000_000_000;

  // Just inside: no rollover, campaign intact.
  freshVisit(SHORT_URL, "", t0);
  getAttribution(t0);
  assert.equal(getAttribution(t0 + SESSION_IDLE_TIMEOUT_MS).campaign, "cydi_shorts");

  // Just past: the session rolls over and the landing is by then too old to seed it.
  freshVisit(SHORT_URL, "", t0);
  getAttribution(t0);
  assert.equal(getAttribution(t0 + SESSION_IDLE_TIMEOUT_MS + 1).source, ATTRIBUTION_DIRECT);
});

test("a genuinely new visit from the Short is attributed again, not suppressed", () => {
  // The freshness cap must not make the campaign un-countable on a real return trip:
  // a new document load means a new landing snapshot, and that one IS fresh.
  const t0 = 1_000_000_000_000;
  freshVisit(SHORT_URL, "", t0);
  assert.equal(getAttribution(t0).campaign, "cydi_shorts");

  const nextWeek = t0 + 7 * 24 * 60 * 60 * 1000;
  captureLanding({ search: SHORT_URL, referrer: "", origin: ORIGIN, at: nextWeek });
  const again = getAttribution(nextWeek);
  assert.equal(again.campaign, "cydi_shorts");
  assert.equal(again.source, "youtube");
});

test("a device clock that jumps backwards cannot resurrect a stale landing", () => {
  const t0 = 1_000_000_000_000;
  freshVisit(SHORT_URL, "", t0);
  getAttribution(t0);
  // Landing stamped three hours in the FUTURE relative to the event's clock - a
  // negative age, which must read as unusable rather than as "brand new".
  captureLanding({ search: SHORT_URL, referrer: "", origin: ORIGIN, at: t0 + 3 * 60 * 60 * 1000 });
  assert.equal(getAttribution(t0 + 60 * 60 * 1000).source, ATTRIBUTION_DIRECT);
});
