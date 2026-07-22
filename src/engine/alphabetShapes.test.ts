// Validates the English Alphabet category: exactly 26 letters A–Z, stable unique
// ids, in-bounds coordinates, valid part breaks, a scoreable guide for every
// letter (a perfect self-trace scores high), and graceful progression defaults so
// existing saves (which have no "alphabet" key) are unaffected.

import { strict as assert } from "node:assert";
import { test } from "node:test";

// constants.ts / scoring.ts read build-time globals injected by Vite; stub them
// before importing anything that transitively pulls them in (plain Node has none).
(globalThis as unknown as { __APP_BUILD__: string }).__APP_BUILD__ = "test";
(globalThis as unknown as { __APP_BUILD_TIME__: string }).__APP_BUILD_TIME__ = "test";

const { ALPHABET_SHAPES } = await import("./alphabetShapes.ts");
const { SHAPE_LIBRARY, shapesForCategory, CATEGORIES } = await import("./shapeLibrary.ts");
const { CANVAS_SIZE } = await import("../app/constants.ts");
const { scoreAttempt } = await import("./scoring.ts");
const { getCategoryCompletedCount } = await import("../services/shapeChallengeProgress.ts");

const A_TO_Z = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

test("there are exactly 26 alphabet shapes", () => {
  assert.equal(ALPHABET_SHAPES.length, 26);
});

test("letters are in strict A–Z order by name and id", () => {
  assert.deepEqual(ALPHABET_SHAPES.map((s) => s.name), A_TO_Z);
  assert.deepEqual(
    ALPHABET_SHAPES.map((s) => s.id),
    A_TO_Z.map((c) => `alphabet-${c.toLowerCase()}`),
  );
  assert.ok(ALPHABET_SHAPES.every((s) => s.category === "alphabet"));
});

test("alphabet order is preserved through shapesForCategory (level/play order)", () => {
  const inCategory = shapesForCategory("alphabet");
  assert.equal(inCategory.length, 26);
  assert.deepEqual(inCategory.map((s) => s.name), A_TO_Z);
});

test("alphabet ids are unique and do not collide with any existing shape id", () => {
  const alphabetIds = ALPHABET_SHAPES.map((s) => s.id);
  assert.equal(new Set(alphabetIds).size, 26, "alphabet ids must be unique");
  const allIds = SHAPE_LIBRARY.map((s) => s.id);
  assert.equal(new Set(allIds).size, allIds.length, "no duplicate ids across the whole library");
});

test("the category is registered once with the expected title/icon", () => {
  const entries = CATEGORIES.filter((c) => c.id === "alphabet");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, "English Alphabet");
  assert.equal(entries[0].icon, "🔤");
  assert.notEqual(CATEGORIES[0].id, "alphabet", "must not be the first (free) category");
});

test("every letter generates a non-empty, in-bounds guide with valid breaks", () => {
  for (const shape of ALPHABET_SHAPES) {
    const path = shape.generate(CANVAS_SIZE);
    assert.ok(path.points.length >= 8, `${shape.name}: guide should have enough points`);
    for (const p of path.points) {
      assert.ok(p.x >= 0 && p.x <= CANVAS_SIZE, `${shape.name}: x ${p.x} out of bounds`);
      assert.ok(p.y >= 0 && p.y <= CANVAS_SIZE, `${shape.name}: y ${p.y} out of bounds`);
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${shape.name}: non-finite coordinate`);
    }
    if (path.breaks) {
      let prev = 0;
      for (const b of path.breaks) {
        assert.ok(b > prev && b < path.points.length, `${shape.name}: break ${b} out of range`);
        prev = b;
      }
    }
  }
});

test("every letter guide is scoreable: a perfect self-trace scores highly", () => {
  for (const shape of ALPHABET_SHAPES) {
    const guide = shape.generate(CANVAS_SIZE);
    const result = scoreAttempt(guide, guide);
    assert.ok(result.total >= 90, `${shape.name}: self-trace scored ${result.total}, expected >= 90`);
  }
});

test("a fresh/empty progress defaults the new category to level 0 (existing saves unaffected)", () => {
  const emptyProgress = { levelIndexByCategory: {}, bestScores: {} };
  assert.equal(getCategoryCompletedCount(emptyProgress, "alphabet"), 0);
});
