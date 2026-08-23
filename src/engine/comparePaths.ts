import type { Point } from "../types/Point";
import { clamp, distance } from "./geometry";
import { CLOSED_SHAPE_CLOSURE_THRESHOLD, CLOSED_SHAPE_OFFSET_STEP } from "./scoringConstants";

const DISTANCE_TO_SCORE_FACTOR = 380;

/**
 * Compares two equal-length, already-normalized point arrays and returns a
 * 0-100 score based on root-mean-square point-to-point distance (higher is
 * better). RMS (rather than plain mean) is used deliberately: it punishes
 * localized deviations - like a star's concave points not matching a
 * circle's constant radius - much harder than a mean would, which otherwise
 * let structurally different but similarly-sized shapes score too high.
 */
export function comparePointArrays(a: Point[], b: Point[]): number {
  if (a.length === 0 || b.length === 0) return 0;

  const length = Math.min(a.length, b.length);
  let sumSquares = 0;
  for (let i = 0; i < length; i++) {
    sumSquares += distance(a[i], b[i]) ** 2;
  }
  const rmsDistance = Math.sqrt(sumSquares / length);
  return clamp(100 - rmsDistance * DISTANCE_TO_SCORE_FACTOR, 0, 100);
}

function reversePoints(points: Point[]): Point[] {
  return [...points].reverse();
}

/**
 * Compares `a` (target) against `b` (attempt), trying both the forward and
 * reverse direction of `b`, and returns the better (higher) score.
 */
export function compareWithReverse(a: Point[], b: Point[]): number {
  return Math.max(comparePointArrays(a, b), comparePointArrays(a, reversePoints(b)));
}

/**
 * Order-independent fallback comparison: for every point in one array, finds
 * the distance to its closest point in the other array (checked in both
 * directions), and scores based on the WORST such gap (a Hausdorff-style
 * distance). This tolerates a different (but geometrically equivalent)
 * stroke order or retrace pattern - e.g. an X drawn as two separate crossing
 * lines instead of a target's internal "retrace to center, then jump"
 * artifact (needed only to keep the target itself a single continuous
 * stroke) - without being nearly as easy to game with a loose scribble as a
 * plain average-based nearest-neighbor comparison would be, since every
 * single point must find a genuinely close match, not just most of them.
 */
export function compareOrderIndependent(a: Point[], b: Point[]): number {
  if (a.length === 0 || b.length === 0) return 0;

  function worstNearestNeighborDistance(from: Point[], to: Point[]): number {
    let worst = 0;
    for (const p of from) {
      let nearest = Infinity;
      for (const q of to) {
        const d = distance(p, q);
        if (d < nearest) nearest = d;
      }
      if (nearest > worst) worst = nearest;
    }
    return worst;
  }

  const hausdorffDistance = Math.max(worstNearestNeighborDistance(a, b), worstNearestNeighborDistance(b, a));
  return clamp(100 - hausdorffDistance * DISTANCE_TO_SCORE_FACTOR, 0, 100);
}

/**
 * Whether a normalized path is a closed shape: it comes back near its own
 * starting point at some point along the way. Checked across the whole path
 * (skipping the immediate start neighborhood, which is trivially close) -
 * not just the very last point - because several shapes draw a fully closed
 * main loop and then append a short decorative tail afterward (e.g. a peace
 * sign's center spokes, a clock's hands, a medal's ribbon), which would
 * otherwise misclassify an obviously-closed shape as open and disable the
 * rotational-offset search, making the comparison far too strict.
 */
export function isClosedPath(points: Point[]): boolean {
  if (points.length < 3) return false;
  const searchFrom = Math.max(1, Math.floor(points.length * 0.1));
  for (let i = searchFrom; i < points.length; i++) {
    if (distance(points[0], points[i]) < CLOSED_SHAPE_CLOSURE_THRESHOLD) return true;
  }
  return false;
}

/**
 * Rotates an array by `offset` indices. This is an array rotation, not a
 * geometric one - valid because both arrays are uniformly arc-length
 * resampled to the same point count, so shifting indices approximates
 * starting the trace at a different point along the shape.
 */
function rotateOffset<T>(points: T[], offset: number): T[] {
  const n = points.length;
  if (n === 0) return points;
  const k = ((offset % n) + n) % n;
  return [...points.slice(k), ...points.slice(0, k)];
}

/**
 * Compares a closed-shape target against an attempt by trying every
 * rotational start-point offset (and both directions at each offset),
 * returning the single best (highest) score found.
 */
export function compareClosedShapeWithOffsets(
  a: Point[],
  b: Point[],
  step: number = CLOSED_SHAPE_OFFSET_STEP,
): number {
  const n = a.length;
  let best = 0;

  for (let offset = 0; offset < n; offset += step) {
    const rotatedA = rotateOffset(a, offset);
    best = Math.max(best, comparePointArrays(rotatedA, b), comparePointArrays(rotatedA, reversePoints(b)));
  }

  return best;
}

// ---------------------------------------------------- contour deviation ----

/** Distance from a point to a line SEGMENT (not just to its endpoints). */
function pointToSegmentDistance(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lengthSquared = vx * vx + vy * vy;
  if (lengthSquared === 0) return distance(p, a);
  const t = clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / lengthSquared, 0, 1);
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

/** Splits a point array at the given segment starts, so no measurement ever crosses the invisible gap between two disconnected parts. */
function toPolylines(points: Point[], segmentStarts: number[]): Point[][] {
  if (segmentStarts.length === 0) return points.length > 1 ? [points] : [];
  const out: Point[][] = [];
  let start = 0;
  for (const boundary of segmentStarts) {
    if (boundary > start) out.push(points.slice(start, boundary));
    start = boundary;
  }
  out.push(points.slice(start));
  return out.filter((s) => s.length > 1);
}

/** Shortest distance from `p` to anywhere on a set of polylines. */
function distanceToPolylines(p: Point, polylines: Point[][]): number {
  let best = Infinity;
  for (const line of polylines) {
    for (let i = 1; i < line.length; i++) {
      const d = pointToSegmentDistance(p, line[i - 1], line[i]);
      if (d < best) best = d;
    }
  }
  return best === Infinity ? 0 : best;
}

/**
 * How far the WORST PARTS of one contour sit from the other, as a 0-100 score.
 *
 * This exists because every other comparison here is an aggregate, and an
 * aggregate hides exactly the mistake players notice most: a drawing whose
 * outline is broadly right but where one section bulges well away from the
 * reference. Two things conspire to bury it:
 *
 *   1. normalizePath centers and rescales, so a big LOCAL bulge is spread into
 *      a moderate GLOBAL offset - after normalization there is no outlier tail
 *      left for RMS to punish (measured: a 34px dent produced a distance
 *      distribution with mean 0.066 and p95 0.112, barely a tail at all).
 *   2. comparePointArrays pairs point i with point i, so its result depends on
 *      how the two paths happen to be parameterised, not purely on where the
 *      ink is.
 *
 * So this measures something different on purpose: distance from each point to
 * the nearest place on the OTHER contour, ignoring correspondence entirely, and
 * reports a high percentile rather than a mean. Symmetric, because one
 * direction alone is trivially gamed - drawing over half the shape leaves every
 * attempt point close to the target, and only the target-to-attempt direction
 * notices the missing half.
 *
 * A percentile rather than the true maximum (which compareOrderIndependent
 * already uses): the maximum is one point, so a single stray sample or the
 * endpoint of an open path can dominate it. The 90th percentile means "a tenth
 * of the outline may be off; the rest has to be close", which is what the eye
 * is actually doing.
 */
const CONTOUR_DEVIATION_PERCENTILE = 0.9;

export function compareContourDeviation(
  target: Point[],
  targetSegmentStarts: number[],
  attempt: Point[],
  attemptSegmentStarts: number[],
): number {
  if (target.length < 2 || attempt.length < 2) return 0;

  const targetLines = toPolylines(target, targetSegmentStarts);
  const attemptLines = toPolylines(attempt, attemptSegmentStarts);
  if (targetLines.length === 0 || attemptLines.length === 0) return 0;

  const deviations: number[] = [];
  for (const p of attempt) deviations.push(distanceToPolylines(p, targetLines));
  for (const p of target) deviations.push(distanceToPolylines(p, attemptLines));

  deviations.sort((a, b) => a - b);
  const index = Math.min(deviations.length - 1, Math.floor(CONTOUR_DEVIATION_PERCENTILE * deviations.length));
  // Same distance-to-score factor as the sequential comparison, deliberately:
  // both are measuring a distance in the same normalized unit space, and a
  // second independent constant would be two things to keep calibrated.
  return clamp(100 - deviations[index] * DISTANCE_TO_SCORE_FACTOR, 0, 100);
}
