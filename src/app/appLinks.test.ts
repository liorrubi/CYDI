import test from "node:test";
import assert from "node:assert/strict";
import { parseIncomingAppLinkId, resolveIncomingAppLinkId, SHORT_LINK_HOST } from "./appLinks.ts";

test("SHORT_LINK_HOST is the real production domain", () => {
  assert.equal(SHORT_LINK_HOST, "playcydi.com");
});

test("a valid /c/{id} playcydi.com link resolves to its id", () => {
  assert.equal(parseIncomingAppLinkId("https://playcydi.com/c/ASW7LB67"), "ASW7LB67");
});

test("a disallowed host is rejected, including a look-alike subdomain", () => {
  assert.equal(parseIncomingAppLinkId("https://evil.example.com/c/ASW7LB67"), null);
  assert.equal(parseIncomingAppLinkId("https://playcydi.com.evil.example.com/c/ASW7LB67"), null);
  assert.equal(parseIncomingAppLinkId("https://sub.playcydi.com/c/ASW7LB67"), null);
});

test("a disallowed scheme is rejected even with the right host and path", () => {
  assert.equal(parseIncomingAppLinkId("http://playcydi.com/c/ASW7LB67"), null);
});

test("a missing, malformed, or wrong-page path is rejected", () => {
  assert.equal(parseIncomingAppLinkId("https://playcydi.com/c/"), null);
  assert.equal(parseIncomingAppLinkId("https://playcydi.com/c/ab"), null); // below the 4-char id floor
  assert.equal(parseIncomingAppLinkId("https://playcydi.com/settings"), null);
  assert.equal(parseIncomingAppLinkId("https://playcydi.com/"), null);
});

test("an id with invalid characters or a not-actually-a-URL string is rejected", () => {
  assert.equal(parseIncomingAppLinkId("https://playcydi.com/c/../../etc"), null);
  assert.equal(parseIncomingAppLinkId("https://playcydi.com/c/abc$%^"), null);
  assert.equal(parseIncomingAppLinkId("not a url at all"), null);
});

test("cold start (getLaunchUrl) followed by a duplicate warm-start delivery of the same URL is only handled once", () => {
  const launchUrl = "https://playcydi.com/c/ASW7LB67";
  let lastHandled: string | null = null;

  // Cold start: getLaunchUrl() delivers the id that launched the app.
  const fromColdStart = resolveIncomingAppLinkId(launchUrl, lastHandled);
  assert.equal(fromColdStart, "ASW7LB67");
  lastHandled = launchUrl; // callers only advance tracking once an id came back

  // Capacitor can redeliver the identical URL via an appUrlOpen event right
  // after getLaunchUrl() resolves the same cold-start intent - must be a no-op.
  const duplicateWarmStart = resolveIncomingAppLinkId(launchUrl, lastHandled);
  assert.equal(duplicateWarmStart, null, "the exact same URL must not be handled twice");
});

test("a genuinely different warm-start link opened after the first is still handled", () => {
  const lastHandled = "https://playcydi.com/c/ASW7LB67";
  const secondLink = "https://playcydi.com/c/DIFFERENTID1";
  assert.equal(resolveIncomingAppLinkId(secondLink, lastHandled), "DIFFERENTID1");
});

test("an invalid warm-start URL never updates what counts as 'handled' (an app not tracking it would still be fine)", () => {
  const lastHandled = "https://playcydi.com/c/ASW7LB67";
  assert.equal(resolveIncomingAppLinkId("https://evil.example.com/c/ASW7LB67", lastHandled), null);
});
