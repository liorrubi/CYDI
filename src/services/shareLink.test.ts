import test from "node:test";
import assert from "node:assert/strict";
import {
  buildArtistResultPayload,
  decodeArtistResultHash,
  encodeArtistResultLink,
  parseArtistResultPayload,
} from "./shareLink.ts";
import type { DrawingPath } from "../types/Challenge";
import type { ScoreBreakdown } from "../types/Score";

// A coordinate that ONLY ever appears in the reference artwork / draw-along
// guide, never in the player's own strokes. If it shows up anywhere in the
// shared payload or link, the guide has leaked.
const GUIDE_MARKER = 987654;

const guide: DrawingPath = {
  points: [
    { x: GUIDE_MARKER, y: GUIDE_MARKER, t: 0 },
    { x: GUIDE_MARKER, y: GUIDE_MARKER + 10, t: 0 },
  ],
  canvasWidth: 400,
  canvasHeight: 400,
};

const attempt: DrawingPath = {
  points: [
    { x: 40, y: 55, t: 0 },
    { x: 120, y: 130, t: 0 },
    { x: 210, y: 90, t: 0 },
  ],
  canvasWidth: 400,
  canvasHeight: 400,
};

const score: ScoreBreakdown = {
  total: 82,
  shapeMatch: 80,
  coverage: 85,
  smoothness: 78,
  scale: 90,
  message: "Nice work!",
};

const shareArgs = {
  artworkName: "Portrait Study",
  packName: "Nimco Design",
  artistName: "Nimrod Cohen",
  packId: "nimco",
  score,
  attempt,
  attemptColor: "black" as const,
};

// Scenario: the player had "Show Guide" ON while drawing (so `guide` was on
// screen). Sharing must still export ONLY their attempt — never the guide.
void guide; // the guide is deliberately never passed into any share builder.

test("artist result payload contains the attempt but never the guide/target", () => {
  const payload = buildArtistResultPayload(shareArgs);
  const serialized = JSON.stringify(payload);

  assert.ok(!serialized.includes(String(GUIDE_MARKER)), "guide coordinates must not appear in the share payload");
  assert.strictEqual((payload as Record<string, unknown>).t, undefined, "payload must not carry a target field");
  assert.ok(serialized.includes("40") && serialized.includes("55"), "the player's own strokes must be present");
});

test("decoded artist result exposes no guide/target, only the attempt", () => {
  const decoded = parseArtistResultPayload(buildArtistResultPayload(shareArgs));
  assert.ok(decoded, "payload should parse");
  assert.strictEqual((decoded as Record<string, unknown>).target, undefined);
  assert.strictEqual(decoded!.attempt.points.length, attempt.points.length);
  assert.strictEqual(decoded!.artistName, "Nimrod Cohen");
  assert.strictEqual(decoded!.packName, "Nimco Design");
  assert.strictEqual(decoded!.score.total, 82);
});

test("hash-link fallback round-trips the attempt and never encodes the guide", () => {
  // encodeArtistResultLink reads location; stub it for the Node test env.
  (globalThis as { location?: { origin: string; pathname: string } }).location = {
    origin: "https://playcydi.com",
    pathname: "/",
  };

  const link = encodeArtistResultLink(shareArgs);
  assert.ok(!link.includes(String(GUIDE_MARKER)), "guide coordinates must not appear in the share link");

  const hash = link.slice(link.indexOf("#") + 1);
  const decoded = decodeArtistResultHash(hash);
  assert.ok(decoded, "hash should decode back to a result");
  assert.strictEqual((decoded as Record<string, unknown>).target, undefined);
  assert.strictEqual(decoded!.attempt.points.length, attempt.points.length);
  assert.strictEqual(decoded!.attemptColor, "black");
});

// --- "Draw It Back" artworkId (aid) handling ---

test("artworkId round-trips through build/parse", () => {
  const decoded = parseArtistResultPayload(buildArtistResultPayload({ ...shareArgs, artworkId: "nimco-portrait" }));
  assert.strictEqual(decoded?.artworkId, "nimco-portrait");
});

test("artworkId round-trips through the hash-link encode/decode path", () => {
  (globalThis as { location?: { origin: string; pathname: string } }).location = {
    origin: "https://playcydi.com",
    pathname: "/",
  };
  const link = encodeArtistResultLink({ ...shareArgs, artworkId: "nimco-basketball-hoop" });
  const hash = link.slice(link.indexOf("#") + 1);
  const decoded = decodeArtistResultHash(hash);
  assert.strictEqual(decoded?.artworkId, "nimco-basketball-hoop");
});

test("a payload built without an artworkId (old-link simulation) decodes with artworkId undefined", () => {
  const decoded = parseArtistResultPayload(buildArtistResultPayload(shareArgs));
  assert.strictEqual(decoded?.artworkId, undefined);
  // everything else must still be fully usable
  assert.strictEqual(decoded?.artistName, "Nimrod Cohen");
  assert.strictEqual(decoded?.attempt.points.length, attempt.points.length);
});

test("an invalid aid is dropped (treated as absent), never rejecting the whole payload", () => {
  const cases: unknown[] = [
    "x".repeat(65), // too long
    "Nimco-Portrait", // uppercase not allowed
    "nimco portrait", // spaces not allowed
    "../../etc/passwd", // path-traversal-looking string
    12345, // wrong type entirely
    "", // empty string
  ];
  for (const badAid of cases) {
    const payload = { ...buildArtistResultPayload(shareArgs), aid: badAid };
    const decoded = parseArtistResultPayload(payload);
    assert.ok(decoded, `payload with aid=${JSON.stringify(badAid)} should still parse`);
    assert.strictEqual(decoded!.artworkId, undefined, `invalid aid=${JSON.stringify(badAid)} should be dropped`);
    assert.strictEqual(decoded!.artistName, "Nimrod Cohen", "the rest of the payload must remain intact");
  }
});

test("a valid aid at the maximum allowed length is accepted", () => {
  const maxId = "a".repeat(64);
  const decoded = parseArtistResultPayload(buildArtistResultPayload({ ...shareArgs, artworkId: maxId }));
  assert.strictEqual(decoded?.artworkId, maxId);
});
