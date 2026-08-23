/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Calibration harness for the drawing scorer.
//
//   node --import ./scripts/register-ts.mjs scripts/scoringCalibration.ts
//   node --import ./scripts/register-ts.mjs scripts/scoringCalibration.ts --detail
//
// Builds repeatable synthetic attempts by perturbing the reference paths in
// controlled ways - jitter, a single large local dent, sinusoidal wobble,
// squash/shear, partial coverage, and outright wrong shapes - across open and
// closed shapes from several categories, then prints the score and its
// breakdown for each.
//
// The point is to see the ORDERING and the SPREAD, not to hit any single
// number. A scorer is working when a genuinely good drawing stays high, a
// clearly distorted one lands well below it, and nothing in between crosses
// over.
import { scoreAttempt } from "../src/engine/scoring.ts";
import { getShapeById } from "../src/engine/shapeLibrary.ts";
import { CANVAS_SIZE } from "../src/app/constants.ts";
import type { DrawingPath } from "../src/types/Challenge.ts";
import type { Point } from "../src/types/Point.ts";

// Deterministic PRNG so a run is reproducible and two runs are comparable.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const map = (path: DrawingPath, fn: (p: Point, i: number, n: number) => Point): DrawingPath => ({
  ...path,
  points: path.points.map((p, i) => fn(p, i, path.points.length)),
});

function centroid(path: DrawingPath): Point {
  const n = path.points.length;
  let x = 0;
  let y = 0;
  for (const p of path.points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / n, y: y / n, t: 0 };
}

// --- perturbations -----------------------------------------------------------

/** Uniform hand-shake: every point nudged a little. The signature of a careful but imperfect trace. */
function jitter(path: DrawingPath, amplitude: number, seed = 1): DrawingPath {
  const rand = rng(seed);
  return map(path, (p) => ({ x: p.x + (rand() - 0.5) * 2 * amplitude, y: p.y + (rand() - 0.5) * 2 * amplitude, t: p.t }));
}

/**
 * One large, contiguous deviation - the case that started this: most of the
 * outline is right, but a real chunk of it bulges away from the reference.
 * `width` is the fraction of the path affected; the offset tapers with a raised
 * cosine so the edges stay continuous rather than making two corners.
 */
function localDent(path: DrawingPath, atFraction: number, width: number, magnitude: number): DrawingPath {
  const c = centroid(path);
  const n = path.points.length;
  const start = Math.floor(atFraction * n);
  const span = Math.max(2, Math.floor(width * n));
  return map(path, (p, i) => {
    // Circular offset so a dent can straddle the start of a closed path.
    let d = i - start;
    if (d < -n / 2) d += n;
    if (d > n / 2) d -= n;
    if (Math.abs(d) > span / 2) return p;
    const taper = 0.5 * (1 + Math.cos((d / (span / 2)) * Math.PI));
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * magnitude * taper, y: p.y + (dy / len) * magnitude * taper, t: p.t };
  });
}

/** Many small radial deviations - a lumpy version of the right shape. */
function wobble(path: DrawingPath, cycles: number, magnitude: number): DrawingPath {
  const c = centroid(path);
  return map(path, (p, i, n) => {
    const phase = (i / n) * Math.PI * 2 * cycles;
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const len = Math.hypot(dx, dy) || 1;
    const off = Math.sin(phase) * magnitude;
    return { x: p.x + (dx / len) * off, y: p.y + (dy / len) * off, t: p.t };
  });
}

/** Squashed vertically about the centre - same ink, same rough extent, wrong proportions. */
function squash(path: DrawingPath, factor: number): DrawingPath {
  const c = centroid(path);
  return map(path, (p) => ({ x: p.x, y: c.y + (p.y - c.y) * factor, t: p.t }));
}

function shear(path: DrawingPath, k: number): DrawingPath {
  const c = centroid(path);
  return map(path, (p) => ({ x: p.x + (p.y - c.y) * k, y: p.y, t: p.t }));
}

/** Only part of the shape was drawn. */
function partial(path: DrawingPath, keepFraction: number): DrawingPath {
  const keep = Math.max(2, Math.floor(path.points.length * keepFraction));
  const breaks = (path.breaks ?? []).filter((b) => b < keep);
  return { ...path, points: path.points.slice(0, keep), breaks: breaks.length ? breaks : undefined };
}

/** Uniform scale about the centre - tests the scale component specifically. */
function resize(path: DrawingPath, factor: number): DrawingPath {
  const c = centroid(path);
  return map(path, (p) => ({ x: c.x + (p.x - c.x) * factor, y: c.y + (p.y - c.y) * factor, t: p.t }));
}

/** A different shape entirely, rescaled to sit in the target's bounding box - "right size, wrong drawing". */
function otherShape(targetId: string, otherId: string): DrawingPath | null {
  const other = getShapeById(otherId);
  if (!other) return null;
  return other.generate(CANVAS_SIZE);
}

// --- the calibration set -----------------------------------------------------

export type Case = { label: string; band: Band; build: (target: DrawingPath, id: string) => DrawingPath | null };
export type Band = "near-perfect" | "good" | "mediocre" | "local-defect" | "distorted" | "wrong" | "natural-size" | "off-size" | "wrong-size";

export const CASES: Case[] = [
  { label: "exact trace", band: "near-perfect", build: (t) => t },
  { label: "tiny jitter (1.5px)", band: "near-perfect", build: (t) => jitter(t, 1.5, 7) },
  { label: "small jitter (4px)", band: "good", build: (t) => jitter(t, 4, 11) },
  { label: "slightly small (0.92x)", band: "good", build: (t) => resize(t, 0.92) },
  { label: "small jitter + slight shrink", band: "good", build: (t) => resize(jitter(t, 3, 13), 0.94) },
  { label: "moderate jitter (9px)", band: "mediocre", build: (t) => jitter(t, 9, 17) },
  { label: "gentle wobble (3 cycles, 10px)", band: "mediocre", build: (t) => wobble(t, 3, 10) },
  { label: "ONE big dent (20% of path, 34px)", band: "local-defect", build: (t) => localDent(t, 0.3, 0.2, 34) },
  { label: "ONE huge dent (15% of path, 55px)", band: "local-defect", build: (t) => localDent(t, 0.55, 0.15, 55) },
  { label: "TWO big dents", band: "local-defect", build: (t) => localDent(localDent(t, 0.2, 0.15, 40), 0.7, 0.15, -38) },
  { label: "dent + small jitter", band: "local-defect", build: (t) => jitter(localDent(t, 0.4, 0.18, 38), 3, 23) },
  { label: "squashed 0.6x (right ink, wrong proportions)", band: "distorted", build: (t) => squash(t, 0.6) },
  { label: "sheared 0.35", band: "distorted", build: (t) => shear(t, 0.35) },
  { label: "heavy wobble (6 cycles, 22px)", band: "distorted", build: (t) => wobble(t, 6, 22) },
  { label: "big jitter (20px)", band: "distorted", build: (t) => jitter(t, 20, 29) },
  { label: "only 60% drawn", band: "distorted", build: (t) => partial(t, 0.6) },
  // A full sweep of sizes, because size is the ONLY thing the rest of the
  // scorer normalizes away - every other component is size-blind by design, so
  // `scale` and the size cap are the only places a badly-sized drawing can be
  // noticed at all. The band split matters: "natural" is the ordinary
  // variation a careful player produces and must stay forgiven, while
  // "wrong-size" is a drawing nobody would call the right size.
  { label: "size 0.85x", band: "natural-size", build: (t) => resize(t, 0.85) },
  { label: "size 1.15x", band: "natural-size", build: (t) => resize(t, 1.15) },
  { label: "size 0.70x", band: "off-size", build: (t) => resize(t, 0.7) },
  { label: "size 1.30x", band: "off-size", build: (t) => resize(t, 1.3) },
  { label: "size 0.50x", band: "wrong-size", build: (t) => resize(t, 0.5) },
  { label: "size 1.50x", band: "wrong-size", build: (t) => resize(t, 1.5) },
  { label: "size 0.30x", band: "wrong-size", build: (t) => resize(t, 0.3) },
  { label: "size 1.70x", band: "wrong-size", build: (t) => resize(t, 1.7) },
  { label: "wrong shape: circle", band: "wrong", build: (_t, id) => (id === "circle" ? null : otherShape(id, "circle")) },
  { label: "wrong shape: square", band: "wrong", build: (_t, id) => (id === "polygon-4" ? null : otherShape(id, "polygon-4")) },
];

// Deliberately spread across closed/open and simple/intricate, so a change
// cannot be tuned to one family of shapes.
export const SHAPE_IDS = ["circle", "polygon-4", "polygon-3", "star-5", "sym-heart", "crescent-moon", "alphabet-l", "alphabet-s", "food-apple", "ani-fish", "wave-2", "zigzag-4"];

export type Row = { shapeId: string; label: string; band: Band; total: number; shapeMatch: number; coverage: number; smoothness: number; scale: number };

export function runCalibration(): Row[] {
  const rows: Row[] = [];
  for (const shapeId of SHAPE_IDS) {
    const shape = getShapeById(shapeId);
    if (!shape) continue;
    const target = shape.generate(CANVAS_SIZE);
    for (const c of CASES) {
      const attempt = c.build(target, shapeId);
      if (!attempt) continue;
      const s = scoreAttempt(target, attempt);
      rows.push({ shapeId, label: c.label, band: c.band, total: s.total, shapeMatch: s.shapeMatch, coverage: s.coverage, smoothness: s.smoothness, scale: s.scale });
    }
  }
  return rows;
}

const BAND_ORDER: Band[] = ["near-perfect", "good", "mediocre", "local-defect", "distorted", "wrong", "natural-size", "off-size", "wrong-size"];

function summarise(rows: Row[]) {
  console.log("\nband                 n    total          shape          coverage  scale");
  console.log("-".repeat(78));
  for (const band of BAND_ORDER) {
    const inBand = rows.filter((r) => r.band === band);
    if (inBand.length === 0) continue;
    const stat = (pick: (r: Row) => number) => {
      const v = inBand.map(pick).sort((a, b) => a - b);
      const mean = v.reduce((s, x) => s + x, 0) / v.length;
      return { min: v[0], max: v[v.length - 1], mean };
    };
    const t = stat((r) => r.total);
    const sh = stat((r) => r.shapeMatch);
    const cv = stat((r) => r.coverage);
    const sc = stat((r) => r.scale);
    console.log(
      `${band.padEnd(20)} ${String(inBand.length).padStart(2)}   ` +
        `${t.mean.toFixed(1).padStart(5)} [${String(t.min).padStart(3)}-${String(t.max).padStart(3)}]   ` +
        `${sh.mean.toFixed(1).padStart(5)} [${String(sh.min).padStart(3)}-${String(sh.max).padStart(3)}]   ` +
        `${cv.mean.toFixed(0).padStart(3)}       ${sc.mean.toFixed(0).padStart(3)}`,
    );
  }
}

if (process.argv[1]?.includes("scoringCalibration")) {
  const rows = runCalibration();
  summarise(rows);

  if (process.argv.includes("--detail")) {
    console.log("\nper-case detail:");
    for (const shapeId of SHAPE_IDS) {
      const forShape = rows.filter((r) => r.shapeId === shapeId);
      if (!forShape.length) continue;
      console.log(`\n  ${shapeId}`);
      for (const r of forShape) {
        console.log(`    ${String(r.total).padStart(3)}  (shape ${String(r.shapeMatch).padStart(3)}, cov ${String(r.coverage).padStart(3)}, smo ${String(r.smoothness).padStart(3)}, scl ${String(r.scale).padStart(3)})  ${r.label}`);
      }
    }
  }

  // The headline problem: things a person would call clearly wrong that still score high.
  const suspicious = rows.filter((r) => (r.band === "local-defect" || r.band === "distorted" || r.band === "wrong") && r.total >= 80);
  console.log(`\n${suspicious.length} clearly-flawed attempts still scoring >= 80:`);
  for (const r of suspicious.slice(0, 25)) {
    console.log(`  ${String(r.total).padStart(3)}  (shape ${String(r.shapeMatch).padStart(3)}, scl ${String(r.scale).padStart(3)})  ${r.shapeId} - ${r.label}`);
  }
}
