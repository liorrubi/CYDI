import assert from "node:assert/strict";
import test from "node:test";
import { parseIncomingJoinCode, resolveIncomingJoinCode } from "./appLinks.ts";

// The Android intent-filter routes https://playcydi.com/join/<CODE> into the
// app, but that is OS routing, not validation: another app can hand the
// Capacitor bridge any string it likes. These cover the gate that actually
// decides what the app acts on.

test("a canonical invite link yields its room code", () => {
  assert.equal(parseIncomingJoinCode("https://playcydi.com/join/TEST77"), "TEST77");
  assert.equal(parseIncomingJoinCode("https://playcydi.com/join/TEST77/"), "TEST77", "a trailing slash is fine");
});

test("a lower-case code is normalised", () => {
  // Links get retyped and copied in every case; the canonical code is upper.
  assert.equal(parseIncomingJoinCode("https://playcydi.com/join/test77"), "TEST77");
  assert.equal(parseIncomingJoinCode("https://playcydi.com/join/TeSt77"), "TEST77");
});

test("a query string or fragment does not break the match", () => {
  assert.equal(parseIncomingJoinCode("https://playcydi.com/join/TEST77?utm=whatsapp"), "TEST77");
  assert.equal(parseIncomingJoinCode("https://playcydi.com/join/TEST77#x"), "TEST77");
});

test("only our own host over https is accepted", () => {
  assert.equal(parseIncomingJoinCode("http://playcydi.com/join/TEST77"), null, "plain http");
  assert.equal(parseIncomingJoinCode("https://evil.example/join/TEST77"), null, "another host");
  assert.equal(parseIncomingJoinCode("https://playcydi.com.evil.example/join/TEST77"), null, "suffix host");
  assert.equal(parseIncomingJoinCode("https://sub.playcydi.com/join/TEST77"), null, "subdomain");
});

test("the path must be exactly the invite path", () => {
  assert.equal(parseIncomingJoinCode("https://playcydi.com/join"), null);
  assert.equal(parseIncomingJoinCode("https://playcydi.com/joinTEST77"), null);
  assert.equal(parseIncomingJoinCode("https://playcydi.com/x/join/TEST77"), null);
  assert.equal(parseIncomingJoinCode("https://playcydi.com/join/TEST77/extra"), null);
  assert.equal(parseIncomingJoinCode("https://playcydi.com/c/TEST77"), null, "the share-link path is a different feature");
});

test("codes outside the room-code alphabet are rejected", () => {
  // 0/O and 1/I are excluded so a code can be read aloud; a link containing
  // them was mistyped or fabricated.
  assert.equal(parseIncomingJoinCode("https://playcydi.com/join/TES0T7"), null);
  assert.equal(parseIncomingJoinCode("https://playcydi.com/join/TESIT7"), null);
  assert.equal(parseIncomingJoinCode("https://playcydi.com/join/TEST7"), null, "too short");
  assert.equal(parseIncomingJoinCode("https://playcydi.com/join/TEST777"), null, "too long");
});

test("garbage never throws", () => {
  for (const bad of ["", "not a url", "javascript:alert(1)", "playcydi.com/join/TEST77", "//playcydi.com/join/TEST77"]) {
    assert.equal(parseIncomingJoinCode(bad), null, bad);
  }
});

test("the same URL is only acted on once", () => {
  // Capacitor can redeliver an identical cold-start URL through both
  // getLaunchUrl() and a following appUrlOpen; acting twice would re-navigate.
  const url = "https://playcydi.com/join/TEST77";
  assert.equal(resolveIncomingJoinCode(url, null), "TEST77");
  assert.equal(resolveIncomingJoinCode(url, url), null, "redelivery is ignored");
  assert.equal(resolveIncomingJoinCode(url, "https://playcydi.com/join/ABC234"), "TEST77", "a different URL still counts");
});
