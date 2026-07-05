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

function toPath(points: Vec2[], size: number): DrawingPath {
  return {
    points: points.map((p, i) => ({ x: p.x, y: p.y, t: i })),
    canvasWidth: size,
    canvasHeight: size,
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
  return toPath(polygonEdges(vertices, 16), size);
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
  return toPath(smoothClosedPath(pts, 12), size);
}

const SYMBOL_SHAPES: ShapeDefinition[] = [
  standalone("sym-heart", "Heart", "symbols", heart),
  standalone("sym-arrow", "Arrow", "symbols", arrow),
  standalone("sym-infinity", "Infinity", "symbols", infinitySymbol),
  standalone("sym-peace", "Peace Sign", "symbols", peaceSign),
  standalone("sym-diamond", "Diamond", "symbols", diamondSymbol),
  standalone("sym-shield", "Shield", "symbols", shieldSymbol),
];

// ==================== ANIMALS ====================

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
  return toPath(smoothClosedPath(pts, 10), size);
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
  return toPath(smoothClosedPath(pts, 10), size);
}

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
  return toPath(smoothClosedPath(pts, 10), size);
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
  return toPath(smoothClosedPath(pts, 8), size);
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
  return toPath(smoothClosedPath(pts, 8), size);
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
  return toPath(smoothClosedPath(pts, 10), size);
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
  return toPath(smoothClosedPath(pts, 8), size);
}

const ANIMAL_SHAPES: ShapeDefinition[] = [
  standalone("ani-cat", "Cat", "animals", catShape),
  standalone("ani-dog", "Dog", "animals", dogShape),
  standalone("ani-fish", "Fish", "animals", fishShape),
  standalone("ani-butterfly", "Butterfly", "animals", butterflyShape),
  standalone("ani-turtle", "Turtle", "animals", turtleShape),
  standalone("ani-owl", "Owl", "animals", owlShape),
  standalone("ani-elephant", "Elephant", "animals", elephantShape),
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
  return toPath(smoothClosedPath(pts, 12), size);
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
  return toPath(points, size);
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
  return toPath(polygonEdges(vertices, 14), size);
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

const NATURE_SHAPES: ShapeDefinition[] = [
  standalone("nat-leaf", "Leaf", "nature", leafShape),
  standalone("nat-flower", "Flower", "nature", simpleFlowerShape),
  standalone("nat-tree", "Tree", "nature", treeShape),
  standalone("nat-cloud", "Cloud", "nature", cloudShape),
  standalone("nat-mountain", "Mountain", "nature", mountainShape),
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
  return toPath(smoothClosedPath(pts, 14), size);
}

function pizzaShape(size: number): DrawingPath {
  const vertices = fracPoints(size, [
    [0.5, 0.85],
    [0.15, 0.25],
    [0.5, 0.15],
    [0.85, 0.25],
  ]);
  return toPath(polygonEdges(vertices, 16), size);
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
  return toPath(smoothClosedPath(pts, 10), size);
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

const FOOD_SHAPES: ShapeDefinition[] = [
  standalone("food-apple", "Apple", "food", appleShape),
  standalone("food-watermelon", "Watermelon", "food", watermelonShape),
  standalone("food-pizza", "Pizza", "food", pizzaShape),
  standalone("food-icecream", "Ice Cream", "food", iceCreamShape),
  standalone("food-cupcake", "Cupcake", "food", cupcakeShape),
  standalone("food-cherry", "Cherry", "food", cherryShape),
];

// ==================== SPORTS ====================

function basketballShape(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const r = size * 0.32;
  const points: Vec2[] = [];
  for (let i = 0; i <= 70; i++) points.push(polar(center, r, (i / 70) * 360 - 90));
  points.push(polar(center, r, 90), polar(center, r, -90));
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
  return toPath(smoothClosedPath(pts, 6), size);
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
  points.push({ x: size * 0.5, y: size * 0.6 }, { x: size * 0.5, y: size * 0.88 });
  return toPath(points, size);
}

const SPORTS_SHAPES: ShapeDefinition[] = [
  standalone("sport-soccer", "Soccer Ball", "sports", circle),
  standalone("sport-basketball", "Basketball", "sports", basketballShape),
  standalone("sport-trophy", "Trophy", "sports", trophyShape),
  standalone("sport-medal", "Medal", "sports", medalShape),
  standalone("sport-racket", "Racket", "sports", racketShape),
  standalone("sport-tennisball", "Tennis Ball", "sports", circle),
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
  return toPath(smoothClosedPath(pts, 14), size);
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
  return toPath(smoothClosedPath(pts, 8), size);
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
  return toPath(smoothClosedPath(pts, 8), size);
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
  return toPath(polygonEdges(vertices, 10), size);
}

const TRANSPORTATION_SHAPES: ShapeDefinition[] = [
  standalone("trans-car", "Car", "transportation", carShape),
  standalone("trans-bicycle", "Bicycle", "transportation", bicycleShape),
  standalone("trans-airplane", "Airplane", "transportation", airplaneShape),
  standalone("trans-ship", "Ship", "transportation", shipShape),
  standalone("trans-rocket", "Rocket", "transportation", rocketShape),
  standalone("trans-train", "Train", "transportation", trainShape),
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
  return toPath(polygonEdges(vertices, 14), size);
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
  return toPath([...shade, ...stand], size);
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

const HOME_SHAPES: ShapeDefinition[] = [
  standalone("home-house", "House", "home", houseShape),
  standalone("home-key", "Key", "home", keyShape),
  standalone("home-lamp", "Lamp", "home", lampShape),
  standalone("home-clock", "Clock", "home", clockShape),
  standalone("home-umbrella", "Umbrella", "home", umbrellaShape),
  standalone("home-chair", "Chair", "home", chairShape),
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

const CALLIGRAPHY_SHAPES: ShapeDefinition[] = [
  standalone("calli-s-curve", "S-Curve", "calligraphy", sCurveShape),
  standalone("calli-swirl", "Swirl Flourish", "calligraphy", swirlFlourishShape),
  standalone("calli-ribbon", "Wave Ribbon", "calligraphy", waveRibbonShape),
  standalone("calli-loop", "Loop Flourish", "calligraphy", loopFlourishShape),
  standalone("calli-swoosh", "Swoosh Underline", "calligraphy", swooshShape),
  standalone("calli-figure8", "Figure-8 Flourish", "calligraphy", figure8FlourishShape),
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

const FANTASY_SHAPES: ShapeDefinition[] = [
  standalone("fant-crown", "Crown", "fantasy", crownShape),
  standalone("fant-dragon", "Dragon", "fantasy", dragonShape),
  standalone("fant-sword", "Sword", "fantasy", swordShape),
  standalone("fant-shield", "Fantasy Shield", "fantasy", kiteShieldShape),
  standalone("fant-unicorn", "Unicorn", "fantasy", unicornShape),
  standalone("fant-wand", "Magic Wand", "fantasy", wandShape),
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
