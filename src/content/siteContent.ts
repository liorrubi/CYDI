/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * The structured copy behind the redesigned public site (art directions 3a and
 * 4a): the mode descriptions, the four-step loop, the scoring criteria, the
 * multiplayer fact table and the FAQ.
 *
 * Why it lives in src/content/ rather than in src/site/: BOTH sides render it.
 * The Worker builds the crawlable block from it (worker/seoPages.ts) and the
 * web app renders the designed presentation from it (src/site/). One module, so
 * the indexed text and the visible text can never disagree.
 *
 * Worker-safe by construction: the only thing it imports is publicFacts, which
 * the Worker already imports. No Vite `define` globals, no DOM, no Capacitor.
 *
 * TWO COUNT SOURCES, ONE RULE. Everything except the shape/category COUNTS is
 * a plain constant: player limits, timings, round options and scoring weights
 * are compiled into the game and cannot differ at runtime. The catalog counts
 * can: a remote content release swapped in by hydrateContent.ts changes what
 * contentRepository returns, while publicFacts counts the baked-in library at
 * build time. So every string that states a count is a BUILDER taking
 * `CatalogCounts`, defaulting to the build-time numbers.
 *   - The Worker calls them with no argument (build-time counts): it renders
 *     for a crawler, before any client-side catalog swap exists.
 *   - The client passes the ACTIVE catalog's counts, so a stated number and the
 *     list rendered beside it always come from the same catalog.
 * This puts no constraint on what a future catalog may contain.
 *
 * RULE, inherited from publicFacts.ts and extended site-wide by the redesign
 * brief: not one number below is typed as a literal. Player limits, round
 * options, study/draw timings, room-code length, scoring weights and the
 * shape/category counts all come from publicFacts, which imports the game's
 * real values. The mockups say "276", "12", "2-8", "5, 10 or 15",
 * "six-character", "3s" and "20s"; every one of those is a binding below.
 */
import {
  CATEGORY_COUNT,
  MP_DRAWING_SECONDS,
  MP_MAX_PLAYERS,
  MP_MIN_PLAYERS,
  MP_ROOM_CODE_LENGTH,
  MP_ROUND_OPTIONS,
  MP_SHOW_SHAPE_SECONDS,
  SCORE_WEIGHT_PERCENTS,
  SHAPE_COUNT,
} from "./publicFacts";

/** "5, 10 or 15" - built from the real option list, so adding a fourth option still reads correctly. */
export function formatOptionList(values: readonly number[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return String(values[0]);
  return `${values.slice(0, -1).join(", ")} or ${values[values.length - 1]}`;
}

const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
  "nineteen", "twenty",
];

/** Spelled-out form for prose ("twenty seconds to draw"). Falls back to digits past the table. */
export function spellNumber(value: number): string {
  return Number.isInteger(value) && value >= 0 && value < NUMBER_WORDS.length
    ? NUMBER_WORDS[value]
    : String(value);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "2-8" (en dash) - the player range as every page states it. */
export const PLAYER_RANGE = `${MP_MIN_PLAYERS}–${MP_MAX_PLAYERS}`;
/** "5, 10 or 15" */
export const ROUND_OPTIONS_TEXT = formatOptionList(MP_ROUND_OPTIONS);
/** "six" - the room-code length as prose, from the real constant. */
export const ROOM_CODE_LENGTH_WORD = spellNumber(MP_ROOM_CODE_LENGTH);

/** How much drawable content a catalog holds. See the note at the top of the file. */
export type CatalogCounts = { shapes: number; categories: number };

/** The baked-in library's counts - what a crawler is told, and the safe default. */
export const BUILD_CATALOG_COUNTS: CatalogCounts = { shapes: SHAPE_COUNT, categories: CATEGORY_COUNT };



// ------------------------------------------------------------------ modes ----

export type SiteMode = {
  id: "classic" | "passPlay" | "multiplayer";
  name: string;
  kicker: string;
  description: string;
  meta: string;
};

export const SITE_MODES: SiteMode[] = [
  {
    id: "classic",
    name: "Classic",
    kicker: "One trace",
    description: "Round after round on your own, difficulty climbing, one attempt per shape.",
    meta: "Solo · one shape at a time",
  },
  {
    id: "passPlay",
    name: "2 Players",
    kicker: "Head to head",
    description:
      "One device, passed across the table. Same shape for both, hidden until both have drawn — and the first turn alternates each round.",
    meta: "One device · head to head",
  },
  {
    id: "multiplayer",
    name: "Multiplayer",
    kicker: "Everyone at once",
    description: "A live room with a code. One countdown for the whole group, all scores revealed together.",
    meta: `${PLAYER_RANGE} players · ${ROUND_OPTIONS_TEXT} rounds`,
  },
];

/**
 * The three real game modes, each at its own canonical URL. "Modes" used to sit
 * here as a catch-all; it is redundant now that the modes themselves are in the
 * nav. The game menu at /play is reached from the hero, not from here, so the
 * header stays three items on every screen size.
 */
export const SITE_NAV: { href: string; label: string; mode: SiteMode["id"] }[] = [
  { href: "/play/classic", label: "Classic", mode: "classic" },
  { href: "/2-player-drawing-game-one-phone", label: "2 Players", mode: "passPlay" },
  { href: "/multiplayer-drawing-game", label: "Multiplayer", mode: "multiplayer" },
];

/** The multiplayer fact table from 3a's mode-presentation panel. */
export const MULTIPLAYER_FACTS: { label: string; value: string }[] = [
  { label: "Players", value: `${PLAYER_RANGE}, own devices` },
  { label: "Round clock", value: `${MP_SHOW_SHAPE_SECONDS}s study → ${MP_DRAWING_SECONDS}s draw` },
  { label: "Room length", value: `${ROUND_OPTIONS_TEXT} rounds` },
  { label: "Reveal", value: "Together, after the last pen" },
  { label: "Joining", value: `${MP_ROOM_CODE_LENGTH}-character room code` },
];

export const MULTIPLAYER_INTRO =
  `${capitalize(spellNumber(MP_MIN_PLAYERS))} to ${spellNumber(MP_MAX_PLAYERS)} players get the same shape ` +
  `and the same clock: ${spellNumber(MP_SHOW_SHAPE_SECONDS)} seconds to study it, ` +
  `${spellNumber(MP_DRAWING_SECONDS)} seconds to draw it. Scores stay hidden until everyone has finished, ` +
  `then the room sees them together.`;

/** 3a's "How one round works" strip on the multiplayer landing. */
export const MULTIPLAYER_ROUND_STEPS: { title: string; body: string }[] = [
  {
    title: "Same shape",
    body: `${capitalize(spellNumber(MP_MIN_PLAYERS))} to ${spellNumber(MP_MAX_PLAYERS)} players are shown one identical shape.`,
  },
  {
    title: "Same clock",
    body:
      `${capitalize(spellNumber(MP_SHOW_SHAPE_SECONDS))} seconds to study, then ` +
      `${spellNumber(MP_DRAWING_SECONDS)} to draw — one countdown for the whole room.`,
  },
  { title: "Everyone draws", body: "All players draw from memory at the same time, on their own devices." },
  { title: "Reveal together", body: "Scores stay hidden until everyone has finished, then the room sees them all." },
];

/** 3a's "How 2 Players works" numbered list. */
export function passPlaySteps(counts: CatalogCounts = BUILD_CATALOG_COUNTS): { title: string; body: string }[] {
  return [
  { title: "Same challenge", body: `Both players get the same shape, drawn from the ${counts.shapes}-shape catalog.` },
  {
    title: "Player 1 draws",
    body: `${MP_SHOW_SHAPE_SECONDS} seconds to study, ${MP_DRAWING_SECONDS} to draw. The drawing and the score stay hidden.`,
  },
  {
    title: "Pass the device",
    body: "Hand the phone over. Player 2 gets the same shape, and never sees the first attempt or its score.",
  },
  { title: "Player 2 draws", body: `Same shape, same ${MP_SHOW_SHAPE_SECONDS}s and ${MP_DRAWING_SECONDS}s, a blank canvas.` },
  {
    title: "Compare & reveal winner",
    body: "Both attempts and scores are revealed side by side. The higher accuracy takes the round.",
  },
  ];
}

// ------------------------------------------------------------------- loop ----

/** 4a's See -> Remember -> Draw -> Compare & score cards. */
export const LOOP_STEPS: { title: string; badge: string; body: string }[] = [
  { title: "See", badge: "Shown", body: "The target outline is shown to you on the canvas." },
  { title: "Remember", badge: "Hidden", body: "It disappears completely. What is left is what you held on to." },
  { title: "Draw", badge: "1 try", body: "You redraw it on a blank canvas — no guide underneath, one attempt." },
  {
    title: "Compare & score",
    badge: "Scored",
    body: "Your line is laid over the original, with a score, a star rating and a tip. The guide can be toggled off.",
  },
];

// ---------------------------------------------------------------- scoring ----

/**
 * 4a's "What the score measures" cards. `weight` is the real engine weight, so
 * the mockup's "Largest part" tag is derived below rather than asserted in copy.
 */
export const SCORING_CRITERIA: { name: string; kicker: string; body: string; weight: number }[] = [
  {
    name: "Shape",
    kicker: "Form",
    body: "How closely your drawing follows the outline of the target.",
    weight: SCORE_WEIGHT_PERCENTS.shapeMatch,
  },
  {
    name: "Coverage",
    kicker: "Completeness",
    body: "Whether you drew the whole shape, without stopping partway or adding extra strokes.",
    weight: SCORE_WEIGHT_PERCENTS.coverage,
  },
  {
    name: "Smoothness",
    kicker: "Control",
    body: "How steady the strokes are, rather than shaky and jittery.",
    weight: SCORE_WEIGHT_PERCENTS.smoothness,
  },
  {
    name: "Scale",
    kicker: "Proportion",
    body: "Whether your drawing came out about the same size as the shape shown.",
    weight: SCORE_WEIGHT_PERCENTS.scale,
  },
];

/** The criterion carrying the most weight, so 4a's "Largest part" tag is computed, never typed. */
export const HEAVIEST_CRITERION = SCORING_CRITERIA.reduce((a, b) => (b.weight > a.weight ? b : a));

export const SCORING_INTRO =
  `Four things, weighted — ${HEAVIEST_CRITERION.name.toLowerCase()} match carries the most at ` +
  `${HEAVIEST_CRITERION.weight}%. The result screen shows the combined score with a star rating, a tip on ` +
  `what to improve, and a banner when it is a new personal best.`;

// -------------------------------------------------------------------- FAQ ----

export function siteFaq(counts: CatalogCounts = BUILD_CATALOG_COUNTS): { question: string; answer: string }[] {
  return [
  {
    question: "What happens after the shape disappears?",
    answer:
      "You draw on a blank canvas with no guide underneath, in one attempt. The outline comes back afterwards, laid over your drawing so you can see the difference.",
  },
  {
    question: "How is my score worked out?",
    answer:
      `Shape match, coverage, smoothness and scale, combined into one score shown with a star rating and a tip. ` +
      `Shape match counts for the most, at ${SCORE_WEIGHT_PERCENTS.shapeMatch}%.`,
  },
  {
    question: "Can I play with other people?",
    answer:
      `Two ways. 2 Players passes one device back and forth, alternating who draws first each round. Multiplayer ` +
      `opens a live room for ${PLAYER_RANGE} players over ${ROUND_OPTIONS_TEXT} rounds, joined with a ` +
      `${ROOM_CODE_LENGTH_WORD}-character code.`,
  },
  {
    question: "How many shapes are there?",
    answer: `${counts.shapes} shapes across ${counts.categories} categories, from geometry and letters to animals, food and fantasy.`,
  },
  ];
}
