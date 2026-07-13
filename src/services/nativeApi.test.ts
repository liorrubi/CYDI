// Proves the native-origin fix: Capacitor serves the app from a virtual
// "https://localhost" origin on Android/iOS, never the real production domain, so
// any code that trusted `location.origin` or a relative "/api/..." path produced a
// share link nobody else could open, and an API call that silently always failed
// (confirmed live on a real device: CORS-blocked even with an absolute URL, since
// the Worker sends no Access-Control-Allow-Origin). nativeApi.ts is the fix; these
// tests simulate "native" the same way Capacitor itself detects it - by checking
// for `window.androidBridge` - so no real device/native bridge is needed.

import test from "node:test";
import assert from "node:assert/strict";

(globalThis as unknown as { __APP_BUILD__: string }).__APP_BUILD__ = "test";
(globalThis as unknown as { __APP_BUILD_TIME__: string }).__APP_BUILD_TIME__ = "test";

function setLocation(origin: string) {
  (globalThis as unknown as { location: { origin: string; pathname: string } }).location = {
    origin,
    pathname: "/",
  };
}

function setNative(isNative: boolean) {
  const win = globalThis as unknown as { androidBridge?: unknown };
  if (isNative) win.androidBridge = {};
  else delete win.androidBridge;
}

const { PRODUCTION_ORIGIN, getPublicOrigin, buildNativeHttpOptions, apiFetch } = await import("./nativeApi.ts");
const { encodeChallengeLink } = await import("./shareLink.ts");

function fixtureChallenge() {
  return {
    id: "abc123",
    name: "Test Shape",
    target: { points: [{ x: 0, y: 0, t: 0 }, { x: 10, y: 10, t: 0 }], canvasWidth: 320, canvasHeight: 320 },
    createdAt: 0,
    updatedAt: 0,
    attempts: 0,
  };
}

test("native share links begin with https://playcydi.com/, even when the WebView origin is https://localhost", () => {
  setNative(true);
  setLocation("https://localhost");

  assert.equal(getPublicOrigin(), PRODUCTION_ORIGIN);

  const link = encodeChallengeLink(fixtureChallenge());
  assert.ok(link.startsWith("https://playcydi.com/"), `expected link to start with https://playcydi.com/, got: ${link}`);
});

test("no externally shared URL can contain localhost, on native, regardless of the WebView's actual origin", () => {
  setNative(true);
  setLocation("https://localhost");

  const link = encodeChallengeLink(fixtureChallenge());
  assert.ok(!link.includes("localhost"), `share link must never contain localhost, got: ${link}`);

  const shortLinkStyleUrl = `${getPublicOrigin()}/c/someId`;
  assert.ok(!shortLinkStyleUrl.includes("localhost"));
});

test("native API calls resolve to https://playcydi.com/api/..., never a relative path against the WebView origin", () => {
  setNative(true);

  const options = buildNativeHttpOptions("/api/daily/current?playerId=abc");
  assert.equal(options.url, "https://playcydi.com/api/daily/current?playerId=abc");

  const postOptions = buildNativeHttpOptions("/api/share", { method: "POST", body: '{"type":"c"}' });
  assert.equal(postOptions.url, "https://playcydi.com/api/share");
  assert.equal(postOptions.method, "POST");
  assert.equal(postOptions.data, '{"type":"c"}');
});

test("web API calls retain their existing behavior: apiFetch still calls a plain relative fetch, untouched", async () => {
  setNative(false);
  setLocation("https://playcydi.com");

  const calls: Array<{ url: string; init: unknown }> = [];
  const originalFetch = (globalThis as unknown as { fetch: typeof fetch }).fetch;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string, init: unknown) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  try {
    const response = await apiFetch("/api/daily/current?playerId=abc", { method: "GET" });
    assert.equal(response.ok, true);
    assert.equal(calls.length, 1);
    // Relative path, unchanged - never rewritten to an absolute production URL on web.
    assert.equal(calls[0]?.url, "/api/daily/current?playerId=abc");
  } finally {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
  }
});

test("web mode still builds a same-origin public URL (short-link/hash-link behavior unaffected)", () => {
  setNative(false);
  setLocation("https://playcydi.com");
  assert.equal(getPublicOrigin(), "https://playcydi.com");

  const link = encodeChallengeLink(fixtureChallenge());
  assert.ok(link.startsWith("https://playcydi.com/"));
});
