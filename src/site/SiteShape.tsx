/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * Web-only wrapper around the game's ShapePreviewIcon.
 *
 * It exists so the site never re-implements shape rendering: the icon already
 * splits a DrawingPath at its `breaks` (so no connector line is drawn between
 * disconnected parts) and sets pathLength=1 on every polyline so a caller can
 * animate stroke-dashoffset 1 -> 0 whatever the shape's real length. This adds
 * only the site's class names on top.
 *
 * The two props it passes through (`className`, `strokeWidth`) are optional
 * additions to ShapePreviewIcon whose defaults are unchanged, so no game screen
 * or Android render is affected by their existence.
 */
import ShapePreviewIcon from "../components/ShapePreviewIcon";
import type { ShapeDefinition } from "../content/contentRepository";

type SiteShapeProps = {
  shape: ShapeDefinition;
  /**
   * The coordinate space the shape is generated into. The rendered size comes
   * from CSS (`.site-shape` is width:100%), so this is resolution, not layout -
   * bigger means a smoother curve, not a bigger picture.
   */
  size?: number;
  strokeWidth?: number;
  /** Plays the one-shot draw-in. Respects prefers-reduced-motion in site.css. */
  animated?: boolean;
  /** Extra site class, e.g. `site-shape-ink` for the darker blue on white. */
  variant?: string;
  /**
   * Re-mounts the SVG when it changes, which is how the rotating hero replays
   * the draw-in animation for each new shape. Purely presentational.
   */
  replayKey?: string | number;
};

export default function SiteShape({
  shape,
  size = 120,
  strokeWidth = 4,
  animated = false,
  variant,
  replayKey,
}: SiteShapeProps) {
  const className = ["site-shape", variant, animated ? "site-shape-animated" : null].filter(Boolean).join(" ");

  return (
    <ShapePreviewIcon
      key={replayKey}
      shape={shape}
      size={size}
      strokeWidth={strokeWidth}
      className={className}
    />
  );
}
