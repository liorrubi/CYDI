import test from "node:test";
import assert from "node:assert/strict";

const { resolveDailyShape } = await import("./dailyShapeResolver.ts");
const { localContentSource } = await import("../content/contentRepository.ts");

const localShapes = localContentSource.getAllShapes();
const someShape = localShapes[0];
const remoteOnlyShape = { id: "remote-test-shape-v1", name: "Remote Test", category: "geometric" as const, generate: someShape.generate };

function deps(overrides: Partial<Parameters<typeof resolveDailyShape>[1]>) {
  const calls = { refreshes: 0, fallbacks: [] as { requestedId: string; substituteId: string; hadCache: boolean }[] };
  const base = {
    resolveActive: () => undefined,
    resolveCached: () => undefined,
    refresh: async () => {
      calls.refreshes++;
    },
    substitutePool: () => localShapes,
    hasCache: () => false,
    reportFallback: (requestedId: string, substituteId: string, hadCache: boolean) =>
      calls.fallbacks.push({ requestedId, substituteId, hadCache }),
    ...overrides,
  };
  return { deps: base, calls };
}

test("shape in the active catalog resolves immediately - no refresh, no fallback", async () => {
  const { deps: d, calls } = deps({ resolveActive: () => someShape });
  const result = await resolveDailyShape(someShape.id, d);
  assert.equal(result.source, "active");
  assert.equal(result.shape.id, someShape.id);
  assert.equal(calls.refreshes, 0);
  assert.equal(calls.fallbacks.length, 0);
});

test("shape missing from active source but present in the cached release resolves from cache", async () => {
  const { deps: d, calls } = deps({ resolveCached: (id) => (id === remoteOnlyShape.id ? remoteOnlyShape : undefined) });
  const result = await resolveDailyShape(remoteOnlyShape.id, d);
  assert.equal(result.source, "cached-release");
  assert.equal(result.shape.id, remoteOnlyShape.id);
  assert.equal(calls.refreshes, 0);
});

test("new remote shape with an old cache triggers ONE refresh then resolves", async () => {
  let downloaded = false;
  const { deps: d, calls } = deps({
    resolveCached: (id) => (downloaded && id === remoteOnlyShape.id ? remoteOnlyShape : undefined),
    refresh: async () => {
      calls.refreshes++;
      downloaded = true;
    },
  });
  const result = await resolveDailyShape(remoteOnlyShape.id, d);
  assert.equal(result.source, "refreshed-release");
  assert.equal(result.shape.id, remoteOnlyShape.id);
  assert.equal(calls.refreshes, 1);
  assert.equal(calls.fallbacks.length, 0);
});

test("offline client (refresh cannot help) falls back to a deterministic local substitute and reports it", async () => {
  const { deps: d, calls } = deps({});
  const result = await resolveDailyShape(remoteOnlyShape.id, d);
  assert.equal(result.source, "local-substitute");
  assert.ok(localShapes.some((s) => s.id === result.shape.id), "substitute comes from the local library");
  assert.equal(calls.refreshes, 1, "exactly one refresh attempt - never a fetch loop");
  assert.deepEqual(calls.fallbacks, [{ requestedId: remoteOnlyShape.id, substituteId: result.shape.id, hadCache: false }]);

  // Determinism: same requested id -> same substitute, every time, on every device.
  const again = await resolveDailyShape(remoteOnlyShape.id, deps({}).deps);
  assert.equal(again.shape.id, result.shape.id);
});

test("a throwing refresh still ends in a safe substitute (never crashes)", async () => {
  const { deps: d } = deps({
    refresh: async () => {
      throw new Error("network exploded");
    },
  });
  const result = await resolveDailyShape(remoteOnlyShape.id, d);
  assert.equal(result.source, "local-substitute");
  assert.ok(result.shape);
});

test("hadCache is reported when a (stale) cache exists", async () => {
  const { deps: d, calls } = deps({ hasCache: () => true });
  await resolveDailyShape(remoteOnlyShape.id, d);
  assert.equal(calls.fallbacks[0].hadCache, true);
});
