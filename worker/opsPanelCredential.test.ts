// The Ops Panel's own credentials (OPS_GUARD_ADMIN_TOKEN, OPS_ANALYTICS_GUARD_ADMIN_TOKEN).
//
// What must hold: each is a SECOND key to exactly one guard's config GET/PUT pair and
// narrower than the operator token beside it - no status route, no other admin surface,
// and the analytics one can never move the `disabled` breaker. The operator tokens must
// keep working exactly as before, whether or not the panel's secrets are bound.
import test from "node:test";
import assert from "node:assert/strict";

const worker = (await import("./index.ts")).default;
const { MULTIPLAYER_GUARD_KV_KEY, _resetGuardCacheForTests } = await import("./multiplayerGuard.ts");
const { ANALYTICS_BREAKER_KV_KEY } = await import("./analyticsBreaker.ts");

// Every credential distinct, or the isolation assertions would pass vacuously.
const T = {
  content: "content-t",
  analytics: "analytics-t",
  guard: "guard-t",
  analyticsGuard: "analytics-guard-t",
  opsGuard: "ops-guard-t",
  opsAnalytics: "ops-analytics-t",
};
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

class FakeKv {
  store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

function makeEnv(over: Record<string, unknown> = {}) {
  const kv = new FakeKv();
  const env = {
    CONTENT_KV: kv,
    ASSETS: { fetch: async () => new Response("asset") },
    ANALYTICS_DO: { idFromName: () => ({}), get: () => ({ fetch: async () => new Response("{}", { status: 401 }) }) },
    CONTENT_ADMIN_TOKEN: T.content,
    ANALYTICS_ADMIN_TOKEN: T.analytics,
    GUARD_ADMIN_TOKEN: T.guard,
    ANALYTICS_GUARD_ADMIN_TOKEN: T.analyticsGuard,
    OPS_GUARD_ADMIN_TOKEN: T.opsGuard,
    OPS_ANALYTICS_GUARD_ADMIN_TOKEN: T.opsAnalytics,
    ...over,
  } as unknown as Parameters<typeof worker.fetch>[1];
  return { env, kv };
}

const MP = "https://playcydi.com/api/config/multiplayer-guard";
const AN = "https://playcydi.com/api/config/analytics-breaker";
const mpBody = JSON.stringify({ monitorOnly: true, globalMode: "NORMAL", countries: {} });
const anBody = (disabled = false) => JSON.stringify({ disabled, shed: { monitorOnly: true, globalMode: "NORMAL", countries: {} } });
const req = (url: string, method: string, headers?: Record<string, string>, body?: string) =>
  new Request(url, { method, headers, body: method === "PUT" ? body : undefined });

test.beforeEach(() => _resetGuardCacheForTests());

test("the panel's multiplayer credential opens the config GET and PUT", async () => {
  const { env, kv } = makeEnv();
  assert.equal((await worker.fetch(req(MP, "GET", bearer(T.opsGuard)), env)).status, 200);
  const put = await worker.fetch(req(MP, "PUT", bearer(T.opsGuard), mpBody), env);
  assert.equal(put.status, 200);
  // The handler stays authoritative for its own server-managed fields.
  const stored = JSON.parse(kv.store.get(MULTIPLAYER_GUARD_KV_KEY)!);
  assert.ok(typeof stored.activatedAt === "string");
  assert.equal(stored.history.length, 1);
});

test("the panel's multiplayer credential does NOT open status or any other admin route", async () => {
  const { env } = makeEnv();
  for (const url of [
    `${MP}/status`,
    AN,
    "https://playcydi.com/api/content/releases",
    "https://playcydi.com/api/analytics/report",
  ]) {
    const res = await worker.fetch(req(url, "GET", bearer(T.opsGuard)), env);
    assert.equal(res.status, 401, `${url} must not accept OPS_GUARD_ADMIN_TOKEN`);
  }
  assert.equal((await worker.fetch(req(AN, "PUT", bearer(T.opsGuard), anBody()), env)).status, 401);
});

test("the panel's analytics credential opens the breaker route and nothing else", async () => {
  const { env } = makeEnv();
  assert.equal((await worker.fetch(req(AN, "GET", bearer(T.opsAnalytics)), env)).status, 200);
  assert.equal((await worker.fetch(req(AN, "PUT", bearer(T.opsAnalytics), anBody()), env)).status, 200);
  for (const [url, method] of [
    [MP, "GET"],
    [MP, "PUT"],
    [`${MP}/status`, "GET"],
    ["https://playcydi.com/api/content/releases", "GET"],
  ] as const) {
    const res = await worker.fetch(req(url, method, bearer(T.opsAnalytics), mpBody), env);
    assert.equal(res.status, 401, `${method} ${url} must not accept OPS_ANALYTICS_GUARD_ADMIN_TOKEN`);
  }
});

test("the panel's analytics credential cannot flip the breaker in either direction", async () => {
  const { env, kv } = makeEnv();
  const on = await worker.fetch(req(AN, "PUT", bearer(T.opsAnalytics), anBody(true)), env);
  assert.equal(on.status, 403);
  assert.equal(kv.store.get(ANALYTICS_BREAKER_KV_KEY), undefined, "a refused PUT stores nothing");

  kv.store.set(ANALYTICS_BREAKER_KV_KEY, JSON.stringify({ disabled: true }));
  const off = await worker.fetch(req(AN, "PUT", bearer(T.opsAnalytics), anBody(false)), env);
  assert.equal(off.status, 403);
  assert.equal(kv.store.get(ANALYTICS_BREAKER_KV_KEY), JSON.stringify({ disabled: true }));

  // Carrying the current value through is fine - that is how the panel edits shedding.
  const keep = await worker.fetch(req(AN, "PUT", bearer(T.opsAnalytics), anBody(true)), env);
  assert.equal(keep.status, 200);
});

test("the operator's analytics token can still flip the breaker", async () => {
  const { env, kv } = makeEnv();
  assert.equal((await worker.fetch(req(AN, "PUT", bearer(T.analyticsGuard), anBody(true)), env)).status, 200);
  assert.equal(JSON.parse(kv.store.get(ANALYTICS_BREAKER_KV_KEY)!).disabled, true);
});

test("operator tokens are unaffected by whether the panel's secrets are bound", async () => {
  for (const over of [{}, { OPS_GUARD_ADMIN_TOKEN: undefined, OPS_ANALYTICS_GUARD_ADMIN_TOKEN: undefined }]) {
    const { env } = makeEnv(over);
    assert.equal((await worker.fetch(req(MP, "GET", bearer(T.guard)), env)).status, 200);
    assert.equal((await worker.fetch(req(`${MP}/status`, "GET", bearer(T.guard)), env)).status, 200);
    assert.equal((await worker.fetch(req(AN, "GET", bearer(T.analyticsGuard)), env)).status, 200);
  }
});

test("unset panel secrets lock the panel out rather than opening anything", async () => {
  const { env } = makeEnv({ OPS_GUARD_ADMIN_TOKEN: undefined, OPS_ANALYTICS_GUARD_ADMIN_TOKEN: "" });
  for (const headers of [bearer(T.opsGuard), bearer(T.opsAnalytics), { authorization: "Bearer " }, { authorization: "Bearer undefined" }]) {
    assert.equal((await worker.fetch(req(MP, "GET", headers), env)).status, 401);
    assert.equal((await worker.fetch(req(AN, "GET", headers), env)).status, 401);
  }
});

test("the old cross-credentials still do not open the guard routes", async () => {
  const { env } = makeEnv();
  for (const t of [T.content, T.analytics]) {
    assert.equal((await worker.fetch(req(MP, "GET", bearer(t)), env)).status, 401);
    assert.equal((await worker.fetch(req(AN, "GET", bearer(t)), env)).status, 401);
  }
  // And the two guards' operator tokens stay independent of each other.
  assert.equal((await worker.fetch(req(MP, "GET", bearer(T.analyticsGuard)), env)).status, 401);
  assert.equal((await worker.fetch(req(AN, "GET", bearer(T.guard)), env)).status, 401);
});
