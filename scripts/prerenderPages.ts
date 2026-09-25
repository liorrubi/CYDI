/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Build-time prerender of every page whose output is a pure function of committed
// source, so those paths can be served by the asset layer instead of the Worker.
//
// WHY THIS EXISTS. On 24 Sep 2026 the Workers runtime hit its Free-tier daily limit
// and Cloudflare answered every Worker-invoking path with 429 for four and a half
// hours. Paths excluded from `run_worker_first` kept serving 200/304 the whole time -
// the asset layer never stopped, only the Worker did. A cold visit to "/" was dead,
// and it did not need to be: the homepage is the app shell plus a <head> rewrite that
// depends on nothing but code. Prerendering it, and adding it to the exclusion list,
// means the site and single-player Classic survive the next one.
//
// It is NOT a quota measure. These pages are ~0.4% of Worker invocations (169 SEO +
// 53 content + 57 robots/sitemap out of 80,113 on 24 Sep); analytics is 72%. Anyone
// reaching for this to save quota is reading the wrong file.
//
// WHY IT RENDERS THROUGH THE REAL WORKER. The obvious implementation - a second
// renderer in Node that reproduces handleSeoPage's HTMLRewriter edits as string
// surgery - has one fatal property: it can drift. Two renderers means the prerendered
// page and the Worker's page disagree the first time someone edits one and not the
// other, and the failure is silent because the Worker path stops being exercised the
// moment these files exist.
//
// So this does not reimplement anything. It runs the actual Worker in workerd via
// `wrangler dev --local` and saves what it returns. The prerendered file IS the
// Worker's output, which makes "they match" true by construction rather than by a
// test somebody has to keep passing. HTMLRewriter is a runtime API with no Node
// equivalent, so this is also the only way to execute that code path outside
// Cloudflare at all.
//
// The Worker handlers stay in worker/index.ts untouched. They stop receiving traffic
// for these paths, but a path missing from the exclusion list simply keeps working the
// way it does today - the failure mode of getting the list wrong is "no improvement",
// never a 404.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { SEO_PAGES } from "../worker/seoPages";
import { CONTENT_PAGES } from "../worker/contentPages";
import {
  CONTENT_PAGE_CACHE_CONTROL,
  CONTENT_PAGE_CONTENT_TYPE,
  ROBOTS_CONTENT_TYPE,
  SITEMAP_CONTENT_TYPE,
  TEXT_RESPONSE_CACHE_CONTROL,
} from "../worker/cachePolicy";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");
const PORT = Number(process.env.PRERENDER_PORT ?? 8799);
const READY_TIMEOUT_MS = 90_000;
const FETCH_TIMEOUT_MS = 15_000;

/** Every path whose rendered output is decided at build time. Order is irrelevant; uniqueness is not. */
export function prerenderPaths(): string[] {
  const paths = [...SEO_PAGES.map((p) => p.path), ...CONTENT_PAGES.map((p) => p.path), "/robots.txt", "/sitemap.xml"];
  const seen = new Set<string>();
  for (const p of paths) {
    if (seen.has(p)) throw new Error(`duplicate prerender path: ${p}`);
    seen.add(p);
  }
  return paths;
}

/**
 * Where a rendered path is written so the asset server finds it.
 *
 * A SIBLING ".html" FILE, never a directory index, and that is load-bearing. Under the
 * default html_handling ("auto-trailing-slash") the asset server serves "/about" from
 * "/about.html" directly, but from "/about/index.html" only after a 307 to "/about/".
 * Measured: with a directory index, `/about` answered 307 -> `/about/`, where
 * production answers 200 today. That redirect would apply to every landing page, cost
 * crawlers a hop on URLs whose canonical has no trailing slash, and change what every
 * existing inbound link resolves to - a worse outcome than not prerendering at all.
 *
 * Paths that already carry an extension (robots.txt, sitemap.xml) are written verbatim;
 * appending .html to those would serve them at the wrong URL under the wrong type.
 */
export function outputFileFor(urlPath: string): string {
  if (urlPath === "/") return "index.html";
  const clean = urlPath.replace(/^\/+/, "").replace(/\/+$/, "");
  return path.extname(clean) === "" ? `${clean}.html` : clean;
}

/**
 * Strips // and /* comments from JSONC without touching them inside string literals,
 * so a "https://..." in a config value survives.
 */
export function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (c === "\n") { inLine = false; out += c; }
      continue;
    }
    if (inBlock) {
      if (c === "*" && next === "/") { inBlock = false; i += 1; }
      continue;
    }
    if (inString) {
      out += c;
      if (c === "\\") { out += next ?? ""; i += 1; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === "/" && next === "/") { inLine = true; i += 1; continue; }
    if (c === "/" && next === "*") { inBlock = true; i += 1; continue; }
    out += c;
  }
  return out;
}

/**
 * The routing the prerender itself must run under.
 *
 * Chicken-and-egg: once a page path is excluded from run_worker_first, `wrangler dev`
 * serves it from the asset layer, so the Worker never renders it and there is nothing
 * to prerender FROM. Caught the hard way - with the exclusions in place the first
 * rerun produced a bare shell for "/" and the canonical guard below rejected it.
 *
 * So the prerender runs against a temporary config keeping only the genuinely static
 * directories excluded. Derived from the real wrangler.jsonc rather than duplicated,
 * so bindings, compatibility date and the assets directory cannot drift.
 */
export function prerenderRunWorkerFirst(configured: string[]): string[] {
  const pagePaths = new Set(prerenderPaths().map((p) => `!${p}`));
  return configured.filter((rule) => !pagePaths.has(rule));
}

/**
 * The response headers the Worker sets that the asset server does not.
 *
 * Measured on Cloudflare's REAL asset server (`wrangler dev --remote`), not locally
 * and not by reasoning. Both mattered:
 *
 *   /about + the 5 other content docs  Worker: max-age=600,  text/html; charset=utf-8
 *                                      assets: max-age=0,    text/html
 *   /robots.txt                        Worker: max-age=3600, text/plain; charset=utf-8
 *                                      assets: max-age=0,    text/plain
 *   /sitemap.xml                       Worker: max-age=3600, application/xml; charset=utf-8
 *                                      assets: max-age=0,    application/xml
 *
 * The charset losses are the reason a local check was not good enough. Local workerd
 * ADDS `; charset=utf-8` to text responses, so against `wrangler dev --local` these
 * routes looked identical to production and the drop was invisible. Only the remote
 * edge showed it. Every one of these documents is served as UTF-8 and says so today;
 * without an explicit content-type the browser falls back to its own default encoding,
 * which is how a privacy policy full of typographic quotes turns into mojibake.
 *
 * The 17 SEO pages genuinely need nothing, and that is confirmed the same way: both
 * production and the remote edge answer them `text/html` with no charset, because
 * handleSeoPage passes the asset response's own headers straight through.
 *
 * Values come from worker/cachePolicy.ts rather than being retyped, so a change there
 * cannot leave this file behind.
 */
export function headersFileContent(): string {
  const lines: string[] = [
    "# Generated by scripts/prerenderPages.ts - do not edit.",
    "# Restores the response headers the Worker set for these paths before they moved",
    "# to the asset layer. See headersFileContent() for the measured diff.",
    "",
  ];
  for (const page of CONTENT_PAGES) {
    lines.push(page.path, `  cache-control: ${CONTENT_PAGE_CACHE_CONTROL}`, `  content-type: ${CONTENT_PAGE_CONTENT_TYPE}`, "");
  }
  lines.push("/robots.txt", `  cache-control: ${TEXT_RESPONSE_CACHE_CONTROL}`, `  content-type: ${ROBOTS_CONTENT_TYPE}`, "");
  lines.push("/sitemap.xml", `  cache-control: ${TEXT_RESPONSE_CACHE_CONTROL}`, `  content-type: ${SITEMAP_CONTENT_TYPE}`, "");
  return lines.join("\n");
}

async function waitForReady(url: string, child: ChildProcess, onStderr: () => string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError = "never responded";
  while (Date.now() < deadline) {
    // Surfacing wrangler's own output matters: "exited early with code 1" on its own
    // sends the next person hunting, when the cause is usually one line (a port already
    // in use, a config it refused).
    if (child.exitCode !== null) throw new Error(`wrangler dev exited early with code ${child.exitCode}\n${onStderr()}`);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return;
      lastError = `status ${res.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`wrangler dev did not become ready on ${url}: ${lastError}
${onStderr()}`);
}

async function main(): Promise<void> {
  const paths = prerenderPaths();

  const configPath = path.join(ROOT, "wrangler.jsonc");
  const config = JSON.parse(stripJsonComments(await readFile(configPath, "utf8"))) as {
    assets?: { run_worker_first?: string[] };
  };
  const configured = config.assets?.run_worker_first;
  if (!Array.isArray(configured)) throw new Error("wrangler.jsonc has no assets.run_worker_first");
  config.assets!.run_worker_first = prerenderRunWorkerFirst(configured);
  const tempConfig = path.join(ROOT, ".wrangler.prerender.json");
  await writeFile(tempConfig, JSON.stringify(config, null, 2), "utf8");

  // --local keeps this off the network entirely: no KV, no Durable Object, no
  // account credentials. None of these pages read any of those, and a prerender that
  // could reach production data would be a prerender that can bake a secret into a
  // static file.
  const child = spawn(
    process.execPath,
    [path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js"), "dev", "--local", "--ip", "127.0.0.1", "--port", String(PORT), "--config", tempConfig],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1" } },
  );
  let stderr = "";
  child.stderr?.on("data", (d) => (stderr += String(d)));
  child.stdout?.resume();

  const base = `http://127.0.0.1:${PORT}`;
  const rendered = new Map<string, { body: string; contentType: string }>();
  try {
    await waitForReady(`${base}/robots.txt`, child, () => stderr.trim().split("\n").slice(-6).join("\n"));
    for (const urlPath of paths) {
      const res = await fetch(`${base}${urlPath}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`${urlPath} rendered ${res.status}`);
      const body = await res.text();
      // A landing page that came back as the bare shell means the Worker did not
      // recognise the path - writing that would ship a page with the wrong <title>
      // and no canonical, which is worse than not prerendering it at all.
      if (urlPath !== "/robots.txt" && urlPath !== "/sitemap.xml" && !body.includes('rel="canonical"')) {
        throw new Error(`${urlPath} rendered without a canonical link - the Worker did not treat it as a page`);
      }
      rendered.set(urlPath, { body, contentType: res.headers.get("content-type") ?? "" });
    }
  } finally {
    child.kill();
    await rm(tempConfig, { force: true });
  }

  // Written only after the server is down, because "/" overwrites dist/index.html -
  // the very file wrangler dev is serving the shell from.
  for (const [urlPath, { body }] of rendered) {
    const file = path.join(DIST, outputFileFor(urlPath));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body, "utf8");
  }
  await writeFile(path.join(DIST, "_headers"), headersFileContent(), "utf8");

  if (rendered.size !== paths.length) throw new Error(`rendered ${rendered.size} of ${paths.length}`);
  console.log(`prerendered ${rendered.size} paths into dist/ (+ _headers)`);
  if (stderr.trim()) console.log(`(wrangler stderr: ${stderr.trim().split("\n").slice(-2).join(" | ")})`);
}

// Only when run as a script - the tests import prerenderPaths/outputFileFor directly.
if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`prerender failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
