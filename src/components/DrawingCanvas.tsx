import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { DrawingPath } from "../types/Challenge";
import type { Point } from "../types/Point";
import { CANVAS_SIZE } from "../app/constants";

export type DrawingCanvasHandle = {
  clear: () => void;
};

type DrawingCanvasProps = {
  width?: number;
  height?: number;
  disabled?: boolean;
  ghostPath?: DrawingPath;
  showGhost?: boolean;
  onChange?: (path: DrawingPath) => void;
  onComplete?: (path: DrawingPath) => void;
};

function drawStroke(ctx: CanvasRenderingContext2D, points: Point[], color: string) {
  if (points.length < 2) return;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
}

const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(function DrawingCanvas(
  {
    width = CANVAS_SIZE,
    height = CANVAS_SIZE,
    disabled = false,
    ghostPath,
    showGhost = false,
    onChange,
    onComplete,
  },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointsRef = useRef<Point[]>([]);
  const isDrawingRef = useRef(false);
  const strokeStartRef = useRef(0);

  function redraw() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (showGhost && ghostPath) {
      drawStroke(ctx, ghostPath.points, "rgba(30, 32, 46, 0.25)");
    }

    drawStroke(ctx, pointsRef.current, "#1e202e");
  }

  // Redraw whenever the ghost/visibility props change (e.g. preview -> drawing phase switch).
  useEffect(() => {
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghostPath, showGhost, width, height]);

  useImperativeHandle(ref, () => ({
    clear() {
      pointsRef.current = [];
      redraw();
      onChange?.({ points: [], canvasWidth: width, canvasHeight: height });
    },
  }));

  function getRelativePoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    const { x, y } = getRelativePoint(event);
    isDrawingRef.current = true;
    strokeStartRef.current = performance.now();
    pointsRef.current = [{ x, y, t: 0 }];
    redraw();
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled || !isDrawingRef.current) return;
    const { x, y } = getRelativePoint(event);
    pointsRef.current = [...pointsRef.current, { x, y, t: performance.now() - strokeStartRef.current }];
    redraw();
    onChange?.({ points: pointsRef.current, canvasWidth: width, canvasHeight: height });
  }

  function handlePointerUp() {
    if (disabled || !isDrawingRef.current) return;
    isDrawingRef.current = false;
    onComplete?.({ points: pointsRef.current, canvasWidth: width, canvasHeight: height });
  }

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={disabled ? "drawing-canvas drawing-canvas-disabled" : "drawing-canvas"}
      style={{ touchAction: "none" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    />
  );
});

export default DrawingCanvas;
