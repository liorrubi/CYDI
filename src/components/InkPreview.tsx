import { useEffect, useMemo, useRef } from "react";
import { drawSegmentedUserStroke } from "./DrawingCanvas";
import type { Point } from "../types/Point";
import type { InkTrialInk } from "../services/analyticsSchema";

type InkPreviewProps = {
  ink: InkTrialInk;
  /** CSS pixels. The stroke keeps the real 5px line width at any size. */
  width?: number;
  height?: number;
  className?: string;
};

/** Points along a soft S-swoosh across the preview, inset so the round caps never clip. 61 points = the real Rainbow
 *  ink's 6° hue step walks the whole spectrum exactly once. */
function swooshPoints(width: number, height: number): Point[] {
  const points: Point[] = [];
  const steps = 60;
  const inset = 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: inset + t * (width - inset * 2),
      y: height / 2 + Math.sin(t * Math.PI * 2) * (height / 2 - inset) * 0.75,
      t: i * 16,
    });
  }
  return points;
}

/** Fixed sparkle spots for Diamond Blue (fractions along the swoosh, and a size) - deterministic, never random per render. */
const DIAMOND_SPARKLES: Array<{ t: number; dy: number; size: number; rot: number }> = [
  { t: 0.12, dy: -7, size: 9, rot: 10 },
  { t: 0.3, dy: 6, size: 7, rot: 40 },
  { t: 0.52, dy: -6, size: 11, rot: 20 },
  { t: 0.71, dy: 7, size: 8, rot: 60 },
  { t: 0.88, dy: -5, size: 10, rot: 30 },
];

/**
 * A small, faithful preview of a premium ink: the stroke is drawn by the game's OWN ink renderer
 * (drawSegmentedUserStroke - the per-point hue walk for Rainbow, the Shop hex for Diamond Blue), and Diamond Blue gets
 * the game's own glitter particle (`.sparkle`, the same element and CSS the drawing canvas emits). No parallel
 * cosmetic: change the ink in the game and this preview changes with it. Static after a short pop-in (no loop).
 */
export default function InkPreview({ ink, width = 132, height = 40, className }: InkPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const points = useMemo(() => swooshPoints(width, height), [width, height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    drawSegmentedUserStroke(ctx, points, [], ink);
  }, [ink, points, width, height]);

  return (
    <span className={className ? `ink-preview ${className}` : "ink-preview"} style={{ width, height }} aria-hidden="true">
      <canvas ref={canvasRef} className="ink-preview-canvas" style={{ width, height }} />
      {ink === "diamondBlue" && (
        <span className="ink-preview-sparkles">
          {DIAMOND_SPARKLES.map((s, i) => {
            const p = points[Math.round(s.t * (points.length - 1))];
            return (
              <span
                key={i}
                className="sparkle"
                style={{ left: p.x, top: p.y + s.dy, width: s.size, height: s.size, ["--rot" as string]: `${s.rot}deg`, animationDelay: `${120 + i * 70}ms` }}
              />
            );
          })}
        </span>
      )}
    </span>
  );
}
