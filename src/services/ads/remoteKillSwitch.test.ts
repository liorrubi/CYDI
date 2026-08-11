// Proves the remote ads kill switch fails closed: it starts disabled, and every
// failure path - network error, timeout, non-2xx (incl. 404), invalid JSON, or a
// wrong-shaped payload - leaves (or resets) it disabled. The only way it becomes
// true is a real, well-formed { enabled: true } response.

import { strict as assert } from "node:assert";
import { test, beforeEach, afterEach } from "node:test";

import {
  _resetRemoteAdsKillSwitchForTests,
  isRemoteAdsEnabled,
  refreshRemoteAdsKillSwitch,
} from "./remoteKillSwitch";

function mockFetch(handler: (url: string) => Response) {
  const original = (globalThis as unknown as { fetch: typeof fetch }).fetch;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string) => handler(url)) as typeof fetch;
  return () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = original;
  };
}

beforeEach(() => {
  _resetRemoteAdsKillSwitchForTests();
});

let restoreFetch: (() => void) | undefined;
afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
});

test("fail-closed before anything runs", () => {
  assert.equal(isRemoteAdsEnabled(), false);
});

test("a well-formed { enabled: true } response enables the switch", async () => {
  restoreFetch = mockFetch(() => new Response(JSON.stringify({ enabled: true }), { status: 200 }));
  const state = await refreshRemoteAdsKillSwitch();
  assert.deepEqual(state, { enabled: true });
  assert.equal(isRemoteAdsEnabled(), true);
});

test("a well-formed { enabled: false } response keeps it disabled", async () => {
  restoreFetch = mockFetch(() => new Response(JSON.stringify({ enabled: false }), { status: 200 }));
  await refreshRemoteAdsKillSwitch();
  assert.equal(isRemoteAdsEnabled(), false);
});

test("404 (no config published) resolves fail-closed, not an error", async () => {
  restoreFetch = mockFetch(() => new Response(JSON.stringify({ error: "not found" }), { status: 404 }));
  const state = await refreshRemoteAdsKillSwitch();
  assert.deepEqual(state, { enabled: false });
});

test("a server error status resolves fail-closed", async () => {
  restoreFetch = mockFetch(() => new Response("oops", { status: 500 }));
  await refreshRemoteAdsKillSwitch();
  assert.equal(isRemoteAdsEnabled(), false);
});

test("invalid JSON body resolves fail-closed, never throws", async () => {
  restoreFetch = mockFetch(() => new Response("not json", { status: 200 }));
  const state = await refreshRemoteAdsKillSwitch();
  assert.deepEqual(state, { enabled: false });
});

test("a wrong-shaped payload (extra key) resolves fail-closed", async () => {
  restoreFetch = mockFetch(() => new Response(JSON.stringify({ enabled: true, extra: 1 }), { status: 200 }));
  await refreshRemoteAdsKillSwitch();
  assert.equal(isRemoteAdsEnabled(), false);
});

test("a wrong-typed enabled field resolves fail-closed", async () => {
  restoreFetch = mockFetch(() => new Response(JSON.stringify({ enabled: "true" }), { status: 200 }));
  await refreshRemoteAdsKillSwitch();
  assert.equal(isRemoteAdsEnabled(), false);
});

test("a thrown/rejected fetch (network error) resolves fail-closed, never throws out", async () => {
  const original = (globalThis as unknown as { fetch: typeof fetch }).fetch;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => {
    throw new Error("offline");
  }) as typeof fetch;
  restoreFetch = () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = original;
  };
  const state = await refreshRemoteAdsKillSwitch();
  assert.deepEqual(state, { enabled: false });
});

test("a previously-enabled state resets to fail-closed on a subsequent failure", async () => {
  restoreFetch = mockFetch(() => new Response(JSON.stringify({ enabled: true }), { status: 200 }));
  await refreshRemoteAdsKillSwitch();
  assert.equal(isRemoteAdsEnabled(), true);

  restoreFetch();
  restoreFetch = mockFetch(() => new Response("oops", { status: 500 }));
  await refreshRemoteAdsKillSwitch();
  assert.equal(isRemoteAdsEnabled(), false, "a later failure must turn ads back off, never keep a stale true");
});
