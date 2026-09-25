/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Prerendered pages and the routing that makes them reachable.
//
// The load-bearing assertion is the third one: wrangler.jsonc's exclusion list and
// prerenderPaths() must name exactly the same paths. Get that wrong in either
// direction and the failure is SILENT - an excluded path with no prerendered file
// serves the bare shell with the wrong <title> and no canonical, and a prerendered
// file with no exclusion is simply dead weight nobody notices. Neither shows up as an
// error anywhere, which is why it is pinned here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const { prerenderPaths, outputFileFor, prerenderRunWorkerFirst, stripJsonComments, headersFileContent } = await import("../scripts/prerenderPages.ts");
const { CONTENT_PAGE_CACHE_CONTROL, TEXT_RESPONSE_CACHE_CONTROL, CONTENT_PAGE_CONTENT_TYPE, ROBOTS_CONTENT_TYPE, SITEMAP_CONTENT_TYPE } = await import("./cachePolicy.ts");
const { SEO_PAGES } = await import("./seoPages.ts");
const { CONTENT_PAGES } = await import("./contentPages.ts");

const ROOT = path.resolve(import.meta.dirname, "..");
const configuredRules = (): string[] => {
  const raw = readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8");
  return (JSON.parse(stripJsonComments(raw)) as { assets: { run_worker_first: string[] } }).assets.run_worker_first;
};

test("every page the Worker renders from committed source is prerendered", () => {
  const paths = prerenderPaths();
  for (const page of SEO_PAGES) assert.ok(paths.includes(page.path), `SEO page ${page.path} is not prerendered`);
  for (const page of CONTENT_PAGES) assert.ok(paths.includes(page.path), `content page ${page.path} is not prerendered`);
  assert.ok(paths.includes("/robots.txt") && paths.includes("/sitemap.xml"));
  assert.equal(paths.length, SEO_PAGES.length + CONTENT_PAGES.length + 2, "no extras");
  assert.ok(paths.includes("/"), "the homepage is the whole point");
  assert.equal(new Set(paths).size, paths.length, "no duplicates");
});

test("nothing that reads KV or a Durable Object is prerendered", () => {
  // These are per-request by nature: /c/:code reads SHARE_KV, /api/* reads KV or a DO,
  // /s/:slug and /android are redirects. Baking any of them would serve one visitor's
  // data to everyone, or freeze a config whose entire purpose is changing without a
  // deploy.
  const paths = prerenderPaths();
  for (const p of paths) {
    assert.ok(!p.startsWith("/api/"), `${p} is an API route`);
    assert.ok(!p.startsWith("/c/"), `${p} is a per-share page`);
    assert.ok(!p.startsWith("/s/"), `${p} is a campaign redirect`);
    assert.notEqual(p, "/android");
  }
});

test("CONFIG GUARD: wrangler.jsonc excludes exactly the prerendered paths, no more, no less", () => {
  const rules = configuredRules();
  const excluded = new Set(rules.filter((r) => r.startsWith("!")).map((r) => r.slice(1)));
  for (const p of prerenderPaths()) {
    assert.ok(excluded.has(p), `${p} is prerendered but still routed to the Worker - the file will never be served`);
  }
  // The static directories that were excluded before any of this existed.
  const staticDirs = ["/assets/*", "/images/*", "/admin/*", "/.well-known/*", "/favicon.svg", "/app-ads.txt"];
  const known = new Set([...prerenderPaths(), ...staticDirs]);
  for (const e of excluded) {
    assert.ok(known.has(e), `${e} is excluded from the Worker but nothing prerenders it - it will serve the bare shell`);
  }
  assert.ok(rules.includes("/*"), "the catch-all must stay first, or /api/* stops reaching the Worker");
  assert.equal(rules[0], "/*");
});

test("a page is written as a SIBLING .html, never a directory index", () => {
  // Measured: dist/about/index.html makes the asset server answer /about with
  // 307 -> /about/, where production answers 200. That redirect would hit every
  // landing page and every inbound link, on URLs whose canonical has no trailing
  // slash. dist/about.html serves /about directly.
  assert.equal(outputFileFor("/about"), "about.html");
  assert.equal(outputFileFor("/draw-shapes-online"), "draw-shapes-online.html");
  assert.equal(outputFileFor("/"), "index.html");
  for (const p of prerenderPaths()) {
    assert.ok(!outputFileFor(p).includes("/index.html"), `${p} would 307`);
  }
  // Files that already carry an extension keep it - .html on robots.txt would serve
  // it at the wrong URL under the wrong content type.
  assert.equal(outputFileFor("/robots.txt"), "robots.txt");
  assert.equal(outputFileFor("/sitemap.xml"), "sitemap.xml");
});

test("the prerender runs against routing that still sends pages to the Worker", () => {
  // Chicken-and-egg, found the hard way: with the page exclusions applied, wrangler
  // dev serves those paths from the asset layer, the Worker never renders them, and
  // the prerender captures a bare shell. The temporary config must drop exactly the
  // page exclusions and keep the static ones.
  const relaxed = prerenderRunWorkerFirst(configuredRules());
  for (const p of prerenderPaths()) assert.ok(!relaxed.includes(`!${p}`), `${p} must reach the Worker while prerendering`);
  for (const dir of ["!/assets/*", "!/images/*", "!/admin/*", "!/.well-known/*"]) {
    assert.ok(relaxed.includes(dir), `${dir} must stay excluded - it has no Worker handler at all`);
  }
  assert.ok(relaxed.includes("/*"));
});

test("_headers restores every response header the asset layer would otherwise drop", () => {
  // Measured against production, not assumed. The asset server defaults HTML to
  // `max-age=0, must-revalidate`, so without this file the content docs would lose
  // their 10-minute cache and robots/sitemap their hour - a silent behaviour change
  // shipped under the banner of an availability fix.
  const content = headersFileContent();
  // Parsed rather than regex-matched, so the assertion says exactly which directives a
  // path carries - "these two, in this order, and nothing else".
  const ruleFor = (urlPath: string): string[] => {
    const lines = content.split("\n");
    const start = lines.indexOf(urlPath);
    if (start === -1) return [];
    const out: string[] = [];
    for (let i = start + 1; i < lines.length && lines[i].startsWith("  "); i += 1) out.push(lines[i].trim());
    return out;
  };
  // content-type is restored as well as cache-control, because the real edge drops the
  // charset on all three families. Local workerd does NOT - it adds `; charset=utf-8`
  // itself - so this was only visible against `wrangler dev --remote`, and a local-only
  // check would have shipped mojibake on every content document.
  for (const page of CONTENT_PAGES) {
    assert.deepEqual(
      ruleFor(page.path),
      [`cache-control: ${CONTENT_PAGE_CACHE_CONTROL}`, `content-type: ${CONTENT_PAGE_CONTENT_TYPE}`],
      `${page.path} loses cache-control or charset`,
    );
  }
  assert.deepEqual(ruleFor("/robots.txt"), [`cache-control: ${TEXT_RESPONSE_CACHE_CONTROL}`, `content-type: ${ROBOTS_CONTENT_TYPE}`]);
  assert.deepEqual(ruleFor("/sitemap.xml"), [`cache-control: ${TEXT_RESPONSE_CACHE_CONTROL}`, `content-type: ${SITEMAP_CONTENT_TYPE}`]);
  for (const ct of [CONTENT_PAGE_CONTENT_TYPE, ROBOTS_CONTENT_TYPE, SITEMAP_CONTENT_TYPE]) {
    assert.match(ct, /charset=utf-8$/, "the charset is the whole point of restoring content-type");
  }

  // The 17 SEO pages are deliberately absent: handleSeoPage passes the asset
  // response's own headers through, so they already match and a rule here would be
  // inventing a difference rather than restoring one.
  for (const page of SEO_PAGES) {
    assert.ok(!new RegExp(`^${page.path}$`, "m").test(content), `${page.path} needs no header rule`);
  }
});

test("stripJsonComments keeps // inside string values", () => {
  const parsed = JSON.parse(stripJsonComments('{"a":"https://x.test/y", /* c */ "b":1 // tail\n}'));
  assert.deepEqual(parsed, { a: "https://x.test/y", b: 1 });
  assert.equal(JSON.parse(stripJsonComments('{"a":"say \\"//\\" ok"}')).a, 'say "//" ok');
});

// --- routing, end to end -------------------------------------------------------------
//
// Proves the property the whole change exists for: an excluded path is answered
// WITHOUT invoking the Worker, so a Worker that is refusing requests - as on 24 Sep,
// when every Worker-invoking path returned 429 for four and a half hours - cannot take
// it down.
//
// wrangler dev's request log is not usable as the signal: it logs asset-served
// requests identically to Worker-served ones. So this swaps in a Worker that answers
// everything with a sentinel. A path returning the sentinel reached the Worker; a path
// returning real content did not. No log parsing, no ambiguity.
//
// Gated behind PRERENDER_E2E=1 because it boots workerd (~25s) and `npm test` runs on
// every change. Run it before touching run_worker_first:
//   PRERENDER_E2E=1 node --import ./scripts/register-ts.mjs --test worker/prerender.test.ts
test("E2E: excluded paths are served without invoking the Worker", { skip: process.env.PRERENDER_E2E !== "1" }, async () => {
  const { writeFileSync, rmSync, existsSync } = await import("node:fs");
  assert.ok(existsSync(path.join(ROOT, "dist", "index.html")), "run `npm run build` first");

  const SENTINEL = "__WORKER_WAS_INVOKED__";
  const stubMain = path.join(ROOT, ".prerender-e2e-worker.mjs");
  const stubConfig = path.join(ROOT, ".prerender-e2e.json");
  const config = JSON.parse(stripJsonComments(readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8"))) as Record<string, unknown>;
  writeFileSync(stubMain, `export default { fetch() { return new Response(${JSON.stringify(SENTINEL)}); } };\n`);
  // Only main is replaced: the assets block, and therefore run_worker_first, is the
  // real one under test. Bindings are dropped so the stub needs no KV or DO.
  writeFileSync(stubConfig, JSON.stringify({ ...config, main: path.basename(stubMain), kv_namespaces: [], durable_objects: { bindings: [] }, migrations: [] }, null, 2));

  const port = 8811;
  const child = spawn(process.execPath, [path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js"), "dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--config", stubConfig], { cwd: ROOT, stdio: "ignore" });
  const get = async (p: string) => (await fetch(`http://127.0.0.1:${port}${p}`, { redirect: "manual", signal: AbortSignal.timeout(8_000) })).text();
  try {
    const deadline = Date.now() + 90_000;
    for (;;) {
      try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2_000) }); break; } catch { /* not up yet */ }
      if (Date.now() > deadline) throw new Error("wrangler dev never became ready");
      await new Promise((r) => setTimeout(r, 500));
    }
    for (const p of prerenderPaths()) {
      const body = await get(p);
      assert.ok(!body.includes(SENTINEL), `${p} INVOKED THE WORKER - it will 429 when quota is exhausted`);
    }
    // The control: a path that must still reach the Worker. If this does not hit the
    // sentinel the exclusion list has swallowed the API surface, which is the exact
    // failure the "/*"-first inversion exists to prevent.
    assert.ok((await get("/api/config/ads")).includes(SENTINEL), "/api/* must still invoke the Worker");
    assert.ok((await get("/c/abcd")).includes(SENTINEL), "/c/:code must still invoke the Worker");
  } finally {
    child.kill();
    rmSync(stubMain, { force: true });
    rmSync(stubConfig, { force: true });
  }
});
