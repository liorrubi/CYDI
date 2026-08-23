/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Every constant the scoring engine needs, and NOTHING else.
//
// Why this file exists: app/constants.ts references __APP_BUILD__ /
// __APP_BUILD_TIME__, globals Vite injects via `define` at build time. They do
// not exist in the Worker's separate esbuild bundle, so importing app/constants
// from Worker code throws at module load - the same constraint already
// documented at the top of app/dailyChallengePrizes.ts.
//
// engine/scoring.ts and engine/comparePaths.ts are now shared with the Worker
// (multiplayer scores are computed server-side, see worker/roomDO.ts), so the
// handful of values they read had to move somewhere dependency-free. That is
// all this file is.
//
// app/constants.ts re-exports every one of these, so all existing client
// imports keep working unchanged and there is exactly one source of truth.
//
// RULE: nothing may be added here that imports anything, reads import.meta, or
// touches a Vite-injected global. If it can't run under plain workerd, it
// doesn't belong in this file.

export const RESAMPLE_POINT_COUNT = 128;

// A step of 1 tries every possible rotational starting point (cheap: ~128
// offsets x 2 directions on a 128-point array, well under a millisecond).
// A coarser step can skip right past the true best alignment for shapes
// with a few sharp, widely-spaced features (stars, hub-and-spoke symbols),
// producing a spuriously low score even for an accurate trace.
export const CLOSED_SHAPE_OFFSET_STEP = 1;
export const CLOSED_SHAPE_CLOSURE_THRESHOLD = 0.15;

export const SCORE_WEIGHTS = {
  shapeMatch: 0.7,
  coverage: 0.05,
  smoothness: 0.05,
  scale: 0.2,
} as const;

export function scoreMessage(total: number): string {
  if (total >= 95) return "Incredible";
  if (total >= 85) return "Excellent";
  if (total >= 70) return "Nice work";
  if (total >= 50) return "Getting close";
  return "Try again";
}

/**
 * How wrong a drawing's SIZE may be before it starts limiting the score.
 *
 * Expressed as linear size error: `1 - min(r, 1/r)` where r is the ratio of the
 * attempt's bounding-box diagonal to the target's. 0 is a perfect match, 0.15
 * is a drawing about 15% too small (or ~18% too large).
 *
 * Everything else in the scorer is size-blind on purpose - normalizePath
 * centers and rescales before any comparison - so without this a flawless
 * outline drawn at a third of the size scores like a flawless outline.
 */
export const SIZE_TOLERANCE = 0.15;

/**
 * Points of MAXIMUM achievable score removed per unit of size error beyond the
 * tolerance. At 100 the rule states plainly: past the 15% tolerance, every
 * further 1% of size error costs 1 point of the ceiling.
 *
 * Chosen as the gentlest slope at which no clearly mis-sized drawing (0.3x,
 * 0.5x, 1.5x, 1.7x measured across 12 shapes) can still reach the "Excellent"
 * band - a softer 80 left 1.5x scoring 86. See scripts/scoringCalibration.ts.
 */
export const SIZE_CAP_SLOPE = 100;

/**
 * The highest total a drawing of this size may earn, 0-100.
 *
 * A CEILING rather than a deduction, and deliberately separate from the
 * additive `scale` component: at 20% weight that term can only ever dock about
 * 20 points, which is not enough to stop a perfectly-shaped drawing at 0.3x
 * size scoring in the 80s. A ceiling says something the weighted sum cannot -
 * that past a point, no amount of accuracy elsewhere earns a top score for a
 * drawing that is plainly the wrong size.
 *
 * `scaleScore` is the existing scale component (already `min(r, 1/r) * 100`),
 * so this needs no new geometry.
 */
export function sizeCeiling(scaleScore: number): number {
  const sizeError = 1 - clamp01(scaleScore / 100);
  const excess = Math.max(0, sizeError - SIZE_TOLERANCE);
  return Math.max(0, 100 - excess * SIZE_CAP_SLOPE);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
