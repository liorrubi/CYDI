// A real 404 for unknown addresses (worker/notFound.ts). The properties worth
// protecting: every route the app serves still gets its page, an unknown one gets
// a 404 that is not a copy of the homepage, real static files are untouched - and
// deciding all of that costs the one ASSETS fetch the request already made, with
// no KV, Durable Object or analytics access on the way.
import test from "node:test";
import assert from "node:assert/strict";

const worker = (await import("./index.ts")).default;
const { isAppRoute, isHtmlFallback } = await import("./notFound.ts");
const { LANDING_PATHS } = await import("./seoPages.ts");
const { CONTENT_PATHS } = await import("./contentPages.ts");

/** The assets binding in SPA mode: known files are served, anything else gets the HTML shell. */
function makeEnv(files: Record<string, { body: string; type: string }> = {}) {
  const fetched: string[] = [];
  const ASSETS = {
    async fetch(input: Request | string): Promise<Response> {
      const url = new URL(typeof input === "string" ? input : input.url);
      fetched.push(url.pathname);
      const file = files[url.pathname];
      if (file) return new Response(file.body, { status: 200, headers: { "content-type": file.type } });
      return new Response("<!doctype html><title>CYDI</title><div id=root></div>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    },
  };
  // ASSETS and nothing else: a page request that reached for KV, a Durable Object
  // or analytics would throw on the missing binding and fail the test.
  return { fetched, env: { ASSETS } as never };
}

function get(path: string, method = "GET"): Request {
  return new Request(`https://playcydi.com${path}`, { method });
}

test("every app route is recognised - site, game, landing, content and the parameterised ones", () => {
  const routes = [
    "/",
    "/play",
    "/play/",
    "/play/classic",
    "/daily",
    "/daily/",
    "/join/ABC234",
    "/join/abc234",
    "/c/abcd2345",
    ...LANDING_PATHS,
    ...LANDING_PATHS.map((path) => `${path}/`),
    ...CONTENT_PATHS,
    "/whats-new",
  ];
  for (const path of routes) assert.equal(isAppRoute(path), true, path);
});

test("invented, mistyped and malformed addresses are not routes", () => {
  for (const path of [
    "/this-does-not-exist",
    "/draw-a-unicorn-xyz",
    "/drawing-challenges/nope",
    "/HOW-TO-PLAY",
    "/play/nothing",
    "/join/abc",
    "/join/ABC2345",
    "/c/x",
    "/admin/foo",
    "/api/nope",
  ]) {
    assert.equal(isAppRoute(path), false, path);
  }
});

test("an unknown address is a 404 with noindex and no homepage canonical, from one ASSETS fetch", async () => {
  const { env, fetched } = makeEnv();
  const res = await worker.fetch(get("/this-does-not-exist"), env);
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("x-robots-tag"), "noindex");
  const body = await res.text();
  assert.match(body, /<h1>Page not found<\/h1>/);
  assert.match(body, /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(body, /rel="canonical"/);
  assert.doesNotMatch(body, /og:url/);
  assert.match(body, /href="\/drawing-challenges"/);
  assert.deepEqual(fetched, ["/this-does-not-exist"]);
});

test("HEAD on an unknown address is a 404 with no body", async () => {
  const { env } = makeEnv();
  const res = await worker.fetch(get("/nope", "HEAD"), env);
  assert.equal(res.status, 404);
  assert.equal(await res.text(), "");
});

test("the SPA routes still get the app shell with a 200", async () => {
  for (const path of ["/play", "/play/classic", "/daily", "/join/ABC234"]) {
    const { env, fetched } = makeEnv();
    const res = await worker.fetch(get(path), env);
    assert.equal(res.status, 200, path);
    assert.match(await res.text(), /id=root/, path);
    assert.deepEqual(fetched, [path], `${path}: exactly one ASSETS fetch`);
  }
});

test("a real static file that reaches the Worker is served untouched (ads.txt)", async () => {
  const { env } = makeEnv({ "/ads.txt": { body: "google.com, pub-0, DIRECT", type: "text/plain" } });
  const res = await worker.fetch(get("/ads.txt"), env);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "google.com, pub-0, DIRECT");
});

test("the landing and content pages are unaffected when the Worker does receive them", async () => {
  // Normally prerendered and served without the Worker; this is the fallback path.
  // Content pages are whole documents the Worker renders itself.
  for (const path of ["/whats-new", "/about/"]) {
    const { env } = makeEnv();
    const res = await worker.fetch(get(path), env);
    assert.equal(res.status, 200, path);
  }
  // A landing GET goes through HTMLRewriter (Workers-only), so HEAD - which skips
  // the rewrite and reaches the new fallback branch - is the one that proves it.
  for (const path of ["/draw-a-bear-from-memory", "/drawing-challenges/"]) {
    const { env } = makeEnv();
    const res = await worker.fetch(get(path, "HEAD"), env);
    assert.equal(res.status, 200, path);
  }
});

test("only a 200 HTML fallback counts as 'not found'", () => {
  const html = (status: number, type: string) => new Response("", { status, headers: { "content-type": type } });
  assert.equal(isHtmlFallback(html(200, "text/html")), true);
  assert.equal(isHtmlFallback(html(200, "text/html; charset=utf-8")), true);
  assert.equal(isHtmlFallback(html(200, "text/plain")), false);
  assert.equal(isHtmlFallback(html(307, "text/html")), false);
  assert.equal(isHtmlFallback(html(404, "text/html")), false);
});
