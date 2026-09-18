/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * The crawlable block is owned by two sides that must agree.
 *
 * The Worker appends a server-rendered block after #root so a crawler, or
 * anyone with JavaScript off, gets real content, an <h1> and internal links.
 * The app then takes the page over and removes that block, so a visitor is not
 * shown the interactive UI followed by a whole second copy of the page as a
 * standalone white document - which is exactly the bug this guards against,
 * and which no "does the new component render?" check can catch.
 *
 * These tests hold both halves of that contract:
 *
 *   server side  every SEO page still ships the block, with its <h1> and links
 *   client side  the selector the app removes still matches what the Worker emits
 *
 * Rename one side without the other and this fails, rather than silently
 * leaving the old document sitting under the app.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SEO_PAGES, renderSeoSection } from "../../worker/seoPages";
import {
  CRAWLABLE_BLOCK_CLASS,
  CRAWLABLE_BLOCK_SELECTOR,
  removeCrawlableBlock,
} from "./crawlableBlock";

/** Counts `<section class="… cydi-seo …">` openings in raw HTML. */
function blockCount(html: string): number {
  return [...html.matchAll(new RegExp(`<section[^>]*class="[^"]*\\b${CRAWLABLE_BLOCK_CLASS}\\b[^"]*"`, "g"))].length;
}

test("every SEO page ships exactly one crawlable block", () => {
  assert.ok(SEO_PAGES.length > 0, "there should be SEO pages");
  for (const page of SEO_PAGES) {
    const html = renderSeoSection(page);
    assert.equal(blockCount(html), 1, `${page.path} should render exactly one crawlable block`);
  }
});

test("the block a crawler reads carries the page's h1, copy and links", () => {
  for (const page of SEO_PAGES) {
    const html = renderSeoSection(page);
    assert.match(html, /<h1>/, `${page.path} needs an h1 for crawlers`);
    assert.ok(html.includes(page.h1), `${page.path} h1 text should be the page's own`);
    assert.equal([...html.matchAll(/<h1>/g)].length, 1, `${page.path} must have exactly one h1`);
    assert.match(html, /<a href="\//, `${page.path} needs crawlable internal links`);
  }
});

test("the selector the app removes matches the element the Worker emits", () => {
  // The contract, spelled out: the selector is `section.<class>`, and the
  // Worker's own markup is a <section> carrying that class.
  assert.equal(CRAWLABLE_BLOCK_SELECTOR, `section.${CRAWLABLE_BLOCK_CLASS}`);
  for (const page of SEO_PAGES) {
    assert.ok(
      renderSeoSection(page).includes(`<section class="${CRAWLABLE_BLOCK_CLASS}">`),
      `${page.path} should emit a <section class="${CRAWLABLE_BLOCK_CLASS}"> for the app to take over`,
    );
  }
});

test("the takeover removes the block when it is present", () => {
  let removed = false;
  const root = {
    querySelector(selector: string) {
      return selector === CRAWLABLE_BLOCK_SELECTOR
        ? {
            remove() {
              removed = true;
            },
          }
        : null;
    },
  };
  assert.equal(removeCrawlableBlock(root), true);
  assert.equal(removed, true, "the block should have been removed");
});

test("the takeover is a no-op where there is no block", () => {
  // /play and every in-app screen are served without one; the hook must not throw.
  const root = { querySelector: () => null };
  assert.equal(removeCrawlableBlock(root), false);
});

test("the takeover asks for the block by the agreed selector, nothing else", () => {
  const asked: string[] = [];
  removeCrawlableBlock({
    querySelector(selector: string) {
      asked.push(selector);
      return null;
    },
  });
  assert.deepEqual(asked, [CRAWLABLE_BLOCK_SELECTOR]);
});
