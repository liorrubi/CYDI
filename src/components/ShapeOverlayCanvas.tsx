import { useEffect, useRef } from "react";
import type { DrawingPath } from "../types/Challenge";
import { CANVAS_SIZE, DEFAULT_PEN_COLOR, type PenColorId } from "../app/constants";
import { drawSegmentedStroke, drawSegmentedUserStroke } from "./DrawingCanvas";

/**
 * How the comparison is painted. `"light"` is the historical behaviour and the
 * default, so every existing caller is byte-identical; `"dark"` exists for one
 * surface only - the native Classic result stage - and is opted into there.
 */
export type OverlayVariant = "light" | "dark";

/* --------------------------------------------------------- dark palette ----
 * A canvas is painted with real pixels, so these have to be absolute values
 * rather than CSS custom properties. They are therefore declared ONCE here and
 * imported by anything that has to agree with them (the legend), so the swatch
 * a player reads can never drift from the line actually drawn.
 * ------------------------------------------------------------------------- */

/** The stage the drawing sits on in the dark variant. */
const DARK_STAGE = "#0f1018";

/**
 * The reference guide on the dark stage. 6.04:1 against the stage, and
 * deliberately desaturated so it never competes with a saturated pen - the dash
 * pattern is what separates guide from attempt, exactly as on the light stage.
 */
const DARK_TARGET = "#8b90ad";

/**
 * Mirrors the design system's dark `--color-text`. 16.68:1 on the stage.
 */
const DARK_INK = "#eef0fa";

/**
 * The ink a player's attempt is actually drawn in, or `null` to use the pen's
 * own colour path (which also covers the rainbow gradient).
 *
 * WHY `black` IS THE ONE EXCEPTION. It is `DEFAULT_PEN_COLOR` and its hex is
 * #1e202e, which measures **1.17:1** on the dark stage - the drawing would be
 * invisible for most players, since black is what you have before buying ink.
 * Every other pen reads BETTER on dark than on white (4.48:1 to 8.55:1), so all
 * five keep their real colour.
 *
 * This is a display remap on the dark result stage only. The saved/purchased
 * pen colour is untouched, and nothing about what the player draws during
 * gameplay changes.
 */
export function overlayInkOverride(variant: OverlayVariant, attemptColor: PenColorId): string | null {
  return variant === "dark" && attemptColor === "black" ? DARK_INK : null;
}

/**
 * The historical blue dashed guide on the white stage - unchanged, and the same
 * value DrawingCanvas uses for GHOST_STROKE_COLOR.
 */
const LIGHT_TARGET = "#2563eb";

/** The guide swatch colour for a given variant, so the legend matches the canvas. */
export function overlayTargetInk(variant: OverlayVariant): string {
  return variant === "dark" ? DARK_TARGET : LIGHT_TARGET;
}

type ShapeOverlayCanvasProps = {
  /** The reference shape drawn as a gray, semi-transparent guide behind the
   * attempt. OMIT it to render the player's attempt on its own - used by the
   * Artist Pack shared-result page, which must never show the guide. */
  target?: DrawingPath;
  attempt: DrawingPath;
  /** The pen color actually used to draw this attempt - never a fixed color, so the overlay always matches what the player saw on screen. */
  attemptColor?: PenColorId;
  width?: number;
  height?: number;
  /** Accessible description of what this comparison shows. Falls back to a
   * generic label based on whether a reference `target` is present - callers
   * pass a specific one where the two overlaid drawings aren't "reference vs
   * attempt" (e.g. the Draw-It-Back reply, which is sender vs recipient). */
  ariaLabel?: string;
  /** Paint on a dark stage instead of white. Defaults to the light behaviour. */
  variant?: OverlayVariant;
};

/** Static, non-interactive comparison of a target shape (gray, semi-transparent) and the player's attempt (in their actual pen color), overlaid. When `target` is omitted, only the attempt is drawn. */
export default function ShapeOverlayCanvas({
  target,
  attempt,
  attemptColor = DEFAULT_PEN_COLOR,
  width = CANVAS_SIZE,
  height = CANVAS_SIZE,
  ariaLabel,
  variant = "light",
}: ShapeOverlayCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    // See DrawingCanvas.redraw() for why this is a real pixel fill, not a CSS background.
    ctx.fillStyle = variant === "dark" ? DARK_STAGE : "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (target) {
      drawSegmentedStroke(ctx, target.points, target.breaks ?? [], overlayTargetInk(variant), {
        lineWidth: 6,
        dash: [12, 8],
      });
    }
    // The pen's own path is used unless the variant has to override it (see
    // overlayInkOverride) - that keeps the rainbow gradient working untouched.
    const inkOverride = overlayInkOverride(variant, attemptColor);
    if (inkOverride) {
      drawSegmentedStroke(ctx, attempt.points, attempt.breaks ?? [], inkOverride);
    } else {
      drawSegmentedUserStroke(ctx, attempt.points, attempt.breaks ?? [], attemptColor);
    }
  }, [target, attempt, attemptColor, width, height, variant]);

  // A static comparison image: role="img" + a label so screen readers announce
  // what the canvas conveys instead of skipping it as an unlabeled graphic.
  const label = ariaLabel ?? (target ? "Comparison of the reference drawing and the attempt drawing" : "The shared drawing");

  return (
    <div className="drawing-canvas-shell">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        role="img"
        aria-label={label}
        className={
          variant === "dark"
            ? "drawing-canvas drawing-canvas-disabled drawing-canvas-dark"
            : "drawing-canvas drawing-canvas-disabled"
        }
      />
    </div>
  );
}
