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
  PRACTICE_LIST_PATHS,
  PRACTICE_LIST_SELECTOR,
  keepPracticeList,
  removeCrawlableBlock,
} from "./crawlableBlock";

/**
 * A block with the children the Worker really emits, in the order it emits them.
 * Hand-built rather than parsed: this file runs under plain Node with no DOM, and
 * the only behaviour under test is which children survive.
 */
function fakeBlock({ withList = true } = {}) {
  const make = (name: string) => ({ name, removed: false, remove() { this.removed = true; },
    querySelector: () => null, previousElementSibling: null as unknown, classList: { add() {} },
    children: [] as unknown[] });
  const nav = make("nav");
  const h1 = make("h1");
  const para = make("p");
  const heading = make("h2.practice");
  const list = make("ul.cydi-seo-practice");
  const faq = make("dl.faq");
  const foot = make("p.foot");
  list.previousElementSibling = heading;
  const children = withList ? [nav, h1, para, heading, list, faq, foot] : [nav, h1, para, faq, foot];
  const added: string[] = [];
  const block = {
    name: "section.cydi-seo",
    removed: false,
    remove() { this.removed = true; },
    classList: { add: (token: string) => added.push(token) },
    children,
    querySelector: (sel: string) => (sel === PRACTICE_LIST_SELECTOR && withList ? list : null),
  };
  const root = { querySelector: (sel: string) => (sel === CRAWLABLE_BLOCK_SELECTOR ? block : null) };
  return { root, block, nav, h1, para, heading, list, faq, foot, added };
}

test("on the hub the practice list stays and the rest of the block goes", () => {
  const { root, block, nav, h1, para, heading, list, faq, foot, added } = fakeBlock();
  assert.equal(keepPracticeList(root as never), "kept");
  // The list and its own heading survive - and nothing else does, including the
  // block's <h1>, which is what keeps the page to a single one.
  assert.equal(list.removed, false);
  assert.equal(heading.removed, false);
  for (const gone of [nav, h1, para, faq, foot]) assert.equal(gone.removed, true);
  assert.equal(block.removed, false, "the block itself must stay - it holds the list");
  assert.deepEqual(added, ["cydi-seo-practice-only"]);
});

test("a page with no practice list still has its block removed whole", () => {
  const { root, block } = fakeBlock({ withList: false });
  assert.equal(keepPracticeList(root as never), "removed");
  assert.equal(block.removed, true);
});

test("keeping the list is scoped to the shape hub, and that page really ships one", () => {
  assert.deepEqual(PRACTICE_LIST_PATHS, ["/draw-shapes-online"]);
  for (const path of PRACTICE_LIST_PATHS) {
    const page = SEO_PAGES.find((candidate) => candidate.path === path);
    assert.ok(page, `${path} is not an SEO page`);
    assert.ok(page.linkGroup && page.linkGroup.items.length > 0, `${path} has no practice list to keep`);
    // The four the hub is expected to offer, in the Worker's own order.
    assert.deepEqual(page.linkGroup.items.map((item) => item.href), [
      "/draw-a-perfect-circle",
      "/draw-a-perfect-star",
      "/draw-a-perfect-heart",
      "/draw-a-dog-from-memory",
    ]);
    assert.match(renderSeoSection(page), new RegExp(`<ul class="cydi-seo-practice">`));
  }
});

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
