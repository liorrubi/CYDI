import test from "node:test";
import assert from "node:assert/strict";

const { validateCatalog, parseCatalogJson, CATALOG_FORMAT_VERSION, MAX_POINTS_PER_SHAPE, MAX_SHAPES } = await import(
  "./catalogSchema.ts"
);

function goodCatalog() {
  return {
    formatVersion: CATALOG_FORMAT_VERSION,
    contentVersion: 3,
    generatedAt: "2026-07-22T00:00:00.000Z",
    canvasSize: 320,
    categories: [
      { id: "geometric", name: "Geometric Shapes", icon: "🔷" },
      { id: "symbols", name: "Symbols", icon: "♾️" },
    ],
    shapes: [
      { id: "circle", name: "Circle", category: "geometric", path: { points: [[10, 10], [20, 20], [30, 10]] } },
      { id: "sym-heart", name: "Heart", category: "symbols", path: { points: [[5, 5], [15, 25]], breaks: [1] } },
    ],
  };
}

test("a well-formed catalog validates", () => {
  const result = validateCatalog(goodCatalog());
  assert.ok(result.ok, !result.ok ? result.error : "");
});

test("parseCatalogJson round-trips a serialized catalog", () => {
  const result = parseCatalogJson(JSON.stringify(goodCatalog()));
  assert.ok(result.ok);
  assert.equal(result.ok && result.catalog.shapes.length, 2);
});

test("rejects invalid JSON text", () => {
  assert.equal(parseCatalogJson("{not json").ok, false);
});

test("rejects a NEWER formatVersion (old client + new server must fall back, never crash)", () => {
  const c = { ...goodCatalog(), formatVersion: CATALOG_FORMAT_VERSION + 1 };
  const result = validateCatalog(c);
  assert.equal(result.ok, false);
});

test("rejects an older/zero formatVersion", () => {
  assert.equal(validateCatalog({ ...goodCatalog(), formatVersion: 0 }).ok, false);
});

test("rejects non-positive or non-integer contentVersion", () => {
  assert.equal(validateCatalog({ ...goodCatalog(), contentVersion: 0 }).ok, false);
  assert.equal(validateCatalog({ ...goodCatalog(), contentVersion: 1.5 }).ok, false);
  assert.equal(validateCatalog({ ...goodCatalog(), contentVersion: "7" }).ok, false);
});

test("rejects duplicate shape ids", () => {
  const c = goodCatalog();
  c.shapes.push({ ...c.shapes[0] });
  assert.equal(validateCatalog(c).ok, false);
});

test("rejects duplicate category ids", () => {
  const c = goodCatalog();
  c.categories.push({ ...c.categories[0] });
  assert.equal(validateCatalog(c).ok, false);
});

test("rejects a shape referencing an unknown category", () => {
  const c = goodCatalog();
  c.shapes[0].category = "no-such-category";
  assert.equal(validateCatalog(c).ok, false);
});

test("rejects a category with no shapes (would render an empty level map)", () => {
  const c = goodCatalog();
  c.categories.push({ id: "empty-cat", name: "Empty", icon: "❓" });
  assert.equal(validateCatalog(c).ok, false);
});

test("rejects missing/short/oversized points", () => {
  const c = goodCatalog();
  c.shapes[0].path.points = [[1, 1]]; // fewer than 2
  assert.equal(validateCatalog(c).ok, false);

  const c2 = goodCatalog();
  c2.shapes[0].path.points = Array.from({ length: MAX_POINTS_PER_SHAPE + 1 }, (_, i) => [i % 320, i % 320] as [number, number]);
  assert.equal(validateCatalog(c2).ok, false);
});

test("rejects non-finite and far-out-of-canvas coordinates", () => {
  const c = goodCatalog();
  c.shapes[0].path.points = [[10, 10], [Number.NaN, 20]];
  assert.equal(validateCatalog(c).ok, false);

  const c2 = goodCatalog();
  c2.shapes[0].path.points = [[10, 10], [99999, 20]];
  assert.equal(validateCatalog(c2).ok, false);
});

test("allows slight overshoot beyond the canvas edge", () => {
  const c = goodCatalog();
  c.shapes[0].path.points = [[-10, 5], [330, 340], [160, 160]];
  assert.ok(validateCatalog(c).ok);
});

test("rejects malformed breaks (non-increasing, out of range, too many)", () => {
  const bad = [[0], [4], [1, 1], [5]];
  for (const breaks of bad) {
    const c = goodCatalog();
    c.shapes[0].path.breaks = breaks as number[];
    assert.equal(validateCatalog(c).ok, false, `breaks ${JSON.stringify(breaks)} should be rejected`);
  }
});

test("accepts valid breaks, including the trailing break toPathFromParts emits", () => {
  const c = goodCatalog();
  c.shapes[0].path.points = [[1, 1], [2, 2], [3, 3], [4, 4]];
  c.shapes[0].path.breaks = [1, 3];
  assert.ok(validateCatalog(c).ok);

  const c2 = goodCatalog();
  c2.shapes[0].path.points = [[1, 1], [2, 2], [3, 3], [4, 4]];
  c2.shapes[0].path.breaks = [2, 4]; // trailing break == points.length
  assert.ok(validateCatalog(c2).ok);
});

test("rejects catalogs over the shape-count cap", () => {
  const c = goodCatalog();
  c.shapes = Array.from({ length: MAX_SHAPES + 1 }, (_, i) => ({
    id: `s-${i}`,
    name: `S ${i}`,
    category: "geometric",
    path: { points: [[1, 1], [2, 2]] as [number, number][] },
  }));
  assert.equal(validateCatalog(c).ok, false);
});

test("rejects ids with unsafe characters", () => {
  const c = goodCatalog();
  c.shapes[0].id = "bad id!<script>";
  assert.equal(validateCatalog(c).ok, false);
});

test("rejects non-object payloads", () => {
  for (const v of [null, [], "x", 42]) assert.equal(validateCatalog(v).ok, false);
});

// --- Release envelope ---

const { validateReleaseEnvelope, parseReleaseJson, sha256Hex, RELEASE_ID_PATTERN, MAX_TOTAL_POINTS, MAX_POINTS_PER_SHAPE: MAX_PPS } =
  await import("./catalogSchema.ts");

async function goodRelease() {
  const catalogJson = JSON.stringify(goodCatalog());
  return {
    releaseId: "r-1784700000000-Ab12Cd",
    catalogHash: await sha256Hex(catalogJson),
    publishedAt: "2026-07-22T12:00:00.000Z",
    contentVersion: 3,
    formatVersion: CATALOG_FORMAT_VERSION,
    catalogJson,
  };
}

test("a well-formed release envelope validates and exposes the parsed catalog", async () => {
  const result = validateReleaseEnvelope(await goodRelease());
  assert.ok(result.ok, !result.ok ? result.error : "");
  assert.equal(result.ok && result.catalog.shapes.length, 2);
});

test("parseReleaseJson round-trips", async () => {
  const result = parseReleaseJson(JSON.stringify(await goodRelease()));
  assert.ok(result.ok);
});

test("release with a malformed releaseId is rejected", async () => {
  for (const bad of ["", "not-a-release", "r-abc-XY12", "r-1784700000000-", "x-1784700000000-Ab12Cd"]) {
    const r = { ...(await goodRelease()), releaseId: bad };
    assert.equal(validateReleaseEnvelope(r).ok, false, bad);
  }
});

test("release with a malformed hash is rejected", async () => {
  for (const bad of ["", "zz".repeat(32), "abcd", "A".repeat(64)]) {
    const r = { ...(await goodRelease()), catalogHash: bad };
    assert.equal(validateReleaseEnvelope(r).ok, false, bad);
  }
});

test("release whose contentVersion/formatVersion disagree with the embedded catalog is rejected", async () => {
  const r1 = { ...(await goodRelease()), contentVersion: 999 };
  assert.equal(validateReleaseEnvelope(r1).ok, false);
  const r2 = { ...(await goodRelease()), formatVersion: 999 };
  assert.equal(validateReleaseEnvelope(r2).ok, false);
});

test("release embedding an invalid catalog is rejected", async () => {
  const r = { ...(await goodRelease()), catalogJson: "{}" };
  const result = validateReleaseEnvelope(r);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.error.includes("embedded catalog"));
});

test("releaseId pattern matches what the Worker generates", () => {
  assert.ok(RELEASE_ID_PATTERN.test(`r-${Date.now()}-A1b2C3`));
});

test("catalog exceeding the total point budget is rejected", () => {
  // Enough max-size shapes to blow the whole-catalog budget.
  const shapeCount = Math.ceil(MAX_TOTAL_POINTS / MAX_PPS) + 1;
  const points = Array.from({ length: MAX_PPS }, (_, i) => [i % 320, (i * 7) % 320] as [number, number]);
  const c = {
    ...goodCatalog(),
    shapes: Array.from({ length: shapeCount }, (_, i) => ({
      id: `bulk-${i}`,
      name: `Bulk ${i}`,
      category: "geometric",
      path: { points },
    })),
  };
  const result = validateCatalog(c);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.error.includes("total point budget"));
});

test("sha256Hex produces the expected digest", async () => {
  // Known vector: sha256("abc")
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
