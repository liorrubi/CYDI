import type { CSSProperties } from "react";
import { ShapePreviewIcon } from "cydi";

/** Points on a unit square, scaled to whatever size the icon is asked to draw at. */
function fromUnit(unit: [number, number][], size: number, breaks?: number[]) {
  return {
    points: unit.map(([x, y], i) => ({ x: x * size, y: y * size, t: i })),
    canvasWidth: size,
    canvasHeight: size,
    breaks,
  };
}

const STAR_UNIT: [number, number][] = [
  [0.5, 0.05], [0.61, 0.37], [0.95, 0.37], [0.68, 0.58],
  [0.79, 0.9], [0.5, 0.7], [0.21, 0.9], [0.32, 0.58],
  [0.05, 0.37], [0.39, 0.37], [0.5, 0.05],
];

const HOUSE_UNIT: [number, number][] = [
  [0.1, 0.5], [0.5, 0.15], [0.9, 0.5], [0.8, 0.5],
  [0.8, 0.9], [0.2, 0.9], [0.2, 0.5], [0.1, 0.5],
];

/** Two disconnected rings - `breaks` stops a connector line being drawn between them. */
const DONUT_UNIT: [number, number][] = [
  [0.5, 0.08], [0.79, 0.21], [0.92, 0.5], [0.79, 0.79], [0.5, 0.92],
  [0.21, 0.79], [0.08, 0.5], [0.21, 0.21], [0.5, 0.08],
  [0.5, 0.32], [0.63, 0.37], [0.68, 0.5], [0.63, 0.63], [0.5, 0.68],
  [0.37, 0.63], [0.32, 0.5], [0.37, 0.37], [0.5, 0.32],
];

const star = { id: "star", name: "Star", category: "basic", generate: (s: number) => fromUnit(STAR_UNIT, s) };
const house = { id: "house", name: "House", category: "basic", generate: (s: number) => fromUnit(HOUSE_UNIT, s) };
const donut = { id: "donut", name: "Donut", category: "food", generate: (s: number) => fromUnit(DONUT_UNIT, s, [9]) };

const cell = { display: "grid", justifyItems: "center", gap: "var(--space-1)", fontSize: 12, color: "var(--color-text-muted)" };

/** The icon traces a shape's own geometry - it takes the ShapeDefinition, not an image. */
export const Shapes = () => (
  <div style={{ display: "flex", gap: "var(--space-5)", color: "var(--color-primary)" }}>
    {[star, house, donut].map((shape) => (
      <span key={shape.id} style={cell}>
        <ShapePreviewIcon shape={shape} size={64} />
        <span>{shape.name}</span>
      </span>
    ))}
  </div>
);

/** The icon paints itself with `--color-primary` (via its own `.shape-icon` rule, so a
 * parent's `color` will not win). Override the token on an ancestor to recolor it. */
export const Recolored = () => (
  <div style={{ display: "flex", gap: "var(--space-4)", alignItems: "center" }}>
    {["#5b5bf7", "#1d7d54", "#c02338", "#a15a1f"].map((c) => (
      <span key={c} style={{ ["--color-primary" as string]: c } as CSSProperties}>
        <ShapePreviewIcon shape={star} size={48} />
      </span>
    ))}
  </div>
);

/** Sizes used around the app - map nodes, home cards, result headers. */
export const Sizes = () => (
  <div style={{ display: "flex", gap: "var(--space-4)", alignItems: "flex-end", color: "var(--color-primary)" }}>
    <ShapePreviewIcon shape={house} size={28} />
    <ShapePreviewIcon shape={house} size={40} />
    <ShapePreviewIcon shape={house} size={72} />
  </div>
);
