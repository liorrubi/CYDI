/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Which shapes a Play Together room can draw from, per difficulty setting.
//
// Two layers, deliberately separate:
//   1. shapeDifficultyTable.ts - computed from geometry, regenerated with
//      `npm run shape-difficulty`, never hand-edited.
//   2. DIFFICULTY_OVERRIDES below - hand-maintained, wins over the computed
//      tier, and survives regeneration precisely because the generator does
//      not write this file.
//
// POOL SOURCE: the baked-in SHAPE_LIBRARY only, never the remote content
// catalog. Same fairness gate as DAILY_USES_REMOTE_CATALOG in
// dailyChallengeDO.ts, and it matters more here: an Android build and a web
// browser play the SAME round, so a shapeId that one of them cannot resolve
// would silently hand two players different shapes to race on.
import { SHAPE_LIBRARY } from "../engine/shapeLibrary";
import { GENERATED_SHAPE_DIFFICULTY, type ShapeDifficultyTier } from "./shapeDifficultyTable";
import type { MultiplayerDifficulty } from "./protocol";

export type { ShapeDifficultyTier };

/**
 * Hand corrections to the computed tiers. Add an entry when a shape lands in a
 * tier that feels wrong in playtesting - the geometry heuristic measures how
 * intricate a path is, which is a good proxy for tracing difficulty but not a
 * perfect one (a shape can be geometrically busy yet very familiar to draw, or
 * geometrically simple yet hard to recall from a 3-second look).
 *
 * Empty at Stage 3: the generated distribution was reviewed and no shape was
 * obviously misplaced. Kept as the documented correction point rather than
 * pre-filled with guesses.
 */
export const DIFFICULTY_OVERRIDES: Readonly<Record<string, ShapeDifficultyTier>> = {
  // Measured at ~13.8s of drawing time across 10 separate parts - slower than
  // roughly four fifths of the HARD pool, and the slowest shape outside it.
  // The geometry heuristic put it in Medium because its outline is short and
  // smooth; what it does not weigh heavily enough is that ten disconnected
  // barbs each need placing. A player choosing Medium for a quicker round was
  // getting the slowest non-Hard shape in the game.
  "nat-feather": "hard",
};

/**
 * Shapes kept OUT of Play Together entirely, at every difficulty including
 * Mixed. They remain fully available in single-player - this is not a judgement
 * on the shape, only on whether it fits a 20-second round.
 *
 * The bar is deliberately narrow. Hard is supposed to be hard, and almost
 * everything in it is: the Hard pool's median drawing time is about 10 seconds,
 * half the window. These five are the only shapes that failed BOTH independent
 * checks - more than 15 seconds of estimated drawing time AND ten or more
 * separate parts. That the two measures agree on exactly the same five is why
 * this list is five and not an arbitrary cut somewhere down a ranked list.
 *
 * For these, the clock decides the score rather than the player's skill: even
 * drawing continuously and well, there is no time left to recall where ten
 * pieces belong after a three-second look, let alone to correct anything.
 *
 * Re-derive with: node --import ./scripts/register-ts.mjs scripts/auditMultiplayerPools.ts
 */
export const MULTIPLAYER_EXCLUSIONS: ReadonlySet<string> = new Set([
  "ani-turtle", // ~20.8s, 14 parts - longer than the entire round on its own
  "ani-lion", // ~17.2s, 10 parts
  "trans-firetruck", // ~16.4s, 10 parts
  "food-grapes", // ~16.4s, 10 parts
  "ani-owl", // ~15.5s, 10 parts
]);

/** The effective tier for a shape: an override if one exists, otherwise the generated value. Unknown ids fall back to "medium". */
export function difficultyForShape(shapeId: string): ShapeDifficultyTier {
  return DIFFICULTY_OVERRIDES[shapeId] ?? GENERATED_SHAPE_DIFFICULTY[shapeId] ?? "medium";
}

// Built once at module load. Only ids that exist in SHAPE_LIBRARY are included,
// so a stale entry in the generated table (a shape that was later renamed or
// removed) can never put an unresolvable id into a live room.
const POOLS: Record<ShapeDifficultyTier, string[]> = { easy: [], medium: [], hard: [] };
const MIXED_POOL: string[] = [];
for (const shape of SHAPE_LIBRARY) {
  if (MULTIPLAYER_EXCLUSIONS.has(shape.id)) continue;
  POOLS[difficultyForShape(shape.id)].push(shape.id);
  MIXED_POOL.push(shape.id);
}

/** Every shape id available at this setting. "mixed" is the whole library minus the exclusions. */
export function poolFor(difficulty: MultiplayerDifficulty): readonly string[] {
  // Mixed is built from the same filtered pass rather than from SHAPE_LIBRARY,
  // so an exclusion can never leak back in through the default setting - which
  // is the one most rooms actually play.
  if (difficulty === "mixed") return MIXED_POOL;
  return POOLS[difficulty];
}

export function poolSizes(): Record<ShapeDifficultyTier, number> {
  return { easy: POOLS.easy.length, medium: POOLS.medium.length, hard: POOLS.hard.length };
}

/**
 * Picks `count` distinct shape ids for a game, in play order.
 *
 * Distinct matters: drawing the same shape twice in one 15-round game is an
 * obvious wart, and with a 92-shape tier there is no reason to allow it. If a
 * pool were ever smaller than the round count the sequence repeats rather than
 * failing, since a short game is better than no game.
 *
 * `random` is injectable so tests can pin the sequence.
 */
export function pickShapeSequence(
  difficulty: MultiplayerDifficulty,
  count: number,
  random: () => number = Math.random,
): string[] {
  const pool = poolFor(difficulty);
  if (pool.length === 0) return [];

  const remaining = [...pool];
  const chosen: string[] = [];
  while (chosen.length < count) {
    if (remaining.length === 0) remaining.push(...pool);
    const index = Math.floor(random() * remaining.length) % remaining.length;
    chosen.push(remaining.splice(index, 1)[0]);
  }
  return chosen;
}
