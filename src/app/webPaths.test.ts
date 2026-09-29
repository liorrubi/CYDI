// The bare /join page. The Play Together lobby prints "Enter it at playcydi.com/join"
// on its room-code card, and 0.54.1's real 404s made that address a 404 because
// only /join/<CODE> was a route. These pin the path rule and the app wiring; the
// Worker side (200 + noindex, look-alikes still 404) is in worker/notFound.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JOIN_PATH, isJoinPagePath } from "./webPaths.ts";

test("isJoinPagePath matches exactly /join, with or without a trailing slash", () => {
  assert.equal(JOIN_PATH, "/join");
  assert.equal(isJoinPagePath("/join"), true);
  assert.equal(isJoinPagePath("/join/"), true);
  assert.equal(isJoinPagePath("/join//"), true);
});

test("isJoinPagePath never matches an invite link or a look-alike", () => {
  for (const path of ["/join/ABC234", "/join/abc", "/joinx", "/join-now", "/JOIN", "/", "/play", "/x/join"]) {
    assert.equal(isJoinPagePath(path), false, path);
  }
});

test("the lobby still points guests at /join, the page this route serves", () => {
  const card = readFileSync(new URL("../components/multiplayer/RoomCodeCard.tsx", import.meta.url), "utf8");
  assert.match(card, /Enter it at playcydi\.com\/join</);
});

test("App opens Play Together's join form on /join and PlayTogetherScreen honours it", () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /isJoinPagePath\(location\.pathname\)\) return toPlayTogetherJoin\(\)/, "initial route");
  assert.match(app, /isJoinPagePath\(path\)\) \{\s*setScreen\(toPlayTogetherJoin\(\)\)/, "Back/Forward onto /join");
  assert.match(app, /openJoin=\{screen\.openJoin\}/, "prop passed through");
  const screen = readFileSync(new URL("../screens/PlayTogetherScreen.tsx", import.meta.url), "utf8");
  assert.match(screen, /initialJoinCode \|\| openJoin \? "join" : "menu"/, "join form opens without a code");
});
