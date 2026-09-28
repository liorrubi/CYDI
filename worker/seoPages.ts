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
  SCORE_WEIGHT_PERCENTS,
  SHAPE_COUNT,
} from "../src/content/publicFacts";
// The 4a page's structured content. Shared with the client presentation
// (src/site/SeoPracticePage.tsx) so the indexed text and the rendered text can
// never disagree - and so neither one restates a product fact by hand.
// Called with no argument on purpose: the Worker renders for a crawler, before
// any client-side catalog swap can have happened, so it states the build-time
// counts - the same ones the rest of this file uses.
import { siteFaq } from "../src/content/siteContent";
// The page-specific copy of the challenge pages, shared with SeoPracticePage.tsx so
// the sentences a crawler indexes are the ones a visitor reads (see that module).
import { challengePageCopy } from "../src/content/challengePageCopy";
// The one list of challenges, shared with the site's own rendering of this page
// (src/site/SiteChallenges.tsx) so the crawlable links and the cards a visitor
// sees can never be different sets.
import { DRAWING_CHALLENGES } from "../src/content/drawingChallenges";

/**
 * The app's real listing URL. Duplicated from src/services/nativeShare.ts rather
 * than imported, because that module pulls in Capacitor, which cannot load in a
 * Worker - src/seo/landingPages.test.ts asserts the two stay identical, and a
 * test there already ties that constant to the package id in capacitor.config.ts.
 */
export const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.playcydi.cydi";

/** The branded install link: /android sends a visitor to the Play listing above. */
export const ANDROID_PATH = "/android";

/**
 * Where /android lands. The destination is the constant above and nothing else -
 * only utm_* tags are carried over from the request, so a shared install link can
 * keep its campaign without letting anyone aim the route somewhere new. An incoming
 * `id` in particular is dropped rather than appended: Play reads the app to install
 * from that parameter, and forwarding it would turn our own link into an installer
 * for whatever app the URL named.
 */
export function androidRedirectUrl(search: string): string {
  const target = new URL(PLAY_STORE_URL);
  for (const [key, value] of new URLSearchParams(search)) {
    if (key.startsWith("utm_")) target.searchParams.set(key, value);
  }
  return target.toString();
}

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
  /**
   * Renders the shared FAQ (src/content/siteContent.ts) into the crawlable
   * block. Set on the shape/practice pages, which are the ones the app renders
   * with the 4a presentation - so the same four questions are in the HTML for a
   * crawler that runs no JavaScript, and on screen for a visitor who does.
   */
  faq?: boolean;
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

const accuracyTestCopy = challengePageCopy("/drawing-accuracy-test");
const ACCURACY_TEST: SeoPage = {
  path: "/drawing-accuracy-test",
  title: "Drawing Accuracy Test - How Precise Is Your Freehand? | CYDI",
  description:
    "A quick drawing accuracy test: redraw the target shape freehand and get scored on shape match, coverage, smoothness and scale. Free, instant, in your browser.",
  h1: accuracyTestCopy.heading,
  paragraphs: accuracyTestCopy.paragraphs,
  links: [
    { href: "/draw-a-perfect-circle", label: "Draw a perfect circle" },
    { href: "/how-to-play", label: "What each part of the score measures" },
    { href: "/", label: "CYDI home" },
  ],
  cta: { href: "/draw-shapes-online", label: "Play More Drawing Challenges" },
  androidCta: true,
  faq: true,
};

const perfectCircleCopy = challengePageCopy("/draw-a-perfect-circle");
const PERFECT_CIRCLE: SeoPage = {
  path: "/draw-a-perfect-circle",
  title: "Draw a Perfect Circle - Free Online Test | CYDI",
  description:
    "Try to draw a perfect circle freehand and get an instant score out of 100, with your attempt laid over the target. Free, no download, plays in your browser.",
  h1: perfectCircleCopy.heading,
  paragraphs: perfectCircleCopy.paragraphs,
  image: perfectCircleCopy.image,
  links: [
    { href: "/draw-a-perfect-star", label: "Draw a perfect star" },
    { href: "/draw-a-perfect-heart", label: "Draw a perfect heart" },
    { href: "/drawing-accuracy-test", label: "Take the full drawing accuracy test" },
    { href: "/", label: "CYDI home" },
  ],
  cta: { href: "/draw-shapes-online", label: "Play More Drawing Challenges" },
  androidCta: true,
  faq: true,
};

const perfectStarCopy = challengePageCopy("/draw-a-perfect-star");
const PERFECT_STAR: SeoPage = {
  path: "/draw-a-perfect-star",
  title: "Draw a Perfect Star - Freehand Symmetry Challenge | CYDI",
  description:
    "Draw a five-point star freehand and get scored out of 100. Five tips at equal spacing, straight edges, one mirror line - see exactly which point let you down.",
  h1: perfectStarCopy.heading,
  paragraphs: perfectStarCopy.paragraphs,
  image: perfectStarCopy.image,
  links: [
    { href: "/draw-a-perfect-heart", label: "Draw a perfect heart" },
    { href: "/draw-a-perfect-circle", label: "Draw a perfect circle" },
    { href: "/drawing-challenges", label: "All drawing challenges" },
    { href: "/drawing-accuracy-test", label: "Take the drawing accuracy test" },
    { href: "/how-to-play", label: "How the score is worked out" },
    { href: "/", label: "CYDI home" },
  ],
  cta: { href: "/draw-shapes-online", label: "Browse Every Shape Challenge" },
  androidCta: true,
  faq: true,
};

const perfectHeartCopy = challengePageCopy("/draw-a-perfect-heart");
const PERFECT_HEART: SeoPage = {
  path: "/draw-a-perfect-heart",
  title: "Draw a Perfect Heart - Symmetry and Curves Test | CYDI",
  description:
    "Draw a heart freehand and get an instant score out of 100. Two matching lobes, a centred dip and a bottom point on one axis - find out how symmetrical yours really is.",
  h1: perfectHeartCopy.heading,
  paragraphs: perfectHeartCopy.paragraphs,
  image: perfectHeartCopy.image,
  links: [
    { href: "/draw-a-perfect-star", label: "Draw a perfect star" },
    { href: "/draw-a-perfect-circle", label: "Draw a perfect circle" },
    { href: "/drawing-challenges", label: "All drawing challenges" },
    { href: "/drawing-accuracy-test", label: "Take the drawing accuracy test" },
    { href: "/how-to-play", label: "How the score is worked out" },
    { href: "/", label: "CYDI home" },
  ],
  cta: { href: "/draw-shapes-online", label: "Browse Every Shape Challenge" },
  androidCta: true,
  faq: true,
};

/*
 * The one page written for a specific video rather than for a search query: it is
 * where /s/dog sends someone who just watched the Dog Short, so the promise it has
 * to keep is "the same challenge you just watched, now your turn". The copy is
 * deliberately short - the playable target is the content, and every extra
 * paragraph pushes it further from the reader's thumb.
 *
 * It is also a genuine standalone page ("draw a dog from memory" is a real query),
 * which is why it carries the same metadata, canonical and FAQ treatment as the
 * shape pages rather than being a thin redirect target.
 */
const dogFromMemoryCopy = challengePageCopy("/draw-a-dog-from-memory");
const DOG_FROM_MEMORY: SeoPage = {
  path: "/draw-a-dog-from-memory",
  title: "Draw a Dog From Memory - Memory Drawing Challenge | CYDI",
  description:
    "Study a dog outline for a few seconds, watch it disappear, then draw it from memory and get an instant score out of 100. Free, no sign-up, plays in the browser.",
  h1: dogFromMemoryCopy.heading,
  paragraphs: [
    ...dogFromMemoryCopy.paragraphs,
    "The round here is a practice round. It is played and scored exactly like the real thing, and it changes nothing in your game - no coins, no unlocks, no best score - so you can take it as many times as you like before you go and play the rest.",
  ],
  links: [
    { href: "/draw-a-perfect-circle", label: "Draw a perfect circle" },
    { href: "/draw-a-perfect-heart", label: "Draw a perfect heart" },
    { href: "/drawing-challenges", label: "All drawing challenges" },
    { href: "/how-to-play", label: "How the score is worked out" },
    { href: "/", label: "CYDI home" },
  ],
  cta: { href: "/draw-shapes-online", label: "Browse Every Shape Challenge" },
  androidCta: true,
  faq: true,
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
  paragraphsAfterLinkGroup: [
    "Once a shape stops beating you, the same drawing and the same scoring work with other people: play a multiplayer drawing game against friends on their own devices, or a two-player game taking turns on one phone.",
  ],
  links: [
    { href: "/drawing-challenges", label: "Practice individual drawing challenges" },
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


/*
 * The cat's page, added after the dog's and built the same way: the Cat Short
 * went out before the rule that a Short lands on its own challenge, and /s/cat
 * now points here instead of at the home screen.
 */
const catFromMemoryCopy = challengePageCopy("/draw-a-cat-from-memory");
const CAT_FROM_MEMORY: SeoPage = {
  path: "/draw-a-cat-from-memory",
  title: "Draw a Cat From Memory - Memory Drawing Challenge | CYDI",
  description:
    "Study a cat outline for a few seconds, watch it disappear, then draw it from memory and get an instant score out of 100. Free, no sign-up, plays in the browser.",
  h1: catFromMemoryCopy.heading,
  paragraphs: [
    ...catFromMemoryCopy.paragraphs,
    "This is a practice round: played and scored for real, and it changes nothing in your game - no coins, no best score, no unlocks - so you can take it as often as you like, whether or not you have reached Animals in the Shape Challenge.",
  ],
  links: [
    { href: "/draw-a-dog-from-memory", label: "Draw a dog from memory" },
    { href: "/draw-a-perfect-circle", label: "Draw a perfect circle" },
    { href: "/drawing-challenges", label: "All drawing challenges" },
    { href: "/how-to-play", label: "How the score is worked out" },
    { href: "/", label: "CYDI home" },
  ],
  cta: { href: "/draw-shapes-online", label: "Browse Every Shape Challenge" },
  androidCta: true,
  faq: true,
};

/*
 * The bear's page, built like the dog's and the cat's: the Bear Short lands here
 * through /s/bear, so the page has to open the very shape the video showed.
 *
 * Its copy is about what a bear actually costs a memory - the ears are part of the
 * head outline rather than separate shapes, and the muzzle is the feature that
 * moves - because a page that could be about any animal is worth nothing to a
 * reader who came for this one.
 */
const bearFromMemoryCopy = challengePageCopy("/draw-a-bear-from-memory");
const BEAR_FROM_MEMORY: SeoPage = {
  path: "/draw-a-bear-from-memory",
  title: "Draw a Bear From Memory - Memory Drawing Challenge | CYDI",
  description:
    "Study a bear outline for a few seconds, watch it disappear, then draw it back from memory and get an instant score out of 100. Free, no sign-up, plays in the browser.",
  h1: bearFromMemoryCopy.heading,
  paragraphs: [
    ...bearFromMemoryCopy.paragraphs,
    "This is a practice round: played and scored for real, and it changes nothing in your game - no coins, no best score, no unlocks - so you can take it as often as you like, whether or not you have reached Animals in the Shape Challenge.",
  ],
  links: [
    { href: "/draw-a-cat-from-memory", label: "Draw a cat from memory" },
    { href: "/draw-a-dog-from-memory", label: "Draw a dog from memory" },
    { href: "/drawing-challenges", label: "All drawing challenges" },
    { href: "/how-to-play", label: "How the score is worked out" },
    { href: "/", label: "CYDI home" },
  ],
  cta: { href: "/draw-shapes-online", label: "Browse Every Shape Challenge" },
  androidCta: true,
  faq: true,
};

/*
 * The owl's page, same build as the bear's: the Owl Short lands here through /s/owl.
 *
 * Its copy is about the two features a memory actually loses on an owl - the ear tufts,
 * which are part of the head outline rather than shapes stuck on it, and the eyes, which
 * are far larger than anyone remembers.
 */
const owlFromMemoryCopy = challengePageCopy("/draw-an-owl-from-memory");
const OWL_FROM_MEMORY: SeoPage = {
  path: "/draw-an-owl-from-memory",
  title: "Draw an Owl From Memory - Memory Drawing Challenge | CYDI",
  description:
    "Study an owl outline for a few seconds, watch it disappear, then draw it back from memory and get an instant score out of 100. Free, no sign-up, plays in the browser.",
  h1: owlFromMemoryCopy.heading,
  paragraphs: [
    ...owlFromMemoryCopy.paragraphs,
    "This is a practice round: played and scored for real, and it changes nothing in your game - no coins, no best score, no unlocks - so you can take it as often as you like, whether or not you have reached Animals in the Shape Challenge.",
  ],
  links: [
    { href: "/draw-a-bear-from-memory", label: "Draw a bear from memory" },
    { href: "/draw-a-cat-from-memory", label: "Draw a cat from memory" },
    { href: "/drawing-challenges", label: "All drawing challenges" },
    { href: "/how-to-play", label: "How the score is worked out" },
    { href: "/", label: "CYDI home" },
  ],
  cta: { href: "/draw-shapes-online", label: "Browse Every Shape Challenge" },
  androidCta: true,
  faq: true,
};

/*
 * The pig's page, same build as the owl's and the bear's: the Pig Short lands here
 * through /s/pig.
 *
 * Its copy is about the snout, because on a pig that is the whole identity - it is
 * larger and lower than anyone remembers, and a face that gets it wrong stops reading
 * as a pig no matter how good the head is.
 */
const pigFromMemoryCopy = challengePageCopy("/draw-a-pig-from-memory");
const PIG_FROM_MEMORY: SeoPage = {
  path: "/draw-a-pig-from-memory",
  title: "Draw a Pig From Memory - Memory Drawing Challenge | CYDI",
  description:
    "Study a pig outline for a few seconds, watch it disappear, then draw it back from memory and get an instant score out of 100. Free, no sign-up, plays in the browser.",
  h1: pigFromMemoryCopy.heading,
  paragraphs: [
    ...pigFromMemoryCopy.paragraphs,
    "This is a practice round: played and scored for real, and it changes nothing in your game - no coins, no best score, no unlocks - so you can take it as often as you like, whether or not you have reached Animals in the Shape Challenge.",
  ],
  links: [
    { href: "/draw-an-owl-from-memory", label: "Draw an owl from memory" },
    { href: "/draw-a-bear-from-memory", label: "Draw a bear from memory" },
    { href: "/drawing-challenges", label: "All drawing challenges" },
    { href: "/how-to-play", label: "How the score is worked out" },
    { href: "/", label: "CYDI home" },
  ],
  cta: { href: "/draw-shapes-online", label: "Browse Every Shape Challenge" },
  androidCta: true,
  faq: true,
};

/*
 * The snail's page, same build as the pig's and the owl's: the Snail Short lands here
 * through /s/snail.
 *
 * Its copy is about the spiral, which is the one part of this shape a memory cannot
 * fake - it has a real number of turns, and it has to start at the outside and end at
 * the middle of the shell rather than wander.
 */
const snailFromMemoryCopy = challengePageCopy("/draw-a-snail-from-memory");
const SNAIL_FROM_MEMORY: SeoPage = {
  path: "/draw-a-snail-from-memory",
  title: "Draw a Snail From Memory - Memory Drawing Challenge | CYDI",
  description:
    "Study a snail outline for a few seconds, watch it disappear, then draw it back from memory and get an instant score out of 100. Free, no sign-up, plays in the browser.",
  h1: snailFromMemoryCopy.heading,
  paragraphs: [
    ...snailFromMemoryCopy.paragraphs,
    "This is a practice round: played and scored for real, and it changes nothing in your game - no coins, no best score, no unlocks - so you can take it as often as you like, whether or not you have reached Animals in the Shape Challenge.",
  ],
  links: [
    { href: "/draw-a-pig-from-memory", label: "Draw a pig from memory" },
    { href: "/draw-an-owl-from-memory", label: "Draw an owl from memory" },
    { href: "/drawing-challenges", label: "All drawing challenges" },
    { href: "/how-to-play", label: "How the score is worked out" },
    { href: "/", label: "CYDI home" },
  ],
  cta: { href: "/draw-shapes-online", label: "Browse Every Shape Challenge" },
  androidCta: true,
  faq: true,
};

const lightningFromMemoryCopy = challengePageCopy("/draw-a-lightning-bolt-from-memory");
const LIGHTNING_FROM_MEMORY: SeoPage = {
  path: "/draw-a-lightning-bolt-from-memory",
  title: "Draw a Lightning Bolt From Memory - Drawing Challenge | CYDI",
  description:
    "Study a lightning bolt for a few seconds, watch it disappear, then draw it back from memory and get an instant score out of 100. Free, no sign-up, plays in the browser.",
  h1: lightningFromMemoryCopy.heading,
  paragraphs: [
    ...lightningFromMemoryCopy.paragraphs,
    "This is a practice round: played and scored for real, and it changes nothing in your game - no coins, no best score, no unlocks - so you can take it as often as you like, whether or not you have reached Symbols in the Shape Challenge.",
  ],
  links: [
    { href: "/draw-a-perfect-star", label: "Draw a perfect star" },
    { href: "/draw-a-snail-from-memory", label: "Draw a snail from memory" },
    { href: "/drawing-challenges", label: "All drawing challenges" },
    { href: "/how-to-play", label: "How the score is worked out" },
    { href: "/", label: "CYDI home" },
  ],
  cta: { href: "/draw-shapes-online", label: "Browse Every Shape Challenge" },
  androidCta: true,
  faq: true,
};

const triangleFromMemoryCopy = challengePageCopy("/draw-a-triangle-from-memory");
const TRIANGLE_FROM_MEMORY: SeoPage = {
  path: "/draw-a-triangle-from-memory",
  title: "Draw a Triangle From Memory - Drawing Challenge | CYDI",
  description:
    "Study a triangle for a few seconds, watch it disappear, then draw it back from memory and get an instant score out of 100. Free, no sign-up, plays in the browser.",
  h1: triangleFromMemoryCopy.heading,
  paragraphs: [
    ...triangleFromMemoryCopy.paragraphs,
    "This is a practice round: played and scored for real, and it changes nothing in your game - no coins, no best score, no unlocks - so you can take it as often as you like, whether or not you have reached the triangle in the Shape Challenge.",
  ],
  links: [
    { href: "/draw-a-perfect-circle", label: "Draw a perfect circle" },
    { href: "/draw-a-lightning-bolt-from-memory", label: "Draw a lightning bolt from memory" },
    { href: "/drawing-challenges", label: "All drawing challenges" },
    { href: "/how-to-play", label: "How the score is worked out" },
    { href: "/", label: "CYDI home" },
  ],
  cta: { href: "/draw-shapes-online", label: "Browse Every Shape Challenge" },
  androidCta: true,
  faq: true,
};

const gearFromMemoryCopy = challengePageCopy("/draw-a-gear-from-memory");
const GEAR_FROM_MEMORY: SeoPage = {
  path: "/draw-a-gear-from-memory",
  title: "Draw a Gear From Memory - Drawing Challenge | CYDI",
  description:
    "Study a gear for a few seconds, watch it disappear, then draw it back from memory and get an instant score out of 100. Free, no sign-up, plays in the browser.",
  h1: gearFromMemoryCopy.heading,
  paragraphs: [
    ...gearFromMemoryCopy.paragraphs,
    "This is a practice round: played and scored for real, and it changes nothing in your game - no coins, no best score, no unlocks - so you can take it as often as you like, whether or not you have reached the gear in the Shape Challenge.",
  ],
  links: [
    { href: "/draw-a-triangle-from-memory", label: "Draw a triangle from memory" },
    { href: "/draw-a-perfect-circle", label: "Draw a perfect circle" },
    { href: "/drawing-challenges", label: "All drawing challenges" },
    { href: "/how-to-play", label: "How the score is worked out" },
    { href: "/", label: "CYDI home" },
  ],
  cta: { href: "/draw-shapes-online", label: "Browse Every Shape Challenge" },
  androidCta: true,
  faq: true,
};

/*
 * The practice directory. It is a landing path rather than a content page
 * because it belongs to the site's own visual language - SiteChallenges.tsx
 * renders it in the 3a shell - and the block below is what a crawler, or anyone
 * with JavaScript off, reads instead.
 *
 * Its link list IS the page: built from DRAWING_CHALLENGES, so adding a
 * challenge adds a crawlable link here and a card there from one edit.
 */
const DRAWING_CHALLENGES_PAGE: SeoPage = {
  path: "/drawing-challenges",
  title: "Drawing Challenges - Practice One Shape at a Time | CYDI",
  // Deliberately says "an animal" rather than naming one: the animal challenges are
  // arriving one Short at a time (cat, dog, bear, and more to come), and a
  // description that enumerates them goes stale on every release.
  description:
    "Free single-shape drawing challenges: redraw a circle, a star, a heart or an animal from memory and get scored out of 100. No sign-up, nothing to unlock, plays in the browser.",
  h1: "Drawing Challenges",
  paragraphs: [
    "Each challenge is one shape, on its own. You study the target for a few seconds, it disappears, you redraw it freehand, and CYDI scores how close you got - then draws your attempt over the target so you can see where it drifted.",
    "They are practice rounds: scored for real, and they change nothing in your game. No coins, no best score, no unlocks - so a challenge is playable whether or not you have reached its category in the Shape Challenge.",
  ],
  linkGroup: {
    heading: "Pick a challenge",
    items: DRAWING_CHALLENGES.map((challenge) => ({
      href: challenge.href,
      label: challenge.name,
      description: challenge.note,
    })),
  },
  links: [
    { href: "/draw-shapes-online", label: "Browse every shape by category" },
    { href: "/how-to-play", label: "How the score is worked out" },
    { href: "/", label: "CYDI home" },
  ],
  cta: { href: "/drawing-accuracy-test", label: "Test Your Drawing Accuracy" },
  androidCta: true,
};

export const SEO_PAGES: SeoPage[] = [HOME, ACCURACY_TEST, PERFECT_CIRCLE, PERFECT_STAR, PERFECT_HEART, DOG_FROM_MEMORY, CAT_FROM_MEMORY, BEAR_FROM_MEMORY, OWL_FROM_MEMORY, PIG_FROM_MEMORY, SNAIL_FROM_MEMORY, LIGHTNING_FROM_MEMORY, TRIANGLE_FROM_MEMORY, GEAR_FROM_MEMORY, DRAWING_CHALLENGES_PAGE, DRAW_SHAPES, MULTIPLAYER, TWO_PLAYER];

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
  { href: "/accessibility", label: "Accessibility" },
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
  // A definition list rather than <details>: it must be readable with no CSS and
  // no JavaScript, which is the whole point of this block.
  const faq = page.faq
    ? `<h2 class="cydi-seo-h2">Questions people ask</h2>` +
      `<dl class="cydi-seo-faq">` +
      siteFaq().map(
        (entry) => `<dt>${escapeHtml(entry.question)}</dt><dd>${escapeHtml(entry.answer)}</dd>`,
      ).join("") +
      `</dl>`
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
    `.cydi-seo-faq{margin:0 0 1rem}` +
    `.cydi-seo-faq dt{font-weight:600;margin:0 0 .2rem}` +
    `.cydi-seo-faq dd{margin:0 0 .9rem;opacity:.85}` +
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
    faq +
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
    // Campaign aliases (/s/<slug>) - redirects to the tagged homepage, nothing of
    // their own to index. Keeping crawlers out also stops them manufacturing
    // campaign traffic in the analytics by following the alias.
    "Disallow: /s/",
    // The branded install link - a permanent redirect to the Play listing, with no
    // page of its own to index.
    "Disallow: /android",
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
