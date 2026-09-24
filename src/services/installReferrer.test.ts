import assert from "node:assert/strict";
import test from "node:test";

// Same harness as analyticsIdentity.test.ts: the module reads localStorage at call
// time, so a fake store installed before the dynamic import is enough - no DOM, no
// browser, no Capacitor runtime. The native bridge is injected instead of mocked.
const store = new Map<string, string>();

(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
};

// trackEvent is a no-op under plain Node unless the debug flag is on (isDevBuild()
// can't read import.meta.env here, so it reports "dev"). Set before importing, so the
// capture provider below actually receives the two events.
store.set("cydi.analyticsDebug.v1", "1");

const {
  INSTALL_REFERRER_RESPONSE,
  _resetInstallReferrerForTests,
  _setInstallReferrerDepsForTests,
  installAgeBucket,
  isRetryableResponse,
  referrerAttribution,
  runInstallReferrerOnce,
  shouldEmitFirstOpen,
} = await import("./installReferrer.ts");
const { registerAnalyticsProvider } = await import("./analytics.ts");

type Captured = { eventName: string; params: Record<string, unknown> };
let captured: Captured[] = [];

registerAnalyticsProvider({
  name: "test-capture",
  trackEvent(eventName, params) {
    captured.push({ eventName, params: params as unknown as Record<string, unknown> });
  },
});

const APP_VERSION = "0.50.0";

type BridgeResult = {
  responseCode: number;
  referrer?: string | null;
  installVersion?: string | null;
  installBeginTimestampSeconds?: number | null;
};

/** Installs a bridge that records its own call count, plus the standard non-QA Android environment. */
function arrange(results: BridgeResult[] | (() => Promise<BridgeResult>), overrides: { isQa?: boolean; isNative?: boolean; now?: number; appVersion?: string } = {}) {
  _resetInstallReferrerForTests();
  captured = [];
  const calls = { count: 0 };
  const bridge = {
    getReferrerDetails: async () => {
      calls.count += 1;
      if (typeof results === "function") return results();
      const next = results[Math.min(calls.count - 1, results.length - 1)];
      return next;
    },
  };
  _setInstallReferrerDepsForTests({
    bridge,
    isNative: () => overrides.isNative ?? true,
    isQa: () => overrides.isQa ?? false,
    now: () => overrides.now ?? Date.UTC(2026, 8, 24, 12, 0, 0),
    appVersion: () => overrides.appVersion ?? APP_VERSION,
  });
  return calls;
}

const names = () => captured.map((c) => c.eventName);

// --- installAge: diagnostic only, and never guessed ---------------------------------

test("installAge buckets cover the documented ranges", () => {
  const now = Date.UTC(2026, 8, 24, 12, 0, 0);
  const secondsAgo = (hours: number) => (now - hours * 60 * 60 * 1000) / 1000;
  assert.equal(installAgeBucket(secondsAgo(1), now), "h0_24");
  assert.equal(installAgeBucket(secondsAgo(23.9), now), "h0_24");
  assert.equal(installAgeBucket(secondsAgo(24), now), "d1_7");
  assert.equal(installAgeBucket(secondsAgo(24 * 6), now), "d1_7");
  assert.equal(installAgeBucket(secondsAgo(24 * 7), now), "d7_30");
  assert.equal(installAgeBucket(secondsAgo(24 * 29), now), "d7_30");
  assert.equal(installAgeBucket(secondsAgo(24 * 30), now), "d30_plus");
  assert.equal(installAgeBucket(secondsAgo(24 * 400), now), "d30_plus");
});

test("an absent or impossible install-begin timestamp is unknown, never a real bucket", () => {
  const now = Date.UTC(2026, 8, 24, 12, 0, 0);
  // Bundle.getLong's default for a missing key - indistinguishable from epoch 0.
  assert.equal(installAgeBucket(0, now), "unknown");
  assert.equal(installAgeBucket(null, now), "unknown");
  assert.equal(installAgeBucket(undefined, now), "unknown");
  assert.equal(installAgeBucket(Number.NaN, now), "unknown");
  // Device clock moved backwards: the install "begins" in the future.
  assert.equal(installAgeBucket(now / 1000 + 86400, now), "unknown");
});

// --- first_open: the whole rule, and nothing else -----------------------------------

test("first_open needs the original installed version to be the running version", () => {
  assert.equal(shouldEmitFirstOpen("0.50.0", APP_VERSION, false), true);
  assert.equal(shouldEmitFirstOpen("0.48.4", APP_VERSION, false), false, "an upgrade is not a new install");
  assert.equal(shouldEmitFirstOpen("0.50.1", APP_VERSION, false), false);
});

test("a missing installVersion never produces a first_open", () => {
  // getInstallVersion() is Bundle.getString with no default, so old Play Store builds
  // hand back null. Under-reporting an install is recoverable; inventing one is not.
  assert.equal(shouldEmitFirstOpen(null, APP_VERSION, false), false);
  assert.equal(shouldEmitFirstOpen(undefined, APP_VERSION, false), false);
  assert.equal(shouldEmitFirstOpen("", APP_VERSION, false), false);
});

test("the local marker suppresses a repeat within one installation", () => {
  assert.equal(shouldEmitFirstOpen(APP_VERSION, APP_VERSION, true), false);
});

// --- referrer parsing: the website's normalizer, reused ------------------------------

test("an organic Play install still carries real labels", () => {
  const a = referrerAttribution("utm_source=google-play&utm_medium=organic");
  assert.equal(a?.source, "google-play");
  assert.equal(a?.medium, "organic");
});

test("a tagged campaign link maps onto the existing vocabulary", () => {
  const a = referrerAttribution("utm_source=youtube&utm_medium=shorts&utm_campaign=cydi_shorts&utm_content=UWZ8uIOM3XU");
  assert.equal(a?.source, "youtube");
  assert.equal(a?.medium, "shorts");
  assert.equal(a?.campaign, "cydi_shorts");
  assert.equal(a?.content, "UWZ8uIOM3XU");
});

test("an Android package source collapses onto the same label as the host", () => {
  assert.equal(referrerAttribution("utm_source=com.google.android.youtube")?.source, "youtube");
});

test("no referrer to parse is null, not a guessed attribution", () => {
  assert.equal(referrerAttribution(null), null);
  assert.equal(referrerAttribution(undefined), null);
  assert.equal(referrerAttribution(""), null);
  assert.equal(referrerAttribution("   "), null);
});

test("a hostile referrer cannot open an unbounded counter key", () => {
  const a = referrerAttribution(`utm_source=${"x".repeat(4096)}&utm_campaign=${"y".repeat(4096)}`);
  assert.ok(a !== null);
  assert.ok(a.source.length <= 32, `source was ${a.source.length} chars`);
  assert.ok(a.campaign.length <= 32, `campaign was ${a.campaign.length} chars`);
});

// --- response codes ------------------------------------------------------------------

test("only the two transient codes are retryable", () => {
  assert.equal(isRetryableResponse(INSTALL_REFERRER_RESPONSE.SERVICE_UNAVAILABLE), true);
  assert.equal(isRetryableResponse(INSTALL_REFERRER_RESPONSE.SERVICE_DISCONNECTED), true);
  assert.equal(isRetryableResponse(INSTALL_REFERRER_RESPONSE.OK), false);
  assert.equal(isRetryableResponse(INSTALL_REFERRER_RESPONSE.FEATURE_NOT_SUPPORTED), false);
  assert.equal(isRetryableResponse(INSTALL_REFERRER_RESPONSE.DEVELOPER_ERROR), false);
  assert.equal(isRetryableResponse(INSTALL_REFERRER_RESPONSE.PERMISSION_ERROR), false);
});

test("a permanent failure is never asked again", async () => {
  for (const code of [
    INSTALL_REFERRER_RESPONSE.FEATURE_NOT_SUPPORTED,
    INSTALL_REFERRER_RESPONSE.DEVELOPER_ERROR,
    INSTALL_REFERRER_RESPONSE.PERMISSION_ERROR,
  ]) {
    const calls = arrange([{ responseCode: code }]);
    await runInstallReferrerOnce();
    await runInstallReferrerOnce();
    await runInstallReferrerOnce();
    assert.equal(calls.count, 1, `code ${code} should be asked exactly once`);
    assert.deepEqual(names(), []);
  }
});

test("a transient failure retries, but stops after three attempts", async () => {
  const calls = arrange([{ responseCode: INSTALL_REFERRER_RESPONSE.SERVICE_UNAVAILABLE }]);
  for (let i = 0; i < 6; i++) await runInstallReferrerOnce();
  assert.equal(calls.count, 3);
  assert.deepEqual(names(), []);
});

test("a bridge that throws still stops after three attempts", async () => {
  const calls = arrange(async () => {
    throw new Error("service exploded");
  });
  for (let i = 0; i < 6; i++) await runInstallReferrerOnce();
  assert.equal(calls.count, 3);
  assert.deepEqual(names(), []);
});

// --- emission ------------------------------------------------------------------------

test("a fresh install emits both events, once, with the attribution attached", async () => {
  const now = Date.UTC(2026, 8, 24, 12, 0, 0);
  const calls = arrange(
    [
      {
        responseCode: INSTALL_REFERRER_RESPONSE.OK,
        referrer: "utm_source=youtube&utm_campaign=cydi_shorts",
        installVersion: APP_VERSION,
        installBeginTimestampSeconds: (now - 2 * 60 * 60 * 1000) / 1000,
      },
    ],
    { now },
  );
  await runInstallReferrerOnce();
  assert.deepEqual(names(), ["install_attributed", "first_open"]);
  assert.deepEqual(captured[1].params, { installAge: "h0_24" });
  assert.equal(calls.count, 1);
});

test("an upgrade is attributed but is not a first_open", async () => {
  // trackEvent drops an identical (name, params) pair seen within DUPLICATE_WINDOW_MS,
  // and install_attributed always has empty params - so the previous test's copy would
  // swallow this one. Real installations are never 300ms apart; the suite is. Waiting
  // out the window keeps the assertion below a real one instead of weakening it.
  await new Promise((resolve) => setTimeout(resolve, 2100));
  arrange([
    {
      responseCode: INSTALL_REFERRER_RESPONSE.OK,
      referrer: "utm_source=youtube",
      installVersion: "0.48.4",
      installBeginTimestampSeconds: 1_750_000_000,
    },
  ]);
  await runInstallReferrerOnce();
  assert.deepEqual(names(), ["install_attributed"]);
});

test("a readable installVersion with no referrer is a first_open and nothing else", async () => {
  arrange([{ responseCode: INSTALL_REFERRER_RESPONSE.OK, referrer: null, installVersion: APP_VERSION, installBeginTimestampSeconds: 0 }]);
  await runInstallReferrerOnce();
  assert.deepEqual(names(), ["first_open"]);
  assert.deepEqual(captured[0].params, { installAge: "unknown" });
});

test("first_open compares Play's installVersion with the NATIVE versionName, not the web APP_VERSION", async () => {
  // The web bundle's constant can run ahead of (or behind) the APK. What Play reports
  // is the installed package's versionName, so that is the only valid comparison.
  const { APP_VERSION: WEB_APP_VERSION } = await import("../app/constants.ts");
  // Same DUPLICATE_WINDOW_MS reason as "an upgrade is attributed..." above.
  await new Promise((resolve) => setTimeout(resolve, 2100));
  const native = "0.49.9";
  assert.notEqual(native, WEB_APP_VERSION);
  arrange([{ responseCode: INSTALL_REFERRER_RESPONSE.OK, referrer: null, installVersion: native, installBeginTimestampSeconds: 0 }], { appVersion: native });
  await runInstallReferrerOnce();
  assert.deepEqual(names(), ["first_open"]);
});

test("native versionName not known yet -> no first_open (conservative), attribution unaffected", async () => {
  // Same DUPLICATE_WINDOW_MS reason as "an upgrade is attributed..." above.
  await new Promise((resolve) => setTimeout(resolve, 2100));
  arrange([{ responseCode: INSTALL_REFERRER_RESPONSE.OK, referrer: "utm_source=youtube", installVersion: "unknown", installBeginTimestampSeconds: 1 }], {
    appVersion: "unknown",
  });
  await runInstallReferrerOnce();
  assert.deepEqual(names(), ["install_attributed"]);
});

test("OK with nothing usable in it emits nothing at all", async () => {
  const calls = arrange([{ responseCode: INSTALL_REFERRER_RESPONSE.OK, referrer: "", installVersion: null, installBeginTimestampSeconds: 0 }]);
  await runInstallReferrerOnce();
  await runInstallReferrerOnce();
  assert.deepEqual(names(), []);
  assert.equal(calls.count, 1, "a usable answer that happens to be empty is still an answer");
});

test("restarts never re-ask Play and never re-emit", async () => {
  const calls = arrange([
    {
      responseCode: INSTALL_REFERRER_RESPONSE.OK,
      referrer: "utm_source=youtube",
      installVersion: APP_VERSION,
      installBeginTimestampSeconds: 1_790_000_000,
    },
  ]);
  await runInstallReferrerOnce();
  const afterFirst = names().length;
  await runInstallReferrerOnce();
  await runInstallReferrerOnce();
  assert.equal(calls.count, 1, "the one-shot must survive restarts");
  assert.equal(names().length, afterFirst);
});

// --- environment gates ---------------------------------------------------------------

test("a QA build never starts the flow", async () => {
  const calls = arrange(
    [{ responseCode: INSTALL_REFERRER_RESPONSE.OK, referrer: "utm_source=youtube", installVersion: APP_VERSION, installBeginTimestampSeconds: 1 }],
    { isQa: true },
  );
  await runInstallReferrerOnce();
  assert.equal(calls.count, 0, "Capacitor.DEBUG is the QA protection - nothing may reach Play");
  assert.deepEqual(names(), []);
});

test("web never starts the flow", async () => {
  const calls = arrange(
    [{ responseCode: INSTALL_REFERRER_RESPONSE.OK, referrer: "utm_source=youtube", installVersion: APP_VERSION, installBeginTimestampSeconds: 1 }],
    { isNative: false },
  );
  await runInstallReferrerOnce();
  assert.equal(calls.count, 0);
  assert.deepEqual(names(), []);
});
