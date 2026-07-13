import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { DrawingPath } from "../types/Challenge";
import type { Point } from "../types/Point";
import { CANVAS_SIZE, DEFAULT_PEN_COLOR, PEN_COLORS, penInkGlyphColor, type PenColorId, type PenSkinId } from "../app/constants";
import PenSkinGlyph from "./PenSkinGlyph";
import { getSelectedSkin } from "../services/penSkinStore";

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
  /** Cosmetic pen skin for the follow-the-pointer overlay. Defaults to the player's equipped skin; never affects strokes or scoring. */
  penSkin?: PenSkinId;
  onChange?: (path: DrawingPath) => void;
  onComplete?: (path: DrawingPath) => void;
  /** Accessible name for the drawing surface. Freehand drawing is inherently
   * pointer-based and has no meaningful keyboard equivalent, so the canvas is
   * labeled for context rather than made keyboard-operable. */
  ariaLabel?: string;
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

// Diamond ink glitter --------------------------------------------------------
// Only the Diamond Blue pen sprinkles sparkles as it draws. They live in a
// separate overlay layer (pointer-events:none) as tiny DOM nodes: each pops in
// with a short CSS animation, then settles into its own slow, randomly-timed
// infinite twinkle (opacity + a light scale pulse) so the glitter keeps
// catching the light instead of freezing solid. They never fade away or get
// removed after the stroke — only an explicit reset (clear / undo / a new
// shape) clears them. Purely visual (pointer-events:none, compositor-only
// opacity/transform animation, no per-frame JS), throttled and capped, and
// never touching the stroke points or scoring.
const DIAMOND_INK_ID: PenColorId = "diamondBlue";
const SPARKLE_MIN_INTERVAL_MS = 40;
// Safety ceiling for a very long scribble rather than a per-moment concurrency
// limit — each sparkle keeps a lightweight infinite twinkle running for as
// long as it's on screen, so this stays conservative for low-end phones.
const SPARKLE_MAX_ALIVE = 220;
const SPARKLE_SCATTER = 12;
// Twinkle animation is randomized per-sparkle within these ranges so a whole
// stroke's worth of glitter doesn't pulse in lockstep.
const SPARKLE_TWINKLE_MIN_MS = 1400;
const SPARKLE_TWINKLE_MAX_MS = 2600;

// Cosmetic drawing-pen overlay ----------------------------------------------
// A small pen icon that follows the pointer while drawing. Purely visual: it
// lives in an overlay layer with pointer-events:none and never touches the
// points/scoring. Positioned by writing transform directly to the DOM node
// (no React re-render per move), with a short CSS transition doing the smooth
// "follow" for free — cheap enough for mobile.

// Where the nib tip sits inside the 66x66 pen box (the SVG below keeps its
// 44-unit viewBox but is rendered at 66px, i.e. 1.5x — so tip coords scale too).
const PEN_TIP_X = 50.25;
const PEN_TIP_Y = 53.25;
// Keep the nib a hair up-left of the actual contact point so the dot the
// player is drawing stays visible. Touch devices get a bigger lift so a
// fingertip doesn't sit on top of the pen.
const PEN_GAP = 3;
const PEN_TOUCH_LIFT = 14;

const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(function DrawingCanvas(
  {
    width = CANVAS_SIZE,
    height = CANVAS_SIZE,
    disabled = false,
    ghostPath,
    showGhost = false,
    strokeColor = DEFAULT_PEN_COLOR,
    penSkin = getSelectedSkin(),
    onChange,
    onComplete,
    ariaLabel,
  },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const penRef = useRef<HTMLDivElement | null>(null);
  const sparkleLayerRef = useRef<HTMLDivElement | null>(null);
  const lastSparkleRef = useRef(0);
  const pointsRef = useRef<Point[]>([]);
  const segmentBreaksRef = useRef<number[]>([]);
  const isDrawingRef = useRef(false);
  const strokeStartRef = useRef(0);
  const wasDisabledRef = useRef(disabled);
  const touchLiftRef = useRef(0);
  // Tracks which single pointer (finger/mouse) is currently drawing, so a second
  // accidental touch during a stroke can't interleave its points into the same
  // stroke, and up/move/cancel events from unrelated pointers are ignored.
  const activePointerIdRef = useRef<number | null>(null);

  // Detect coarse (touch) pointers once so the pen can lift a bit higher above
  // a fingertip than beside a mouse cursor.
  useEffect(() => {
    touchLiftRef.current =
      typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches ? PEN_TOUCH_LIFT : 0;
  }, []);

  /** Moves the cosmetic pen so its nib points just off the contact point. `animate=false` snaps instantly (used on pointer-down so it doesn't slide in from the corner). */
  function movePen(x: number, y: number, animate: boolean) {
    const pen = penRef.current;
    if (!pen) return;
    const left = x - PEN_TIP_X - PEN_GAP;
    const top = y - PEN_TIP_Y - PEN_GAP - touchLiftRef.current;
    if (!animate) {
      pen.style.transition = "none";
      pen.style.transform = `translate(${left}px, ${top}px)`;
      void pen.offsetWidth; // flush so the next move animates from here
      pen.style.transition = "";
    } else {
      pen.style.transform = `translate(${left}px, ${top}px)`;
    }
  }

  function showPen(x: number, y: number) {
    movePen(x, y, false);
    penRef.current?.classList.add("is-active");
  }

  function hidePen() {
    penRef.current?.classList.remove("is-active");
  }

  /** Drops one glitter particle near (x, y). It pops in, then hands off into its own randomly-timed infinite twinkle loop — it stays on screen and keeps catching the light rather than freezing solid. */
  function spawnSparkle(x: number, y: number) {
    const layer = sparkleLayerRef.current;
    if (!layer || layer.childElementCount >= SPARKLE_MAX_ALIVE) return;
    const sparkle = document.createElement("span");
    sparkle.className = "sparkle";
    const size = 6 + Math.random() * 7;
    sparkle.style.width = `${size}px`;
    sparkle.style.height = `${size}px`;
    sparkle.style.left = `${x + (Math.random() - 0.5) * SPARKLE_SCATTER}px`;
    sparkle.style.top = `${y + (Math.random() - 0.5) * SPARKLE_SCATTER}px`;
    sparkle.style.setProperty("--rot", `${Math.random() * 90}deg`);
    sparkle.addEventListener(
      "animationend",
      () => {
        // Respect the reduced-motion preference: let the sparkle stay put once
        // it has appeared instead of pulsing forever.
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
        const duration = SPARKLE_TWINKLE_MIN_MS + Math.random() * (SPARKLE_TWINKLE_MAX_MS - SPARKLE_TWINKLE_MIN_MS);
        const delay = Math.random() * SPARKLE_TWINKLE_MAX_MS;
        sparkle.style.animation = `sparkle-twinkle ${duration}ms ease-in-out ${delay}ms infinite`;
      },
      { once: true },
    );
    layer.appendChild(sparkle);
  }

  /** Diamond ink only: time-throttled sparkle emission so fast pointer moves don't flood the layer. */
  function maybeSparkle(x: number, y: number) {
    if (strokeColor !== DIAMOND_INK_ID) return;
    const now = performance.now();
    if (now - lastSparkleRef.current < SPARKLE_MIN_INTERVAL_MS) return;
    lastSparkleRef.current = now;
    spawnSparkle(x, y);
    if (Math.random() < 0.4) spawnSparkle(x, y);
  }

  function clearSparkles() {
    sparkleLayerRef.current?.replaceChildren();
  }

  // Becoming interactive again (e.g. "Try Again" / a new shape) starts a fresh
  // stroke; simply lifting the pointer mid-drawing must not clear it.
  useEffect(() => {
    if (wasDisabledRef.current && !disabled) {
      pointsRef.current = [];
      segmentBreaksRef.current = [];
      clearSparkles();
      redraw();
    }
    // A phase switch can disable the canvas while the pointer is still down and
    // no pointerup ever reaches us — make sure the cosmetic pen doesn't linger.
    // The sparkles deliberately stay: the finished drawing keeps its glitter.
    if (disabled) hidePen();
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
      clearSparkles();
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
      // Sparkles aren't tracked per segment, so undo clears them all rather
      // than leave glitter orphaned over an erased stroke.
      clearSparkles();
      redraw();
      onChange?.({ points: pointsRef.current, canvasWidth: width, canvasHeight: height, breaks: segmentBreaksRef.current });
    },
  }));

  function getRelativePoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    // The canvas's CSS-displayed size can shrink below its backing width/height
    // (e.g. narrow phones), so map client coords through the scale ratio rather
    // than assuming 1 CSS px == 1 canvas px - otherwise strokes drift from the
    // finger/cursor and scoring runs against distorted coordinates.
    const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
    return { x: (event.clientX - rect.left) * scaleX, y: (event.clientY - rect.top) * scaleY };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    // Ignore a second finger touching down mid-stroke - only the pointer that
    // started the stroke may add points to it.
    if (activePointerIdRef.current !== null) return;
    activePointerIdRef.current = event.pointerId;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture isn't available in every environment (e.g. jsdom) -
      // drawing still works via pointerup/pointerleave, just without the
      // off-canvas-drag protection capture provides.
    }
    const { x, y } = getRelativePoint(event);
    showPen(x, y);
    maybeSparkle(x, y);
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
    if (disabled || !isDrawingRef.current || event.pointerId !== activePointerIdRef.current) return;
    const { x, y } = getRelativePoint(event);
    movePen(x, y, true);
    maybeSparkle(x, y);
    pointsRef.current = [...pointsRef.current, { x, y, t: performance.now() - strokeStartRef.current }];
    redraw();
    onChange?.({ points: pointsRef.current, canvasWidth: width, canvasHeight: height, breaks: segmentBreaksRef.current });
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.pointerId !== activePointerIdRef.current) return;
    activePointerIdRef.current = null;
    hidePen();
    if (disabled || !isDrawingRef.current) return;
    isDrawingRef.current = false;
    onComplete?.({ points: pointsRef.current, canvasWidth: width, canvasHeight: height, breaks: segmentBreaksRef.current });
  }

  /** OS-level interruptions (incoming call, back-gesture, control center) fire
   * pointercancel instead of pointerup - handled the same way so the stroke is
   * still finalized instead of leaving the pen icon stuck and the drawing lost. */
  function handlePointerCancel(event: ReactPointerEvent<HTMLCanvasElement>) {
    handlePointerUp(event);
  }

  const inkColor = penInkGlyphColor(strokeColor);

  return (
    <div className="drawing-canvas-shell">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        role="img"
        aria-label={ariaLabel ?? "Drawing area — draw the shape using touch or a mouse"}
        className={disabled ? "drawing-canvas drawing-canvas-disabled" : "drawing-canvas"}
        style={{ touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      />
      {/* Diamond ink glitter — transient sparkles, pointer-events:none, never affects scoring. */}
      <div ref={sparkleLayerRef} className="sparkle-layer" aria-hidden="true" />
      {/* Cosmetic pen overlay — never receives pointer events, never affects scoring.
          The equipped pen skin only changes how this glyph looks; its nib tip stays
          fixed so the pointer alignment (PEN_TIP_X / PEN_TIP_Y) holds for every skin. */}
      <div ref={penRef} className="drawing-pen" aria-hidden="true">
        <svg width="66" height="66" viewBox="0 0 44 44" fill="none">
          <PenSkinGlyph skin={penSkin} inkColor={inkColor} rotate />
        </svg>
      </div>
    </div>
  );
});

export default DrawingCanvas;
