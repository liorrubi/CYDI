/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Guards the public content pages: that they are real documents, that they carry
// the policy text rather than an empty shell, that the nav cannot rot, and that
// they can never collide with the game's SEO paths.

import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTENT_PAGES,
  CONTENT_PATHS,
  contentPageForPath,
  renderContentDocument,
} from "./contentPages";
import { LANDING_PATHS, SEO_PAGES, SITE_NAV, canonicalUrl, sitemapXml } from "./seoPages";
import { PRIVACY_POLICY_HTML } from "../src/content/privacyPolicyHtml";

test("content paths never collide with the game's SEO paths", () => {
  // Both lists are matched in worker/index.ts. A path in both would be answered
  // by whichever check happens to run first, which is not a thing to leave to
  // source order.
  const seoPaths = new Set(SEO_PAGES.map((page) => page.path));
  for (const path of CONTENT_PATHS) {
    assert.ok(!seoPaths.has(path), `${path} is both a content page and an SEO page`);
  }
});

test("content pages are not landing paths", () => {
  // LANDING_PATHS is what the app boots a mode/shape for. A content page has no
  // game on it, so it must never appear there.
  for (const path of CONTENT_PATHS) {
    assert.ok(!LANDING_PATHS.includes(path), `${path} must not be a landing path`);
  }
});

test("every content page resolves, with and without a trailing slash", () => {
  for (const page of CONTENT_PAGES) {
    assert.equal(contentPageForPath(page.path)?.path, page.path);
    assert.equal(contentPageForPath(`${page.path}/`)?.path, page.path);
  }
  assert.equal(contentPageForPath("/not-a-page"), undefined);
  assert.equal(contentPageForPath("/"), undefined, "the homepage is the game, not a content page");
});

test("each content page renders a complete standalone document", () => {
  for (const page of CONTENT_PAGES) {
    const html = renderContentDocument(page);
    assert.ok(html.startsWith("<!doctype html>"), `${page.path} is not a document`);
    assert.match(html, /<html lang="en">/);
    assert.ok(html.includes(`<title>${page.title}</title>`), `${page.path} title`);
    assert.ok(html.includes(`<link rel="canonical" href="${canonicalUrl(page.path)}">`), `${page.path} canonical`);
    assert.ok(html.includes(`<h1>${page.h1}</h1>`), `${page.path} h1`);
    assert.ok(html.includes('name="description"'), `${page.path} description`);
    // A document, not the app: no root node and no module bundle to wait for.
    assert.ok(!html.includes('id="root"'), `${page.path} must not ship the app shell`);
    assert.ok(!html.includes("<script"), `${page.path} must not need script to show its text`);
    // Header nav, footer nav.
    assert.ok(html.includes('<nav class="cydi-nav">'), `${page.path} header nav`);
    assert.ok(html.includes('<footer class="cydi-foot">'), `${page.path} footer`);
  }
});

test("the nav appears on every content page and never links to itself", () => {
  for (const page of CONTENT_PAGES) {
    const html = renderContentDocument(page);
    for (const link of SITE_NAV) {
      if (link.href === page.path) {
        assert.ok(
          !html.includes(`<a href="${link.href}">${link.label}</a>`),
          `${page.path} should not link to itself in the nav`,
        );
      } else {
        assert.ok(html.includes(`<a href="${link.href}">${link.label}</a>`), `${page.path} is missing ${link.href}`);
      }
    }
  }
});

test("every nav destination is a page this Worker actually serves", () => {
  const served = new Set([...SEO_PAGES.map((page) => page.path), ...CONTENT_PATHS]);
  for (const link of SITE_NAV) {
    assert.ok(served.has(link.href), `nav points at ${link.href}, which nothing serves`);
  }
});

test("/privacy serves the policy text itself, not an empty shell", () => {
  const page = contentPageForPath("/privacy");
  assert.ok(page, "/privacy must be a content page");
  const html = renderContentDocument(page);
  // The exact sentences a reader (or a policy reviewer) is looking for.
  assert.ok(html.includes("CYDI does not require an"), "policy opening missing");
  assert.ok(html.includes("automatically expire after 180 days"), "retention detail missing");
  assert.ok(html.includes("privacy@playcydi.com"), "contact address missing");
  // And it is the shared module's text, not a second copy living in the Worker.
  assert.ok(html.includes(PRIVACY_POLICY_HTML.trim()), "/privacy must render src/content/privacyPolicyHtml.ts");
  // Big enough to be the real policy: the shell this used to serve was ~2.4 KB.
  assert.ok(html.length > 15_000, `/privacy document is only ${html.length} bytes`);
});

test("/how-to-play states the real scoring weights and both mode timings", () => {
  const html = renderContentDocument(contentPageForPath("/how-to-play")!);
  assert.ok(html.includes("70%"), "shape match weight missing");
  assert.ok(html.includes("20%"), "size weight missing");
  assert.ok(html.includes("20 seconds"), "multiplayer drawing window missing");
  assert.ok(html.includes("128 evenly spaced points"), "resample detail missing");
});

test("the sitemap lists every content page", () => {
  const xml = sitemapXml(CONTENT_PATHS);
  for (const path of CONTENT_PATHS) {
    assert.ok(xml.includes(`<loc>${canonicalUrl(path)}</loc>`), `${path} missing from sitemap`);
  }
  for (const page of SEO_PAGES) {
    assert.ok(xml.includes(`<loc>${canonicalUrl(page.path)}</loc>`), `${page.path} missing from sitemap`);
  }
});
