import test from "node:test";
import assert from "node:assert/strict";

const { contentSourceFromCatalog } = await import("./remoteContentSource.ts");
const { buildCatalogFromLocalContent } = await import("./exportCatalog.ts");
const repo = await import("./contentRepository.ts");
const { CANVAS_SIZE } = await import("../app/constants.ts");

const catalog = buildCatalogFromLocalContent(7);
const remote = contentSourceFromCatalog(catalog, repo.localContentSource);

test("remote source mirrors the exported catalog's ids and order", () => {
  assert.deepEqual(
    remote.getAllShapes().map((s) => s.id),
    catalog.shapes.map((s) => s.id),
  );
  assert.deepEqual(
    remote.getCategories().map((c) => c.id),
    catalog.categories.map((c) => c.id),
  );
});

test("remote generate() reproduces the live generator within rounding tolerance", () => {
  const local = repo.localContentSource.getAllShapes();
  const remoteShapes = remote.getAllShapes();
  for (let i = 0; i < local.length; i++) {
    const livePath = local[i].generate(CANVAS_SIZE);
    const remotePath = remoteShapes[i].generate(CANVAS_SIZE);
    assert.equal(remotePath.points.length, livePath.points.length, local[i].id);
    for (let p = 0; p < livePath.points.length; p++) {
      assert.ok(Math.abs(remotePath.points[p].x - livePath.points[p].x) <= 0.006, `${local[i].id}[${p}].x`);
      assert.ok(Math.abs(remotePath.points[p].y - livePath.points[p].y) <= 0.006, `${local[i].id}[${p}].y`);
    }
    assert.deepEqual(remotePath.breaks, livePath.breaks && livePath.breaks.length > 0 ? livePath.breaks : undefined, local[i].id);
  }
});

test("remote generate() scales linearly to other sizes and rebuilds t as indices", () => {
  const shape = remote.getAllShapes()[0];
  const at320 = shape.generate(320);
  const at160 = shape.generate(160);
  assert.equal(at160.canvasWidth, 160);
  for (let i = 0; i < at320.points.length; i++) {
    assert.ok(Math.abs(at160.points[i].x - at320.points[i].x / 2) < 1e-9);
    assert.ok(Math.abs(at160.points[i].y - at320.points[i].y / 2) < 1e-9);
    assert.equal(at160.points[i].t, i);
  }
});

test("mega cards and artist packs delegate to the base (local) source", () => {
  assert.deepEqual(
    remote.getMegaCards().map((c) => c.id),
    repo.localContentSource.getMegaCards().map((c) => c.id),
  );
  assert.deepEqual(
    remote.getArtistPacks().map((p) => p.id),
    repo.localContentSource.getArtistPacks().map((p) => p.id),
  );
});

test("with a remote source active, getShapeById falls back to local for ids the catalog dropped", () => {
  const slim = {
    ...catalog,
    // Keep only the first category's shapes - everything else is "dropped".
    shapes: catalog.shapes.filter((s) => s.category === catalog.categories[0].id),
    categories: [catalog.categories[0]],
  };
  try {
    repo.setContentSource(contentSourceFromCatalog(slim, repo.localContentSource));
    const droppedId = catalog.shapes.find((s) => s.category !== catalog.categories[0].id)!.id;
    assert.equal(repo.getAllShapes().some((s) => s.id === droppedId), false, "shape really absent from active source");
    const resolved = repo.getShapeById(droppedId);
    assert.ok(resolved, "dropped id must still resolve via the local library");
    assert.equal(resolved!.id, droppedId);
  } finally {
    repo.resetContentSource();
  }
});

test("repository serves remote categories/shapes while a remote source is active", () => {
  try {
    repo.setContentSource(remote);
    assert.equal(repo.getAllShapes().length, catalog.shapes.length);
    assert.equal(repo.getCategories().length, catalog.categories.length);
    const firstCat = catalog.categories[0].id;
    assert.deepEqual(
      repo.getShapesForCategory(firstCat).map((s) => s.id),
      catalog.shapes.filter((s) => s.category === firstCat).map((s) => s.id),
    );
  } finally {
    repo.resetContentSource();
  }
});
