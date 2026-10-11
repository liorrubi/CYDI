// 0.59.0 final QA pass - guards for the consolidated fixes (source audits: these are layout/native changes that unit
// tests cannot render). Behaviour was measured on the Mi 8 (physical) and with viewport emulation.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("phones are portrait-only; tablets, unfolded foldables and multi-window keep every orientation", () => {
  const java = read("../../android/app/src/main/java/com/playcydi/cydi/MainActivity.java");
  assert.match(java, /TABLET_MIN_SMALLEST_WIDTH_DP = 600/);
  assert.match(java, /config\.smallestScreenWidthDp < TABLET_MIN_SMALLEST_WIDTH_DP/);
  assert.match(java, /phone && !isInMultiWindowMode\(\)\s*\n\s*\? ActivityInfo\.SCREEN_ORIENTATION_USER_PORTRAIT\s*\n\s*: ActivityInfo\.SCREEN_ORIENTATION_UNSPECIFIED/);
  assert.match(java, /onConfigurationChanged\(Configuration newConfig\) \{\s*\n\s*super\.onConfigurationChanged\(newConfig\);[\s\S]*applyOrientationPolicy\(newConfig\)/, "re-decided on fold / unfold");
  const manifest = read("../../android/app/src/main/AndroidManifest.xml");
  assert.doesNotMatch(manifest, /screenOrientation/, "no manifest-wide lock (it would bind tablets too)");
  assert.match(manifest, /configChanges="[^"]*smallestScreenSize/);
});

test("Rewarded offers: both choices on one row and brought into view at the moment the offer counts as shown", () => {
  const css = read("../styles/global.css");
  assert.match(css, /\.double-offer-buttons \{\n  flex-wrap: nowrap;\n\}/);
  assert.match(css, /\.double-offer-buttons > button \{\n  flex: 1 1 0;\n  min-width: 0;/);
  const coin = read("../components/DoubleCoinsOffer.tsx");
  assert.match(coin, /onShown\?\.\(\);\s*\n\s*\/\/ Shown = on screen[^\n]*\n\s*cancelReveal = bringIntoView\(anchorRef\.current\?\.querySelector\("\.double-offer-buttons"\)\);/);
  const ink = read("../components/InkTrialOffer.tsx");
  assert.match(ink, /cancelReveal = bringIntoView\(rootRef\.current\?\.querySelector\("\.ink-offer-actions"\)\);/);
  for (const s of [coin, ink]) assert.match(s, /cancelShown\(\);\s*\n\s*cancelReveal\(\);/, "an unmount cancels a pending reveal");
  // Layout only: the helper never touches analytics, payouts or cadence.
  const helper = read("./offerVisibility.ts");
  assert.doesNotMatch(helper, /trackEvent|addCoins|Cadence|preload/);
});

test("offer reveal: after the pop-in, by layout position (transforms ignored), just enough, never above the top", async () => {
  type Box = { offsetTop: number; offsetHeight: number; offsetParent: null; isConnected: boolean };
  const scrolls: number[] = [];
  const timers: (() => void)[] = [];
  const g = globalThis as Record<string, unknown>;
  class FakeEl implements Box { offsetTop = 0; offsetHeight = 0; offsetParent = null; isConnected = true; }
  g.HTMLElement = FakeEl;
  g.window = {
    innerHeight: 738,
    scrollY: 0,
    setTimeout: (fn: () => void) => (timers.push(fn), timers.length),
    clearTimeout: (id: number) => (timers[id - 1] = () => {}),
    matchMedia: () => ({ matches: false }),
    scrollTo: ({ top }: { top: number }) => scrolls.push(top),
  };
  const { bringIntoView, OFFER_SETTLE_MS } = await import("./offerVisibility.ts");
  assert.ok(OFFER_SETTLE_MS >= 400, "after the longest offer entrance animation");
  const row = (top: number, h: number) => Object.assign(new FakeEl(), { offsetTop: top, offsetHeight: h });
  bringIntoView(row(692, 54)); // Mi 8: the vc81 measurement, 8px below the fold
  bringIntoView(row(300, 54)); // already on screen
  const cancel = bringIntoView(row(900, 54));
  cancel(); // unmounted before it settled
  bringIntoView(row(1200, 54)); // far below a short screen
  assert.equal(scrolls.length, 0, "nothing happens before the offer has settled");
  for (const fn of timers) fn();
  assert.deepEqual(scrolls, [692 + 54 - 738 + 12, 1200 + 54 - 738 + 12], "just enough to show the whole row, with a 12px margin");
  const tall = Object.assign(new FakeEl(), { offsetTop: 700, offsetHeight: 900 });
  bringIntoView(tall);
  timers.at(-1)!();
  assert.equal(scrolls.at(-1), 700 - 12, "taller than the screen: its top stays on screen");
});

test("short-screen play rules: Android shell and web shell each scoped to their own wrapper, canvas untouched", () => {
  const web = read("../styles/global.css");
  const block = web.slice(web.indexOf("0.59.0 WEB PLAY"));
  assert.match(block, /@media \(max-height: 800px\)/);
  // Every selector line inside the media block (lines indented by two spaces that start a selector).
  const selectors = (css: string) => css.split("\n").filter((l) => /^ {2}\S/.test(l) && !/^ {2}\}/.test(l)).map((l) => l.trim());
  const webRules = block.slice(0, block.indexOf("\n}\n"));
  for (const sel of selectors(webRules)) assert.ok(sel.startsWith(".site-main "), `web rule scoped to the web shell: ${sel}`);
  assert.doesNotMatch(webRules, /canvas-wrapper \{|drawing-canvas|^\s+(width|height):/m, "no canvas sizing");
  const shell = read("../styles/appShell.css");
  const play = shell.slice(shell.indexOf("PLAY on screens up to 700px tall"));
  const shellRules = play.slice(0, play.indexOf("\n}\n"));
  for (const sel of selectors(shellRules)) assert.ok(sel.startsWith(".app-shell "), `Android rule scoped to the app shell: ${sel}`);
});

test("SEO: category pricing reads 'from 1,000 coins' (0.59.0 prices rise with each category bought)", () => {
  const pages = read("../../worker/contentPages.ts");
  assert.match(pages, /new shape category costs from \$\{CATEGORY_UNLOCK_COST/);
  assert.match(pages, /unlocked with coins \(from \$\{CATEGORY_UNLOCK_COST[^\n]*\n\s*"coins\)\."/);
  assert.doesNotMatch(pages, /"each\)\."/);
});
