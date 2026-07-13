import { useEffect, useRef } from "react";
import type { DrawingPath } from "../types/Challenge";
import { CANVAS_SIZE, DEFAULT_PEN_COLOR, type PenColorId } from "../app/constants";
import { drawSegmentedStroke, drawSegmentedUserStroke } from "./DrawingCanvas";

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
};

/** Static, non-interactive comparison of a target shape (gray, semi-transparent) and the player's attempt (in their actual pen color), overlaid. When `target` is omitted, only the attempt is drawn. */
export default function ShapeOverlayCanvas({
  target,
  attempt,
  attemptColor = DEFAULT_PEN_COLOR,
  width = CANVAS_SIZE,
  height = CANVAS_SIZE,
  ariaLabel,
}: ShapeOverlayCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    // See DrawingCanvas.redraw() for why this is a real pixel fill, not a CSS background.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (target) {
      drawSegmentedStroke(ctx, target.points, target.breaks ?? [], "#2563eb", { lineWidth: 6, dash: [12, 8] });
    }
    drawSegmentedUserStroke(ctx, attempt.points, attempt.breaks ?? [], attemptColor);
  }, [target, attempt, attemptColor, width, height]);

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
        className="drawing-canvas drawing-canvas-disabled"
      />
    </div>
  );
}
