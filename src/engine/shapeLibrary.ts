import type { DrawingPath } from "../types/Challenge";

export type ShapeDefinition = {
  id: string;
  name: string;
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

function standalone(id: string, name: string, generate: (size: number) => DrawingPath): ShapeDefinition {
  return { id, name, generate };
}

// ---- Standalone shapes ----

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
  const fractions: [number, number][] = [
    [0.1, 0.4],
    [0.55, 0.4],
    [0.55, 0.25],
    [0.9, 0.5],
    [0.55, 0.75],
    [0.55, 0.6],
    [0.1, 0.6],
  ];
  const vertices = fractions.map(([fx, fy]) => ({ x: fx * size, y: fy * size }));
  return toPath(polygonEdges(vertices, 12), size);
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

// ---- Regular polygon family (increasing side count) ----

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

// ---- Star family (increasing point count) ----

function starShape(points: number): ShapeDefinition {
  return {
    id: `star-${points}`,
    name: `${points}-Point Star`,
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

// ---- Rose / flower family (increasing petal count) ----

function roseShape(petalCount: number): ShapeDefinition {
  return {
    id: `flower-${petalCount}`,
    name: `${petalCount}-Petal Flower`,
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

// ---- Zigzag family (increasing segment count, open path) ----

function zigzagShape(segments: number): ShapeDefinition {
  return {
    id: `zigzag-${segments}`,
    name: `Zigzag (${segments} Segments)`,
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

// ---- Wave family (increasing cycle count, open path) ----

function waveShape(cycles: number): ShapeDefinition {
  return {
    id: `wave-${cycles}`,
    name: `Wave (${cycles} Cycle${cycles > 1 ? "s" : ""})`,
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

// ---- Spiral family (increasing turn count, open path) ----

function spiralShape(turns: number): ShapeDefinition {
  return {
    id: `spiral-${turns}`,
    name: `Spiral (${turns} Turn${turns > 1 ? "s" : ""})`,
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

// ---- Gear family (increasing tooth count) ----

function gearShape(teeth: number): ShapeDefinition {
  return {
    id: `gear-${teeth}`,
    name: `Gear (${teeth} Teeth)`,
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

// ---- Lissajous family (increasing frequency product = most intricate/self-crossing) ----

function lissajousShape(a: number, b: number): ShapeDefinition {
  return {
    id: `lissajous-${a}-${b}`,
    name: `Lissajous ${a}:${b}`,
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

/**
 * Ordered from simplest to most intricate: a smooth loop, then straight-edged
 * polygons with rising side count, then concave stars, then a few
 * recognizable curved symbols, then multi-lobed flowers, open zigzags and
 * waves, growing spirals, many-toothed gears, and finally self-intersecting
 * Lissajous curves.
 */
export const SHAPE_LIBRARY: ShapeDefinition[] = [
  standalone("circle", "Circle", circle),
  ...[3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(regularPolygon),
  ...[4, 5, 6, 7, 8, 9, 10].map(starShape),
  standalone("heart", "Heart", heart),
  standalone("arrow", "Arrow", arrow),
  standalone("crescent-moon", "Crescent Moon", crescentMoon),
  ...[3, 4, 5, 6, 7, 8, 9, 10].map(roseShape),
  ...[3, 4, 5].map(zigzagShape),
  ...[1, 2, 3].map(waveShape),
  ...[1, 2, 3, 4, 5].map(spiralShape),
  ...[6, 8, 10, 12].map(gearShape),
  ...LISSAJOUS_PAIRS.map(([a, b]) => lissajousShape(a, b)),
];
