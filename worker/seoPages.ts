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

// Numbers stated on these pages come from here, never from memory: publicFacts
// either imports the game's real value or is pinned to it by a test. An audit of
// this file found copy claiming the four scored components "all count" equally
// when shape match is most of the score, and describing the shape library only
// as "large" - the kind of drift that makes a page worth less than no page.
import {
  CATEGORY_COUNT,
  CATEGORY_FACTS,
  RESAMPLE_POINTS,
  SCORE_WEIGHT_PERCENTS,
  SHAPE_COUNT,
  SIZE_TOLERANCE_PERCENT,
} from "../src/content/publicFacts";

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
  /** One illustration, rendered as a real <img> with descriptive alt text and a
   * caption. Generated from the shape's own generator function by
   * scripts/generateSeoShapeImages.ts, so it always shows the target the page
   * actually asks the player to draw. */
  image?: { src: string; alt: string; caption: string; width: number; height: number };
  /** Copy that belongs AFTER the link group rather than before it - used where a
   * paragraph introduces the links that follow it. */
  paragraphsAfterLinkGroup?: string[];
  /** A headed block of prominent internal links - the hub's "Practice individual
   * shapes" list. Same no-duplicate rule as `links` above. */
  linkGroup?: { heading: string; items: { href: string; label: string; description: string }[] };
  /** The one prominent "keep playing" link, last thing in the copy block. The
   * homepage has none: the game itself is already the page.
   *
   * Usually another landing path. On the two mode pages it is a `#root` fragment
   * instead: the app at the top of THAT page already opens in the mode the copy
   * is about, so the CTA has to lead up to it. Sending those to `/` would land
   * the visitor on Classic - the one place the button does not promise. */
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
    `The moment you finish, your attempt is compared against the target and scored out of 100. Four things are measured, and they do not count equally: shape match is ${SCORE_WEIGHT_PERCENTS.shapeMatch}% of the score, size ${SCORE_WEIGHT_PERCENTS.scale}%, and coverage and smoothness ${SCORE_WEIGHT_PERCENTS.coverage}% each - so getting the form right matters far more than drawing a steady line. Your drawing is then shown on top of the target, so it is obvious where the line drifted, and you can retry the same shape as often as you like to push your best score higher.`,
    `There are ${SHAPE_COUNT} shapes to work through across ${CATEGORY_COUNT} categories - geometric shapes, symbols, the alphabet, animals, nature, food, sport, transport, household objects, calligraphy, fantasy and universal signs - plus a new Daily Challenge every day. Nothing to install and no account to create: your progress and best scores are stored locally in your browser. An Android version is available if you would rather play in an app.`,
  ],
  links: [
    { href: "/how-to-play", label: "How to play, and how the scoring works" },
    { href: "/drawing-accuracy-test", label: "Take the drawing accuracy test" },
    { href: "/draw-a-perfect-circle", label: "Try to draw a perfect circle" },
    { href: "/draw-shapes-online", label: "Draw shapes online" },
    { href: "/multiplayer-drawing-game", label: "Multiplayer drawing game with friends" },
    { href: "/2-player-drawing-game-one-phone", label: "2 player drawing game on one phone" },
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
    `The score is measured, not guessed. Both your stroke and the target are resampled to ${RESAMPLE_POINTS} evenly spaced points and compared point for point on four things - shape match (does your outline follow the same form?), size (the right size, not much smaller or larger), coverage (did you draw the whole shape?) and smoothness (a steady line or a shaky one?). They are weighted ${SCORE_WEIGHT_PERCENTS.shapeMatch}%, ${SCORE_WEIGHT_PERCENTS.scale}%, ${SCORE_WEIGHT_PERCENTS.coverage}% and ${SCORE_WEIGHT_PERCENTS.smoothness}% into one percentage plus a star rating. Your attempt is drawn over the target afterwards, so the score always comes with visible evidence.`,
    `Where you start the line and which way round you go are not part of the test: every possible starting point is tried, in both directions, and the best alignment is the one that gets scored. What is not forgiven is size - draw much smaller than the target and a ceiling comes down on the total no matter how good the outline is.`,
    "The test starts with a circle, which is the fairest way to benchmark a steady hand: no corners to aim at and nowhere to hide a wobble. Retake it as many times as you want - only your best score is kept - and when you want harder targets, the full shape library is one click away.",
  ],
  links: [
    { href: "/draw-a-perfect-circle", label: "Draw a perfect circle" },
    { href: "/how-to-play", label: "What each part of the score measures" },
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
    `Two things decide it. Every point of a circle sits the same distance from its centre, so any stretch into an oval shows up immediately in shape match - which is ${SCORE_WEIGHT_PERCENTS.shapeMatch}% of the score, far more than the smoothness a shaky line costs you. And the line has to come back to where it started: the join is the one place a circle can visibly fail to close.`,
    `Draw it big. Size is the other ${SCORE_WEIGHT_PERCENTS.scale}%, and it works as a ceiling as well as a component - up to about ${SIZE_TOLERANCE_PERCENT}% off costs nothing, but past that every further 1% of size error takes a point off the highest total the round can reach. A neat little circle in the corner of the canvas cannot score what the same circle drawn full size would.`,
    "The last few percent are the hard part: the gap between a good circle and a great one is almost entirely hand steadiness and pace. Retry as often as you like, since only your best score is kept, and move on to tougher targets whenever you are ready.",
  ],
  image: {
    src: "/images/seo/draw-a-perfect-circle-radius-and-closing-guide.svg",
    alt: "Circle target with four dashed radii from its centre and a marked point where the drawn line has to close back onto its own start",
    caption:
      "The circle target and the two things it is judged on: one distance from the centre, held all the way round, and a line that closes back onto its own start.",
    width: 400,
    height: 400,
  },
  links: [
    { href: "/draw-a-perfect-star", label: "Draw a perfect star" },
    { href: "/draw-a-perfect-heart", label: "Draw a perfect heart" },
    { href: "/drawing-accuracy-test", label: "Take the full drawing accuracy test" },
    { href: "/", label: "CYDI home" },
  ],
  cta: { href: "/draw-shapes-online", label: "Play More Drawing Challenges" },
  androidCta: true,
};

const PERFECT_STAR: SeoPage = {
  path: "/draw-a-perfect-star",
  title: "Draw a Perfect Star - Freehand Symmetry Challenge | CYDI",
  description:
    "Draw a five-point star freehand and get scored out of 100. Five tips at equal spacing, straight edges, one mirror line - see exactly which point let you down.",
  h1: "Draw a Perfect Star",
  paragraphs: [
    "A star punishes a different weakness than a circle does. Nothing here is curved: a five-point star is ten straight edges and ten corners, and the whole shape only reads as a star if all five arms come out the same length, the five tips land the same distance from the centre, and each arm sits 72 degrees around from the last.",
    "Draw yours here and the score tells you where the symmetry broke. Your stroke is measured on shape match (are the arms actually where a star's arms belong?), coverage (all five points closed, not four and a gap), smoothness (straight edges rather than bowed ones) and scale, then laid over the target so a short arm or a drifting tip is impossible to miss.",
    "Freehand stars fail in predictable ways: the first arms come out well and the last one has to stretch or shrink to close the loop, the bottom two legs droop inwards, and the inner corners creep outwards until the star starts to look like a flower. Aiming at the tips before you start - and keeping the inner corners on their own smaller circle - is what turns a five-point scribble into a symmetrical star.",
  ],
  image: {
    src: "/images/seo/draw-a-perfect-star-five-point-star-symmetry-guide.svg",
    alt: "Five-point star target showing the vertical mirror axis, the outer circle its five tips sit on and the inner circle its five corners sit on",
    caption:
      "The star target, with the two rings and the mirror line every point has to respect: tips on the outer ring, inner corners on the smaller one, 72 degrees between arms.",
    width: 400,
    height: 400,
  },
  links: [
    { href: "/draw-a-perfect-heart", label: "Draw a perfect heart" },
    { href: "/draw-a-perfect-circle", label: "Draw a perfect circle" },
    { href: "/drawing-accuracy-test", label: "Take the drawing accuracy test" },
    { href: "/how-to-play", label: "How the score is worked out" },
    { href: "/", label: "CYDI home" },
  ],
  cta: { href: "/draw-shapes-online", label: "Browse Every Shape Challenge" },
  androidCta: true,
};

const PERFECT_HEART: SeoPage = {
  path: "/draw-a-perfect-heart",
  title: "Draw a Perfect Heart - Symmetry and Curves Test | CYDI",
  description:
    "Draw a heart freehand and get an instant score out of 100. Two matching lobes, a centred dip and a bottom point on one axis - find out how symmetrical yours really is.",
  h1: "Draw a Perfect Heart",
  paragraphs: [
    "A heart is the symmetry test. It is one closed line made of two mirrored halves, and the eye reads any mismatch between them instantly - a lobe that sits higher than the other, a curve that is fuller on one side, a bottom point that has wandered off centre.",
    "Three things have to line up. The dip between the lobes and the bottom point both belong on the same vertical centre line; the two lobes have to reach their widest at the same height and by the same amount; and each curve has to flow into the next without a flat spot or a corner where the lobe turns down into the point.",
    "Draw the target here and the score breaks it down: shape match catches lopsided lobes and an off-centre point, smoothness catches the flattened outer curves that come from drawing a heart in short nervous strokes, coverage catches a gap where the line failed to close at the dip or the tip, and scale catches a heart drawn far too small to control. Your attempt is drawn over the target afterwards, which is the fastest way to see which half of your heart is the honest one.",
  ],
  image: {
    src: "/images/seo/draw-a-perfect-heart-symmetry-and-curve-guide.svg",
    alt: "Heart target showing the vertical mirror axis with the centre dip and the bottom point marked on it, and a horizontal line where both lobes reach equal width",
    caption:
      "The heart target and the three alignments it depends on: dip and point on the centre line, and both lobes reaching their widest at the same height.",
    width: 400,
    height: 400,
  },
  links: [
    { href: "/draw-a-perfect-star", label: "Draw a perfect star" },
    { href: "/draw-a-perfect-circle", label: "Draw a perfect circle" },
    { href: "/drawing-accuracy-test", label: "Take the drawing accuracy test" },
    { href: "/how-to-play", label: "How the score is worked out" },
    { href: "/", label: "CYDI home" },
  ],
  cta: { href: "/draw-shapes-online", label: "Browse Every Shape Challenge" },
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
    `Pick a category and work through it shape by shape. There are ${SHAPE_COUNT} shapes in ${CATEGORY_COUNT} categories: ${CATEGORY_FACTS.map((category) => `${category.name} (${category.shapes})`).join(", ")}. Geometric shapes come first and are the largest set, running from a plain circle and oval through triangles, pentagons and heptagons to multi-point stars, spirals, waves and gears.`,
    "Every shape flashes up as a target for a couple of seconds, you redraw it freehand on the cleared canvas, and you get a scored comparison right away with your line laid over the target. Clearing a shape unlocks the next one in its category, so the targets get harder as your hand gets steadier, and further categories are unlocked with the coins you earn along the way.",
    "Best scores are saved per shape in your browser, which makes it easy to come back and beat your own record on the shapes that beat you.",
  ],
  linkGroup: {
    heading: "Practice individual shapes",
    items: [
      {
        href: "/draw-a-perfect-circle",
        label: "Draw a perfect circle",
        description: "One unbroken curve, no corners to aim at, and it has to close exactly where it started.",
      },
      {
        href: "/draw-a-perfect-star",
        label: "Draw a perfect star",
        description: "Five arms of equal length, tips at equal spacing, and ten straight edges to keep straight.",
      },
      {
        href: "/draw-a-perfect-heart",
        label: "Draw a perfect heart",
        description: "Two mirrored lobes, plus a dip and a point that both have to sit on the centre line.",
      },
    ],
  },
  paragraphsAfterLinkGroup: [
    "Once a shape stops beating you, the same drawing and the same scoring work with other people: play a multiplayer drawing game against friends on their own devices, or a two-player game taking turns on one phone.",
  ],
  links: [
    { href: "/multiplayer-drawing-game", label: "Multiplayer drawing game" },
    { href: "/2-player-drawing-game-one-phone", label: "2 player drawing game on one phone" },
    { href: "/how-to-play", label: "How scoring, stars and coins work" },
    { href: "/", label: "CYDI home" },
  ],
  // This page IS the shape map, so "play more shapes" would point at itself, and
  // the single-shape challenges are the practice list above - which leaves the
  // accuracy test as the one next step this block does not already offer.
  cta: { href: "/drawing-accuracy-test", label: "Test Your Drawing Accuracy" },
  androidCta: true,
};

/*
 * The two social modes get one page each, and both lead with what makes CYDI
 * different from the draw-and-guess games that fill this SERP: nobody is
 * guessing a word here, everybody draws the SAME shape and the scores decide it.
 * Saying so in the first line is honest and it is also the only way a visitor
 * who wanted Pictionary leaves quickly instead of bouncing off the game itself.
 */
const MULTIPLAYER: SeoPage = {
  path: "/multiplayer-drawing-game",
  title: "Multiplayer Drawing Game - Same Shape, Best Score Wins | CYDI",
  description:
    "A multiplayer drawing game where nobody guesses: 2-8 players draw the same shape from memory and the most accurate drawing wins. Free, in the browser, no account.",
  h1: "Multiplayer Drawing Game",
  paragraphs: [
    "Play Together is CYDI's live multiplayer mode, and it works differently from most drawing games you will find. There is no word to guess and nothing to describe. Everyone in the room sees the same shape for three seconds, it disappears, and all of you redraw it from memory at the same time.",
    "When the round ends, every drawing is scored against the target the same way the single-player game scores yours - how closely the outline matches, plus a bonus for finishing quickly. The scoreboard shows each player's accuracy and speed, so it is always clear why someone won. Scores add up across five, ten or fifteen rounds and the highest total is the champion.",
    "One person creates a room and shares a link, a QR code or a six-character code. Everyone else joins in a browser on their own phone or laptop - no app, no account, nothing to install. Rooms hold two to eight players, and if someone's connection drops they keep their seat and their score and rejoin where the game has got to.",
  ],
  links: [
    { href: "/2-player-drawing-game-one-phone", label: "Only have one phone? Play two-player on the same device" },
    { href: "/drawing-accuracy-test", label: "Test your drawing accuracy on your own first" },
    { href: "/how-to-play", label: "How rooms, rounds and scoring work" },
  ],
  cta: { href: "#root", label: "Start a Game with Friends" },
  androidCta: true,
};

const TWO_PLAYER: SeoPage = {
  path: "/2-player-drawing-game-one-phone",
  title: "2 Player Drawing Game on One Phone - Pass and Play | CYDI",
  description:
    "A two player drawing game for one phone: take turns, draw the same shape from memory, and compare both drawings side by side. Free, offline-friendly, no account.",
  h1: "2 Player Drawing Game on One Phone",
  paragraphs: [
    "Two players, one phone, no second device and no room code. CYDI's 2 Players mode is pass and play: you hand the phone across between turns, and it tells you whose turn it is so nobody sees anything they should not.",
    "Both players get the same shape in a round. On your turn it appears for three seconds, then vanishes and you have twenty seconds to redraw it from memory. Neither the other player's drawing nor their score is shown until you have both finished - so the second player has nothing to copy and no target score to aim at.",
    "Once you are both done the round opens up: the shape you were given, both drawings laid over it so you can see who got closer, and the accuracy and speed behind each score. Whoever starts alternates every round, scores add up, and the highest total at the end takes it. It works the same in a browser or in the Android app, and needs no connection once the page has loaded.",
  ],
  links: [
    { href: "/multiplayer-drawing-game", label: "Everyone has their own phone? Play online multiplayer" },
    { href: "/draw-shapes-online", label: "Practise the shapes on your own" },
    { href: "/how-to-play", label: "How turns, timing and scoring work" },
  ],
  cta: { href: "#root", label: "Start a Two-Player Game" },
  androidCta: true,
};

/** Pages the Worker rewrites the <head> of and injects copy into. */
export const SEO_PAGES: SeoPage[] = [HOME, ACCURACY_TEST, PERFECT_CIRCLE, PERFECT_STAR, PERFECT_HEART, DRAW_SHAPES, MULTIPLAYER, TWO_PLAYER];

/**
 * Landing paths only - the homepage is excluded. This is the list
 * src/seo/landingPages.ts must mirror (asserted by its test), because those are
 * the paths the app has to recognise to open the right challenge.
 */
export const LANDING_PATHS: string[] = SEO_PAGES.filter((page) => page.path !== "/").map((page) => page.path);

/**
 * The site's one navigation list, in one order. It lives here rather than in
 * contentPages.ts because both modules need it and this is the one with no
 * imports - contentPages.ts already depends on this file for the canonical
 * origin, so putting it the other way round would make the two circular.
 *
 * Header and footer of every content page render it, and renderSeoSection()
 * below puts the same links at the top of the copy block on the game pages.
 */
export const SITE_NAV: { href: string; label: string }[] = [
  { href: "/", label: "Play" },
  { href: "/how-to-play", label: "How to Play" },
  { href: "/draw-shapes-online", label: "All Shapes" },
  { href: "/multiplayer-drawing-game", label: "Multiplayer" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

/** The nav as plain anchors, minus a link to the page being rendered. */
export function renderNavLinks(current: string): string {
  return SITE_NAV.filter((link) => link.href !== current)
    .map((link) => `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`)
    .join("");
}

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
  // The illustration sits after the opening paragraph rather than at the very top,
  // so the page still leads with text and the image lands next to the copy that
  // explains it. Explicit width/height keep it from shifting the block as it loads,
  // and it is lazy-loaded because the whole block is below the game.
  const image = page.image
    ? `<figure class="cydi-seo-figure">` +
      `<img src="${escapeHtml(page.image.src)}" alt="${escapeHtml(page.image.alt)}" ` +
      `width="${page.image.width}" height="${page.image.height}" loading="lazy" decoding="async">` +
      `<figcaption>${escapeHtml(page.image.caption)}</figcaption>` +
      `</figure>`
    : "";
  const paragraphs = page.paragraphs
    .map((text, index) => `<p>${escapeHtml(text)}</p>${index === 0 ? image : ""}`)
    .join("");
  // Headed block of prominent internal links (the hub's practice list). Plain
  // <a href> with real anchor text, so each target is crawlable from here.
  const linkGroup = page.linkGroup
    ? `<h2 class="cydi-seo-h2">${escapeHtml(page.linkGroup.heading)}</h2>` +
      `<ul class="cydi-seo-practice">` +
      page.linkGroup.items
        .map(
          (item) =>
            `<li><a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>` +
            `<span>${escapeHtml(item.description)}</span></li>`,
        )
        .join("") +
      `</ul>`
    : "";
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
    `.cydi-seo-h2{font-size:1.1rem;margin:1.75rem 0 .75rem}` +
    // Centred, capped well below the text column, and never wider than the
    // viewport - the same image has to work on a 360px phone.
    `.cydi-seo-figure{margin:0 0 1.25rem;text-align:center}` +
    `.cydi-seo-figure img{display:block;margin:0 auto;width:100%;max-width:20rem;height:auto;` +
    `border:1px solid rgba(128,128,128,.35);border-radius:.5rem;background:#fff}` +
    `.cydi-seo-figure figcaption{font-size:.85rem;opacity:.7;margin:.5rem auto 0;max-width:26rem}` +
    // One column on a phone, two once there is room - and each row is a link plus
    // its own explanation, not a bare list of shape names.
    `.cydi-seo ul.cydi-seo-practice{display:grid;grid-template-columns:1fr;gap:.85rem;margin:0 0 .5rem;padding:0;list-style:none}` +
    `@media (min-width:34rem){.cydi-seo ul.cydi-seo-practice{grid-template-columns:1fr 1fr}}` +
    `.cydi-seo ul.cydi-seo-practice li{display:flex;flex-direction:column;gap:.15rem}` +
    `.cydi-seo ul.cydi-seo-practice a{font-weight:600}` +
    `.cydi-seo ul.cydi-seo-practice span{font-size:.9rem;opacity:.75}` +
    `.cydi-seo-cta{margin:1.5rem 0 .5rem!important;opacity:1!important}` +
    `.cydi-seo-cta a{display:inline-block;padding:.6rem 1.1rem;border:1px solid currentColor;` +
    `border-radius:.5rem;font-weight:600;text-decoration:none}` +
    `.cydi-seo-store{font-size:.9rem;opacity:.7!important;margin:0!important}` +
    // The site nav, and the copyright/trust line under it. Both live INSIDE this
    // injected block, which is appended after the full-height #root the game
    // renders into - so on a game page they sit below the canvas and cannot
    // move, resize or reflow it. That is deliberate: the drawing canvas sizes
    // itself from the viewport, and a header bolted above it would change the
    // one measurement the whole game depends on, on exactly the small screens
    // where there is least room to spare.
    `.cydi-seo-nav{display:flex;flex-wrap:wrap;gap:.3rem 1.05rem;margin:0 0 1.35rem;font-size:.95rem}` +
    `.cydi-seo-nav a{text-decoration:none}` +
    `.cydi-seo-nav a:hover{text-decoration:underline}` +
    `.cydi-seo-foot{margin:1.5rem 0 0!important;padding-top:1rem;border-top:1px solid rgba(128,128,128,.35);` +
    `font-size:.85rem;opacity:.7!important}` +
    `</style>` +
    `<section class="cydi-seo">` +
    `<nav class="cydi-seo-nav" aria-label="CYDI site">${renderNavLinks(page.path)}</nav>` +
    `<h1>${escapeHtml(page.h1)}</h1>` +
    paragraphs +
    linkGroup +
    (page.paragraphsAfterLinkGroup ?? []).map((text) => `<p>${escapeHtml(text)}</p>`).join("") +
    `<ul>${links}</ul>` +
    cta +
    android +
    `<p class="cydi-seo-foot">` +
    `<a href="/how-to-play">How to play</a> &middot; <a href="/about">About</a> &middot; ` +
    `<a href="/contact">Contact</a> &middot; <a href="/privacy">Privacy</a> &middot; <a href="/terms">Terms</a>` +
    `<br>&copy; 2026 Lior Rubinovich. All rights reserved.` +
    `</p>` +
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

/**
 * `extraPaths` is how the content pages get in (worker/index.ts passes
 * CONTENT_PATHS): importing them here would be circular, and a sitemap that
 * silently omitted /about, /privacy or /terms would undo the point of serving
 * them at all.
 */
export function sitemapXml(extraPaths: string[] = []): string {
  const paths = [...SEO_PAGES.map((page) => page.path), ...extraPaths];
  const entries = paths.map((path) => `  <url><loc>${canonicalUrl(path)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}
