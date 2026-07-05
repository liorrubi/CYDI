export type Vec2 = { x: number; y: number };

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pathLength(points: Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distance(points[i - 1], points[i]);
  }
  return total;
}

export function interpolatePoint(a: Vec2, b: Vec2, t: number): Vec2 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export type BoundingBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

export function boundingBox(points: Vec2[]): BoundingBox {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Translates points so the bounding-box midpoint sits at the origin. */
export function centerPoints<T extends Vec2>(points: T[]): T[] {
  const box = boundingBox(points);
  const cx = box.minX + box.width / 2;
  const cy = box.minY + box.height / 2;
  return points.map((p) => ({ ...p, x: p.x - cx, y: p.y - cy }));
}

/**
 * Scales points so the longer bounding-box dimension becomes 1, preserving
 * aspect ratio. Degenerate (zero-size) input is returned unchanged.
 */
export function scaleToUnit<T extends Vec2>(points: T[]): T[] {
  const box = boundingBox(points);
  const size = Math.max(box.width, box.height);
  if (size < 1e-9) return points;
  return points.map((p) => ({ ...p, x: p.x / size, y: p.y / size }));
}
