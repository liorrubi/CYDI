import type { Point } from "../types/Point";
import type { DrawingPath } from "../types/Challenge";
import type { ScoreBreakdown } from "../types/Score";
import { RESAMPLE_POINT_COUNT, SCORE_WEIGHTS, scoreMessage } from "../app/constants";
import type { Vec2 } from "./geometry";
import { boundingBox, clamp, distance, pathLength } from "./geometry";
import { normalizePath } from "./normalizePath";
import { compareClosedShapeWithOffsets, compareWithReverse, isClosedPath } from "./comparePaths";

/** Ratio of normalized arc lengths - did the attempt trace a comparable amount of path. */
function computeCoverage(normTarget: Point[], normAttempt: Point[]): number {
  const targetLength = pathLength(normTarget);
  const attemptLength = pathLength(normAttempt);
  if (targetLength < 1e-9) return 100;

  const ratio = Math.min(targetLength, attemptLength) / Math.max(targetLength, attemptLength);
  return clamp(ratio * 100, 0, 100);
}

/** Ratio of raw (pre-normalization) bounding-box diagonals - did the attempt match the target's physical size. */
function computeScaleScore(targetPath: DrawingPath, attemptPath: DrawingPath): number {
  const targetBox = boundingBox(targetPath.points);
  const attemptBox = boundingBox(attemptPath.points);
  const targetDiag = Math.hypot(targetBox.width, targetBox.height);
  const attemptDiag = Math.hypot(attemptBox.width, attemptBox.height);
  if (targetDiag < 1e-9) return 100;

  const ratio = Math.min(targetDiag, attemptDiag) / Math.max(targetDiag, attemptDiag);
  return clamp(ratio * 100, 0, 100);
}

function angleBetweenDeg(v1: Vec2, v2: Vec2): number {
  const mag1 = Math.hypot(v1.x, v1.y);
  const mag2 = Math.hypot(v2.x, v2.y);
  if (mag1 < 1e-9 || mag2 < 1e-9) return 0;

  const dot = clamp((v1.x * v2.x + v1.y * v2.y) / (mag1 * mag2), -1, 1);
  return (Math.acos(dot) * 180) / Math.PI;
}

// A near-180deg turn almost always means the stroke is intentionally doubling
// back over itself (many target shapes require this - e.g. a peace sign's
// spokes or an animal's eye detour), not a shaky hand. Exclude those turns
// from the jitter penalty entirely.
const RETRACE_ANGLE_THRESHOLD_DEG = 150;

/** Penalizes jittery/shaky strokes based on average segment-to-segment direction change. */
function computeSmoothness(normAttempt: Point[], segmentStarts: number[] = []): number {
  if (normAttempt.length < 3) return 100;

  const boundaries = new Set(segmentStarts);
  let totalAngleChange = 0;
  let count = 0;
  for (let i = 1; i < normAttempt.length - 1; i++) {
    // A pause boundary means points[i-1]->points[i] or points[i]->points[i+1]
    // crosses an invisible gap, not a real drawn line - skip it entirely.
    if (boundaries.has(i) || boundaries.has(i + 1)) continue;
    const v1 = { x: normAttempt[i].x - normAttempt[i - 1].x, y: normAttempt[i].y - normAttempt[i - 1].y };
    const v2 = { x: normAttempt[i + 1].x - normAttempt[i].x, y: normAttempt[i + 1].y - normAttempt[i].y };
    const angleChange = angleBetweenDeg(v1, v2);
    if (angleChange >= RETRACE_ANGLE_THRESHOLD_DEG) continue;
    totalAngleChange += angleChange;
    count++;
  }

  const meanAngleChange = count === 0 ? 0 : totalAngleChange / count;
  return clamp(100 - meanAngleChange * 1.5, 0, 100);
}

/** How well the attempt closed its own loop (independent, informational sub-score). */
function computeClosureScore(attemptPath: DrawingPath): number {
  const points = attemptPath.points;
  if (points.length < 2) return 0;

  const box = boundingBox(points);
  const diag = Math.hypot(box.width, box.height);
  if (diag < 1e-9) return 100;

  const gap = distance(points[0], points[points.length - 1]);
  return clamp(100 - (gap / diag) * 150, 0, 100);
}

/**
 * Compares a target path against a player attempt and returns a 0-100
 * score with a breakdown. Shape-agnostic: never branches on what kind of
 * shape the target is, only on whether it is closed.
 */
export function scoreAttempt(targetPath: DrawingPath, attemptPath: DrawingPath): ScoreBreakdown {
  const normTarget = normalizePath(targetPath, RESAMPLE_POINT_COUNT).points;
  const normAttemptResult = normalizePath(attemptPath, RESAMPLE_POINT_COUNT);
  const normAttempt = normAttemptResult.points;

  const closed = isClosedPath(normTarget);
  const shapeMatch = closed
    ? compareClosedShapeWithOffsets(normTarget, normAttempt)
    : compareWithReverse(normTarget, normAttempt);

  const coverage = computeCoverage(normTarget, normAttempt);
  const smoothness = computeSmoothness(normAttempt, normAttemptResult.segmentStarts);
  const scale = computeScaleScore(targetPath, attemptPath);

  const total = clamp(
    Math.round(
      shapeMatch * SCORE_WEIGHTS.shapeMatch +
        coverage * SCORE_WEIGHTS.coverage +
        smoothness * SCORE_WEIGHTS.smoothness +
        scale * SCORE_WEIGHTS.scale,
    ),
    0,
    100,
  );

  return {
    total,
    shapeMatch: Math.round(shapeMatch),
    coverage: Math.round(coverage),
    smoothness: Math.round(smoothness),
    scale: Math.round(scale),
    closure: closed ? Math.round(computeClosureScore(attemptPath)) : undefined,
    message: scoreMessage(total),
  };
}
