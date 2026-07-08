/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
import type { DrawingPath } from "../types/Challenge";

export type CategoryId =
  | "geometric"
  | "symbols"
  | "animals"
  | "nature"
  | "food"
  | "sports"
  | "transportation"
  | "home"
  | "calligraphy"
  | "fantasy"
  | "universal";

export const CATEGORIES: { id: CategoryId; name: string; icon: string }[] = [
  { id: "geometric", name: "Geometric Shapes", icon: "🔷" },
  { id: "symbols", name: "Symbols", icon: "♾️" },
  { id: "home", name: "Home & Objects", icon: "🏠" },
  { id: "nature", name: "Nature", icon: "🌿" },
  { id: "food", name: "Food", icon: "🍎" },
  { id: "sports", name: "Sports", icon: "⚽" },
  { id: "transportation", name: "Transportation", icon: "🚗" },
  { id: "animals", name: "Animals", icon: "🐾" },
  { id: "calligraphy", name: "Calligraphy", icon: "✍️" },
  { id: "fantasy", name: "Fantasy", icon: "🐉" },
  { id: "universal", name: "Universal Symbols", icon: "🌐" },
];

export type ShapeDefinition = {
  id: string;
  name: string;
  category: CategoryId;
  generate: (size: number) => DrawingPath;
};

type Vec2 = { x: number; y: number };

/** `breaks` marks indices where a new visual segment starts - used to jump between two unconnected parts of a shape (e.g. a donut's outer ring and inner ring) without ever drawing a straight connector line between them, in the ghost guide, the result overlay, or the score comparison. */
function toPath(points: Vec2[], size: number, breaks?: number[]): DrawingPath {
  return {
    points: points.map((p, i) => ({ x: p.x, y: p.y, t: i })),
    canvasWidth: size,
    canvasHeight: size,
    breaks,
  };
}

function fracPoints(size: number, fractions: [number, number][]): Vec2[] {
  return fractions.map(([fx, fy]) => ({ x: fx * size, y: fy * size }));
}

/** Connects vertices with straight edges and closes the loop back to the start. */
function polygonEdges(vertices: Vec2[], pointsPerEdge: number): Vec2[] {
  const result: Vec2[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    for (let step = 0; step < pointsPerEdge; step++) {
      const t = step / pointsPerEdge;
      result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  result.push(vertices[0]);
  return result;
}

/** Connects vertices with straight edges without closing the loop. */
function openPolyline(vertices: Vec2[], pointsPerEdge: number): Vec2[] {
  const result: Vec2[] = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    const a = vertices[i];
    const b = vertices[i + 1];
    for (let step = 0; step < pointsPerEdge; step++) {
      const t = step / pointsPerEdge;
      result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  result.push(vertices[vertices.length - 1]);
  return result;
}

function polar(center: Vec2, radius: number, angleDeg: number): Vec2 {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: center.x + radius * Math.cos(rad), y: center.y + radius * Math.sin(rad) };
}

function catmullRomPoint(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t2 = t * t;
  const t3 = t2 * t;
  const x =
    0.5 *
    (2 * p1.x +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  const y =
    0.5 *
    (2 * p1.y +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
  return { x, y };
}

/** Smooth closed loop through key points, via Catmull-Rom splines - good for organic silhouettes. */
function smoothClosedPath(keyPoints: Vec2[], pointsPerSegment = 12): Vec2[] {
  const n = keyPoints.length;
  const result: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = keyPoints[(i - 1 + n) % n];
    const p1 = keyPoints[i];
    const p2 = keyPoints[(i + 1) % n];
    const p3 = keyPoints[(i + 2) % n];
    for (let step = 0; step < pointsPerSegment; step++) {
      result.push(catmullRomPoint(p0, p1, p2, p3, step / pointsPerSegment));
    }
  }
  result.push(result[0]);
  return result;
}

type PathWithBreaks = { points: Vec2[]; breaks: number[] };

/** Concatenates multiple disconnected path segments into one shape, marking a break at every segment boundary so no connecting line is ever drawn between them (e.g. a donut's outer/inner rings, or a floating eye/dot next to a body outline). */
function toPathFromParts(parts: Vec2[][], size: number): DrawingPath {
  const points: Vec2[] = [];
  const breaks: number[] = [];
  for (const part of parts) {
    if (part.length === 0) continue;
    if (points.length > 0) breaks.push(points.length);
    points.push(...part);
  }
  return toPath(points, size, breaks);
}

/** Branches a small circular detail (an eye, a dot) off an existing point without lifting the pen for drawing purposes, but marks it as its own disconnected segment so no connecting line ever renders between the main shape and the detail. */
function withDetourLoop(points: Vec2[], anchorIndex: number, loopCenter: Vec2, loopRadius: number): PathWithBreaks {
  const loopSteps = 16;
  const loop: Vec2[] = [];
  for (let i = 0; i <= loopSteps; i++) {
    loop.push(polar(loopCenter, loopRadius, (i / loopSteps) * 360));
  }
  const before = points.slice(0, anchorIndex + 1);
  const after = points.slice(anchorIndex + 1);
  return {
    points: [...before, ...loop, ...after],
    breaks: [before.length, before.length + loop.length],
  };
}

function standalone(
  id: string,
  name: string,
  category: CategoryId,
  generate: (size: number) => DrawingPath,
): ShapeDefinition {
  return { id, name, category, generate };
}

// ==================== GEOMETRIC SHAPES ====================

function circle(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const radius = size * 0.32;
  const points: Vec2[] = [];
  const steps = 80;
  for (let i = 0; i <= steps; i++) {
    points.push(polar(center, radius, (i / steps) * 360 - 90));
  }
  return toPath(points, size);
}

function ellipseShape(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const rx = size * 0.38;
  const ry = size * 0.24;
  const points: Vec2[] = [];
  const steps = 80;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2 - Math.PI / 2;
    points.push({ x: center.x + rx * Math.cos(a), y: center.y + ry * Math.sin(a) });
  }
  return toPath(points, size);
}

function roundedRectShape(size: number): DrawingPath {
  const x0 = size * 0.18;
  const x1 = size * 0.82;
  const y0 = size * 0.28;
  const y1 = size * 0.72;
  const r = size * 0.12;
  const points: Vec2[] = [];
  const corner = (cx: number, cy: number, startDeg: number) => {
    for (let i = 0; i <= 12; i++) points.push(polar({ x: cx, y: cy }, r, startDeg + (i / 12) * 90));
  };
  corner(x0 + r, y0 + r, 180); // top-left
  corner(x1 - r, y0 + r, 270); // top-right
  corner(x1 - r, y1 - r, 0); // bottom-right
  corner(x0 + r, y1 - r, 90); // bottom-left
  points.push(points[0]);
  return toPath(points, size);
}

function trapezoidShape(size: number): DrawingPath {
  const vertices = fracPoints(size, [
    [0.32, 0.3],
    [0.68, 0.3],
    [0.82, 0.72],
    [0.18, 0.72],
  ]);
  return toPath(polygonEdges(vertices, 16), size);
}

function parallelogramShape(size: number): DrawingPath {
  const vertices = fracPoints(size, [
    [0.3, 0.3],
    [0.84, 0.3],
    [0.7, 0.7],
    [0.16, 0.7],
  ]);
  return toPath(polygonEdges(vertices, 16), size);
}

function semicircleShape(size: number): DrawingPath {
  const c = { x: size * 0.5, y: size * 0.38 };
  const R = size * 0.34;
  const points: Vec2[] = [{ x: c.x - R, y: c.y }]; // left end of the flat top
  points.push({ x: c.x + R, y: c.y }); // straight across to the right end
  for (let i = 0; i <= 44; i++) points.push(polar(c, R, (i / 44) * 180)); // arc right -> bottom -> left
  return toPath(points, size);
}

function crescentMoon(size: number): DrawingPath {
  // Arc angles are the two circles' true intersection points (not
  // approximated), so the outer and inner arcs meet exactly at both horns
  // instead of leaving a small gap/kink.
  const outerCenter = { x: size * 0.45, y: size / 2 };
  const outerRadius = size * 0.32;
  const innerCenter = { x: size * 0.58, y: size / 2 };
  const innerRadius = size * 0.28;
  const steps = 60;
  const points: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    points.push(polar(outerCenter, outerRadius, 60.6 + (i / steps) * 238.8));
  }
  for (let i = 0; i <= steps; i++) {
    points.push(polar(innerCenter, innerRadius, 275.6 - (i / steps) * 191.2));
  }
  return toPath(points, size);
}

const POLYGON_NAMES: Record<number, string> = {
  3: "Triangle",
  4: "Square",
  5: "Pentagon",
  6: "Hexagon",
  7: "Heptagon",
};

function regularPolygon(sides: number): ShapeDefinition {
  return {
    id: `polygon-${sides}`,
    name: POLYGON_NAMES[sides] ?? `${sides}-Sided Polygon`,
    category: "geometric",
    generate: (size) => {
      const center = { x: size / 2, y: size / 2 };
      const radius = size * 0.34;
      const vertices: Vec2[] = [];
      for (let i = 0; i < sides; i++) {
        vertices.push(polar(center, radius, (360 / sides) * i - 90));
      }
      return toPath(polygonEdges(vertices, 16), size);
    },
  };
}

function starShape(points: number): ShapeDefinition {
  return {
    id: `star-${points}`,
    name: `${points}-Point Star`,
    category: "geometric",
    generate: (size) => {
      const center = { x: size / 2, y: size / 2 };
      const outerRadius = size * 0.35;
      const innerRadius = size * 0.15;
      const vertices: Vec2[] = [];
      for (let i = 0; i < points * 2; i++) {
        const radius = i % 2 === 0 ? outerRadius : innerRadius;
        vertices.push(polar(center, radius, (360 / (points * 2)) * i - 90));
      }
      return toPath(polygonEdges(vertices, 8), size);
    },
  };
}

function roseShape(petalCount: number): ShapeDefinition {
  return {
    id: `flower-${petalCount}`,
    name: `${petalCount}-Petal Flower`,
    category: "geometric",
    generate: (size) => {
      // Lobe construction: r = base + (outer-base)*|sin((n/2)θ)| over [0,2π]
      // yields exactly `petalCount` rounded petals for any n (odd or even),
      // unlike the raw rhodonea r=cos(kθ) which retraces for odd k over 2π.
      const center = { x: size / 2, y: size / 2 };
      const outer = size * 0.38;
      const base = size * 0.11; // petals meet on a small central disc, not a pinch point
      const steps = 360;
      const petals: Vec2[] = [];
      for (let i = 0; i <= steps; i++) {
        const theta = (i / steps) * Math.PI * 2;
        const r = base + (outer - base) * Math.abs(Math.sin((petalCount / 2) * theta));
        petals.push({ x: center.x + r * Math.cos(theta), y: center.y + r * Math.sin(theta) });
      }
      // signature detail: the flower's center disc, as its own part (no connector)
      const disc: Vec2[] = [];
      const discSteps = 24;
      for (let i = 0; i <= discSteps; i++) {
        disc.push(polar(center, base * 0.7, (i / discSteps) * 360));
      }
      return toPathFromParts([petals, disc], size);
    },
  };
}

function zigzagShape(segments: number): ShapeDefinition {
  return {
    id: `zigzag-${segments}`,
    name: `Zigzag (${segments} Segments)`,
    category: "geometric",
    generate: (size) => {
      const marginX = size * 0.15;
      const width = size - marginX * 2;
      const topY = size * 0.28;
      const bottomY = size * 0.72;
      const vertices: Vec2[] = [];
      for (let i = 0; i <= segments; i++) {
        vertices.push({ x: marginX + (i / segments) * width, y: i % 2 === 0 ? topY : bottomY });
      }
      return toPath(openPolyline(vertices, 15), size);
    },
  };
}

function waveShape(cycles: number): ShapeDefinition {
  return {
    id: `wave-${cycles}`,
    name: `Wave (${cycles} Cycle${cycles > 1 ? "s" : ""})`,
    category: "geometric",
    generate: (size) => {
      const marginX = size * 0.15;
      const width = size - marginX * 2;
      const centerY = size / 2;
      const amplitude = size * 0.18;
      const steps = 30 * cycles + 60;
      const points: Vec2[] = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        points.push({ x: marginX + t * width, y: centerY + amplitude * Math.sin(t * cycles * Math.PI * 2) });
      }
      return toPath(points, size);
    },
  };
}

function spiralShape(turns: number): ShapeDefinition {
  return {
    id: `spiral-${turns}`,
    name: `Spiral (${turns} Turn${turns > 1 ? "s" : ""})`,
    category: "geometric",
    generate: (size) => {
      const center = { x: size / 2, y: size / 2 };
      const maxRadius = size * 0.38;
      const steps = 40 * turns + 40;
      const points: Vec2[] = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        points.push(polar(center, maxRadius * t, t * turns * 360));
      }
      return toPath(points, size);
    },
  };
}

function gearShape(teeth: number): ShapeDefinition {
  return {
    id: `gear-${teeth}`,
    name: `Gear (${teeth} Teeth)`,
    category: "geometric",
    generate: (size) => {
      const center = { x: size / 2, y: size / 2 };
      const outerRadius = size * 0.36;
      const innerRadius = size * 0.26;
      const anglePerTooth = 360 / teeth;
      const vertices: Vec2[] = [];
      for (let i = 0; i < teeth; i++) {
        const base = i * anglePerTooth - 90;
        vertices.push(polar(center, innerRadius, base - anglePerTooth * 0.2));
        vertices.push(polar(center, outerRadius, base - anglePerTooth * 0.12));
        vertices.push(polar(center, outerRadius, base + anglePerTooth * 0.12));
        vertices.push(polar(center, innerRadius, base + anglePerTooth * 0.2));
      }
      return toPath(polygonEdges(vertices, 4), size);
    },
  };
}

function lissajousShape(a: number, b: number): ShapeDefinition {
  return {
    id: `lissajous-${a}-${b}`,
    name: `Lissajous ${a}:${b}`,
    category: "geometric",
    generate: (size) => {
      const center = { x: size / 2, y: size / 2 };
      const amplitude = size * 0.35;
      const phase = Math.PI / 2;
      const steps = 240;
      const points: Vec2[] = [];
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * Math.PI * 2;
        points.push({
          x: center.x + amplitude * Math.sin(a * t + phase),
          y: center.y + amplitude * Math.sin(b * t),
        });
      }
      return toPath(points, size);
    },
  };
}

function diamondShape(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const halfW = size * 0.28;
  const halfH = size * 0.4;
  const vertices: Vec2[] = [
    { x: center.x, y: center.y - halfH },
    { x: center.x + halfW, y: center.y },
    { x: center.x, y: center.y + halfH },
    { x: center.x - halfW, y: center.y },
  ];
  return toPath(polygonEdges(vertices, 12), size);
}

function plusShape(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const arm = size * 0.4; // half-length of the cross from center to tip
  const half = size * 0.14; // half-thickness of each arm
  const vertices: Vec2[] = [
    { x: center.x - half, y: center.y - arm },
    { x: center.x + half, y: center.y - arm },
    { x: center.x + half, y: center.y - half },
    { x: center.x + arm, y: center.y - half },
    { x: center.x + arm, y: center.y + half },
    { x: center.x + half, y: center.y + half },
    { x: center.x + half, y: center.y + arm },
    { x: center.x - half, y: center.y + arm },
    { x: center.x - half, y: center.y + half },
    { x: center.x - arm, y: center.y + half },
    { x: center.x - arm, y: center.y - half },
    { x: center.x - half, y: center.y - half },
  ];
  return toPath(polygonEdges(vertices, 6), size);
}

const LISSAJOUS_PAIRS: [number, number][] = [
  [1, 3],
  [2, 3],
  [2, 5],
  [3, 4],
  [3, 5],
  [4, 5],
  [4, 7],
  [5, 6],
];

const GEOMETRIC_SHAPES: ShapeDefinition[] = [
  standalone("circle", "Circle", "geometric", circle),
  standalone("ellipse", "Oval", "geometric", ellipseShape),
  ...[3, 4, 5, 6, 7].map(regularPolygon),
  standalone("rounded-rect", "Rounded Rectangle", "geometric", roundedRectShape),
  standalone("trapezoid", "Trapezoid", "geometric", trapezoidShape),
  standalone("parallelogram", "Parallelogram", "geometric", parallelogramShape),
  standalone("semicircle", "Semicircle", "geometric", semicircleShape),
  ...[4, 5, 6, 7, 8, 9, 10].map(starShape),
  standalone("crescent-moon", "Crescent Moon", "geometric", crescentMoon),
  ...[3, 4, 5, 6, 7, 8, 9, 10].map(roseShape),
  ...[3, 4, 5].map(zigzagShape),
  ...[1, 2, 3].map(waveShape),
  ...[1, 2, 3, 4].map(spiralShape),
  ...[6, 8, 10].map(gearShape),
  standalone("diamond", "Diamond", "geometric", diamondShape),
  standalone("plus", "Plus", "geometric", plusShape),
  ...LISSAJOUS_PAIRS.map(([a, b]) => lissajousShape(a, b)),
];

// ==================== SYMBOLS ====================

function heart(size: number): DrawingPath {
  const raw: Vec2[] = [];
  const steps = 100;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    raw.push({ x, y });
  }
  const scale = (size * 0.65) / 34;
  const center = { x: size / 2, y: size / 2 + size * 0.05 };
  return toPath(
    raw.map((p) => ({ x: center.x + p.x * scale, y: center.y + p.y * scale })),
    size,
  );
}

function arrow(size: number): DrawingPath {
  const vertices = fracPoints(size, [
    [0.1, 0.4],
    [0.55, 0.4],
    [0.55, 0.25],
    [0.9, 0.5],
    [0.55, 0.75],
    [0.55, 0.6],
    [0.1, 0.6],
  ]);
  return toPath(polygonEdges(vertices, 12), size);
}

function infinitySymbol(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const scale = size * 0.32;
  const steps = 120;
  const points: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    points.push({ x: center.x + scale * Math.cos(t), y: center.y + scale * Math.sin(t) * Math.cos(t) });
  }
  return toPath(points, size);
}

function peaceSign(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const radius = size * 0.32;
  const points: Vec2[] = [];
  const steps = 80;
  for (let i = 0; i <= steps; i++) points.push(polar(center, radius, (i / steps) * 360 - 90));
  points.push(
    center,
    polar(center, radius, 90),
    center,
    polar(center, radius, 125),
    center,
    polar(center, radius, 55),
    center,
  );
  return toPath(points, size);
}

function diamondSymbol(size: number): DrawingPath {
  // Classic cut-gem silhouette: a flat table on top, angled crown facets
  // widening to the girdle, then pavilion facets narrowing to a point -
  // instead of a plain elongated rhombus.
  const tableLeft = { x: size * 0.35, y: size * 0.25 };
  const tableRight = { x: size * 0.65, y: size * 0.25 };
  const rightGirdle = { x: size * 0.85, y: size * 0.42 };
  const bottom = { x: size * 0.5, y: size * 0.88 };
  const leftGirdle = { x: size * 0.15, y: size * 0.42 };
  const outline = polygonEdges([tableLeft, tableRight, rightGirdle, bottom, leftGirdle], 12);
  // pavilion facet lines converging from the table corners to the point
  const facetLeft = openPolyline([tableLeft, bottom], 14);
  const facetRight = openPolyline([tableRight, bottom], 14);
  return toPathFromParts([outline, facetLeft, facetRight], size);
}

function shieldSymbol(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.5, 0.15],
    [0.8, 0.22],
    [0.8, 0.5],
    [0.65, 0.75],
    [0.5, 0.88],
    [0.35, 0.75],
    [0.2, 0.5],
    [0.2, 0.22],
  ]);
  const shield = smoothClosedPath(pts, 12);
  // simple emblem cross on the shield face
  const emblem = openPolyline(
    fracPoints(size, [
      [0.5, 0.32],
      [0.5, 0.6],
      [0.5, 0.46],
      [0.38, 0.46],
      [0.5, 0.46],
      [0.62, 0.46],
    ]),
    8,
  );
  return toPathFromParts([shield, emblem], size);
}

function crossSymbol(size: number): DrawingPath {
  const vertices = fracPoints(size, [
    [0.4, 0.15],
    [0.6, 0.15],
    [0.6, 0.4],
    [0.85, 0.4],
    [0.85, 0.6],
    [0.6, 0.6],
    [0.6, 0.85],
    [0.4, 0.85],
    [0.4, 0.6],
    [0.15, 0.6],
    [0.15, 0.4],
    [0.4, 0.4],
  ]);
  return toPath(polygonEdges(vertices, 8), size);
}

function checkmarkSymbol(size: number): DrawingPath {
  return toPath(
    openPolyline(
      fracPoints(size, [
        [0.2, 0.5],
        [0.42, 0.72],
        [0.85, 0.25],
      ]),
      20,
    ),
    size,
  );
}

function xMarkSymbol(size: number): DrawingPath {
  return toPath(
    openPolyline(
      fracPoints(size, [
        [0.2, 0.2],
        [0.8, 0.8],
        [0.5, 0.5],
        [0.2, 0.8],
        [0.8, 0.2],
      ]),
      16,
    ),
    size,
  );
}

function questionMarkSymbol(size: number): DrawingPath {
  const center = { x: size * 0.52, y: size * 0.3 };
  const radius = size * 0.17;
  const points: Vec2[] = [];
  // Sweeps 300° of the loop, leaving the gap at the bottom-left (the hook's
  // "mouth") and ending straight below center, so the stem continues without
  // a jump instead of cutting back across the loop.
  for (let i = 0; i <= 50; i++) points.push(polar(center, radius, 150 + (i / 50) * 300));
  const stemTop = points[points.length - 1];
  const stemBottom = { x: stemTop.x, y: size * 0.58 };
  points.push(...openPolyline([stemTop, stemBottom], 10).slice(1));
  const withDot = withDetourLoop(points, points.length - 1, { x: stemTop.x, y: size * 0.75 }, size * 0.025);
  return toPath(withDot.points, size, withDot.breaks);
}

function exclamationSymbol(size: number): DrawingPath {
  const points = openPolyline(
    fracPoints(size, [
      [0.5, 0.15],
      [0.5, 0.6],
    ]),
    20,
  );
  const withDot = withDetourLoop(points, points.length - 1, { x: size * 0.5, y: size * 0.78 }, size * 0.03);
  return toPath(withDot.points, size, withDot.breaks);
}

function musicNoteSymbol(size: number): DrawingPath {
  const stem = openPolyline(
    fracPoints(size, [
      [0.6, 0.2],
      [0.6, 0.65],
    ]),
    20,
  );
  const withHead = withDetourLoop(stem, stem.length - 1, { x: size * 0.48, y: size * 0.72 }, size * 0.08);
  return toPath(withHead.points, size, withHead.breaks);
}

function anchorSymbol(size: number): DrawingPath {
  const ringCenter = { x: size * 0.5, y: size * 0.2 };
  const ringRadius = size * 0.09;
  const ring: Vec2[] = [];
  // Starts and ends at the bottom of the ring (90°), exactly where the shank
  // begins, so there's no chord cutting across the ring's middle.
  for (let i = 0; i <= 40; i++) ring.push(polar(ringCenter, ringRadius, 90 + (i / 40) * 360));

  const pivot = { x: size * 0.5, y: size * 0.58 };
  const flukeRadius = size * 0.22;
  const shankBottom = polar(pivot, flukeRadius, 90);
  const shank = openPolyline([ring[ring.length - 1], shankBottom], 20);

  // the stock - a crossbar perpendicular to the shank, near its top
  const crossbar = openPolyline(
    fracPoints(size, [
      [0.32, 0.36],
      [0.68, 0.36],
    ]),
    14,
  );

  // flukes curl outward and up into hooks, continuing on from the shank's tip
  const leftFluke: Vec2[] = [];
  for (let i = 0; i <= 24; i++) leftFluke.push(polar(pivot, flukeRadius, 90 + (i / 24) * 110));
  const rightFluke: Vec2[] = [];
  for (let i = 0; i <= 24; i++) rightFluke.push(polar(pivot, flukeRadius, 90 - (i / 24) * 110));

  return toPathFromParts([[...ring, ...shank], crossbar, leftFluke, rightFluke], size);
}

function flagSymbol(size: number): DrawingPath {
  const pole = openPolyline(
    fracPoints(size, [
      [0.3, 0.85],
      [0.3, 0.15],
    ]),
    20,
  );
  const pennant = openPolyline(
    fracPoints(size, [
      [0.3, 0.15],
      [0.75, 0.28],
      [0.3, 0.4],
    ]),
    14,
  );
  return toPath([...pole, ...pennant], size);
}

function bellSymbol(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.5, 0.18],
    [0.68, 0.25],
    [0.75, 0.5],
    [0.8, 0.65],
    [0.2, 0.65],
    [0.25, 0.5],
    [0.32, 0.25],
  ]);
  const bell = smoothClosedPath(pts, 10);
  // hanging clapper at the bottom
  const clapper = withDetourLoop(bell, bell.length - 1, { x: size * 0.5, y: size * 0.75 }, size * 0.035);
  return toPath(clapper.points, size, clapper.breaks);
}

function targetSymbol(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const rings: Vec2[][] = [];
  for (const radius of [size * 0.32, size * 0.2, size * 0.08]) {
    const ring: Vec2[] = [];
    for (let i = 0; i <= 40; i++) ring.push(polar(center, radius, (i / 40) * 360 - 90));
    rings.push(ring);
  }
  return toPathFromParts(rings, size);
}

function speechBubbleSymbol(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.2, 0.25],
    [0.8, 0.25],
    [0.8, 0.6],
    [0.4, 0.6],
    [0.3, 0.75],
    [0.32, 0.6],
    [0.2, 0.6],
  ]);
  const bubble = smoothClosedPath(pts, 10);
  // three dots suggesting typed text inside the bubble
  const dotParts: Vec2[][] = [bubble];
  for (const fx of [0.38, 0.5, 0.62]) {
    const dot = { x: size * fx, y: size * 0.42 };
    dotParts.push([dot, polar(dot, size * 0.02, 0), dot]);
  }
  return toPathFromParts(dotParts, size);
}

function lightningBoltSymbol(size: number): DrawingPath {
  const vertices = fracPoints(size, [
    [0.55, 0.1],
    [0.3, 0.5],
    [0.48, 0.5],
    [0.35, 0.9],
    [0.7, 0.42],
    [0.5, 0.42],
  ]);
  return toPath(polygonEdges(vertices, 10), size);
}

function hourglassSymbol(size: number): DrawingPath {
  const vertices = fracPoints(size, [
    [0.3, 0.15],
    [0.7, 0.15],
    [0.5, 0.5],
    [0.7, 0.85],
    [0.3, 0.85],
    [0.5, 0.5],
  ]);
  return toPath(polygonEdges(vertices, 12), size);
}

function cloverSymbol(size: number): DrawingPath {
  const center = { x: size * 0.5, y: size * 0.42 };
  const outer = size * 0.24;
  const inner = size * 0.02;
  const points: Vec2[] = [];
  const steps = 160;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const r = inner + (outer - inner) * Math.abs(Math.sin(2 * t));
    points.push({ x: center.x + r * Math.cos(t), y: center.y + r * Math.sin(t) });
  }
  const stem = openPolyline(
    fracPoints(size, [
      [0.5, 0.6],
      [0.55, 0.85],
    ]),
    14,
  );
  return toPath([...points, ...stem], size);
}

const SYMBOL_SHAPES: ShapeDefinition[] = [
  standalone("sym-heart", "Heart", "symbols", heart),
  standalone("sym-cross", "Cross", "symbols", crossSymbol),
  standalone("sym-checkmark", "Checkmark", "symbols", checkmarkSymbol),
  standalone("sym-xmark", "X Mark", "symbols", xMarkSymbol),
  standalone("sym-arrow", "Arrow", "symbols", arrow),
  standalone("sym-exclamation", "Exclamation Mark", "symbols", exclamationSymbol),
  standalone("sym-question", "Question Mark", "symbols", questionMarkSymbol),
  standalone("sym-clover", "Clover", "symbols", cloverSymbol),
  standalone("sym-flag", "Flag", "symbols", flagSymbol),
  standalone("sym-musicnote", "Music Note", "symbols", musicNoteSymbol),
  standalone("sym-infinity", "Infinity", "symbols", infinitySymbol),
  standalone("sym-diamond", "Diamond", "symbols", diamondSymbol),
  standalone("sym-speechbubble", "Speech Bubble", "symbols", speechBubbleSymbol),
  standalone("sym-bell", "Bell", "symbols", bellSymbol),
  standalone("sym-lightning", "Lightning Bolt", "symbols", lightningBoltSymbol),
  standalone("sym-hourglass", "Hourglass", "symbols", hourglassSymbol),
  standalone("sym-target", "Target", "symbols", targetSymbol),
  standalone("sym-peace", "Peace Sign", "symbols", peaceSign),
  standalone("sym-anchor", "Anchor", "symbols", anchorSymbol),
  standalone("sym-shield", "Shield", "symbols", shieldSymbol),
];

// ==================== ANIMALS ====================

function fishShape(size: number): DrawingPath {
  // Fish facing left: rounded head tapering to a narrow tail base, a separate
  // forked tail fin, dorsal + pectoral fins, a gill arc and an eye.
  const body = smoothClosedPath(
    fracPoints(size, [
      [0.12, 0.5],
      [0.2, 0.37],
      [0.4, 0.31],
      [0.6, 0.33],
      [0.74, 0.42],
      [0.74, 0.58],
      [0.6, 0.67],
      [0.4, 0.69],
      [0.2, 0.63],
    ]),
    10,
  );
  const tail = polygonEdges(
    fracPoints(size, [
      [0.74, 0.5],
      [0.93, 0.34],
      [0.86, 0.5],
      [0.93, 0.66],
    ]),
    6,
  );
  const dorsalFin = polygonEdges(
    fracPoints(size, [
      [0.42, 0.32],
      [0.5, 0.2],
      [0.6, 0.33],
    ]),
    5,
  );
  const pectoralFin = polygonEdges(
    fracPoints(size, [
      [0.34, 0.56],
      [0.28, 0.7],
      [0.44, 0.62],
    ]),
    5,
  );
  const gill = openPolyline(
    fracPoints(size, [
      [0.26, 0.36],
      [0.22, 0.5],
      [0.26, 0.64],
    ]),
    6,
  );
  const eye: Vec2[] = [];
  for (let i = 0; i <= 14; i++) eye.push(polar({ x: size * 0.19, y: size * 0.47 }, size * 0.022, (i / 14) * 360));
  return toPathFromParts([body, tail, dorsalFin, pectoralFin, gill, eye], size);
}

function birdShape(size: number): DrawingPath {
  // Perched songbird facing right: rounded head/body silhouette, a triangular
  // beak, a folded wing, pointed tail feathers, an eye and two legs.
  const body = smoothClosedPath(
    fracPoints(size, [
      [0.58, 0.24],
      [0.68, 0.3],
      [0.66, 0.44],
      [0.5, 0.5],
      [0.32, 0.54],
      [0.38, 0.66],
      [0.54, 0.68],
      [0.63, 0.56],
      [0.65, 0.4],
    ]),
    10,
  );
  const beak = polygonEdges(
    fracPoints(size, [
      [0.67, 0.33],
      [0.82, 0.37],
      [0.66, 0.41],
    ]),
    5,
  );
  const wing = smoothClosedPath(
    fracPoints(size, [
      [0.42, 0.46],
      [0.56, 0.5],
      [0.48, 0.6],
      [0.38, 0.55],
    ]),
    8,
  );
  const tail = polygonEdges(
    fracPoints(size, [
      [0.34, 0.52],
      [0.12, 0.5],
      [0.14, 0.58],
      [0.34, 0.62],
    ]),
    5,
  );
  const eye: Vec2[] = [];
  for (let i = 0; i <= 14; i++) eye.push(polar({ x: size * 0.6, y: size * 0.34 }, size * 0.02, (i / 14) * 360));
  const leg = (fx: number) =>
    openPolyline(
      fracPoints(size, [
        [fx, 0.67],
        [fx, 0.8],
      ]),
      4,
    );
  return toPathFromParts([body, beak, wing, tail, eye, leg(0.46), leg(0.54)], size);
}

function snailShape(size: number): DrawingPath {
  // Snail crawling right: a foot (body) along the ground, a round shell with an
  // inner spiral, a raised head with two eye stalks tipped by eye circles.
  const foot = smoothClosedPath(
    fracPoints(size, [
      [0.14, 0.7],
      [0.3, 0.62],
      [0.55, 0.6],
      [0.72, 0.58],
      [0.82, 0.5],
      [0.86, 0.56],
      [0.8, 0.66],
      [0.6, 0.74],
      [0.3, 0.76],
    ]),
    10,
  );
  const shellCenter = { x: size * 0.42, y: size * 0.44 };
  const shellR = size * 0.2;
  const shell: Vec2[] = [];
  for (let i = 0; i <= 40; i++) shell.push(polar(shellCenter, shellR, (i / 40) * 360));
  // Inner spiral, drawn from the outer edge inward.
  const spiral: Vec2[] = [];
  const turns = 2.2;
  const steps = 80;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    spiral.push(polar(shellCenter, shellR * (1 - 0.92 * t), -90 + t * turns * 360));
  }
  // Eye stalks rising from the head at the right end of the foot.
  const stalkBase = { x: size * 0.82, y: size * 0.52 };
  const stalk1 = openPolyline([stalkBase, { x: size * 0.9, y: size * 0.38 }], 6);
  const stalk2 = openPolyline([stalkBase, { x: size * 0.78, y: size * 0.36 }], 6);
  const stalkEye = (c: Vec2) => {
    const loop: Vec2[] = [];
    for (let i = 0; i <= 12; i++) loop.push(polar(c, size * 0.02, (i / 12) * 360));
    return loop;
  };
  return toPathFromParts(
    [
      foot,
      shell,
      spiral,
      stalk1,
      stalk2,
      stalkEye({ x: size * 0.9, y: size * 0.37 }),
      stalkEye({ x: size * 0.78, y: size * 0.35 }),
    ],
    size,
  );
}

function mouseShape(size: number): DrawingPath {
  // Side view facing right: teardrop body pointed at the nose, one big round
  // ear, an eye, whiskers, and a long wavy tail trailing behind.
  const body = smoothClosedPath(
    fracPoints(size, [
      [0.86, 0.5],
      [0.76, 0.42],
      [0.6, 0.36],
      [0.42, 0.36],
      [0.28, 0.44],
      [0.24, 0.58],
      [0.32, 0.7],
      [0.5, 0.74],
      [0.68, 0.68],
      [0.8, 0.58],
    ]),
    10,
  );
  const ear: Vec2[] = [];
  for (let i = 0; i <= 18; i++) ear.push(polar({ x: size * 0.66, y: size * 0.32 }, size * 0.09, (i / 18) * 360));
  const eye: Vec2[] = [];
  for (let i = 0; i <= 12; i++) eye.push(polar({ x: size * 0.74, y: size * 0.44 }, size * 0.02, (i / 12) * 360));
  // Wavy tail trailing from the rear.
  const tail: Vec2[] = [];
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    tail.push({
      x: size * (0.26 - 0.22 * t),
      y: size * (0.62 - 0.06 * t + 0.05 * Math.sin(t * Math.PI * 1.5)),
    });
  }
  const whisker = (fy0: number, fy1: number) =>
    openPolyline(
      fracPoints(size, [
        [0.84, fy0],
        [0.96, fy1],
      ]),
      5,
    );
  return toPathFromParts([body, ear, eye, tail, whisker(0.5, 0.45), whisker(0.54, 0.57)], size);
}

function catShape(size: number): DrawingPath {
  // Cat face: round head with two pointed ears in the outline, eyes,
  // triangular nose, W-shaped mouth and whiskers on both cheeks.
  const head = smoothClosedPath(
    fracPoints(size, [
      [0.5, 0.18],
      [0.64, 0.2],
      [0.72, 0.06],
      [0.76, 0.22],
      [0.78, 0.42],
      [0.68, 0.62],
      [0.5, 0.68],
      [0.32, 0.62],
      [0.22, 0.42],
      [0.24, 0.22],
      [0.28, 0.06],
      [0.36, 0.2],
    ]),
    9,
  );
  const eye = (fx: number) => {
    const loop: Vec2[] = [];
    for (let i = 0; i <= 14; i++) loop.push(polar({ x: size * fx, y: size * 0.4 }, size * 0.028, (i / 14) * 360));
    return loop;
  };
  const nose = polygonEdges(
    fracPoints(size, [
      [0.47, 0.5],
      [0.53, 0.5],
      [0.5, 0.55],
    ]),
    4,
  );
  // W-shaped mouth hanging from the nose.
  const mouth = openPolyline(
    fracPoints(size, [
      [0.42, 0.58],
      [0.46, 0.6],
      [0.5, 0.55],
      [0.54, 0.6],
      [0.58, 0.58],
    ]),
    5,
  );
  const whisker = (x0: number, x1: number, y0: number, y1: number) =>
    openPolyline(
      fracPoints(size, [
        [x0, y0],
        [x1, y1],
      ]),
      5,
    );
  return toPathFromParts(
    [
      head,
      eye(0.4),
      eye(0.6),
      nose,
      mouth,
      whisker(0.34, 0.16, 0.5, 0.46),
      whisker(0.34, 0.16, 0.55, 0.57),
      whisker(0.66, 0.84, 0.5, 0.46),
      whisker(0.66, 0.84, 0.55, 0.57),
    ],
    size,
  );
}

function dogShape(size: number): DrawingPath {
  // Dog face: rounded head, two floppy ears hanging over the sides, eyes,
  // round nose with a muzzle line dropping to a smile.
  const head = smoothClosedPath(
    fracPoints(size, [
      [0.5, 0.16],
      [0.68, 0.2],
      [0.78, 0.36],
      [0.76, 0.54],
      [0.64, 0.68],
      [0.5, 0.72],
      [0.36, 0.68],
      [0.24, 0.54],
      [0.22, 0.36],
      [0.32, 0.2],
    ]),
    10,
  );
  const floppyEar = (mirror: number) =>
    smoothClosedPath(
      fracPoints(size, [
        [0.5 + mirror * 0.22, 0.22],
        [0.5 + mirror * 0.32, 0.3],
        [0.5 + mirror * 0.36, 0.48],
        [0.5 + mirror * 0.3, 0.56],
        [0.5 + mirror * 0.24, 0.44],
        [0.5 + mirror * 0.22, 0.3],
      ]),
      7,
    );
  const eye = (fx: number) => {
    const loop: Vec2[] = [];
    for (let i = 0; i <= 14; i++) loop.push(polar({ x: size * fx, y: size * 0.4 }, size * 0.026, (i / 14) * 360));
    return loop;
  };
  const nose: Vec2[] = [];
  for (let i = 0; i <= 14; i++) nose.push(polar({ x: size * 0.5, y: size * 0.52 }, size * 0.028, (i / 14) * 360));
  const muzzleLine = openPolyline(
    fracPoints(size, [
      [0.5, 0.548],
      [0.5, 0.6],
    ]),
    4,
  );
  const smile = openPolyline(
    fracPoints(size, [
      [0.43, 0.63],
      [0.5, 0.6],
      [0.57, 0.63],
    ]),
    5,
  );
  return toPathFromParts([head, floppyEar(-1), floppyEar(1), eye(0.4), eye(0.6), nose, muzzleLine, smile], size);
}

function rabbitShape(size: number): DrawingPath {
  // Rabbit face: round head, two long upright ears as separate closed shapes,
  // both eyes, a nose, and the signature buck teeth below the nose.
  const head = smoothClosedPath(
    fracPoints(size, [
      [0.5, 0.36],
      [0.62, 0.38],
      [0.72, 0.5],
      [0.7, 0.64],
      [0.6, 0.74],
      [0.5, 0.76],
      [0.4, 0.74],
      [0.3, 0.64],
      [0.28, 0.5],
      [0.38, 0.38],
    ]),
    9,
  );
  const ear = (mirror: number) =>
    smoothClosedPath(
      fracPoints(size, [
        [0.5 - mirror * 0.1, 0.4],
        [0.5 - mirror * 0.17, 0.22],
        [0.5 - mirror * 0.14, 0.07],
        [0.5 - mirror * 0.07, 0.09],
        [0.5 - mirror * 0.05, 0.25],
        [0.5 - mirror * 0.05, 0.4],
      ]),
      7,
    );
  const eye = (fx: number) => {
    const loop: Vec2[] = [];
    for (let i = 0; i <= 14; i++) loop.push(polar({ x: size * fx, y: size * 0.52 }, size * 0.025, (i / 14) * 360));
    return loop;
  };
  const nose = polygonEdges(
    fracPoints(size, [
      [0.475, 0.6],
      [0.525, 0.6],
      [0.5, 0.64],
    ]),
    4,
  );
  // Buck teeth: small rectangle with a center divider.
  const teeth = polygonEdges(
    fracPoints(size, [
      [0.46, 0.66],
      [0.54, 0.66],
      [0.54, 0.73],
      [0.46, 0.73],
    ]),
    4,
  );
  const teethDivider = openPolyline(
    fracPoints(size, [
      [0.5, 0.66],
      [0.5, 0.73],
    ]),
    4,
  );
  return toPathFromParts([head, ear(1), ear(-1), eye(0.42), eye(0.58), nose, teeth, teethDivider], size);
}

function duckShape(size: number): DrawingPath {
  // Swimming duck facing right: one outline for tail, back, curved neck and
  // head, plus a flat bill, an eye, a folded wing and a water line below.
  const body = smoothClosedPath(
    fracPoints(size, [
      [0.16, 0.52],
      [0.35, 0.5],
      [0.58, 0.48],
      [0.62, 0.36],
      [0.66, 0.26],
      [0.74, 0.28],
      [0.76, 0.34],
      [0.7, 0.46],
      [0.72, 0.56],
      [0.6, 0.7],
      [0.38, 0.72],
      [0.24, 0.66],
    ]),
    9,
  );
  const bill = polygonEdges(
    fracPoints(size, [
      [0.75, 0.3],
      [0.9, 0.33],
      [0.75, 0.38],
    ]),
    5,
  );
  const eye: Vec2[] = [];
  for (let i = 0; i <= 12; i++) eye.push(polar({ x: size * 0.7, y: size * 0.31 }, size * 0.02, (i / 12) * 360));
  const wing = smoothClosedPath(
    fracPoints(size, [
      [0.36, 0.56],
      [0.52, 0.55],
      [0.58, 0.62],
      [0.44, 0.67],
      [0.34, 0.62],
    ]),
    7,
  );
  const water = openPolyline(
    fracPoints(size, [
      [0.1, 0.78],
      [0.25, 0.75],
      [0.4, 0.78],
      [0.55, 0.75],
      [0.7, 0.78],
      [0.85, 0.75],
    ]),
    5,
  );
  return toPathFromParts([body, bill, eye, wing, water], size);
}

function frogShape(size: number): DrawingPath {
  // Front-view sitting frog: squat body, two bulging eye bumps with pupils
  // on top of the head, a wide smile, and folded haunches at the sides.
  const body = smoothClosedPath(
    fracPoints(size, [
      [0.5, 0.4],
      [0.64, 0.44],
      [0.74, 0.56],
      [0.72, 0.7],
      [0.6, 0.76],
      [0.5, 0.78],
      [0.4, 0.76],
      [0.28, 0.7],
      [0.26, 0.56],
      [0.36, 0.44],
    ]),
    9,
  );
  const circleAt = (fx: number, fy: number, r: number, steps: number) => {
    const loop: Vec2[] = [];
    for (let i = 0; i <= steps; i++) loop.push(polar({ x: size * fx, y: size * fy }, size * r, (i / steps) * 360));
    return loop;
  };
  const mouth = openPolyline(
    fracPoints(size, [
      [0.36, 0.58],
      [0.5, 0.64],
      [0.64, 0.58],
    ]),
    6,
  );
  const haunch = (mirror: number) =>
    smoothClosedPath(
      fracPoints(size, [
        [0.5 - mirror * 0.22, 0.6],
        [0.5 - mirror * 0.3, 0.66],
        [0.5 - mirror * 0.32, 0.76],
        [0.5 - mirror * 0.24, 0.78],
        [0.5 - mirror * 0.18, 0.7],
      ]),
      7,
    );
  return toPathFromParts(
    [
      body,
      circleAt(0.38, 0.38, 0.055, 16),
      circleAt(0.62, 0.38, 0.055, 16),
      circleAt(0.38, 0.38, 0.02, 10),
      circleAt(0.62, 0.38, 0.02, 10),
      mouth,
      haunch(1),
      haunch(-1),
    ],
    size,
  );
}

function pigShape(size: number): DrawingPath {
  // Pig face: round head, two triangular ears folding forward, two eyes and the
  // signature big oval snout with two nostrils.
  const head = smoothClosedPath(
    fracPoints(size, [
      [0.5, 0.26],
      [0.66, 0.3],
      [0.74, 0.44],
      [0.72, 0.6],
      [0.58, 0.7],
      [0.5, 0.72],
      [0.42, 0.7],
      [0.28, 0.6],
      [0.26, 0.44],
      [0.34, 0.3],
    ]),
    9,
  );
  const ear = (mirror: number) =>
    polygonEdges(
      fracPoints(size, [
        [0.5 + mirror * 0.16, 0.3],
        [0.5 + mirror * 0.24, 0.13],
        [0.5 + mirror * 0.08, 0.26],
      ]),
      5,
    );
  const eye = (fx: number) => {
    const loop: Vec2[] = [];
    for (let i = 0; i <= 12; i++) loop.push(polar({ x: size * fx, y: size * 0.44 }, size * 0.022, (i / 12) * 360));
    return loop;
  };
  // Snout: an oval with two nostril dots.
  const snout: Vec2[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = (i / 24) * Math.PI * 2;
    snout.push({ x: size * (0.5 + 0.12 * Math.cos(t)), y: size * (0.56 + 0.08 * Math.sin(t)) });
  }
  const nostril = (fx: number) => {
    const loop: Vec2[] = [];
    for (let i = 0; i <= 10; i++) loop.push(polar({ x: size * fx, y: size * 0.56 }, size * 0.02, (i / 10) * 360));
    return loop;
  };
  return toPathFromParts([head, ear(-1), ear(1), eye(0.42), eye(0.58), snout, nostril(0.45), nostril(0.55)], size);
}

function turtleShape(size: number): DrawingPath {
  // Top-down turtle: domed round shell, a head poking out the front, four
  // legs and a tail around the rim, and a hexagon-segment pattern on the shell.
  const center = { x: size * 0.5, y: size * 0.52 };
  const shellR = size * 0.28;
  const shell: Vec2[] = [];
  for (let i = 0; i <= 40; i++) shell.push(polar(center, shellR, (i / 40) * 360));
  const head: Vec2[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = (i / 16) * Math.PI * 2;
    head.push({ x: size * (0.5 + 0.07 * Math.cos(t)), y: size * (0.16 + 0.06 * Math.sin(t)) });
  }
  const limb = (angleDeg: number, len: number) => {
    const base = polar(center, shellR * 0.92, angleDeg);
    const tip = polar(center, shellR + len, angleDeg);
    return smoothClosedPath(
      [
        polar(base, size * 0.05, angleDeg + 90),
        polar(tip, size * 0.05, angleDeg + 90),
        polar(tip, size * 0.05, angleDeg - 90),
        polar(base, size * 0.05, angleDeg - 90),
      ],
      5,
    );
  };
  // Central hexagon plate with six radiating seams.
  const hex: Vec2[] = [];
  for (let i = 0; i <= 6; i++) hex.push(polar(center, shellR * 0.42, i * 60 - 90));
  const seams = [30, 90, 150, 210, 270, 330].map((a) =>
    openPolyline([polar(center, shellR * 0.42, a), polar(center, shellR * 0.95, a)], 4),
  );
  return toPathFromParts(
    [
      shell,
      head,
      limb(48, size * 0.08),
      limb(132, size * 0.08),
      limb(228, size * 0.08),
      limb(312, size * 0.08),
      limb(90, size * 0.05), // tail
      hex,
      ...seams,
    ],
    size,
  );
}

function sheepShape(size: number): DrawingPath {
  // Side-view sheep: a fluffy wool body drawn as a ring of bumps, a small dark
  // head at the front, two ears, and four straight legs.
  const woolCenter = { x: size * 0.44, y: size * 0.46 };
  const bumps = 11;
  const wool: Vec2[] = [];
  const steps = 160;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const r = size * (0.26 + 0.035 * Math.cos(bumps * t));
    wool.push({ x: woolCenter.x + r * 1.1 * Math.cos(t), y: woolCenter.y + r * Math.sin(t) });
  }
  // Head at the front (right side).
  const head = smoothClosedPath(
    fracPoints(size, [
      [0.72, 0.42],
      [0.82, 0.46],
      [0.84, 0.56],
      [0.76, 0.62],
      [0.68, 0.58],
      [0.66, 0.48],
    ]),
    8,
  );
  const ear = (fy: number) =>
    smoothClosedPath(
      fracPoints(size, [
        [0.7, fy],
        [0.62, fy + 0.02],
        [0.66, fy + 0.06],
      ]),
      5,
    );
  const eye: Vec2[] = [];
  for (let i = 0; i <= 10; i++) eye.push(polar({ x: size * 0.78, y: size * 0.5 }, size * 0.016, (i / 10) * 360));
  const leg = (fx: number) =>
    openPolyline(
      fracPoints(size, [
        [fx, 0.66],
        [fx, 0.84],
      ]),
      4,
    );
  return toPathFromParts([wool, head, ear(0.44), eye, leg(0.32), leg(0.44), leg(0.54), leg(0.64)], size);
}

function foxShape(size: number): DrawingPath {
  // Fox face: angular head tapering to a pointed snout, two large pointed ears
  // as separate triangles with inner ears, two slanted eyes and a nose.
  const face = polygonEdges(
    fracPoints(size, [
      [0.5, 0.26],
      [0.72, 0.32],
      [0.62, 0.52],
      [0.5, 0.74],
      [0.38, 0.52],
      [0.28, 0.32],
    ]),
    10,
  );
  const ear = (mirror: number) =>
    polygonEdges(
      fracPoints(size, [
        [0.5 + mirror * 0.2, 0.31],
        [0.5 + mirror * 0.3, 0.08],
        [0.5 + mirror * 0.36, 0.32],
      ]),
      5,
    );
  const innerEar = (mirror: number) =>
    polygonEdges(
      fracPoints(size, [
        [0.5 + mirror * 0.24, 0.28],
        [0.5 + mirror * 0.29, 0.15],
        [0.5 + mirror * 0.31, 0.28],
      ]),
      4,
    );
  const eye = (mirror: number) =>
    smoothClosedPath(
      fracPoints(size, [
        [0.5 + mirror * 0.06, 0.4],
        [0.5 + mirror * 0.16, 0.38],
        [0.5 + mirror * 0.14, 0.44],
        [0.5 + mirror * 0.07, 0.44],
      ]),
      5,
    );
  const nose = polygonEdges(
    fracPoints(size, [
      [0.46, 0.62],
      [0.54, 0.62],
      [0.5, 0.68],
    ]),
    4,
  );
  return toPathFromParts(
    [face, ear(-1), ear(1), innerEar(-1), innerEar(1), eye(-1), eye(1), nose],
    size,
  );
}

function bearShape(size: number): DrawingPath {
  // Bear face: round head, two round ears in the outline, two eyes, and an
  // oval muzzle carrying a round nose above a small mouth.
  const head = smoothClosedPath(
    fracPoints(size, [
      [0.5, 0.22],
      [0.68, 0.26],
      [0.76, 0.42],
      [0.72, 0.6],
      [0.6, 0.72],
      [0.5, 0.74],
      [0.4, 0.72],
      [0.28, 0.6],
      [0.24, 0.42],
      [0.32, 0.26],
    ]),
    9,
  );
  const ear = (fx: number) => {
    const loop: Vec2[] = [];
    for (let i = 0; i <= 18; i++) loop.push(polar({ x: size * fx, y: size * 0.24 }, size * 0.08, (i / 18) * 360));
    return loop;
  };
  const eye = (fx: number) => {
    const loop: Vec2[] = [];
    for (let i = 0; i <= 12; i++) loop.push(polar({ x: size * fx, y: size * 0.42 }, size * 0.022, (i / 12) * 360));
    return loop;
  };
  // Muzzle oval with nose and mouth.
  const muzzle: Vec2[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = (i / 24) * Math.PI * 2;
    muzzle.push({ x: size * (0.5 + 0.11 * Math.cos(t)), y: size * (0.58 + 0.08 * Math.sin(t)) });
  }
  const nose: Vec2[] = [];
  for (let i = 0; i <= 12; i++) nose.push(polar({ x: size * 0.5, y: size * 0.54 }, size * 0.026, (i / 12) * 360));
  const mouth = openPolyline(
    fracPoints(size, [
      [0.44, 0.62],
      [0.5, 0.64],
      [0.56, 0.62],
    ]),
    5,
  );
  return toPathFromParts([head, ear(0.34), ear(0.66), eye(0.42), eye(0.58), muzzle, nose, mouth], size);
}

function owlShape(size: number): DrawingPath {
  // Owl: rounded body with two pointed ear tufts in the outline, two big
  // concentric-circle eyes, a triangular beak, folded wings and two feet.
  const body = smoothClosedPath(
    fracPoints(size, [
      [0.38, 0.14],
      [0.5, 0.24],
      [0.62, 0.14],
      [0.78, 0.3],
      [0.8, 0.54],
      [0.66, 0.74],
      [0.5, 0.8],
      [0.34, 0.74],
      [0.2, 0.54],
      [0.22, 0.3],
    ]),
    9,
  );
  const eyeDisc = (fx: number, r: number, steps: number) => {
    const loop: Vec2[] = [];
    for (let i = 0; i <= steps; i++) loop.push(polar({ x: size * fx, y: size * 0.42 }, size * r, (i / steps) * 360));
    return loop;
  };
  const beak = polygonEdges(
    fracPoints(size, [
      [0.47, 0.46],
      [0.53, 0.46],
      [0.5, 0.54],
    ]),
    4,
  );
  const wing = (mirror: number) =>
    openPolyline(
      fracPoints(size, [
        [0.5 + mirror * 0.24, 0.4],
        [0.5 + mirror * 0.28, 0.55],
        [0.5 + mirror * 0.22, 0.68],
      ]),
      6,
    );
  const foot = (fx: number) =>
    openPolyline(
      fracPoints(size, [
        [fx - 0.04, 0.82],
        [fx, 0.78],
        [fx + 0.04, 0.82],
      ]),
      4,
    );
  return toPathFromParts(
    [
      body,
      eyeDisc(0.38, 0.1, 18),
      eyeDisc(0.62, 0.1, 18),
      eyeDisc(0.38, 0.035, 12),
      eyeDisc(0.62, 0.035, 12),
      beak,
      wing(-1),
      wing(1),
      foot(0.42),
      foot(0.58),
    ],
    size,
  );
}

function butterflyShape(size: number): DrawingPath {
  // Each side's wing pair is its own closed loop meeting at the body
  // centerline, instead of one big loop that revisits the center point twice
  // - which made the smoothing curve overshoot and cross itself there.
  const rightWingPts = fracPoints(size, [
    [0.5, 0.5],
    [0.62, 0.28],
    [0.82, 0.18],
    [0.88, 0.35],
    [0.68, 0.42],
    [0.68, 0.58],
    [0.88, 0.65],
    [0.82, 0.82],
    [0.62, 0.72],
  ]);
  const rightWing = smoothClosedPath(rightWingPts, 10);
  const leftWingPts = fracPoints(size, [
    [0.5, 0.5],
    [0.38, 0.28],
    [0.18, 0.18],
    [0.12, 0.35],
    [0.32, 0.42],
    [0.32, 0.58],
    [0.12, 0.65],
    [0.18, 0.82],
    [0.38, 0.72],
  ]);
  const leftWing = smoothClosedPath(leftWingPts, 10);
  // Segmented body: head, thorax and a longer abdomen down the centerline.
  const head: Vec2[] = [];
  for (let i = 0; i <= 16; i++) head.push(polar({ x: size * 0.5, y: size * 0.38 }, size * 0.03, (i / 16) * 360));
  const abdomen: Vec2[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = (i / 24) * Math.PI * 2;
    abdomen.push({ x: size * (0.5 + 0.03 * Math.cos(t)), y: size * (0.56 + 0.14 * Math.sin(t)) });
  }
  const antenna = (mirror: number) =>
    openPolyline(
      fracPoints(size, [
        [0.5 + mirror * 0.01, 0.36],
        [0.5 + mirror * 0.08, 0.26],
        [0.5 + mirror * 0.14, 0.22],
      ]),
      5,
    );
  // A decorative spot on each upper wing.
  const spot = (fx: number) => {
    const loop: Vec2[] = [];
    for (let i = 0; i <= 12; i++) loop.push(polar({ x: size * fx, y: size * 0.3 }, size * 0.04, (i / 12) * 360));
    return loop;
  };
  return toPathFromParts(
    [rightWing, leftWing, head, abdomen, antenna(-1), antenna(1), spot(0.3), spot(0.7)],
    size,
  );
}

function elephantShape(size: number): DrawingPath {
  // Side-view elephant: rounded body and head in one outline, a big floppy ear,
  // a curled trunk, a tusk, an eye and four sturdy legs.
  const body = smoothClosedPath(
    fracPoints(size, [
      [0.4, 0.28],
      [0.6, 0.24],
      [0.78, 0.3],
      [0.84, 0.46],
      [0.82, 0.62],
      [0.72, 0.66],
      [0.5, 0.66],
      [0.34, 0.64],
      [0.28, 0.5],
      [0.3, 0.36],
    ]),
    9,
  );
  const ear: Vec2[] = smoothClosedPath(
    fracPoints(size, [
      [0.42, 0.34],
      [0.52, 0.32],
      [0.56, 0.44],
      [0.5, 0.54],
      [0.4, 0.5],
      [0.38, 0.4],
    ]),
    8,
  );
  // Trunk curling down and back up from the front of the head.
  const trunk = openPolyline(
    fracPoints(size, [
      [0.3, 0.42],
      [0.2, 0.5],
      [0.16, 0.64],
      [0.2, 0.76],
      [0.3, 0.78],
      [0.32, 0.7],
    ]),
    8,
  );
  const tusk = openPolyline(
    fracPoints(size, [
      [0.32, 0.56],
      [0.26, 0.66],
      [0.28, 0.72],
    ]),
    5,
  );
  const eye: Vec2[] = [];
  for (let i = 0; i <= 12; i++) eye.push(polar({ x: size * 0.36, y: size * 0.4 }, size * 0.018, (i / 12) * 360));
  const leg = (fx: number) =>
    openPolyline(
      fracPoints(size, [
        [fx, 0.65],
        [fx, 0.86],
      ]),
      4,
    );
  return toPathFromParts([body, ear, trunk, tusk, eye, leg(0.4), leg(0.52), leg(0.66), leg(0.76)], size);
}

function lionShape(size: number): DrawingPath {
  // Lion face: a shaggy mane ring (bumps) around a round inner face, two eyes,
  // a triangular nose over a curved muzzle, and whiskers.
  const maneCenter = { x: size * 0.5, y: size * 0.46 };
  const bumps = 13;
  const mane: Vec2[] = [];
  const steps = 180;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const r = size * (0.38 + 0.05 * Math.cos(bumps * t));
    mane.push({ x: maneCenter.x + r * Math.cos(t), y: maneCenter.y + r * Math.sin(t) });
  }
  const face: Vec2[] = [];
  for (let i = 0; i <= 32; i++) face.push(polar(maneCenter, size * 0.26, (i / 32) * 360));
  const eye = (fx: number) => {
    const loop: Vec2[] = [];
    for (let i = 0; i <= 12; i++) loop.push(polar({ x: size * fx, y: size * 0.42 }, size * 0.024, (i / 12) * 360));
    return loop;
  };
  const nose = polygonEdges(
    fracPoints(size, [
      [0.46, 0.5],
      [0.54, 0.5],
      [0.5, 0.56],
    ]),
    4,
  );
  const muzzle = openPolyline(
    fracPoints(size, [
      [0.4, 0.58],
      [0.5, 0.62],
      [0.6, 0.58],
    ]),
    6,
  );
  const whisker = (mirror: number, fy: number) =>
    openPolyline(
      fracPoints(size, [
        [0.5 + mirror * 0.08, 0.56],
        [0.5 + mirror * 0.26, fy],
      ]),
      5,
    );
  return toPathFromParts(
    [mane, face, eye(0.4), eye(0.6), nose, muzzle, whisker(-1, 0.54), whisker(-1, 0.6), whisker(1, 0.54), whisker(1, 0.6)],
    size,
  );
}

function penguinShape(size: number): DrawingPath {
  // Standing penguin: rounded body, a white belly panel inside it, two eyes, a
  // triangular beak, two flippers at the sides and two webbed feet.
  const body = smoothClosedPath(
    fracPoints(size, [
      [0.5, 0.14],
      [0.64, 0.2],
      [0.68, 0.4],
      [0.68, 0.62],
      [0.6, 0.8],
      [0.5, 0.84],
      [0.4, 0.8],
      [0.32, 0.62],
      [0.32, 0.4],
      [0.36, 0.2],
    ]),
    9,
  );
  // White belly panel: an arc from below the head down around the front.
  const belly = smoothClosedPath(
    fracPoints(size, [
      [0.5, 0.34],
      [0.6, 0.46],
      [0.6, 0.64],
      [0.52, 0.78],
      [0.48, 0.78],
      [0.4, 0.64],
      [0.4, 0.46],
    ]),
    8,
  );
  const eye = (fx: number) => {
    const loop: Vec2[] = [];
    for (let i = 0; i <= 10; i++) loop.push(polar({ x: size * fx, y: size * 0.26 }, size * 0.018, (i / 10) * 360));
    return loop;
  };
  const beak = polygonEdges(
    fracPoints(size, [
      [0.47, 0.3],
      [0.4, 0.34],
      [0.47, 0.36],
    ]),
    4,
  );
  const flipper = (mirror: number) =>
    smoothClosedPath(
      fracPoints(size, [
        [0.5 + mirror * 0.34, 0.4],
        [0.5 + mirror * 0.44, 0.52],
        [0.5 + mirror * 0.36, 0.62],
        [0.5 + mirror * 0.32, 0.5],
      ]),
      6,
    );
  const foot = (mirror: number) =>
    polygonEdges(
      fracPoints(size, [
        [0.5 + mirror * 0.02, 0.84],
        [0.5 + mirror * 0.16, 0.9],
        [0.5 + mirror * 0.02, 0.9],
      ]),
      4,
    );
  return toPathFromParts(
    [body, belly, eye(0.46), eye(0.56), beak, flipper(-1), flipper(1), foot(-1), foot(1)],
    size,
  );
}

function horseShape(size: number): DrawingPath {
  // Full standing-horse silhouette (facing left) - far more unambiguous than a
  // bare head profile. One outline traces head, neck, topline, hindquarters
  // and belly; the four legs and the tail are separate parts, plus an eye.
  const body = smoothClosedPath(
    fracPoints(size, [
      [0.2, 0.14], // crown (top of skull, between the ears)
      [0.16, 0.2], // forehead
      [0.12, 0.29], // nasal bridge / face
      [0.1, 0.37], // muzzle top
      [0.11, 0.43], // nose tip (blunt)
      [0.16, 0.46], // mouth / lower lip
      [0.22, 0.46], // chin
      [0.28, 0.49], // jowl (rounded cheek) into throat
      [0.34, 0.62], // lower neck
      [0.37, 0.68], // brisket / chest
      [0.5, 0.7], // belly
      [0.66, 0.68], // flank
      [0.74, 0.62], // stifle
      [0.84, 0.52], // buttock / tail base
      [0.82, 0.42], // croup (top of rump)
      [0.64, 0.42], // back
      [0.46, 0.44], // withers
      [0.34, 0.38], // crest (back of neck)
      [0.28, 0.28],
      [0.25, 0.2], // poll (back of head)
    ]),
    9,
  );
  // Two pointed ears rising from the top of the head, each its own part.
  const earFront = polygonEdges(
    fracPoints(size, [
      [0.17, 0.18],
      [0.14, 0.08],
      [0.21, 0.16],
    ]),
    4,
  );
  const earBack = polygonEdges(
    fracPoints(size, [
      [0.22, 0.17],
      [0.27, 0.09],
      [0.27, 0.18],
    ]),
    4,
  );
  const leg = (x0: number, x1: number, top: number, bottom: number) =>
    polygonEdges(
      fracPoints(size, [
        [x0, top],
        [x1, top],
        [x1 - 0.005, bottom],
        [x0 + 0.005, bottom],
      ]),
      5,
    );
  const frontFar = leg(0.33, 0.37, 0.66, 0.9);
  const frontNear = leg(0.4, 0.45, 0.67, 0.92);
  const hindFar = leg(0.75, 0.79, 0.64, 0.9);
  const hindNear = leg(0.68, 0.73, 0.66, 0.92);
  // Flowing tail hanging off the rump.
  const tail = smoothClosedPath(
    fracPoints(size, [
      [0.83, 0.46],
      [0.9, 0.58],
      [0.89, 0.78],
      [0.84, 0.8],
      [0.83, 0.58],
      [0.8, 0.5],
    ]),
    8,
  );
  const eye: Vec2[] = [];
  for (let i = 0; i <= 12; i++) eye.push(polar({ x: size * 0.18, y: size * 0.28 }, size * 0.018, (i / 12) * 360));
  return toPathFromParts([body, earFront, earBack, frontFar, frontNear, hindFar, hindNear, tail, eye], size);
}

const ANIMAL_SHAPES: ShapeDefinition[] = [
  standalone("ani-fish", "Fish", "animals", fishShape),
  standalone("ani-bird", "Bird", "animals", birdShape),
  standalone("ani-snail", "Snail", "animals", snailShape),
  standalone("ani-mouse", "Mouse", "animals", mouseShape),
  standalone("ani-cat", "Cat", "animals", catShape),
  standalone("ani-dog", "Dog", "animals", dogShape),
  standalone("ani-rabbit", "Rabbit", "animals", rabbitShape),
  standalone("ani-duck", "Duck", "animals", duckShape),
  standalone("ani-frog", "Frog", "animals", frogShape),
  standalone("ani-pig", "Pig", "animals", pigShape),
  standalone("ani-turtle", "Turtle", "animals", turtleShape),
  standalone("ani-sheep", "Sheep", "animals", sheepShape),
  standalone("ani-fox", "Fox", "animals", foxShape),
  standalone("ani-bear", "Bear", "animals", bearShape),
  standalone("ani-owl", "Owl", "animals", owlShape),
  standalone("ani-butterfly", "Butterfly", "animals", butterflyShape),
  standalone("ani-elephant", "Elephant", "animals", elephantShape),
  standalone("ani-lion", "Lion", "animals", lionShape),
  standalone("ani-penguin", "Penguin", "animals", penguinShape),
  standalone("ani-horse", "Horse", "animals", horseShape),
];

// ==================== NATURE ====================

function leafShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.5, 0.12],
    [0.75, 0.35],
    [0.8, 0.6],
    [0.6, 0.85],
    [0.5, 0.88],
    [0.4, 0.85],
    [0.2, 0.6],
    [0.25, 0.35],
  ]);
  const leaf = smoothClosedPath(pts, 12);
  // central vein running down the middle
  const vein = openPolyline(
    fracPoints(size, [
      [0.5, 0.16],
      [0.5, 0.84],
    ]),
    12,
  );
  return toPath([...leaf, ...vein], size);
}

function simpleFlowerShape(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const petals = 5;
  const outer = size * 0.32;
  const inner = size * 0.1;
  const points: Vec2[] = [];
  const steps = 200;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const r = inner + (outer - inner) * Math.abs(Math.sin((petals / 2) * t));
    points.push({ x: center.x + r * Math.cos(t), y: center.y + r * Math.sin(t) });
  }
  // small center disc where the petals meet
  const withCenter = withDetourLoop(points, points.length - 1, center, size * 0.06);
  return toPath(withCenter.points, size, withCenter.breaks);
}

function treeShape(size: number): DrawingPath {
  // Broadleaf tree: a full lumpy crown of foliage sitting on a flared trunk.
  const crown = smoothClosedPath(
    fracPoints(size, [
      [0.5, 0.07],
      [0.63, 0.11],
      [0.72, 0.21],
      [0.75, 0.34],
      [0.69, 0.47],
      [0.58, 0.53],
      [0.5, 0.52],
      [0.42, 0.53],
      [0.31, 0.47],
      [0.25, 0.34],
      [0.28, 0.21],
      [0.37, 0.11],
    ]),
    10,
  );
  // Trunk with flared roots and a slight center dip at the base. Its top pushes
  // up into the crown so the two overlap and read as one connected tree.
  const trunk = smoothClosedPath(
    fracPoints(size, [
      [0.42, 0.9],
      [0.46, 0.85],
      [0.47, 0.47],
      [0.53, 0.47],
      [0.54, 0.85],
      [0.58, 0.9],
      [0.5, 0.87],
    ]),
    5,
  );
  return toPathFromParts([crown, trunk], size);
}

function cloudShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.25, 0.6],
    [0.2, 0.45],
    [0.32, 0.35],
    [0.4, 0.4],
    [0.45, 0.25],
    [0.62, 0.25],
    [0.68, 0.4],
    [0.8, 0.42],
    [0.82, 0.58],
    [0.7, 0.65],
    [0.3, 0.65],
  ]);
  return toPath(smoothClosedPath(pts, 10), size);
}

function mountainShape(size: number): DrawingPath {
  const vertices = fracPoints(size, [
    [0.1, 0.75],
    [0.35, 0.4],
    [0.48, 0.55],
    [0.6, 0.25],
    [0.9, 0.75],
  ]);
  const ridge = polygonEdges(vertices, 14);
  // snow cap notch on the taller peak
  const snowCap = openPolyline(
    fracPoints(size, [
      [0.53, 0.35],
      [0.6, 0.25],
      [0.67, 0.35],
      [0.6, 0.32],
      [0.55, 0.37],
    ]),
    6,
  );
  return toPathFromParts([ridge, snowCap], size);
}

function sunShape(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const rays = 10;
  const outer = size * 0.36;
  const inner = size * 0.22;
  const vertices: Vec2[] = [];
  for (let i = 0; i < rays * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    vertices.push(polar(center, r, (360 / (rays * 2)) * i - 90));
  }
  return toPath(polygonEdges(vertices, 6), size);
}

function raindropShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.5, 0.15],
    [0.72, 0.5],
    [0.65, 0.72],
    [0.5, 0.8],
    [0.35, 0.72],
    [0.28, 0.5],
  ]);
  return toPath(smoothClosedPath(pts, 12), size);
}

function snowflakeShape(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const radius = size * 0.3;
  const points: Vec2[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = i * 60 - 90;
    const tip = polar(center, radius, angle);
    points.push(center, tip);
    const branchBase = polar(center, radius * 0.6, angle);
    points.push(
      branchBase,
      polar(branchBase, size * 0.06, angle + 90),
      branchBase,
      polar(branchBase, size * 0.06, angle - 90),
      branchBase,
    );
  }
  return toPath(points, size);
}

function rainbowShape(size: number): DrawingPath {
  // Closed into one solid arc slab (outer arc, end cap, inner arc, end cap)
  // instead of 3 bare open arcs with no closing edge at either end. Swept
  // through the top half so the arc bulges upward like a real rainbow (the
  // previous bottom-half sweep both pointed the dome downward and, combined
  // with a low center, pushed its peak below the canvas), and vertically
  // centered so the whole dome fits on-canvas with even margin top and bottom.
  const outerR = size * 0.38;
  const midR = size * 0.3;
  const innerR = size * 0.22;
  const center = { x: size * 0.5, y: (size + outerR) / 2 };
  const steps = 40;
  const outline: Vec2[] = [];
  for (let i = 0; i <= steps; i++) outline.push(polar(center, outerR, -180 + (i / steps) * 180));
  for (let i = 0; i <= steps; i++) outline.push(polar(center, innerR, -(i / steps) * 180));
  outline.push(polar(center, outerR, -180));
  const midStripe: Vec2[] = [];
  for (let i = 0; i <= steps; i++) midStripe.push(polar(center, midR, -180 + (i / steps) * 180));
  return toPathFromParts([outline, midStripe], size);
}

function cactusShape(size: number): DrawingPath {
  // Rounded saguaro: a central trunk with one arm curving up on each side.
  const body = smoothClosedPath(
    fracPoints(size, [
      [0.44, 0.9],
      [0.44, 0.46],
      [0.4, 0.42],
      [0.3, 0.44],
      [0.26, 0.36],
      [0.28, 0.28],
      [0.36, 0.26],
      [0.42, 0.3],
      [0.44, 0.18],
      [0.47, 0.11],
      [0.53, 0.11],
      [0.56, 0.18],
      [0.56, 0.34],
      [0.62, 0.3],
      [0.7, 0.28],
      [0.74, 0.36],
      [0.72, 0.44],
      [0.6, 0.42],
      [0.56, 0.5],
      [0.56, 0.9],
    ]),
    7,
  );
  // Vertical ridge pleats down the trunk.
  const ridge = (x: number, top: number) => openPolyline(fracPoints(size, [[x, top], [x, 0.86]]), 10);
  // A small scalloped blossom on the crown.
  const center = { x: size * 0.5, y: size * 0.09 };
  const flower: Vec2[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r = size * (0.02 + 0.016 * Math.abs(Math.cos(2.5 * a)));
    flower.push({ x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) });
  }
  return toPathFromParts([body, ridge(0.5, 0.16), ridge(0.47, 0.2), ridge(0.53, 0.2), flower], size);
}

function mushroomShape(size: number): DrawingPath {
  // A domed cap overhanging a separate stem with a flared base.
  const cap = smoothClosedPath(
    fracPoints(size, [
      [0.5, 0.18],
      [0.68, 0.24],
      [0.77, 0.4],
      [0.66, 0.46],
      [0.5, 0.49],
      [0.34, 0.46],
      [0.23, 0.4],
      [0.32, 0.24],
    ]),
    12,
  );
  const stem = smoothClosedPath(
    fracPoints(size, [
      [0.42, 0.47],
      [0.41, 0.72],
      [0.37, 0.82],
      [0.5, 0.85],
      [0.63, 0.82],
      [0.59, 0.72],
      [0.58, 0.47],
    ]),
    6,
  );
  const spot = (cx: number, cy: number, r: number): Vec2[] => {
    const c = { x: size * cx, y: size * cy };
    const loop: Vec2[] = [];
    for (let i = 0; i <= 16; i++) loop.push(polar(c, size * r, (i / 16) * 360));
    return loop;
  };
  return toPathFromParts([cap, stem, spot(0.4, 0.3, 0.035), spot(0.58, 0.33, 0.03)], size);
}

function acornShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.5, 0.2],
    [0.68, 0.28],
    [0.72, 0.4],
    [0.65, 0.55],
    [0.5, 0.82],
    [0.35, 0.55],
    [0.28, 0.4],
    [0.32, 0.28],
  ]);
  const acorn = smoothClosedPath(pts, 10);
  // horizontal texture line marking the cap edge
  const capLine = openPolyline(
    fracPoints(size, [
      [0.3, 0.36],
      [0.7, 0.36],
    ]),
    10,
  );
  return toPathFromParts([acorn, capLine], size);
}

function featherShape(size: number): DrawingPath {
  // Vane built by offsetting a gently curved shaft (rachis) by a width profile,
  // giving a symmetric feather pointed at the tip and tapering into a bare quill.
  const p0 = { x: 0.52 * size, y: 0.08 * size };
  const p1 = { x: 0.46 * size, y: 0.42 * size };
  const p2 = { x: 0.44 * size, y: 0.72 * size };
  const spine = (t: number): Vec2 => ({
    x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x,
    y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y,
  });
  const normal = (t: number): Vec2 => {
    const dx = 2 * (1 - t) * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
    const dy = 2 * (1 - t) * (p1.y - p0.y) + 2 * t * (p2.y - p1.y);
    const len = Math.hypot(dx, dy) || 1;
    return { x: -dy / len, y: dx / len };
  };
  const halfWidth = (t: number) => size * 0.12 * Math.sin(Math.PI * Math.pow(t, 0.9));
  const steps = 24;
  const vane: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const s = spine(t);
    const n = normal(t);
    const w = halfWidth(t);
    vane.push({ x: s.x + n.x * w, y: s.y + n.y * w });
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const s = spine(t);
    const n = normal(t);
    const w = halfWidth(t);
    vane.push({ x: s.x - n.x * w, y: s.y - n.y * w });
  }
  vane.push(vane[0]);
  // Rachis continuing past the vane as a bare quill.
  const shaft: Vec2[] = [];
  for (let i = 0; i <= steps; i++) shaft.push(spine(i / steps));
  shaft.push({ x: 0.43 * size, y: 0.83 * size }, { x: 0.42 * size, y: 0.93 * size });
  // Barbs slanting up-and-out from the rachis to each edge of the vane.
  const parts: Vec2[][] = [vane, shaft];
  for (const t of [0.24, 0.38, 0.52, 0.66]) {
    const base = spine(t + 0.05);
    const n = normal(t);
    const edge = spine(t);
    const w = halfWidth(t) * 0.95;
    parts.push([base, { x: edge.x + n.x * w, y: edge.y + n.y * w }]);
    parts.push([base, { x: edge.x - n.x * w, y: edge.y - n.y * w }]);
  }
  return toPathFromParts(parts, size);
}

function seedlingShape(size: number): DrawingPath {
  const stem = openPolyline(
    fracPoints(size, [
      [0.5, 0.85],
      [0.5, 0.5],
    ]),
    16,
  );
  const leafLeft = openPolyline(
    fracPoints(size, [
      [0.5, 0.55],
      [0.3, 0.45],
      [0.28, 0.3],
      [0.45, 0.35],
      [0.5, 0.5],
    ]),
    10,
  );
  const leafRight = openPolyline(
    fracPoints(size, [
      [0.5, 0.5],
      [0.55, 0.35],
      [0.72, 0.3],
      [0.7, 0.45],
      [0.5, 0.55],
    ]),
    10,
  );
  return toPath([...stem, ...leafLeft, ...leafRight], size);
}

function tulipShape(size: number): DrawingPath {
  // Classic tulip bloom: a rounded goblet cup whose rim rises into three petal
  // tips (two outer, one center). Traced as one closed outline for a clean scallop.
  const bloom = smoothClosedPath(
    fracPoints(size, [
      [0.5, 0.14], // center petal tip
      [0.57, 0.24], // dip between center and right petal
      [0.66, 0.15], // right petal tip
      [0.64, 0.34], // right shoulder of the cup
      [0.6, 0.48], // right side wall
      [0.5, 0.54], // rounded base of the cup
      [0.4, 0.48], // left side wall
      [0.36, 0.34], // left shoulder of the cup
      [0.34, 0.15], // left petal tip
      [0.43, 0.24], // dip between left and center petal
    ]),
    12,
  );
  // Inner seams hinting the front petal overlapping the two behind it.
  const seams = openPolyline(
    fracPoints(size, [
      [0.42, 0.22],
      [0.5, 0.5],
      [0.58, 0.22],
    ]),
    10,
  );
  // Slightly curved stem.
  const stem = openPolyline(
    fracPoints(size, [
      [0.5, 0.53],
      [0.51, 0.68],
      [0.5, 0.88],
    ]),
    14,
  );
  // A single long blade leaf sweeping up from the stem.
  const leaf = smoothClosedPath(
    fracPoints(size, [
      [0.5, 0.82],
      [0.66, 0.66],
      [0.72, 0.5],
      [0.62, 0.62],
      [0.52, 0.74],
    ]),
    12,
  );
  return toPathFromParts([bloom, seams, stem, leaf], size);
}

function palmTreeShape(size: number): DrawingPath {
  const quadPoint = (p0: Vec2, p1: Vec2, p2: Vec2, t: number): Vec2 => ({
    x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x,
    y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y,
  });
  const quadNormal = (p0: Vec2, p1: Vec2, p2: Vec2, t: number): Vec2 => {
    const dx = 2 * (1 - t) * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
    const dy = 2 * (1 - t) * (p1.y - p0.y) + 2 * t * (p2.y - p1.y);
    const len = Math.hypot(dx, dy) || 1;
    return { x: -dy / len, y: dx / len };
  };
  // A tapered band offset from a bezier spine - used for both the trunk and each frond blade.
  const blade = (p0: Vec2, p1: Vec2, p2: Vec2, widthFn: (t: number) => number, steps: number): Vec2[] => {
    const pts: Vec2[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const s = quadPoint(p0, p1, p2, t);
      const n = quadNormal(p0, p1, p2, t);
      const w = widthFn(t);
      pts.push({ x: s.x + n.x * w, y: s.y + n.y * w });
    }
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const s = quadPoint(p0, p1, p2, t);
      const n = quadNormal(p0, p1, p2, t);
      const w = widthFn(t);
      pts.push({ x: s.x - n.x * w, y: s.y - n.y * w });
    }
    pts.push(pts[0]);
    return pts;
  };

  // Trunk: gentle lean, tapering from a wide base to a narrow crown.
  const trunkBase = { x: 0.5 * size, y: 0.94 * size };
  const trunkMid = { x: 0.62 * size, y: 0.55 * size };
  const crown = { x: 0.54 * size, y: 0.27 * size };
  const trunk = blade(trunkBase, trunkMid, crown, (t) => size * (0.02 + 0.035 * (1 - t)), 22);

  // Fronds fan out from the crown: the center blade points up, outer ones arc over and droop down.
  const fronds = [-1, -0.5, 0, 0.5, 1].map((k) => {
    const ctrl = { x: crown.x + k * 0.3 * size, y: crown.y - size * (0.28 - 0.06 * Math.abs(k)) };
    const tip = { x: crown.x + k * 0.46 * size, y: crown.y + size * (-0.18 + 0.3 * Math.abs(k)) };
    return blade(crown, ctrl, tip, (t) => size * 0.045 * Math.sin(Math.PI * t), 16);
  });

  // A pair of coconuts hanging just under the crown.
  const coconutCenter = { x: crown.x - size * 0.015, y: crown.y + size * 0.05 };
  const coconut = (offset: Vec2, r: number) => {
    const center = { x: coconutCenter.x + offset.x, y: coconutCenter.y + offset.y };
    const loop: Vec2[] = [];
    for (let i = 0; i <= 14; i++) loop.push(polar(center, r, (i / 14) * 360));
    return loop;
  };

  return toPathFromParts(
    [trunk, ...fronds, coconut({ x: -size * 0.028, y: size * 0.01 }, size * 0.032), coconut({ x: size * 0.028, y: size * 0.015 }, size * 0.032)],
    size,
  );
}

function volcanoShape(size: number): DrawingPath {
  const vertices = fracPoints(size, [
    [0.15, 0.8],
    [0.42, 0.35],
    [0.5, 0.45],
    [0.58, 0.35],
    [0.85, 0.8],
  ]);
  const pointsPerEdge = 12;
  const body = polygonEdges(vertices, pointsPerEdge);
  const withSmoke = withDetourLoop(body, 2 * pointsPerEdge, { x: size * 0.5, y: size * 0.22 }, size * 0.04);
  return toPath(withSmoke.points, size, withSmoke.breaks);
}

function stormCloudShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.25, 0.55],
    [0.2, 0.42],
    [0.32, 0.32],
    [0.4, 0.37],
    [0.45, 0.25],
    [0.62, 0.25],
    [0.68, 0.37],
    [0.8, 0.4],
    [0.82, 0.55],
    [0.7, 0.6],
    [0.3, 0.6],
  ]);
  const cloud = smoothClosedPath(pts, 10);
  const bolt = openPolyline(
    fracPoints(size, [
      [0.5, 0.62],
      [0.42, 0.78],
      [0.55, 0.78],
      [0.45, 0.92],
    ]),
    10,
  );
  return toPath([...cloud, ...bolt], size);
}

function oceanWaveShape(size: number): DrawingPath {
  const points: Vec2[] = [];
  const rows = 3;
  for (let r = 0; r < rows; r++) {
    const y = size * (0.35 + r * 0.15);
    const steps = 30;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = r % 2 === 0 ? size * (0.2 + t * 0.6) : size * (0.8 - t * 0.6);
      points.push({ x, y: y + size * 0.04 * Math.sin(t * Math.PI * 3) });
    }
  }
  return toPath(points, size);
}

const NATURE_SHAPES: ShapeDefinition[] = [
  standalone("nat-leaf", "Leaf", "nature", leafShape),
  standalone("nat-raindrop", "Raindrop", "nature", raindropShape),
  standalone("nat-flower", "Flower", "nature", simpleFlowerShape),
  standalone("nat-tulip", "Tulip", "nature", tulipShape),
  standalone("nat-mushroom", "Mushroom", "nature", mushroomShape),
  standalone("nat-acorn", "Acorn", "nature", acornShape),
  standalone("nat-seedling", "Seedling", "nature", seedlingShape),
  standalone("nat-tree", "Tree", "nature", treeShape),
  standalone("nat-palmtree", "Palm Tree", "nature", palmTreeShape),
  standalone("nat-cactus", "Cactus", "nature", cactusShape),
  standalone("nat-feather", "Feather", "nature", featherShape),
  standalone("nat-cloud", "Cloud", "nature", cloudShape),
  standalone("nat-stormcloud", "Storm Cloud", "nature", stormCloudShape),
  standalone("nat-rainbow", "Rainbow", "nature", rainbowShape),
  standalone("nat-snowflake", "Snowflake", "nature", snowflakeShape),
  standalone("nat-mountain", "Mountain", "nature", mountainShape),
  standalone("nat-volcano", "Volcano", "nature", volcanoShape),
  standalone("nat-oceanwave", "Ocean Wave", "nature", oceanWaveShape),
  standalone("nat-sun", "Sun", "nature", sunShape),
  standalone("nat-moon", "Moon", "nature", crescentMoon),
];

// ==================== FOOD ====================

function appleShape(size: number): DrawingPath {
  // Symmetric body with a dimple at the top (stem well) and at the bottom.
  const pts = fracPoints(size, [
    [0.5, 0.2],
    [0.62, 0.12],
    [0.76, 0.16],
    [0.84, 0.34],
    [0.82, 0.55],
    [0.7, 0.76],
    [0.58, 0.85],
    [0.5, 0.8],
    [0.42, 0.85],
    [0.3, 0.76],
    [0.18, 0.55],
    [0.16, 0.34],
    [0.24, 0.16],
    [0.38, 0.12],
  ]);
  const apple = smoothClosedPath(pts, 10);
  // Curved stem rising out of the top dimple.
  const stem = openPolyline(
    fracPoints(size, [
      [0.5, 0.19],
      [0.51, 0.1],
      [0.55, 0.03],
    ]),
    8,
  );
  const leaf = smoothClosedPath(
    fracPoints(size, [
      [0.55, 0.08],
      [0.65, 0.02],
      [0.74, 0.05],
      [0.66, 0.12],
    ]),
    8,
  );
  // Midrib vein down the center of the leaf.
  const leafVein = openPolyline(
    fracPoints(size, [
      [0.57, 0.08],
      [0.7, 0.06],
    ]),
    6,
  );
  return toPathFromParts([apple, stem, leaf, leafVein], size);
}

function watermelonShape(size: number): DrawingPath {
  // Classic slice: a semicircle with the cut face flat on top and the rind
  // curving underneath. The outer edge plus a concentric inner arc read as
  // the green rind band; teardrop seeds are scattered through the flesh.
  const c = { x: 0.5 * size, y: 0.32 * size };
  const rOuter = 0.36 * size;
  const rInner = 0.275 * size;

  const slice: Vec2[] = [polar(c, rOuter, 180)]; // left corner of the flat top
  slice.push(polar(c, rOuter, 0)); // straight across to the right corner
  for (let i = 0; i <= 44; i++) slice.push(polar(c, rOuter, (i / 44) * 180)); // arc right -> bottom -> left

  const rind: Vec2[] = [];
  for (let i = 0; i <= 44; i++) rind.push(polar(c, rInner, (i / 44) * 180));

  const seed = (fx: number, fy: number): Vec2[] => {
    const cx = fx * size;
    const cy = fy * size;
    const ang = Math.atan2(cy - c.y, cx - c.x); // long axis points radially outward
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const sx = 0.032 * size;
    const sy = 0.014 * size;
    const oval: Vec2[] = [];
    for (let i = 0; i <= 14; i++) {
      const t = (i / 14) * Math.PI * 2;
      const ex = sx * Math.cos(t);
      const ey = sy * Math.sin(t);
      oval.push({ x: cx + ex * cos - ey * sin, y: cy + ex * sin + ey * cos });
    }
    return oval;
  };
  const seeds = [seed(0.5, 0.45), seed(0.39, 0.47), seed(0.61, 0.47), seed(0.45, 0.56), seed(0.55, 0.56)];

  return toPathFromParts([slice, rind, ...seeds], size);
}

function pizzaShape(size: number): DrawingPath {
  // The crust is a true circular arc centered on the tip (like a real pizza
  // slice's outer edge) instead of two straight segments meeting in a peak.
  const tip = { x: size * 0.5, y: size * 0.85 };
  const crustR = size * 0.6946;
  const slice: Vec2[] = [tip];
  for (let i = 0; i <= 30; i++) slice.push(polar(tip, crustR, -120.3 + (i / 30) * 60.6));
  slice.push(tip);
  // pepperoni dots scattered on the slice
  const pepperoniParts: Vec2[][] = [slice];
  for (const [fx, fy] of [
    [0.42, 0.38],
    [0.58, 0.4],
    [0.48, 0.52],
    [0.4, 0.62],
  ] as [number, number][]) {
    const c = { x: size * fx, y: size * fy };
    const dot: Vec2[] = [];
    for (let i = 0; i <= 12; i++) dot.push(polar(c, size * 0.025, (i / 12) * 360));
    pepperoniParts.push(dot);
  }
  return toPathFromParts(pepperoniParts, size);
}

function iceCreamShape(size: number): DrawingPath {
  const f = (fx: number, fy: number): Vec2 => ({ x: fx * size, y: fy * size });

  // Waffle cone: a downward-pointing triangle.
  const cone = polygonEdges([f(0.34, 0.5), f(0.66, 0.5), f(0.5, 0.92)], 12);

  // Crosshatch waffle texture: two sets of diagonals forming diamonds, all
  // kept well inside the tapering triangle.
  const hatch: Vec2[][] = [
    [f(0.42, 0.7), f(0.6, 0.56)],
    [f(0.46, 0.8), f(0.58, 0.62)],
    [f(0.4, 0.56), f(0.58, 0.7)],
    [f(0.42, 0.62), f(0.54, 0.8)],
  ];

  // Scoop: a rounded ball overhanging the cone rim, bulging slightly onto it.
  const scoop = smoothClosedPath(
    fracPoints(size, [
      [0.3, 0.48],
      [0.31, 0.36],
      [0.38, 0.28],
      [0.44, 0.24],
      [0.5, 0.23],
      [0.56, 0.24],
      [0.62, 0.28],
      [0.69, 0.36],
      [0.7, 0.48],
      [0.5, 0.52],
    ]),
    8,
  );

  return toPathFromParts([cone, ...hatch, scoop], size);
}

function cupcakeShape(size: number): DrawingPath {
  const f = (fx: number, fy: number): Vec2 => ({ x: fx * size, y: fy * size });

  // Fluted wrapper: a trapezoid, wider at the top than the base.
  const wrapper = polygonEdges([f(0.32, 0.56), f(0.68, 0.56), f(0.6, 0.83), f(0.4, 0.83)], 10);

  // Vertical flute ridges following the wrapper's taper (top width 0.36 -> base 0.2).
  const ridge = (topX: number): Vec2[] => {
    const botX = 0.5 + (topX - 0.5) * (0.2 / 0.36);
    return [f(topX, 0.57), f(botX, 0.82)];
  };
  const ridges = [ridge(0.41), ridge(0.5), ridge(0.59)];

  // Swirled frosting dome, overhanging the wrapper rim, rising to a peak.
  const frosting = smoothClosedPath(
    fracPoints(size, [
      [0.3, 0.56],
      [0.3, 0.46],
      [0.38, 0.42],
      [0.34, 0.36],
      [0.42, 0.32],
      [0.4, 0.26],
      [0.5, 0.22],
      [0.6, 0.26],
      [0.58, 0.32],
      [0.66, 0.36],
      [0.62, 0.42],
      [0.7, 0.46],
      [0.7, 0.56],
    ]),
    8,
  );

  // Cherry on top, as its own floating loop above the peak.
  const cherryC = f(0.5, 0.19);
  const cherry: Vec2[] = [];
  for (let i = 0; i <= 14; i++) cherry.push(polar(cherryC, 0.035 * size, (i / 14) * 360));

  return toPathFromParts([wrapper, ...ridges, frosting, cherry], size);
}

function cherryShape(size: number): DrawingPath {
  const center = { x: size * 0.5, y: size * 0.6 };
  const radius = size * 0.22;
  const points: Vec2[] = [];
  for (let i = 0; i <= 60; i++) points.push(polar(center, radius, (i / 60) * 360 - 90));
  points.push(
    { x: center.x, y: center.y - radius },
    { x: center.x - radius * 0.3, y: center.y - radius * 1.6 },
    { x: center.x + radius * 0.2, y: center.y - radius * 2.1 },
  );
  return toPath(points, size);
}

function cookieShape(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const r = size * 0.3;
  const outline: Vec2[] = [];
  for (let i = 0; i <= 60; i++) outline.push(polar(center, r, (i / 60) * 360 - 90));
  const chipParts: Vec2[][] = [outline];
  for (const [fx, fy] of [
    [0.42, 0.4],
    [0.6, 0.42],
    [0.5, 0.55],
    [0.35, 0.6],
    [0.62, 0.65],
  ] as [number, number][]) {
    const dot = { x: size * fx, y: size * fy };
    chipParts.push([dot, polar(dot, size * 0.02, 0), dot]);
  }
  return toPathFromParts(chipParts, size);
}

function pretzelShape(size: number): DrawingPath {
  // A pretzel is a single continuous strand of dough: two little end nubs at the
  // top, two strands crossing in an X just below them (the twist), and a big
  // round belly loop underneath. Traced as one open Catmull-Rom stroke so the
  // two nubs stay as free ends with a valley between them (no line across the
  // top) while the crossing reads as the signature knot.
  const key = fracPoints(size, [
    [0.6, 0.24], // right end nub
    [0.55, 0.34],
    [0.46, 0.46], // diagonal 1: upper-right down toward centre
    [0.36, 0.54], // ...crossing past centre to the left
    [0.22, 0.58], // left belly shoulder
    [0.17, 0.72],
    [0.3, 0.84], // lower-left of the belly
    [0.5, 0.88], // bottom centre
    [0.7, 0.84], // lower-right of the belly
    [0.83, 0.72],
    [0.78, 0.58], // right belly shoulder
    [0.64, 0.54], // diagonal 2: lower-right up toward centre
    [0.54, 0.46], // ...crossing past centre to the right
    [0.45, 0.34],
    [0.4, 0.24], // left end nub
  ]);

  const pointsPerSegment = 12;
  const points: Vec2[] = [];
  for (let i = 0; i < key.length - 1; i++) {
    const p0 = key[Math.max(0, i - 1)];
    const p1 = key[i];
    const p2 = key[i + 1];
    const p3 = key[Math.min(key.length - 1, i + 2)];
    for (let step = 0; step < pointsPerSegment; step++) {
      points.push(catmullRomPoint(p0, p1, p2, p3, step / pointsPerSegment));
    }
  }
  points.push(key[key.length - 1]);
  return toPath(points, size);
}

function bananaShape(size: number): DrawingPath {
  // Body built by offsetting a quadratic-bezier spine by a thickness profile,
  // so the two edges stay parallel through the middle and taper at the ends.
  const p0 = { x: 0.62 * size, y: 0.12 * size };
  const p1 = { x: 0.22 * size, y: 0.28 * size };
  const p2 = { x: 0.32 * size, y: 0.8 * size };
  const spine = (t: number): Vec2 => ({
    x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x,
    y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y,
  });
  const normal = (t: number): Vec2 => {
    const dx = 2 * (1 - t) * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
    const dy = 2 * (1 - t) * (p1.y - p0.y) + 2 * t * (p2.y - p1.y);
    const len = Math.hypot(dx, dy) || 1;
    return { x: -dy / len, y: dx / len };
  };
  const halfWidth = (t: number) => size * (0.015 + 0.07 * Math.sin(Math.PI * t));
  const steps = 26;
  const body: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const s = spine(t);
    const n = normal(t);
    const w = halfWidth(t);
    body.push({ x: s.x + n.x * w, y: s.y + n.y * w });
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const s = spine(t);
    const n = normal(t);
    const w = halfWidth(t);
    body.push({ x: s.x - n.x * w, y: s.y - n.y * w });
  }
  body.push(body[0]);
  // Cut-off stalk stub continuing from the blunt stem end.
  const stemCap = openPolyline(
    fracPoints(size, [
      [0.615, 0.105],
      [0.68, 0.08],
      [0.69, 0.108],
      [0.625, 0.135],
    ]),
    5,
  );
  // Small blossom nub at the tip.
  const nub = openPolyline(
    fracPoints(size, [
      [0.325, 0.815],
      [0.34, 0.875],
    ]),
    6,
  );
  // Peel seam running along the convex side, slightly off the center line.
  const ridge: Vec2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = 0.08 + (i / 10) * 0.84;
    const s = spine(t);
    const n = normal(t);
    const w = halfWidth(t) * 0.45;
    ridge.push({ x: s.x + n.x * w, y: s.y + n.y * w });
  }
  return toPathFromParts([body, stemCap, nub, ridge], size);
}

function eggShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.5, 0.14],
    [0.72, 0.32],
    [0.78, 0.6],
    [0.6, 0.84],
    [0.4, 0.84],
    [0.22, 0.6],
    [0.28, 0.32],
  ]);
  return toPath(smoothClosedPath(pts, 12), size);
}

function donutShape(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const outer: Vec2[] = [];
  for (let i = 0; i <= 70; i++) outer.push(polar(center, size * 0.32, (i / 70) * 360 - 90));
  const inner: Vec2[] = [];
  for (let i = 0; i <= 50; i++) inner.push(polar(center, size * 0.13, -90 + (i / 50) * 360));
  // no connecting line between the two rings - just a clean jump
  return toPath([...outer, ...inner], size, [outer.length]);
}

function carrotShape(size: number): DrawingPath {
  const f = (fx: number, fy: number): Vec2 => ({ x: fx * size, y: fy * size });

  // Root: wide rounded shoulder at the top tapering to a sharp point at the
  // bottom (~1:3 width:length), built as a smooth closed outline.
  const body = smoothClosedPath(
    fracPoints(size, [
      [0.36, 0.34],
      [0.42, 0.29],
      [0.5, 0.28],
      [0.58, 0.29],
      [0.64, 0.34],
      [0.585, 0.5],
      [0.545, 0.68],
      [0.51, 0.84],
      [0.5, 0.92], // pointed tip
      [0.49, 0.84],
      [0.455, 0.68],
      [0.415, 0.5],
    ]),
    9,
  );

  // Signature horizontal ridges across the root, each a short bowed line.
  const ridge = (x0: number, x1: number, y: number): Vec2[] =>
    openPolyline([f(x0, y), f((x0 + x1) / 2, y + 0.02), f(x1, y)], 6);
  const ridges = [ridge(0.42, 0.58, 0.42), ridge(0.455, 0.545, 0.57), ridge(0.485, 0.515, 0.71)];

  // Leafy top: three almond-shaped fronds fanning up from the shoulder, each
  // its own closed part with real width.
  const leaf = (bx: number, by: number, tx: number, ty: number, w: number): Vec2[] => {
    const B = f(bx, by);
    const T = f(tx, ty);
    const dx = T.x - B.x;
    const dy = T.y - B.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * w * size;
    const ny = (dx / len) * w * size;
    const mid = { x: (B.x + T.x) / 2, y: (B.y + T.y) / 2 };
    return smoothClosedPath([B, { x: mid.x + nx, y: mid.y + ny }, T, { x: mid.x - nx, y: mid.y - ny }], 8);
  };
  const leaves = [
    leaf(0.5, 0.3, 0.5, 0.05, 0.045),
    leaf(0.47, 0.31, 0.37, 0.1, 0.04),
    leaf(0.53, 0.31, 0.63, 0.1, 0.04),
  ];

  return toPathFromParts([body, ...ridges, ...leaves], size);
}

function grapesShape(size: number): DrawingPath {
  const centers: [number, number][] = [
    [0.5, 0.28],
    [0.38, 0.4],
    [0.62, 0.4],
    [0.3, 0.55],
    [0.5, 0.55],
    [0.7, 0.55],
    [0.4, 0.7],
    [0.6, 0.7],
    [0.5, 0.83],
  ];
  const r = size * 0.1;
  const stem: Vec2[] = [
    { x: size * 0.5, y: size * 0.28 },
    { x: size * 0.5, y: size * 0.1 },
  ];
  const parts: Vec2[][] = [stem];
  for (const [fx, fy] of centers) {
    const c = { x: size * fx, y: size * fy };
    const grape: Vec2[] = [];
    for (let i = 0; i <= 20; i++) grape.push(polar(c, r, (i / 20) * 360 - 90));
    parts.push(grape);
  }
  return toPathFromParts(parts, size);
}

function strawberryShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.5, 0.32],
    [0.72, 0.4],
    [0.65, 0.65],
    [0.5, 0.88],
    [0.35, 0.65],
    [0.28, 0.4],
  ]);
  const body = smoothClosedPath(pts, 12);
  const leaves = openPolyline(
    fracPoints(size, [
      [0.5, 0.32],
      [0.38, 0.16],
      [0.46, 0.28],
      [0.5, 0.12],
      [0.54, 0.28],
      [0.62, 0.16],
      [0.5, 0.32],
    ]),
    8,
  );
  return toPath([...body, ...leaves], size);
}

function waffleShape(size: number): DrawingPath {
  // Replaces the taco - a plain geometric grid square is a simpler, more
  // iconic shape than the taco shell's freeform curve.
  const outline = polygonEdges(
    fracPoints(size, [
      [0.2, 0.2],
      [0.8, 0.2],
      [0.8, 0.8],
      [0.2, 0.8],
    ]),
    14,
  );
  const gridParts: Vec2[][] = [outline];
  for (const frac of [0.4, 0.6]) {
    gridParts.push(
      openPolyline(
        fracPoints(size, [
          [frac, 0.2],
          [frac, 0.8],
        ]),
        8,
      ),
      openPolyline(
        fracPoints(size, [
          [0.2, frac],
          [0.8, frac],
        ]),
        8,
      ),
    );
  }
  return toPathFromParts(gridParts, size);
}

function hamburgerShape(size: number): DrawingPath {
  const f = (fx: number, fy: number): Vec2 => ({ x: fx * size, y: fy * size });

  // Top bun: a half-ellipse dome closed off with a flat bottom edge.
  const domeC = { x: 0.5 * size, y: 0.42 * size };
  const rx = 0.3 * size;
  const ry = 0.23 * size;
  const bunTop: Vec2[] = [];
  for (let i = 0; i <= 44; i++) {
    const a = Math.PI + (i / 44) * Math.PI; // left rim, over the top, to right rim
    bunTop.push({ x: domeC.x + rx * Math.cos(a), y: domeC.y + ry * Math.sin(a) });
  }
  bunTop.push({ x: domeC.x - rx, y: domeC.y }); // close the flat bottom

  // Three sesame seeds (small tilted ovals) scattered on the dome.
  const seed = (cx: number, cy: number, tilt: number): Vec2[] => {
    const c = f(cx, cy);
    const sx = 0.02 * size;
    const sy = 0.036 * size;
    const cos = Math.cos(tilt);
    const sin = Math.sin(tilt);
    const oval: Vec2[] = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const ex = sx * Math.cos(a);
      const ey = sy * Math.sin(a);
      oval.push({ x: c.x + ex * cos - ey * sin, y: c.y + ex * sin + ey * cos });
    }
    return oval;
  };
  const seeds = [seed(0.4, 0.3, -0.5), seed(0.5, 0.26, 0), seed(0.6, 0.3, 0.5)];

  // Lettuce: a band with a wavy (scalloped) lower edge poking out past the buns.
  const lx0 = 0.15;
  const lx1 = 0.85;
  const lyTop = 0.44;
  const lyBot = 0.5;
  const lettuce: Vec2[] = [f(lx0, lyTop), f(lx1, lyTop)];
  for (let i = 0; i <= 28; i++) {
    const t = i / 28;
    const x = (lx1 - (lx1 - lx0) * t) * size;
    const y = (lyBot + 0.025 * Math.sin(t * Math.PI * 7)) * size;
    lettuce.push({ x, y });
  }
  lettuce.push(f(lx0, lyTop)); // close

  // Patty: a rounded bar.
  const patty = smoothClosedPath(
    fracPoints(size, [
      [0.21, 0.575],
      [0.25, 0.53],
      [0.5, 0.52],
      [0.75, 0.53],
      [0.79, 0.575],
      [0.75, 0.62],
      [0.5, 0.63],
      [0.25, 0.62],
    ]),
    8,
  );

  // Bottom bun: flat top with a rounded bottom.
  const bbC = { x: 0.5 * size, y: 0.66 * size };
  const brx = 0.28 * size;
  const bry = 0.16 * size;
  const bottomBun: Vec2[] = [f(0.22, 0.66), f(0.78, 0.66)];
  for (let i = 0; i <= 44; i++) {
    const a = (i / 44) * Math.PI; // right rim, under the bottom, to left rim
    bottomBun.push({ x: bbC.x + brx * Math.cos(a), y: bbC.y + bry * Math.sin(a) });
  }

  return toPathFromParts([bunTop, ...seeds, lettuce, patty, bottomBun], size);
}

function hotDogShape(size: number): DrawingPath {
  // Sausage with rounded ends poking out of the bun on both sides.
  const sausage = smoothClosedPath(
    fracPoints(size, [
      [0.1, 0.5],
      [0.14, 0.43],
      [0.3, 0.39],
      [0.5, 0.37],
      [0.7, 0.39],
      [0.86, 0.43],
      [0.9, 0.5],
      [0.86, 0.57],
      [0.7, 0.59],
      [0.5, 0.6],
      [0.3, 0.59],
      [0.14, 0.57],
    ]),
    8,
  );
  // Bottom bun half cradling the sausage.
  const bun = smoothClosedPath(
    fracPoints(size, [
      [0.16, 0.56],
      [0.5, 0.58],
      [0.84, 0.56],
      [0.88, 0.63],
      [0.82, 0.73],
      [0.5, 0.77],
      [0.18, 0.73],
      [0.12, 0.63],
    ]),
    8,
  );
  // Wavy mustard squiggle along the top of the sausage.
  const mustard = openPolyline(
    fracPoints(size, [
      [0.2, 0.5],
      [0.28, 0.44],
      [0.36, 0.52],
      [0.44, 0.44],
      [0.52, 0.52],
      [0.6, 0.44],
      [0.68, 0.52],
      [0.76, 0.46],
    ]),
    6,
  );
  return toPathFromParts([sausage, bun, mustard], size);
}

function lollipopShape(size: number): DrawingPath {
  const center = { x: size * 0.5, y: size * 0.32 };
  const points: Vec2[] = [];
  const steps = 100;
  const turns = 2.2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push(polar(center, size * 0.03 + t * size * 0.24, t * turns * 360));
  }
  points.push({ x: size * 0.5, y: size * 0.56 }, { x: size * 0.5, y: size * 0.88 });
  return toPath(points, size);
}

function cheeseWedgeShape(size: number): DrawingPath {
  const vertices = fracPoints(size, [
    [0.2, 0.3],
    [0.65, 0.2],
    [0.85, 0.75],
    [0.2, 0.75],
  ]);
  const body = polygonEdges(vertices, 14);
  // Insert the later (higher-index) hole first, so its anchor position is still
  // valid against the original body - otherwise the second insertion below
  // would land inside the first hole's own loop instead of the intended spot.
  const holeB = withDetourLoop(body, 14 * 3, { x: size * 0.65, y: size * 0.6 }, size * 0.04);
  const holeA = withDetourLoop(holeB.points, 14 * 2, { x: size * 0.5, y: size * 0.5 }, size * 0.05);
  const insertedLength = holeA.points.length - holeB.points.length;
  const shiftedHoleBBreaks = holeB.breaks.map((b) => (b > 14 * 2 ? b + insertedLength : b));
  const breaks = [...shiftedHoleBBreaks, ...holeA.breaks].sort((a, b) => a - b);
  return toPath(holeA.points, size, breaks);
}

function coffeeCupShape(size: number): DrawingPath {
  // A closed, gently tapered cup body (the old outline never connected back
  // to its start, leaving the left side open) sitting on a saucer, with a
  // bigger handle properly sized to the cup.
  const pts = fracPoints(size, [
    [0.28, 0.28],
    [0.68, 0.28],
    [0.62, 0.7],
    [0.34, 0.7],
  ]);
  const cup = polygonEdges(pts, 14);
  const handleCenter = { x: size * 0.76, y: size * 0.48 };
  const handle: Vec2[] = [];
  for (let i = 0; i <= 30; i++) handle.push(polar(handleCenter, size * 0.13, -100 + (i / 30) * 200));
  const saucer = openPolyline(
    fracPoints(size, [
      [0.12, 0.74],
      [0.3, 0.82],
      [0.5, 0.84],
      [0.7, 0.82],
      [0.88, 0.74],
    ]),
    10,
  );
  return toPathFromParts([cup, handle, saucer], size);
}

const FOOD_SHAPES: ShapeDefinition[] = [
  standalone("food-cherry", "Cherry", "food", cherryShape),
  standalone("food-donut", "Donut", "food", donutShape),
  standalone("food-egg", "Egg", "food", eggShape),
  standalone("food-cookie", "Cookie", "food", cookieShape),
  standalone("food-banana", "Banana", "food", bananaShape),
  standalone("food-carrot", "Carrot", "food", carrotShape),
  standalone("food-strawberry", "Strawberry", "food", strawberryShape),
  standalone("food-pretzel", "Pretzel", "food", pretzelShape),
  standalone("food-cheesewedge", "Cheese Wedge", "food", cheeseWedgeShape),
  standalone("food-apple", "Apple", "food", appleShape),
  standalone("food-watermelon", "Watermelon", "food", watermelonShape),
  standalone("food-pizza", "Pizza", "food", pizzaShape),
  standalone("food-icecream", "Ice Cream", "food", iceCreamShape),
  standalone("food-lollipop", "Lollipop", "food", lollipopShape),
  standalone("food-waffle", "Waffle", "food", waffleShape),
  standalone("food-hotdog", "Hot Dog", "food", hotDogShape),
  standalone("food-coffeecup", "Coffee Cup", "food", coffeeCupShape),
  standalone("food-cupcake", "Cupcake", "food", cupcakeShape),
  standalone("food-grapes", "Grapes", "food", grapesShape),
  standalone("food-hamburger", "Hamburger", "food", hamburgerShape),
];

// ==================== SPORTS ====================

function basketballShape(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const r = size * 0.32;
  const points: Vec2[] = [];
  for (let i = 0; i <= 70; i++) points.push(polar(center, r, (i / 70) * 360 - 90));
  // classic vertical + horizontal seam cross
  points.push(polar(center, r, 90), polar(center, r, -90));
  points.push(center, polar(center, r, 0), polar(center, r, 180));
  return toPath(points, size);
}

function soccerBallShape(size: number): DrawingPath {
  // A seam radiates from every pentagon vertex to the rim (all 5, following
  // the pentagon's own edges between them) instead of just 2 of the 5, which
  // looked lopsided - like only part of the panel was attached to the ball.
  const center = { x: size / 2, y: size / 2 };
  const r = size * 0.32;
  const pentR = r * 0.45;
  const angles = [0, 1, 2, 3, 4].map((i) => -90 + (360 / 5) * i);
  const pentagon = angles.map((a) => polar(center, pentR, a));
  const points: Vec2[] = [];
  for (let i = 0; i <= 70; i++) points.push(polar(center, r, (i / 70) * 360 - 90));
  points.push(pentagon[0]);
  for (let i = 0; i < angles.length; i++) {
    points.push(polar(center, r, angles[i]), pentagon[i], pentagon[(i + 1) % angles.length]);
  }
  return toPath(points, size);
}

function tennisBallShape(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const r = size * 0.32;
  const points: Vec2[] = [];
  for (let i = 0; i <= 70; i++) points.push(polar(center, r, (i / 70) * 360 - 90));
  const steps = 30;
  // the two curved seam arcs that give a tennis ball its signature look
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({ x: center.x + r * 0.55 * Math.sin(t * Math.PI), y: center.y - r + t * r * 2 });
  }
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({ x: center.x - r * 0.55 * Math.sin(t * Math.PI), y: center.y - r + t * r * 2 });
  }
  return toPath(points, size);
}

function trophyShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.3, 0.2],
    [0.7, 0.2],
    [0.68, 0.4],
    [0.85, 0.35],
    [0.8, 0.5],
    [0.6, 0.55],
    [0.58, 0.65],
    [0.68, 0.75],
    [0.68, 0.82],
    [0.32, 0.82],
    [0.32, 0.75],
    [0.42, 0.65],
    [0.4, 0.55],
    [0.2, 0.5],
    [0.15, 0.35],
    [0.32, 0.4],
  ]);
  const cup = smoothClosedPath(pts, 6);
  // small engraved star on the cup face
  const star = openPolyline(
    fracPoints(size, [
      [0.5, 0.3],
      [0.53, 0.37],
      [0.6, 0.38],
      [0.54, 0.43],
      [0.56, 0.5],
      [0.5, 0.46],
      [0.44, 0.5],
      [0.46, 0.43],
      [0.4, 0.38],
      [0.47, 0.37],
      [0.5, 0.3],
    ]),
    4,
  );
  return toPathFromParts([cup, star], size);
}

function medalShape(size: number): DrawingPath {
  const center = { x: size * 0.5, y: size * 0.62 };
  const r = size * 0.22;
  // V-shaped ribbon band with real width instead of two bare lines.
  const ribbon = polygonEdges(
    fracPoints(size, [
      [0.33, 0.08],
      [0.5, 0.38],
      [0.67, 0.08],
      [0.59, 0.08],
      [0.5, 0.24],
      [0.41, 0.08],
    ]),
    8,
  );
  const disc: Vec2[] = [];
  for (let i = 0; i <= 60; i++) disc.push(polar(center, r, (i / 60) * 360 - 90));
  const rim: Vec2[] = [];
  for (let i = 0; i <= 40; i++) rim.push(polar(center, r * 0.68, (i / 40) * 360 - 90));
  // Embossed five-pointed star on the medal face.
  const starVertices: Vec2[] = [];
  for (let i = 0; i < 10; i++) {
    starVertices.push(polar(center, i % 2 === 0 ? r * 0.45 : r * 0.19, i * 36 - 90));
  }
  const star = polygonEdges(starVertices, 3);
  return toPathFromParts([ribbon, disc, rim, star], size);
}

function racketShape(size: number): DrawingPath {
  // The handle used to be appended right after the last string point (the
  // head's right edge), drawing a diagonal line across the lower head to
  // reach it - now it's its own part.
  const head = { x: size * 0.5, y: size * 0.35 };
  const rx = size * 0.22;
  const ry = size * 0.28;
  const headOutline: Vec2[] = [];
  for (let i = 0; i <= 60; i++) {
    const t = (i / 60) * Math.PI * 2;
    headOutline.push({ x: head.x + rx * Math.sin(t), y: head.y - ry * Math.cos(t) });
  }
  // a vertical and horizontal string line crossing at the center - routed
  // through the center point itself so there's no stray diagonal between the
  // top of the vertical line and the start of the horizontal one.
  const strings = [
    { x: head.x, y: head.y - ry },
    { x: head.x, y: head.y + ry },
    head,
    { x: head.x - rx, y: head.y },
    head,
    { x: head.x + rx, y: head.y },
  ];
  const handle = [
    { x: size * 0.5, y: size * 0.6 },
    { x: size * 0.5, y: size * 0.88 },
  ];
  return toPathFromParts([[...headOutline, ...strings], handle], size);
}

function volleyballShape(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const r = size * 0.32;
  const points: Vec2[] = [];
  for (let i = 0; i <= 70; i++) points.push(polar(center, r, (i / 70) * 360 - 90));
  points.push(polar(center, r, 210));
  for (let i = 0; i <= 20; i++) points.push(polar(center, r * 0.55, 210 + (i / 20) * 60));
  points.push(polar(center, r, 270));
  points.push(polar(center, r, 330));
  for (let i = 0; i <= 20; i++) points.push(polar(center, r * 0.55, 330 + (i / 20) * 60));
  points.push(polar(center, r, 30));
  return toPath(points, size);
}

function baseballCapShape(size: number): DrawingPath {
  // Rounded dome crown sitting on a flat headband, a separate curved bill
  // sweeping out to the right, the little top button and a front panel seam -
  // the signature parts that make a cap read as a cap rather than a blob.
  const crown = smoothClosedPath(
    fracPoints(size, [
      [0.24, 0.56], // back of headband
      [0.21, 0.45],
      [0.27, 0.35],
      [0.4, 0.29],
      [0.52, 0.28], // top
      [0.63, 0.33],
      [0.68, 0.46],
      [0.67, 0.56], // front of headband
    ]),
    12,
  );
  // Curved bill: a closed crescent band jutting forward from the front.
  const bill = smoothClosedPath(
    fracPoints(size, [
      [0.66, 0.55],
      [0.8, 0.58],
      [0.9, 0.63],
      [0.87, 0.68],
      [0.76, 0.64],
      [0.65, 0.6],
    ]),
    10,
  );
  // Top button.
  const buttonCenter = { x: size * 0.52, y: size * 0.28 };
  const button: Vec2[] = [];
  for (let i = 0; i <= 16; i++) button.push(polar(buttonCenter, size * 0.022, (i / 16) * 360));
  // Front panel seam curving down from the button.
  const seam = openPolyline(
    fracPoints(size, [
      [0.52, 0.3],
      [0.57, 0.42],
      [0.61, 0.54],
    ]),
    8,
  );
  return toPathFromParts([crown, bill, button, seam], size);
}

function stopwatchShape(size: number): DrawingPath {
  const center = { x: size * 0.5, y: size * 0.55 };
  const r = size * 0.3;
  const points: Vec2[] = [
    { x: size * 0.44, y: size * 0.12 },
    { x: size * 0.56, y: size * 0.12 },
    { x: size * 0.5, y: size * 0.12 },
    { x: size * 0.5, y: size * 0.2 },
  ];
  for (let i = 0; i <= 70; i++) points.push(polar(center, r, (i / 70) * 360 - 90));
  points.push(center, polar(center, r * 0.55, -60));
  return toPath(points, size);
}

function whistleShape(size: number): DrawingPath {
  // Classic pea-whistle silhouette: a round sound chamber, a flat mouthpiece
  // tube reaching out to the right, a lanyard ring on top and the little pea
  // hole on the chamber face - each a cleanly separated part.
  const center = { x: size * 0.4, y: size * 0.6 };
  const r = size * 0.2;
  const body: Vec2[] = [];
  for (let i = 0; i <= 48; i++) body.push(polar(center, r, (i / 48) * 360));
  // Mouthpiece: a rounded tube extending right, overlapping the chamber so it
  // reads as attached.
  const mouthpiece = smoothClosedPath(
    fracPoints(size, [
      [0.55, 0.5],
      [0.83, 0.5],
      [0.85, 0.55],
      [0.83, 0.6],
      [0.55, 0.6],
    ]),
    6,
  );
  // Lanyard ring sitting on top of the chamber.
  const ringCenter = { x: size * 0.4, y: size * 0.34 };
  const ring: Vec2[] = [];
  for (let i = 0; i <= 24; i++) ring.push(polar(ringCenter, size * 0.06, (i / 24) * 360));
  // Pea hole on the chamber face.
  const holeCenter = { x: size * 0.4, y: size * 0.6 };
  const hole: Vec2[] = [];
  for (let i = 0; i <= 16; i++) hole.push(polar(holeCenter, size * 0.055, (i / 16) * 360));
  return toPathFromParts([body, mouthpiece, ring, hole], size);
}

function dumbbellShape(size: number): DrawingPath {
  const leftOuter = { x: size * 0.18, y: size * 0.5 };
  const leftInner = { x: size * 0.28, y: size * 0.5 };
  const rightInner = { x: size * 0.72, y: size * 0.5 };
  const rightOuter = { x: size * 0.82, y: size * 0.5 };
  const leftPlate = polygonEdges(
    fracPoints(size, [
      [0.14, 0.3],
      [0.28, 0.3],
      [0.28, 0.7],
      [0.14, 0.7],
    ]),
    8,
  );
  const rightPlate = polygonEdges(
    fracPoints(size, [
      [0.72, 0.3],
      [0.86, 0.3],
      [0.86, 0.7],
      [0.72, 0.7],
    ]),
    8,
  );
  const mainLine = [
    ...openPolyline([leftOuter, leftInner], 8),
    ...openPolyline([leftInner, rightInner], 16),
    ...openPolyline([rightInner, rightOuter], 8),
  ];
  return toPathFromParts([mainLine, leftPlate, rightPlate], size);
}

function golfClubShape(size: number): DrawingPath {
  const shaft = openPolyline(
    fracPoints(size, [
      [0.3, 0.15],
      [0.62, 0.75],
    ]),
    20,
  );
  const head = openPolyline(
    fracPoints(size, [
      [0.62, 0.75],
      [0.8, 0.7],
      [0.85, 0.85],
      [0.62, 0.9],
      [0.62, 0.75],
    ]),
    10,
  );
  // a couple of face grooves on the club head
  const grooves = openPolyline(
    fracPoints(size, [
      [0.68, 0.78],
      [0.78, 0.76],
      [0.68, 0.78],
      [0.7, 0.83],
      [0.79, 0.81],
    ]),
    6,
  );
  return toPathFromParts([[...shaft, ...head], grooves], size);
}

function swimGogglesShape(size: number): DrawingPath {
  // Two rounded lenses, a short nose bridge dipping between them, and a strap
  // stub flaring off each outer edge - the parts that separate goggles from a
  // plain pair of circles.
  const leftCenter = { x: size * 0.34, y: size * 0.5 };
  const rightCenter = { x: size * 0.66, y: size * 0.5 };
  const r = size * 0.16;
  const leftLens: Vec2[] = [];
  for (let i = 0; i <= 40; i++) leftLens.push(polar(leftCenter, r, (i / 40) * 360));
  const rightLens: Vec2[] = [];
  for (let i = 0; i <= 40; i++) rightLens.push(polar(rightCenter, r, (i / 40) * 360));
  // Nose bridge dipping down between the inner edges.
  const bridge = openPolyline(
    fracPoints(size, [
      [0.47, 0.49],
      [0.5, 0.55],
      [0.53, 0.49],
    ]),
    6,
  );
  // Tapered strap stubs flaring outward from the outer edge of each lens.
  const leftStrap = polygonEdges(
    fracPoints(size, [
      [0.19, 0.45],
      [0.06, 0.42],
      [0.06, 0.48],
      [0.19, 0.53],
    ]),
    6,
  );
  const rightStrap = polygonEdges(
    fracPoints(size, [
      [0.81, 0.45],
      [0.94, 0.42],
      [0.94, 0.48],
      [0.81, 0.53],
    ]),
    6,
  );
  return toPathFromParts([leftLens, rightLens, bridge, leftStrap, rightStrap], size);
}

function skateboardShape(size: number): DrawingPath {
  const deckPts = fracPoints(size, [
    [0.2, 0.45],
    [0.3, 0.35],
    [0.7, 0.35],
    [0.8, 0.45],
    [0.75, 0.55],
    [0.25, 0.55],
  ]);
  const deck = smoothClosedPath(deckPts, 10);
  const leftWheel = { x: size * 0.32, y: size * 0.68 };
  const rightWheel = { x: size * 0.68, y: size * 0.68 };
  const r = size * 0.06;
  const leftWheelLoop: Vec2[] = [];
  for (let i = 0; i <= 20; i++) leftWheelLoop.push(polar(leftWheel, r, (i / 20) * 360));
  const rightWheelLoop: Vec2[] = [];
  for (let i = 0; i <= 20; i++) rightWheelLoop.push(polar(rightWheel, r, (i / 20) * 360));
  return toPathFromParts([deck, leftWheelLoop, rightWheelLoop], size);
}

function bowlingPinShape(size: number): DrawingPath {
  // Symmetric profile: ball-like head, pinched neck, wide belly, narrower flat base.
  const pin = smoothClosedPath(
    fracPoints(size, [
      [0.5, 0.08],
      [0.585, 0.15],
      [0.575, 0.24],
      [0.545, 0.32],
      [0.6, 0.42],
      [0.64, 0.55],
      [0.645, 0.65],
      [0.61, 0.78],
      [0.58, 0.88],
      [0.42, 0.88],
      [0.39, 0.78],
      [0.355, 0.65],
      [0.36, 0.55],
      [0.4, 0.42],
      [0.455, 0.32],
      [0.425, 0.24],
      [0.415, 0.15],
    ]),
    8,
  );
  // Two separate neck stripes, gently curved as if wrapping around the pin.
  const stripe1 = openPolyline(
    fracPoints(size, [
      [0.45, 0.35],
      [0.5, 0.36],
      [0.55, 0.35],
    ]),
    6,
  );
  const stripe2 = openPolyline(
    fracPoints(size, [
      [0.43, 0.41],
      [0.5, 0.42],
      [0.57, 0.41],
    ]),
    6,
  );
  return toPathFromParts([pin, stripe1, stripe2], size);
}

function podiumShape(size: number): DrawingPath {
  // Replaces the boxing glove - a plain geometric winner's-podium silhouette
  // (straight edges only) per the project's preference for simple
  // icon/symbol/geometric shapes over detailed realistic objects.
  const vertices = fracPoints(size, [
    [0.1, 0.85],
    [0.1, 0.55],
    [0.35, 0.55],
    [0.35, 0.35],
    [0.65, 0.35],
    [0.65, 0.65],
    [0.9, 0.65],
    [0.9, 0.85],
  ]);
  return toPath(polygonEdges(vertices, 10), size);
}

function hockeyStickShape(size: number): DrawingPath {
  const shaft = openPolyline(
    fracPoints(size, [
      [0.65, 0.1],
      [0.4, 0.75],
    ]),
    20,
  );
  const blade = openPolyline(
    fracPoints(size, [
      [0.4, 0.75],
      [0.75, 0.85],
      [0.72, 0.92],
      [0.38, 0.83],
      [0.4, 0.75],
    ]),
    10,
  );
  return toPath([...shaft, ...blade], size);
}

function finishFlagShape(size: number): DrawingPath {
  const pole = openPolyline(
    fracPoints(size, [
      [0.3, 0.88],
      [0.3, 0.12],
    ]),
    20,
  );
  const squares: [number, number][][] = [
    [
      [0.3, 0.12],
      [0.45, 0.12],
      [0.45, 0.2],
      [0.3, 0.2],
    ],
    [
      [0.45, 0.2],
      [0.6, 0.2],
      [0.6, 0.28],
      [0.45, 0.28],
    ],
    [
      [0.3, 0.28],
      [0.45, 0.28],
      [0.45, 0.36],
      [0.3, 0.36],
    ],
    [
      [0.45, 0.12],
      [0.6, 0.12],
      [0.6, 0.2],
      [0.45, 0.2],
    ],
  ];
  const flagPts = fracPoints(size, [
    [0.3, 0.12],
    [0.6, 0.12],
    [0.6, 0.36],
    [0.3, 0.36],
  ]);
  const border = polygonEdges(flagPts, 8);
  const checker = squares.flatMap(([a, , c]) => {
    const p1 = fracPoints(size, [a]);
    const p2 = fracPoints(size, [c]);
    return openPolyline([p1[0], p2[0]], 4);
  });
  return toPath([...pole, ...border, ...checker], size);
}

function jumpRopeShape(size: number): DrawingPath {
  // Two cylindrical grips held up at the top, joined by a rope that hangs in a
  // real catenary (cosh) sag between them - lowest at the middle, tapering to
  // nothing where it meets each handle.
  const leftHandle = smoothClosedPath(
    fracPoints(size, [
      [0.19, 0.1],
      [0.26, 0.1],
      [0.26, 0.32],
      [0.19, 0.32],
    ]),
    8,
  );
  const rightHandle = smoothClosedPath(
    fracPoints(size, [
      [0.74, 0.1],
      [0.81, 0.1],
      [0.81, 0.32],
      [0.74, 0.32],
    ]),
    8,
  );
  const rope: Vec2[] = [];
  const steps = 48;
  const k = 1.7;
  const denom = Math.cosh(k) - 1;
  const topY = 0.31;
  const sagDepth = 0.53;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const droop = (Math.cosh(k) - Math.cosh((t - 0.5) * 2 * k)) / denom;
    rope.push({
      x: size * (0.225 + t * 0.55),
      y: size * (topY + droop * sagDepth),
    });
  }
  return toPathFromParts([leftHandle, rightHandle, rope], size);
}

function americanFootballShape(size: number): DrawingPath {
  // Lens-shaped body from two circular arcs meeting at pointed tips,
  // instead of an ellipse (a real football is pointed, not rounded, at the ends).
  const arcR = size * 0.438;
  const topCenter = { x: size * 0.5, y: size * 0.718 };
  const botCenter = { x: size * 0.5, y: size * 0.282 };
  const arcSteps = 24;
  const body: Vec2[] = [];
  for (let i = 0; i <= arcSteps; i++) {
    body.push(polar(topCenter, arcR, 209.8 + (i / arcSteps) * 120.4));
  }
  for (let i = 1; i <= arcSteps; i++) {
    body.push(polar(botCenter, arcR, 29.8 + (i / arcSteps) * 120.4));
  }
  body.push(body[0]);
  // Lace: spine along the middle with four cross stitches.
  const laceSpine = openPolyline(
    fracPoints(size, [
      [0.38, 0.5],
      [0.62, 0.5],
    ]),
    8,
  );
  const stitch = (fx: number) =>
    openPolyline(
      fracPoints(size, [
        [fx, 0.455],
        [fx, 0.545],
      ]),
      4,
    );
  // Curved seams hugging each tip.
  const leftSeam = openPolyline(
    fracPoints(size, [
      [0.23, 0.42],
      [0.21, 0.5],
      [0.23, 0.58],
    ]),
    6,
  );
  const rightSeam = openPolyline(
    fracPoints(size, [
      [0.77, 0.42],
      [0.79, 0.5],
      [0.77, 0.58],
    ]),
    6,
  );
  return toPathFromParts(
    [body, laceSpine, stitch(0.41), stitch(0.47), stitch(0.53), stitch(0.59), leftSeam, rightSeam],
    size,
  );
}

const SPORTS_SHAPES: ShapeDefinition[] = [
  standalone("sport-soccer", "Soccer Ball", "sports", soccerBallShape),
  standalone("sport-tennisball", "Tennis Ball", "sports", tennisBallShape),
  standalone("sport-baseballcap", "Baseball Cap", "sports", baseballCapShape),
  standalone("sport-basketball", "Basketball", "sports", basketballShape),
  standalone("sport-volleyball", "Volleyball", "sports", volleyballShape),
  standalone("sport-americanfootball", "American Football", "sports", americanFootballShape),
  standalone("sport-medal", "Medal", "sports", medalShape),
  standalone("sport-whistle", "Whistle", "sports", whistleShape),
  standalone("sport-stopwatch", "Stopwatch", "sports", stopwatchShape),
  standalone("sport-golfclub", "Golf Club", "sports", golfClubShape),
  standalone("sport-swimgoggles", "Swim Goggles", "sports", swimGogglesShape),
  standalone("sport-bowlingpin", "Bowling Pin", "sports", bowlingPinShape),
  standalone("sport-jumprope", "Jump Rope", "sports", jumpRopeShape),
  standalone("sport-racket", "Racket", "sports", racketShape),
  standalone("sport-hockeystick", "Hockey Stick", "sports", hockeyStickShape),
  standalone("sport-finishflag", "Finish Flag", "sports", finishFlagShape),
  standalone("sport-podium", "Podium", "sports", podiumShape),
  standalone("sport-skateboard", "Skateboard", "sports", skateboardShape),
  standalone("sport-dumbbell", "Dumbbell", "sports", dumbbellShape),
  standalone("sport-trophy", "Trophy", "sports", trophyShape),
];

// ==================== TRANSPORTATION ====================

function carShape(size: number): DrawingPath {
  // Side-view sedan: hood/roof/trunk profile with wheel arches cut into the
  // bottom edge, so the wheels sit inside arches instead of floating below.
  const frontWheel = { x: size * 0.3, y: size * 0.66 };
  const rearWheel = { x: size * 0.7, y: size * 0.66 };
  const archR = size * 0.1;
  const body: Vec2[] = [];
  body.push(
    ...openPolyline(
      fracPoints(size, [
        [0.08, 0.6],
        [0.1, 0.52],
        [0.28, 0.48],
        [0.36, 0.36],
        [0.6, 0.36],
        [0.72, 0.48],
        [0.88, 0.52],
        [0.9, 0.6],
        [0.9, 0.66],
        [0.8, 0.66],
      ]),
      6,
    ),
  );
  for (let i = 0; i <= 12; i++) body.push(polar(rearWheel, archR, 360 - (i / 12) * 180));
  body.push(...openPolyline(fracPoints(size, [[0.6, 0.66], [0.4, 0.66]]), 6));
  for (let i = 0; i <= 12; i++) body.push(polar(frontWheel, archR, 360 - (i / 12) * 180));
  body.push(
    ...openPolyline(
      fracPoints(size, [
        [0.2, 0.66],
        [0.1, 0.66],
        [0.08, 0.6],
      ]),
      6,
    ),
  );
  // Two windows separated by the door pillar, slanted to match the roofline.
  const frontWindow = polygonEdges(
    fracPoints(size, [
      [0.38, 0.38],
      [0.47, 0.38],
      [0.47, 0.47],
      [0.32, 0.47],
    ]),
    5,
  );
  const rearWindow = polygonEdges(
    fracPoints(size, [
      [0.51, 0.38],
      [0.59, 0.38],
      [0.7, 0.47],
      [0.51, 0.47],
    ]),
    5,
  );
  const wheelR = size * 0.075;
  const hubR = size * 0.03;
  const circle = (c: Vec2, r: number, steps: number) => {
    const loop: Vec2[] = [];
    for (let i = 0; i <= steps; i++) loop.push(polar(c, r, (i / steps) * 360));
    return loop;
  };
  return toPathFromParts(
    [
      body,
      frontWindow,
      rearWindow,
      circle(frontWheel, wheelR, 20),
      circle(rearWheel, wheelR, 20),
      circle(frontWheel, hubR, 12),
      circle(rearWheel, hubR, 12),
    ],
    size,
  );
}

function bicycleShape(size: number): DrawingPath {
  // Proper diamond frame: seat stay + top tube + fork, chain stay + seat tube,
  // down tube, chainring at the bottom bracket, seat and handlebar.
  const rearAxle: [number, number] = [0.26, 0.68];
  const frontAxle: [number, number] = [0.76, 0.68];
  const bottomBracket: [number, number] = [0.48, 0.68];
  const seatTop: [number, number] = [0.41, 0.4];
  const headTop: [number, number] = [0.68, 0.4];
  const wheelR = size * 0.16;
  const circle = (c: [number, number], r: number, steps: number) => {
    const loop: Vec2[] = [];
    const center = { x: size * c[0], y: size * c[1] };
    for (let i = 0; i <= steps; i++) loop.push(polar(center, r, (i / steps) * 360));
    return loop;
  };
  const upperFrame = openPolyline(fracPoints(size, [rearAxle, seatTop, headTop, frontAxle]), 8);
  const lowerFrame = openPolyline(fracPoints(size, [rearAxle, bottomBracket, seatTop]), 8);
  const downTube = openPolyline(fracPoints(size, [bottomBracket, headTop]), 8);
  const seat = openPolyline(
    fracPoints(size, [
      [0.36, 0.4],
      [0.46, 0.4],
    ]),
    5,
  );
  const handlebar = openPolyline(
    fracPoints(size, [
      [0.68, 0.4],
      [0.665, 0.33],
      [0.73, 0.31],
    ]),
    5,
  );
  return toPathFromParts(
    [
      circle(rearAxle, wheelR, 24),
      circle(frontAxle, wheelR, 24),
      upperFrame,
      lowerFrame,
      downTube,
      circle(bottomBracket, size * 0.04, 12),
      seat,
      handlebar,
    ],
    size,
  );
}

function airplaneShape(size: number): DrawingPath {
  const vertices = fracPoints(size, [
    [0.5, 0.1],
    [0.58, 0.4],
    [0.9, 0.55],
    [0.9, 0.62],
    [0.58, 0.52],
    [0.58, 0.75],
    [0.7, 0.85],
    [0.7, 0.9],
    [0.5, 0.82],
    [0.3, 0.9],
    [0.3, 0.85],
    [0.42, 0.75],
    [0.42, 0.52],
    [0.1, 0.62],
    [0.1, 0.55],
    [0.42, 0.4],
  ]);
  return toPath(polygonEdges(vertices, 4), size);
}

function shipShape(size: number): DrawingPath {
  // Cargo ship: trapezoid hull, stepped two-tier superstructure,
  // slanted funnel, and a row of portholes along the hull.
  const hull = polygonEdges(
    fracPoints(size, [
      [0.1, 0.62],
      [0.9, 0.62],
      [0.84, 0.78],
      [0.16, 0.78],
    ]),
    8,
  );
  const superstructure = polygonEdges(
    fracPoints(size, [
      [0.3, 0.62],
      [0.3, 0.48],
      [0.42, 0.48],
      [0.42, 0.38],
      [0.58, 0.38],
      [0.58, 0.48],
      [0.7, 0.48],
      [0.7, 0.62],
    ]),
    6,
  );
  const funnel = polygonEdges(
    fracPoints(size, [
      [0.47, 0.38],
      [0.49, 0.28],
      [0.57, 0.28],
      [0.55, 0.38],
    ]),
    5,
  );
  const porthole = (cx: number) => {
    const loop: Vec2[] = [];
    for (let i = 0; i <= 12; i++) loop.push(polar({ x: size * cx, y: size * 0.7 }, size * 0.025, (i / 12) * 360));
    return loop;
  };
  return toPathFromParts([hull, superstructure, funnel, porthole(0.3), porthole(0.5), porthole(0.7)], size);
}

function rocketShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.5, 0.12],
    [0.62, 0.35],
    [0.62, 0.65],
    [0.75, 0.85],
    [0.62, 0.78],
    [0.6, 0.88],
    [0.4, 0.88],
    [0.38, 0.78],
    [0.25, 0.85],
    [0.38, 0.65],
    [0.38, 0.35],
  ]);
  const body = smoothClosedPath(pts, 8);
  // round porthole window on the nose section
  const withWindow = withDetourLoop(body, body.length - 1, { x: size * 0.5, y: size * 0.4 }, size * 0.07);
  return toPath(withWindow.points, size, withWindow.breaks);
}

function trainShape(size: number): DrawingPath {
  // Steam locomotive facing right: tall cab at the back, long boiler with a
  // rounded nose, flared chimney, cowcatcher, and three wheels.
  const noseCenter = { x: size * 0.74, y: size * 0.57 };
  const noseR = size * 0.15;
  const body: Vec2[] = [];
  body.push(
    ...openPolyline(
      fracPoints(size, [
        [0.14, 0.72],
        [0.14, 0.28],
        [0.34, 0.28],
        [0.34, 0.42],
        [0.74, 0.42],
      ]),
      8,
    ),
  );
  for (let i = 0; i <= 10; i++) body.push(polar(noseCenter, noseR, 270 + (i / 10) * 90));
  body.push(
    ...openPolyline(
      fracPoints(size, [
        [0.89, 0.72],
        [0.14, 0.72],
      ]),
      8,
    ),
  );
  // Flared smoke stack on the boiler.
  const chimney = polygonEdges(
    fracPoints(size, [
      [0.6, 0.42],
      [0.59, 0.3],
      [0.56, 0.25],
      [0.7, 0.25],
      [0.67, 0.3],
      [0.66, 0.42],
    ]),
    5,
  );
  const cabWindow = polygonEdges(
    fracPoints(size, [
      [0.18, 0.33],
      [0.3, 0.33],
      [0.3, 0.45],
      [0.18, 0.45],
    ]),
    5,
  );
  // Cowcatcher wedge at the front.
  const cowcatcher = polygonEdges(
    fracPoints(size, [
      [0.88, 0.6],
      [0.96, 0.78],
      [0.82, 0.78],
    ]),
    5,
  );
  const wheelR = size * 0.065;
  const circle = (cx: number) => {
    const loop: Vec2[] = [];
    for (let i = 0; i <= 20; i++) loop.push(polar({ x: size * cx, y: size * 0.74 }, wheelR, (i / 20) * 360));
    return loop;
  };
  return toPathFromParts([body, chimney, cabWindow, cowcatcher, circle(0.26), circle(0.5), circle(0.7)], size);
}

function scooterShape(size: number): DrawingPath {
  // Kick scooter: deck with real thickness, angled steering column with a
  // T-handlebar, rear fender arcing over the back wheel, two small wheels.
  const rearWheel = { x: size * 0.24, y: size * 0.8 };
  const frontWheel = { x: size * 0.72, y: size * 0.8 };
  const wheelR = size * 0.055;
  const deck = polygonEdges(
    fracPoints(size, [
      [0.28, 0.7],
      [0.66, 0.7],
      [0.66, 0.735],
      [0.28, 0.735],
    ]),
    8,
  );
  const column = openPolyline(
    fracPoints(size, [
      [0.72, 0.78],
      [0.78, 0.22],
    ]),
    10,
  );
  const handlebar = openPolyline(
    fracPoints(size, [
      [0.7, 0.2],
      [0.86, 0.2],
    ]),
    6,
  );
  // Fender hugging the top of the rear wheel.
  const fender: Vec2[] = [];
  for (let i = 0; i <= 12; i++) fender.push(polar(rearWheel, size * 0.085, 180 + (i / 12) * 140));
  const circle = (c: Vec2) => {
    const loop: Vec2[] = [];
    for (let i = 0; i <= 20; i++) loop.push(polar(c, wheelR, (i / 20) * 360));
    return loop;
  };
  return toPathFromParts([deck, column, handlebar, fender, circle(rearWheel), circle(frontWheel)], size);
}

function trafficLightShape(size: number): DrawingPath {
  const vertices = fracPoints(size, [
    [0.38, 0.15],
    [0.62, 0.15],
    [0.62, 0.75],
    [0.38, 0.75],
  ]);
  const body = polygonEdges(vertices, 10);
  const withA = withDetourLoop(body, 10, { x: size * 0.5, y: size * 0.28 }, size * 0.07);
  const withB = withDetourLoop(withA.points, withA.points.length - 1, { x: size * 0.5, y: size * 0.45 }, size * 0.07);
  const withC = withDetourLoop(withB.points, withB.points.length - 1, { x: size * 0.5, y: size * 0.62 }, size * 0.07);
  const post = openPolyline(
    fracPoints(size, [
      [0.5, 0.75],
      [0.5, 0.9],
    ]),
    10,
  );
  // Chained detour loops share boundary indices (each loop is anchored at the
  // end of the previous one), so dedupe to keep breaks strictly ascending.
  const rawBreaks = [...withA.breaks, ...withB.breaks, ...withC.breaks, withC.points.length];
  const breaks = [...new Set(rawBreaks)].sort((a, b) => a - b);
  return toPath([...withC.points, ...post], size, breaks);
}

function roadSignShape(size: number): DrawingPath {
  const vertices = fracPoints(size, [
    [0.5, 0.15],
    [0.75, 0.4],
    [0.5, 0.65],
    [0.25, 0.4],
  ]);
  const diamond = polygonEdges(vertices, 12);
  const post = openPolyline(
    fracPoints(size, [
      [0.5, 0.65],
      [0.5, 0.9],
    ]),
    12,
  );
  return toPathFromParts([diamond, post], size);
}

function tramShape(size: number): DrawingPath {
  // Tram with its signature pantograph reaching up to the overhead wire,
  // a row of windows, and small wheels half-hidden under the body.
  const body = polygonEdges(
    fracPoints(size, [
      [0.16, 0.68],
      [0.16, 0.32],
      [0.24, 0.26],
      [0.76, 0.26],
      [0.84, 0.32],
      [0.84, 0.68],
    ]),
    10,
  );
  const wire = openPolyline(
    fracPoints(size, [
      [0.3, 0.12],
      [0.7, 0.12],
    ]),
    8,
  );
  // Inverted-V pantograph touching the wire.
  const pantograph = openPolyline(
    fracPoints(size, [
      [0.42, 0.26],
      [0.5, 0.13],
      [0.58, 0.26],
    ]),
    6,
  );
  const windowRect = (x0: number, x1: number) =>
    polygonEdges(
      fracPoints(size, [
        [x0, 0.32],
        [x1, 0.32],
        [x1, 0.44],
        [x0, 0.44],
      ]),
      4,
    );
  const wheelR = size * 0.055;
  const circle = (cx: number) => {
    const loop: Vec2[] = [];
    for (let i = 0; i <= 20; i++) loop.push(polar({ x: size * cx, y: size * 0.7 }, wheelR, (i / 20) * 360));
    return loop;
  };
  return toPathFromParts(
    [body, wire, pantograph, windowRect(0.21, 0.35), windowRect(0.43, 0.57), windowRect(0.65, 0.79), circle(0.3), circle(0.7)],
    size,
  );
}

function sailboatShape(size: number): DrawingPath {
  const hull = openPolyline(
    fracPoints(size, [
      [0.2, 0.75],
      [0.8, 0.75],
      [0.65, 0.88],
      [0.35, 0.88],
      [0.2, 0.75],
    ]),
    10,
  );
  const mast = openPolyline(
    fracPoints(size, [
      [0.5, 0.75],
      [0.5, 0.15],
    ]),
    14,
  );
  const sail = openPolyline(
    fracPoints(size, [
      [0.5, 0.2],
      [0.75, 0.55],
      [0.5, 0.55],
    ]),
    10,
  );
  return toPath([...hull, ...mast, ...sail], size);
}

function kayakShape(size: number): DrawingPath {
  // Slender hull from two shallow arcs meeting at sharp bow/stern tips,
  // a cockpit oval on the deck, and a paddle with elongated oval blades.
  const arcR = size * 1.295;
  const topCenter = { x: size * 0.5, y: size * 1.825 };
  const botCenter = { x: size * 0.5, y: size * -0.625 };
  const hull: Vec2[] = [];
  for (let i = 0; i <= 16; i++) hull.push(polar(topCenter, arcR, 251.1 + (i / 16) * 37.8));
  for (let i = 1; i <= 16; i++) hull.push(polar(botCenter, arcR, 71.1 + (i / 16) * 37.8));
  hull.push(hull[0]);
  const cockpit: Vec2[] = [];
  for (let i = 0; i <= 20; i++) {
    const t = (i / 20) * Math.PI * 2;
    cockpit.push({ x: size * (0.5 + 0.09 * Math.cos(t)), y: size * (0.6 + 0.03 * Math.sin(t)) });
  }
  // Paddle: diagonal shaft with an oval blade aligned to the shaft at each end.
  const shaftStart = { x: size * 0.22, y: size * 0.25 };
  const shaftEnd = { x: size * 0.78, y: size * 0.7 };
  const shaft = openPolyline([shaftStart, shaftEnd], 16);
  const u = { x: 0.779, y: 0.626 };
  const v = { x: -0.626, y: 0.779 };
  const blade = (c: Vec2, dir: number) => {
    const center = { x: c.x + dir * u.x * size * 0.05, y: c.y + dir * u.y * size * 0.05 };
    const loop: Vec2[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = (i / 16) * Math.PI * 2;
      const a = size * 0.07 * Math.cos(t);
      const b = size * 0.035 * Math.sin(t);
      loop.push({ x: center.x + a * u.x + b * v.x, y: center.y + a * u.y + b * v.y });
    }
    return loop;
  };
  return toPathFromParts([hull, cockpit, shaft, blade(shaftStart, -1), blade(shaftEnd, 1)], size);
}

function tractorShape(size: number): DrawingPath {
  // A closed body silhouette (tall cabin stepping down to a lower engine
  // hood) instead of an open zigzag line with no chassis edge - the old
  // shape read as an abstract staircase rather than a tractor.
  const body = polygonEdges(
    fracPoints(size, [
      [0.28, 0.78],
      [0.28, 0.38],
      [0.5, 0.38],
      [0.5, 0.55],
      [0.64, 0.55],
      [0.82, 0.64],
      [0.82, 0.78],
    ]),
    10,
  );
  const exhaust = openPolyline(
    fracPoints(size, [
      [0.34, 0.38],
      [0.34, 0.24],
    ]),
    10,
  );
  const backWheel = { x: size * 0.34, y: size * 0.8 };
  const frontWheel = { x: size * 0.76, y: size * 0.82 };
  const backWheelLoop: Vec2[] = [];
  for (let i = 0; i <= 24; i++) backWheelLoop.push(polar(backWheel, size * 0.16, (i / 24) * 360));
  const frontWheelLoop: Vec2[] = [];
  for (let i = 0; i <= 24; i++) frontWheelLoop.push(polar(frontWheel, size * 0.08, (i / 24) * 360));
  return toPathFromParts([body, exhaust, backWheelLoop, frontWheelLoop], size);
}

function motorcycleShape(size: number): DrawingPath {
  // Side view: closed tank-and-seat body, handlebar continuing into the front
  // fork, swingarm to the rear axle, wheels with hubs.
  const rearWheel = { x: size * 0.26, y: size * 0.7 };
  const frontWheel = { x: size * 0.76, y: size * 0.7 };
  const body = smoothClosedPath(
    fracPoints(size, [
      [0.32, 0.52],
      [0.42, 0.47],
      [0.55, 0.45],
      [0.64, 0.5],
      [0.6, 0.56],
      [0.45, 0.58],
      [0.35, 0.57],
    ]),
    8,
  );
  // Handlebar bending into the fork, down to the front axle.
  const handlebarAndFork = openPolyline(
    fracPoints(size, [
      [0.64, 0.27],
      [0.71, 0.3],
      [0.76, 0.7],
    ]),
    10,
  );
  const swingarm = openPolyline(
    fracPoints(size, [
      [0.35, 0.57],
      [0.26, 0.7],
    ]),
    6,
  );
  const circle = (c: Vec2, r: number, steps: number) => {
    const loop: Vec2[] = [];
    for (let i = 0; i <= steps; i++) loop.push(polar(c, r, (i / steps) * 360));
    return loop;
  };
  return toPathFromParts(
    [
      body,
      handlebarAndFork,
      swingarm,
      circle(rearWheel, size * 0.13, 24),
      circle(frontWheel, size * 0.13, 24),
      circle(rearWheel, size * 0.05, 12),
      circle(frontWheel, size * 0.05, 12),
    ],
    size,
  );
}

function busShape(size: number): DrawingPath {
  // City bus: rounded-corner body, a row of passenger windows, a tall door
  // at the front, wheels tucked at the bottom edge.
  const body = polygonEdges(
    fracPoints(size, [
      [0.12, 0.72],
      [0.12, 0.3],
      [0.18, 0.22],
      [0.82, 0.22],
      [0.88, 0.3],
      [0.88, 0.72],
    ]),
    10,
  );
  const windowRect = (x0: number, x1: number, y0: number, y1: number) =>
    polygonEdges(
      fracPoints(size, [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ]),
      4,
    );
  const win1 = windowRect(0.19, 0.31, 0.3, 0.42);
  const win2 = windowRect(0.37, 0.49, 0.3, 0.42);
  const win3 = windowRect(0.55, 0.67, 0.3, 0.42);
  const door = windowRect(0.73, 0.83, 0.32, 0.68);
  const wheelR = size * 0.07;
  const circle = (cx: number) => {
    const loop: Vec2[] = [];
    for (let i = 0; i <= 20; i++) loop.push(polar({ x: size * cx, y: size * 0.72 }, wheelR, (i / 20) * 360));
    return loop;
  };
  return toPathFromParts([body, win1, win2, win3, door, circle(0.26), circle(0.62)], size);
}

function truckShape(size: number): DrawingPath {
  const vertices = fracPoints(size, [
    [0.12, 0.72],
    [0.12, 0.35],
    [0.5, 0.35],
    [0.5, 0.72],
  ]);
  const cargo = polygonEdges(vertices, 10);
  const cab = openPolyline(
    fracPoints(size, [
      [0.5, 0.72],
      [0.5, 0.5],
      [0.68, 0.5],
      [0.82, 0.62],
      [0.82, 0.72],
      [0.5, 0.72],
    ]),
    10,
  );
  const leftWheel = { x: size * 0.28, y: size * 0.8 };
  const rightWheel = { x: size * 0.68, y: size * 0.8 };
  const r = size * 0.07;
  const leftWheelLoop: Vec2[] = [];
  for (let i = 0; i <= 20; i++) leftWheelLoop.push(polar(leftWheel, r, (i / 20) * 360));
  const rightWheelLoop: Vec2[] = [];
  for (let i = 0; i <= 20; i++) rightWheelLoop.push(polar(rightWheel, r, (i / 20) * 360));
  return toPathFromParts([cargo, cab, leftWheelLoop, rightWheelLoop], size);
}

function fireTruckShape(size: number): DrawingPath {
  // Side view: tall cab at the front, long lower body, angled ladder on top,
  // light bar on the cab roof, one front wheel and a rear wheel pair.
  const body = polygonEdges(
    fracPoints(size, [
      [0.08, 0.72],
      [0.08, 0.4],
      [0.14, 0.32],
      [0.3, 0.32],
      [0.3, 0.48],
      [0.9, 0.48],
      [0.9, 0.72],
    ]),
    8,
  );
  const cabWindow = polygonEdges(
    fracPoints(size, [
      [0.12, 0.37],
      [0.26, 0.37],
      [0.26, 0.46],
      [0.12, 0.46],
    ]),
    5,
  );
  // Emergency light bar on the cab roof.
  const lightBar = polygonEdges(
    fracPoints(size, [
      [0.17, 0.27],
      [0.25, 0.27],
      [0.25, 0.32],
      [0.17, 0.32],
    ]),
    4,
  );
  // Ladder resting on the body at an angle, as a thin closed frame with rungs.
  const ladderFrame = polygonEdges(
    fracPoints(size, [
      [0.32, 0.42],
      [0.9, 0.3],
      [0.908, 0.339],
      [0.328, 0.459],
    ]),
    10,
  );
  const rung = (t: number) => {
    const ax = 0.32 + 0.58 * t;
    const ay = 0.42 - 0.12 * t;
    return openPolyline(
      fracPoints(size, [
        [ax, ay],
        [ax + 0.008, ay + 0.039],
      ]),
      4,
    );
  };
  const wheelR = size * 0.07;
  const circle = (cx: number, cy: number) => {
    const loop: Vec2[] = [];
    for (let i = 0; i <= 20; i++) loop.push(polar({ x: size * cx, y: size * cy }, wheelR, (i / 20) * 360));
    return loop;
  };
  return toPathFromParts(
    [
      body,
      cabWindow,
      lightBar,
      ladderFrame,
      rung(0.25),
      rung(0.5),
      rung(0.75),
      circle(0.2, 0.72),
      circle(0.6, 0.72),
      circle(0.78, 0.72),
    ],
    size,
  );
}

function submarineShape(size: number): DrawingPath {
  // Cigar-shaped hull (true ellipse), conning tower with periscope,
  // stern fins at the back, and portholes along the center line.
  const hull: Vec2[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = (i / 40) * Math.PI * 2;
    hull.push({ x: size * (0.5 + 0.4 * Math.cos(t)), y: size * (0.55 + 0.13 * Math.sin(t)) });
  }
  const tower = polygonEdges(
    fracPoints(size, [
      [0.42, 0.43],
      [0.44, 0.3],
      [0.58, 0.3],
      [0.6, 0.43],
    ]),
    6,
  );
  const periscope = openPolyline(
    fracPoints(size, [
      [0.5, 0.3],
      [0.5, 0.2],
      [0.57, 0.2],
    ]),
    5,
  );
  // Stern fins at the tail end.
  const upperFin = openPolyline(
    fracPoints(size, [
      [0.14, 0.49],
      [0.07, 0.4],
    ]),
    5,
  );
  const lowerFin = openPolyline(
    fracPoints(size, [
      [0.14, 0.61],
      [0.07, 0.7],
    ]),
    5,
  );
  const porthole = (cx: number) => {
    const loop: Vec2[] = [];
    for (let i = 0; i <= 12; i++) loop.push(polar({ x: size * cx, y: size * 0.55 }, size * 0.022, (i / 12) * 360));
    return loop;
  };
  return toPathFromParts(
    [hull, tower, periscope, upperFin, lowerFin, porthole(0.3), porthole(0.42), porthole(0.54)],
    size,
  );
}

function hotAirBalloonShape(size: number): DrawingPath {
  // Inverted-teardrop envelope (round on top, pinched to a neck at the bottom),
  // vertical gore seams following the curvature, suspension cables, and a
  // basket sitting below with real width.
  const cx = size * 0.5;
  const balloon = smoothClosedPath(
    fracPoints(size, [
      [0.5, 0.08],
      [0.68, 0.13],
      [0.78, 0.28],
      [0.76, 0.44],
      [0.66, 0.54],
      [0.57, 0.6],
      [0.43, 0.6],
      [0.34, 0.54],
      [0.24, 0.44],
      [0.22, 0.28],
      [0.32, 0.13],
    ]),
    10,
  );
  // Gore seams: arcs from the top pole to the neck. The center one is straight;
  // side ones bow outward following the envelope's roundness.
  const gore = (bulge: number) => {
    const pts: Vec2[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const y = size * (0.08 + t * 0.52);
      // width of the envelope at this height (0 at poles, max at middle)
      const x = cx + bulge * size * Math.sin(t * Math.PI);
      pts.push({ x, y });
    }
    return pts;
  };
  const basketTop = 0.72;
  // Suspension cables from the envelope neck down to the basket corners.
  const cableL = openPolyline(
    fracPoints(size, [
      [0.4, 0.58],
      [0.42, basketTop],
    ]),
    5,
  );
  const cableR = openPolyline(
    fracPoints(size, [
      [0.6, 0.58],
      [0.58, basketTop],
    ]),
    5,
  );
  const basket = polygonEdges(
    fracPoints(size, [
      [0.42, basketTop],
      [0.58, basketTop],
      [0.56, 0.82],
      [0.44, 0.82],
    ]),
    6,
  );
  return toPathFromParts(
    [balloon, gore(-0.26), gore(0), gore(0.26), cableL, cableR, basket],
    size,
  );
}

function helicopterShape(size: number): DrawingPath {
  // Bubble cabin, tail boom with real width ending in a fin and tail rotor,
  // mast + main rotor blade, and landing skids on struts - no retraced lines.
  const body = smoothClosedPath(
    fracPoints(size, [
      [0.2, 0.5],
      [0.28, 0.4],
      [0.42, 0.36],
      [0.52, 0.4],
      [0.56, 0.5],
      [0.5, 0.6],
      [0.32, 0.62],
      [0.22, 0.58],
    ]),
    8,
  );
  const boom = polygonEdges(
    fracPoints(size, [
      [0.56, 0.46],
      [0.84, 0.44],
      [0.84, 0.48],
      [0.56, 0.52],
    ]),
    6,
  );
  const fin = polygonEdges(
    fracPoints(size, [
      [0.84, 0.48],
      [0.88, 0.34],
      [0.92, 0.48],
    ]),
    5,
  );
  // Vertical tail-rotor blade beside the fin.
  const tailRotor = openPolyline(
    fracPoints(size, [
      [0.88, 0.26],
      [0.88, 0.42],
    ]),
    5,
  );
  const mast = openPolyline(
    fracPoints(size, [
      [0.38, 0.36],
      [0.38, 0.28],
    ]),
    4,
  );
  const mainRotor = openPolyline(
    fracPoints(size, [
      [0.08, 0.28],
      [0.68, 0.28],
    ]),
    10,
  );
  const skidRail = openPolyline(
    fracPoints(size, [
      [0.16, 0.7],
      [0.2, 0.73],
      [0.56, 0.73],
    ]),
    6,
  );
  const strut = (fx: number) =>
    openPolyline(
      fracPoints(size, [
        [fx, 0.62],
        [fx, 0.73],
      ]),
      4,
    );
  return toPathFromParts([body, boom, fin, tailRotor, mast, mainRotor, skidRail, strut(0.3), strut(0.46)], size);
}

const TRANSPORTATION_SHAPES: ShapeDefinition[] = [
  standalone("trans-car", "Car", "transportation", carShape),
  standalone("trans-scooter", "Scooter", "transportation", scooterShape),
  standalone("trans-bicycle", "Bicycle", "transportation", bicycleShape),
  standalone("trans-motorcycle", "Motorcycle", "transportation", motorcycleShape),
  standalone("trans-roadsign", "Road Sign", "transportation", roadSignShape),
  standalone("trans-trafficlight", "Traffic Light", "transportation", trafficLightShape),
  standalone("trans-bus", "Bus", "transportation", busShape),
  standalone("trans-truck", "Truck", "transportation", truckShape),
  standalone("trans-firetruck", "Fire Truck", "transportation", fireTruckShape),
  standalone("trans-tractor", "Tractor", "transportation", tractorShape),
  standalone("trans-tram", "Tram", "transportation", tramShape),
  standalone("trans-train", "Train", "transportation", trainShape),
  standalone("trans-airplane", "Airplane", "transportation", airplaneShape),
  standalone("trans-helicopter", "Helicopter", "transportation", helicopterShape),
  standalone("trans-hotairballoon", "Hot Air Balloon", "transportation", hotAirBalloonShape),
  standalone("trans-kayak", "Kayak", "transportation", kayakShape),
  standalone("trans-sailboat", "Sailboat", "transportation", sailboatShape),
  standalone("trans-ship", "Ship", "transportation", shipShape),
  standalone("trans-submarine", "Submarine", "transportation", submarineShape),
  standalone("trans-rocket", "Rocket", "transportation", rocketShape),
];

// ==================== HOME & OBJECTS ====================

function houseShape(size: number): DrawingPath {
  const vertices = fracPoints(size, [
    [0.5, 0.15],
    [0.85, 0.45],
    [0.72, 0.45],
    [0.72, 0.82],
    [0.28, 0.82],
    [0.28, 0.45],
    [0.15, 0.45],
  ]);
  const outline = polygonEdges(vertices, 14);
  // a front door
  const door = openPolyline(
    fracPoints(size, [
      [0.44, 0.82],
      [0.44, 0.62],
      [0.56, 0.62],
      [0.56, 0.82],
    ]),
    10,
  );
  return toPathFromParts([outline, door], size);
}

function keyShape(size: number): DrawingPath {
  // Horizontal key: a round bow with a real hole on the left, a shaft with
  // genuine width extending right, and a toothed bit cut into its lower edge.
  const bowC = { x: 0.22 * size, y: 0.495 * size };
  const outerBow: Vec2[] = [];
  for (let i = 0; i <= 50; i++) outerBow.push(polar(bowC, 0.15 * size, (i / 50) * 360));
  const innerBow: Vec2[] = [];
  for (let i = 0; i <= 40; i++) innerBow.push(polar(bowC, 0.075 * size, (i / 40) * 360));

  // Closed shaft-and-bit profile: straight top edge, tip at the right, then the
  // bottom edge steps up and down into square teeth on the way back.
  const shaft = polygonEdges(
    fracPoints(size, [
      [0.36, 0.47],
      [0.82, 0.47],
      [0.82, 0.58], // tip / rightmost tooth
      [0.8, 0.58],
      [0.8, 0.52],
      [0.76, 0.52],
      [0.76, 0.58], // tall tooth
      [0.72, 0.58],
      [0.72, 0.52],
      [0.68, 0.52],
      [0.68, 0.56], // shorter tooth
      [0.64, 0.56],
      [0.64, 0.52],
      [0.6, 0.52],
      [0.36, 0.52], // shaft underside back to the bow
    ]),
    3,
  );

  return toPathFromParts([outerBow, innerBow, shaft], size);
}

function lampShape(size: number): DrawingPath {
  const shadeVertices = fracPoints(size, [
    [0.35, 0.2],
    [0.65, 0.2],
    [0.78, 0.5],
    [0.22, 0.5],
  ]);
  const shade = polygonEdges(shadeVertices, 14);
  const stand = openPolyline(
    fracPoints(size, [
      [0.5, 0.5],
      [0.5, 0.78],
      [0.35, 0.85],
      [0.65, 0.85],
    ]),
    10,
  );
  return toPathFromParts([shade, stand], size);
}

function clockShape(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const r = size * 0.32;
  const points: Vec2[] = [];
  for (let i = 0; i <= 70; i++) points.push(polar(center, r, (i / 70) * 360 - 90));
  points.push(center, polar(center, r * 0.5, -90), center, polar(center, r * 0.3, 0));
  return toPath(points, size);
}

function umbrellaShape(size: number): DrawingPath {
  // The canopy is now a fully closed outline - a smooth dome across the top
  // and a scalloped hem across the bottom (fabric sagging between the ribs)
  // back to the start - instead of an open arc with no bottom edge. The pole
  // and hook handle are a separate part, since the pole descends from
  // underneath the canopy rather than from a point on its own outline.
  const center = { x: size / 2, y: size * 0.45 };
  const r = size * 0.35;
  const canopy: Vec2[] = [];
  const domeSteps = 40;
  for (let i = 0; i <= domeSteps; i++) {
    const t = i / domeSteps;
    const angle = Math.PI - t * Math.PI;
    canopy.push({ x: center.x + r * Math.cos(angle), y: center.y - r * Math.sin(angle) });
  }
  const scallops = 6;
  const dip = size * 0.04;
  for (let i = 1; i <= scallops; i++) {
    const midX = center.x + r - ((i - 0.5) / scallops) * 2 * r;
    canopy.push({ x: midX, y: center.y + dip });
    const x = center.x + r - (i / scallops) * 2 * r;
    canopy.push({ x, y: center.y });
  }
  const pole = openPolyline(
    fracPoints(size, [
      [0.5, 0.45],
      [0.5, 0.82],
    ]),
    16,
  );
  const hookCenter = { x: center.x + size * 0.07, y: size * 0.82 };
  const hook: Vec2[] = [];
  const hookSteps = 20;
  for (let i = 0; i <= hookSteps; i++) {
    hook.push(polar(hookCenter, size * 0.07, 180 - (i / hookSteps) * 200));
  }
  return toPathFromParts([canopy, [...pole, ...hook]], size);
}

function chairShape(size: number): DrawingPath {
  // Each leg is its own fully closed rectangle - the old single traced
  // outline never made it back to the top-outer corner of either leg,
  // leaving them open.
  const backAndSeat = openPolyline(
    fracPoints(size, [
      [0.3, 0.2],
      [0.3, 0.5],
      [0.7, 0.5],
    ]),
    14,
  );
  const rightLeg = polygonEdges(
    fracPoints(size, [
      [0.62, 0.5],
      [0.7, 0.5],
      [0.7, 0.9],
      [0.62, 0.9],
    ]),
    10,
  );
  const leftLeg = polygonEdges(
    fracPoints(size, [
      [0.3, 0.5],
      [0.38, 0.5],
      [0.38, 0.9],
      [0.3, 0.9],
    ]),
    10,
  );
  return toPathFromParts([backAndSeat, rightLeg, leftLeg], size);
}

function doorShape(size: number): DrawingPath {
  const vertices = fracPoints(size, [
    [0.32, 0.85],
    [0.32, 0.2],
    [0.68, 0.2],
    [0.68, 0.85],
  ]);
  const frame = polygonEdges(vertices, 12);
  const withKnob = withDetourLoop(frame, 24, { x: size * 0.6, y: size * 0.55 }, size * 0.025);
  return toPath(withKnob.points, size, withKnob.breaks);
}

function windowShape(size: number): DrawingPath {
  const vertices = fracPoints(size, [
    [0.22, 0.2],
    [0.78, 0.2],
    [0.78, 0.8],
    [0.22, 0.8],
  ]);
  const frame = polygonEdges(vertices, 12);
  const cross = openPolyline(
    fracPoints(size, [
      [0.5, 0.2],
      [0.5, 0.8],
      [0.5, 0.5],
      [0.22, 0.5],
      [0.5, 0.5],
      [0.78, 0.5],
    ]),
    10,
  );
  return toPath([...frame, ...cross], size);
}

function mugShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.28, 0.3],
    [0.62, 0.3],
    [0.62, 0.75],
    [0.28, 0.75],
  ]);
  const body = polygonEdges(pts, 14);
  const handleCenter = { x: size * 0.72, y: size * 0.52 };
  const handle: Vec2[] = [];
  for (let i = 0; i <= 30; i++) handle.push(polar(handleCenter, size * 0.1, -100 + (i / 30) * 200));
  // steam wisp rising from the cup
  const steam = openPolyline(
    fracPoints(size, [
      [0.4, 0.24],
      [0.46, 0.16],
      [0.4, 0.1],
    ]),
    8,
  );
  return toPathFromParts([body, handle, steam], size);
}

function candleShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.4, 0.85],
    [0.4, 0.3],
    [0.6, 0.3],
    [0.6, 0.85],
  ]);
  const body = polygonEdges(pts, 14);
  const wick = openPolyline(
    fracPoints(size, [
      [0.5, 0.3],
      [0.5, 0.2],
    ]),
    8,
  );
  const center = { x: size * 0.5, y: size * 0.12 };
  const withFlame = withDetourLoop(wick, wick.length - 1, center, size * 0.035);
  const breaks = [body.length, ...withFlame.breaks.map((b) => b + body.length)];
  return toPath([...body, ...withFlame.points], size, breaks);
}

function scissorsShape(size: number): DrawingPath {
  const f = (fx: number, fy: number): Vec2 => ({ x: fx * size, y: fy * size });
  const pivot = f(0.5, 0.48);

  // Two blades: thin closed triangles from a narrow base at the pivot to a
  // pointed tip, crossed in an open X - real width, not bare lines.
  const blade = (tip: Vec2): Vec2[] => {
    const dx = tip.x - pivot.x;
    const dy = tip.y - pivot.y;
    const len = Math.hypot(dx, dy) || 1;
    const px = (-dy / len) * 0.032 * size;
    const py = (dx / len) * 0.032 * size;
    return polygonEdges([{ x: pivot.x + px, y: pivot.y + py }, tip, { x: pivot.x - px, y: pivot.y - py }], 10);
  };

  // Finger rings: ellipses elongated toward the pivot so they read as
  // attached handles rather than floating circles.
  const ring = (ux: number, uy: number): Vec2[] => {
    const cx = pivot.x + ux * 0.21 * size;
    const cy = pivot.y + uy * 0.21 * size;
    const major = 0.155 * size;
    const minor = 0.085 * size;
    const pts: Vec2[] = [];
    for (let i = 0; i <= 28; i++) {
      const t = (i / 28) * Math.PI * 2;
      const a = major * Math.cos(t);
      const b = minor * Math.sin(t);
      pts.push({ x: cx + ux * a - uy * b, y: cy + uy * a + ux * b });
    }
    return pts;
  };

  // Pivot screw as its own small floating circle.
  const screw: Vec2[] = [];
  for (let i = 0; i <= 14; i++) screw.push(polar(pivot, 0.03 * size, (i / 14) * 360));

  return toPathFromParts([blade(f(0.2, 0.12)), blade(f(0.8, 0.12)), ring(-0.474, 0.881), ring(0.474, 0.881), screw], size);
}

function pictureFrameShape(size: number): DrawingPath {
  const outer = fracPoints(size, [
    [0.15, 0.15],
    [0.85, 0.15],
    [0.85, 0.85],
    [0.15, 0.85],
  ]);
  const outerFrame = polygonEdges(outer, 12);
  const inner = fracPoints(size, [
    [0.27, 0.27],
    [0.73, 0.27],
    [0.73, 0.73],
    [0.27, 0.73],
  ]);
  const connector = openPolyline([outer[0], inner[0]], 8);
  const innerFrame = polygonEdges(inner, 10);
  return toPath([...outerFrame, ...connector, ...innerFrame], size);
}

function tableShape(size: number): DrawingPath {
  const rect = (x0: number, y0: number, x1: number, y1: number, per = 8): Vec2[] =>
    polygonEdges(fracPoints(size, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]), per);

  // Thick tabletop slab, two sturdy legs with real width, and a low cross
  // stretcher tying the legs together - all closed parts, no bare lines.
  const top = rect(0.12, 0.32, 0.88, 0.4, 12);
  const legLeft = rect(0.17, 0.4, 0.23, 0.85);
  const legRight = rect(0.77, 0.4, 0.83, 0.85);
  const stretcher = rect(0.23, 0.73, 0.77, 0.78, 10);

  return toPathFromParts([top, legLeft, legRight, stretcher], size);
}

function hammerShape(size: number): DrawingPath {
  // Cross-peen head: a solid block with a tapered wedge on the left, plus a
  // handle drawn as a real closed band (not a bare line).
  const head = polygonEdges(
    fracPoints(size, [
      [0.18, 0.25], // wedge tip
      [0.36, 0.14],
      [0.82, 0.14],
      [0.82, 0.36],
      [0.36, 0.36],
    ]),
    10,
  );
  const handle = polygonEdges(
    fracPoints(size, [
      [0.54, 0.36],
      [0.64, 0.36],
      [0.62, 0.9],
      [0.56, 0.9],
    ]),
    10,
  );
  // Eye detail where the handle passes through the head, as a floating loop.
  const eyeC = { x: 0.59 * size, y: 0.25 * size };
  const eye: Vec2[] = [];
  for (let i = 0; i <= 14; i++) eye.push(polar(eyeC, 0.035 * size, (i / 14) * 360));
  return toPathFromParts([head, handle, eye], size);
}

function broomShape(size: number): DrawingPath {
  const f = (fx: number, fy: number): Vec2 => ({ x: fx * size, y: fy * size });

  // Handle: a long thin band with real width, not a bare line.
  const handle = polygonEdges(
    fracPoints(size, [
      [0.47, 0.06],
      [0.53, 0.06],
      [0.53, 0.48],
      [0.47, 0.48],
    ]),
    10,
  );

  // Ferrule binding the brush to the handle.
  const ferrule = polygonEdges(
    fracPoints(size, [
      [0.44, 0.48],
      [0.56, 0.48],
      [0.6, 0.6],
      [0.4, 0.6],
    ]),
    8,
  );

  // Brush: a flaring trapezoid whose bottom edge is a sawtooth of bristle tips.
  const brushVerts: Vec2[] = [f(0.4, 0.6), f(0.28, 0.9)];
  const teeth = 8;
  for (let k = 1; k < teeth; k++) {
    const x = 0.28 + (0.72 - 0.28) * (k / teeth);
    brushVerts.push(f(x, k % 2 === 1 ? 0.85 : 0.9));
  }
  brushVerts.push(f(0.72, 0.9), f(0.6, 0.6));
  const brush = polygonEdges(brushVerts, 4);

  // Interior bristle strands fanning from the ferrule toward the tips.
  const strands: Vec2[][] = [
    [f(0.46, 0.63), f(0.4, 0.85)],
    [f(0.5, 0.63), f(0.5, 0.85)],
    [f(0.54, 0.63), f(0.6, 0.85)],
  ];

  return toPathFromParts([handle, ferrule, brush, ...strands], size);
}

function bedShape(size: number): DrawingPath {
  // Side view: a tall round-topped headboard post, a lower footboard post,
  // a rounded mattress band spanning them, and a puffy pillow at the head.
  const post = (x0: number, x1: number, yTop: number, yBot: number): Vec2[] => {
    const r = (x1 - x0) / 2;
    const cx = x0 + r;
    const yc = yTop + r;
    const pts: Vec2[] = [{ x: x0 * size, y: yBot * size }];
    for (let i = 0; i <= 16; i++) {
      const a = Math.PI + (i / 16) * Math.PI; // left side, over the rounded top, to right side
      pts.push({ x: (cx + r * Math.cos(a)) * size, y: (yc + r * Math.sin(a)) * size });
    }
    pts.push({ x: x1 * size, y: yBot * size }, { x: x0 * size, y: yBot * size }); // close along the floor
    return pts;
  };
  const headboard = post(0.1, 0.2, 0.18, 0.82);
  const footboard = post(0.8, 0.9, 0.42, 0.82);

  const mattress = smoothClosedPath(
    fracPoints(size, [
      [0.21, 0.53],
      [0.5, 0.51],
      [0.79, 0.53],
      [0.81, 0.595],
      [0.79, 0.66],
      [0.5, 0.68],
      [0.21, 0.66],
      [0.19, 0.595],
    ]),
    8,
  );

  const pillow = smoothClosedPath(
    fracPoints(size, [
      [0.24, 0.48],
      [0.31, 0.435],
      [0.38, 0.48],
      [0.31, 0.51],
    ]),
    10,
  );

  return toPathFromParts([headboard, footboard, mattress, pillow], size);
}

function sofaShape(size: number): DrawingPath {
  // Front view built from real parts: a rounded backrest between two rounded
  // armrests, a seat cushion spanning them, and two stub legs.
  const back = smoothClosedPath(
    fracPoints(size, [
      [0.24, 0.56],
      [0.24, 0.38],
      [0.3, 0.3],
      [0.5, 0.28],
      [0.7, 0.3],
      [0.76, 0.38],
      [0.76, 0.56],
      [0.5, 0.58],
    ]),
    8,
  );
  const arm = (x0: number): Vec2[] =>
    smoothClosedPath(
      fracPoints(size, [
        [x0, 0.74],
        [x0, 0.52],
        [x0 + 0.03, 0.44],
        [x0 + 0.08, 0.42],
        [x0 + 0.13, 0.44],
        [x0 + 0.16, 0.52],
        [x0 + 0.16, 0.74],
        [x0 + 0.08, 0.755],
      ]),
      7,
    );
  const seat = smoothClosedPath(
    fracPoints(size, [
      [0.26, 0.58],
      [0.5, 0.56],
      [0.74, 0.58],
      [0.76, 0.65],
      [0.74, 0.72],
      [0.5, 0.74],
      [0.26, 0.72],
      [0.24, 0.65],
    ]),
    8,
  );
  const leg = (x0: number): Vec2[] =>
    polygonEdges(
      fracPoints(size, [
        [x0, 0.755],
        [x0 + 0.05, 0.755],
        [x0 + 0.05, 0.86],
        [x0, 0.86],
      ]),
      6,
    );
  return toPathFromParts([back, arm(0.1), arm(0.74), seat, leg(0.15), leg(0.8)], size);
}

function mirrorShape(size: number): DrawingPath {
  // The stand attaches at the oval's true bottom point, but the oval loop
  // itself closes back to its start on the left side - appending the stand
  // right after used to draw a stray line clear across the middle of the
  // mirror to reach it. Breaking them into separate parts removes that line;
  // the stand still looks attached since its start coincides with a point
  // already on the oval.
  const center = { x: size / 2, y: size * 0.42 };
  const rx = size * 0.28;
  const ry = size * 0.32;
  const points: Vec2[] = [];
  for (let i = 0; i <= 60; i++) {
    const t = (i / 60) * Math.PI * 2 - Math.PI / 2;
    points.push({ x: center.x + rx * Math.sin(t), y: center.y - ry * Math.cos(t) });
  }
  const stand = openPolyline(
    fracPoints(size, [
      [0.5, 0.74],
      [0.5, 0.9],
    ]),
    14,
  );
  return toPathFromParts([points, stand], size);
}

function bathtubShape(size: number): DrawingPath {
  // Clawfoot tub, side view: the outer wall runs down the left, across the
  // bottom and up the right, then the inner rim dips back down as the basin -
  // so the wall thickness and the hollow both read.
  const tub = smoothClosedPath(
    fracPoints(size, [
      [0.14, 0.48], // top-left rim (outer)
      [0.13, 0.6],
      [0.2, 0.72],
      [0.5, 0.75],
      [0.8, 0.72],
      [0.87, 0.6],
      [0.86, 0.48], // top-right rim (outer)
      [0.8, 0.5], // inner rim right
      [0.5, 0.62], // basin dip
      [0.2, 0.5], // inner rim left
    ]),
    7,
  );

  // Gooseneck faucet mounted on the left rim, arching over into the basin.
  const faucet = polygonEdges(
    fracPoints(size, [
      [0.15, 0.48],
      [0.15, 0.33],
      [0.26, 0.33],
      [0.26, 0.42],
      [0.23, 0.42],
      [0.23, 0.36],
      [0.19, 0.36],
      [0.19, 0.48],
    ]),
    5,
  );

  // Two clawfoot feet, flaring out at the base.
  const foot = (cx: number): Vec2[] =>
    smoothClosedPath(
      fracPoints(size, [
        [cx - 0.03, 0.71],
        [cx - 0.045, 0.82],
        [cx, 0.86],
        [cx + 0.045, 0.82],
        [cx + 0.03, 0.71],
      ]),
      6,
    );

  return toPathFromParts([tub, faucet, foot(0.26), foot(0.74)], size);
}

function teapotShape(size: number): DrawingPath {
  // Rounded belly with a flatter rim on top for the lid to sit on.
  const body = smoothClosedPath(
    fracPoints(size, [
      [0.28, 0.55],
      [0.3, 0.42],
      [0.42, 0.36],
      [0.58, 0.36],
      [0.7, 0.42],
      [0.72, 0.55],
      [0.66, 0.69],
      [0.5, 0.73],
      [0.34, 0.69],
    ]),
    9,
  );

  // Tapered pouring spout angling up off the right shoulder (a solid closed
  // shape with real width, not a bare line).
  const spout = polygonEdges(
    fracPoints(size, [
      [0.68, 0.42],
      [0.9, 0.32],
      [0.88, 0.4],
      [0.7, 0.52],
    ]),
    8,
  );

  // Handle: a closed band bulging left with a hollow through the middle - the
  // outer edge runs down, the inner edge runs back up.
  const handle = smoothClosedPath(
    fracPoints(size, [
      [0.3, 0.44],
      [0.16, 0.44],
      [0.12, 0.54],
      [0.16, 0.64],
      [0.3, 0.62],
      [0.22, 0.6],
      [0.19, 0.54],
      [0.22, 0.46],
    ]),
    7,
  );

  // Lid: a shallow dome on the rim, plus a floating knob on top.
  const lid = smoothClosedPath(
    fracPoints(size, [
      [0.42, 0.36],
      [0.46, 0.31],
      [0.5, 0.3],
      [0.54, 0.31],
      [0.58, 0.36],
    ]),
    8,
  );
  const knobC = { x: 0.5 * size, y: 0.265 * size };
  const knob: Vec2[] = [];
  for (let i = 0; i <= 14; i++) knob.push(polar(knobC, 0.03 * size, (i / 14) * 360));

  return toPathFromParts([body, spout, handle, lid, knob], size);
}

const HOME_SHAPES: ShapeDefinition[] = [
  standalone("home-door", "Door", "home", doorShape),
  standalone("home-window", "Window", "home", windowShape),
  standalone("home-key", "Key", "home", keyShape),
  standalone("home-mug", "Mug", "home", mugShape),
  standalone("home-candle", "Candle", "home", candleShape),
  standalone("home-scissors", "Scissors", "home", scissorsShape),
  standalone("home-hammer", "Hammer", "home", hammerShape),
  standalone("home-broom", "Broom", "home", broomShape),
  standalone("home-table", "Table", "home", tableShape),
  standalone("home-chair", "Chair", "home", chairShape),
  standalone("home-lamp", "Lamp", "home", lampShape),
  standalone("home-clock", "Clock", "home", clockShape),
  standalone("home-mirror", "Mirror", "home", mirrorShape),
  standalone("home-pictureframe", "Picture Frame", "home", pictureFrameShape),
  standalone("home-umbrella", "Umbrella", "home", umbrellaShape),
  standalone("home-teapot", "Teapot", "home", teapotShape),
  standalone("home-bathtub", "Bathtub", "home", bathtubShape),
  standalone("home-sofa", "Sofa", "home", sofaShape),
  standalone("home-bed", "Bed", "home", bedShape),
  standalone("home-house", "House", "home", houseShape),
];

// ==================== CALLIGRAPHY ====================

function sCurveShape(size: number): DrawingPath {
  const points: Vec2[] = [];
  const steps = 100;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: size * 0.5 + size * 0.22 * Math.sin(t * Math.PI * 2),
      y: size * 0.15 + t * size * 0.7,
    });
  }
  return toPath(points, size);
}

function swirlFlourishShape(size: number): DrawingPath {
  const center = { x: size * 0.5, y: size * 0.5 };
  const points: Vec2[] = [];
  const steps = 100;
  const turns = 1.8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push(polar(center, size * 0.05 + t * size * 0.28, t * turns * 360));
  }
  return toPath(points, size);
}

function waveRibbonShape(size: number): DrawingPath {
  const points: Vec2[] = [];
  const steps = 100;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({ x: size * 0.15 + t * size * 0.7, y: size * 0.5 + size * 0.15 * Math.sin(t * Math.PI * 3) });
  }
  return toPath(points, size);
}

function loopFlourishShape(size: number): DrawingPath {
  const points: Vec2[] = [];
  const steps = 80;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 1.5;
    points.push({ x: size * 0.5 + size * 0.22 * Math.sin(t), y: size * 0.5 - size * 0.22 * Math.cos(t) });
  }
  points.push({ x: size * 0.75, y: size * 0.65 });
  return toPath(points, size);
}

function swooshShape(size: number): DrawingPath {
  const points: Vec2[] = [];
  const steps = 80;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({ x: size * 0.15 + t * size * 0.6, y: size * 0.6 - size * 0.2 * Math.sin(t * Math.PI) });
  }
  points.push({ x: size * 0.85, y: size * 0.45 });
  return toPath(points, size);
}

function figure8FlourishShape(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const points: Vec2[] = [];
  const steps = 120;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    points.push({
      x: center.x + size * 0.28 * Math.cos(t),
      y: center.y + size * 0.16 * Math.sin(t) * Math.cos(t) * 1.3,
    });
  }
  return toPath(points, size);
}

function gentleArcShape(size: number): DrawingPath {
  const points: Vec2[] = [];
  const steps = 60;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({ x: size * 0.15 + t * size * 0.7, y: size * 0.6 - size * 0.25 * Math.sin(t * Math.PI) });
  }
  return toPath(points, size);
}

function zCurveShape(size: number): DrawingPath {
  const points: Vec2[] = [];
  const steps = 90;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: size * 0.25 + size * 0.2 * Math.sin(t * Math.PI * 2 + Math.PI),
      y: size * 0.15 + t * size * 0.7,
    });
  }
  return toPath(points, size);
}

function doubleWaveShape(size: number): DrawingPath {
  const points: Vec2[] = [];
  const steps = 120;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: size * 0.12 + t * size * 0.76,
      y: size * 0.5 + size * 0.1 * Math.sin(t * Math.PI * 5) + size * 0.14 * Math.sin(t * Math.PI * 1.5),
    });
  }
  return toPath(points, size);
}

function tightSpiralTailShape(size: number): DrawingPath {
  const center = { x: size * 0.6, y: size * 0.4 };
  const points: Vec2[] = [];
  const steps = 90;
  const turns = 2.6;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push(polar(center, size * 0.03 + t * size * 0.2, t * turns * 360));
  }
  const tail: Vec2[] = [];
  const tailSteps = 40;
  for (let i = 1; i <= tailSteps; i++) {
    const t = i / tailSteps;
    tail.push({ x: center.x + size * 0.2 * Math.cos(0) - t * size * 0.35, y: center.y + size * 0.2 + t * size * 0.3 });
  }
  return toPath([...points, ...tail], size);
}

function ribbonTwistShape(size: number): DrawingPath {
  const points: Vec2[] = [];
  const steps = 140;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const envelope = Math.sin(t * Math.PI);
    points.push({
      x: size * 0.1 + t * size * 0.8,
      y: size * 0.5 + size * 0.22 * envelope * Math.sin(t * Math.PI * 4),
    });
  }
  return toPath(points, size);
}

function windingPathShape(size: number): DrawingPath {
  const points: Vec2[] = [];
  const steps = 130;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: size * 0.15 + t * size * 0.7 + size * 0.06 * Math.sin(t * Math.PI * 6),
      y: size * 0.15 + t * size * 0.7,
    });
  }
  return toPath(points, size);
}

function doubleLoopShape(size: number): DrawingPath {
  const leftCenter = { x: size * 0.35, y: size * 0.5 };
  const rightCenter = { x: size * 0.65, y: size * 0.5 };
  const r = size * 0.18;
  const points: Vec2[] = [];
  for (let i = 0; i <= 60; i++) points.push(polar(leftCenter, r, 90 - (i / 60) * 360));
  for (let i = 0; i <= 60; i++) points.push(polar(rightCenter, r, 90 + (i / 60) * 360));
  return toPath(points, size);
}

function tripleLoopRibbonShape(size: number): DrawingPath {
  const centers = [
    { x: size * 0.25, y: size * 0.5 },
    { x: size * 0.5, y: size * 0.5 },
    { x: size * 0.75, y: size * 0.5 },
  ];
  const r = size * 0.13;
  const points: Vec2[] = [];
  for (let c = 0; c < centers.length; c++) {
    const dir = c % 2 === 0 ? 1 : -1;
    for (let i = 0; i <= 50; i++) points.push(polar(centers[c], r, 90 + dir * (i / 50) * 360));
  }
  return toPath(points, size);
}

function looseSpiralShape(size: number): DrawingPath {
  const center = { x: size * 0.5, y: size * 0.55 };
  const points: Vec2[] = [];
  const steps = 130;
  const turns = 2.4;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push(polar(center, size * 0.02 + t * size * 0.38, -t * turns * 360));
  }
  return toPath(points, size);
}

function heartFlourishShape(size: number): DrawingPath {
  const raw: Vec2[] = [];
  const steps = 90;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    raw.push({ x, y });
  }
  const scale = (size * 0.4) / 34;
  const center = { x: size * 0.5, y: size * 0.35 };
  const heartPts = raw.map((p) => ({ x: center.x + p.x * scale, y: center.y + p.y * scale }));
  const tail: Vec2[] = [];
  const tailSteps = 50;
  for (let i = 1; i <= tailSteps; i++) {
    const t = i / tailSteps;
    tail.push({ x: size * 0.5 + t * size * 0.3, y: size * 0.6 + t * size * 0.28 * Math.sin(t * Math.PI) });
  }
  return toPath([...heartPts, ...tail], size);
}

function crossHatchLoopShape(size: number): DrawingPath {
  const points: Vec2[] = [];
  const steps = 100;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    points.push({
      x: size * 0.5 + size * 0.3 * Math.sin(3 * t + Math.PI / 2),
      y: size * 0.5 + size * 0.3 * Math.sin(2 * t),
    });
  }
  return toPath(points, size);
}

function pretzelLoopShape(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const points: Vec2[] = [];
  const steps = 140;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    points.push({
      x: center.x + size * 0.3 * Math.sin(2 * t),
      y: center.y + size * 0.22 * Math.sin(3 * t),
    });
  }
  return toPath(points, size);
}

function cascadingLoopsShape(size: number): DrawingPath {
  const points: Vec2[] = [];
  const loopCount = 4;
  const r = size * 0.1;
  for (let l = 0; l < loopCount; l++) {
    const cx = size * (0.18 + l * 0.22);
    const cy = size * (0.3 + l * 0.13);
    const center = { x: cx, y: cy };
    for (let i = 0; i <= 40; i++) points.push(polar(center, r, (i / 40) * 360 - 90));
  }
  return toPath(points, size);
}

function ornateFigureEightShape(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const points: Vec2[] = [];
  const steps = 160;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const wobble = 1 + 0.15 * Math.sin(t * 6);
    points.push({
      x: center.x + size * 0.3 * wobble * Math.cos(t),
      y: center.y + size * 0.18 * wobble * Math.sin(t) * Math.cos(t) * 1.4,
    });
  }
  return toPath(points, size);
}

const CALLIGRAPHY_SHAPES: ShapeDefinition[] = [
  standalone("calli-s-curve", "S-Curve", "calligraphy", sCurveShape),
  standalone("calli-gentlearc", "Gentle Arc", "calligraphy", gentleArcShape),
  standalone("calli-zcurve", "Z-Curve", "calligraphy", zCurveShape),
  standalone("calli-swoosh", "Swoosh Underline", "calligraphy", swooshShape),
  standalone("calli-ribbon", "Wave Ribbon", "calligraphy", waveRibbonShape),
  standalone("calli-ribbontwist", "Ribbon Twist", "calligraphy", ribbonTwistShape),
  standalone("calli-doublewave", "Double Wave", "calligraphy", doubleWaveShape),
  standalone("calli-windingpath", "Winding Path", "calligraphy", windingPathShape),
  standalone("calli-loop", "Loop Flourish", "calligraphy", loopFlourishShape),
  standalone("calli-doubleloop", "Double Loop", "calligraphy", doubleLoopShape),
  standalone("calli-tripleloopribbon", "Triple Loop Ribbon", "calligraphy", tripleLoopRibbonShape),
  standalone("calli-cascadingloops", "Cascading Loops", "calligraphy", cascadingLoopsShape),
  standalone("calli-swirl", "Swirl Flourish", "calligraphy", swirlFlourishShape),
  standalone("calli-loosespiral", "Loose Spiral", "calligraphy", looseSpiralShape),
  standalone("calli-spiraltail", "Spiral Tail", "calligraphy", tightSpiralTailShape),
  standalone("calli-heartflourish", "Heart Flourish", "calligraphy", heartFlourishShape),
  standalone("calli-figure8", "Figure-8 Flourish", "calligraphy", figure8FlourishShape),
  standalone("calli-ornatefigure8", "Ornate Figure-8", "calligraphy", ornateFigureEightShape),
  standalone("calli-crosshatchloop", "Cross-Hatch Loop", "calligraphy", crossHatchLoopShape),
  standalone("calli-pretzelloop", "Pretzel Loop", "calligraphy", pretzelLoopShape),
];

// ==================== FANTASY ====================

function crownShape(size: number): DrawingPath {
  // Crown silhouette with three pointed peaks over a band, a jewel at each peak
  // tip, a line dividing the band, and small gems set along the band.
  const outline = polygonEdges(
    fracPoints(size, [
      [0.2, 0.72],
      [0.18, 0.44],
      [0.32, 0.54],
      [0.4, 0.3],
      [0.5, 0.5],
      [0.6, 0.3],
      [0.68, 0.54],
      [0.82, 0.44],
      [0.8, 0.72],
    ]),
    8,
  );
  const bandLine = openPolyline(
    fracPoints(size, [
      [0.2, 0.62],
      [0.8, 0.62],
    ]),
    8,
  );
  const jewel = (fx: number, fy: number, r: number) => {
    const loop: Vec2[] = [];
    for (let i = 0; i <= 14; i++) loop.push(polar({ x: size * fx, y: size * fy }, size * r, (i / 14) * 360));
    return loop;
  };
  return toPathFromParts(
    [
      outline,
      bandLine,
      jewel(0.4, 0.28, 0.03),
      jewel(0.6, 0.28, 0.03),
      jewel(0.5, 0.48, 0.03),
      jewel(0.32, 0.67, 0.022),
      jewel(0.5, 0.67, 0.022),
      jewel(0.68, 0.67, 0.022),
    ],
    size,
  );
}

function dragonShape(size: number): DrawingPath {
  // Angular dragon head in profile facing left: long snout, jaw, two swept-back
  // horns, a mouth line, an eye and a nostril - reads instantly as a dragon.
  const head = polygonEdges(
    fracPoints(size, [
      [0.1, 0.48],
      [0.24, 0.4],
      [0.38, 0.36],
      [0.52, 0.38],
      [0.62, 0.46],
      [0.66, 0.6],
      [0.6, 0.74],
      [0.46, 0.78],
      [0.36, 0.72],
      [0.3, 0.6],
      [0.18, 0.56],
      [0.1, 0.56],
    ]),
    6,
  );
  const mouth = openPolyline(
    fracPoints(size, [
      [0.11, 0.52],
      [0.3, 0.55],
    ]),
    6,
  );
  const horn = (base: [number, number], tip: [number, number], back: [number, number]) =>
    polygonEdges(fracPoints(size, [base, tip, back]), 5);
  const eye: Vec2[] = [];
  for (let i = 0; i <= 12; i++) eye.push(polar({ x: size * 0.45, y: size * 0.47 }, size * 0.025, (i / 12) * 360));
  const nostril: Vec2[] = [];
  for (let i = 0; i <= 8; i++) nostril.push(polar({ x: size * 0.16, y: size * 0.5 }, size * 0.014, (i / 8) * 360));
  return toPathFromParts(
    [
      head,
      mouth,
      horn([0.46, 0.38], [0.6, 0.2], [0.54, 0.41]),
      horn([0.56, 0.43], [0.72, 0.28], [0.64, 0.49]),
      eye,
      nostril,
    ],
    size,
  );
}

function swordShape(size: number): DrawingPath {
  // Blade tapering to a point with a center fuller groove, a crossguard, a
  // wrapped grip and a round pommel - each as its own part.
  const blade = polygonEdges(
    fracPoints(size, [
      [0.5, 0.08],
      [0.55, 0.2],
      [0.55, 0.58],
      [0.45, 0.58],
      [0.45, 0.2],
    ]),
    8,
  );
  const fuller = openPolyline(
    fracPoints(size, [
      [0.5, 0.16],
      [0.5, 0.56],
    ]),
    10,
  );
  const crossguard = polygonEdges(
    fracPoints(size, [
      [0.3, 0.58],
      [0.7, 0.58],
      [0.7, 0.64],
      [0.3, 0.64],
    ]),
    6,
  );
  const grip = polygonEdges(
    fracPoints(size, [
      [0.46, 0.64],
      [0.54, 0.64],
      [0.54, 0.82],
      [0.46, 0.82],
    ]),
    5,
  );
  // Diagonal wrap lines across the grip.
  const wrap = (fy: number) =>
    openPolyline(
      fracPoints(size, [
        [0.46, fy],
        [0.54, fy + 0.03],
      ]),
      3,
    );
  const pommel: Vec2[] = [];
  for (let i = 0; i <= 16; i++) pommel.push(polar({ x: size * 0.5, y: size * 0.86 }, size * 0.045, (i / 16) * 360));
  return toPathFromParts([blade, fuller, crossguard, grip, wrap(0.67), wrap(0.72), wrap(0.77), pommel], size);
}

function kiteShieldShape(size: number): DrawingPath {
  // Heater shield outline with a heraldic cross dividing it into quarters,
  // an inner border following the outline, and a round boss at the center.
  const outer = fracPoints(size, [
    [0.5, 0.14],
    [0.76, 0.26],
    [0.72, 0.58],
    [0.5, 0.9],
    [0.28, 0.58],
    [0.24, 0.26],
  ]);
  const outline = polygonEdges(outer, 12);
  // Inner border: the same outline scaled slightly toward the center.
  const center = { x: size * 0.5, y: size * 0.5 };
  const innerBorder = polygonEdges(
    outer.map((p) => ({ x: center.x + (p.x - center.x) * 0.85, y: center.y + (p.y - center.y) * 0.85 })),
    12,
  );
  const vertical = openPolyline(
    fracPoints(size, [
      [0.5, 0.16],
      [0.5, 0.86],
    ]),
    10,
  );
  const horizontal = openPolyline(
    fracPoints(size, [
      [0.27, 0.4],
      [0.73, 0.4],
    ]),
    8,
  );
  const boss: Vec2[] = [];
  for (let i = 0; i <= 16; i++) boss.push(polar({ x: size * 0.5, y: size * 0.44 }, size * 0.06, (i / 16) * 360));
  return toPathFromParts([outline, innerBorder, vertical, horizontal, boss], size);
}

function unicornShape(size: number): DrawingPath {
  // Horse head-and-neck profile with the unicorn's signature spiral horn
  // (a slender triangle with cross ticks), an ear, a flowing mane and an eye.
  const head = smoothClosedPath(
    fracPoints(size, [
      [0.44, 0.14],
      [0.52, 0.2],
      [0.58, 0.36],
      [0.66, 0.54],
      [0.66, 0.66],
      [0.58, 0.72],
      [0.5, 0.68],
      [0.46, 0.54],
      [0.36, 0.5],
      [0.28, 0.62],
      [0.24, 0.82],
      [0.36, 0.84],
      [0.4, 0.62],
      [0.5, 0.5],
      [0.44, 0.34],
      [0.38, 0.2],
    ]),
    9,
  );
  // Long tapering horn rising from the forehead to a fine tip.
  const horn = polygonEdges(
    fracPoints(size, [
      [0.4, 0.185],
      [0.61, 0.01],
      [0.47, 0.165],
    ]),
    6,
  );
  // Spiral ridges: evenly spaced bands running across the tapering horn.
  const tick = (from: [number, number], to: [number, number]) => openPolyline(fracPoints(size, [from, to]), 3);
  const ridges = [
    tick([0.442, 0.15], [0.498, 0.134]),
    tick([0.484, 0.115], [0.526, 0.103]),
    tick([0.526, 0.08], [0.554, 0.072]),
    tick([0.568, 0.045], [0.582, 0.041]),
  ];
  const ear = polygonEdges(
    fracPoints(size, [
      [0.36, 0.18],
      [0.33, 0.07],
      [0.42, 0.16],
    ]),
    4,
  );
  const mane = openPolyline(
    fracPoints(size, [
      [0.4, 0.18],
      [0.34, 0.3],
      [0.32, 0.45],
      [0.27, 0.6],
      [0.24, 0.78],
    ]),
    7,
  );
  const eye: Vec2[] = [];
  for (let i = 0; i <= 12; i++) eye.push(polar({ x: size * 0.5, y: size * 0.34 }, size * 0.02, (i / 12) * 360));
  // Nostril near the muzzle tip.
  const nostril: Vec2[] = [];
  for (let i = 0; i <= 10; i++) nostril.push(polar({ x: size * 0.6, y: size * 0.6 }, size * 0.016, (i / 10) * 360));
  return toPathFromParts([head, horn, ...ridges, ear, mane, eye, nostril], size);
}

function wandShape(size: number): DrawingPath {
  // A straight handle (thin closed bar) with a big five-pointed star at the tip
  // and a couple of sparkle marks - the star carries the shape, easy to draw.
  const starCenter = { x: size * 0.72, y: size * 0.28 };
  const star: Vec2[] = [];
  for (let i = 0; i < 10; i++) {
    star.push(polar(starCenter, i % 2 === 0 ? size * 0.16 : size * 0.065, i * 36 - 90));
  }
  star.push(star[0]);
  // Handle as a thin rectangle running from under the star down to the corner.
  const handle = polygonEdges(
    fracPoints(size, [
      [0.66, 0.42],
      [0.72, 0.38],
      [0.34, 0.84],
      [0.28, 0.8],
    ]),
    6,
  );
  const sparkle = (fx: number, fy: number, r: number) =>
    openPolyline(
      [
        { x: size * (fx - r), y: size * fy },
        { x: size * (fx + r), y: size * fy },
        { x: size * fx, y: size * fy },
        { x: size * fx, y: size * (fy - r) },
        { x: size * fx, y: size * (fy + r) },
      ],
      3,
    );
  return toPathFromParts([star, handle, sparkle(0.42, 0.3, 0.04), sparkle(0.5, 0.5, 0.03)], size);
}

function gemShape(size: number): DrawingPath {
  // Brilliant-cut gem: flat table on top, a crown sloping out to the widest
  // girdle, then a pavilion tapering to a point - with facet lines as their
  // own parts so no stray connectors cross the stone.
  const outline = polygonEdges(
    fracPoints(size, [
      [0.34, 0.26],
      [0.66, 0.26],
      [0.84, 0.44],
      [0.5, 0.88],
      [0.16, 0.44],
    ]),
    8,
  );
  const girdle = openPolyline(
    fracPoints(size, [
      [0.16, 0.44],
      [0.84, 0.44],
    ]),
    8,
  );
  const crownFacet = (fromX: number, toX: number) =>
    openPolyline(
      fracPoints(size, [
        [fromX, 0.26],
        [toX, 0.44],
      ]),
      5,
    );
  const pavilionFacet = (fromX: number) =>
    openPolyline(
      fracPoints(size, [
        [fromX, 0.44],
        [0.5, 0.88],
      ]),
      6,
    );
  return toPathFromParts(
    [
      outline,
      girdle,
      crownFacet(0.34, 0.28),
      crownFacet(0.66, 0.72),
      pavilionFacet(0.28),
      pavilionFacet(0.5),
      pavilionFacet(0.72),
    ],
    size,
  );
}

function scrollShape(size: number): DrawingPath {
  // Parchment sheet with a rolled cylinder at the top and bottom (each shown as
  // an ellipse with a spiral curl at one end), and lines of writing between.
  const sheet = polygonEdges(
    fracPoints(size, [
      [0.3, 0.26],
      [0.7, 0.26],
      [0.7, 0.74],
      [0.3, 0.74],
    ]),
    8,
  );
  const roll = (cy: number) => {
    const loop: Vec2[] = [];
    for (let i = 0; i <= 28; i++) {
      const t = (i / 28) * Math.PI * 2;
      loop.push({ x: size * (0.5 + 0.22 * Math.cos(t)), y: size * (cy + 0.06 * Math.sin(t)) });
    }
    return loop;
  };
  const curl = (fx: number, cy: number) => {
    const c = { x: size * fx, y: size * cy };
    const spiral: Vec2[] = [];
    const steps = 30;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      spiral.push(polar(c, size * (0.055 - 0.045 * t), -90 + t * 1.6 * 360));
    }
    return spiral;
  };
  const textLine = (fy: number) =>
    openPolyline(
      fracPoints(size, [
        [0.36, fy],
        [0.64, fy],
      ]),
      6,
    );
  return toPathFromParts(
    [sheet, roll(0.24), roll(0.76), curl(0.3, 0.24), curl(0.7, 0.76), textLine(0.4), textLine(0.5), textLine(0.6)],
    size,
  );
}

function skullShape(size: number): DrawingPath {
  // Bold rounded cranium narrowing to a small jaw, two big round eye sockets
  // and a triangular nose - large, simple features that are easy to trace.
  const skull = smoothClosedPath(
    fracPoints(size, [
      [0.5, 0.14],
      [0.74, 0.26],
      [0.78, 0.5],
      [0.64, 0.62],
      [0.6, 0.78],
      [0.4, 0.78],
      [0.36, 0.62],
      [0.22, 0.5],
      [0.26, 0.26],
    ]),
    10,
  );
  const eye = (fx: number) => {
    const loop: Vec2[] = [];
    for (let i = 0; i <= 20; i++) loop.push(polar({ x: size * fx, y: size * 0.46 }, size * 0.09, (i / 20) * 360));
    return loop;
  };
  const nose = polygonEdges(
    fracPoints(size, [
      [0.5, 0.54],
      [0.55, 0.64],
      [0.45, 0.64],
    ]),
    5,
  );
  return toPathFromParts([skull, eye(0.38), eye(0.62), nose], size);
}

function ghostShape(size: number): DrawingPath {
  // Closed silhouette: rounded head dome, straight sides, and a wavy tattered
  // hem at the bottom, plus two round eyes and an O mouth.
  const cx = size * 0.5;
  const r = size * 0.28;
  const domeCenter = { x: cx, y: size * 0.42 };
  const outline: Vec2[] = [];
  const arcSteps = 40;
  for (let i = 0; i <= arcSteps; i++) outline.push(polar(domeCenter, r, 180 + (i / arcSteps) * 180));
  outline.push({ x: cx + r, y: size * 0.72 });
  const waveSteps = 30;
  for (let i = 0; i <= waveSteps; i++) {
    const t = i / waveSteps;
    outline.push({
      x: size * 0.78 - t * size * 0.56,
      y: size * 0.72 + size * 0.06 * Math.sin(t * Math.PI * 3),
    });
  }
  outline.push({ x: cx - r, y: size * 0.42 }, outline[0]);
  const eye = (fx: number) => {
    const loop: Vec2[] = [];
    for (let i = 0; i <= 16; i++) loop.push(polar({ x: size * fx, y: size * 0.4 }, size * 0.05, (i / 16) * 360));
    return loop;
  };
  const mouth: Vec2[] = [];
  for (let i = 0; i <= 16; i++) mouth.push(polar({ x: cx, y: size * 0.56 }, size * 0.04, (i / 16) * 360));
  return toPathFromParts([outline, eye(0.42), eye(0.58), mouth], size);
}

function wizardHatShape(size: number): DrawingPath {
  // Cone with a slightly bent tip sitting on a wide brim, all in one closed
  // outline, plus a hatband line and a single star - simple and recognizable.
  const outline = smoothClosedPath(
    fracPoints(size, [
      [0.4, 0.12],
      [0.6, 0.5],
      [0.86, 0.74],
      [0.9, 0.82],
      [0.1, 0.82],
      [0.14, 0.74],
      [0.4, 0.5],
    ]),
    9,
  );
  const band = openPolyline(
    fracPoints(size, [
      [0.28, 0.63],
      [0.72, 0.63],
    ]),
    8,
  );
  // Five-pointed star decoration on the cone.
  const starCenter = { x: size * 0.5, y: size * 0.4 };
  const star: Vec2[] = [];
  for (let i = 0; i < 10; i++) {
    star.push(polar(starCenter, i % 2 === 0 ? size * 0.06 : size * 0.025, i * 36 - 90));
  }
  star.push(star[0]);
  return toPathFromParts([outline, band, star], size);
}

function fairyWingsShape(size: number): DrawingPath {
  // Two symmetric wings, each a single closed shape with an upper and lower
  // lobe meeting at the body center - drawn as separate parts (no connector).
  const wing = (mirror: number) =>
    smoothClosedPath(
      fracPoints(size, [
        [0.5, 0.5],
        [0.5 + mirror * 0.16, 0.32],
        [0.5 + mirror * 0.34, 0.28],
        [0.5 + mirror * 0.4, 0.42],
        [0.5 + mirror * 0.26, 0.5],
        [0.5 + mirror * 0.4, 0.6],
        [0.5 + mirror * 0.34, 0.74],
        [0.5 + mirror * 0.16, 0.7],
      ]),
      9,
    );
  return toPathFromParts([wing(-1), wing(1)], size);
}

function potionBottleShape(size: number): DrawingPath {
  // One continuous outline for cork, neck and round body, plus a single liquid
  // line across the middle - simple and easy to trace.
  const outline = smoothClosedPath(
    fracPoints(size, [
      [0.42, 0.12],
      [0.58, 0.12],
      [0.575, 0.26],
      [0.7, 0.42],
      [0.74, 0.66],
      [0.6, 0.86],
      [0.4, 0.86],
      [0.26, 0.66],
      [0.3, 0.42],
      [0.425, 0.26],
    ]),
    9,
  );
  const liquid = openPolyline(
    fracPoints(size, [
      [0.29, 0.56],
      [0.71, 0.56],
    ]),
    8,
  );
  return toPathFromParts([outline, liquid], size);
}

function cauldronShape(size: number): DrawingPath {
  // Round pot body, an oval rim across the top, and three short legs - plus a
  // small rim lip on each side. Bold and simple to trace.
  const body = smoothClosedPath(
    fracPoints(size, [
      [0.22, 0.46],
      [0.16, 0.62],
      [0.28, 0.8],
      [0.5, 0.84],
      [0.72, 0.8],
      [0.84, 0.62],
      [0.78, 0.46],
    ]),
    10,
  );
  // Oval rim opening at the top.
  const rim: Vec2[] = [];
  for (let i = 0; i <= 28; i++) {
    const t = (i / 28) * Math.PI * 2;
    rim.push({ x: size * (0.5 + 0.3 * Math.cos(t)), y: size * (0.44 + 0.055 * Math.sin(t)) });
  }
  const leg = (fx: number) =>
    openPolyline(
      fracPoints(size, [
        [fx, 0.82],
        [fx, 0.92],
      ]),
      4,
    );
  return toPathFromParts([body, rim, leg(0.34), leg(0.5), leg(0.66)], size);
}

function treasureChestShape(size: number): DrawingPath {
  // Boxy base and a domed lid as two separate closed shapes, plus a lock plate
  // straddling the seam. Very drawable.
  const base = polygonEdges(
    fracPoints(size, [
      [0.2, 0.56],
      [0.8, 0.56],
      [0.8, 0.86],
      [0.2, 0.86],
    ]),
    8,
  );
  const lid = smoothClosedPath(
    fracPoints(size, [
      [0.2, 0.56],
      [0.24, 0.4],
      [0.5, 0.33],
      [0.76, 0.4],
      [0.8, 0.56],
      [0.5, 0.56],
    ]),
    8,
  );
  const lock = polygonEdges(
    fracPoints(size, [
      [0.45, 0.5],
      [0.55, 0.5],
      [0.55, 0.64],
      [0.45, 0.64],
    ]),
    5,
  );
  return toPathFromParts([base, lid, lock], size);
}

function witchsBroomShape(size: number): DrawingPath {
  // Thin diagonal handle, a binding band, and a fanned bundle of bristles
  // drawn as a closed shape with a couple of straw lines inside.
  const handle = polygonEdges(
    fracPoints(size, [
      [0.68, 0.1],
      [0.72, 0.13],
      [0.46, 0.66],
      [0.42, 0.63],
    ]),
    6,
  );
  const binding = openPolyline(
    fracPoints(size, [
      [0.38, 0.6],
      [0.5, 0.66],
    ]),
    5,
  );
  const bristles = smoothClosedPath(
    fracPoints(size, [
      [0.46, 0.66],
      [0.52, 0.72],
      [0.4, 0.92],
      [0.22, 0.94],
      [0.16, 0.86],
      [0.36, 0.68],
    ]),
    7,
  );
  const straw = (from: [number, number], to: [number, number]) => openPolyline(fracPoints(size, [from, to]), 5);
  return toPathFromParts(
    [handle, binding, bristles, straw([0.4, 0.7], [0.24, 0.9]), straw([0.44, 0.72], [0.34, 0.92])],
    size,
  );
}

function castleShape(size: number): DrawingPath {
  // Symmetric keep: two crenellated side towers, a taller central tower with a
  // flag, an arched gate and a window in each tower.
  const outline = polygonEdges(
    fracPoints(size, [
      [0.12, 0.86],
      [0.12, 0.4],
      [0.18, 0.4],
      [0.18, 0.32],
      [0.24, 0.32],
      [0.24, 0.4],
      [0.3, 0.4],
      [0.3, 0.5],
      [0.42, 0.5],
      [0.42, 0.2],
      [0.47, 0.2],
      [0.47, 0.14],
      [0.53, 0.14],
      [0.53, 0.2],
      [0.58, 0.2],
      [0.58, 0.5],
      [0.7, 0.5],
      [0.7, 0.4],
      [0.76, 0.4],
      [0.76, 0.32],
      [0.82, 0.32],
      [0.82, 0.4],
      [0.88, 0.4],
      [0.88, 0.86],
    ]),
    5,
  );
  const gate = openPolyline(
    fracPoints(size, [
      [0.44, 0.86],
      [0.44, 0.74],
      [0.5, 0.68],
      [0.56, 0.74],
      [0.56, 0.86],
    ]),
    6,
  );
  const window = (fx: number) =>
    polygonEdges(
      fracPoints(size, [
        [fx - 0.02, 0.48],
        [fx + 0.02, 0.48],
        [fx + 0.02, 0.56],
        [fx - 0.02, 0.56],
      ]),
      4,
    );
  const flagpole = openPolyline(
    fracPoints(size, [
      [0.5, 0.14],
      [0.5, 0.04],
    ]),
    4,
  );
  const pennant = polygonEdges(
    fracPoints(size, [
      [0.5, 0.04],
      [0.6, 0.07],
      [0.5, 0.1],
    ]),
    4,
  );
  return toPathFromParts([outline, gate, window(0.21), window(0.79), flagpole, pennant], size);
}

function phoenixShape(size: number): DrawingPath {
  // Rising phoenix: small body with a beak pointing up, two swept-up wings as
  // closed shapes, and three wavy flame streamers trailing down as the tail.
  const body = smoothClosedPath(
    fracPoints(size, [
      [0.5, 0.24],
      [0.56, 0.32],
      [0.55, 0.46],
      [0.5, 0.54],
      [0.45, 0.46],
      [0.44, 0.32],
    ]),
    8,
  );
  const beak = polygonEdges(
    fracPoints(size, [
      [0.47, 0.25],
      [0.5, 0.16],
      [0.53, 0.25],
    ]),
    4,
  );
  const wing = (mirror: number) =>
    smoothClosedPath(
      fracPoints(size, [
        [0.5 + mirror * 0.05, 0.34],
        [0.5 + mirror * 0.2, 0.2],
        [0.5 + mirror * 0.38, 0.16],
        [0.5 + mirror * 0.28, 0.3],
        [0.5 + mirror * 0.2, 0.36],
        [0.5 + mirror * 0.12, 0.42],
        [0.5 + mirror * 0.06, 0.44],
      ]),
      7,
    );
  const streamer = (pts: [number, number][]) => openPolyline(fracPoints(size, pts), 7);
  return toPathFromParts(
    [
      body,
      beak,
      wing(-1),
      wing(1),
      streamer([
        [0.5, 0.54],
        [0.52, 0.66],
        [0.48, 0.78],
        [0.52, 0.9],
      ]),
      streamer([
        [0.47, 0.52],
        [0.4, 0.64],
        [0.44, 0.76],
        [0.38, 0.88],
      ]),
      streamer([
        [0.53, 0.52],
        [0.6, 0.64],
        [0.56, 0.76],
        [0.62, 0.88],
      ]),
    ],
    size,
  );
}

function mermaidTailShape(size: number): DrawingPath {
  // Tapering tail curving down to a narrow ankle, spreading into a two-lobed
  // fluke with a center notch, plus scale arcs across the tail.
  const outline = smoothClosedPath(
    fracPoints(size, [
      [0.44, 0.1],
      [0.56, 0.1],
      [0.6, 0.26],
      [0.54, 0.42],
      [0.53, 0.56],
      [0.68, 0.62],
      [0.8, 0.86],
      [0.5, 0.76],
      [0.2, 0.86],
      [0.32, 0.62],
      [0.47, 0.56],
      [0.46, 0.42],
      [0.4, 0.26],
    ]),
    9,
  );
  const scaleArc = (x0: number, x1: number, fy: number) =>
    openPolyline(
      fracPoints(size, [
        [x0, fy],
        [(x0 + x1) / 2, fy + 0.035],
        [x1, fy],
      ]),
      5,
    );
  // Scale rows sit in the wide upper (thigh) zone and taper inward as the tail
  // narrows toward the ankle, so they stay safely inside the outline.
  return toPathFromParts(
    [outline, scaleArc(0.44, 0.56, 0.22), scaleArc(0.45, 0.55, 0.3), scaleArc(0.47, 0.53, 0.38)],
    size,
  );
}

function griffinWingShape(size: number): DrawingPath {
  // Feathered wing: a smooth concave leading edge sweeping from the shoulder up
  // to the tip, then a trailing edge built as evenly-layered feather scallops
  // (longest primaries near the tip), rounded by the closing spline. Two covert
  // rows inside mark the feather layers.
  const S = { x: 0.16 * size, y: 0.82 * size }; // shoulder
  const T = { x: 0.86 * size, y: 0.24 * size }; // wingtip
  const nx = 0.64; // outward normal along the trailing edge (down-right)
  const ny = 0.77;

  const leading: Vec2[] = [
    S,
    { x: 0.26 * size, y: 0.62 * size },
    { x: 0.4 * size, y: 0.44 * size },
    { x: 0.56 * size, y: 0.31 * size },
    { x: 0.72 * size, y: 0.24 * size },
    T,
  ];

  const feathers = 6;
  const trailing: Vec2[] = [];
  for (let i = 0; i < feathers; i++) {
    const uTip = (i + 0.5) / feathers;
    const uCusp = (i + 1) / feathers;
    const depth = (0.13 - 0.06 * uTip) * size; // primaries longest near the tip
    const tipB = { x: T.x + (S.x - T.x) * uTip, y: T.y + (S.y - T.y) * uTip };
    const cuspB = { x: T.x + (S.x - T.x) * uCusp, y: T.y + (S.y - T.y) * uCusp };
    trailing.push({ x: tipB.x + nx * depth, y: tipB.y + ny * depth });
    trailing.push(cuspB);
  }

  const outline = smoothClosedPath([...leading, ...trailing], 6);

  const covert = (row: [number, number][]): Vec2[] => openPolyline(fracPoints(size, row), 5);
  const coverts = [
    covert([[0.34, 0.5], [0.5, 0.4], [0.66, 0.33]]),
    covert([[0.3, 0.62], [0.46, 0.52], [0.62, 0.44]]),
  ];

  return toPathFromParts([outline, ...coverts], size);
}

const FANTASY_SHAPES: ShapeDefinition[] = [
  standalone("fant-gem", "Gem", "fantasy", gemShape),
  standalone("fant-crown", "Crown", "fantasy", crownShape),
  standalone("fant-sword", "Sword", "fantasy", swordShape),
  standalone("fant-shield", "Fantasy Shield", "fantasy", kiteShieldShape),
  standalone("fant-scroll", "Scroll", "fantasy", scrollShape),
  standalone("fant-potionbottle", "Potion Bottle", "fantasy", potionBottleShape),
  standalone("fant-skull", "Skull", "fantasy", skullShape),
  standalone("fant-ghost", "Ghost", "fantasy", ghostShape),
  standalone("fant-wizardhat", "Wizard Hat", "fantasy", wizardHatShape),
  standalone("fant-wand", "Magic Wand", "fantasy", wandShape),
  standalone("fant-fairywings", "Fairy Wings", "fantasy", fairyWingsShape),
  standalone("fant-griffinwing", "Griffin Wing", "fantasy", griffinWingShape),
  standalone("fant-witchsbroom", "Witch's Broom", "fantasy", witchsBroomShape),
  standalone("fant-cauldron", "Cauldron", "fantasy", cauldronShape),
  standalone("fant-treasurechest", "Treasure Chest", "fantasy", treasureChestShape),
  standalone("fant-castle", "Castle", "fantasy", castleShape),
  standalone("fant-unicorn", "Unicorn", "fantasy", unicornShape),
  standalone("fant-mermaidtail", "Mermaid Tail", "fantasy", mermaidTailShape),
  standalone("fant-dragon", "Dragon", "fantasy", dragonShape),
  standalone("fant-phoenix", "Phoenix", "fantasy", phoenixShape),
];

// ==================== UNIVERSAL SYMBOLS ====================

function noEntrySymbol(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const r = size * 0.32;
  const steps = 60;
  const ring: Vec2[] = [];
  for (let i = 0; i <= steps; i++) ring.push(polar(center, r, (i / steps) * 360 - 90));
  const bar = openPolyline(fracPoints(size, [[0.2, 0.5], [0.8, 0.5]]), 20);
  return toPathFromParts([ring, bar], size);
}

function powerButtonSymbol(size: number): DrawingPath {
  const center = { x: size * 0.5, y: size * 0.55 };
  const r = size * 0.28;
  const steps = 60;
  const ring: Vec2[] = [];
  for (let i = 0; i <= steps; i++) ring.push(polar(center, r, -55 + (i / steps) * 290));
  const line = openPolyline(
    [
      { x: center.x, y: center.y - r * 1.35 },
      { x: center.x, y: center.y - r * 0.1 },
    ],
    16,
  );
  return toPathFromParts([ring, line], size);
}

function warningTriangleSymbol(size: number): DrawingPath {
  const vertices = fracPoints(size, [
    [0.5, 0.15],
    [0.85, 0.8],
    [0.15, 0.8],
  ]);
  const triangle = polygonEdges(vertices, 16);
  const stem = openPolyline(fracPoints(size, [[0.5, 0.38], [0.5, 0.6]]), 12);
  const dotCenter = { x: size * 0.5, y: size * 0.68 };
  const dot: Vec2[] = [];
  for (let i = 0; i <= 12; i++) dot.push(polar(dotCenter, size * 0.02, (i / 12) * 360));
  return toPathFromParts([triangle, stem, dot], size);
}

function maleSymbol(size: number): DrawingPath {
  const center = { x: size * 0.42, y: size * 0.58 };
  const r = size * 0.2;
  const steps = 50;
  const ring: Vec2[] = [];
  for (let i = 0; i <= steps; i++) ring.push(polar(center, r, (i / steps) * 360));
  const arrowStart = polar(center, r, -45);
  const arrowEnd = { x: size * 0.82, y: size * 0.18 };
  const shaft = openPolyline([arrowStart, arrowEnd], 16);
  const dx = arrowEnd.x - arrowStart.x;
  const dy = arrowEnd.y - arrowStart.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const wing1 = { x: arrowEnd.x - ux * size * 0.1 + nx * size * 0.06, y: arrowEnd.y - uy * size * 0.1 + ny * size * 0.06 };
  const wing2 = { x: arrowEnd.x - ux * size * 0.1 - nx * size * 0.06, y: arrowEnd.y - uy * size * 0.1 - ny * size * 0.06 };
  const arrowhead = openPolyline([wing1, arrowEnd, wing2], 10);
  return toPathFromParts([ring, shaft, arrowhead], size);
}

function femaleSymbol(size: number): DrawingPath {
  const center = { x: size * 0.5, y: size * 0.32 };
  const r = size * 0.2;
  const steps = 50;
  const ring: Vec2[] = [];
  for (let i = 0; i <= steps; i++) ring.push(polar(center, r, (i / steps) * 360 - 90));
  const stem = openPolyline(fracPoints(size, [[0.5, 0.52], [0.5, 0.85]]), 16);
  const crossbar = openPolyline(fracPoints(size, [[0.38, 0.7], [0.62, 0.7]]), 12);
  return toPathFromParts([ring, stem, crossbar], size);
}

function wifiSymbol(size: number): DrawingPath {
  const center = { x: size * 0.5, y: size * 0.78 };
  const steps = 30;
  const arcs: Vec2[][] = [];
  for (const r of [size * 0.14, size * 0.24, size * 0.34]) {
    const arc: Vec2[] = [];
    for (let i = 0; i <= steps; i++) arc.push(polar(center, r, 200 + (i / steps) * 140));
    arcs.push(arc);
  }
  const dotCenter = { x: size * 0.5, y: size * 0.82 };
  const dot: Vec2[] = [];
  for (let i = 0; i <= 12; i++) dot.push(polar(dotCenter, size * 0.03, (i / 12) * 360));
  return toPathFromParts([...arcs, dot], size);
}

function compassStarSymbol(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const outer = size * 0.34;
  const inner = size * 0.14;
  const points = 8;
  const vertices: Vec2[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    vertices.push(polar(center, r, (i / (points * 2)) * 360 - 90));
  }
  return toPath(polygonEdges(vertices, 8), size);
}

function atSignSymbol(size: number): DrawingPath {
  const center = { x: size * 0.5, y: size * 0.5 };
  const outerR = size * 0.32;
  const innerR = size * 0.1;
  const steps = 120;
  const turns = 1.75;
  const points: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = -90 + t * 360 * turns;
    const r = outerR - (outerR - innerR) * t;
    points.push(polar(center, r, angle));
  }
  return toPath(points, size);
}

function yinYangSymbol(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const R = size * 0.32;
  const steps = 60;
  const outer: Vec2[] = [];
  for (let i = 0; i <= steps; i++) outer.push(polar(center, R, (i / steps) * 360 - 90));
  const topCenter = { x: center.x, y: center.y - R / 2 };
  const botCenter = { x: center.x, y: center.y + R / 2 };
  const sCurve: Vec2[] = [];
  for (let i = 0; i <= steps / 2; i++) sCurve.push(polar(topCenter, R / 2, -90 + (i / (steps / 2)) * 180));
  for (let i = 0; i <= steps / 2; i++) sCurve.push(polar(botCenter, R / 2, 90 + (i / (steps / 2)) * 180));
  const dot1: Vec2[] = [];
  for (let i = 0; i <= 16; i++) dot1.push(polar(topCenter, size * 0.04, (i / 16) * 360));
  const dot2: Vec2[] = [];
  for (let i = 0; i <= 16; i++) dot2.push(polar(botCenter, size * 0.04, (i / 16) * 360));
  return toPathFromParts([outer, sCurve, dot1, dot2], size);
}

function globeSymbol(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const r = size * 0.3;
  const steps = 50;
  const outline: Vec2[] = [];
  for (let i = 0; i <= steps; i++) outline.push(polar(center, r, (i / steps) * 360 - 90));
  const meridian: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 360 - 90;
    const rad = (t * Math.PI) / 180;
    meridian.push({ x: center.x + r * 0.42 * Math.cos(rad), y: center.y + r * Math.sin(rad) });
  }
  const lats = [-0.35, 0.35].map((f) => {
    const dy = r * f;
    const hw = Math.sqrt(Math.max(r * r - dy * dy, 0));
    return openPolyline(
      [
        { x: center.x - hw, y: center.y + dy },
        { x: center.x + hw, y: center.y + dy },
      ],
      16,
    );
  });
  return toPathFromParts([outline, meridian, ...lats], size);
}

function atomSymbol(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const rx = size * 0.32;
  const ry = size * 0.12;
  const steps = 50;
  const orbits: Vec2[][] = [];
  for (const rotDeg of [0, 60, 120]) {
    const rad = (rotDeg * Math.PI) / 180;
    const orbit: Vec2[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const x = rx * Math.cos(t);
      const y = ry * Math.sin(t);
      orbit.push({
        x: center.x + x * Math.cos(rad) - y * Math.sin(rad),
        y: center.y + x * Math.sin(rad) + y * Math.cos(rad),
      });
    }
    orbits.push(orbit);
  }
  const nucleus: Vec2[] = [];
  for (let i = 0; i <= 12; i++) nucleus.push(polar(center, size * 0.035, (i / 12) * 360));
  return toPathFromParts([...orbits, nucleus], size);
}

function bluetoothSymbol(size: number): DrawingPath {
  const T = { x: size * 0.5, y: size * 0.15 };
  const B = { x: size * 0.5, y: size * 0.85 };
  const C = { x: size * 0.5, y: size * 0.5 };
  const R1 = { x: size * 0.75, y: size * 0.32 };
  const R2 = { x: size * 0.75, y: size * 0.68 };
  return toPath(openPolyline([T, R1, C, R2, B, C, T], 16), size);
}

function radioactiveSymbol(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const innerR = size * 0.06;
  const outerR = size * 0.32;
  const steps = 20;
  const blades: Vec2[][] = [];
  for (const rot of [-90, 30, 150]) {
    const startA = rot - 30;
    const endA = rot + 30;
    const blade: Vec2[] = [polar(center, innerR, startA)];
    for (let i = 0; i <= steps; i++) blade.push(polar(center, outerR, startA + (i / steps) * 60));
    blade.push(polar(center, innerR, endA), center);
    blades.push(blade);
  }
  const coreRing: Vec2[] = [];
  for (let i = 0; i <= 24; i++) coreRing.push(polar(center, innerR, (i / 24) * 360));
  return toPathFromParts([...blades, coreRing], size);
}

function fingerprintSymbol(size: number): DrawingPath {
  const center = { x: size * 0.5, y: size * 0.55 };
  const radii = [0.08, 0.14, 0.2, 0.26, 0.32];
  const steps = 40;
  const loops: Vec2[][] = radii.map((rf) => {
    const rx = size * rf;
    const ry = size * rf * 1.25;
    const loop: Vec2[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = -160 + (i / steps) * 320;
      const rad = (a * Math.PI) / 180;
      loop.push({ x: center.x + rx * Math.cos(rad), y: center.y + ry * Math.sin(rad) });
    }
    return loop;
  });
  return toPathFromParts(loops, size);
}

function recycleSymbol(size: number): DrawingPath {
  const center = { x: size * 0.5, y: size * 0.52 };
  const r = size * 0.3;
  const verts = [-90, 30, 150].map((a) => polar(center, r, a));
  const parts: Vec2[][] = [];
  for (let i = 0; i < 3; i++) {
    const from = verts[i];
    const to = verts[(i + 1) % 3];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const bend = { x: from.x + dx * 0.5 + nx * size * 0.05, y: from.y + dy * 0.5 + ny * size * 0.05 };
    const tip = { x: from.x + dx * 0.82, y: from.y + dy * 0.82 };
    const wing1 = { x: tip.x - ux * size * 0.09 + nx * size * 0.07, y: tip.y - uy * size * 0.09 + ny * size * 0.07 };
    const wing2 = { x: tip.x - ux * size * 0.09 - nx * size * 0.07, y: tip.y - uy * size * 0.09 - ny * size * 0.07 };
    parts.push(openPolyline([from, bend, tip], 14), openPolyline([wing1, tip, wing2], 8));
  }
  return toPathFromParts(parts, size);
}

function dnaHelixSymbol(size: number): DrawingPath {
  const amplitude = size * 0.18;
  const centerX = size * 0.5;
  const top = size * 0.1;
  const bottom = size * 0.9;
  const steps = 80;
  const strand1: Vec2[] = [];
  const strand2: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = top + t * (bottom - top);
    const phase = t * Math.PI * 3;
    strand1.push({ x: centerX + amplitude * Math.sin(phase), y });
    strand2.push({ x: centerX - amplitude * Math.sin(phase), y });
  }
  const rungs: Vec2[][] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const y = top + t * (bottom - top);
    const phase = t * Math.PI * 3;
    const x1 = centerX + amplitude * Math.sin(phase);
    const x2 = centerX - amplitude * Math.sin(phase);
    rungs.push(openPolyline([{ x: x1, y }, { x: x2, y }], 8));
  }
  return toPathFromParts([strand1, strand2, ...rungs], size);
}

function biohazardSymbol(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const centerR = size * 0.07;
  const bladeR = size * 0.16;
  const dist = size * 0.24;
  const steps = 40;
  const blades: Vec2[][] = [];
  const necks: Vec2[][] = [];
  for (const rot of [-90, 30, 150]) {
    const bladeCenter = polar(center, dist, rot);
    const blade: Vec2[] = [];
    for (let i = 0; i <= steps; i++) blade.push(polar(bladeCenter, bladeR, (i / steps) * 360));
    blades.push(blade);
    necks.push(openPolyline([polar(center, centerR, rot), polar(bladeCenter, bladeR, rot + 180)], 8));
  }
  const core: Vec2[] = [];
  for (let i = 0; i <= 24; i++) core.push(polar(center, centerR, (i / 24) * 360));
  return toPathFromParts([core, ...necks, ...blades], size);
}

const UNIVERSAL_SHAPES: ShapeDefinition[] = [
  standalone("univ-heart", "Heart", "universal", heart),
  standalone("univ-cross", "Plus / Medical Cross", "universal", crossSymbol),
  standalone("univ-noentry", "No Entry Sign", "universal", noEntrySymbol),
  standalone("univ-power", "Power Button", "universal", powerButtonSymbol),
  standalone("univ-warning", "Warning Triangle", "universal", warningTriangleSymbol),
  standalone("univ-male", "Male Symbol", "universal", maleSymbol),
  standalone("univ-female", "Female Symbol", "universal", femaleSymbol),
  standalone("univ-peace", "Peace Sign", "universal", peaceSign),
  standalone("univ-wifi", "WiFi Symbol", "universal", wifiSymbol),
  standalone("univ-compass", "Compass Star", "universal", compassStarSymbol),
  standalone("univ-atsign", "At Sign", "universal", atSignSymbol),
  standalone("univ-yinyang", "Yin Yang", "universal", yinYangSymbol),
  standalone("univ-globe", "Globe", "universal", globeSymbol),
  standalone("univ-atom", "Atom Symbol", "universal", atomSymbol),
  standalone("univ-bluetooth", "Bluetooth Symbol", "universal", bluetoothSymbol),
  standalone("univ-radioactive", "Radioactive Symbol", "universal", radioactiveSymbol),
  standalone("univ-fingerprint", "Fingerprint", "universal", fingerprintSymbol),
  standalone("univ-recycle", "Recycling Symbol", "universal", recycleSymbol),
  standalone("univ-dna", "DNA Helix", "universal", dnaHelixSymbol),
  standalone("univ-biohazard", "Biohazard Symbol", "universal", biohazardSymbol),
];

/**
 * Full library across all categories. Within each category, shapes are
 * ordered from simplest to most intricate; categories unlock and progress
 * independently of one another.
 */
export const SHAPE_LIBRARY: ShapeDefinition[] = [
  ...GEOMETRIC_SHAPES,
  ...SYMBOL_SHAPES,
  ...ANIMAL_SHAPES,
  ...NATURE_SHAPES,
  ...FOOD_SHAPES,
  ...SPORTS_SHAPES,
  ...TRANSPORTATION_SHAPES,
  ...HOME_SHAPES,
  ...CALLIGRAPHY_SHAPES,
  ...FANTASY_SHAPES,
  ...UNIVERSAL_SHAPES,
];

export function shapesForCategory(category: CategoryId): ShapeDefinition[] {
  return SHAPE_LIBRARY.filter((s) => s.category === category);
}

export function getShapeById(id: string): ShapeDefinition | undefined {
  return SHAPE_LIBRARY.find((s) => s.id === id);
}
