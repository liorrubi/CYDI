import test from "node:test";
import assert from "node:assert/strict";

const {
  getAllShapes,
  getCategories,
  getCategoryById,
  getMegaAlbumSize,
  getMegaCards,
  getPlayerFacingPacks,
  getShapeById,
  getShapesForCategory,
  getVisibleArtworks,
} = await import("./contentRepository.ts");

// ---------- Stable-id invariants: every piece of content the game can ever
// ---------- reference (progress keys, daily-challenge shapeId, share links,
// ---------- mega album, artist packs) must have a unique, non-empty id.

function assertUniqueNonEmptyIds(ids: string[], label: string): void {
  for (const id of ids) {
    assert.ok(typeof id === "string" && id.length > 0, `${label}: empty/missing id`);
  }
  const seen = new Set<string>();
  for (const id of ids) {
    assert.ok(!seen.has(id), `${label}: duplicate id "${id}"`);
    seen.add(id);
  }
}

test("category ids are unique and non-empty", () => {
  assertUniqueNonEmptyIds(getCategories().map((c) => c.id), "categories");
});

test("shape ids are unique and non-empty across the whole library", () => {
  assertUniqueNonEmptyIds(getAllShapes().map((s) => s.id), "shapes");
});

test("mega card ids are unique, non-empty, and never collide with shape ids", () => {
  const megaIds = getMegaCards().map((c) => c.id);
  assertUniqueNonEmptyIds(megaIds, "mega cards");
  // bestScores for shapes and mega cards live in different save fields, but a
  // shared id would still be a content-authoring smell - keep them disjoint.
  const shapeIds = new Set(getAllShapes().map((s) => s.id));
  for (const id of megaIds) assert.ok(!shapeIds.has(id), `mega card id "${id}" collides with a shape id`);
});

test("artist pack + artwork ids are unique and non-empty", () => {
  const packs = getPlayerFacingPacks();
  assertUniqueNonEmptyIds(packs.map((p) => p.id), "artist packs");
  for (const pack of packs) {
    assertUniqueNonEmptyIds(getVisibleArtworks(pack).map((a) => a.id), `artworks of pack "${pack.id}"`);
  }
});

// ---------- Referential integrity: nothing points at content that doesn't exist.

test("every shape's category exists in the category list", () => {
  const categoryIds = new Set(getCategories().map((c) => c.id));
  for (const shape of getAllShapes()) {
    assert.ok(categoryIds.has(shape.category), `shape "${shape.id}" references unknown category "${shape.category}"`);
  }
});

test("every category has at least one shape (no empty level maps)", () => {
  for (const category of getCategories()) {
    assert.ok(getShapesForCategory(category.id).length > 0, `category "${category.id}" has no shapes`);
  }
});

test("getShapeById resolves every listed shape and rejects unknown ids", () => {
  for (const shape of getAllShapes()) {
    assert.equal(getShapeById(shape.id)?.id, shape.id);
  }
  assert.equal(getShapeById("definitely-not-a-real-shape-id"), undefined);
});

test("getCategoryById resolves every listed category and rejects unknown ids", () => {
  for (const category of getCategories()) {
    assert.equal(getCategoryById(category.id)?.id, category.id);
  }
  assert.equal(getCategoryById("definitely-not-a-real-category"), undefined);
});

// ---------- Order integrity: level order is data the whole game trusts.

test("shapesForCategory preserves library order and covers the full library exactly once", () => {
  const all = getAllShapes();
  let covered = 0;
  for (const category of getCategories()) {
    const inCategory = getShapesForCategory(category.id);
    covered += inCategory.length;
    // Within a category, level order must match overall library order.
    const libraryOrder = all.filter((s) => s.category === category.id).map((s) => s.id);
    assert.deepEqual(
      inCategory.map((s) => s.id),
      libraryOrder,
      `category "${category.id}" order diverges from library order`,
    );
  }
  assert.equal(covered, all.length, "some shape belongs to no category or is double-counted");
});

test("mega album size equals the number of mega cards", () => {
  assert.equal(getMegaAlbumSize(), getMegaCards().length);
});

// ---------- Generators: every shape must actually produce a drawable path.

test("every shape and mega card generates a non-empty DrawingPath", () => {
  const SIZE = 300;
  for (const shape of [...getAllShapes(), ...getMegaCards()]) {
    const path = shape.generate(SIZE);
    assert.ok(path.points.length > 1, `shape "${shape.id}" generated ${path.points.length} points`);
    assert.equal(path.canvasWidth, SIZE);
    assert.equal(path.canvasHeight, SIZE);
  }
});
