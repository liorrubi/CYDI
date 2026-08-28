/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// The five PUBLIC CONTENT pages: /how-to-play, /about, /contact, /terms and
// /privacy.
//
// How these differ from worker/seoPages.ts, which is the other half of the
// public site: an SEO page IS the game. It serves the app shell, boots CYDI into
// the mode or shape the page is about, and appends a block of crawlable copy
// underneath it. A content page is a document - there is nothing to play on it,
// so it does not ship the app at all. The Worker answers these five paths with a
// complete, self-contained HTML page: no #root, no app bundle, no game CSS, and
// nothing to run before the text is there. That is the point. Before this
// existed, /privacy served a 2.4 KB empty shell and the policy was invisible to
// anything that does not execute JavaScript.
//
// Nothing here can reach the Android app. Capacitor serves index.html from
// inside the APK and never routes HTML through this Worker, so these pages are
// web-only by construction - the same reason documented in seoPages.ts.
//
// Every concrete number below comes from src/content/publicFacts.ts, which
// imports the real value or is pinned to it by publicFacts.test.ts. Do not type
// a figure straight into this file.

import {
  PRIVACY_EFFECTIVE_DATE,
  PRIVACY_LAST_UPDATED,
  PRIVACY_POLICY_HTML,
} from "../src/content/privacyPolicyHtml";
import { EXAMPLE_SCORE } from "../src/content/scoringExample";
import {
  CATEGORY_COUNT,
  CATEGORY_FACTS,
  CATEGORY_UNLOCK_COST,
  COINS_PER_STAR,
  DAILY_CHEST_MAX_COINS,
  DAILY_CHEST_MIN_COINS,
  DAILY_PRIZE_COINS,
  DEFAULT_DIFFICULTY_NAME,
  DIFFICULTY_FACTS,
  FIRST_ROUND_PREVIEW_SECONDS,
  MP_DRAWING_SECONDS,
  MP_MAX_PLAYERS,
  MP_MIN_PLAYERS,
  MP_ROOM_CODE_LENGTH,
  MP_ROOM_IDLE_MINUTES,
  MP_ROUND_OPTIONS,
  MP_SHOW_SHAPE_SECONDS,
  PREVIEW_SECONDS,
  RESAMPLE_POINTS,
  SCORE_BANDS,
  SCORE_WEIGHT_PERCENTS,
  SHAPE_COUNT,
  SHARE_LINK_EXPIRY_DAYS,
  SIZE_CEILING_POINTS_PER_PERCENT,
  SIZE_TOLERANCE_PERCENT,
  STAR_THRESHOLDS,
} from "../src/content/publicFacts";
// The nav list itself lives in seoPages.ts (the module with no imports), so the
// game pages and these pages can share it without the two files becoming
// circular - see the comment on SITE_NAV there.
import { CANONICAL_ORIGIN, PLAY_STORE_URL, canonicalUrl, renderNavLinks } from "./seoPages";

// ----------------------------------------------------------------- blocks ----

/**
 * A content page is a list of blocks. Text in `p`/`li`/cell positions is treated
 * as trusted HTML so a sentence can carry a link or an emphasis - every string
 * in this file is authored here, and no user input reaches any of it.
 */
export type ContentBlock =
  | { kind: "p"; html: string }
  | { kind: "h2"; text: string; id?: string }
  | { kind: "h3"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "steps"; items: { title: string; html: string }[] }
  | { kind: "table"; caption?: string; head: string[]; rows: string[][] }
  | { kind: "figure"; src: string; alt: string; caption: string; width: number; height: number }
  | { kind: "note"; html: string }
  | { kind: "raw"; html: string };

export type ContentPage = {
  /** Canonical path, no trailing slash. */
  path: string;
  title: string;
  description: string;
  h1: string;
  /** Optional line under the h1 (dates on the policy pages). */
  standfirst?: string;
  blocks: ContentBlock[];
};

// ------------------------------------------------------------ how to play ----

const HOW_TO_PLAY: ContentPage = {
  path: "/how-to-play",
  title: "How to Play CYDI - Rounds, Scoring, Coins and Modes",
  description:
    "How CYDI works: you get a few seconds to study a shape, then redraw it from memory and it is scored 0-100. What each part of the score measures, how stars and coins work, and how the Daily Challenge and both multiplayer modes are played.",
  h1: "How to Play CYDI",
  blocks: [
    {
      kind: "p",
      html:
        "CYDI is a drawing accuracy game. It is not a draw-and-guess game: nobody has to work out what you drew, " +
        "and there is no word to describe. You are shown a shape, it is taken away, you redraw it from memory, and " +
        "the game measures how close you got.",
    },
    {
      kind: "p",
      html:
        "It plays in a browser with a mouse, a trackpad or a finger, and there is no account to create - your " +
        "progress and best scores live in your own browser storage.",
    },

    { kind: "h2", text: "A round: See, Remember, Draw, Score", id: "round" },
    {
      kind: "steps",
      items: [
        {
          title: "See",
          html:
            `The target shape appears on the canvas for <strong>${PREVIEW_SECONDS} seconds</strong> ` +
            `(${FIRST_ROUND_PREVIEW_SECONDS} seconds on your very first round, which is coached and shows a ` +
            "countdown). That is your whole look at it, and it is long enough to take in a shape but not to " +
            "measure one - which is the game.",
        },
        {
          title: "Remember",
          html:
            "The target is then cleared completely. There is no faded outline left behind and nothing to trace " +
            "over: what you draw comes out of your head, not off the screen.",
        },
        {
          title: "Draw",
          html:
            "You redraw the shape freehand on the empty canvas. Shapes made of separate parts - a stem and a " +
            "leaf, the dot on an exclamation mark - are drawn as separate strokes, and the gaps between strokes " +
            "are not treated as lines you drew.",
        },
        {
          title: "Score",
          html:
            "Your attempt is compared against the target and scored out of 100, with a star rating and a short " +
            "verdict. Then your drawing is laid over the target so you can see exactly where the line went, which " +
            "is usually more useful than the number.",
        },
      ],
    },

    { kind: "h2", text: "How the score is worked out", id: "scoring" },
    {
      kind: "p",
      html:
        "Both the target and your attempt are resampled to " +
        `<strong>${RESAMPLE_POINTS} evenly spaced points</strong> and compared point for point. Four things are ` +
        "measured, and they do <em>not</em> count equally - the shape itself is most of the score:",
    },
    {
      kind: "table",
      caption: "The four measured components and their share of the total score.",
      head: ["Component", "Share", "What it measures"],
      rows: [
        [
          "Shape match",
          `${SCORE_WEIGHT_PERCENTS.shapeMatch}%`,
          "How closely your outline follows the target's form, point by point. This is the score.",
        ],
        [
          "Scale",
          `${SCORE_WEIGHT_PERCENTS.scale}%`,
          "Whether you drew it the right size, rather than much smaller or larger than the target.",
        ],
        [
          "Coverage",
          `${SCORE_WEIGHT_PERCENTS.coverage}%`,
          "Whether you drew the whole shape, or stopped short and left part of it undrawn.",
        ],
        [
          "Smoothness",
          `${SCORE_WEIGHT_PERCENTS.smoothness}%`,
          "Whether the line is steady, or drawn in short nervous strokes that zig-zag along the way.",
        ],
      ],
    },
    {
      kind: "p",
      html:
        "Two rules in the comparison are worth knowing, because they decide scores that otherwise look unfair:",
    },
    {
      kind: "ul",
      items: [
        "<strong>Where you start and which way you go round do not matter.</strong> Before comparing, the game " +
          `tries every one of the ${RESAMPLE_POINTS} possible starting points, in both directions, and keeps the ` +
          "best alignment. Drawing a circle anticlockwise from the bottom scores exactly the same as clockwise " +
          "from the top.",
        `<strong>Size has a ceiling, not just a penalty.</strong> Up to about ${SIZE_TOLERANCE_PERCENT}% off the ` +
          "target's size costs you nothing. Past that, every further 1% of size error takes " +
          `${SIZE_CEILING_POINTS_PER_PERCENT} point off the highest total the round can reach - so a beautifully ` +
          "shaped drawing made at a third of the size cannot sneak into the 80s on shape alone.",
      ],
    },

    { kind: "h3", text: "A worked example" },
    {
      kind: "figure",
      src: "/images/seo/how-to-play-attempt-over-target.svg",
      alt:
        "A freehand circle attempt drawn in blue over the thick grey circle target it was scored against, " +
        "slightly smaller than the target and wavering in and out of it",
      caption:
        "The overlay the game shows you at the end of a round: your line over the target it was measured against.",
      width: 400,
      height: 400,
    },
    {
      kind: "p",
      html:
        "This attempt is a circle drawn a little small, a little wider than it is tall, with a slow waver in the " +
        "line. Scored by the game, it comes out like this:",
    },
    {
      kind: "table",
      caption:
        "The example above, scored by the same code that scores your rounds - these numbers are computed when " +
        "this page is served, not typed into it.",
      head: ["Component", "Score"],
      rows: [
        ["Shape match", `${EXAMPLE_SCORE.shapeMatch} / 100`],
        ["Scale", `${EXAMPLE_SCORE.scale} / 100`],
        ["Coverage", `${EXAMPLE_SCORE.coverage} / 100`],
        ["Smoothness", `${EXAMPLE_SCORE.smoothness} / 100`],
        [`<strong>Total</strong>`, `<strong>${EXAMPLE_SCORE.total} / 100 - &ldquo;${EXAMPLE_SCORE.message}&rdquo;</strong>`],
      ],
    },
    {
      kind: "p",
      html:
        "It is a good illustration of where a round is really won. Coverage and smoothness are nearly full marks " +
        `and together they are worth only ${SCORE_WEIGHT_PERCENTS.coverage + SCORE_WEIGHT_PERCENTS.smoothness}% of ` +
        `the total. The ${EXAMPLE_SCORE.shapeMatch} for shape match is what holds this round below a top score, ` +
        "because the outline is an oval and shape match is most of the marks. Steadying your hand is worth far " +
        "less than getting the form right.",
    },

    { kind: "h2", text: "Stars, passing and difficulty", id: "stars" },
    {
      kind: "table",
      caption: "Star ratings are fixed score thresholds - the same on every shape.",
      head: ["Score", "Stars"],
      rows: [...STAR_THRESHOLDS]
        .sort((a, b) => a.minScore - b.minScore)
        .map((tier) => [`${tier.minScore} and above`, "★".repeat(tier.stars)]),
    },
    {
      kind: "p",
      html:
        "The verdict beside the score comes from the same scale: " +
        SCORE_BANDS.map((band) => `&ldquo;${band.label}&rdquo; from ${band.minScore}`).join(", ") +
        ".",
    },
    {
      kind: "p",
      html:
        "Whether a round <em>passes</em> - which is what unlocks the next shape - depends on the difficulty you " +
        `chose in Settings. It is the one setting that changes the bar, and it starts on ${DEFAULT_DIFFICULTY_NAME}:`,
    },
    {
      kind: "table",
      caption: "Difficulty levels and the score each one requires to pass a shape.",
      head: ["Difficulty", "Score needed to pass"],
      rows: DIFFICULTY_FACTS.map((level) => [
        level.name === DEFAULT_DIFFICULTY_NAME ? `${level.name} (default)` : level.name,
        `${level.passScore}`,
      ]),
    },
    {
      kind: "p",
      html:
        "Only your best score on a shape is kept, so retrying costs you nothing - a worse attempt never replaces " +
        "a better one.",
    },

    { kind: "h2", text: "Coins and what they are for", id: "coins" },
    {
      kind: "p",
      html: "Finishing a shape pays coins according to the stars you earned:",
    },
    {
      kind: "table",
      head: ["Stars", "Coins"],
      rows: COINS_PER_STAR.map((tier) => ["★".repeat(tier.stars), `${tier.coins}`]),
    },
    {
      kind: "p",
      html:
        "There are other ways to earn them - a free Daily Chest worth " +
        `${DAILY_CHEST_MIN_COINS}-${DAILY_CHEST_MAX_COINS} coins, the Daily Challenge prizes below, and one-off ` +
        "rewards for finishing special and collectible challenges. Coins buy things inside the game: unlocking a " +
        `new shape category costs ${CATEGORY_UNLOCK_COST.toLocaleString("en-US")} coins, and the shop sells ink ` +
        "colours, pen skins and chests.",
    },
    {
      kind: "note",
      html:
        "CYDI Coins are in-game points only. They cannot be bought with money, and they have no cash value and " +
        "cannot be exchanged or redeemed for anything outside the game.",
    },

    { kind: "h2", text: "The Daily Challenge", id: "daily" },
    {
      kind: "p",
      html:
        "One shape a day, and it is the same shape for every player in the world - there is a single daily " +
        "episode, not a per-player one, which is what makes the scores comparable. It rolls over at midnight " +
        "Israel time (Asia/Jerusalem), and once an episode's shape has been drawn it is fixed for that day.",
    },
    {
      kind: "p",
      html:
        "Your score goes on a public leaderboard for that episode, under whatever display name you have set " +
        "(the default is &ldquo;Anonymous Player&rdquo;, and you can leave it that way). Only the number is sent - " +
        "your drawing itself never leaves your device in this mode. When an episode ends, the top three players " +
        `are paid ${DAILY_PRIZE_COINS[0].toLocaleString("en-US")}, ${DAILY_PRIZE_COINS[1]} and ` +
        `${DAILY_PRIZE_COINS[2]} coins, waiting to be claimed the next time they open the game.`,
    },

    { kind: "h2", text: "2 Players on one phone", id: "two-players" },
    {
      kind: "p",
      html:
        "Pass-and-play, for one device and two people. You hand the phone over between turns and the game tells " +
        "you whose turn it is.",
    },
    {
      kind: "ul",
      items: [
        `Both players get the same shape each round: it shows for ${MP_SHOW_SHAPE_SECONDS} seconds, then you have ` +
          `${MP_DRAWING_SECONDS} seconds to redraw it.`,
        "Neither drawing nor score is revealed until you have both finished, so the second player has nothing to " +
          "copy and no target score to play against.",
        "The round then opens up: the target, both attempts laid over it, and the accuracy and speed behind each " +
          "score.",
        "Whoever goes first alternates every round, and the highest total after the last round wins.",
      ],
    },
    {
      kind: "p",
      html:
        "2 Players does not require a multiplayer connection while you play, and it works the same in the browser " +
        "and in the Android app.",
    },

    { kind: "h2", text: "Play Together (online multiplayer)", id: "play-together" },
    {
      kind: "p",
      html:
        `${MP_MIN_PLAYERS} to ${MP_MAX_PLAYERS} players, each on their own device, all drawing the same shape at ` +
        "the same time. One person creates a room and shares a link, a QR code, or the " +
        `${MP_ROOM_CODE_LENGTH}-character room code; everyone else joins in a browser. No app and no account.`,
    },
    {
      kind: "ul",
      items: [
        `Each round the shape shows for ${MP_SHOW_SHAPE_SECONDS} seconds, then everyone has ` +
          `${MP_DRAWING_SECONDS} seconds to draw.`,
        "Scoring runs on the server, not on any player's device, so every drawing in the room is judged by the " +
          "same code under the same rules. Finishing faster earns a speed bonus on top of accuracy.",
        // Still read straight off ROUND_COUNT_OPTIONS - a new length appears in
        // the sentence by itself, with the "or" landing before whichever is last.
        `A game can be ${MP_ROUND_OPTIONS.slice(0, -1).join(", ")}, or ${MP_ROUND_OPTIONS[MP_ROUND_OPTIONS.length - 1]} rounds; ` +
          "scores add up and the highest total wins.",
        "If your connection drops you keep your seat and your score, and rejoin wherever the game has got to.",
        `Rooms are temporary: one is deleted automatically once nobody has been connected to it for ` +
          `${MP_ROOM_IDLE_MINUTES} minutes, and the nicknames and scores go with it.`,
      ],
    },

    { kind: "h2", text: "What there is to play", id: "shapes" },
    {
      kind: "p",
      html:
        `The main Shape Challenge holds <strong>${SHAPE_COUNT} shapes</strong> across ${CATEGORY_COUNT} ` +
        "categories. The first category is open from the start; each shape you pass unlocks the next one in its " +
        `category, and further categories are unlocked with coins (${CATEGORY_UNLOCK_COST.toLocaleString("en-US")} ` +
        "each).",
    },
    {
      kind: "table",
      caption: `Every category in the Shape Challenge, and how many shapes each one holds.`,
      head: ["Category", "Shapes"],
      rows: CATEGORY_FACTS.map((category) => [category.name, `${category.shapes}`]),
    },
    {
      kind: "p",
      html:
        'You can <a href="/draw-shapes-online">browse the shape categories</a>, ' +
        '<a href="/drawing-accuracy-test">take the accuracy test</a>, or start with the three shapes most people ' +
        'try first: <a href="/draw-a-perfect-circle">the circle</a>, ' +
        '<a href="/draw-a-perfect-star">the five-point star</a> and ' +
        '<a href="/draw-a-perfect-heart">the heart</a>.',
    },

    { kind: "h2", text: "Why did I score that?", id: "troubleshooting" },
    {
      kind: "p",
      html: "The four components make most surprising scores easy to diagnose:",
    },
    {
      kind: "ul",
      items: [
        "<strong>&ldquo;It looked right but scored badly.&rdquo;</strong> Almost always shape match - the " +
          "proportions drifted. Check the overlay: a circle that came out as an oval, or a star with one short " +
          "arm, is a shape-match problem, and shape match is most of the score.",
        "<strong>&ldquo;My drawing was neat and small.&rdquo;</strong> Size. Neatness is worth a few points; " +
          "drawing at half the target's size runs into the ceiling and caps the round no matter how clean the " +
          "line is. Use the canvas.",
        "<strong>&ldquo;I ran out of room and stopped.&rdquo;</strong> Coverage. An unfinished outline scores as " +
          "an unfinished outline, though it costs less than most people expect.",
        "<strong>&ldquo;My hand shakes.&rdquo;</strong> Smoothness, and it is the smallest term in the score. A " +
          "shaky line that follows the right form still scores well; a steady line in the wrong form does not.",
        "<strong>&ldquo;I started in a different place.&rdquo;</strong> Not a factor - starting point and " +
          "direction are aligned away before anything is compared.",
      ],
    },
  ],
};

// ------------------------------------------------------------------ about ----

const ABOUT: ContentPage = {
  path: "/about",
  title: "About CYDI - Who Makes It and How It Is Built",
  description:
    "CYDI is a free drawing accuracy game made by Lior Rubinovich and his daughter. What the game is, what it is built from, and the rules it is built on: no account, no personal data, progress kept on your own device.",
  h1: "About CYDI",
  blocks: [
    {
      kind: "p",
      html:
        "CYDI - short for &ldquo;Can You Draw It?&rdquo; - is a free drawing accuracy game. You are shown a shape " +
        "for a couple of seconds, the canvas is cleared, and you redraw it from memory; the game then measures " +
        "how close your line came and shows you where it went. There is nothing to guess and nobody to guess for " +
        'you. <a href="/how-to-play">How to play</a> explains the whole thing.',
    },

    { kind: "h2", text: "Who makes it" },
    {
      kind: "p",
      html:
        "CYDI is made by Lior Rubinovich together with his daughter. It is a two-person project rather than a " +
        "studio one. Guest artist packs are drawn by invited artists, who are credited by name inside the game.",
    },

    { kind: "h2", text: "What is in it" },
    {
      kind: "p",
      html:
        `The Shape Challenge holds ${SHAPE_COUNT} shapes across ${CATEGORY_COUNT} categories - geometric forms, ` +
        "symbols, the alphabet, animals, nature, food, sport, transport, household objects, calligraphy, fantasy " +
        "and universal signs. Around it there is a Daily Challenge with a global leaderboard, a collectible Mega " +
        "album, and two ways to play with other people: pass-and-play on one phone, and online rooms of up to " +
        `${MP_MAX_PLAYERS} players.`,
    },
    {
      kind: "p",
      html:
        "Every shape is drawn by code rather than stored as a picture. A shape is a small generator function that " +
        "builds its outline from arcs, curves and polar geometry at whatever size the canvas happens to be, which " +
        "is why the target is crisp on a phone and on a desktop, and why the same definition can be used to " +
        "score a drawing and to illustrate a page.",
    },

    { kind: "h2", text: "How it is built" },
    {
      kind: "ul",
      items: [
        "The game is React and TypeScript, drawn on an HTML canvas.",
        "The site and its online features run on Cloudflare Workers, with Durable Objects behind the Daily " +
          "Challenge leaderboard and each Play Together room.",
        "The Android app is the same code wrapped with Capacitor - not a separate build of the game.",
        "Sounds are synthesised in the browser at the moment they play, using the Web Audio API. There are no " +
          "audio files in CYDI at all.",
        "The interface uses your system's own fonts and standard emoji glyphs rather than bundled font or icon " +
          "artwork. The core interface and the game's own visuals are original CSS, SVG and canvas work made for " +
          "this project; artwork in guest artist packs is made by the artists themselves and credited to them " +
          "separately inside the game.",
      ],
    },

    { kind: "h2", text: "How it treats you" },
    {
      kind: "ul",
      items: [
        "<strong>No account.</strong> There is no sign-up, no login and no password. You can play the entire game " +
          "without telling it anything about yourself.",
        "<strong>Your progress is yours, and it is local.</strong> Scores, unlocks and coins are stored in your " +
          "own browser or app storage, not on a server. That also means clearing your browser data clears them, " +
          "which is why the game has a backup-and-transfer code you can move yourself.",
        "<strong>Your drawings stay on your device</strong> in single-player and in the Daily Challenge, where " +
          "only the score is submitted. The one exception is Play Together, where scoring happens on the server " +
          "so that every player in a room is judged identically.",
        // COUPLED CLAIM - do not change this line on its own. It states a fact
        // about the web build that is true only while no web ad path ships. The
        // day H5 web ads are switched on, this bullet AND the advertising
        // section of the privacy policy (src/content/privacyPolicyHtml.ts, which
        // currently says "The web version of CYDI does not load any advertising
        // SDK and makes no ad requests") must be updated in the same change, or
        // the site will publish a claim its own policy contradicts. /terms is
        // deliberately platform-neutral and needs no edit.
        "<strong>No ads on the web.</strong> The website loads no advertising SDK and makes no ad requests. The " +
          "Android app offers optional rewarded videos you can always decline.",
        `The <a href="/privacy">privacy policy</a> sets all of this out in detail, including what the Android app ` +
          "does differently.",
      ],
    },

    { kind: "h2", text: "Where to play it" },
    {
      kind: "p",
      html:
        `CYDI runs in any modern browser at <a href="${CANONICAL_ORIGIN}/">playcydi.com</a> - nothing to install ` +
        `and nothing to sign up for. There is also an <a href="${PLAY_STORE_URL}" rel="noopener">Android app on ` +
        "Google Play</a>. The single-player game works offline in the app; the features that are online by " +
        "nature - Play Together rooms, the Daily Challenge leaderboard and share links - still need a connection.",
    },
    {
      kind: "p",
      html:
        'CYDI is in active development, and the game changes often. If something is broken or you have an idea ' +
        'for it, <a href="/contact">get in touch</a> - it is a small project and messages are read by the people ' +
        "who make it.",
    },
  ],
};

// ---------------------------------------------------------------- contact ----

const CONTACT: ContentPage = {
  path: "/contact",
  title: "Contact CYDI - Support, Feedback and Privacy Requests",
  description:
    "How to reach the people who make CYDI: support@playcydi.com for bugs and feedback, privacy@playcydi.com for privacy requests. What to include so a bug report can actually be acted on.",
  h1: "Contact",
  blocks: [
    {
      kind: "p",
      html:
        "CYDI is made by two people, so there is no support desk and no ticket system - just two addresses, both " +
        "read by the people who make the game.",
    },

    { kind: "h2", text: "Support and feedback" },
    {
      kind: "p",
      html:
        '<a href="mailto:support@playcydi.com"><strong>support@playcydi.com</strong></a> - bugs, problems with a ' +
        "round or a room, ideas, shape suggestions, and anything about the Android app. This is the right address " +
        "for almost everything.",
    },

    { kind: "h2", text: "Privacy requests" },
    {
      kind: "p",
      html:
        '<a href="mailto:privacy@playcydi.com"><strong>privacy@playcydi.com</strong></a> - questions about the ' +
        '<a href="/privacy">privacy policy</a>, and requests to access or delete data held about you.',
    },
    {
      kind: "ul",
      items: [
        "For <strong>Daily Challenge leaderboard</strong> data, include your Privacy Request ID. You will find it " +
          "in the game under Settings, where it can be copied - it is the only thing that identifies your entries, " +
          "because there is no account behind them.",
        "For a <strong>share link</strong> you want removed before it expires on its own, send the complete share " +
          `URL. Share entries are not linked to you in any way, so the URL is the only way to find one. They ` +
          `expire automatically after ${SHARE_LINK_EXPIRY_DAYS} days.`,
      ],
    },

    { kind: "h2", text: "Reporting a bug" },
    {
      kind: "p",
      html:
        "Four things make a bug report actionable, and without them a problem in a drawing game is very hard to " +
        "reproduce:",
    },
    {
      kind: "ul",
      items: [
        "<strong>The version.</strong> It is at the bottom of the Settings screen - please copy it exactly.",
        "<strong>Where you were playing.</strong> The website or the Android app, and which browser or phone.",
        "<strong>What you were doing.</strong> The mode and, if it matters, the shape - &ldquo;the third shape in " +
          "Nature&rdquo; beats &ldquo;a leaf&rdquo;.",
        "<strong>What happened, and what you expected instead.</strong> A screenshot of the result screen says " +
          "more than a description of it.",
      ],
    },
    {
      kind: "note",
      html:
        "Please do not send passwords, payment details or identity documents. CYDI has no accounts and no " +
        "payments, so nobody working on it will ever ask you for any of those.",
    },

    { kind: "h2", text: "Other places" },
    {
      kind: "p",
      html:
        `Reviews and reports on the <a href="${PLAY_STORE_URL}" rel="noopener">Google Play listing</a> are read ` +
        "too, but a review is a poor place to debug something - email is faster and can actually be answered.",
    },
  ],
};

// ------------------------------------------------------------------ terms ----

/**
 * The date shown on /terms. Deliberately its own constant rather than borrowing
 * the privacy policy's: the two documents change independently, and this one
 * states when THESE terms were last published.
 *
 * Bump it whenever the text below changes materially, and confirm it matches the
 * day the change actually goes live - a "last updated" date that predates the
 * text it sits above is worse than no date at all.
 */
const TERMS_LAST_UPDATED = "28 August 2026";

const TERMS: ContentPage = {
  path: "/terms",
  title: "Terms of Use - CYDI",
  description:
    "The terms for using CYDI: entertainment only, provided as-is, virtual coins with no cash value, progress stored on your own device, and what is not allowed in shared and multiplayer features.",
  h1: "Terms of Use",
  standfirst: `Last updated: ${TERMS_LAST_UPDATED}`,
  blocks: [
    {
      kind: "p",
      html:
        "These terms cover your use of CYDI, on the web at playcydi.com and in the CYDI Android app. Playing the " +
        "game means accepting them. A shorter summary of these terms is also shown inside the game under " +
        "Settings; this page is the full version.",
    },

    { kind: "h2", text: "1. Disclaimer" },
    {
      kind: "p",
      html:
        "CYDI is provided as-is for entertainment purposes only. We do our best to keep the game available and " +
        "working properly, but we do not guarantee uninterrupted availability, error-free operation, permanent " +
        "data storage, or specific results. Scores, progress, challenges, rewards, and game mechanics may change, " +
        "reset, or be discontinued at any time.",
    },

    { kind: "h2", text: "2. Using the game" },
    {
      kind: "ul",
      items: [
        "CYDI is intended for entertainment purposes only.",
        "Bots, hacking, score manipulation, harassment, or abuse of sharing features are not allowed.",
        "We may change, update, restrict, or discontinue the game or any part of it at any time.",
        "Our liability is limited to the extent permitted by law.",
      ],
    },
    {
      kind: "p",
      html:
        "No account is needed to play, so there is no account to suspend. Where a feature is abused we may remove " +
        "the content involved - a leaderboard entry or a shared link - or block access to that feature.",
    },

    { kind: "h2", text: "3. Shared links, leaderboards and multiplayer" },
    {
      kind: "ul",
      items: [
        "<strong>Display names and nicknames are public where you use them.</strong> A Daily Challenge display " +
          "name appears on a public leaderboard, and a Play Together nickname is visible to everyone in that " +
          "room. Do not use your real name or any contact details, and do not impersonate anyone.",
        `<strong>Share links are public to anyone holding the link.</strong> A short share link stores the shared ` +
          `challenge or result on our servers and expires automatically after ${SHARE_LINK_EXPIRY_DAYS} days. ` +
          "Treat anything you share as public.",
        `<strong>Play Together rooms are temporary.</strong> A room is deleted once nobody has been connected to ` +
          `it for ${MP_ROOM_IDLE_MINUTES} minutes, along with its nicknames and scores. Nothing from a room is ` +
          "added to your progress.",
        "<strong>Leaderboard entries may be removed.</strong> Scores that appear to be manipulated, and display " +
          "names that are abusive or impersonate someone, can be deleted without notice.",
      ],
    },

    { kind: "h2", text: "4. Development status and virtual coins" },
    {
      kind: "ul",
      items: [
        "CYDI is still in active development, and features, balancing, and content may change.",
        "CYDI Coins are virtual in-game points only. They have no real-world monetary value and cannot be " +
          "exchanged, redeemed, or converted into real money or any other form of currency.",
        "Coins cannot be purchased. There is no way to spend real money inside CYDI.",
        "Progress and coins are saved locally on your device/browser only. At this stage, we make no commitment " +
          "to restore progress or coins lost due to clearing local data, switching devices, technical issues, or " +
          "game/version updates.",
      ],
    },

    { kind: "h2", text: "5. Your drawings" },
    {
      kind: "p",
      html:
        "What you draw is yours. We claim no ownership of it. In single-player and in the Daily Challenge your " +
        "drawings do not leave your device at all; a drawing is only sent to our servers when you choose to " +
        "share it as a link, or when you play Play Together, where a round is scored on the server and the " +
        "drawing is discarded once that round has been scored. By creating a share link you allow us to store " +
        "and serve that drawing to whoever opens the link, until it expires or is deleted.",
    },

    { kind: "h2", text: "6. Our content" },
    {
      kind: "p",
      html:
        "This game, including its original design, gameplay elements, code, graphics, sounds, icons, text, and " +
        "other creative assets, is protected by copyright and other applicable intellectual property laws.",
    },
    {
      kind: "p",
      html:
        "No part of this game may be copied, modified, redistributed, republished, uploaded, sold, or used " +
        "commercially without prior written permission, except where permitted by applicable law or an " +
        "applicable third-party licence.",
    },
    {
      kind: "p",
      html:
        "Third-party assets, libraries, fonts, icons, or sounds, if used, remain the property of their respective " +
        "owners and are used according to their applicable licenses.",
    },

    { kind: "h2", text: "7. Apps, stores and advertising" },
    {
      kind: "p",
      html:
        "The CYDI Android app is distributed through Google Play and is also subject to Google Play's own terms.",
    },
    {
      kind: "p",
      html:
        "CYDI may offer optional rewarded video ads on supported platforms. Watching an ad is always your choice, " +
        "and declining it never removes coins or rewards you have already earned. The " +
        '<a href="/privacy">privacy policy</a> describes what an advertising SDK collects where one is in use.',
    },

    { kind: "h2", text: "8. Children" },
    // Worded to match the privacy policy's section 7 exactly - a Terms page that
    // set a different age or a different legal standard from the policy would be
    // a contradiction between two documents that are meant to agree.
    {
      kind: "p",
      html:
        "CYDI is intended for a general audience and is not directed to children under 13 (or the minimum age of " +
        "digital consent in your region). See the " +
        '<a href="/privacy">privacy policy</a> for what this means in practice.',
    },

    { kind: "h2", text: "9. Changes to these terms" },
    {
      kind: "p",
      html:
        "These terms may be updated as the game changes. When we make material changes we will update the date at " +
        "the top of this page.",
    },

    { kind: "h2", text: "10. Privacy and contact" },
    {
      kind: "p",
      html:
        "These terms cover your use of the game. For details on what data CYDI collects and how it is used, read " +
        'our <a href="/privacy">privacy policy</a>. Questions about these terms: ' +
        '<a href="mailto:support@playcydi.com">support@playcydi.com</a>.',
    },
  ],
};

// ---------------------------------------------------------------- privacy ----

const PRIVACY: ContentPage = {
  path: "/privacy",
  title: "Privacy Policy - CYDI",
  description:
    "What CYDI collects and what it does not: progress stored on your own device, no account, drawings that stay local outside multiplayer, anonymous aggregate analytics, and the choices you have.",
  h1: "CYDI Privacy Policy",
  standfirst: `Effective date: ${PRIVACY_EFFECTIVE_DATE} &middot; Last updated: ${PRIVACY_LAST_UPDATED}`,
  // The policy text itself lives in src/content/privacyPolicyHtml.ts, which the
  // in-app page renders too - there is exactly one copy of it.
  blocks: [{ kind: "raw", html: PRIVACY_POLICY_HTML }],
};

/** Every page this module serves. */
export const CONTENT_PAGES: ContentPage[] = [HOW_TO_PLAY, ABOUT, CONTACT, TERMS, PRIVACY];

export const CONTENT_PATHS: string[] = CONTENT_PAGES.map((page) => page.path);

/** Trailing slashes are stripped so "/about/" resolves to the same page. */
export function contentPageForPath(pathname: string): ContentPage | undefined {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return CONTENT_PAGES.find((page) => page.path === normalized);
}

// --------------------------------------------------------------- renderer ----

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Attribute-safe: the same escaping, minus the > that never needs it inside quotes. */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function renderBlock(block: ContentBlock): string {
  switch (block.kind) {
    case "p":
      return `<p>${block.html}</p>`;
    case "h2":
      return block.id
        ? `<h2 id="${escapeAttribute(block.id)}">${escapeHtml(block.text)}</h2>`
        : `<h2>${escapeHtml(block.text)}</h2>`;
    case "h3":
      return `<h3>${escapeHtml(block.text)}</h3>`;
    case "ul":
      return `<ul class="cydi-list">${block.items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
    case "steps":
      // A numbered walkthrough where each step has a name - an <ol> so the order
      // is carried by the markup and not just by the styling.
      return (
        `<ol class="cydi-steps">` +
        block.items
          .map((item) => `<li><strong>${escapeHtml(item.title)}</strong><span>${item.html}</span></li>`)
          .join("") +
        `</ol>`
      );
    case "table":
      // Wrapped in its own scroll container: a wide table has to scroll inside
      // itself rather than making the whole page scroll sideways on a phone.
      return (
        `<div class="cydi-table-wrap"><table>` +
        (block.caption ? `<caption>${escapeHtml(block.caption)}</caption>` : "") +
        `<thead><tr>${block.head.map((cell) => `<th scope="col">${escapeHtml(cell)}</th>`).join("")}</tr></thead>` +
        `<tbody>${block.rows
          .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
          .join("")}</tbody>` +
        `</table></div>`
      );
    case "figure":
      return (
        `<figure class="cydi-figure">` +
        `<img src="${escapeAttribute(block.src)}" alt="${escapeAttribute(block.alt)}" ` +
        `width="${block.width}" height="${block.height}" loading="lazy" decoding="async">` +
        `<figcaption>${escapeHtml(block.caption)}</figcaption>` +
        `</figure>`
      );
    case "note":
      return `<p class="cydi-note">${block.html}</p>`;
    case "raw":
      return block.html;
  }
}

/**
 * The page stylesheet. Inline and self-contained on purpose: a content page
 * loads no app bundle and no external CSS, so the text is styled the instant the
 * HTML lands and there is nothing to block it. Colours follow the reader's
 * system theme.
 */
const PAGE_STYLES = `
:root{color-scheme:light dark;--bg:#f7f7f9;--card:#ffffff;--text:#1f2430;--muted:#5b6270;--line:#e2e5eb;--link:#2050c8;--note:#f0f3fb}
@media (prefers-color-scheme:dark){
:root{--bg:#14161c;--card:#1b1e26;--text:#e8eaef;--muted:#a2a9b8;--line:#2c313c;--link:#8ab0ff;--note:#212633}
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);line-height:1.65;
font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
-webkit-text-size-adjust:100%}
a{color:var(--link)}
.cydi-shell{max-width:47rem;margin:0 auto;padding:0 1.15rem}
header.cydi-head{border-bottom:1px solid var(--line);background:var(--card)}
.cydi-brand{display:inline-block;padding:1rem 0 .35rem;font-size:1.15rem;font-weight:700;
letter-spacing:.02em;color:var(--text);text-decoration:none}
.cydi-brand span{font-weight:400;color:var(--muted);font-size:.95rem;margin-left:.5rem}
nav.cydi-nav{display:flex;flex-wrap:wrap;gap:.35rem 1.1rem;padding:0 0 .9rem;font-size:.95rem}
nav.cydi-nav a{text-decoration:none}
nav.cydi-nav a:hover{text-decoration:underline}
main{background:var(--card);border:1px solid var(--line);border-radius:.75rem;
margin:1.5rem auto 2rem;padding:1.75rem 1.35rem 2rem;max-width:47rem}
main h1{font-size:1.7rem;line-height:1.25;margin:0 0 .5rem}
main h2{font-size:1.25rem;margin:2rem 0 .6rem;padding-top:.35rem;border-top:1px solid var(--line)}
main h3{font-size:1.05rem;margin:1.5rem 0 .5rem}
main p{margin:0 0 1rem}
/* The privacy policy cites two Google policy URLs using the URL itself as the
   link text, and neither has a break opportunity in it - at 375px they pushed
   the page 19px wider than the viewport and it scrolled sideways. Anywhere is
   needed rather than break-word: these strings have no spaces to break at. */
main a{overflow-wrap:anywhere}
.cydi-standfirst{color:var(--muted);font-size:.95rem;margin:0 0 1.5rem}
ul.cydi-list,ol.cydi-steps{margin:0 0 1.15rem;padding-left:1.25rem}
ul.cydi-list li,ol.cydi-steps li{margin:0 0 .55rem}
ol.cydi-steps li strong{display:block}
ol.cydi-steps li span{display:block;color:var(--text)}
.cydi-table-wrap{overflow-x:auto;margin:0 0 1.25rem}
table{border-collapse:collapse;width:100%;font-size:.95rem;min-width:14rem}
caption{caption-side:bottom;text-align:left;color:var(--muted);font-size:.85rem;padding-top:.5rem}
th,td{text-align:left;padding:.5rem .7rem;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:.85rem;text-transform:uppercase;letter-spacing:.03em;color:var(--muted)}
.cydi-note{background:var(--note);border:1px solid var(--line);border-radius:.5rem;
padding:.85rem 1rem;font-size:.95rem}
.cydi-figure{margin:0 0 1.35rem;text-align:center}
.cydi-figure img{display:block;margin:0 auto;width:100%;max-width:20rem;height:auto;
background:#fff;border:1px solid var(--line);border-radius:.5rem}
.cydi-figure figcaption{color:var(--muted);font-size:.85rem;margin:.55rem auto 0;max-width:28rem}
footer.cydi-foot{border-top:1px solid var(--line);background:var(--card);padding:1.35rem 0 2rem;
color:var(--muted);font-size:.9rem}
footer.cydi-foot nav{display:flex;flex-wrap:wrap;gap:.35rem 1.1rem;margin:0 0 .85rem}
footer.cydi-foot a{text-decoration:none}
footer.cydi-foot a:hover{text-decoration:underline}
.cydi-play{display:inline-block;margin:.4rem 0 1rem;padding:.6rem 1.15rem;border:1px solid currentColor;
border-radius:.5rem;font-weight:600;text-decoration:none}
/* The policy text arrives with the app's own class names on it (it is the same
   string the in-game page renders); these keep it readable here, where none of
   the app's CSS is loaded. */
.privacy-list{margin:0 0 1.15rem;padding-left:1.25rem}
.privacy-list li{margin:0 0 .55rem}
main .status-text{margin:0 0 1rem}
`;

/**
 * A complete standalone HTML document. No app bundle, no #root, no client-side
 * routing - everything a reader (or a crawler) needs is in the response body.
 */
export function renderContentDocument(page: ContentPage): string {
  const canonical = canonicalUrl(page.path);
  const body = page.blocks.map(renderBlock).join("");

  return (
    `<!doctype html>\n<html lang="en">\n<head>\n` +
    `<meta charset="UTF-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">\n` +
    `<meta name="color-scheme" content="light dark">\n` +
    `<title>${escapeHtml(page.title)}</title>\n` +
    `<meta name="description" content="${escapeAttribute(page.description)}">\n` +
    `<link rel="canonical" href="${canonical}">\n` +
    `<link rel="icon" type="image/svg+xml" href="/favicon.svg">\n` +
    `<meta name="google-adsense-account" content="ca-pub-3787018288764544">\n` +
    `<meta property="og:type" content="article">\n` +
    `<meta property="og:site_name" content="CYDI">\n` +
    `<meta property="og:title" content="${escapeAttribute(page.title)}">\n` +
    `<meta property="og:description" content="${escapeAttribute(page.description)}">\n` +
    `<meta property="og:url" content="${canonical}">\n` +
    `<meta name="twitter:card" content="summary">\n` +
    `<meta name="twitter:title" content="${escapeAttribute(page.title)}">\n` +
    `<meta name="twitter:description" content="${escapeAttribute(page.description)}">\n` +
    `<style>${PAGE_STYLES}</style>\n` +
    `</head>\n<body>\n` +
    `<header class="cydi-head"><div class="cydi-shell">` +
    `<a class="cydi-brand" href="/">CYDI<span>Can You Draw It?</span></a>` +
    `<nav class="cydi-nav">${renderNavLinks(page.path)}</nav>` +
    `</div></header>\n` +
    `<div class="cydi-shell">` +
    `<main>` +
    `<h1>${escapeHtml(page.h1)}</h1>` +
    (page.standfirst ? `<p class="cydi-standfirst">${page.standfirst}</p>` : "") +
    body +
    `<p><a class="cydi-play" href="/">Play CYDI &rarr;</a></p>` +
    `</main>` +
    `</div>\n` +
    `<footer class="cydi-foot"><div class="cydi-shell">` +
    `<nav>${renderNavLinks(page.path)}</nav>` +
    `<p>CYDI is free to play in your browser, and on ` +
    `<a href="${PLAY_STORE_URL}" rel="noopener">Google Play</a>.<br>` +
    `&copy; 2026 Lior Rubinovich. All rights reserved.</p>` +
    `</div></footer>\n` +
    `</body>\n</html>\n`
  );
}
