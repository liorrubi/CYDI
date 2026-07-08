import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { DrawingPath } from "../types/Challenge";
import type { Point } from "../types/Point";
import { CANVAS_SIZE, DEFAULT_PEN_COLOR, PEN_COLORS, type PenColorId } from "../app/constants";

export type DrawingCanvasHandle = {
  clear: () => void;
  undoLastStroke: () => void;
};

type DrawingCanvasProps = {
  width?: number;
  height?: number;
  disabled?: boolean;
  ghostPath?: DrawingPath;
  showGhost?: boolean;
  strokeColor?: PenColorId;
  onChange?: (path: DrawingPath) => void;
  onComplete?: (path: DrawingPath) => void;
};

type StrokeOptions = { lineWidth?: number; dash?: number[] };

export function drawStroke(ctx: CanvasRenderingContext2D, points: Point[], color: string, options: StrokeOptions = {}) {
  if (points.length < 2) return;
  ctx.lineWidth = options.lineWidth ?? 5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  ctx.setLineDash(options.dash ?? []);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Draws each segment with a hue that steps forward by a fixed amount per point, so already-drawn segments never change color as the stroke grows. */
export function drawRainbowStroke(ctx: CanvasRenderingContext2D, points: Point[], lineWidth = 5) {
  if (points.length < 2) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([]);
  for (let i = 1; i < points.length; i++) {
    ctx.strokeStyle = `hsl(${(i * 6) % 360}, 85%, 55%)`;
    ctx.beginPath();
    ctx.moveTo(points[i - 1].x, points[i - 1].y);
    ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
  }
}

function drawUserStroke(ctx: CanvasRenderingContext2D, points: Point[], color: PenColorId) {
  if (color === "rainbow") {
    drawRainbowStroke(ctx, points);
    return;
  }
  drawStroke(ctx, points, PEN_COLORS.find((c) => c.id === color)?.hex ?? "#1e202e");
}

/** Splits points into sub-arrays at the given indices (each index starts a new segment). */
function sliceIntoSegments(points: Point[], breakIndices: number[]): Point[][] {
  if (breakIndices.length === 0) return points.length > 0 ? [points] : [];
  const segments: Point[][] = [];
  let start = 0;
  for (const breakIndex of breakIndices) {
    segments.push(points.slice(start, breakIndex));
    start = breakIndex;
  }
  segments.push(points.slice(start));
  return segments.filter((segment) => segment.length > 0);
}

/** Draws each pause-separated segment independently, so lifting the pointer and touching down elsewhere never draws an automatic connecting line. */
export function drawSegmentedUserStroke(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  breakIndices: number[],
  color: PenColorId,
) {
  for (const segment of sliceIntoSegments(points, breakIndices)) {
    drawUserStroke(ctx, segment, color);
  }
}

/** Same idea as drawSegmentedUserStroke, for a fixed stroke color/style (e.g. the ghost guide) rather than the player's pen color. */
export function drawSegmentedStroke(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  breakIndices: number[],
  color: string,
  options: StrokeOptions = {},
) {
  for (const segment of sliceIntoSegments(points, breakIndices)) {
    drawStroke(ctx, segment, color, options);
  }
}

// A solid, saturated blue dashed line - kept clearly visible against the
// near-white canvas background across phone screens/brightness settings
// (unlike a low-opacity dark gray, which can wash out on mobile displays),
// and deliberately distinct from every purchasable pen ink color.
const GHOST_STROKE_COLOR = "#2563eb";
const GHOST_STROKE_OPTIONS: StrokeOptions = { lineWidth: 6, dash: [12, 8] };

const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(function DrawingCanvas(
  {
    width = CANVAS_SIZE,
    height = CANVAS_SIZE,
    disabled = false,
    ghostPath,
    showGhost = false,
    strokeColor = DEFAULT_PEN_COLOR,
    onChange,
    onComplete,
  },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointsRef = useRef<Point[]>([]);
  const segmentBreaksRef = useRef<number[]>([]);
  const isDrawingRef = useRef(false);
  const strokeStartRef = useRef(0);
  const wasDisabledRef = useRef(disabled);

  // Becoming interactive again (e.g. "Try Again" / a new shape) starts a fresh
  // stroke; simply lifting the pointer mid-drawing must not clear it.
  useEffect(() => {
    if (wasDisabledRef.current && !disabled) {
      pointsRef.current = [];
      segmentBreaksRef.current = [];
      redraw();
    }
    wasDisabledRef.current = disabled;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  function redraw() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    // Painted as real pixels (not left to a CSS background) so that
    // Android/WebView "force dark" heuristics - which rewrite CSS
    // background-color but can't touch already-rasterized canvas content -
    // can't turn this dark and swallow the (dark-colored) pen strokes.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (showGhost && ghostPath) {
      drawSegmentedStroke(ctx, ghostPath.points, ghostPath.breaks ?? [], GHOST_STROKE_COLOR, GHOST_STROKE_OPTIONS);
    }

    drawSegmentedUserStroke(ctx, pointsRef.current, segmentBreaksRef.current, strokeColor);
  }

  // Redraw whenever the ghost/visibility/color props change (e.g. preview -> drawing phase switch).
  useEffect(() => {
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghostPath, showGhost, width, height, strokeColor]);

  useImperativeHandle(ref, () => ({
    clear() {
      pointsRef.current = [];
      segmentBreaksRef.current = [];
      redraw();
      onChange?.({ points: [], canvasWidth: width, canvasHeight: height, breaks: [] });
    },
    undoLastStroke() {
      if (pointsRef.current.length === 0) return;
      const breaks = segmentBreaksRef.current;
      if (breaks.length > 0) {
        // Multiple pen-lifts so far - drop only the most recent segment.
        const lastBreak = breaks[breaks.length - 1];
        pointsRef.current = pointsRef.current.slice(0, lastBreak);
        segmentBreaksRef.current = breaks.slice(0, -1);
      } else {
        // Only one segment has ever been drawn - undoing it means clearing.
        pointsRef.current = [];
        segmentBreaksRef.current = [];
      }
      redraw();
      onChange?.({ points: pointsRef.current, canvasWidth: width, canvasHeight: height, breaks: segmentBreaksRef.current });
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
    if (pointsRef.current.length === 0) {
      strokeStartRef.current = performance.now();
      pointsRef.current = [{ x, y, t: 0 }];
    } else {
      // Lifting the pointer and touching down again continues the same
      // stroke (not restarting it) but starts a new visual segment, so no
      // line is auto-drawn connecting the old and new pointer positions.
      segmentBreaksRef.current = [...segmentBreaksRef.current, pointsRef.current.length];
      pointsRef.current = [...pointsRef.current, { x, y, t: performance.now() - strokeStartRef.current }];
    }
    redraw();
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled || !isDrawingRef.current) return;
    const { x, y } = getRelativePoint(event);
    pointsRef.current = [...pointsRef.current, { x, y, t: performance.now() - strokeStartRef.current }];
    redraw();
    onChange?.({ points: pointsRef.current, canvasWidth: width, canvasHeight: height, breaks: segmentBreaksRef.current });
  }

  function handlePointerUp() {
    if (disabled || !isDrawingRef.current) return;
    isDrawingRef.current = false;
    onComplete?.({ points: pointsRef.current, canvasWidth: width, canvasHeight: height, breaks: segmentBreaksRef.current });
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
