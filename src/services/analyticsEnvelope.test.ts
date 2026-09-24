// The ingest envelope: every event must carry the release it came from, on both
// surfaces. `buildAnalyticsEnvelope` is extracted from the Cloudflare provider
// purely so this can be asserted without a network or a native bridge - the
// provider's behaviour is unchanged.
import test from "node:test";
import assert from "node:assert/strict";

(globalThis as unknown as { __APP_BUILD__: string }).__APP_BUILD__ = "test";
(globalThis as unknown as { __APP_BUILD_TIME__: string }).__APP_BUILD_TIME__ = "test";

const { Capacitor } = await import("@capacitor/core");
const { buildAnalyticsEnvelope } = await import("./analytics.ts");
const { APP_BUILD, APP_VERSION } = await import("../app/constants.ts");
const { normalizeAppBuild, normalizeAppVersion } = await import("./analyticsSchema.ts");

// Web only (these tests run with no native platform). Android reports its installed
// package's versionName instead - see nativeAppInfo.test.ts.
test("on the web the envelope carries appVersion from APP_VERSION", () => {
  const envelope = buildAnalyticsEnvelope("app_open", {});
  assert.equal(envelope.appVersion, APP_VERSION);
  assert.notEqual(envelope.appVersion, undefined);
});

test("the envelope carries appBuild from APP_BUILD", () => {
  const envelope = buildAnalyticsEnvelope("app_open", {});
  assert.equal(envelope.appBuild, APP_BUILD);
});

test("platform is whatever Capacitor reports, so Android and Web self-identify", () => {
  const envelope = buildAnalyticsEnvelope("app_open", {});
  assert.equal(envelope.platform, Capacitor.getPlatform());
});

test("within one surface every event is stamped with the same version fields", () => {
  // Web and Android ship independently, so their VALUES differ between two live
  // builds, and since 0.53.0 so does the source (APP_VERSION on web, the native
  // versionName on Android). What must not differ is one run's events among
  // themselves.
  const web = buildAnalyticsEnvelope("app_open", {});
  const game = buildAnalyticsEnvelope("game_started", { gameType: "shapeChallenge" });
  assert.equal(web.appVersion, game.appVersion);
  assert.equal(web.appBuild, game.appBuild);
});

test("every event gets the version, not just app_open", () => {
  for (const name of ["app_open", "game_started", "game_completed", "shape_completed"] as const) {
    const envelope = buildAnalyticsEnvelope(name, {});
    assert.equal(envelope.appVersion, APP_VERSION, `${name} carries appVersion`);
    assert.equal(envelope.appBuild, APP_BUILD, `${name} carries appBuild`);
  }
});

test("attribution is a website field: present on web, absent inside the native app", () => {
  // Capacitor reports "web" under the test runner, so the positive case is the one
  // asserted here; the negative is asserted through the same predicate the envelope
  // uses, so the two can never disagree about which surface is which.
  const envelope = buildAnalyticsEnvelope("app_open", {});
  assert.equal(Capacitor.isNativePlatform(), false, "sanity: the runner is the web surface");
  assert.equal("attribution" in envelope, !Capacitor.isNativePlatform());
});

test("the envelope carries the visit's attribution, on every event and not just the first", () => {
  // No DOM here, so the landing resolves to "direct" - what matters is that the field
  // is present and well-formed on every event, which is what lets the server break
  // any event down by campaign without a per-event schema change.
  for (const name of ["app_open", "game_started", "game_completed"] as const) {
    const { attribution } = buildAnalyticsEnvelope(name, {});
    assert.deepEqual(Object.keys(attribution).sort(), ["campaign", "content", "medium", "source", "term"], name);
    assert.equal(attribution.source, "direct", name);
  }
});

test("the envelope carries no URL or referrer, only the normalized labels", () => {
  // The whole envelope is serialized to the ingest endpoint, so this is the real
  // data-minimization boundary: whatever ends up here is what leaves the device.
  const serialized = JSON.stringify(buildAnalyticsEnvelope("app_open", {}));
  assert.ok(!serialized.includes("http://"), serialized);
  assert.ok(!serialized.includes("https://"), serialized);
  assert.ok(!serialized.includes("utm_"), serialized);
});

test("the envelope still carries every pre-existing field - no semantics changed", () => {
  const envelope = buildAnalyticsEnvelope("game_started", { gameType: "shapeChallenge" });
  for (const key of ["eventName", "params", "platform", "installationId", "sessionId", "isInternal"]) {
    assert.ok(key in envelope, `${key} is still present`);
  }
  assert.equal(envelope.eventName, "game_started");
  assert.deepEqual(envelope.params, { gameType: "shapeChallenge" });
});

test("the real APP_VERSION passes the server's own guard", () => {
  // If a version bump ever produced a value the Worker would reject, every event
  // from that release would silently bucket as "unknown" - catch it here instead.
  assert.equal(normalizeAppVersion(APP_VERSION), APP_VERSION);
});

test("APP_BUILD is either a usable SHA or degrades to unknown, never a stray key", () => {
  // Under `node --test` __APP_BUILD__ is stubbed as "test", which is exactly the
  // non-git fallback case: it must normalize to "unknown" rather than become a
  // counter key of its own.
  const normalized = normalizeAppBuild(APP_BUILD);
  assert.ok(normalized === "unknown" || /^[0-9a-f]{7,12}$/.test(normalized), `got ${normalized}`);
});

// --- isInternal comes from the build, not only from storage -------------------
//
// A debug Android build marks its own events, because the stored flag lives in the
// same localStorage as installationId/sessionId and was therefore lost on every
// reinstall. Only that one field may move: these assert the rest of the envelope is
// untouched, and that the website (no injected Capacitor global) is unaffected.

/** Runs `body` with a stand-in for the browser global; this file's default state (no window) is restored afterwards. */
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

test("a debuggable build stamps its events internal", () => {
  withWindow({ Capacitor: { DEBUG: true } }, () => {
    assert.equal(buildAnalyticsEnvelope("app_open", {}).isInternal, true);
    assert.equal(buildAnalyticsEnvelope("game_started", { gameType: "shapeChallenge" }).isInternal, true);
  });
});

test("a release build, and the website, stay external", () => {
  withWindow({ Capacitor: { DEBUG: false } }, () => {
    assert.equal(buildAnalyticsEnvelope("app_open", {}).isInternal, false);
  });
  // No window at all, and a browser with no Capacitor: both are the web path and
  // must read exactly as they did before this existed.
  assert.equal(buildAnalyticsEnvelope("app_open", {}).isInternal, false);
  withWindow({}, () => assert.equal(buildAnalyticsEnvelope("app_open", {}).isInternal, false));
});

test("a truthy lookalike does not mark a build internal", () => {
  for (const value of ["true", 1, {}]) {
    withWindow({ Capacitor: { DEBUG: value } }, () => {
      assert.equal(buildAnalyticsEnvelope("app_open", {}).isInternal, false, `${JSON.stringify(value)}`);
    });
  }
});

test("isInternal is the ONLY field the build signal moves", () => {
  let debuggable: Record<string, unknown> = {};
  let release: Record<string, unknown> = {};
  withWindow({ Capacitor: { DEBUG: true } }, () => {
    debuggable = buildAnalyticsEnvelope("game_completed", { gameType: "shapeChallenge" }) as unknown as Record<string, unknown>;
  });
  withWindow({ Capacitor: { DEBUG: false } }, () => {
    release = buildAnalyticsEnvelope("game_completed", { gameType: "shapeChallenge" }) as unknown as Record<string, unknown>;
  });

  assert.deepEqual(Object.keys(debuggable).sort(), Object.keys(release).sort(), "no field appears or disappears");
  assert.notEqual(debuggable.isInternal, release.isInternal);
  for (const key of Object.keys(release)) {
    if (key === "isInternal" || key === "sessionId" || key === "installationId") continue;
    assert.deepEqual(debuggable[key], release[key], `${key} is unchanged`);
  }
});
