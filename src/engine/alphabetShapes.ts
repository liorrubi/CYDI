/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */

// The "English Alphabet" Shape Challenge category: 26 uppercase A–Z guides drawn
// as monoline (uniform single-weight) print capitals. Each glyph is constructed
// purely from geometry here - straight segments and elliptical arcs in a fixed,
// device-independent frame - so nothing depends on an installed font and no font
// outlines are copied.
//
// Representation choice (matches the scoring engine, see scoring.ts): the score
// engine flattens a guide's parts into a single resampled polyline and does NOT
// score interior holes/counters as regions. So letters are authored as monoline
// strokes (no filled counters); multi-stroke letters use `breaks` between parts,
// listed in natural drawing order (top→bottom, left→right, stems before bowls) so
// the sequential comparator aligns well. This is the same DrawingPath/`breaks`
// mechanism existing multi-part shapes (e.g. the donut) already use - not a
// scoring bypass.

import type { DrawingPath } from "../types/Challenge";
import type { ShapeDefinition } from "./shapeLibrary";

// --- Construction frame (fractions of the canvas size) --------------------------
// Cap box: x in [Lx, Rx], y in [T, Bo]; round letters use RC ± (rx, ry).
const T = 0.2; // cap top
const Bo = 0.8; // baseline
const M = 0.5; // x-height midline
const Lx = 0.34; // left edge of straight letters
const Rx = 0.66; // right edge
const Cx = 0.5; // horizontal center
const RCx = 0.5; // round-letter center x
const RCy = 0.5; // round-letter center y
const rx = 0.17; // round-letter x radius
const ry = 0.3; // round-letter y radius

type FPoint = [number, number];
type FPart = FPoint[];

/** Straight segment from (ax,ay) to (bx,by) as n+1 evenly spaced points. */
function seg(ax: number, ay: number, bx: number, by: number, n = 8): FPart {
  const pts: FPart = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
  }
  return pts;
}

/** Elliptical arc; angles in degrees (0 = right, 90 = down, 180 = left, 270/-90 = up). */
function arc(cx: number, cy: number, rX: number, rY: number, a0: number, a1: number, n = 28): FPart {
  const pts: FPart = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + (a1 - a0) * (i / n)) * Math.PI) / 180;
    pts.push([cx + rX * Math.cos(a), cy + rY * Math.sin(a)]);
  }
  return pts;
}

/** Concatenate sub-paths into one part, dropping duplicated join points. */
function join(...subs: FPart[]): FPart {
  const out: FPart = [];
  for (const sub of subs) {
    for (const p of sub) {
      const last = out[out.length - 1];
      if (last && Math.abs(last[0] - p[0]) < 1e-6 && Math.abs(last[1] - p[1]) < 1e-6) continue;
      out.push(p);
    }
  }
  return out;
}

// --- Letter definitions (parts in natural drawing order) ------------------------
const LETTERS: { letter: string; parts: FPart[] }[] = [
  // A: inverted-V then crossbar
  { letter: "A", parts: [join(seg(Lx, Bo, Cx, T), seg(Cx, T, Rx, Bo)), seg(0.404, 0.56, 0.596, 0.56)] },
  // B: stem, upper bowl, lower bowl
  {
    letter: "B",
    parts: [seg(Lx, T, Lx, Bo), arc(Lx, 0.35, 0.3, 0.15, -90, 90, 20), arc(Lx, 0.65, 0.3, 0.15, -90, 90, 20)],
  },
  // C: open arc (opening on the right)
  { letter: "C", parts: [arc(RCx, RCy, rx, ry, -60, -300, 40)] },
  // D: stem + right bowl
  { letter: "D", parts: [seg(Lx, T, Lx, Bo), arc(Lx, RCy, Rx - Lx, ry, -90, 90, 28)] },
  // E: top bar + stem + bottom bar (one stroke) then middle bar
  {
    letter: "E",
    parts: [join(seg(Rx, T, Lx, T), seg(Lx, T, Lx, Bo), seg(Lx, Bo, Rx, Bo)), seg(Lx, M, 0.58, M)],
  },
  // F: top bar + stem (one stroke) then middle bar
  { letter: "F", parts: [join(seg(Rx, T, Lx, T), seg(Lx, T, Lx, Bo)), seg(Lx, M, 0.58, M)] },
  // G: C arc + inner hook (horizontal into a short vertical)
  {
    letter: "G",
    parts: [arc(RCx, RCy, rx, ry, -60, -300, 40), join(seg(0.5, 0.52, 0.585, 0.52), seg(0.585, 0.52, 0.585, 0.7))],
  },
  // H: two verticals + crossbar
  { letter: "H", parts: [seg(Lx, T, Lx, Bo), seg(Rx, T, Rx, Bo), seg(Lx, M, Rx, M)] },
  // I: top serif, stem, bottom serif
  { letter: "I", parts: [seg(0.42, T, 0.58, T), seg(Cx, T, Cx, Bo), seg(0.42, Bo, 0.58, Bo)] },
  // J: stem then hook curving down-left (one stroke)
  { letter: "J", parts: [join(seg(0.6, T, 0.6, 0.62), arc(0.47, 0.62, 0.13, 0.15, 0, 180, 20))] },
  // K: stem + arms meeting at mid (one stroke for the arms)
  { letter: "K", parts: [seg(Lx, T, Lx, Bo), join(seg(Rx, T, Lx, M), seg(Lx, M, Rx, Bo))] },
  // L: stem + baseline (one stroke)
  { letter: "L", parts: [join(seg(Lx, T, Lx, Bo), seg(Lx, Bo, Rx, Bo))] },
  // M: one continuous stroke
  { letter: "M", parts: [join(seg(Lx, Bo, Lx, T), seg(Lx, T, Cx, 0.56), seg(Cx, 0.56, Rx, T), seg(Rx, T, Rx, Bo))] },
  // N: one continuous stroke
  { letter: "N", parts: [join(seg(Lx, Bo, Lx, T), seg(Lx, T, Rx, Bo), seg(Rx, Bo, Rx, T))] },
  // O: closed ellipse
  { letter: "O", parts: [arc(RCx, RCy, rx, ry, -90, 270, 48)] },
  // P: stem + upper bowl
  { letter: "P", parts: [seg(Lx, T, Lx, Bo), arc(Lx, 0.35, 0.3, 0.15, -90, 90, 22)] },
  // Q: closed ellipse + tail
  { letter: "Q", parts: [arc(RCx, RCy, rx, ry, -90, 270, 48), seg(0.56, 0.6, 0.72, 0.82)] },
  // R: stem + (bowl then leg, one stroke)
  { letter: "R", parts: [seg(Lx, T, Lx, Bo), join(arc(Lx, 0.35, 0.3, 0.15, -90, 90, 22), seg(Lx, M, Rx, Bo))] },
  // S: single ogee stroke
  {
    letter: "S",
    parts: [
      [
        [0.62, 0.28],
        [0.55, 0.235],
        [0.46, 0.24],
        [0.4, 0.3],
        [0.41, 0.38],
        [0.48, 0.44],
        [0.56, 0.5],
        [0.61, 0.58],
        [0.61, 0.67],
        [0.55, 0.75],
        [0.46, 0.77],
        [0.38, 0.73],
        [0.36, 0.67],
      ],
    ],
  },
  // T: top bar + stem
  { letter: "T", parts: [seg(Lx, T, Rx, T), seg(Cx, T, Cx, Bo)] },
  // U: left down, round bottom, right up (one stroke)
  {
    letter: "U",
    parts: [join(seg(Lx, T, Lx, 0.6), arc(Cx, 0.6, Cx - Lx, 0.2, 180, 0, 24), seg(Rx, 0.6, Rx, T))],
  },
  // V: single stroke
  { letter: "V", parts: [join(seg(Lx, T, Cx, Bo), seg(Cx, Bo, Rx, T))] },
  // W: single stroke
  {
    letter: "W",
    parts: [join(seg(Lx, T, 0.42, Bo), seg(0.42, Bo, Cx, 0.52), seg(Cx, 0.52, 0.58, Bo), seg(0.58, Bo, Rx, T))],
  },
  // X: two diagonals
  { letter: "X", parts: [seg(Lx, T, Rx, Bo), seg(Rx, T, Lx, Bo)] },
  // Y: left arm + stem (one stroke), right arm
  { letter: "Y", parts: [join(seg(Lx, T, Cx, M), seg(Cx, M, Cx, Bo)), seg(Rx, T, Cx, M)] },
  // Z: single stroke
  { letter: "Z", parts: [join(seg(Lx, T, Rx, T), seg(Rx, T, Lx, Bo), seg(Lx, Bo, Rx, Bo))] },
];

/** Scale fractional parts to px and build a DrawingPath, marking a break between parts. */
function partsToDrawingPath(parts: FPart[], size: number): DrawingPath {
  const points: { x: number; y: number; t: number }[] = [];
  const breaks: number[] = [];
  for (const part of parts) {
    if (part.length === 0) continue;
    if (points.length > 0) breaks.push(points.length);
    for (const [fx, fy] of part) points.push({ x: fx * size, y: fy * size, t: points.length });
  }
  return { points, canvasWidth: size, canvasHeight: size, breaks: breaks.length > 0 ? breaks : undefined };
}

/** The 26 A–Z letter shapes, in strict alphabetical order (index = play/level order). */
export const ALPHABET_SHAPES: ShapeDefinition[] = LETTERS.map(({ letter, parts }) => ({
  id: `alphabet-${letter.toLowerCase()}`,
  name: letter,
  category: "alphabet",
  generate: (size: number) => partsToDrawingPath(parts, size),
}));
