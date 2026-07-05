import { useEffect, useRef } from "react";
import type { DrawingPath } from "../types/Challenge";
import { CANVAS_SIZE } from "../app/constants";
import { drawSegmentedStroke, drawSegmentedUserStroke } from "./DrawingCanvas";
import { getSelectedColor } from "../services/penColorStore";

type ShapeOverlayCanvasProps = {
  target: DrawingPath;
  attempt: DrawingPath;
  width?: number;
  height?: number;
};

/** Static, non-interactive comparison of a target shape (gray, semi-transparent) and the player's attempt (blue), overlaid. */
export default function ShapeOverlayCanvas({
  target,
  attempt,
  width = CANVAS_SIZE,
  height = CANVAS_SIZE,
}: ShapeOverlayCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawSegmentedStroke(ctx, target.points, target.breaks ?? [], "#2563eb", { lineWidth: 6, dash: [12, 8] });
    drawSegmentedUserStroke(ctx, attempt.points, attempt.breaks ?? [], getSelectedColor());
  }, [target, attempt, width, height]);

  return (
    <canvas ref={canvasRef} width={width} height={height} className="drawing-canvas drawing-canvas-disabled" />
  );
}
