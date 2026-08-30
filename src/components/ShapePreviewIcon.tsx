import type { ShapeDefinition } from "../content/contentRepository";
import type { Point } from "../types/Point";

type ShapePreviewIconProps = {
  shape: ShapeDefinition;
  size?: number;
  /**
   * Extra class on the <svg>, appended AFTER "shape-icon" so the base class and
   * every existing rule that targets it still apply. Web-only callers (the
   * public site, src/site/) use it to opt into their own colour and draw-in
   * animation; omitting it - which every game screen does - leaves the rendered
   * markup byte-identical to before this prop existed.
   */
  className?: string;
  /** Stroke width override. Defaults to the value the game has always used. */
  strokeWidth?: number;
};

/** Splits points into sub-arrays at the given break indices (each index starts a new segment). */
function sliceIntoSegments(points: Point[], breaks: number[] | undefined): Point[][] {
  if (!breaks || breaks.length === 0) return [points];
  const segments: Point[][] = [];
  let start = 0;
  for (const breakIndex of breaks) {
    segments.push(points.slice(start, breakIndex));
    start = breakIndex;
  }
  segments.push(points.slice(start));
  return segments;
}

export default function ShapePreviewIcon({ shape, size = 40, className, strokeWidth = 2.5 }: ShapePreviewIconProps) {
  const path = shape.generate(size);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className ? `shape-icon ${className}` : "shape-icon"}
      aria-hidden="true"
    >
      {sliceIntoSegments(path.points, path.breaks).map((segment, i) => (
        // pathLength normalises the stroke to 1 unit, so a caller can animate it with
        // stroke-dashoffset: 1 -> 0 whatever the shape's real length (see .home-card-preview).
        // Inert on its own: nothing renders differently unless dash properties are set.
        <polyline
          key={i}
          points={segment.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
          pathLength={1}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
