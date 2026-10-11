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
  assert.match(coin, /onShown\?\.\(\);\s*\n\s*\/\/ Shown = on screen[^\n]*\n\s*bringIntoView\(anchorRef\.current\?\.querySelector\("\.double-offer-buttons"\)\);/);
  const ink = read("../components/InkTrialOffer.tsx");
  assert.match(ink, /bringIntoView\(rootRef\.current\?\.querySelector\("\.ink-offer-actions"\)\);/);
  // Layout only: the helper never touches analytics, payouts or cadence.
  const helper = read("./offerVisibility.ts");
  assert.doesNotMatch(helper, /trackEvent|addCoins|Cadence|preload/);
  assert.match(helper, /scrollIntoView\(\{ block: "nearest"/);
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
