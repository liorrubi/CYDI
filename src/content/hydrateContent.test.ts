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

const { applyCachedCatalog, getCachedCatalog, getCachedReleaseId, RELEASE_CACHE_KEY } = await import("./hydrateContent.ts");
const { buildCatalogFromLocalContent } = await import("./exportCatalog.ts");
const { sha256Hex } = await import("./catalogSchema.ts");
const repo = await import("./contentRepository.ts");

async function makeReleaseRaw(contentVersion: number, mutate?: (release: Record<string, unknown>) => void): Promise<string> {
  const catalog = buildCatalogFromLocalContent(contentVersion);
  const catalogJson = JSON.stringify(catalog);
  const release: Record<string, unknown> = {
    releaseId: `r-${1784700000000 + contentVersion}-TEST${contentVersion}`,
    catalogHash: await sha256Hex(catalogJson),
    publishedAt: "2026-07-22T00:00:00.000Z",
    contentVersion: catalog.contentVersion,
    formatVersion: catalog.formatVersion,
    catalogJson,
  };
  mutate?.(release);
  return JSON.stringify(release);
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

test("valid cached release is applied as the active source", async () => {
  store.clear();
  store.set(RELEASE_CACHE_KEY, await makeReleaseRaw(11));
  try {
    const result = applyCachedCatalog();
    assert.equal(result.applied, true);
    assert.equal(result.contentVersion, 11);
    assert.equal(result.releaseId, "r-1784700000011-TEST11");
    assert.equal(repo.getAllShapes().length, repo.localContentSource.getAllShapes().length);
  } finally {
    repo.resetContentSource();
  }
});

test("corrupt cached JSON is rejected AND removed; local content stays", () => {
  store.clear();
  store.set(RELEASE_CACHE_KEY, "{corrupt!!!");
  try {
    const result = applyCachedCatalog();
    assert.equal(result.applied, false);
    assert.equal(store.has(RELEASE_CACHE_KEY), false, "corrupt cache must be cleared");
  } finally {
    repo.resetContentSource();
  }
});

test("a cached release whose embedded catalog has an unsupported formatVersion is rejected and cleared", async () => {
  store.clear();
  const catalog = { ...buildCatalogFromLocalContent(12), formatVersion: 999 };
  const catalogJson = JSON.stringify(catalog);
  store.set(
    RELEASE_CACHE_KEY,
    JSON.stringify({
      releaseId: "r-1784700000012-TESTX",
      catalogHash: await sha256Hex(catalogJson),
      publishedAt: "2026-07-22T00:00:00.000Z",
      contentVersion: catalog.contentVersion,
      formatVersion: 999,
      catalogJson,
    }),
  );
  try {
    const result = applyCachedCatalog();
    assert.equal(result.applied, false);
    assert.ok(result.reason?.includes("formatVersion"));
    assert.equal(store.has(RELEASE_CACHE_KEY), false);
  } finally {
    repo.resetContentSource();
  }
});

test("an envelope with a tampered releaseId is rejected", async () => {
  store.clear();
  store.set(RELEASE_CACHE_KEY, await makeReleaseRaw(13, (r) => (r.releaseId = "../../etc/passwd")));
  try {
    assert.equal(applyCachedCatalog().applied, false);
  } finally {
    repo.resetContentSource();
  }
});

test("getCachedCatalog exposes the parsed catalog; getCachedReleaseId is cheap and matches", async () => {
  store.clear();
  store.set(RELEASE_CACHE_KEY, await makeReleaseRaw(14));
  const cached = getCachedCatalog();
  assert.ok(cached);
  assert.equal(cached!.releaseId, "r-1784700000014-TEST14");
  assert.equal(cached!.catalog.contentVersion, 14);
  assert.equal(getCachedReleaseId(), "r-1784700000014-TEST14");
});

test("legacy phase-1 cache key is dropped on boot", () => {
  store.clear();
  store.set("cydi.contentCatalog.v1", "{}");
  applyCachedCatalog();
  assert.equal(store.has("cydi.contentCatalog.v1"), false);
  repo.resetContentSource();
});
