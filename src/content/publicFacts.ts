/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Every concrete number the PUBLIC pages state about how CYDI works.
//
// Why this file exists: the public pages (worker/contentPages.ts and
// worker/seoPages.ts) make specific, checkable claims - "shape match is 70% of
// the score", "a 5-star round pays 80 coins", "you get 20 seconds to draw". A
// claim like that is worse than no claim once the game moves on without it, and
// an audit of the pages before this change found exactly that kind of drift.
//
// So public claims are never typed into page copy. They come from here, and
// here they come from the real source wherever a Worker can reach it:
//
//   - Imported directly     - shape/category counts, the scoring weights, the
//                             size rule, and every multiplayer limit and timing.
//                             These cannot drift: they ARE the game's values.
//   - Restated with a test  - the handful that live in app/constants.ts, which a
//                             Worker cannot import (it reads __APP_BUILD__ and
//                             friends, Vite `define` globals that do not exist
//                             in the Worker bundle - same constraint documented
//                             in engine/scoringConstants.ts). publicFacts.test.ts
//                             asserts every one of them still equals its real
//                             source, so drift fails the build instead of
//                             quietly shipping a false statement to the public.
//
// RULE: adding a number to a public page means adding it here first. If it
// cannot be imported, it needs a line in publicFacts.test.ts.

import { CATEGORIES, SHAPE_LIBRARY, shapesForCategory, type CategoryId } from "../engine/shapeLibrary";
import { MP_LIMITS, MP_TIMINGS, ROUND_COUNT_OPTIONS } from "../multiplayer/protocol";
import {
  RESAMPLE_POINT_COUNT,
  SCORE_WEIGHTS,
  SIZE_CAP_SLOPE,
  SIZE_TOLERANCE,
} from "../engine/scoringConstants";
import { DAILY_CHALLENGE_PRIZE_COINS } from "../app/dailyChallengePrizes";

// ---------------------------------------------------------------- content ----

/** Counted from the library itself, so a new category or shape updates the pages by existing. */
export const CATEGORY_COUNT = CATEGORIES.length;
export const SHAPE_COUNT = SHAPE_LIBRARY.length;

export type CategoryFact = { id: CategoryId; name: string; shapes: number };

export const CATEGORY_FACTS: CategoryFact[] = CATEGORIES.map((category) => ({
  id: category.id,
  name: category.name,
  shapes: shapesForCategory(category.id).length,
}));

// ---------------------------------------------------------------- scoring ----

/** The four scored components, as whole percentages, straight from the engine's weights. */
export const SCORE_WEIGHT_PERCENTS = {
  shapeMatch: Math.round(SCORE_WEIGHTS.shapeMatch * 100),
  scale: Math.round(SCORE_WEIGHTS.scale * 100),
  coverage: Math.round(SCORE_WEIGHTS.coverage * 100),
  smoothness: Math.round(SCORE_WEIGHTS.smoothness * 100),
} as const;

export const RESAMPLE_POINTS = RESAMPLE_POINT_COUNT;

/** The size rule, in the units the pages talk in: "up to 15% off costs nothing; past that, 1% of size error costs 1 point of ceiling". */
export const SIZE_TOLERANCE_PERCENT = Math.round(SIZE_TOLERANCE * 100);
export const SIZE_CEILING_POINTS_PER_PERCENT = SIZE_CAP_SLOPE / 100;

/** Mirrors STAR_RATING_THRESHOLDS in app/constants.ts - asserted equal by publicFacts.test.ts. */
export const STAR_THRESHOLDS: { stars: number; minScore: number }[] = [
  { stars: 5, minScore: 90 },
  { stars: 4, minScore: 80 },
  { stars: 3, minScore: 70 },
  { stars: 2, minScore: 60 },
  { stars: 1, minScore: 50 },
];

/** Mirrors scoreMessage() in engine/scoringConstants.ts - asserted equal by publicFacts.test.ts. */
export const SCORE_BANDS: { minScore: number; label: string }[] = [
  { minScore: 95, label: "Incredible" },
  { minScore: 85, label: "Excellent" },
  { minScore: 70, label: "Nice work" },
  { minScore: 50, label: "Getting close" },
];

/** Mirrors DIFFICULTY_LEVELS in app/constants.ts - asserted equal by publicFacts.test.ts. */
export const DIFFICULTY_FACTS: { name: string; passScore: number }[] = [
  { name: "Beginner", passScore: 50 },
  { name: "Intermediate", passScore: 60 },
  { name: "Skilled", passScore: 70 },
  { name: "Expert", passScore: 80 },
  { name: "Master", passScore: 90 },
];

/** Mirrors DEFAULT_DIFFICULTY in app/constants.ts - asserted equal by publicFacts.test.ts. */
export const DEFAULT_DIFFICULTY_NAME = "Skilled";

// ------------------------------------------------------------------ rounds ----

/** Mirrors PREVIEW_DURATION_MS / FIRST_ROUND_PREVIEW_DURATION_MS - asserted equal by publicFacts.test.ts. */
export const PREVIEW_SECONDS = 2;
export const FIRST_ROUND_PREVIEW_SECONDS = 3;

// ------------------------------------------------------------------ coins ----

/** Mirrors SHAPE_CHALLENGE_COIN_REWARDS in app/constants.ts - asserted equal by publicFacts.test.ts. */
export const COINS_PER_STAR: { stars: number; coins: number }[] = [
  { stars: 1, coins: 10 },
  { stars: 2, coins: 20 },
  { stars: 3, coins: 35 },
  { stars: 4, coins: 55 },
  { stars: 5, coins: 80 },
];

/** Mirrors CATEGORY_UNLOCK_COST in app/constants.ts - asserted equal by publicFacts.test.ts. */
export const CATEGORY_UNLOCK_COST = 1000;

/** Mirrors DAILY_CHEST in app/constants.ts - asserted equal by publicFacts.test.ts. */
export const DAILY_CHEST_MIN_COINS = 50;
export const DAILY_CHEST_MAX_COINS = 150;

/** Imported: the real prize table the Daily Challenge Durable Object pays out. */
export const DAILY_PRIZE_COINS = DAILY_CHALLENGE_PRIZE_COINS;

// ------------------------------------------------------------ multiplayer ----

export const MP_MIN_PLAYERS = MP_LIMITS.MIN_PLAYERS_TO_START;
export const MP_MAX_PLAYERS = MP_LIMITS.MAX_PLAYERS;
export const MP_ROOM_CODE_LENGTH = MP_LIMITS.ROOM_CODE_LENGTH;
export const MP_ROUND_OPTIONS = ROUND_COUNT_OPTIONS;
export const MP_SHOW_SHAPE_SECONDS = MP_TIMINGS.SHOW_SHAPE_MS / 1000;
export const MP_DRAWING_SECONDS = MP_TIMINGS.DRAWING_MS / 1000;
export const MP_ROOM_IDLE_MINUTES = MP_LIMITS.IDLE_TTL_MS / 60_000;

// ------------------------------------------------------------------ links ----

/** Mirrors the share-link TTL in worker/index.ts - asserted equal by publicFacts.test.ts. */
export const SHARE_LINK_EXPIRY_DAYS = 180;
