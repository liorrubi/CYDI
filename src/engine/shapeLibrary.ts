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
  | "fantasy";

export const CATEGORIES: { id: CategoryId; name: string; icon: string }[] = [
  { id: "geometric", name: "Geometric Shapes", icon: "🔷" },
  { id: "symbols", name: "Symbols", icon: "♾️" },
  { id: "animals", name: "Animals", icon: "🐾" },
  { id: "nature", name: "Nature", icon: "🌿" },
  { id: "food", name: "Food", icon: "🍎" },
  { id: "sports", name: "Sports", icon: "⚽" },
  { id: "transportation", name: "Transportation", icon: "🚗" },
  { id: "home", name: "Home & Objects", icon: "🏠" },
  { id: "calligraphy", name: "Calligraphy", icon: "✍️" },
  { id: "fantasy", name: "Fantasy", icon: "🐉" },
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

type EyeSpec = { keyIndex: number; center: Vec2; radius: number };

/** Smooth closed silhouette through key points, with small circular eye/detail loops floating (unconnected) next to specific key points. */
function organicBody(keyPoints: Vec2[], pointsPerSegment: number, eyes: EyeSpec[] = []): PathWithBreaks {
  const body = smoothClosedPath(keyPoints, pointsPerSegment);
  const sortedByIndexDesc = [...eyes].sort((a, b) => b.keyIndex - a.keyIndex);
  let points = body;
  let breaks: number[] = [];
  for (const eye of sortedByIndexDesc) {
    const anchorIndex = eye.keyIndex * pointsPerSegment;
    const beforeLength = points.length;
    const result = withDetourLoop(points, anchorIndex, eye.center, eye.radius);
    const insertedLength = result.points.length - beforeLength;
    breaks = breaks.map((b) => (b > anchorIndex ? b + insertedLength : b));
    breaks = [...breaks, ...result.breaks];
    points = result.points;
  }
  // Eyes are processed highest-keyIndex-first (so earlier insertions don't shift
  // later anchor positions), which appends each eye's break pair in that same
  // descending order - out of the ascending order every consumer (segment
  // slicing, rendering, scoring) assumes. Sort once at the end to fix that.
  breaks.sort((a, b) => a - b);
  return { points, breaks };
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

function crescentMoon(size: number): DrawingPath {
  const outerCenter = { x: size * 0.45, y: size / 2 };
  const outerRadius = size * 0.32;
  const innerCenter = { x: size * 0.58, y: size / 2 };
  const innerRadius = size * 0.28;
  const steps = 60;
  const points: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    points.push(polar(outerCenter, outerRadius, 200 - 220 * (i / steps)));
  }
  for (let i = 0; i <= steps; i++) {
    points.push(polar(innerCenter, innerRadius, -20 + 220 * (i / steps)));
  }
  return toPath(points, size);
}

const POLYGON_NAMES: Record<number, string> = {
  3: "Triangle",
  4: "Square",
  5: "Pentagon",
  6: "Hexagon",
  7: "Heptagon",
  8: "Octagon",
  9: "Nonagon",
  10: "Decagon",
  11: "Hendecagon",
  12: "Dodecagon",
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
      const isOdd = petalCount % 2 === 1;
      const k = isOdd ? petalCount : petalCount / 2;
      const thetaMax = isOdd ? Math.PI : Math.PI * 2;
      const center = { x: size / 2, y: size / 2 };
      const radius = size * 0.35;
      const steps = 200;
      const points: Vec2[] = [];
      for (let i = 0; i <= steps; i++) {
        const theta = (i / steps) * thetaMax;
        const r = radius * Math.cos(k * theta);
        points.push({ x: center.x + r * Math.cos(theta), y: center.y + r * Math.sin(theta) });
      }
      return toPath(points, size);
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
  ...[3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(regularPolygon),
  ...[4, 5, 6, 7, 8, 9, 10].map(starShape),
  standalone("crescent-moon", "Crescent Moon", "geometric", crescentMoon),
  ...[3, 4, 5, 6, 7, 8, 9, 10].map(roseShape),
  ...[3, 4, 5].map(zigzagShape),
  ...[1, 2, 3].map(waveShape),
  ...[1, 2, 3, 4, 5].map(spiralShape),
  ...[6, 8, 10, 12].map(gearShape),
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
  const vertices = fracPoints(size, [
    [0.5, 0.15],
    [0.75, 0.5],
    [0.5, 0.85],
    [0.25, 0.5],
  ]);
  const outline = polygonEdges(vertices, 16);
  // horizontal facet line across the middle, like a cut gem
  const facet = openPolyline(
    fracPoints(size, [
      [0.32, 0.4],
      [0.68, 0.4],
    ]),
    10,
  );
  return toPath([...outline, ...facet], size);
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
  const center = { x: size * 0.5, y: size * 0.32 };
  const radius = size * 0.18;
  const points: Vec2[] = [];
  for (let i = 0; i <= 50; i++) points.push(polar(center, radius, -90 + (i / 50) * 300));
  points.push({ x: size * 0.5, y: size * 0.55 }, { x: size * 0.5, y: size * 0.65 });
  const withDot = withDetourLoop(points, points.length - 1, { x: size * 0.5, y: size * 0.8 }, size * 0.025);
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
  const ringCenter = { x: size * 0.5, y: size * 0.22 };
  const points: Vec2[] = [];
  for (let i = 0; i <= 40; i++) points.push(polar(ringCenter, size * 0.08, (i / 40) * 360 - 90));
  points.push({ x: size * 0.5, y: size * 0.3 }, { x: size * 0.5, y: size * 0.75 });
  const pivot = { x: size * 0.5, y: size * 0.6 };
  points.push({ x: size * 0.3, y: size * 0.45 }, { x: size * 0.7, y: size * 0.45 }, pivot, { x: size * 0.5, y: size * 0.75 });
  for (let i = 0; i <= 20; i++) points.push(polar(pivot, size * 0.25, 90 + (i / 20) * 90));
  points.push({ x: size * 0.5, y: size * 0.75 });
  for (let i = 0; i <= 20; i++) points.push(polar(pivot, size * 0.25, 90 - (i / 20) * 90));
  return toPath(points, size);
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
  const pts = fracPoints(size, [
    [0.15, 0.5],
    [0.3, 0.32],
    [0.55, 0.28],
    [0.75, 0.35],
    [0.9, 0.5],
    [0.75, 0.5],
    [0.9, 0.65],
    [0.75, 0.65],
    [0.55, 0.72],
    [0.3, 0.68],
  ]);
  const eyes: EyeSpec[] = [{ keyIndex: 0, center: { x: size * 0.23, y: size * 0.47 }, radius: size * 0.025 }];
  const body = organicBody(pts, 10, eyes);
  return toPath(body.points, size, body.breaks);
}

function birdShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.45, 0.3],
    [0.6, 0.28],
    [0.78, 0.34],
    [0.6, 0.38],
    [0.68, 0.52],
    [0.55, 0.7],
    [0.3, 0.72],
    [0.15, 0.6],
    [0.28, 0.45],
  ]);
  const eyes: EyeSpec[] = [{ keyIndex: 1, center: { x: size * 0.52, y: size * 0.35 }, radius: size * 0.022 }];
  const body = organicBody(pts, 10, eyes);
  return toPath(body.points, size, body.breaks);
}

function snailShape(size: number): DrawingPath {
  const shellCenter = { x: size * 0.4, y: size * 0.42 };
  const points: Vec2[] = [];
  const turns = 1.6;
  const steps = 70;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push(polar(shellCenter, size * (0.03 + 0.2 * t), t * turns * 360 - 90));
  }
  const bodyPts = fracPoints(size, [
    [0.58, 0.62],
    [0.7, 0.7],
    [0.82, 0.65],
  ]);
  points.push(...openPolyline([points[points.length - 1], ...bodyPts], 10));
  const withEye = withDetourLoop(points, points.length - 1, { x: size * 0.86, y: size * 0.56 }, size * 0.02);
  return toPath(withEye.points, size, withEye.breaks);
}

function mouseShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.5, 0.35],
    [0.35, 0.2],
    [0.3, 0.35],
    [0.4, 0.45],
    [0.25, 0.55],
    [0.35, 0.7],
    [0.55, 0.72],
    [0.68, 0.6],
    [0.62, 0.45],
    [0.7, 0.35],
    [0.65, 0.2],
  ]);
  const eyes: EyeSpec[] = [{ keyIndex: 8, center: { x: size * 0.58, y: size * 0.48 }, radius: size * 0.02 }];
  const body = organicBody(pts, 10, eyes);
  const tail: Vec2[] = [];
  const steps = 20;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    tail.push({ x: size * (0.55 + 0.35 * t), y: size * (0.72 + 0.15 * Math.sin(t * Math.PI * 0.7)) });
  }
  return toPath([...body.points, ...tail], size, body.breaks);
}

function catShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.5, 0.15],
    [0.62, 0.18],
    [0.78, 0.1],
    [0.72, 0.3],
    [0.78, 0.45],
    [0.7, 0.65],
    [0.5, 0.72],
    [0.3, 0.65],
    [0.22, 0.45],
    [0.28, 0.3],
    [0.22, 0.1],
    [0.38, 0.18],
  ]);
  const eyes: EyeSpec[] = [
    { keyIndex: 3, center: { x: size * 0.62, y: size * 0.42 }, radius: size * 0.028 },
    { keyIndex: 9, center: { x: size * 0.38, y: size * 0.42 }, radius: size * 0.028 },
  ];
  const body = organicBody(pts, 10, eyes);
  return toPath(body.points, size, body.breaks);
}

function dogShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.5, 0.2],
    [0.68, 0.22],
    [0.8, 0.4],
    [0.72, 0.42],
    [0.74, 0.6],
    [0.6, 0.75],
    [0.5, 0.78],
    [0.4, 0.75],
    [0.26, 0.6],
    [0.28, 0.42],
    [0.2, 0.4],
    [0.32, 0.22],
  ]);
  const eyes: EyeSpec[] = [
    { keyIndex: 3, center: { x: size * 0.6, y: size * 0.45 }, radius: size * 0.026 },
    { keyIndex: 9, center: { x: size * 0.4, y: size * 0.45 }, radius: size * 0.026 },
  ];
  const body = organicBody(pts, 10, eyes);
  return toPath(body.points, size, body.breaks);
}

function rabbitShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.42, 0.1],
    [0.38, 0.35],
    [0.3, 0.45],
    [0.32, 0.6],
    [0.4, 0.75],
    [0.6, 0.78],
    [0.72, 0.6],
    [0.68, 0.35],
    [0.58, 0.1],
  ]);
  const eyes: EyeSpec[] = [{ keyIndex: 2, center: { x: size * 0.42, y: size * 0.5 }, radius: size * 0.025 }];
  const body = organicBody(pts, 10, eyes);
  return toPath(body.points, size, body.breaks);
}

function duckShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.35, 0.55],
    [0.45, 0.35],
    [0.55, 0.25],
    [0.68, 0.28],
    [0.8, 0.35],
    [0.85, 0.4],
    [0.78, 0.42],
    [0.6, 0.4],
    [0.65, 0.55],
    [0.6, 0.75],
    [0.35, 0.78],
    [0.22, 0.6],
  ]);
  const eyes: EyeSpec[] = [{ keyIndex: 3, center: { x: size * 0.63, y: size * 0.32 }, radius: size * 0.02 }];
  const body = organicBody(pts, 10, eyes);
  return toPath(body.points, size, body.breaks);
}

function frogShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.35, 0.3],
    [0.45, 0.35],
    [0.55, 0.35],
    [0.65, 0.3],
    [0.78, 0.45],
    [0.7, 0.65],
    [0.55, 0.8],
    [0.45, 0.8],
    [0.3, 0.65],
    [0.22, 0.45],
  ]);
  const eyes: EyeSpec[] = [
    { keyIndex: 0, center: { x: size * 0.35, y: size * 0.26 }, radius: size * 0.03 },
    { keyIndex: 3, center: { x: size * 0.65, y: size * 0.26 }, radius: size * 0.03 },
  ];
  const body = organicBody(pts, 10, eyes);
  return toPath(body.points, size, body.breaks);
}

function pigShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.5, 0.18],
    [0.68, 0.22],
    [0.8, 0.4],
    [0.75, 0.58],
    [0.6, 0.62],
    [0.5, 0.7],
    [0.4, 0.62],
    [0.25, 0.58],
    [0.2, 0.4],
    [0.32, 0.22],
  ]);
  const eyes: EyeSpec[] = [{ keyIndex: 2, center: { x: size * 0.68, y: size * 0.42 }, radius: size * 0.025 }];
  const body = organicBody(pts, 10, eyes);
  return toPath(body.points, size, body.breaks);
}

function turtleShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.5, 0.25],
    [0.7, 0.3],
    [0.82, 0.45],
    [0.78, 0.5],
    [0.85, 0.6],
    [0.7, 0.65],
    [0.65, 0.75],
    [0.5, 0.78],
    [0.35, 0.75],
    [0.3, 0.65],
    [0.15, 0.6],
    [0.22, 0.5],
    [0.18, 0.45],
    [0.3, 0.3],
  ]);
  const eyes: EyeSpec[] = [{ keyIndex: 0, center: { x: size * 0.5, y: size * 0.16 }, radius: size * 0.022 }];
  const body = organicBody(pts, 8, eyes);
  return toPath(body.points, size, body.breaks);
}

function sheepShape(size: number): DrawingPath {
  const center = { x: size * 0.48, y: size * 0.48 };
  const bumps = 8;
  const keyPts: Vec2[] = [];
  for (let i = 0; i < bumps; i++) {
    const r = i % 2 === 0 ? size * 0.3 : size * 0.24;
    keyPts.push(polar(center, r, (360 / bumps) * i - 90));
  }
  const eyes: EyeSpec[] = [{ keyIndex: 1, center: { x: size * 0.62, y: size * 0.4 }, radius: size * 0.02 }];
  const body = organicBody(keyPts, 10, eyes);
  return toPath(body.points, size, body.breaks);
}

function foxShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.38, 0.12],
    [0.42, 0.3],
    [0.3, 0.45],
    [0.35, 0.6],
    [0.5, 0.68],
    [0.65, 0.6],
    [0.7, 0.45],
    [0.58, 0.3],
    [0.62, 0.12],
  ]);
  const eyes: EyeSpec[] = [{ keyIndex: 2, center: { x: size * 0.42, y: size * 0.48 }, radius: size * 0.02 }];
  const body = organicBody(pts, 10, eyes);
  const tail: Vec2[] = [];
  const steps = 20;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    tail.push({ x: size * (0.68 + 0.24 * t), y: size * (0.5 + 0.28 * Math.sin(t * Math.PI * 0.6)) });
  }
  return toPath([...body.points, ...tail], size, body.breaks);
}

function bearShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.38, 0.18],
    [0.5, 0.14],
    [0.62, 0.18],
    [0.78, 0.35],
    [0.72, 0.55],
    [0.6, 0.7],
    [0.5, 0.75],
    [0.4, 0.7],
    [0.28, 0.55],
    [0.22, 0.35],
  ]);
  const eyes: EyeSpec[] = [{ keyIndex: 3, center: { x: size * 0.64, y: size * 0.4 }, radius: size * 0.026 }];
  const body = organicBody(pts, 10, eyes);
  return toPath(body.points, size, body.breaks);
}

function owlShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.4, 0.15],
    [0.5, 0.22],
    [0.6, 0.15],
    [0.75, 0.3],
    [0.78, 0.55],
    [0.65, 0.75],
    [0.5, 0.8],
    [0.35, 0.75],
    [0.22, 0.55],
    [0.25, 0.3],
  ]);
  const eyes: EyeSpec[] = [
    { keyIndex: 3, center: { x: size * 0.62, y: size * 0.42 }, radius: size * 0.035 },
    { keyIndex: 9, center: { x: size * 0.38, y: size * 0.42 }, radius: size * 0.035 },
  ];
  const body = organicBody(pts, 10, eyes);
  return toPath(body.points, size, body.breaks);
}

function butterflyShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.5, 0.3],
    [0.65, 0.15],
    [0.85, 0.2],
    [0.85, 0.4],
    [0.65, 0.45],
    [0.5, 0.5],
    [0.65, 0.55],
    [0.85, 0.6],
    [0.85, 0.8],
    [0.65, 0.85],
    [0.5, 0.7],
    [0.35, 0.85],
    [0.15, 0.8],
    [0.15, 0.6],
    [0.35, 0.55],
    [0.5, 0.5],
    [0.35, 0.45],
    [0.15, 0.4],
    [0.15, 0.2],
    [0.35, 0.15],
  ]);
  const eyes: EyeSpec[] = [{ keyIndex: 0, center: { x: size * 0.5, y: size * 0.21 }, radius: size * 0.018 }];
  const body = organicBody(pts, 8, eyes);
  return toPath(body.points, size, body.breaks);
}

function elephantShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.35, 0.2],
    [0.55, 0.18],
    [0.75, 0.28],
    [0.82, 0.45],
    [0.7, 0.5],
    [0.75, 0.6],
    [0.65, 0.62],
    [0.55, 0.75],
    [0.5, 0.85],
    [0.45, 0.75],
    [0.4, 0.6],
    [0.25, 0.55],
    [0.18, 0.4],
    [0.25, 0.3],
  ]);
  const eyes: EyeSpec[] = [{ keyIndex: 4, center: { x: size * 0.6, y: size * 0.38 }, radius: size * 0.028 }];
  const body = organicBody(pts, 8, eyes);
  return toPath(body.points, size, body.breaks);
}

function lionShape(size: number): DrawingPath {
  const center = { x: size * 0.5, y: size * 0.5 };
  const maneBumps = 10;
  const keyPts: Vec2[] = [];
  for (let i = 0; i < maneBumps; i++) {
    const r = i % 2 === 0 ? size * 0.36 : size * 0.26;
    keyPts.push(polar(center, r, (360 / maneBumps) * i - 90));
  }
  const eyes: EyeSpec[] = [{ keyIndex: 2, center: { x: size * 0.6, y: size * 0.44 }, radius: size * 0.025 }];
  const body = organicBody(keyPts, 8, eyes);
  return toPath(body.points, size, body.breaks);
}

function penguinShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.5, 0.2],
    [0.6, 0.25],
    [0.68, 0.3],
    [0.6, 0.35],
    [0.68, 0.5],
    [0.62, 0.7],
    [0.5, 0.85],
    [0.38, 0.7],
    [0.32, 0.5],
    [0.4, 0.35],
    [0.42, 0.25],
  ]);
  const eyes: EyeSpec[] = [{ keyIndex: 1, center: { x: size * 0.54, y: size * 0.28 }, radius: size * 0.02 }];
  const body = organicBody(pts, 10, eyes);
  return toPath(body.points, size, body.breaks);
}

function horseShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.55, 0.15],
    [0.5, 0.25],
    [0.6, 0.3],
    [0.72, 0.4],
    [0.8, 0.55],
    [0.7, 0.6],
    [0.6, 0.55],
    [0.55, 0.7],
    [0.35, 0.85],
    [0.25, 0.7],
    [0.35, 0.5],
    [0.3, 0.4],
    [0.4, 0.3],
  ]);
  const eyes: EyeSpec[] = [{ keyIndex: 3, center: { x: size * 0.62, y: size * 0.42 }, radius: size * 0.022 }];
  const body = organicBody(pts, 8, eyes);
  return toPath(body.points, size, body.breaks);
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
  const pts = fracPoints(size, [
    [0.5, 0.12],
    [0.7, 0.3],
    [0.62, 0.32],
    [0.78, 0.5],
    [0.68, 0.52],
    [0.6, 0.68],
    [0.56, 0.68],
    [0.58, 0.85],
    [0.42, 0.85],
    [0.44, 0.68],
    [0.4, 0.68],
    [0.32, 0.52],
    [0.22, 0.5],
    [0.38, 0.32],
    [0.3, 0.3],
  ]);
  return toPath(smoothClosedPath(pts, 8), size);
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
  const center = { x: size * 0.5, y: size * 0.78 };
  const radii = [size * 0.38, size * 0.3, size * 0.22];
  const points: Vec2[] = [];
  for (let b = 0; b < radii.length; b++) {
    const radius = radii[b];
    for (let i = 0; i <= 40; i++) {
      const angle = b % 2 === 0 ? 180 - (i / 40) * 180 : (i / 40) * 180;
      points.push(polar(center, radius, angle));
    }
  }
  return toPath(points, size);
}

function cactusShape(size: number): DrawingPath {
  const vertices = fracPoints(size, [
    [0.4, 0.85],
    [0.4, 0.4],
    [0.25, 0.4],
    [0.25, 0.25],
    [0.4, 0.25],
    [0.4, 0.15],
    [0.6, 0.15],
    [0.6, 0.3],
    [0.75, 0.3],
    [0.75, 0.45],
    [0.6, 0.45],
    [0.6, 0.85],
  ]);
  const body = polygonEdges(vertices, 8);
  // short spine ticks along the main trunk
  const spines = openPolyline(
    fracPoints(size, [
      [0.44, 0.5],
      [0.48, 0.5],
      [0.44, 0.6],
      [0.48, 0.6],
      [0.44, 0.7],
      [0.48, 0.7],
    ]),
    3,
  );
  return toPathFromParts([body, spines], size);
}

function mushroomShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.3, 0.45],
    [0.35, 0.25],
    [0.65, 0.25],
    [0.7, 0.45],
    [0.6, 0.48],
    [0.6, 0.8],
    [0.4, 0.8],
    [0.4, 0.48],
  ]);
  const mushroom = smoothClosedPath(pts, 10);
  // spots on the cap
  const spotL = withDetourLoop(mushroom, mushroom.length - 1, { x: size * 0.4, y: size * 0.33 }, size * 0.03);
  const spotR = withDetourLoop(spotL.points, spotL.points.length - 1, { x: size * 0.58, y: size * 0.35 }, size * 0.03);
  return toPath(spotR.points, size, [...spotL.breaks, ...spotR.breaks]);
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

function pineconeShape(size: number): DrawingPath {
  const center = { x: size * 0.5, y: size * 0.5 };
  const bumps = 7;
  const keyPts: Vec2[] = [];
  for (let i = 0; i < bumps; i++) {
    const angle = (360 / bumps) * i - 90;
    const radius = i % 2 === 0 ? size * 0.28 : size * 0.2;
    const p = polar(center, radius, angle);
    keyPts.push({ x: center.x + (p.x - center.x) * 0.55, y: p.y });
  }
  const body = smoothClosedPath(keyPts, 10);
  // diagonal scale lines crossing the body
  const scales = openPolyline(
    fracPoints(size, [
      [0.35, 0.32],
      [0.55, 0.4],
      [0.35, 0.5],
      [0.55, 0.58],
      [0.35, 0.68],
    ]),
    8,
  );
  return toPathFromParts([body, scales], size);
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
  const cupPts = fracPoints(size, [
    [0.5, 0.25],
    [0.62, 0.3],
    [0.6, 0.45],
    [0.5, 0.4],
    [0.4, 0.45],
    [0.38, 0.3],
  ]);
  const cup = smoothClosedPath(cupPts, 10);
  const stem = openPolyline(
    fracPoints(size, [
      [0.5, 0.45],
      [0.5, 0.85],
    ]),
    16,
  );
  return toPathFromParts([cup, stem], size);
}

function palmTreeShape(size: number): DrawingPath {
  const trunk: Vec2[] = [];
  const steps = 30;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    trunk.push({ x: size * (0.5 + 0.08 * Math.sin(t * Math.PI * 0.5)), y: size * (0.85 - 0.5 * t) });
  }
  const top = trunk[trunk.length - 1];
  const fronds: Vec2[] = [];
  for (const angle of [200, 240, 280, 320, 340]) {
    fronds.push(top, polar(top, size * 0.22, angle));
  }
  return toPath([...trunk, ...fronds], size);
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
  standalone("nat-pinecone", "Pinecone", "nature", pineconeShape),
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
  const pts = fracPoints(size, [
    [0.52, 0.18],
    [0.46, 0.1],
    [0.58, 0.12],
    [0.72, 0.28],
    [0.82, 0.5],
    [0.7, 0.75],
    [0.5, 0.85],
    [0.3, 0.75],
    [0.18, 0.5],
    [0.28, 0.28],
    [0.42, 0.16],
  ]);
  return toPath(smoothClosedPath(pts, 10), size);
}

function watermelonShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.2, 0.25],
    [0.5, 0.15],
    [0.8, 0.25],
    [0.5, 0.85],
  ]);
  const wedge = smoothClosedPath(pts, 14);
  // scattered seeds in the flesh
  const seedParts: Vec2[][] = [wedge];
  for (const [fx, fy] of [
    [0.42, 0.4],
    [0.58, 0.42],
    [0.46, 0.55],
    [0.54, 0.6],
    [0.5, 0.72],
  ] as [number, number][]) {
    const seed = { x: size * fx, y: size * fy };
    seedParts.push([seed, polar(seed, size * 0.015, 0), seed]);
  }
  return toPathFromParts(seedParts, size);
}

function pizzaShape(size: number): DrawingPath {
  const vertices = fracPoints(size, [
    [0.5, 0.85],
    [0.15, 0.25],
    [0.5, 0.15],
    [0.85, 0.25],
  ]);
  const slice = polygonEdges(vertices, 16);
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
  const pts = fracPoints(size, [
    [0.35, 0.35],
    [0.4, 0.2],
    [0.6, 0.2],
    [0.65, 0.35],
    [0.58, 0.45],
    [0.5, 0.85],
    [0.42, 0.45],
  ]);
  const cone = smoothClosedPath(pts, 10);
  // waffle-cone crosshatch on the lower triangle
  const waffle = openPolyline(
    fracPoints(size, [
      [0.44, 0.5],
      [0.56, 0.62],
      [0.44, 0.62],
      [0.55, 0.5],
      [0.46, 0.72],
      [0.52, 0.72],
    ]),
    6,
  );
  return toPathFromParts([cone, waffle], size);
}

function cupcakeShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.3, 0.55],
    [0.35, 0.35],
    [0.45, 0.42],
    [0.5, 0.25],
    [0.55, 0.42],
    [0.65, 0.35],
    [0.7, 0.55],
    [0.62, 0.85],
    [0.38, 0.85],
  ]);
  return toPath(smoothClosedPath(pts, 10), size);
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

function breadLoafShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.2, 0.7],
    [0.2, 0.5],
    [0.35, 0.28],
    [0.65, 0.28],
    [0.8, 0.5],
    [0.8, 0.7],
  ]);
  const loaf = smoothClosedPath(pts, 12);
  // diagonal score slashes across the crust
  const slashes = openPolyline(
    fracPoints(size, [
      [0.32, 0.55],
      [0.4, 0.35],
      [0.32, 0.62],
      [0.48, 0.35],
      [0.4, 0.65],
      [0.58, 0.35],
    ]),
    6,
  );
  return toPathFromParts([loaf, slashes], size);
}

function bananaShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.3, 0.8],
    [0.22, 0.6],
    [0.28, 0.35],
    [0.45, 0.18],
    [0.62, 0.15],
    [0.55, 0.22],
    [0.62, 0.3],
    [0.5, 0.45],
    [0.4, 0.65],
    [0.4, 0.78],
  ]);
  return toPath(smoothClosedPath(pts, 10), size);
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
  const pts = fracPoints(size, [
    [0.42, 0.2],
    [0.58, 0.2],
    [0.55, 0.85],
    [0.5, 0.92],
    [0.45, 0.85],
  ]);
  const body = smoothClosedPath(pts, 12);
  const leaves = openPolyline(
    fracPoints(size, [
      [0.5, 0.2],
      [0.4, 0.08],
      [0.48, 0.22],
      [0.5, 0.06],
      [0.55, 0.22],
      [0.62, 0.09],
      [0.5, 0.2],
    ]),
    10,
  );
  return toPath([...body, ...leaves], size);
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

function tacoShape(size: number): DrawingPath {
  const center = { x: size * 0.5, y: size * 0.85 };
  const r = size * 0.42;
  const points: Vec2[] = [];
  for (let i = 0; i <= 50; i++) points.push(polar(center, r, 200 - (i / 50) * 20));
  for (let i = 0; i <= 50; i++) points.push(polar(center, r, 180 + (i / 50) * 20));
  points.push(center);
  // filling line peeking out of the shell
  const filling = openPolyline(
    fracPoints(size, [
      [0.25, 0.55],
      [0.35, 0.48],
      [0.45, 0.53],
      [0.55, 0.47],
      [0.65, 0.53],
      [0.75, 0.47],
    ]),
    6,
  );
  return toPathFromParts([points, filling], size);
}

function hamburgerShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.2, 0.4],
    [0.25, 0.22],
    [0.75, 0.22],
    [0.8, 0.4],
  ]);
  const bunTop = smoothClosedPath(pts, 10);
  const layers = openPolyline(
    fracPoints(size, [
      [0.18, 0.5],
      [0.82, 0.5],
      [0.8, 0.58],
      [0.2, 0.58],
      [0.18, 0.5],
      [0.2, 0.68],
      [0.8, 0.68],
      [0.78, 0.82],
      [0.22, 0.82],
      [0.2, 0.68],
    ]),
    8,
  );
  return toPath([...bunTop, ...layers], size);
}

function hotDogShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.15, 0.62],
    [0.2, 0.4],
    [0.8, 0.4],
    [0.85, 0.62],
    [0.8, 0.78],
    [0.2, 0.78],
  ]);
  const bun = smoothClosedPath(pts, 10);
  const sausage = openPolyline(
    fracPoints(size, [
      [0.22, 0.58],
      [0.5, 0.5],
      [0.78, 0.58],
    ]),
    14,
  );
  return toPath([...bun, ...sausage], size);
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
  const pts = fracPoints(size, [
    [0.25, 0.35],
    [0.7, 0.35],
    [0.68, 0.8],
    [0.27, 0.8],
  ]);
  const cup = openPolyline(pts, 14);
  const handleCenter = { x: size * 0.78, y: size * 0.55 };
  const handle: Vec2[] = [];
  for (let i = 0; i <= 30; i++) handle.push(polar(handleCenter, size * 0.1, -100 + (i / 30) * 200));
  return toPathFromParts([cup, handle], size);
}

const FOOD_SHAPES: ShapeDefinition[] = [
  standalone("food-cherry", "Cherry", "food", cherryShape),
  standalone("food-donut", "Donut", "food", donutShape),
  standalone("food-egg", "Egg", "food", eggShape),
  standalone("food-cookie", "Cookie", "food", cookieShape),
  standalone("food-banana", "Banana", "food", bananaShape),
  standalone("food-carrot", "Carrot", "food", carrotShape),
  standalone("food-strawberry", "Strawberry", "food", strawberryShape),
  standalone("food-breadloaf", "Bread Loaf", "food", breadLoafShape),
  standalone("food-cheesewedge", "Cheese Wedge", "food", cheeseWedgeShape),
  standalone("food-apple", "Apple", "food", appleShape),
  standalone("food-watermelon", "Watermelon", "food", watermelonShape),
  standalone("food-pizza", "Pizza", "food", pizzaShape),
  standalone("food-icecream", "Ice Cream", "food", iceCreamShape),
  standalone("food-lollipop", "Lollipop", "food", lollipopShape),
  standalone("food-taco", "Taco", "food", tacoShape),
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
  const center = { x: size / 2, y: size / 2 };
  const r = size * 0.32;
  const pentR = r * 0.45;
  const angles = [0, 1, 2, 3, 4].map((i) => -90 + (360 / 5) * i);
  const pentagon = angles.map((a) => polar(center, pentR, a));
  const points: Vec2[] = [];
  for (let i = 0; i <= 70; i++) points.push(polar(center, r, (i / 70) * 360 - 90));
  // classic center pentagon panel with two seams radiating to the outer edge
  points.push(pentagon[0], pentagon[1], pentagon[2], pentagon[3], pentagon[4], pentagon[0]);
  points.push(polar(center, r, angles[0]));
  points.push(pentagon[0], pentagon[2]);
  points.push(polar(center, r, angles[2]));
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
  const points: Vec2[] = [
    { x: size * 0.35, y: size * 0.12 },
    { x: center.x, y: center.y - r },
    { x: size * 0.65, y: size * 0.12 },
    { x: center.x, y: center.y - r },
  ];
  for (let i = 0; i <= 60; i++) points.push(polar(center, r, (i / 60) * 360 - 90));
  // inner rim + embossed star on the medal face
  points.push(center, polar(center, r * 0.65, -90));
  for (let i = 0; i <= 40; i++) points.push(polar(center, r * 0.65, (i / 40) * 360 - 90));
  return toPath(points, size);
}

function racketShape(size: number): DrawingPath {
  const head = { x: size * 0.5, y: size * 0.35 };
  const rx = size * 0.22;
  const ry = size * 0.28;
  const points: Vec2[] = [];
  for (let i = 0; i <= 60; i++) {
    const t = (i / 60) * Math.PI * 2;
    points.push({ x: head.x + rx * Math.sin(t), y: head.y - ry * Math.cos(t) });
  }
  // a couple of strings crossing the head to suggest the stringbed
  points.push(
    { x: head.x, y: head.y - ry },
    { x: head.x, y: head.y + ry },
    { x: head.x, y: head.y - ry },
    { x: head.x - rx, y: head.y },
    { x: head.x + rx, y: head.y },
  );
  points.push({ x: size * 0.5, y: size * 0.6 }, { x: size * 0.5, y: size * 0.88 });
  return toPath(points, size);
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

function baseballShape(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const r = size * 0.3;
  const points: Vec2[] = [];
  for (let i = 0; i <= 70; i++) points.push(polar(center, r, (i / 70) * 360 - 90));
  const steps = 30;
  // two opposing wavy seams with short cross-stitches, like a real baseball
  for (const baseAngle of [-60, 120]) {
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = baseAngle + t * 120;
      const seamPoint = polar(center, r * (0.75 + 0.1 * Math.sin(t * Math.PI * 3)), angle);
      points.push(seamPoint);
      if (i % 6 === 3) {
        const stitchTip = polar(center, r * 0.68, angle);
        points.push(stitchTip, seamPoint);
      }
    }
  }
  return toPath(points, size);
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
  const center = { x: size * 0.35, y: size * 0.55 };
  const r = size * 0.2;
  const points: Vec2[] = [];
  for (let i = 0; i <= 50; i++) points.push(polar(center, r, 90 + (i / 50) * 360));
  points.push(
    { x: size * 0.55, y: size * 0.45 },
    { x: size * 0.78, y: size * 0.3 },
    { x: size * 0.85, y: size * 0.36 },
    { x: size * 0.62, y: size * 0.52 },
  );
  // small sound-hole cut into the barrel
  const withHole = withDetourLoop(points, points.length - 1, { x: size * 0.35, y: size * 0.55 }, size * 0.05);
  return toPath(withHole.points, size, withHole.breaks);
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

function baseballBatShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.42, 0.1],
    [0.5, 0.1],
    [0.56, 0.35],
    [0.6, 0.65],
    [0.56, 0.88],
    [0.44, 0.88],
    [0.42, 0.65],
    [0.4, 0.35],
  ]);
  const bat = smoothClosedPath(pts, 10);
  // grip-wrap rings near the handle end
  const grip = openPolyline(
    fracPoints(size, [
      [0.43, 0.78],
      [0.57, 0.78],
      [0.43, 0.78],
      [0.43, 0.7],
      [0.57, 0.7],
    ]),
    6,
  );
  return toPathFromParts([bat, grip], size);
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
  const pts = fracPoints(size, [
    [0.5, 0.12],
    [0.58, 0.22],
    [0.54, 0.3],
    [0.62, 0.45],
    [0.65, 0.68],
    [0.58, 0.88],
    [0.42, 0.88],
    [0.35, 0.68],
    [0.38, 0.45],
    [0.46, 0.3],
    [0.42, 0.22],
  ]);
  const pin = smoothClosedPath(pts, 10);
  // the pin's signature neck stripes
  const stripes = openPolyline(
    fracPoints(size, [
      [0.38, 0.38],
      [0.62, 0.38],
      [0.38, 0.44],
      [0.63, 0.44],
    ]),
    6,
  );
  return toPathFromParts([pin, stripes], size);
}

function boxingGloveShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.4, 0.2],
    [0.6, 0.2],
    [0.72, 0.35],
    [0.72, 0.55],
    [0.62, 0.6],
    [0.7, 0.7],
    [0.55, 0.85],
    [0.3, 0.85],
    [0.25, 0.65],
    [0.3, 0.5],
    [0.28, 0.35],
  ]);
  const glove = smoothClosedPath(pts, 10);
  // wrist cuff line and thumb seam
  const cuff = openPolyline(
    fracPoints(size, [
      [0.28, 0.35],
      [0.72, 0.35],
    ]),
    10,
  );
  const thumbSeam = openPolyline(
    fracPoints(size, [
      [0.3, 0.5],
      [0.42, 0.48],
    ]),
    8,
  );
  return toPathFromParts([glove, cuff, thumbSeam], size);
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

function runningShoeShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.15, 0.68],
    [0.2, 0.5],
    [0.35, 0.4],
    [0.45, 0.45],
    [0.55, 0.35],
    [0.75, 0.4],
    [0.85, 0.55],
    [0.85, 0.7],
    [0.75, 0.78],
    [0.2, 0.78],
  ]);
  const shoe = smoothClosedPath(pts, 10);
  // crossing laces over the tongue
  const laces = openPolyline(
    fracPoints(size, [
      [0.42, 0.46],
      [0.55, 0.5],
      [0.45, 0.53],
      [0.58, 0.57],
      [0.48, 0.6],
      [0.6, 0.64],
    ]),
    6,
  );
  return toPathFromParts([shoe, laces], size);
}

function americanFootballShape(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const points: Vec2[] = [];
  const steps = 80;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    points.push({ x: center.x + size * 0.36 * Math.cos(t), y: center.y + size * 0.2 * Math.sin(t) });
  }
  points.push(
    { x: center.x - size * 0.14, y: center.y },
    { x: center.x + size * 0.14, y: center.y },
    center,
    { x: center.x, y: center.y - size * 0.1 },
    center,
    { x: center.x, y: center.y + size * 0.1 },
  );
  return toPath(points, size);
}

const SPORTS_SHAPES: ShapeDefinition[] = [
  standalone("sport-soccer", "Soccer Ball", "sports", soccerBallShape),
  standalone("sport-tennisball", "Tennis Ball", "sports", tennisBallShape),
  standalone("sport-baseball", "Baseball", "sports", baseballShape),
  standalone("sport-basketball", "Basketball", "sports", basketballShape),
  standalone("sport-volleyball", "Volleyball", "sports", volleyballShape),
  standalone("sport-americanfootball", "American Football", "sports", americanFootballShape),
  standalone("sport-medal", "Medal", "sports", medalShape),
  standalone("sport-whistle", "Whistle", "sports", whistleShape),
  standalone("sport-stopwatch", "Stopwatch", "sports", stopwatchShape),
  standalone("sport-golfclub", "Golf Club", "sports", golfClubShape),
  standalone("sport-baseballbat", "Baseball Bat", "sports", baseballBatShape),
  standalone("sport-bowlingpin", "Bowling Pin", "sports", bowlingPinShape),
  standalone("sport-runningshoe", "Running Shoe", "sports", runningShoeShape),
  standalone("sport-racket", "Racket", "sports", racketShape),
  standalone("sport-hockeystick", "Hockey Stick", "sports", hockeyStickShape),
  standalone("sport-finishflag", "Finish Flag", "sports", finishFlagShape),
  standalone("sport-boxingglove", "Boxing Glove", "sports", boxingGloveShape),
  standalone("sport-skateboard", "Skateboard", "sports", skateboardShape),
  standalone("sport-dumbbell", "Dumbbell", "sports", dumbbellShape),
  standalone("sport-trophy", "Trophy", "sports", trophyShape),
];

// ==================== TRANSPORTATION ====================

function carShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.15, 0.62],
    [0.2, 0.45],
    [0.38, 0.33],
    [0.62, 0.33],
    [0.8, 0.45],
    [0.85, 0.62],
  ]);
  const body = smoothClosedPath(pts, 14);
  // window divider and two wheels
  const window = openPolyline(
    fracPoints(size, [
      [0.4, 0.45],
      [0.42, 0.36],
      [0.58, 0.36],
      [0.6, 0.45],
    ]),
    8,
  );
  const leftWheel = { x: size * 0.32, y: size * 0.68 };
  const rightWheel = { x: size * 0.68, y: size * 0.68 };
  const r = size * 0.07;
  const leftWheelLoop: Vec2[] = [];
  for (let i = 0; i <= 20; i++) leftWheelLoop.push(polar(leftWheel, r, (i / 20) * 360));
  const rightWheelLoop: Vec2[] = [];
  for (let i = 0; i <= 20; i++) rightWheelLoop.push(polar(rightWheel, r, (i / 20) * 360));
  return toPathFromParts([body, window, leftWheelLoop, rightWheelLoop], size);
}

function bicycleShape(size: number): DrawingPath {
  const leftCenter = { x: size * 0.3, y: size * 0.65 };
  const rightCenter = { x: size * 0.7, y: size * 0.65 };
  const r = size * 0.18;
  const points: Vec2[] = [];
  for (let i = 0; i <= 50; i++) points.push(polar(leftCenter, r, (i / 50) * 360 - 90));
  points.push({ x: size * 0.5, y: size * 0.35 });
  for (let i = 0; i <= 50; i++) points.push(polar(rightCenter, r, (i / 50) * 360 - 90));
  return toPath(points, size);
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
  const pts = fracPoints(size, [
    [0.2, 0.65],
    [0.3, 0.5],
    [0.45, 0.5],
    [0.45, 0.2],
    [0.62, 0.4],
    [0.45, 0.4],
    [0.55, 0.5],
    [0.8, 0.65],
    [0.7, 0.78],
    [0.3, 0.78],
  ]);
  const hull = smoothClosedPath(pts, 8);
  // a porthole window on the hull
  const porthole = withDetourLoop(hull, hull.length - 1, { x: size * 0.5, y: size * 0.65 }, size * 0.05);
  return toPath(porthole.points, size, porthole.breaks);
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
  const vertices = fracPoints(size, [
    [0.2, 0.75],
    [0.2, 0.4],
    [0.3, 0.3],
    [0.5, 0.3],
    [0.5, 0.2],
    [0.58, 0.2],
    [0.58, 0.3],
    [0.75, 0.4],
    [0.8, 0.75],
  ]);
  const body = polygonEdges(vertices, 10);
  // cab window and front wheel
  const window = openPolyline(
    fracPoints(size, [
      [0.34, 0.45],
      [0.46, 0.45],
      [0.46, 0.58],
      [0.34, 0.58],
      [0.34, 0.45],
    ]),
    8,
  );
  const wheel = { x: size * 0.65, y: size * 0.75 };
  const wheelLoop: Vec2[] = [];
  for (let i = 0; i <= 20; i++) wheelLoop.push(polar(wheel, size * 0.06, (i / 20) * 360));
  return toPathFromParts([body, window, wheelLoop], size);
}

function scooterShape(size: number): DrawingPath {
  const body = openPolyline(
    fracPoints(size, [
      [0.25, 0.7],
      [0.65, 0.7],
      [0.7, 0.4],
      [0.7, 0.25],
    ]),
    14,
  );
  const handle = openPolyline(
    fracPoints(size, [
      [0.7, 0.25],
      [0.82, 0.25],
    ]),
    8,
  );
  const frontWheel = { x: size * 0.68, y: size * 0.78 };
  const backWheel = { x: size * 0.25, y: size * 0.78 };
  const r = size * 0.07;
  const frontWheelLoop: Vec2[] = [];
  for (let i = 0; i <= 20; i++) frontWheelLoop.push(polar(frontWheel, r, (i / 20) * 360));
  const backWheelLoop: Vec2[] = [];
  for (let i = 0; i <= 20; i++) backWheelLoop.push(polar(backWheel, r, (i / 20) * 360));
  return toPathFromParts([body, handle, frontWheelLoop, backWheelLoop], size);
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
  const breaks = [...withA.breaks, ...withB.breaks, ...withC.breaks, withC.points.length];
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
  const vertices = fracPoints(size, [
    [0.18, 0.7],
    [0.18, 0.35],
    [0.28, 0.25],
    [0.72, 0.25],
    [0.82, 0.35],
    [0.82, 0.7],
  ]);
  const body = polygonEdges(vertices, 10);
  const leftWheel = { x: size * 0.32, y: size * 0.78 };
  const rightWheel = { x: size * 0.68, y: size * 0.78 };
  const r = size * 0.06;
  const leftWheelLoop: Vec2[] = [];
  for (let i = 0; i <= 20; i++) leftWheelLoop.push(polar(leftWheel, r, (i / 20) * 360));
  const rightWheelLoop: Vec2[] = [];
  for (let i = 0; i <= 20; i++) rightWheelLoop.push(polar(rightWheel, r, (i / 20) * 360));
  return toPathFromParts([body, leftWheelLoop, rightWheelLoop], size);
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
  const pts = fracPoints(size, [
    [0.1, 0.55],
    [0.35, 0.45],
    [0.65, 0.45],
    [0.9, 0.55],
    [0.65, 0.65],
    [0.35, 0.65],
  ]);
  const boat = smoothClosedPath(pts, 10);
  const paddle = openPolyline(
    fracPoints(size, [
      [0.3, 0.25],
      [0.7, 0.55],
    ]),
    14,
  );
  return toPathFromParts([boat, paddle], size);
}

function tractorShape(size: number): DrawingPath {
  const cabin = openPolyline(
    fracPoints(size, [
      [0.35, 0.7],
      [0.35, 0.35],
      [0.55, 0.35],
      [0.55, 0.55],
      [0.75, 0.55],
      [0.75, 0.7],
    ]),
    10,
  );
  const backWheel = { x: size * 0.32, y: size * 0.78 };
  const frontWheel = { x: size * 0.72, y: size * 0.82 };
  const backWheelLoop: Vec2[] = [];
  for (let i = 0; i <= 24; i++) backWheelLoop.push(polar(backWheel, size * 0.14, (i / 24) * 360));
  const frontWheelLoop: Vec2[] = [];
  for (let i = 0; i <= 24; i++) frontWheelLoop.push(polar(frontWheel, size * 0.08, (i / 24) * 360));
  return toPathFromParts([cabin, backWheelLoop, frontWheelLoop], size);
}

function motorcycleShape(size: number): DrawingPath {
  const body = openPolyline(
    fracPoints(size, [
      [0.3, 0.55],
      [0.45, 0.45],
      [0.6, 0.45],
      [0.68, 0.55],
      [0.5, 0.58],
      [0.35, 0.58],
    ]),
    10,
  );
  const seat = openPolyline(
    fracPoints(size, [
      [0.45, 0.45],
      [0.4, 0.35],
    ]),
    8,
  );
  const backWheel = { x: size * 0.28, y: size * 0.72 };
  const frontWheel = { x: size * 0.72, y: size * 0.72 };
  const r = size * 0.14;
  const backWheelLoop: Vec2[] = [];
  for (let i = 0; i <= 24; i++) backWheelLoop.push(polar(backWheel, r, (i / 24) * 360));
  const frontWheelLoop: Vec2[] = [];
  for (let i = 0; i <= 24; i++) frontWheelLoop.push(polar(frontWheel, r, (i / 24) * 360));
  return toPathFromParts([body, seat, backWheelLoop, frontWheelLoop], size);
}

function busShape(size: number): DrawingPath {
  const vertices = fracPoints(size, [
    [0.15, 0.72],
    [0.15, 0.3],
    [0.22, 0.22],
    [0.78, 0.22],
    [0.85, 0.3],
    [0.85, 0.72],
  ]);
  const body = polygonEdges(vertices, 10);
  const leftWheel = { x: size * 0.3, y: size * 0.8 };
  const rightWheel = { x: size * 0.7, y: size * 0.8 };
  const r = size * 0.07;
  const leftWheelLoop: Vec2[] = [];
  for (let i = 0; i <= 20; i++) leftWheelLoop.push(polar(leftWheel, r, (i / 20) * 360));
  const rightWheelLoop: Vec2[] = [];
  for (let i = 0; i <= 20; i++) rightWheelLoop.push(polar(rightWheel, r, (i / 20) * 360));
  return toPathFromParts([body, leftWheelLoop, rightWheelLoop], size);
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
  const vertices = fracPoints(size, [
    [0.12, 0.7],
    [0.12, 0.4],
    [0.45, 0.4],
    [0.45, 0.25],
    [0.55, 0.25],
    [0.55, 0.4],
    [0.85, 0.4],
    [0.85, 0.7],
  ]);
  const body = polygonEdges(vertices, 10);
  const ladder = openPolyline(
    fracPoints(size, [
      [0.2, 0.4],
      [0.75, 0.4],
    ]),
    8,
  );
  const leftWheel = { x: size * 0.28, y: size * 0.78 };
  const rightWheel = { x: size * 0.68, y: size * 0.78 };
  const r = size * 0.07;
  const leftWheelLoop: Vec2[] = [];
  for (let i = 0; i <= 20; i++) leftWheelLoop.push(polar(leftWheel, r, (i / 20) * 360));
  const rightWheelLoop: Vec2[] = [];
  for (let i = 0; i <= 20; i++) rightWheelLoop.push(polar(rightWheel, r, (i / 20) * 360));
  return toPathFromParts([body, ladder, leftWheelLoop, rightWheelLoop], size);
}

function submarineShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.15, 0.55],
    [0.25, 0.42],
    [0.7, 0.42],
    [0.85, 0.55],
    [0.7, 0.68],
    [0.25, 0.68],
  ]);
  const body = smoothClosedPath(pts, 10);
  const tower = openPolyline(
    fracPoints(size, [
      [0.5, 0.42],
      [0.5, 0.25],
      [0.6, 0.25],
      [0.6, 0.42],
    ]),
    10,
  );
  const periscope = openPolyline(
    fracPoints(size, [
      [0.55, 0.25],
      [0.55, 0.15],
      [0.62, 0.15],
    ]),
    8,
  );
  return toPathFromParts([body, [...tower, ...periscope]], size);
}

function hotAirBalloonShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.5, 0.12],
    [0.75, 0.3],
    [0.7, 0.55],
    [0.58, 0.65],
    [0.42, 0.65],
    [0.3, 0.55],
    [0.25, 0.3],
  ]);
  const balloon = smoothClosedPath(pts, 10);
  const basket = openPolyline(
    fracPoints(size, [
      [0.42, 0.65],
      [0.4, 0.82],
      [0.6, 0.82],
      [0.58, 0.65],
    ]),
    10,
  );
  return toPathFromParts([balloon, basket], size);
}

function helicopterShape(size: number): DrawingPath {
  const bodyPts = fracPoints(size, [
    [0.3, 0.55],
    [0.35, 0.42],
    [0.65, 0.42],
    [0.78, 0.5],
    [0.78, 0.6],
    [0.6, 0.68],
    [0.35, 0.65],
  ]);
  const body = smoothClosedPath(bodyPts, 10);
  const tailAndRotor = openPolyline(
    fracPoints(size, [
      [0.78, 0.53],
      [0.95, 0.48],
      [0.95, 0.38],
      [0.95, 0.58],
      [0.95, 0.48],
      [0.78, 0.53],
    ]),
    8,
  );
  const mastAndRotor = openPolyline(
    fracPoints(size, [
      [0.5, 0.42],
      [0.5, 0.32],
      [0.15, 0.32],
      [0.85, 0.32],
      [0.5, 0.32],
      [0.5, 0.42],
    ]),
    8,
  );
  const skid = openPolyline(
    fracPoints(size, [
      [0.45, 0.65],
      [0.32, 0.78],
      [0.62, 0.78],
    ]),
    10,
  );
  return toPathFromParts([body, tailAndRotor, mastAndRotor, skid], size);
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
  const center = { x: size * 0.32, y: size * 0.35 };
  const r = size * 0.16;
  const points: Vec2[] = [];
  for (let i = 0; i <= 50; i++) points.push(polar(center, r, (i / 50) * 360 - 90));
  points.push(
    { x: center.x + r, y: center.y },
    { x: size * 0.8, y: size * 0.75 },
    { x: size * 0.72, y: size * 0.83 },
    { x: size * 0.65, y: size * 0.76 },
    { x: size * 0.6, y: size * 0.85 },
    { x: size * 0.52, y: size * 0.77 },
    { x: center.x + r, y: center.y },
  );
  return toPath(points, size);
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
  const center = { x: size / 2, y: size * 0.45 };
  const r = size * 0.35;
  const points: Vec2[] = [];
  const scallops = 6;
  for (let i = 0; i <= scallops; i++) {
    const angle = 180 - (i / scallops) * 180;
    const rad = (angle * Math.PI) / 180;
    const bump = i % 2 === 0 ? 1 : 0.85;
    points.push({ x: center.x + r * bump * Math.cos(rad), y: center.y - r * bump * Math.sin(rad) });
  }
  points.push(
    center,
    { x: center.x, y: size * 0.85 },
    { x: center.x + size * 0.08, y: size * 0.85 },
    { x: center.x + size * 0.08, y: size * 0.78 },
  );
  return toPath(points, size);
}

function chairShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.3, 0.2],
    [0.32, 0.5],
    [0.7, 0.5],
    [0.7, 0.9],
    [0.62, 0.9],
    [0.62, 0.58],
    [0.38, 0.58],
    [0.38, 0.9],
    [0.3, 0.9],
  ]);
  return toPath(openPolyline(pts, 12), size);
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
  const body = openPolyline(pts, 14);
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
  const body = openPolyline(pts, 14);
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
  const leftLoop = { x: size * 0.32, y: size * 0.75 };
  const rightLoop = { x: size * 0.62, y: size * 0.75 };
  const pivot = { x: size * 0.48, y: size * 0.5 };
  const points: Vec2[] = [];
  for (let i = 0; i <= 24; i++) points.push(polar(leftLoop, size * 0.1, (i / 24) * 360));
  points.push(leftLoop, pivot, { x: size * 0.75, y: size * 0.2 }, pivot, rightLoop);
  for (let i = 0; i <= 24; i++) points.push(polar(rightLoop, size * 0.1, (i / 24) * 360));
  points.push(rightLoop, pivot, { x: size * 0.22, y: size * 0.2 });
  return toPath(points, size);
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
  const pts = fracPoints(size, [
    [0.15, 0.35],
    [0.85, 0.35],
    [0.85, 0.45],
    [0.15, 0.45],
  ]);
  const top = openPolyline(pts, 12);
  const legFL = openPolyline(
    fracPoints(size, [
      [0.2, 0.45],
      [0.22, 0.85],
    ]),
    10,
  );
  const legFR = openPolyline(
    fracPoints(size, [
      [0.78, 0.45],
      [0.8, 0.85],
    ]),
    10,
  );
  return toPathFromParts([top, legFL, legFR], size);
}

function hammerShape(size: number): DrawingPath {
  const handle = openPolyline(
    fracPoints(size, [
      [0.42, 0.88],
      [0.58, 0.4],
    ]),
    16,
  );
  const head = openPolyline(
    fracPoints(size, [
      [0.35, 0.4],
      [0.75, 0.28],
      [0.8, 0.42],
      [0.62, 0.5],
      [0.55, 0.44],
      [0.35, 0.4],
    ]),
    10,
  );
  return toPathFromParts([handle, head], size);
}

function broomShape(size: number): DrawingPath {
  const handle = openPolyline(
    fracPoints(size, [
      [0.65, 0.12],
      [0.42, 0.65],
    ]),
    16,
  );
  const bristles = openPolyline(
    fracPoints(size, [
      [0.42, 0.65],
      [0.2, 0.9],
      [0.32, 0.68],
      [0.28, 0.92],
      [0.42, 0.7],
      [0.4, 0.92],
      [0.52, 0.7],
      [0.5, 0.9],
      [0.42, 0.65],
    ]),
    8,
  );
  return toPath([...handle, ...bristles], size);
}

function bedShape(size: number): DrawingPath {
  const frame = openPolyline(
    fracPoints(size, [
      [0.15, 0.85],
      [0.15, 0.45],
      [0.85, 0.45],
      [0.85, 0.85],
    ]),
    14,
  );
  const headboard = openPolyline(
    fracPoints(size, [
      [0.15, 0.45],
      [0.15, 0.25],
      [0.3, 0.25],
      [0.3, 0.45],
    ]),
    10,
  );
  const pillow = openPolyline(
    fracPoints(size, [
      [0.32, 0.45],
      [0.32, 0.35],
      [0.55, 0.35],
      [0.55, 0.45],
    ]),
    10,
  );
  return toPathFromParts([frame, headboard, pillow], size);
}

function sofaShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.15, 0.75],
    [0.15, 0.45],
    [0.25, 0.35],
    [0.75, 0.35],
    [0.85, 0.45],
    [0.85, 0.75],
    [0.72, 0.75],
    [0.72, 0.6],
    [0.28, 0.6],
    [0.28, 0.75],
  ]);
  return toPath(openPolyline(pts, 10), size);
}

function mirrorShape(size: number): DrawingPath {
  const center = { x: size / 2, y: size * 0.42 };
  const rx = size * 0.28;
  const ry = size * 0.32;
  const points: Vec2[] = [];
  for (let i = 0; i <= 60; i++) {
    const t = (i / 60) * Math.PI * 2 - Math.PI / 2;
    points.push({ x: center.x + rx * Math.sin(t), y: center.y - ry * Math.cos(t) });
  }
  points.push({ x: size * 0.5, y: size * 0.74 }, { x: size * 0.5, y: size * 0.9 });
  return toPath(points, size);
}

function bathtubShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.15, 0.7],
    [0.15, 0.45],
    [0.25, 0.4],
    [0.75, 0.4],
    [0.85, 0.45],
    [0.85, 0.7],
  ]);
  const body = smoothClosedPath(pts, 10);
  const footLeft = openPolyline(
    fracPoints(size, [
      [0.2, 0.7],
      [0.18, 0.8],
      [0.24, 0.8],
      [0.22, 0.7],
    ]),
    6,
  );
  const footRight = openPolyline(
    fracPoints(size, [
      [0.78, 0.7],
      [0.76, 0.8],
      [0.82, 0.8],
      [0.8, 0.7],
    ]),
    6,
  );
  return toPathFromParts([body, footLeft, footRight], size);
}

function teapotShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.3, 0.6],
    [0.28, 0.42],
    [0.4, 0.32],
    [0.6, 0.32],
    [0.7, 0.45],
    [0.68, 0.62],
    [0.5, 0.68],
  ]);
  const body = smoothClosedPath(pts, 10);
  const spout = openPolyline(
    fracPoints(size, [
      [0.7, 0.48],
      [0.85, 0.4],
    ]),
    10,
  );
  const handleCenter = { x: size * 0.24, y: size * 0.5 };
  const handle: Vec2[] = [];
  for (let i = 0; i <= 24; i++) handle.push(polar(handleCenter, size * 0.09, 100 + (i / 24) * 200));
  const lid = openPolyline(
    fracPoints(size, [
      [0.45, 0.32],
      [0.48, 0.24],
      [0.55, 0.24],
      [0.55, 0.32],
    ]),
    8,
  );
  return toPathFromParts([body, spout, handle, lid], size);
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
  const vertices = fracPoints(size, [
    [0.2, 0.7],
    [0.2, 0.4],
    [0.32, 0.5],
    [0.4, 0.3],
    [0.5, 0.45],
    [0.6, 0.3],
    [0.68, 0.5],
    [0.8, 0.4],
    [0.8, 0.7],
  ]);
  return toPath(polygonEdges(vertices, 10), size);
}

function dragonShape(size: number): DrawingPath {
  const points: Vec2[] = [];
  const steps = 100;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: size * 0.2 + t * size * 0.55,
      y: size * 0.5 + size * 0.2 * Math.sin(t * Math.PI * 2.2),
    });
  }
  points.push({ x: size * 0.78, y: size * 0.35 }, { x: size * 0.85, y: size * 0.4 });
  return toPath(points, size);
}

function swordShape(size: number): DrawingPath {
  const vertices = fracPoints(size, [
    [0.5, 0.1],
    [0.56, 0.55],
    [0.7, 0.6],
    [0.7, 0.65],
    [0.56, 0.62],
    [0.56, 0.75],
    [0.62, 0.85],
    [0.38, 0.85],
    [0.44, 0.75],
    [0.44, 0.62],
    [0.3, 0.65],
    [0.3, 0.6],
    [0.44, 0.55],
  ]);
  return toPath(polygonEdges(vertices, 8), size);
}

function kiteShieldShape(size: number): DrawingPath {
  const vertices = fracPoints(size, [
    [0.5, 0.15],
    [0.75, 0.28],
    [0.7, 0.6],
    [0.5, 0.88],
    [0.3, 0.6],
    [0.25, 0.28],
  ]);
  return toPath(polygonEdges(vertices, 14), size);
}

function unicornShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.6, 0.15],
    [0.52, 0.28],
    [0.62, 0.3],
    [0.68, 0.4],
    [0.6, 0.55],
    [0.68, 0.7],
    [0.55, 0.72],
    [0.4, 0.65],
    [0.3, 0.5],
    [0.35, 0.35],
    [0.48, 0.28],
  ]);
  return toPath(smoothClosedPath(pts, 8), size);
}

function wandShape(size: number): DrawingPath {
  const center = { x: size * 0.75, y: size * 0.25 };
  const r = size * 0.12;
  const points: Vec2[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.4;
    points.push(polar(center, rad, (360 / 10) * i - 90));
  }
  points.push(polar(center, r, -90), { x: size * 0.3, y: size * 0.8 });
  return toPath(points, size);
}

function gemShape(size: number): DrawingPath {
  const vertices = fracPoints(size, [
    [0.5, 0.15],
    [0.72, 0.35],
    [0.62, 0.85],
    [0.38, 0.85],
    [0.28, 0.35],
  ]);
  const outline = polygonEdges(vertices, 10);
  const facets = openPolyline(
    fracPoints(size, [
      [0.28, 0.35],
      [0.72, 0.35],
      [0.5, 0.15],
      [0.5, 0.85],
    ]),
    10,
  );
  return toPath([...outline, ...facets], size);
}

function scrollShape(size: number): DrawingPath {
  const topCenter = { x: size * 0.28, y: size * 0.22 };
  const bottomCenter = { x: size * 0.72, y: size * 0.78 };
  const points: Vec2[] = [];
  for (let i = 0; i <= 30; i++) points.push(polar(topCenter, size * 0.08, (i / 30) * 360));
  points.push(
    { x: size * 0.28, y: size * 0.3 },
    { x: size * 0.72, y: size * 0.3 },
    { x: size * 0.72, y: size * 0.7 },
    { x: size * 0.28, y: size * 0.7 },
    { x: size * 0.28, y: size * 0.3 },
    { x: size * 0.72, y: size * 0.7 },
  );
  for (let i = 0; i <= 30; i++) points.push(polar(bottomCenter, size * 0.08, 180 + (i / 30) * 360));
  return toPath(points, size);
}

function skullShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.5, 0.16],
    [0.72, 0.28],
    [0.78, 0.48],
    [0.65, 0.6],
    [0.65, 0.72],
    [0.35, 0.72],
    [0.35, 0.6],
    [0.22, 0.48],
    [0.28, 0.28],
  ]);
  const skull = smoothClosedPath(pts, 10);
  const eyeL = { x: size * 0.4, y: size * 0.48 };
  const eyeR = { x: size * 0.6, y: size * 0.48 };
  const withEyeL = withDetourLoop(skull, skull.length - 1, eyeL, size * 0.06);
  const withBothEyes = withDetourLoop(withEyeL.points, withEyeL.points.length - 1, eyeR, size * 0.06);
  return toPath(withBothEyes.points, size, [...withEyeL.breaks, ...withBothEyes.breaks]);
}

function ghostShape(size: number): DrawingPath {
  const pts: Vec2[] = [];
  const arcSteps = 40;
  const topCenter = { x: size * 0.5, y: size * 0.45 };
  for (let i = 0; i <= arcSteps; i++) pts.push(polar(topCenter, size * 0.3, 180 - (i / arcSteps) * 180));
  const waveSteps = 30;
  for (let i = 0; i <= waveSteps; i++) {
    const t = i / waveSteps;
    pts.push({
      x: size * 0.8 - t * size * 0.6,
      y: size * 0.75 + size * 0.08 * Math.sin(t * Math.PI * 3),
    });
  }
  return toPath(pts, size);
}

function wizardHatShape(size: number): DrawingPath {
  const vertices = fracPoints(size, [
    [0.5, 0.1],
    [0.58, 0.5],
    [0.85, 0.75],
    [0.15, 0.75],
    [0.42, 0.5],
  ]);
  const cone = polygonEdges(vertices, 12);
  const brim = openPolyline(
    fracPoints(size, [
      [0.85, 0.75],
      [0.9, 0.82],
      [0.1, 0.82],
      [0.15, 0.75],
    ]),
    10,
  );
  return toPathFromParts([cone, brim], size);
}

function fairyWingsShape(size: number): DrawingPath {
  const center = { x: size * 0.5, y: size * 0.5 };
  const leftPts = fracPoints(size, [
    [0.5, 0.4],
    [0.3, 0.2],
    [0.12, 0.3],
    [0.2, 0.5],
    [0.12, 0.65],
    [0.3, 0.75],
    [0.5, 0.6],
  ]);
  const leftWing = smoothClosedPath(leftPts, 10);
  const rightPts = fracPoints(size, [
    [0.5, 0.4],
    [0.7, 0.2],
    [0.88, 0.3],
    [0.8, 0.5],
    [0.88, 0.65],
    [0.7, 0.75],
    [0.5, 0.6],
  ]);
  const rightWing = smoothClosedPath(rightPts, 10);
  return toPath([...leftWing, center, ...rightWing], size);
}

function potionBottleShape(size: number): DrawingPath {
  const neck = openPolyline(
    fracPoints(size, [
      [0.44, 0.15],
      [0.44, 0.3],
    ]),
    10,
  );
  const bodyPts = fracPoints(size, [
    [0.44, 0.3],
    [0.56, 0.3],
    [0.7, 0.45],
    [0.72, 0.68],
    [0.6, 0.85],
    [0.4, 0.85],
    [0.28, 0.68],
    [0.3, 0.45],
  ]);
  const body = smoothClosedPath(bodyPts, 10);
  const cap = openPolyline(
    fracPoints(size, [
      [0.44, 0.15],
      [0.56, 0.15],
      [0.56, 0.3],
    ]),
    8,
  );
  return toPath([...neck, ...cap, ...body], size);
}

function cauldronShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.2, 0.45],
    [0.15, 0.65],
    [0.3, 0.82],
    [0.7, 0.82],
    [0.85, 0.65],
    [0.8, 0.45],
  ]);
  const body = smoothClosedPath(pts, 10);
  const handleL = openPolyline(
    fracPoints(size, [
      [0.2, 0.45],
      [0.1, 0.4],
    ]),
    8,
  );
  const handleR = openPolyline(
    fracPoints(size, [
      [0.8, 0.45],
      [0.9, 0.4],
    ]),
    8,
  );
  const legs = openPolyline(
    fracPoints(size, [
      [0.3, 0.82],
      [0.25, 0.9],
      [0.35, 0.82],
      [0.5, 0.82],
      [0.45, 0.9],
      [0.55, 0.82],
      [0.7, 0.82],
      [0.65, 0.9],
      [0.75, 0.82],
    ]),
    6,
  );
  const acrossTop = openPolyline(
    [
      { x: size * 0.1, y: size * 0.4 },
      { x: size * 0.2, y: size * 0.45 },
      { x: size * 0.8, y: size * 0.45 },
    ],
    8,
  );
  return toPathFromParts([[...body, ...handleL, ...acrossTop, ...handleR], legs], size);
}

function treasureChestShape(size: number): DrawingPath {
  const base = openPolyline(
    fracPoints(size, [
      [0.2, 0.85],
      [0.2, 0.55],
      [0.8, 0.55],
      [0.8, 0.85],
      [0.2, 0.85],
    ]),
    10,
  );
  const lidPts = fracPoints(size, [
    [0.2, 0.55],
    [0.25, 0.35],
    [0.75, 0.35],
    [0.8, 0.55],
  ]);
  const lid = openPolyline(lidPts, 10);
  const lock = openPolyline(
    fracPoints(size, [
      [0.45, 0.55],
      [0.45, 0.45],
      [0.55, 0.45],
      [0.55, 0.55],
    ]),
    8,
  );
  return toPath([...base, ...lid, ...lock], size);
}

function witchsBroomShape(size: number): DrawingPath {
  const handle = openPolyline(
    fracPoints(size, [
      [0.68, 0.1],
      [0.4, 0.68],
    ]),
    18,
  );
  const bristles = openPolyline(
    fracPoints(size, [
      [0.4, 0.68],
      [0.15, 0.9],
      [0.3, 0.7],
      [0.22, 0.92],
      [0.4, 0.72],
      [0.38, 0.92],
      [0.5, 0.72],
      [0.48, 0.9],
      [0.4, 0.68],
    ]),
    8,
  );
  const tie = openPolyline(
    fracPoints(size, [
      [0.34, 0.62],
      [0.46, 0.66],
    ]),
    6,
  );
  return toPath([...handle, ...tie, ...bristles], size);
}

function castleShape(size: number): DrawingPath {
  const vertices = fracPoints(size, [
    [0.15, 0.85],
    [0.15, 0.55],
    [0.22, 0.55],
    [0.22, 0.4],
    [0.3, 0.4],
    [0.3, 0.55],
    [0.4, 0.55],
    [0.4, 0.3],
    [0.35, 0.3],
    [0.35, 0.22],
    [0.45, 0.22],
    [0.45, 0.3],
    [0.5, 0.3],
    [0.5, 0.22],
    [0.6, 0.22],
    [0.6, 0.3],
    [0.55, 0.3],
    [0.55, 0.55],
    [0.6, 0.55],
    [0.6, 0.4],
    [0.7, 0.4],
    [0.7, 0.55],
    [0.78, 0.55],
    [0.78, 0.85],
  ]);
  return toPath(polygonEdges(vertices, 6), size);
}

function phoenixShape(size: number): DrawingPath {
  const bodyPts = fracPoints(size, [
    [0.5, 0.3],
    [0.56, 0.42],
    [0.52, 0.6],
    [0.5, 0.75],
    [0.48, 0.6],
    [0.44, 0.42],
  ]);
  const body = smoothClosedPath(bodyPts, 8);
  const leftWing = openPolyline(
    fracPoints(size, [
      [0.5, 0.4],
      [0.25, 0.25],
      [0.1, 0.35],
      [0.28, 0.4],
      [0.12, 0.5],
      [0.32, 0.5],
      [0.5, 0.5],
    ]),
    8,
  );
  const rightWing = openPolyline(
    fracPoints(size, [
      [0.5, 0.5],
      [0.68, 0.5],
      [0.88, 0.5],
      [0.72, 0.4],
      [0.9, 0.35],
      [0.75, 0.25],
      [0.5, 0.4],
    ]),
    8,
  );
  const tail = openPolyline(
    fracPoints(size, [
      [0.5, 0.72],
      [0.42, 0.88],
      [0.5, 0.8],
      [0.58, 0.88],
    ]),
    8,
  );
  return toPathFromParts([[...body, ...leftWing, ...rightWing], tail], size);
}

function mermaidTailShape(size: number): DrawingPath {
  const pts = fracPoints(size, [
    [0.45, 0.15],
    [0.55, 0.2],
    [0.5, 0.45],
    [0.6, 0.55],
    [0.85, 0.5],
    [0.9, 0.62],
    [0.6, 0.65],
    [0.68, 0.78],
    [0.5, 0.68],
    [0.32, 0.78],
    [0.4, 0.65],
    [0.1, 0.62],
    [0.15, 0.5],
    [0.4, 0.55],
    [0.5, 0.45],
  ]);
  return toPath(smoothClosedPath(pts, 8), size);
}

function griffinWingShape(size: number): DrawingPath {
  const base = { x: size * 0.2, y: size * 0.8 };
  const points: Vec2[] = [base];
  const featherTips = [
    [0.35, 0.2],
    [0.5, 0.15],
    [0.65, 0.15],
    [0.78, 0.2],
    [0.85, 0.3],
  ];
  let prev = base;
  for (const [fx, fy] of featherTips) {
    const tip = { x: size * fx, y: size * fy };
    points.push(tip);
    const notch = { x: (prev.x + tip.x) / 2 + size * 0.03, y: Math.max(prev.y, tip.y) + size * 0.08 };
    points.push(notch);
    prev = tip;
  }
  points.push({ x: size * 0.3, y: size * 0.7 }, base);
  return toPath(points, size);
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
];

export function shapesForCategory(category: CategoryId): ShapeDefinition[] {
  return SHAPE_LIBRARY.filter((s) => s.category === category);
}
