/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// CLI: derives a per-shape tracing-difficulty tier for Play Together, from the
// SHAPE GEOMETRY itself, and writes it to a committed table.
//
//   npm run shape-difficulty            -> src/multiplayer/shapeDifficultyTable.ts
//   npm run shape-difficulty -- --report   (print the distribution, write nothing)
//
// Why generated and not hand-tagged: the game has no per-shape difficulty
// rating at all (the "difficulty" the player picks in Settings is a PASS-SCORE
// threshold, not a property of any shape), and hand-tagging ~280 shapes is both
// slow and inconsistent. So the tier is computed, committed as data, and then
// hand-correctable: any id listed in DIFFICULTY_OVERRIDES (src/multiplayer/
// difficultyPool.ts) wins over the computed value and survives regeneration,
// because this script never writes that file.
//
// The four signals, all measured on the authored path at CANVAS_SIZE:
//   parts      - disconnected pieces (breaks + 1). Lifting the pen and
//                re-registering somewhere else is the single biggest jump in
//                how hard a shape is to reproduce from memory.
//   turning    - total absolute direction change in degrees. A circle is 360;
//                a star or a filigree is many times that. The best single
//                proxy for "intricate".
//   arcLength  - total drawn length in canvas widths. Long paths are more to
//                remember and more to get wrong.
//   corners    - direction changes sharper than 60 deg, i.e. deliberate
//                vertices rather than smooth curvature.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CANVAS_SIZE } from "../src/app/constants.ts";
import { SHAPE_LIBRARY } from "../src/engine/shapeLibrary.ts";
import type { DrawingPath } from "../src/types/Challenge.ts";
import type { Point } from "../src/types/Point.ts";

type Metrics = { parts: number; turning: number; arcLength: number; corners: number };

/** Splits at `breaks` so no measurement ever crosses the invisible jump between two disconnected parts. */
function segments(path: DrawingPath): Point[][] {
  const breaks = path.breaks ?? [];
  if (breaks.length === 0) return path.points.length > 0 ? [path.points] : [];
  const out: Point[][] = [];
  let start = 0;
  for (const b of breaks) {
    out.push(path.points.slice(start, b));
    start = b;
  }
  out.push(path.points.slice(start));
  return out.filter((s) => s.length > 1);
}

function measure(path: DrawingPath): Metrics {
  const segs = segments(path);
  const size = path.canvasWidth || CANVAS_SIZE;
  let turning = 0;
  let arcLength = 0;
  let corners = 0;

  for (const seg of segs) {
    for (let i = 1; i < seg.length; i++) {
      arcLength += Math.hypot(seg[i].x - seg[i - 1].x, seg[i].y - seg[i - 1].y);
    }
    for (let i = 1; i < seg.length - 1; i++) {
      const v1 = { x: seg[i].x - seg[i - 1].x, y: seg[i].y - seg[i - 1].y };
      const v2 = { x: seg[i + 1].x - seg[i].x, y: seg[i + 1].y - seg[i].y };
      const m1 = Math.hypot(v1.x, v1.y);
      const m2 = Math.hypot(v2.x, v2.y);
      if (m1 < 1e-9 || m2 < 1e-9) continue;
      const dot = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (m1 * m2)));
      const deg = (Math.acos(dot) * 180) / Math.PI;
      turning += deg;
      if (deg > 60) corners++;
    }
  }

  return { parts: Math.max(1, segs.length), turning, arcLength: arcLength / size, corners };
}

/** Squashes an unbounded positive measurement into 0..1 with diminishing returns, so one extreme outlier can't dominate the blend. */
function soft(value: number, midpoint: number): number {
  return value <= 0 ? 0 : value / (value + midpoint);
}

// Midpoints are the rough "typical" value of each signal across the library -
// a shape sitting exactly at all four scores 0.5. Weights say how much each
// signal matters; parts and turning lead deliberately (see the header).
const WEIGHTS = { parts: 0.3, turning: 0.35, arcLength: 0.2, corners: 0.15 } as const;
const MIDPOINTS = { parts: 2.5, turning: 900, arcLength: 3.0, corners: 8 } as const;

function complexity(m: Metrics): number {
  return (
    WEIGHTS.parts * soft(m.parts - 1, MIDPOINTS.parts) +
    WEIGHTS.turning * soft(m.turning, MIDPOINTS.turning) +
    WEIGHTS.arcLength * soft(m.arcLength, MIDPOINTS.arcLength) +
    WEIGHTS.corners * soft(m.corners, MIDPOINTS.corners)
  );
}

const rows = SHAPE_LIBRARY.map((shape) => {
  const metrics = measure(shape.generate(CANVAS_SIZE));
  return { id: shape.id, name: shape.name, category: shape.category, metrics, score: complexity(metrics) };
}).sort((a, b) => a.score - b.score);

// Terciles rather than fixed score cutoffs: the tiers must stay balanced as
// shapes are added or reworked, and "hard" only means anything relative to the
// rest of the library.
const third = Math.floor(rows.length / 3);
const easyMax = rows[third - 1].score;
const mediumMax = rows[third * 2 - 1].score;
const tierOf = (score: number): "easy" | "medium" | "hard" => (score <= easyMax ? "easy" : score <= mediumMax ? "medium" : "hard");

if (process.argv.includes("--report")) {
  const byTier: Record<string, typeof rows> = { easy: [], medium: [], hard: [] };
  for (const r of rows) byTier[tierOf(r.score)].push(r);
  for (const tier of ["easy", "medium", "hard"] as const) {
    const list = byTier[tier];
    console.log(`\n=== ${tier.toUpperCase()} (${list.length}) score ${list[0].score.toFixed(3)}..${list[list.length - 1].score.toFixed(3)}`);
    console.log("  first 6:", list.slice(0, 6).map((r) => r.name).join(", "));
    console.log("  last  6:", list.slice(-6).map((r) => r.name).join(", "));
  }
  process.exit(0);
}

const lines = rows
  .slice()
  .sort((a, b) => a.id.localeCompare(b.id))
  .map((r) => {
    const m = r.metrics;
    const detail = `parts=${m.parts} turn=${Math.round(m.turning)} len=${m.arcLength.toFixed(1)} corners=${m.corners} score=${r.score.toFixed(3)}`;
    return `  "${r.id}": "${tierOf(r.score)}", // ${detail}`;
  });

const out = `/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// GENERATED FILE - DO NOT EDIT BY HAND.
// Regenerate with: npm run shape-difficulty
//
// Per-shape tracing difficulty for Play Together, derived from shape geometry
// (parts / total turning / arc length / corner count) and split into terciles
// across the whole library. See scripts/generateShapeDifficulty.ts.
//
// To correct a shape that lands in the wrong tier, DO NOT edit this file -
// add it to DIFFICULTY_OVERRIDES in src/multiplayer/difficultyPool.ts, which
// wins over this table and survives regeneration.
//
// Generated from ${rows.length} shapes. Tercile cuts: easy <= ${easyMax.toFixed(3)} < medium <= ${mediumMax.toFixed(3)} < hard.

export type ShapeDifficultyTier = "easy" | "medium" | "hard";

export const GENERATED_SHAPE_DIFFICULTY: Readonly<Record<string, ShapeDifficultyTier>> = {
${lines.join("\n")}
};
`;

const target = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "multiplayer", "shapeDifficultyTable.ts");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, out, "utf8");

const counts = { easy: 0, medium: 0, hard: 0 };
for (const r of rows) counts[tierOf(r.score)]++;
console.log(`wrote ${target}`);
console.log(`shapes=${rows.length} easy=${counts.easy} medium=${counts.medium} hard=${counts.hard}`);
console.log(`cuts: easy<=${easyMax.toFixed(3)} medium<=${mediumMax.toFixed(3)}`);
