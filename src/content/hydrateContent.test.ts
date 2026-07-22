import test from "node:test";
import assert from "node:assert/strict";

// hydrateContent touches localStorage at call time (never module load) - a
// tiny in-memory stub is enough for Node.
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};

const { applyCachedCatalog, CATALOG_CACHE_KEY } = await import("./hydrateContent.ts");
const { buildCatalogFromLocalContent } = await import("./exportCatalog.ts");
const repo = await import("./contentRepository.ts");

function seedCache(value: string): void {
  store.set(CATALOG_CACHE_KEY, value);
}

test("no cache -> nothing applied, local content stays active", () => {
  store.clear();
  try {
    const result = applyCachedCatalog();
    assert.equal(result.applied, false);
    assert.equal(repo.getAllShapes().length, repo.localContentSource.getAllShapes().length);
  } finally {
    repo.resetContentSource();
  }
});

test("valid cached catalog is applied as the active source", () => {
  store.clear();
  const catalog = buildCatalogFromLocalContent(11);
  seedCache(JSON.stringify(catalog));
  try {
    const result = applyCachedCatalog();
    assert.equal(result.applied, true);
    assert.equal(result.contentVersion, 11);
    assert.equal(repo.getAllShapes().length, catalog.shapes.length);
  } finally {
    repo.resetContentSource();
  }
});

test("corrupt cached JSON is rejected AND removed; local content stays", () => {
  store.clear();
  seedCache("{corrupt!!!");
  try {
    const result = applyCachedCatalog();
    assert.equal(result.applied, false);
    assert.equal(store.has(CATALOG_CACHE_KEY), false, "corrupt cache must be cleared");
  } finally {
    repo.resetContentSource();
  }
});

test("a cached catalog with an unsupported (newer) formatVersion is rejected and cleared", () => {
  store.clear();
  const catalog = buildCatalogFromLocalContent(12);
  seedCache(JSON.stringify({ ...catalog, formatVersion: 999 }));
  try {
    const result = applyCachedCatalog();
    assert.equal(result.applied, false);
    assert.ok(result.reason?.includes("formatVersion"));
    assert.equal(store.has(CATALOG_CACHE_KEY), false);
  } finally {
    repo.resetContentSource();
  }
});

test("a structurally valid catalog with missing ids/categories is rejected", () => {
  store.clear();
  const catalog = buildCatalogFromLocalContent(13);
  const broken = { ...catalog, shapes: catalog.shapes.map((s, i) => (i === 0 ? { ...s, category: "ghost-category" } : s)) };
  seedCache(JSON.stringify(broken));
  try {
    const result = applyCachedCatalog();
    assert.equal(result.applied, false);
    assert.equal(repo.getAllShapes().length, repo.localContentSource.getAllShapes().length, "local content stays active");
  } finally {
    repo.resetContentSource();
  }
});
