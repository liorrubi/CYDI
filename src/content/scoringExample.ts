/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// The worked scoring example shown on /how-to-play, and the illustration that
// goes with it (scripts/generateSeoShapeImages.ts renders the same two paths).
//
// Nothing here is invented or hand-written: the target is the real circle
// generator from the shape library, the attempt is a deterministic distortion of
// it, and the numbers quoted on the page come from running the game's own
// scoreAttempt() over the two. Change the scorer and the page changes with it -
// there is no stored copy of the result to go stale.
//
// The distortion is built from fixed sine terms rather than a random walk so the
// example is identical on every render and in the generated SVG: a drawing about
// 8% too small, slightly wider than it is tall, with a slow three-lobed waver and
// a fine tremor on top - i.e. what a decent freehand circle actually looks like.
//
// Worker-safe: imports only the shape library and the scorer, both of which the
// Worker already bundles for Play Together scoring (worker/roomDO.ts).

import { getShapeById } from "../engine/shapeLibrary";
import { scoreAttempt } from "../engine/scoring";
import type { DrawingPath } from "../types/Challenge";
import type { Point } from "../types/Point";
import type { ScoreBreakdown } from "../types/Score";

/** The shape the example uses - the first shape of the first category, and the one /draw-a-perfect-circle is about. */
export const EXAMPLE_SHAPE_ID = "circle";

/** Size the example is built at. Scoring normalizes scale away, so this only sets the coordinate space the SVG draws in. */
export const EXAMPLE_SIZE = 400;

export function exampleTarget(size = EXAMPLE_SIZE): DrawingPath {
  const shape = getShapeById(EXAMPLE_SHAPE_ID);
  if (!shape) throw new Error(`scoring example needs shape "${EXAMPLE_SHAPE_ID}"`);
  return shape.generate(size);
}

/**
 * The same circle, redrawn the way a hand redraws it: a little small, a little
 * oval, waver and tremor added as a function of the angle around the centre.
 */
export function exampleAttempt(size = EXAMPLE_SIZE): DrawingPath {
  const target = exampleTarget(size);
  const center = { x: size / 2, y: size / 2 };
  const points: Point[] = target.points.map((point) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const angle = Math.atan2(dy, dx);
    const radius = Math.hypot(dx, dy);
    const waver = 0.035 * Math.sin(3 * angle + 0.7) + 0.016 * Math.sin(7 * angle + 2.1);
    const tremor = 0.007 * Math.sin(23 * angle + 1.3);
    const scaled = radius * (0.92 + waver + tremor);
    return {
      // The 1.05 on x is the "wider than it is tall" part - an oval, not a circle.
      x: center.x + Math.cos(angle) * scaled * 1.05,
      y: center.y + Math.sin(angle) * scaled,
      t: point.t,
    };
  });
  return { ...target, points, breaks: target.breaks };
}

/** Computed once, by the real scorer, at module load. */
export const EXAMPLE_SCORE: ScoreBreakdown = scoreAttempt(exampleTarget(), exampleAttempt());
