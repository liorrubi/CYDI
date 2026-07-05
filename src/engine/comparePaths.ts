import type { Point } from "../types/Point";
import { clamp, distance } from "./geometry";
import { CLOSED_SHAPE_CLOSURE_THRESHOLD, CLOSED_SHAPE_OFFSET_STEP } from "../app/constants";

const DISTANCE_TO_SCORE_FACTOR = 320;

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

export function reversePoints(points: Point[]): Point[] {
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
 * Whether a normalized path is a closed shape: its first and last points
 * are close together relative to the (unit-scaled) shape size.
 */
export function isClosedPath(points: Point[]): boolean {
  if (points.length < 3) return false;
  return distance(points[0], points[points.length - 1]) < CLOSED_SHAPE_CLOSURE_THRESHOLD;
}

/**
 * Rotates an array by `offset` indices. This is an array rotation, not a
 * geometric one - valid because both arrays are uniformly arc-length
 * resampled to the same point count, so shifting indices approximates
 * starting the trace at a different point along the shape.
 */
export function rotateOffset<T>(points: T[], offset: number): T[] {
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
