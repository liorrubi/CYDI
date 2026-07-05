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

/**
 * Full normalization pipeline: dedupe -> resample -> center -> scale.
 * Returns exactly `count` points centered on the origin, scaled so the
 * longer bounding-box dimension is 1.
 */
export function normalizePath(path: DrawingPath, count = 128): Point[] {
  const deduped = removeNearDuplicates(path.points);
  const resampled = resamplePath(deduped, count);
  const centered = centerPoints(resampled);
  const scaled = scaleToUnit(centered);
  return scaled;
}
