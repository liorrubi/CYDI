/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * Hands a page over from the Worker's crawlable block to the interactive UI.
 *
 * THE PROBLEM THIS SOLVES. Several public URLs are owned by two things at once.
 * The Worker answers them with the app shell plus a server-rendered block of
 * crawlable copy appended after #root (worker/seoPages.ts) - that block is what
 * a search engine, or anyone with JavaScript off, reads. Then the app boots and
 * renders the real experience into #root, ABOVE it. Leaving both on the page
 * gives the visitor the new UI followed by a full screen of the old standalone
 * white document, and gives the page two <h1>s.
 *
 * So once the interactive UI is actually on screen, it takes ownership: the
 * server block is removed. Progressive enhancement, in the ordinary sense -
 *
 *   no JavaScript  -> the Worker's block stands, with its own <h1>, its copy,
 *                     its internal links and the canonical <link> in <head>
 *   JavaScript     -> the app renders and the block steps aside
 *
 * Exactly one <h1> either way, one canonical URL either way, and no duplicate
 * alternate address invented to dodge the collision.
 *
 * EVERY web surface must call this, which is why it lives here rather than in
 * one component: the site shell (SiteHome, the 4a practice pages) AND the game
 * shell (SiteGameSkin), because landing paths like /multiplayer-drawing-game,
 * /2-player-drawing-game-one-phone and /draw-shapes-online resolve to GAME
 * screens and are served with the very same crawlable block.
 *
 * The <head> is never touched - title, description, canonical and og: tags are
 * the Worker's and stay exactly as served.
 */
import { useEffect } from "react";

/**
 * The block worker/seoPages.ts appends after #root.
 *
 * Exported because it is a CONTRACT between the two sides: the Worker emits it,
 * the client removes it. crawlableBlock.test.ts asserts the Worker's real HTML
 * still contains exactly one element this selector matches, on every page that
 * ships the block - so renaming one side without the other fails the build
 * rather than silently leaving the old document under the app.
 */
export const CRAWLABLE_BLOCK_SELECTOR = "section.cydi-seo";

/** The class the selector keys on, split out so a test can match raw HTML. */
export const CRAWLABLE_BLOCK_CLASS = "cydi-seo";

/** Pure, so it can be exercised without a DOM. Returns whether a block was found. */
export function removeCrawlableBlock(root: { querySelector(sel: string): { remove(): void } | null }): boolean {
  const block = root.querySelector(CRAWLABLE_BLOCK_SELECTOR);
  if (!block) return false;
  block.remove();
  return true;
}

/** The practice list inside the block - the hub's "Practice individual shapes". */
export const PRACTICE_LIST_SELECTOR = "ul.cydi-seo-practice";

/**
 * The id on that list's heading, and the link that aims at it.
 *
 * A contract in the same sense as the block selector: the Worker renders the id
 * (worker/seoPages.ts), the home page links to it (SiteHome.tsx), and this module
 * scrolls to it after the takeover has changed the page's height. All three read
 * it from here, and crawlableBlock.test.ts asserts the Worker's HTML really
 * carries it.
 */
export const PRACTICE_SECTION_ID = "practice-shapes";
export const PRACTICE_SECTION_HREF = `/draw-shapes-online#${PRACTICE_SECTION_ID}`;

/**
 * Paths where the block's practice list is kept on screen instead of being
 * removed with the rest of it.
 *
 * Only the shape hub. That page's whole job is to send people to a shape, the
 * list is the one part of the block that is a navigation aid rather than a
 * restatement of the page, and without this it is markup only a crawler ever
 * sees. Everywhere else the block still steps aside whole.
 */
export const PRACTICE_LIST_PATHS = ["/draw-shapes-online"];

type TrimmableElement = {
  children: ArrayLike<TrimmableElement>;
  querySelector(sel: string): TrimmableElement | null;
  previousElementSibling: TrimmableElement | null;
  classList: { add(token: string): void };
  remove(): void;
};

/**
 * Hands the page over but keeps the practice list, in place, below the app.
 *
 * The list that survives is the Worker's own markup - same anchors, same
 * descriptions, same styles - so there is exactly one copy of it on the page and
 * nothing here has to be kept in step with the server's copy. Everything else in
 * the block goes, including its <h1>, which is what keeps the page to one.
 *
 * The block already sits after #root, so "below the game" needs no moving.
 */
export function keepPracticeList(root: { querySelector(sel: string): TrimmableElement | null }): "kept" | "removed" | "none" {
  const block = root.querySelector(CRAWLABLE_BLOCK_SELECTOR);
  if (!block) return "none";
  const list = block.querySelector(PRACTICE_LIST_SELECTOR);
  // No list on this page: nothing worth keeping, so behave exactly as before.
  if (!list) {
    block.remove();
    return "removed";
  }
  const heading = list.previousElementSibling;
  for (const child of Array.from(block.children)) {
    if (child === list || child === heading) continue;
    child.remove();
  }
  block.classList.add("cydi-seo-practice-only");
  return "kept";
}

/** Trailing slashes are stripped so "/draw-shapes-online/" behaves the same way. */
function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

export function useCrawlableBlockTakeover(): void {
  useEffect(() => {
    if (PRACTICE_LIST_PATHS.includes(normalizePath(window.location.pathname))) {
      const kept = keepPracticeList(document);
      // Someone arriving on #practice-shapes has already been scrolled there by the
      // browser, against the full block - and then the app renders the game above it
      // and the rest of the block disappears, moving the target by well over a
      // screen. Re-aim afterwards, twice: once on the next frame, and once more when
      // the lazily-loaded game screen has painted and stopped changing the height.
      // Scrolling only once lands the visitor past the section they asked for.
      if (kept === "kept" && window.location.hash === `#${PRACTICE_SECTION_ID}`) {
        const aim = () => document.getElementById(PRACTICE_SECTION_ID)?.scrollIntoView({ block: "start" });
        requestAnimationFrame(aim);
        const settle = window.setTimeout(aim, 400);
        return () => window.clearTimeout(settle);
      }
      return;
    }
    removeCrawlableBlock(document);
  }, []);
}
