/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * Turns a drawing into an ordered plan of strokes for the hero to draw.
 *
 * Separate from HeroDrawing.tsx so the sequencing is plain logic that a test
 * can hold to account - the thing that actually matters here is that strokes
 * run one after another at a constant pen speed, never all at once.
 *
 * The stroke ORDER is the path's own point order, and the pen only lifts where
 * the path's `breaks` say a real shape lifts it. Nothing about the geometry or
 * the drawing order is invented here.
 */
import type { DrawingPath } from "../types/Challenge";
import type { Point } from "../types/Point";

/** Pen speed, in viewBox units per second. Tuned to read as a hand, not a plotter. */
export const PEN_SPEED = 300;

/** The pause where the pen genuinely leaves the paper, between two strokes. */
export const STROKE_GAP_MS = 260;

/** Floor for a very short stroke, so a stub is still seen being drawn. */
const MIN_STROKE_MS = 180;

export type Stroke = {
  points: Point[];
  /** Path length in viewBox units - what keeps the pen speed constant. */
  length: number;
  /** When this stroke starts, relative to the start of the drawing. */
  delayMs: number;
  durationMs: number;
};

/** Splits at the path's own `breaks` - each break is a real pen lift. */
export function splitStrokes(path: DrawingPath): Point[][] {
  const breaks = path.breaks ?? [];
  if (breaks.length === 0) return [path.points];
  const out: Point[][] = [];
  let start = 0;
  for (const at of breaks) {
    out.push(path.points.slice(start, at));
    start = at;
  }
  out.push(path.points.slice(start));
  // A one-point "stroke" has no length to draw and would only add a pause.
  return out.filter((stroke) => stroke.length > 1);
}

export function polylineLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/** Strokes in drawing order, each with the time it starts and how long it takes. */
export function planStrokes(path: DrawingPath): { strokes: Stroke[]; totalMs: number } {
  let cursor = 0;
  const strokes = splitStrokes(path).map((points) => {
    const length = polylineLength(points);
    const durationMs = Math.max(MIN_STROKE_MS, (length / PEN_SPEED) * 1000);
    const stroke: Stroke = { points, length, delayMs: cursor, durationMs };
    cursor += durationMs + STROKE_GAP_MS;
    return stroke;
  });
  // The trailing gap is not part of the drawing - the last stroke ends it.
  return { strokes, totalMs: Math.max(0, cursor - STROKE_GAP_MS) };
}

// ------------------------------------------------------------ framing ------

/**
 * A uniform fit-to-canvas transform: one scale and one offset, applied to
 * points rather than through an SVG `transform`, so stroke widths stay constant
 * and the stroke lengths that drive the animation timing are measured on the
 * coordinates actually drawn.
 */
export type FitTransform = { scale: number; tx: number; ty: number };

export type FitOptions = {
  /** Side of the square viewBox the hero draws into. */
  canvas: number;
  /** Fraction of the canvas the shape's LARGER dimension should span. */
  fill: number;
  /** Clear space kept outside the extreme points, in canvas units. */
  padding: number;
};

export const HERO_FIT: FitOptions = { canvas: 220, fill: 0.72, padding: 14 };

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

function bounds(paths: DrawingPath[]): Bounds | null {
  let b: Bounds | null = null;
  for (const path of paths) {
    for (const p of path.points) {
      if (!b) b = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
      else {
        if (p.x < b.minX) b.minX = p.x;
        if (p.y < b.minY) b.minY = p.y;
        if (p.x > b.maxX) b.maxX = p.x;
        if (p.y > b.maxY) b.maxY = p.y;
      }
    }
  }
  return b;
}

/**
 * Frames a whole ROUND, not a single path.
 *
 * Every path that shares a canvas must be passed in together, because the fit
 * is computed from their UNION: the target and the attempt then get byte-identical
 * scale and offset, so the shape cannot jump, resize or drift as the hero moves
 * See -> Remember -> Draw -> Score. It also means the attempt, which wanders a
 * little outside the target, is inside the frame too and cannot clip.
 *
 * Entirely generic - it reads the geometry's own bounding box, so a very wide
 * or very tall shape, or one whose generator uses unusual coordinates, is
 * handled by the same arithmetic. Nothing is positioned by hand.
 */
export function fitTransform(paths: DrawingPath[], options: FitOptions = HERO_FIT): FitTransform {
  const b = bounds(paths);
  if (!b) return { scale: 1, tx: 0, ty: 0 };

  const width = b.maxX - b.minX;
  const height = b.maxY - b.minY;
  // A shape with no extent in either axis (a single repeated point) cannot be
  // scaled meaningfully; draw it at 1:1 and centre it.
  const extent = Math.max(width, height);

  // The larger dimension spans `fill` of the canvas, but never more than the
  // padded area allows - whichever is tighter wins, so padding always holds.
  const span = Math.min(options.canvas * options.fill, options.canvas - options.padding * 2);
  const scale = extent > 0.0001 ? span / extent : 1;

  // Centre the bounding box, not the coordinate system: a generator that draws
  // in a corner of its own box is still centred here.
  const tx = options.canvas / 2 - (b.minX + width / 2) * scale;
  const ty = options.canvas / 2 - (b.minY + height / 2) * scale;
  return { scale, tx, ty };
}

/** Applies a fit to one path. Point metadata (stroke timing, breaks) is preserved. */
export function applyFit(path: DrawingPath, fit: FitTransform): DrawingPath {
  return {
    ...path,
    points: path.points.map((p) => ({ ...p, x: p.x * fit.scale + fit.tx, y: p.y * fit.scale + fit.ty })),
  };
}
