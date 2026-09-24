// Native Android version identity in the analytics envelope: web keeps APP_VERSION;
// Android reports the installed package's versionName/versionCode from native
// metadata, and "unknown" - never APP_VERSION - until that is known.
import test from "node:test";
import assert from "node:assert/strict";

const { APP_VERSION } = await import("../app/constants.ts");
const { buildAnalyticsEnvelope } = await import("./analytics.ts");
const {
  NATIVE_VERSION_FALLBACK,
  _resetNativeAppInfoForTests,
  getAnalyticsAppVersion,
  getAnalyticsAppVersionCode,
  getDisplayAppVersion,
  initNativeAppInfo,
} = await import("./nativeAppInfo.ts");
const { normalizeAppVersion, normalizeAppVersionCode } = await import("./analyticsSchema.ts");

test("web uses APP_VERSION and sends no versionCode", async () => {
  _resetNativeAppInfoForTests({ native: false, reader: async () => ({ version: "9.9.9", build: "99" }) });
  await initNativeAppInfo();
  assert.equal(getAnalyticsAppVersion(), APP_VERSION);
  const envelope = buildAnalyticsEnvelope("app_open", {});
  assert.equal(envelope.appVersion, APP_VERSION);
  assert.equal("appVersionCode" in envelope, false);
});

test("Android uses the cached native versionName and versionCode, not APP_VERSION", async () => {
  _resetNativeAppInfoForTests({ native: true, reader: async () => ({ version: "0.51.0", build: "45" }) });
  await initNativeAppInfo();
  const envelope = buildAnalyticsEnvelope("app_open", {});
  assert.equal(envelope.appVersion, "0.51.0");
  assert.notEqual(envelope.appVersion, APP_VERSION, "the web bundle's constant is not the installed release");
  assert.equal((envelope as { appVersionCode?: string }).appVersionCode, "45");
  // Both survive the Worker's own normalizers unchanged.
  assert.equal(normalizeAppVersion(envelope.appVersion), "0.51.0");
  assert.equal(normalizeAppVersionCode((envelope as { appVersionCode?: string }).appVersionCode), "45");
  // Every event carries it, not only app_open.
  assert.equal(buildAnalyticsEnvelope("game_started", {}).appVersion, "0.51.0");
});

test("before native metadata is read, Android reports unknown and omits versionCode - never the web constant", () => {
  _resetNativeAppInfoForTests({ native: true, reader: () => new Promise(() => {}) });
  void initNativeAppInfo(1);
  assert.equal(getAnalyticsAppVersion(), NATIVE_VERSION_FALLBACK);
  assert.equal(getAnalyticsAppVersionCode(), undefined);
  const envelope = buildAnalyticsEnvelope("app_open", {});
  assert.equal(envelope.appVersion, "unknown");
  assert.equal("appVersionCode" in envelope, false);
});

test("a failing native read stays on the fallback, and init still resolves (bounded)", async () => {
  _resetNativeAppInfoForTests({ native: true, reader: async () => {
    throw new Error("no plugin");
  } });
  await initNativeAppInfo();
  assert.equal(getAnalyticsAppVersion(), "unknown");
  _resetNativeAppInfoForTests({ native: true, reader: () => new Promise(() => {}) });
  const started = Date.now();
  await initNativeAppInfo(20);
  assert.ok(Date.now() - started < 1000, "the bootstrap wait is bounded");
});

test("a numeric build is accepted; an empty version is not trusted", async () => {
  _resetNativeAppInfoForTests({ native: true, reader: async () => ({ version: "0.53.0", build: 46 }) });
  await initNativeAppInfo();
  assert.equal(getAnalyticsAppVersionCode(), "46");
  _resetNativeAppInfoForTests({ native: true, reader: async () => ({ version: "", build: "46" }) });
  await initNativeAppInfo();
  assert.equal(getAnalyticsAppVersion(), "unknown");
  _resetNativeAppInfoForTests();
});

test("Settings shows the native versionName (and code) on Android, APP_VERSION on the web", async () => {
  _resetNativeAppInfoForTests({ native: true, reader: async () => ({ version: "0.53.0", build: "47" }) });
  await initNativeAppInfo();
  assert.equal(getDisplayAppVersion(), "0.53.0 (47)");
  _resetNativeAppInfoForTests({ native: false });
  assert.equal(getDisplayAppVersion(), APP_VERSION);
  _resetNativeAppInfoForTests();
});
