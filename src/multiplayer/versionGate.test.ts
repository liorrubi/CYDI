// Play Together's minimum-version gate: Android-only, keyed on versionCode, OFF and
// fail-open by default, and able to recognise pre-0.53.0 Android builds that send no
// version at all.
import test from "node:test";
import assert from "node:assert/strict";

const { classifyMultiplayerClient, isUpdateRequired, parseVersionGateConfig, MP_VERSION_GATE_OFF } = await import("./versionGate.ts");

const headers = (h: Record<string, string> = {}) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });
const url = (q = "") => new URL(`https://playcydi.com/api/room${q}`);

test("a 0.53.0+ client declares itself", () => {
  assert.deepEqual(classifyMultiplayerClient(url("?pf=android&av=0.53.0&avc=48"), headers()), { platform: "android", appVersionCode: 48 });
  assert.deepEqual(classifyMultiplayerClient(url("?pf=web&av=0.52.1"), headers({ "sec-fetch-site": "same-origin" })), {
    platform: "web",
    appVersionCode: 0,
  });
});

test("an old client with no params is told apart by transport", () => {
  assert.equal(classifyMultiplayerClient(url(), headers({ origin: "https://localhost" })).platform, "android", "the app's WebView socket");
  assert.equal(classifyMultiplayerClient(url(), headers({ "sec-fetch-site": "same-origin" })).platform, "web", "a browser");
  assert.equal(classifyMultiplayerClient(url(), headers({ "user-agent": "Dalvik/2.1.0" })).platform, "android", "native CapacitorHttp");
  assert.equal(classifyMultiplayerClient(url(), headers()).appVersionCode, 0);
});

test("hostile or malformed codes count as 0, never as a pass", () => {
  for (const q of ["?pf=android&avc=abc", "?pf=android&avc=-5", "?pf=android&avc=1.5", "?pf=android&avc="]) {
    assert.equal(classifyMultiplayerClient(url(q), headers()).appVersionCode, 0, q);
  }
});

test("OFF refuses nobody; ON refuses only Android builds below the minimum", () => {
  const on = { enabled: true, minAndroidVersionCode: 48 };
  assert.equal(isUpdateRequired(MP_VERSION_GATE_OFF, { platform: "android", appVersionCode: 0 }), false);
  assert.equal(isUpdateRequired(on, { platform: "android", appVersionCode: 45 }), true);
  assert.equal(isUpdateRequired(on, { platform: "android", appVersionCode: 0 }), true, "pre-0.53.0: no code at all");
  assert.equal(isUpdateRequired(on, { platform: "android", appVersionCode: 48 }), false);
  assert.equal(isUpdateRequired(on, { platform: "web", appVersionCode: 0 }), false, "web always serves its latest bundle");
  assert.equal(isUpdateRequired(on, { platform: "ios", appVersionCode: 0 }), false);
});

test("config parsing is strict and fails to null (the caller treats null as OFF)", () => {
  assert.deepEqual(parseVersionGateConfig('{"enabled":true,"minAndroidVersionCode":48}'), { enabled: true, minAndroidVersionCode: 48 });
  const bad = [
    null,
    "",
    "{",
    '{"enabled":true}',
    '{"enabled":"yes","minAndroidVersionCode":1}',
    '{"enabled":true,"minAndroidVersionCode":-1}',
    '{"enabled":true,"minAndroidVersionCode":1,"x":1}',
  ];
  for (const raw of bad) assert.equal(parseVersionGateConfig(raw), null, String(raw));
});
