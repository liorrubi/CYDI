/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Audits the Play Together shape pools against the 20-second drawing window.
//
//   node --import ./scripts/register-ts.mjs scripts/auditMultiplayerPools.ts
//   node --import ./scripts/register-ts.mjs scripts/auditMultiplayerPools.ts --tier hard
//
// The question this answers is NOT "is this shape hard" - the tiers already
// encode that - but "can a good player produce a meaningful attempt at it from
// memory inside 20 seconds". Those are different: a shape can be difficult
// (which is the point of Hard) yet still drawable, or it can be so long and
// so fragmented that the clock, not the difficulty, decides the score.
//
// The time estimate below is a MODEL, not a measurement. It exists to rank
// shapes and surface outliers for a human to look at, not to be authoritative.
import { CANVAS_SIZE } from "../src/app/constants.ts";
import { getShapeById, SHAPE_LIBRARY } from "../src/engine/shapeLibrary.ts";
import { difficultyForShape, poolFor } from "../src/multiplayer/difficultyPool.ts";
import type { DrawingPath } from "../src/types/Challenge.ts";
import type { Point } from "../src/types/Point.ts";

/**
 * Rough drawing-time model, in seconds.
 *
 * Three terms, because three things actually consume the clock:
 *   - a fixed beat to orient yourself and decide where to start;
 *   - the ink itself, at a finger-drawing pace;
 *   - a penalty per separate piece, which is the expensive one - every lift
 *     means repositioning and re-judging placement relative to what you have
 *     already drawn, and placement errors are what cost accuracy.
 *
 * The constants are deliberately generous to the player (a fast, confident
 * drawer), so anything this model still calls slow is genuinely slow.
 */
const ORIENT_SECONDS = 1.0;
const PIXELS_PER_SECOND = 340;
const SECONDS_PER_EXTRA_PART = 1.1;

const DRAWING_WINDOW_SECONDS = 20;

type Metrics = { parts: number; arcLengthPx: number; corners: number; turningDeg: number; estSeconds: number };

function segments(path: DrawingPath): Point[][] {
  const breaks = path.breaks ?? [];
  if (breaks.length === 0) return path.points.length > 1 ? [path.points] : [];
  const out: Point[][] = [];
  let start = 0;
  for (const b of breaks) {
    if (b > start) out.push(path.points.slice(start, b));
    start = b;
  }
  out.push(path.points.slice(start));
  return out.filter((s) => s.length > 1);
}

function measure(path: DrawingPath): Metrics {
  const segs = segments(path);
  let arcLengthPx = 0;
  let corners = 0;
  let turningDeg = 0;
  for (const seg of segs) {
    for (let i = 1; i < seg.length; i++) arcLengthPx += Math.hypot(seg[i].x - seg[i - 1].x, seg[i].y - seg[i - 1].y);
    for (let i = 1; i < seg.length - 1; i++) {
      const v1 = { x: seg[i].x - seg[i - 1].x, y: seg[i].y - seg[i - 1].y };
      const v2 = { x: seg[i + 1].x - seg[i].x, y: seg[i + 1].y - seg[i].y };
      const m1 = Math.hypot(v1.x, v1.y);
      const m2 = Math.hypot(v2.x, v2.y);
      if (m1 < 1e-9 || m2 < 1e-9) continue;
      const deg = (Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (m1 * m2)))) * 180) / Math.PI;
      turningDeg += deg;
      if (deg > 60) corners++;
    }
  }
  const parts = Math.max(1, segs.length);
  const estSeconds = ORIENT_SECONDS + arcLengthPx / PIXELS_PER_SECOND + (parts - 1) * SECONDS_PER_EXTRA_PART;
  return { parts, arcLengthPx, corners, turningDeg, estSeconds };
}

export type AuditRow = { id: string; name: string; category: string; tier: string } & Metrics;

export function auditPools(): AuditRow[] {
  const rows: AuditRow[] = [];
  for (const tier of ["easy", "medium", "hard"] as const) {
    for (const id of poolFor(tier)) {
      const shape = getShapeById(id);
      if (!shape) continue;
      rows.push({ id, name: shape.name, category: shape.category, tier, ...measure(shape.generate(CANVAS_SIZE)) });
    }
  }
  return rows;
}

/** Estimated drawing time past which a round is decided by the clock rather than by skill. */
export const SLOW_SECONDS = 15;
/** Separate pieces past which recalling WHERE each one goes, after a 3-second look, dominates the task. */
export const MANY_PARTS = 10;

/**
 * The two independent signals that a shape is impractical rather than merely
 * hard, reported separately so the reason is always legible.
 *
 * The thresholds sit far above "difficult" on purpose: the Hard pool's median
 * is about 10 seconds across 6 parts, and all of that is perfectly drawable.
 * An earlier, tighter version of this flagged 47 shapes, almost all of them on
 * a part count that turned out to be fine - Hard is *supposed* to have many
 * parts. These catch only the tail.
 */
export function concerns(row: AuditRow): string[] {
  const out: string[] = [];
  if (row.estSeconds > SLOW_SECONDS) out.push(`slow (~${row.estSeconds.toFixed(1)}s)`);
  if (row.parts >= MANY_PARTS) out.push(`${row.parts} separate parts`);
  return out;
}

/**
 * Whether a shape should be kept out of Play Together altogether.
 *
 * The CONJUNCTION, deliberately: either signal alone still describes a
 * legitimately hard shape. Only a drawing that is both long AND highly
 * fragmented leaves a good player unable to produce a meaningful attempt inside
 * the window - and when this was measured, both signals independently picked
 * out exactly the same five shapes.
 */
export function shouldExclude(row: AuditRow): boolean {
  return row.estSeconds > SLOW_SECONDS && row.parts >= MANY_PARTS;
}

if (process.argv[1]?.includes("auditMultiplayerPools")) {
  const rows = auditPools();
  const only = process.argv.includes("--tier") ? process.argv[process.argv.indexOf("--tier") + 1] : null;

  console.log(`library: ${SHAPE_LIBRARY.length} shapes;  pools: ${rows.length}\n`);
  console.log("tier     n    est. seconds to draw            parts        line px       corners");
  console.log("-".repeat(88));
  for (const tier of ["easy", "medium", "hard"] as const) {
    const t = rows.filter((r) => r.tier === tier);
    const stat = (pick: (r: AuditRow) => number) => {
      const v = t.map(pick).sort((a, b) => a - b);
      return { p50: v[Math.floor(v.length * 0.5)], p90: v[Math.floor(v.length * 0.9)], max: v[v.length - 1] };
    };
    const s = stat((r) => r.estSeconds);
    const p = stat((r) => r.parts);
    const l = stat((r) => r.arcLengthPx);
    const c = stat((r) => r.corners);
    console.log(
      `${tier.padEnd(8)} ${String(t.length).padStart(2)}   ` +
        `med ${s.p50.toFixed(1)}  p90 ${s.p90.toFixed(1)}  max ${s.max.toFixed(1)}   ` +
        `${p.p50}/${p.p90}/${p.max}    ${Math.round(l.p50)}/${Math.round(l.p90)}/${Math.round(l.max)}   ${c.p50}/${c.p90}/${c.max}`,
    );
  }

  const flagged = rows.filter((r) => concerns(r).length > 0).sort((a, b) => b.estSeconds - a.estSeconds);
  console.log(`\n${flagged.length} shapes showing a concern for a ${DRAWING_WINDOW_SECONDS}s round (${flagged.filter(shouldExclude).length} on BOTH counts):\n`);
  for (const r of flagged) {
    if (only && r.tier !== only) continue;
    console.log(`  ${shouldExclude(r) ? "EXCLUDE" : "       "} [${r.tier.padEnd(6)}] ${r.name.padEnd(22)} ${r.id.padEnd(22)} ${concerns(r).join(", ")}`);
  }

  console.log("\nslowest 20 in the HARD pool (the tier most at risk):");
  for (const r of rows.filter((r) => r.tier === "hard").sort((a, b) => b.estSeconds - a.estSeconds).slice(0, 20)) {
    console.log(
      `  ~${r.estSeconds.toFixed(1)}s  parts ${String(r.parts).padStart(2)}  line ${String(Math.round(r.arcLengthPx)).padStart(4)}px  corners ${String(r.corners).padStart(2)}   ${r.name} (${r.id})`,
    );
  }

  console.log("\ncurrent effective distribution:");
  for (const tier of ["easy", "medium", "hard"] as const) {
    console.log(`  ${tier.padEnd(8)} ${poolFor(tier).length}`);
  }
  const unrated = SHAPE_LIBRARY.filter((s) => !["easy", "medium", "hard"].includes(difficultyForShape(s.id)));
  if (unrated.length) console.log(`  UNRATED  ${unrated.length}`);
}
