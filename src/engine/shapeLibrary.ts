import type { Point } from "../types/Point";
import type { DrawingPath } from "../types/Challenge";

export type ShapeDefinition = {
  id: string;
  name: string;
  generate: (size: number) => DrawingPath;
};

function toPath(points: { x: number; y: number }[], size: number): DrawingPath {
  return {
    points: points.map((p, i) => ({ x: p.x, y: p.y, t: i })),
    canvasWidth: size,
    canvasHeight: size,
  };
}

function polygon(vertices: { x: number; y: number }[], pointsPerEdge: number): { x: number; y: number }[] {
  const result: { x: number; y: number }[] = [];
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

function circle(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const radius = size * 0.32;
  const points: Point[] = [];
  const steps = 80;
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    points.push({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle), t: i });
  }
  return { points, canvasWidth: size, canvasHeight: size };
}

function square(size: number): DrawingPath {
  const half = size * 0.28;
  const center = { x: size / 2, y: size / 2 };
  const vertices = [
    { x: center.x - half, y: center.y - half },
    { x: center.x + half, y: center.y - half },
    { x: center.x + half, y: center.y + half },
    { x: center.x - half, y: center.y + half },
  ];
  return toPath(polygon(vertices, 16), size);
}

function triangle(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const radius = size * 0.34;
  const vertices = [-90, 150, 30].map((deg) => {
    const angle = (deg * Math.PI) / 180;
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
  });
  return toPath(polygon(vertices, 20), size);
}

function star(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const outerRadius = size * 0.35;
  const innerRadius = size * 0.15;
  const vertices: { x: number; y: number }[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = (-90 + i * 36) * (Math.PI / 180);
    vertices.push({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
  }
  return toPath(polygon(vertices, 8), size);
}

function heart(size: number): DrawingPath {
  const raw: { x: number; y: number }[] = [];
  const steps = 100;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    raw.push({ x, y });
  }
  const scale = (size * 0.65) / 34;
  const center = { x: size / 2, y: size / 2 + size * 0.05 };
  const points = raw.map((p) => ({ x: center.x + p.x * scale, y: center.y + p.y * scale }));
  return toPath(points, size);
}

function spiral(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const maxRadius = size * 0.38;
  const turns = 2.5;
  const steps = 140;
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = t * turns * Math.PI * 2;
    const radius = maxRadius * t;
    points.push({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle), t: i });
  }
  return { points, canvasWidth: size, canvasHeight: size };
}

function infinity(size: number): DrawingPath {
  const center = { x: size / 2, y: size / 2 };
  const width = size * 0.36;
  const height = size * 0.2;
  const steps = 100;
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    points.push({
      x: center.x + width * Math.sin(2 * t),
      y: center.y + height * Math.sin(t),
      t: i,
    });
  }
  return { points, canvasWidth: size, canvasHeight: size };
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
  return toPath(polygon(vertices, 12), size);
}

export const SHAPE_LIBRARY: ShapeDefinition[] = [
  { id: "circle", name: "Circle", generate: circle },
  { id: "square", name: "Square", generate: square },
  { id: "triangle", name: "Triangle", generate: triangle },
  { id: "star", name: "Star", generate: star },
  { id: "heart", name: "Heart", generate: heart },
  { id: "spiral", name: "Spiral", generate: spiral },
  { id: "infinity", name: "Infinity", generate: infinity },
  { id: "arrow", name: "Arrow", generate: arrow },
];

export function shapeAtLevel(levelIndex: number): ShapeDefinition {
  const i = ((levelIndex % SHAPE_LIBRARY.length) + SHAPE_LIBRARY.length) % SHAPE_LIBRARY.length;
  return SHAPE_LIBRARY[i];
}
