/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * The hero's demonstration of a CYDI round: a real catalog shape shown, taken
 * away, redrawn from memory, then scored.
 *
 * WHY THIS IS NOT SiteShape. The ordinary shape renderer animates every
 * polyline at once, which reads as an SVG being revealed rather than a person
 * drawing. Here each stroke is drawn in sequence, one growing from its own
 * endpoint, at a roughly constant pen speed - so a long edge genuinely takes
 * longer than a short one. The pen only lifts where the shape really lifts it:
 * strokes are split on the path's own `breaks`, and the order is the catalog
 * generator's own point order, which is the order the game itself treats as the
 * shape's drawing order. Nothing about the geometry is invented.
 *
 * It is a marketing demonstration of the loop, not a claim about Classic's
 * timings - no duration is stated anywhere on the page.
 *
 * Web-only, presentation-only: it draws two paths and reads no state.
 */
import { splitStrokes, type Stroke } from "./heroStrokes";
import type { DrawingPath } from "../types/Challenge";
import type { Point } from "../types/Point";

function toPoints(points: Point[]): string {
  return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

export type { Stroke };

export type HeroPhase = "see" | "remember" | "draw" | "score";

type HeroDrawingProps = {
  size: number;
  /** The catalog shape, drawn as the quiet guide. */
  target: DrawingPath;
  /** The illustrative attempt, already planned into ordered strokes. */
  strokes: Stroke[];
  phase: HeroPhase;
  /** Restarts the stroke animations when the shape or the phase changes. */
  runKey: string;
  /** Draw everything at once, statically - for reduced-motion. */
  still: boolean;
};

export default function HeroDrawing({
  size,
  target,
  strokes,
  phase,
  runKey,
  still,
}: HeroDrawingProps) {
  // The guide is present while you are looking at it, and again beside your
  // drawing at the end - which is exactly when the game shows it too.
  const showTarget = phase === "see" || phase === "score";
  const showAttempt = phase === "draw" || phase === "score";
  // Only the drawing phase animates; by the score phase the line is simply there.
  const animating = phase === "draw" && !still;

  return (
    <svg
      className="site-hero-svg"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="A shape is shown, hidden, then redrawn from memory and scored"
    >
      <g className={showTarget ? "site-hero-target site-hero-target-on" : "site-hero-target"}>
        {splitStrokes(target).map((points, i) => (
          <polyline
            key={i}
            points={toPoints(points)}
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </g>

      {showAttempt && (
        <g className="site-hero-attempt" key={runKey}>
          {strokes.map((stroke, i) => (
            <polyline
              key={i}
              points={toPoints(stroke.points)}
              fill="none"
              stroke="currentColor"
              strokeWidth={5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className={animating ? "site-hero-stroke site-hero-stroke-drawing" : "site-hero-stroke"}
              style={
                animating
                  ? ({
                      // Dash length in real viewBox units, so the stroke grows
                      // from its own endpoint at the same speed as every other.
                      "--stroke-len": stroke.length.toFixed(1),
                      animationDuration: `${Math.round(stroke.durationMs)}ms`,
                      animationDelay: `${Math.round(stroke.delayMs)}ms`,
                    } as React.CSSProperties)
                  : undefined
              }
            />
          ))}
        </g>
      )}
    </svg>
  );
}
