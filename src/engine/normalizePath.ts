import type { Point } from "../types/Point";
import type { DrawingPath } from "../types/Challenge";
import { centerPoints, distance, pathLength, scaleToUnit } from "./geometry";

/** Drops consecutive points that are closer than `minDist` apart. */
export function removeNearDuplicates(points: Point[], minDist = 0.5): Point[] {
  if (points.length === 0) return points;

  const result: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (distance(result[result.length - 1], points[i]) >= minDist) {
      result.push(points[i]);
    }
  }
  return result;
}

/** Resamples a path to exactly `count` points, evenly spaced by arc length. */
export function resamplePath(points: Point[], count: number): Point[] {
  if (points.length === 0) {
    return Array.from({ length: count }, () => ({ x: 0, y: 0, t: 0 }));
  }
  if (points.length < 2) {
    const only = points[0];
    return Array.from({ length: count }, () => ({ ...only }));
  }

  const totalLength = pathLength(points);
  if (totalLength < 1e-9) {
    const only = points[0];
    return Array.from({ length: count }, () => ({ ...only }));
  }

  const step = totalLength / (count - 1);
  const result: Point[] = [points[0]];
  let prevPoint = points[0];
  let segmentIndex = 1;
  let distanceSinceLastSample = 0;

  while (result.length < count && segmentIndex < points.length) {
    const currentPoint = points[segmentIndex];
    const segmentLength = distance(prevPoint, currentPoint);

    if (distanceSinceLastSample + segmentLength >= step) {
      const remaining = step - distanceSinceLastSample;
      const t = segmentLength < 1e-9 ? 0 : remaining / segmentLength;
      const sample: Point = {
        x: prevPoint.x + (currentPoint.x - prevPoint.x) * t,
        y: prevPoint.y + (currentPoint.y - prevPoint.y) * t,
        t: prevPoint.t + (currentPoint.t - prevPoint.t) * t,
      };
      result.push(sample);
      prevPoint = sample;
      distanceSinceLastSample = 0;
    } else {
      distanceSinceLastSample += segmentLength;
      prevPoint = currentPoint;
      segmentIndex++;
    }
  }

  while (result.length < count) {
    result.push(points[points.length - 1]);
  }

  return result;
}

export type NormalizedPath = {
  points: Point[];
  /** Indices in `points` where a new pause-separated segment begins (excluding 0). Empty for a single continuous path. */
  segmentStarts: number[];
};

/** Splits points into sub-arrays at the given break indices (each index starts a new segment). */
function splitIntoSegments(points: Point[], breaks: number[] | undefined): Point[][] {
  if (!breaks || breaks.length === 0) return points.length > 0 ? [points] : [];
  const segments: Point[][] = [];
  let start = 0;
  for (const breakIndex of breaks) {
    segments.push(points.slice(start, breakIndex));
    start = breakIndex;
  }
  segments.push(points.slice(start));
  return segments;
}

/**
 * Full normalization pipeline: dedupe -> resample -> center -> scale.
 * Returns exactly `count` points centered on the origin, scaled so the
 * longer bounding-box dimension is 1.
 *
 * Pause-separated segments (from lifting the pointer mid-drawing) are
 * resampled independently and the point budget is allocated proportionally
 * to each segment's own ink length - the invisible gap between segments
 * never counts as drawn distance, so lifting the pointer can't inflate
 * path length or smear points across a phantom connecting line.
 */
export function normalizePath(path: DrawingPath, count = 128): NormalizedPath {
  const segments = splitIntoSegments(path.points, path.breaks)
    .map((segment) => removeNearDuplicates(segment))
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return { points: resamplePath([], count), segmentStarts: [] };
  }

  const segmentLengths = segments.map((segment) => pathLength(segment));
  const totalLength = segmentLengths.reduce((sum, len) => sum + len, 0);

  let allocations: number[];
  if (totalLength < 1e-9) {
    const base = Math.floor(count / segments.length);
    allocations = segments.map(() => base);
    allocations[allocations.length - 1] += count - base * segments.length;
  } else {
    allocations = segmentLengths.map((len) => Math.max(2, Math.round((len / totalLength) * count)));
    let diff = count - allocations.reduce((sum, n) => sum + n, 0);
    let i = 0;
    while (diff !== 0 && i < count * 4) {
      const idx = i % allocations.length;
      if (diff > 0) {
        allocations[idx]++;
        diff--;
      } else if (allocations[idx] > 2) {
        allocations[idx]--;
        diff++;
      }
      i++;
    }
  }

  const points: Point[] = [];
  const segmentStarts: number[] = [];
  segments.forEach((segment, i) => {
    if (i > 0) segmentStarts.push(points.length);
    points.push(...resamplePath(segment, allocations[i]));
  });

  const centered = centerPoints(points);
  const scaled = scaleToUnit(centered);
  return { points: scaled, segmentStarts };
}
