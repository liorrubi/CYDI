/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Web-only SEO layer: the per-path <head> metadata and the crawlable copy block
// the Worker injects after #root (see handleSeoPage in index.ts).
//
// This deliberately lives in the Worker and NOT in the app bundle: Capacitor
// serves index.html locally from inside the APK and never routes HTML through
// this Worker, so nothing in this file can reach or change the Android app.
//
// Pure data plus string builders (no Worker globals, no DOM), so
// src/seo/landingPages.test.ts can import it under plain Node to prove this
// path list and the app's landing-path list can never drift apart.

/**
 * Every canonical URL and sitemap entry points at the apex domain - www 301s to
 * it and the *.workers.dev host is only a deploy mirror - so the same page
 * crawled on any host still declares one canonical home.
 */
export const CANONICAL_ORIGIN = "https://playcydi.com";

/**
 * The app's real listing URL. Duplicated from src/services/nativeShare.ts rather
 * than imported, because that module pulls in Capacitor, which cannot load in a
 * Worker - src/seo/landingPages.test.ts asserts the two stay identical, and a
 * test there already ties that constant to the package id in capacitor.config.ts.
 */
export const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.playcydi.cydi";

export type SeoPage = {
  /** Canonical path, no trailing slash (except the homepage's "/"). */
  path: string;
  title: string;
  description: string;
  /** Heading for the injected copy block. In the served HTML #root is still
   * empty, so this is the only <h1> a crawler sees before hydration. */
  h1: string;
  paragraphs: string[];
  /** Small in-copy related links. Never the same target as `cta`, so the block
   * does not show the same destination twice in a row. */
  links: { href: string; label: string }[];
  /** The one prominent "keep playing" link, last thing in the copy block. The
   * homepage has none: the game itself is already the page. */
  cta?: { href: string; label: string };
  /** Secondary Google Play line. Omitted on the homepage, whose web home screen
   * already renders its own "Get the Android App" card (HomeScreen.tsx). */
  androidCta?: boolean;
};

const HOME: SeoPage = {
  path: "/",
  title: "CYDI - Free Online Drawing Accuracy Game",
  description:
    "Can you draw it? Redraw a shape freehand from memory and get an instant accuracy score. Free drawing game, plays in your browser - no download, no sign-up.",
  h1: "Can You Draw It? Test Your Drawing Accuracy",
  paragraphs: [
    "CYDI is a free drawing accuracy game that runs straight in your browser. Each round shows you a target shape for a few seconds, then clears the canvas: you redraw it freehand, by eye, with a mouse, trackpad or finger.",
    "The moment you finish, your attempt is compared against the target and scored out of 100 - shape match, coverage, smoothness and scale all count towards the total and the star rating. Your drawing is shown on top of the target too, so it is obvious where the line drifted, and you can retry the same shape as often as you like to push your best score higher.",
    "There is a large library of shapes to work through, grouped into categories like geometric shapes, symbols, letters, nature, food and sports, plus a new Daily Challenge every day. Nothing to install and no account to create - your progress and best scores are stored locally in your browser. An Android version is available if you would rather play in an app.",
  ],
  links: [
    { href: "/drawing-accuracy-test", label: "Take the drawing accuracy test" },
    { href: "/draw-a-perfect-circle", label: "Try to draw a perfect circle" },
    { href: "/draw-shapes-online", label: "Draw shapes online" },
  ],
};

const ACCURACY_TEST: SeoPage = {
  path: "/drawing-accuracy-test",
  title: "Drawing Accuracy Test - How Precise Is Your Freehand? | CYDI",
  description:
    "A quick drawing accuracy test: redraw the target shape freehand and get scored on shape match, coverage, smoothness and scale. Free, instant, in your browser.",
  h1: "Drawing Accuracy Test",
  paragraphs: [
    "How precise is your freehand, really? This is a short drawing accuracy test: a target shape appears for a few seconds, you redraw it on the empty canvas, and CYDI measures how close you got.",
    "The score is measured, not guessed. Your stroke is compared to the target on four separate things - shape match (does your outline follow the same form?), coverage (did you draw the whole shape?), smoothness (a steady line or a shaky one?) and scale (the right size, not much smaller or larger) - and those combine into one percentage plus a star rating. Your attempt is drawn over the target afterwards, so the score always comes with visible evidence.",
    "The test starts with a circle, which is the fairest way to benchmark a steady hand: no corners to aim at and nowhere to hide a wobble. Retake it as many times as you want - only your best score is kept - and when you want harder targets, the full shape library is one click away.",
  ],
  links: [
    { href: "/draw-a-perfect-circle", label: "Draw a perfect circle" },
    { href: "/", label: "CYDI home" },
  ],
  cta: { href: "/draw-shapes-online", label: "Play More Drawing Challenges" },
  androidCta: true,
};

const PERFECT_CIRCLE: SeoPage = {
  path: "/draw-a-perfect-circle",
  title: "Draw a Perfect Circle - Free Online Test | CYDI",
  description:
    "Try to draw a perfect circle freehand and get an instant score out of 100, with your attempt laid over the target. Free, no download, plays in your browser.",
  h1: "Draw a Perfect Circle",
  paragraphs: [
    "Drawing a perfect circle freehand is famously hard. There are no straight edges to anchor against and no corners to aim for - just one continuous curve that has to come back and meet exactly where it started.",
    "Try it here. The target circle is shown for a few seconds, then you draw yours on the blank canvas and get an instant score out of 100, with your attempt overlaid on the target so you can see precisely where the curve went wide, flat or lumpy. A wobbly line costs you smoothness, an oval costs you shape match, and stopping short of the join costs you coverage.",
    "The last few percent are the hard part: the gap between a good circle and a great one is almost entirely hand steadiness and pace. Retry as often as you like, since only your best score is kept, and move on to tougher targets whenever you are ready.",
  ],
  links: [
    { href: "/drawing-accuracy-test", label: "Take the full drawing accuracy test" },
    { href: "/", label: "CYDI home" },
  ],
  cta: { href: "/draw-shapes-online", label: "Play More Drawing Challenges" },
  androidCta: true,
};

const DRAW_SHAPES: SeoPage = {
  path: "/draw-shapes-online",
  title: "Draw Shapes Online - Free Shape Drawing Game | CYDI",
  description:
    "Draw shapes online for free: circles, polygons, stars, spirals, symbols and letters. Redraw each target freehand and get an instant accuracy score. No sign-up.",
  h1: "Draw Shapes Online",
  paragraphs: [
    "CYDI is a free shape drawing game that runs entirely in the browser. There is nothing to download, no account to create and no drawing tablet needed - a mouse, a trackpad or a finger is enough.",
    "Pick a category and work through it shape by shape. Geometric shapes come first, from a plain circle and oval through triangles, pentagons and heptagons to multi-point stars, spirals, waves and gears, followed by categories like symbols, the English alphabet, nature, food and sports. Every shape flashes up as a target, you redraw it freehand, and you get a scored side-by-side comparison right away. Clearing a shape unlocks the next one in its category, so the targets get harder as your hand gets steadier.",
    "Best scores are saved per shape in your browser, which makes it easy to come back and beat your own record on the shapes that beat you.",
  ],
  links: [
    { href: "/drawing-accuracy-test", label: "Test your drawing accuracy" },
    { href: "/", label: "CYDI home" },
  ],
  // This page IS the shape map, so "play more shapes" would point at itself -
  // the natural next step is the single-shape challenge instead.
  cta: { href: "/draw-a-perfect-circle", label: "Try the Perfect Circle Challenge" },
  androidCta: true,
};

/** Pages the Worker rewrites the <head> of and injects copy into. */
export const SEO_PAGES: SeoPage[] = [HOME, ACCURACY_TEST, PERFECT_CIRCLE, DRAW_SHAPES];

/**
 * Landing paths only - the homepage is excluded. This is the list
 * src/seo/landingPages.ts must mirror (asserted by its test), because those are
 * the paths the app has to recognise to open the right challenge.
 */
export const LANDING_PATHS: string[] = SEO_PAGES.filter((page) => page.path !== "/").map((page) => page.path);

/** Extra paths that belong in the sitemap but need no metadata rewriting. */
const STATIC_SITEMAP_PATHS = ["/privacy"];

/**
 * Trailing slashes are stripped so "/draw-shapes-online/" resolves to the same
 * page, and "/index.html" resolves to the homepage - otherwise it would serve the
 * same content as "/" with no canonical of its own.
 */
export function seoPageForPath(pathname: string): SeoPage | undefined {
  if (pathname === "/index.html") return HOME;
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return SEO_PAGES.find((page) => page.path === normalized);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function canonicalUrl(path: string): string {
  return path === "/" ? `${CANONICAL_ORIGIN}/` : `${CANONICAL_ORIGIN}${path}`;
}

/**
 * The crawlable copy block, injected at the very end of <body> - after the
 * full-height #root the game renders into, so it sits below the first screen and
 * leaves the game itself as the entire opening view. Styles are scoped and
 * inline (the block is served before the app's CSS bundle loads) and read the
 * app's own theme variables where they exist, with plain fallbacks.
 */
export function renderSeoSection(page: SeoPage): string {
  const paragraphs = page.paragraphs.map((text) => `<p>${escapeHtml(text)}</p>`).join("");
  const links = page.links
    .map((link) => `<li><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></li>`)
    .join("");
  // Plain <a href> - crawlable, and a normal navigation that re-enters the SPA at
  // the target path, so no client-side router is involved.
  const cta = page.cta
    ? `<p class="cydi-seo-cta"><a href="${escapeHtml(page.cta.href)}">${escapeHtml(page.cta.label)} &rarr;</a></p>`
    : "";
  // Deliberately the quietest element in the block: plain small text under the
  // primary CTA, never a badge or a button.
  const android = page.androidCta
    ? `<p class="cydi-seo-store">Enjoy CYDI on Android - ` +
      `<a href="${PLAY_STORE_URL}" rel="noopener">get CYDI on Google Play</a></p>`
    : "";
  return (
    `<style>` +
    `.cydi-seo{max-width:46rem;margin:0 auto;padding:2rem 1.25rem 3rem;` +
    `font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;` +
    `color:var(--color-text,#222);border-top:1px solid rgba(128,128,128,.35);line-height:1.6}` +
    `.cydi-seo h1{font-size:1.35rem;margin:0 0 .75rem}` +
    `.cydi-seo p{margin:0 0 .9rem;opacity:.85}` +
    `.cydi-seo ul{margin:0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:.75rem 1.25rem}` +
    `.cydi-seo a{color:var(--color-primary,#2563eb)}` +
    `.cydi-seo-cta{margin:1.5rem 0 .5rem!important;opacity:1!important}` +
    `.cydi-seo-cta a{display:inline-block;padding:.6rem 1.1rem;border:1px solid currentColor;` +
    `border-radius:.5rem;font-weight:600;text-decoration:none}` +
    `.cydi-seo-store{font-size:.9rem;opacity:.7!important;margin:0!important}` +
    `</style>` +
    `<section class="cydi-seo">` +
    `<h1>${escapeHtml(page.h1)}</h1>` +
    paragraphs +
    `<ul>${links}</ul>` +
    cta +
    android +
    `</section>`
  );
}

export function robotsTxt(): string {
  return [
    "User-agent: *",
    "Allow: /",
    // Worker API surface and the admin dashboards: never useful in an index.
    "Disallow: /api/",
    "Disallow: /admin",
    // Player-generated share links - thin, duplicate SPA shells. Also served
    // with X-Robots-Tag: noindex, which is what actually keeps them out.
    "Disallow: /c/",
    "",
    `Sitemap: ${CANONICAL_ORIGIN}/sitemap.xml`,
    "",
  ].join("\n");
}

export function sitemapXml(): string {
  const paths = [...SEO_PAGES.map((page) => page.path), ...STATIC_SITEMAP_PATHS];
  const entries = paths.map((path) => `  <url><loc>${canonicalUrl(path)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}
