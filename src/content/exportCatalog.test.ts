import test from "node:test";
import assert from "node:assert/strict";

const { buildCatalogFromLocalContent } = await import("./exportCatalog.ts");
const { validateCatalog } = await import("./catalogSchema.ts");
const { getAllShapes, getCategories } = await import("./contentRepository.ts");
const { CANVAS_SIZE } = await import("../app/constants.ts");

const catalog = buildCatalogFromLocalContent(1);

test("exported catalog passes the shared validation", () => {
  const result = validateCatalog(catalog);
  assert.ok(result.ok, !result.ok ? result.error : "");
});

test("exported catalog preserves every shape id in library order", () => {
  assert.deepEqual(
    catalog.shapes.map((s) => s.id),
    getAllShapes().map((s) => s.id),
  );
});

test("exported catalog preserves category records and their order", () => {
  assert.deepEqual(catalog.categories, getCategories().map((c) => ({ id: c.id, name: c.name, icon: c.icon })));
});

test("exported catalog preserves each shape's category and name", () => {
  const byId = new Map(catalog.shapes.map((s) => [s.id, s]));
  for (const shape of getAllShapes()) {
    const exported = byId.get(shape.id)!;
    assert.equal(exported.category, shape.category, shape.id);
    assert.equal(exported.name, shape.name, shape.id);
  }
});

test("serialized points match the live generators within rounding tolerance", () => {
  const byId = new Map(catalog.shapes.map((s) => [s.id, s]));
  for (const shape of getAllShapes()) {
    const live = shape.generate(CANVAS_SIZE);
    const exported = byId.get(shape.id)!;
    assert.equal(exported.path.points.length, live.points.length, `${shape.id}: point count`);
    for (let i = 0; i < live.points.length; i++) {
      const [ex, ey] = exported.path.points[i];
      assert.ok(Math.abs(ex - live.points[i].x) <= 0.005 + 1e-9, `${shape.id}[${i}].x`);
      assert.ok(Math.abs(ey - live.points[i].y) <= 0.005 + 1e-9, `${shape.id}[${i}].y`);
    }
    const liveBreaks = live.breaks && live.breaks.length > 0 ? live.breaks : undefined;
    assert.deepEqual(exported.path.breaks, liveBreaks, `${shape.id}: breaks`);
  }
});

test("catalog canvasSize matches the game canvas", () => {
  assert.equal(catalog.canvasSize, CANVAS_SIZE);
});
