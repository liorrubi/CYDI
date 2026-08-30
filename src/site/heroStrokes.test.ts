/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * The hero has to look like someone drawing, not like an SVG being revealed.
 * That comes down to three properties of the plan, all checked here against
 * real catalog shapes:
 *
 *   1. strokes never overlap in time - one finishes before the next starts,
 *   2. the pen lifts only where the shape genuinely lifts it,
 *   3. every stroke moves at the same speed, so a long edge takes longer.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { getShapeById } from "../content/contentRepository";
import {
  applyFit,
  fitTransform,
  planStrokes,
  polylineLength,
  splitStrokes,
  HERO_FIT,
  PEN_SPEED,
  STROKE_GAP_MS,
} from "./heroStrokes";
import { illustrativeRound } from "./illustrativeAttempts";
import { HERO_SHAPE_IDS } from "./siteShapes";
import type { DrawingPath } from "../types/Challenge";

function heroPlans() {
  return HERO_SHAPE_IDS.map(getShapeById)
    .filter((shape) => shape !== undefined)
    .map((shape) => ({ shape, plan: planStrokes(illustrativeRound(shape).steady.path) }));
}

test("every hero shape produces at least one stroke to draw", () => {
  const plans = heroPlans();
  assert.ok(plans.length > 0, "the hero needs shapes");
  for (const { shape, plan } of plans) {
    assert.ok(plan.strokes.length >= 1, `${shape.name} has nothing to draw`);
    assert.ok(plan.totalMs > 0, `${shape.name} takes no time to draw`);
  }
});

test("strokes are drawn one at a time, never simultaneously", () => {
  for (const { shape, plan } of heroPlans()) {
    for (let i = 1; i < plan.strokes.length; i++) {
      const previous = plan.strokes[i - 1];
      const current = plan.strokes[i];
      const previousEnd = previous.delayMs + previous.durationMs;
      assert.ok(
        current.delayMs >= previousEnd,
        `${shape.name}: stroke ${i} starts at ${current.delayMs}ms, before stroke ${i - 1} ends at ${previousEnd}ms`,
      );
    }
  }
});

test("consecutive strokes are separated by a real pause", () => {
  for (const { shape, plan } of heroPlans()) {
    for (let i = 1; i < plan.strokes.length; i++) {
      const gap = plan.strokes[i].delayMs - (plan.strokes[i - 1].delayMs + plan.strokes[i - 1].durationMs);
      assert.equal(Math.round(gap), STROKE_GAP_MS, `${shape.name}: gap before stroke ${i}`);
    }
  }
});

test("the pen lifts exactly where the shape's own breaks say it does", () => {
  for (const { shape } of heroPlans()) {
    const path = illustrativeRound(shape).steady.path;
    const expected = (path.breaks?.length ?? 0) + 1;
    // Single-point fragments are dropped, so this is an upper bound, never more.
    assert.ok(
      splitStrokes(path).length <= expected,
      `${shape.name} invented a pen lift`,
    );
    if ((path.breaks?.length ?? 0) === 0) {
      assert.equal(splitStrokes(path).length, 1, `${shape.name} is one continuous stroke and must stay one`);
    }
  }
});

test("a longer stroke takes proportionally longer - one constant pen speed", () => {
  for (const { shape, plan } of heroPlans()) {
    for (const stroke of plan.strokes) {
      const expected = (stroke.length / PEN_SPEED) * 1000;
      // Short strokes are floored so they stay visible; everything else is exact.
      if (expected >= 180) {
        assert.ok(
          Math.abs(stroke.durationMs - expected) < 1,
          `${shape.name}: ${Math.round(stroke.durationMs)}ms for ${Math.round(stroke.length)} units`,
        );
      }
    }
  }
});

test("the total is the strokes plus the pauses between them, and nothing else", () => {
  for (const { shape, plan } of heroPlans()) {
    const drawing = plan.strokes.reduce((sum, s) => sum + s.durationMs, 0);
    const pauses = Math.max(0, plan.strokes.length - 1) * STROKE_GAP_MS;
    assert.ok(Math.abs(plan.totalMs - (drawing + pauses)) < 1, `${shape.name} total`);
  }
});

test("polylineLength measures the line, not the point count", () => {
  const square = [
    { x: 0, y: 0, t: 0 },
    { x: 10, y: 0, t: 1 },
    { x: 10, y: 10, t: 2 },
  ];
  assert.equal(polylineLength(square), 20);
  assert.equal(polylineLength([{ x: 3, y: 4, t: 0 }]), 0);
});

test("a multi-part shape really is drawn as several strokes", () => {
  // The house has a door as a separate part - the clearest case of a real pen
  // lift in the hero set. If the catalog ever makes it one stroke, this tells us.
  const house = getShapeById("home-house");
  assert.ok(house, "home-house should exist in the catalog");
  const plan = planStrokes(illustrativeRound(house).steady.path);
  assert.ok(plan.strokes.length > 1, "the house is drawn in more than one stroke");
  assert.ok(plan.strokes[1].delayMs > plan.strokes[0].durationMs, "its second stroke waits for the first");
});

// ------------------------------------------------------------ framing ------

function boundsOf(paths: DrawingPath[]) {
  const xs = paths.flatMap((p) => p.points.map((q) => q.x));
  const ys = paths.flatMap((p) => p.points.map((q) => q.y));
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** An ellipse of any proportions, anywhere in coordinate space. */
function ellipse(w: number, h: number, ox: number, oy: number): DrawingPath {
  const points = Array.from({ length: 41 }, (_, i) => {
    const a = (i / 40) * Math.PI * 2;
    return { x: ox + w / 2 + (Math.cos(a) * w) / 2, y: oy + h / 2 + (Math.sin(a) * h) / 2, t: i };
  });
  return { points, canvasWidth: 999, canvasHeight: 999 };
}

function framed(shapeId: string) {
  const shape = getShapeById(shapeId);
  assert.ok(shape, `${shapeId} should exist`);
  const round = illustrativeRound(shape);
  const fit = fitTransform([round.target, round.steady.path]);
  return { target: applyFit(round.target, fit), attempt: applyFit(round.steady.path, fit), fit };
}

test("every hero shape is centred in the canvas", () => {
  const centre = HERO_FIT.canvas / 2;
  for (const id of HERO_SHAPE_IDS) {
    if (!getShapeById(id)) continue;
    const { target, attempt } = framed(id);
    const b = boundsOf([target, attempt]);
    assert.ok(Math.abs((b.minX + b.maxX) / 2 - centre) < 0.5, `${id} horizontal centre`);
    assert.ok(Math.abs((b.minY + b.maxY) / 2 - centre) < 0.5, `${id} vertical centre`);
  }
});

test("every hero shape fills 65-75% of the canvas on its larger dimension", () => {
  for (const id of HERO_SHAPE_IDS) {
    if (!getShapeById(id)) continue;
    const { target, attempt } = framed(id);
    const b = boundsOf([target, attempt]);
    const fill = Math.max(b.maxX - b.minX, b.maxY - b.minY) / HERO_FIT.canvas;
    assert.ok(fill >= 0.65 && fill <= 0.75, `${id} fills ${(fill * 100).toFixed(0)}%`);
  }
});

test("nothing reaches the canvas edge - padding always holds", () => {
  for (const id of HERO_SHAPE_IDS) {
    if (!getShapeById(id)) continue;
    const { target, attempt } = framed(id);
    const b = boundsOf([target, attempt]);
    const clearance = Math.min(b.minX, b.minY, HERO_FIT.canvas - b.maxX, HERO_FIT.canvas - b.maxY);
    assert.ok(clearance >= HERO_FIT.padding, `${id} comes within ${clearance.toFixed(1)} of the edge`);
  }
});

test("the target and the attempt share one transform, so the shape never jumps", () => {
  for (const id of HERO_SHAPE_IDS) {
    const shape = getShapeById(id);
    if (!shape) continue;
    const round = illustrativeRound(shape);
    const fit = fitTransform([round.target, round.steady.path]);
    // Fitting either one alone would give a different frame; the round is fitted
    // as a whole precisely so See, Draw and Score are identically composed.
    const target = applyFit(round.target, fit);
    const attempt = applyFit(round.steady.path, fit);
    const both = boundsOf([target, attempt]);
    assert.ok(both.minX >= 0 && both.minY >= 0, `${id} attempt escapes the canvas`);
    assert.ok(both.maxX <= HERO_FIT.canvas && both.maxY <= HERO_FIT.canvas, `${id} attempt overflows`);
  }
});

test("aspect ratio is preserved - the fit only ever scales uniformly", () => {
  for (const id of HERO_SHAPE_IDS) {
    const shape = getShapeById(id);
    if (!shape) continue;
    const round = illustrativeRound(shape);
    const before = boundsOf([round.target]);
    const after = boundsOf([applyFit(round.target, fitTransform([round.target, round.steady.path]))]);
    const ratioBefore = (before.maxX - before.minX) / (before.maxY - before.minY);
    const ratioAfter = (after.maxX - after.minX) / (after.maxY - after.minY);
    assert.ok(Math.abs(ratioBefore - ratioAfter) < 0.001, `${id} was distorted`);
  }
});

test("extreme proportions and unusual native coordinates are handled generically", () => {
  const centre = HERO_FIT.canvas / 2;
  const cases: [string, DrawingPath][] = [
    ["very wide", ellipse(400, 40, 900, -300)],
    ["very tall", ellipse(30, 500, -700, 50)],
    ["tiny", ellipse(2, 2, 0, 0)],
    ["negative space", ellipse(120, 90, -5000, -5000)],
  ];
  for (const [label, path] of cases) {
    const b = boundsOf([applyFit(path, fitTransform([path]))]);
    const fill = Math.max(b.maxX - b.minX, b.maxY - b.minY) / HERO_FIT.canvas;
    assert.ok(fill >= 0.65 && fill <= 0.75, `${label} fills ${(fill * 100).toFixed(0)}%`);
    assert.ok(Math.abs((b.minX + b.maxX) / 2 - centre) < 0.5, `${label} horizontal centre`);
    assert.ok(Math.abs((b.minY + b.maxY) / 2 - centre) < 0.5, `${label} vertical centre`);
    const clearance = Math.min(b.minX, b.minY, HERO_FIT.canvas - b.maxX, HERO_FIT.canvas - b.maxY);
    assert.ok(clearance >= HERO_FIT.padding, `${label} clearance ${clearance.toFixed(1)}`);
  }
});

test("a degenerate path does not divide by zero", () => {
  const dot: DrawingPath = {
    points: [
      { x: 7, y: 7, t: 0 },
      { x: 7, y: 7, t: 1 },
    ],
    canvasWidth: 100,
    canvasHeight: 100,
  };
  const fit = fitTransform([dot]);
  assert.ok(Number.isFinite(fit.scale) && Number.isFinite(fit.tx) && Number.isFinite(fit.ty));
  const b = boundsOf([applyFit(dot, fit)]);
  assert.equal(Math.round(b.minX), HERO_FIT.canvas / 2);
});

test("stroke timing is measured on the FITTED coordinates, not the native ones", () => {
  const shape = getShapeById("univ-compass");
  assert.ok(shape);
  const round = illustrativeRound(shape);
  const fit = fitTransform([round.target, round.steady.path]);
  const nativeMs = planStrokes(round.steady.path).totalMs;
  const fittedMs = planStrokes(applyFit(round.steady.path, fit)).totalMs;
  // The fit scales the geometry up, so the drawing genuinely takes longer -
  // if these were equal the pen speed would differ between shapes on screen.
  assert.ok(fittedMs > nativeMs, "fitted drawing should take longer than the unscaled one");
  assert.ok(Math.abs(fittedMs / nativeMs - fit.scale) < 0.05, "duration should scale with the geometry");
});
