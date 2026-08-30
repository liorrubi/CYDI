/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * 3a's hero: real catalog shapes taking turns, each one played through the
 * actual CYDI loop rather than merely revealed.
 *
 *   See       the real target is shown, as a quiet guide
 *   Remember  it disappears completely, and nothing is on the canvas
 *   Draw      only then does an illustrative attempt draw itself, stroke by
 *             stroke, in the catalog's own drawing order
 *   Score     the guide returns over the finished drawing with its score
 *
 * The attempt and its score come from illustrativeAttempts.ts, so the number
 * shown is what the game's own scorer returns for the line you just watched
 * being drawn. Nothing here starts a round, writes anything, or claims a
 * duration: the pacing is a demonstration of the loop, not of Classic's clock.
 *
 * Rotation is presentation only. It reads the catalog through
 * contentRepository and scores through the engine, exactly as a test would.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import HeroDrawing, { type HeroPhase } from "./HeroDrawing";
import { applyFit, fitTransform, planStrokes, HERO_FIT } from "./heroStrokes";
import { illustrativeRound } from "./illustrativeAttempts";
import { HERO_SHAPE_IDS, resolveSiteShapesOrFirst } from "./siteShapes";

/**
 * The hero's coordinate space. The catalog generates each shape into its own
 * box, and rarely fills it - so the geometry is refitted to this canvas rather
 * than assumed to match it (see fitTransform).
 */
const HERO_SIZE = HERO_FIT.canvas;

/**
 * How long each phase holds. Deliberately unhurried - the point is that a
 * viewer registers the shape, notices it go, and then watches a hand work.
 * `draw` is not here: it lasts exactly as long as the strokes take.
 */
const PHASE_MS: Record<Exclude<HeroPhase, "draw">, number> = {
  see: 1600,
  remember: 900,
  score: 2000,
};

/** Held on one shape when the visitor has asked for less motion. */
const STILL_HOLD_MS = 5000;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function useHeroShapes(count = 8) {
  return useMemo(() => resolveSiteShapesOrFirst(HERO_SHAPE_IDS, count), [count]);
}

type RotatingHeroShapeProps = {
  count?: number;
  /** Rendered under the drawing: name, category and position dots. */
  showCaption?: boolean;
  /**
   * Reports the phase on screen, so the card's existing See -> Remember -> Draw
   * -> Score rule row can track it. That row is part of the approved layout;
   * this component does not add a second one.
   */
  onPhaseChange?: (phase: HeroPhase) => void;
};

export default function RotatingHeroShape({ count = 8, showCaption = true, onPhaseChange }: RotatingHeroShapeProps) {
  const shapes = useHeroShapes(count);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<HeroPhase>("see");
  const still = useRef(prefersReducedMotion()).current;

  const current = shapes[index % Math.max(1, shapes.length)];

  // The attempt, its strokes and its score are all fixed per shape, so this
  // recomputes only when the hero moves on.
  const round = useMemo(() => (current ? illustrativeRound(current.shape) : null), [current]);

  /**
   * ONE transform for the whole round. The target and the attempt are fitted
   * together, from the union of their bounds, so the shape is framed identically
   * in every phase - it cannot jump, resize or shift as the hero moves from See
   * to Remember to Draw to Score, and the attempt cannot wander out of frame.
   * Strokes are then planned on the FITTED attempt, so the pen speed is measured
   * in the coordinates actually drawn.
   */
  const framed = useMemo(() => {
    if (!round) return null;
    const fit = fitTransform([round.target, round.steady.path]);
    const target = applyFit(round.target, fit);
    const attempt = applyFit(round.steady.path, fit);
    return { target, plan: planStrokes(attempt) };
  }, [round]);

  const plan = framed?.plan ?? { strokes: [], totalMs: 0 };

  /**
   * One timer at a time, re-armed on each phase change. Timeouts rather than an
   * interval because the draw phase's length depends on the shape - a shape with
   * more line in it genuinely takes longer to draw.
   */
  useEffect(() => {
    if (!current) return;

    if (still) {
      // No stroke animation: rest on the finished result and move on slowly.
      if (phase !== "score") {
        setPhase("score");
        return;
      }
      const timer = window.setTimeout(() => {
        setIndex((i) => (i + 1) % shapes.length);
      }, STILL_HOLD_MS);
      return () => window.clearTimeout(timer);
    }

    const hold = phase === "draw" ? plan.totalMs + 200 : PHASE_MS[phase];
    const timer = window.setTimeout(() => {
      if (phase === "see") setPhase("remember");
      else if (phase === "remember") setPhase("draw");
      else if (phase === "draw") setPhase("score");
      else setIndex((i) => (i + 1) % shapes.length);
    }, hold);
    return () => window.clearTimeout(timer);
  }, [phase, plan.totalMs, current, shapes.length, still]);

  // A new shape always starts the loop again from the beginning.
  useEffect(() => {
    if (!still) setPhase("see");
  }, [index, still]);

  useEffect(() => {
    onPhaseChange?.(phase);
  }, [phase, onPhaseChange]);

  if (!current || !round || !framed) return null;

  return (
    <>
      <div className={`site-canvas site-canvas-square site-hero-canvas site-hero-phase-${phase}`}>
        <HeroDrawing
          size={HERO_SIZE}
          target={framed.target}
          strokes={plan.strokes}
          phase={phase}
          runKey={`${current.shape.id}-${phase}`}
          still={still}
        />
        {/* The result, revealed with the finished drawing - the real score for
            the exact line that was just drawn. */}
        <span className={phase === "score" ? "site-hero-score site-hero-score-on" : "site-hero-score"}>
          {round.steady.score}%
        </span>
      </div>

      {showCaption && (
        <div className="site-paper-foot">
            <strong className="site-paper-name">{current.shape.name}</strong>
            {current.categoryName && <span className="site-paper-category">{current.categoryName}</span>}
            <span className="site-hero-dots" aria-hidden="true">
              {shapes.map((entry, i) => (
                <span
                  key={entry.shape.id}
                  className={i === index ? "site-hero-dot site-hero-dot-active" : "site-hero-dot"}
                />
              ))}
          </span>
        </div>
      )}
    </>
  );
}
