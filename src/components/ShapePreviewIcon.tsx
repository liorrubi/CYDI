import type { ShapeDefinition } from "../engine/shapeLibrary";

type ShapePreviewIconProps = {
  shape: ShapeDefinition;
  size?: number;
};

export default function ShapePreviewIcon({ shape, size = 40 }: ShapePreviewIconProps) {
  const path = shape.generate(size);
  const pointsAttr = path.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shape-icon" aria-hidden="true">
      <polyline points={pointsAttr} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
