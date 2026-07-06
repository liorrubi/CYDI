import type { ShapeDefinition } from "../engine/shapeLibrary";
import type { Point } from "../types/Point";

type ShapePreviewIconProps = {
  shape: ShapeDefinition;
  size?: number;
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

export default function ShapePreviewIcon({ shape, size = 40 }: ShapePreviewIconProps) {
  const path = shape.generate(size);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shape-icon" aria-hidden="true">
      {sliceIntoSegments(path.points, path.breaks).map((segment, i) => (
        <polyline
          key={i}
          points={segment.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
