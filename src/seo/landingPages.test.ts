import test from "node:test";
import assert from "node:assert/strict";

const { LANDING_PATHS, landingPageForPath } = await import("./landingPages.ts");
// Worker-side SEO definitions - pure data/string builders, so they import fine
// under plain Node. This is the whole point of the file split: if a path is added
// or renamed on one side only, this test fails instead of shipping a landing page
// with metadata but no destination (or the reverse).
const {
  LANDING_PATHS: WORKER_LANDING_PATHS,
  seoPageForPath,
  SEO_PAGES,
  PLAY_STORE_URL: SEO_PLAY_STORE_URL,
} = await import("../../worker/seoPages.ts");

test("app and Worker agree on the landing paths", () => {
  assert.deepEqual([...LANDING_PATHS].sort(), [...WORKER_LANDING_PATHS].sort());
});

test("every landing path has Worker metadata, and vice versa", () => {
  for (const path of LANDING_PATHS) {
    const page = seoPageForPath(path);
    assert.ok(page, `no Worker SEO page for ${path}`);
    assert.ok(page.title.length > 0 && page.description.length > 0 && page.h1.length > 0);
  }
  for (const path of WORKER_LANDING_PATHS) {
    assert.ok(landingPageForPath(path), `no app landing entry for ${path}`);
  }
});

test("titles, descriptions and H1s are unique across pages", () => {
  for (const field of ["title", "description", "h1"] as const) {
    const values = SEO_PAGES.map((page) => page[field]);
    assert.equal(new Set(values).size, values.length, `duplicate ${field}`);
  }
});

test("paths outside the list are not landing pages", () => {
  assert.equal(landingPageForPath("/"), undefined);
  assert.equal(landingPageForPath("/privacy"), undefined);
  assert.equal(landingPageForPath("/c/ABCD1234"), undefined);
});

test("a trailing slash resolves to the same landing page", () => {
  assert.equal(landingPageForPath("/draw-a-perfect-circle/")?.shape?.shapeId, "circle");
});

test("the Google Play link is the app's real listing URL, not a second guess at it", async () => {
  // nativeShare.ts is the single source of truth (and its own test ties that
  // constant to the package id in capacitor.config.ts and build.gradle).
  const { PLAY_STORE_URL } = await import("../services/nativeShare.ts");
  assert.equal(SEO_PLAY_STORE_URL, PLAY_STORE_URL);
});

test("every landing page has one internal CTA and the Android line; the homepage has neither", () => {
  for (const path of WORKER_LANDING_PATHS) {
    const page = seoPageForPath(path)!;
    assert.ok(page.cta, `${path} has no CTA`);
    assert.equal(page.androidCta, true, `${path} is missing the Android line`);
  }
  const home = seoPageForPath("/")!;
  // The home screen already renders its own "Get the Android App" card, and the
  // game is right there on the page - a "play more" CTA would be circular.
  assert.equal(home.cta, undefined);
  assert.equal(home.androidCta, undefined);
});

test("CTA targets are real pages, never the page itself, and never repeated in its link list", () => {
  const knownPaths = new Set(SEO_PAGES.map((page) => page.path));
  for (const page of SEO_PAGES) {
    for (const link of page.links) {
      assert.ok(knownPaths.has(link.href), `${page.path} links to unknown ${link.href}`);
      assert.notEqual(link.href, page.path, `${page.path} links to itself`);
    }
    if (!page.cta) continue;
    assert.ok(knownPaths.has(page.cta.href), `${page.path} CTA points at unknown ${page.cta.href}`);
    assert.notEqual(page.cta.href, page.path, `${page.path} CTA points at itself`);
    assert.ok(
      !page.links.some((link) => link.href === page.cta!.href),
      `${page.path} shows ${page.cta.href} twice (link list and CTA)`,
    );
  }
});
