import type { Point } from "../types/Point";
import { clamp, distance } from "./geometry";
import { CLOSED_SHAPE_CLOSURE_THRESHOLD, CLOSED_SHAPE_OFFSET_STEP } from "../app/constants";

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
