// Guards the Android-only half of the sharing layer: inside the app every share
// must open the native Sharesheet and every payload-less "come play CYDI" link
// must point at the Play Store listing - while the website keeps its existing
// navigator.share -> clipboard behavior and its playcydi.com links, untouched.
// "Android" is simulated exactly the way Capacitor itself detects it (by the
// presence of `window.androidBridge`, re-read on every getPlatform() call), so
// no device or native bridge is needed here.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function setAndroid(isAndroid: boolean) {
  const win = globalThis as unknown as { androidBridge?: unknown };
  if (isAndroid) win.androidBridge = {};
  else delete win.androidBridge;
}

/** Replaces `navigator` (a read-only accessor in Node) with a stub that records what the web path did. */
function stubNavigator(share?: (data: unknown) => Promise<void>) {
  const calls = { shared: [] as unknown[], copied: [] as string[] };
  const nav = {
    share: share && ((data: unknown) => { calls.shared.push(data); return share(data); }),
    clipboard: { writeText: async (text: string) => { calls.copied.push(text); } },
  };
  Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true, writable: true });
  return calls;
}

const { PLAY_STORE_URL, genericShareUrl, isAndroidApp, shareOrCopy } = await import("./nativeShare.ts");

test("on web, a generic share link is returned untouched (playcydi.com, not the store)", () => {
  setAndroid(false);
  assert.equal(isAndroidApp(), false);
  assert.equal(genericShareUrl("https://playcydi.com"), "https://playcydi.com");
  assert.equal(genericShareUrl("https://playcydi.com/daily"), "https://playcydi.com/daily");
});

test("in the Android app, a generic share link becomes the Google Play listing", () => {
  setAndroid(true);
  assert.equal(isAndroidApp(), true);
  assert.equal(genericShareUrl("https://playcydi.com"), PLAY_STORE_URL);
  assert.equal(genericShareUrl("https://playcydi.com/daily"), PLAY_STORE_URL);
  setAndroid(false);
});

test("the Play Store link carries the app's real package id, not a guessed one", () => {
  const appId = /appId:\s*"([^"]+)"/.exec(readFileSync("capacitor.config.ts", "utf8"))?.[1];
  const applicationId = /applicationId\s+"([^"]+)"/.exec(readFileSync("android/app/build.gradle", "utf8"))?.[1];
  assert.ok(appId, "could not read appId from capacitor.config.ts");
  assert.equal(applicationId, appId);
  assert.equal(PLAY_STORE_URL, `https://play.google.com/store/apps/details?id=${appId}`);
});

test("on web, shareOrCopy still goes through navigator.share - the Android branch is inert", async () => {
  setAndroid(false);
  const calls = stubNavigator(async () => {});
  const outcome = await shareOrCopy({ title: "CYDI", text: "hi", url: "https://playcydi.com" });
  assert.equal(outcome, "shared");
  assert.deepEqual(calls.shared, [{ title: "CYDI", text: "hi", url: "https://playcydi.com" }]);
  assert.deepEqual(calls.copied, []);
});

test("on web with no navigator.share, shareOrCopy still falls back to the clipboard", async () => {
  setAndroid(false);
  const calls = stubNavigator(undefined);
  const outcome = await shareOrCopy({ title: "CYDI", text: "hi", url: "https://playcydi.com" });
  assert.equal(outcome, "copied");
  assert.deepEqual(calls.copied, ["https://playcydi.com"]);
});
