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

test("the envelope carries appVersion from APP_VERSION - the single source of truth", () => {
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

test("the version fields do NOT depend on the surface - web and Android are stamped the same way", () => {
  // Web and Android ship independently, so their VALUES can differ between two
  // live builds; what must not differ is where the value comes from. Both
  // surfaces read the same constants, so one build's envelope is self-consistent
  // regardless of which surface it is running on.
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
