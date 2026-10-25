/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Scored examples for the deepened challenge pages: what the scorer actually
// weighs on one specific shape, and what its signature mistake costs.
//
// BUILD-TIME ONLY. This module runs the real shape generators and the real
// scoreAttempt(), so it is imported by scripts/generateScoredExamples.ts and by
// its test - never by a page. What pages read is the generated, committed
// scoredExamplesData.ts: plain numbers, no scorer, nothing computed or fetched
// while a page loads. The test re-runs everything here and fails if the
// committed numbers or images no longer match, so the published figures cannot
// drift from the scorer that produces them.
//
// Nothing is invented. Each attempt is the real target, redrawn with one fixed,
// deterministic "hand" - a slow drift of about one percent of the drawing's size
// plus a fine tremor, the same for every shape - and then with that shape's
// signature mistake applied on top. The difference between the two rows is what
// the mistake alone costs.
import { getShapeById, polygonEdges, smoothClosedPath } from "../engine/shapeLibrary";
import { scoreAttempt } from "../engine/scoring";
import { splitIntoSegments } from "../engine/normalizePath";
import { pathLength } from "../engine/geometry";
import { RESAMPLE_POINT_COUNT } from "../engine/scoringConstants";
import type { DrawingPath } from "../types/Challenge";
import type { Point } from "../types/Point";

/** The coordinate space the examples are built in; scoring normalizes it away. */
export const EXAMPLE_CANVAS = 400;

type Part = Point[];

export type ExampleVariant = {
  /** Row label on the page, in plain words. */
  label: string;
  /** Builds the attempt's parts from the target's parts (already redrawn by the hand). */
  apply?: (parts: Part[]) => Part[];
  /**
   * For a mistake that changes the corners of a polygon rather than moving finished
   * parts: builds the mistaken shape from the target's own parts, and the hand then
   * redraws it - so the mistake is drawn with exactly the same hand as everything else.
   */
  build?: (targetParts: Part[]) => Part[];
};

export type ScoredExampleDefinition = {
  path: string;
  shapeId: string;
  /** Named groups of the target's parts, in drawing order - e.g. both eyes as one line of the table. */
  partGroups?: { name: string; parts: number[] }[];
  /**
   * For a shape drawn as ONE line (a triangle, a gear, a heart), where "parts" are
   * stretches of that line instead: each group's length of line, measured from the
   * target's own points. Its share of the total is its share of the comparison points.
   */
  shareGroups?: (parts: Part[]) => { name: string; length: number }[];
  /** The mistake shown in the overlay image, then any further ones for the table. */
  mistakes: ExampleVariant[];
  /** Slug for the generated overlay: /images/seo/<imageSlug>-scored-example.svg */
  imageSlug: string;
};

// ------------------------------------------------------------------ helpers ---

function centroid(part: Part): { x: number; y: number } {
  const n = part.length || 1;
  return { x: part.reduce((s, p) => s + p.x, 0) / n, y: part.reduce((s, p) => s + p.y, 0) / n };
}

/** Scales a part about its own centre - "drawn smaller" without moving it. */
function scalePart(part: Part, k: number, kx = k): Part {
  const c = centroid(part);
  return part.map((p) => ({ ...p, x: c.x + (p.x - c.x) * kx, y: c.y + (p.y - c.y) * k }));
}

function movePart(part: Part, dx: number, dy: number): Part {
  return part.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
}

const S = EXAMPLE_CANVAS;

/**
 * The one hand every example is drawn with: a slow positional drift of about 1.25%
 * of the canvas and a fine tremor along the line. Deterministic, so the page, the
 * image and the test all see exactly the same attempt.
 */
export function hand(part: Part): Part {
  return part.map((p, i) => ({
    ...p,
    x: p.x + 5 * Math.sin((p.y / S) * 7.1 + 0.4) + 1.2 * Math.sin(i * 1.7),
    y: p.y + 5 * Math.sin((p.x / S) * 6.3 + 1.2) + 1.2 * Math.cos(i * 1.3),
  }));
}

/** The snail's inner spiral with a chosen number of turns - same centre, radius and start as the generator's. */
function snailSpiral(turns: number): Part {
  const center = { x: S * 0.42, y: S * 0.44 };
  const radius = S * 0.2;
  const steps = 80;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const angle = ((-90 + t * turns * 360) * Math.PI) / 180;
    const r = radius * (1 - 0.92 * t);
    return { x: center.x + r * Math.cos(angle), y: center.y + r * Math.sin(angle), t: 0 };
  });
}

// ------------------------------------------------- polygon and one-line helpers ---

const asPart = (points: { x: number; y: number }[]): Part => points.map((p, i) => ({ x: p.x, y: p.y, t: i }));

/** The corners of a polygon the library drew with `perEdge` points per edge (the closing duplicate is not a corner). */
function cornersOf(part: Part, perEdge: number): Point[] {
  const corners: Point[] = [];
  for (let i = 0; i + 1 < part.length; i += perEdge) corners.push(part[i]);
  return corners;
}

function polygonFrom(corners: { x: number; y: number }[], perEdge: number): Part {
  return asPart(polygonEdges(corners, perEdge));
}

/** Length of edge `k` of a polygon drawn with `perEdge` points per edge. */
function edgeLength(part: Part, perEdge: number, k: number): number {
  return pathLength(part.slice(k * perEdge, (k + 1) * perEdge + 1));
}

function sumEdges(part: Part, perEdge: number, edges: number[]): number {
  return edges.reduce((sum, k) => sum + edgeLength(part, perEdge, k), 0);
}

function extent(points: { x: number; y: number }[]): { minX: number; maxX: number; minY: number; maxY: number } {
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

function rotateAbout(p: Point, centre: { x: number; y: number }, degrees: number): Point {
  const a = (degrees * Math.PI) / 180;
  const dx = p.x - centre.x;
  const dy = p.y - centre.y;
  return { ...p, x: centre.x + dx * Math.cos(a) - dy * Math.sin(a), y: centre.y + dx * Math.sin(a) + dy * Math.cos(a) };
}

/** The real parts of another catalog shape - e.g. the six-tooth gear drawn instead of the eight-tooth one. */
function partsOfShape(shapeId: string): Part[] {
  const shape = getShapeById(shapeId);
  if (!shape) throw new Error(`scored example needs shape "${shapeId}"`);
  const path = shape.generate(S);
  return splitIntoSegments(path.points, path.breaks);
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// -------------------------------------------------------------- definitions ---

export const SCORED_EXAMPLE_DEFINITIONS: ScoredExampleDefinition[] = [
  {
    path: "/draw-a-perfect-circle",
    shapeId: "circle",
    partGroups: [{ name: "The one closed line", parts: [0] }],
    mistakes: [
      {
        label: "Stops 12% short of the join",
        apply: (parts) => parts.map((part) => part.slice(0, Math.round(part.length * 0.88))),
      },
      {
        label: "A good circle, drawn at 58% of the size",
        apply: (parts) => parts.map((part) => scalePart(part, 0.58)),
      },
    ],
    imageSlug: "draw-a-perfect-circle",
  },
  {
    path: "/draw-an-owl-from-memory",
    shapeId: "ani-owl",
    partGroups: [
      { name: "Body outline, with the ear tufts", parts: [0] },
      { name: "Eyes - both rings and both pupils", parts: [1, 2, 3, 4] },
      { name: "Wings", parts: [6, 7] },
      { name: "Beak", parts: [5] },
      { name: "Feet", parts: [8, 9] },
    ],
    mistakes: [
      {
        label: "Eyes drawn 40% smaller and set wider apart",
        apply: (parts) =>
          parts.map((part, i) => {
            if (i < 1 || i > 4) return part;
            const side = i === 1 || i === 3 ? -1 : 1;
            return movePart(scalePart(part, 0.6), side * S * 0.04, 0);
          }),
      },
    ],
    imageSlug: "draw-an-owl-from-memory",
  },
  {
    path: "/draw-a-pig-from-memory",
    shapeId: "ani-pig",
    partGroups: [
      { name: "Head outline", parts: [0] },
      { name: "Ears", parts: [1, 2] },
      { name: "Snout and nostrils", parts: [5, 6, 7] },
      { name: "Eyes", parts: [3, 4] },
    ],
    mistakes: [
      {
        label: "Snout drawn 40% smaller and higher on the face",
        apply: (parts) => parts.map((part, i) => (i >= 5 ? movePart(scalePart(part, 0.6), 0, -S * 0.06) : part)),
      },
    ],
    imageSlug: "draw-a-pig-from-memory",
  },
  {
    path: "/draw-a-snail-from-memory",
    shapeId: "ani-snail",
    partGroups: [
      { name: "Foot", parts: [0] },
      { name: "Spiral", parts: [2] },
      { name: "Shell outline", parts: [1] },
      { name: "Eye stalks and eyes", parts: [3, 4, 5, 6] },
    ],
    mistakes: [
      {
        label: "Spiral with 1.2 turns instead of 2.2",
        apply: (parts) => parts.map((part, i) => (i === 2 ? hand(snailSpiral(1.2)) : part)),
      },
    ],
    imageSlug: "draw-a-snail-from-memory",
  },
  {
    path: "/draw-a-bear-from-memory",
    shapeId: "ani-bear",
    partGroups: [
      { name: "Head outline", parts: [0] },
      { name: "Ears", parts: [1, 2] },
      { name: "Muzzle, nose and mouth", parts: [5, 6, 7] },
      { name: "Eyes", parts: [3, 4] },
    ],
    mistakes: [
      {
        label: "Ears smaller, slid outwards and down the sides",
        apply: (parts) =>
          parts.map((part, i) => {
            if (i !== 1 && i !== 2) return part;
            const side = i === 1 ? -1 : 1;
            return movePart(scalePart(part, 0.7), side * S * 0.07, S * 0.05);
          }),
      },
    ],
    imageSlug: "draw-a-bear-from-memory",
  },
  // ---------------------------------------------------------------- wave 3 ---
  {
    path: "/draw-a-dog-from-memory",
    shapeId: "ani-dog",
    partGroups: [
      { name: "Head outline", parts: [0] },
      { name: "Floppy ears", parts: [1, 2] },
      { name: "Eyes", parts: [3, 4] },
      { name: "Nose, muzzle line and mouth", parts: [5, 6, 7] },
    ],
    mistakes: [
      {
        label: "Ears 35% smaller and set higher on the head",
        apply: (parts) =>
          parts.map((part, i) => {
            if (i !== 1 && i !== 2) return part;
            const side = i === 1 ? -1 : 1;
            return movePart(scalePart(part, 0.65), side * S * 0.03, -S * 0.05);
          }),
      },
      {
        label: "Nose, muzzle line and mouth drawn higher, close to the eyes",
        apply: (parts) => parts.map((part, i) => (i >= 5 ? movePart(part, 0, -S * 0.06) : part)),
      },
      {
        label: "The mouth left out",
        apply: (parts) => parts.filter((_, i) => i !== 7),
      },
    ],
    imageSlug: "draw-a-dog-from-memory",
  },
  {
    path: "/draw-a-cat-from-memory",
    shapeId: "ani-cat",
    partGroups: [
      { name: "Head outline, with the two ear points", parts: [0] },
      { name: "Eyes", parts: [1, 2] },
      { name: "Nose and W-shaped mouth", parts: [3, 4] },
      { name: "The four whiskers", parts: [5, 6, 7, 8] },
    ],
    mistakes: [
      {
        label: "Whiskers drawn 30% shorter and lower on the cheeks",
        apply: (parts) => parts.map((part, i) => (i >= 5 ? movePart(scalePart(part, 0.7), 0, S * 0.04) : part)),
      },
      {
        label: "Ear points drawn 60% shorter",
        apply: (parts) =>
          parts.map((part, i) =>
            i === 0 ? part.map((p) => ({ ...p, y: p.y + Math.max(0, S * 0.2 - p.y) * 0.6 })) : part,
          ),
      },
      {
        label: "The whiskers left out",
        apply: (parts) => parts.filter((_, i) => i < 5),
      },
    ],
    imageSlug: "draw-a-cat-from-memory",
  },
  {
    path: "/draw-a-triangle-from-memory",
    shapeId: "polygon-3",
    // Corners run apex -> bottom right -> bottom left, so the edges are: right side, base, left side.
    shareGroups: (parts) => [
      { name: "Base", length: edgeLength(parts[0], 16, 1) },
      { name: "Left side", length: edgeLength(parts[0], 16, 2) },
      { name: "Right side", length: edgeLength(parts[0], 16, 0) },
    ],
    mistakes: [
      {
        label: "Apex drifts 8% of the width off the centre line",
        apply: (parts) =>
          parts.map((part) => {
            const { minX, maxX, minY, maxY } = extent(part);
            return part.map((p) => ({ ...p, x: p.x + (maxX - minX) * 0.08 * ((maxY - p.y) / (maxY - minY)) }));
          }),
      },
      {
        label: "Base tilts 7° with the apex held in place",
        apply: (parts) =>
          parts.map((part) => {
            const { minX, maxX, minY, maxY } = extent(part);
            const cx = (minX + maxX) / 2;
            return part.map((p) => ({ ...p, y: p.y + (p.x - cx) * Math.tan((7 * Math.PI) / 180) * ((p.y - minY) / (maxY - minY)) }));
          }),
      },
      {
        label: "Drawn 30% too tall for its width",
        apply: (parts) =>
          parts.map((part) => {
            const { maxY } = extent(part);
            return part.map((p) => ({ ...p, y: maxY - (maxY - p.y) * 1.3 }));
          }),
      },
    ],
    imageSlug: "draw-a-triangle-from-memory",
  },
  {
    path: "/draw-a-lightning-bolt-from-memory",
    shapeId: "sym-lightning",
    // Corners run top tip, left step start, left step end, bottom tip, right step start, right step end.
    shareGroups: (parts) => [
      { name: "Upper arm - the two edges that meet at the top tip", length: sumEdges(parts[0], 10, [5, 0]) },
      { name: "The two horizontal steps", length: sumEdges(parts[0], 10, [1, 4]) },
      { name: "Lower arm - the two edges that meet at the bottom tip", length: sumEdges(parts[0], 10, [2, 3]) },
    ],
    mistakes: [
      {
        label: "Bottom tip drawn halfway under the top tip",
        build: (parts) => {
          const v = cornersOf(parts[0], 10).map((p) => ({ x: p.x, y: p.y }));
          v[3].x = (v[3].x + v[0].x) / 2;
          return [polygonFrom(v, 10)];
        },
      },
      {
        label: "The two steps drawn at the same height",
        build: (parts) => {
          const v = cornersOf(parts[0], 10).map((p) => ({ x: p.x, y: p.y }));
          v[4].y = v[1].y;
          v[5].y = v[1].y;
          return [polygonFrom(v, 10)];
        },
      },
      {
        label: "An extra kink added to the long lower edge",
        build: (parts) => {
          const v = cornersOf(parts[0], 10).map((p) => ({ x: p.x, y: p.y }));
          const mid = { x: (v[3].x + v[4].x) / 2 - S * 0.07, y: (v[3].y + v[4].y) / 2 };
          v.splice(4, 0, mid);
          return [polygonFrom(v, 10)];
        },
      },
    ],
    imageSlug: "draw-a-lightning-bolt-from-memory",
  },
  {
    path: "/draw-a-gear-from-memory",
    shapeId: "gear-8",
    // Each tooth is four corners: root, tip, tip, root. Edges cycle flank, tip, flank, then the chord across the gap.
    shareGroups: (parts) => {
      const edges = (offset: number) => Array.from({ length: 8 }, (_, tooth) => tooth * 4 + offset);
      return [
        { name: "Tooth tips - the eight flat tops", length: sumEdges(parts[0], 4, edges(1)) },
        { name: "Tooth sides - sixteen flanks", length: sumEdges(parts[0], 4, [...edges(0), ...edges(2)]) },
        { name: "Gaps between teeth - eight floors", length: sumEdges(parts[0], 4, edges(3)) },
      ];
    },
    mistakes: [
      {
        label: "Six teeth instead of eight",
        build: () => partsOfShape("gear-6"),
      },
      {
        label: "Teeth bunched on one side, gaps stretched on the other",
        build: (parts) => {
          const centre = { x: S / 2, y: S / 2 };
          const v = cornersOf(parts[0], 4);
          const bent = v.map((p, k) => rotateAbout(p, centre, 9 * Math.sin((Math.floor(k / 4) / 8) * Math.PI * 2 + 0.6)));
          return [polygonFrom(bent, 4)];
        },
      },
      {
        label: "Tooth tips and shoulders rounded off",
        build: (parts) => [asPart(smoothClosedPath(cornersOf(parts[0], 4), 6))],
      },
    ],
    imageSlug: "draw-a-gear-from-memory",
  },
  {
    path: "/draw-a-perfect-star",
    shapeId: "star-5",
    // Corners alternate tip, inner corner, starting at the top tip: each arm is the two edges either side of its tip.
    shareGroups: (parts) => [
      { name: "Top arm", length: sumEdges(parts[0], 8, [9, 0]) },
      { name: "The two upper arms", length: sumEdges(parts[0], 8, [1, 2, 7, 8]) },
      { name: "The two lower legs", length: sumEdges(parts[0], 8, [3, 4, 5, 6]) },
    ],
    mistakes: [
      {
        label: "One arm drawn 30% short",
        build: (parts) => {
          const c = { x: S / 2, y: S / 2 };
          const v = cornersOf(parts[0], 8).map((p) => ({ x: p.x, y: p.y }));
          v[8] = { x: c.x + (v[8].x - c.x) * 0.7, y: c.y + (v[8].y - c.y) * 0.7 };
          return [polygonFrom(v, 8)];
        },
      },
      {
        label: "Inner corners pushed 40% further out",
        build: (parts) => {
          const c = { x: S / 2, y: S / 2 };
          const v = cornersOf(parts[0], 8).map((p, k) =>
            k % 2 === 1 ? { x: c.x + (p.x - c.x) * 1.4, y: c.y + (p.y - c.y) * 1.4 } : { x: p.x, y: p.y },
          );
          return [polygonFrom(v, 8)];
        },
      },
      {
        label: "Bottom two tips drawn a tenth of the star's width closer together",
        build: (parts) => {
          const v = cornersOf(parts[0], 8).map((p) => ({ x: p.x, y: p.y }));
          const { minX, maxX } = extent(v);
          const dx = (maxX - minX) * 0.1;
          v[4].x -= dx;
          v[6].x += dx;
          return [polygonFrom(v, 8)];
        },
      },
    ],
    imageSlug: "draw-a-perfect-star",
  },
  {
    path: "/draw-a-perfect-heart",
    shapeId: "sym-heart",
    shareGroups: (parts) => {
      const part = parts[0];
      const widest = part.reduce((best, p) => (p.x > best.x ? p : best), part[0]);
      let upper = 0;
      let lower = 0;
      for (let i = 0; i + 1 < part.length; i++) {
        const length = pathLength([part[i], part[i + 1]]);
        if ((part[i].y + part[i + 1].y) / 2 <= widest.y) upper += length;
        else lower += length;
      }
      return [
        { name: "Lobes and the dip between them", length: upper },
        { name: "The two sides running down to the point", length: lower },
      ];
    },
    mistakes: [
      {
        label: "Right lobe drawn 18% narrower than the left",
        apply: (parts) =>
          parts.map((part) => {
            const { minX, maxX, maxY } = extent(part);
            const cx = (minX + maxX) / 2;
            const widest = part.reduce((best, p) => (p.x > best.x ? p : best), part[0]);
            return part.map((p) => {
              if (p.x <= cx) return p;
              const w = clamp01((maxY - p.y) / (maxY - widest.y));
              return { ...p, x: cx + (p.x - cx) * (1 - 0.18 * w) };
            });
          }),
      },
      {
        label: "Bottom point drawn 8% of the width off the centre line",
        apply: (parts) =>
          parts.map((part) => {
            const { minX, maxX, maxY } = extent(part);
            const widest = part.reduce((best, p) => (p.x > best.x ? p : best), part[0]);
            return part.map((p) => ({
              ...p,
              x: p.x + (maxX - minX) * 0.08 * clamp01((p.y - widest.y) / (maxY - widest.y)) ** 2,
            }));
          }),
      },
    ],
    imageSlug: "draw-a-perfect-heart",
  },
];

// -------------------------------------------------------------- computation ---

export type ScoreRow = {
  label: string;
  total: number;
  shapeMatch: number;
  coverage: number;
  smoothness: number;
  scale: number;
};

export type ScoredExample = {
  path: string;
  shapeId: string;
  /** Each group's share of the target's ink, which is its share of the comparison points. */
  partShares: { name: string; percent: number; points: number }[];
  /** First row: the hand alone. Then one row per mistake, drawn with the same hand. */
  rows: ScoreRow[];
  image: string;
};

function joinParts(parts: Part[]): DrawingPath {
  const points: Point[] = [];
  const breaks: number[] = [];
  for (const part of parts) {
    if (part.length === 0) continue;
    if (points.length > 0) breaks.push(points.length);
    points.push(...part);
  }
  return { points, breaks } as DrawingPath;
}

export function exampleTargetFor(definition: ScoredExampleDefinition): DrawingPath {
  const shape = getShapeById(definition.shapeId);
  if (!shape) throw new Error(`scored example needs shape "${definition.shapeId}"`);
  return shape.generate(S);
}

function targetParts(definition: ScoredExampleDefinition): Part[] {
  const target = exampleTargetFor(definition);
  return splitIntoSegments(target.points, target.breaks);
}

/** The hand alone (index -1) or the hand plus one of the definition's mistakes. */
export function exampleAttemptFor(definition: ScoredExampleDefinition, mistakeIndex: number): DrawingPath {
  const target = targetParts(definition);
  if (mistakeIndex < 0) return joinParts(target.map(hand));
  const mistake = definition.mistakes[mistakeIndex];
  if (mistake.build) return joinParts(mistake.build(target).map(hand));
  if (!mistake.apply) throw new Error(`mistake "${mistake.label}" has neither apply nor build`);
  return joinParts(mistake.apply(target.map(hand)));
}

function row(label: string, target: DrawingPath, attempt: DrawingPath): ScoreRow {
  const score = scoreAttempt(target, attempt);
  return {
    label,
    total: score.total,
    shapeMatch: score.shapeMatch,
    coverage: score.coverage,
    smoothness: score.smoothness,
    scale: score.scale,
  };
}

// ------------------------------------------------------------------ outputs ---

const INK_TARGET = "#c3c8d4";
const INK_ATTEMPT = "#2563eb";
const INK_LABEL = "#4b5563";

function svgPath(path: DrawingPath): string {
  const breaks = new Set(path.breaks ?? []);
  return path.points
    .map((point, index) => `${index === 0 || breaks.has(index) ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The overlay the game itself shows after a round: the attempt drawn over the
 * target it was scored against - here the attempt with the page's first mistake.
 */
export function scoredExampleSvg(definition: ScoredExampleDefinition): string {
  const target = exampleTargetFor(definition);
  const attempt = exampleAttemptFor(definition, 0);
  const example = computeScoredExample(definition);
  const mistakeRow = example.rows[1];
  const shapeName = getShapeById(definition.shapeId)?.name ?? definition.shapeId;
  const font = `font-family="-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="15"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img">` +
    `<title>${escapeXml(`${shapeName}: a scored attempt over the target`)}</title>` +
    `<desc>${escapeXml(
      `The ${shapeName.toLowerCase()} target in grey with a freehand attempt drawn over it in blue. ` +
        `The attempt: ${mistakeRow.label.toLowerCase()}. CYDI's scorer gives it ${mistakeRow.total} out of 100.`,
    )}</desc>` +
    `<rect width="${S}" height="${S}" fill="#ffffff"/>` +
    `<path d="${svgPath(target)}" fill="none" stroke="${INK_TARGET}" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<path d="${svgPath(attempt)}" fill="none" stroke="${INK_ATTEMPT}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<line x1="18" y1="380" x2="42" y2="380" stroke="${INK_TARGET}" stroke-width="9" stroke-linecap="round"/>` +
    `<text x="50" y="385" ${font} fill="${INK_LABEL}">target</text>` +
    `<line x1="120" y1="380" x2="144" y2="380" stroke="${INK_ATTEMPT}" stroke-width="3.5" stroke-linecap="round"/>` +
    `<text x="152" y="385" ${font} fill="${INK_LABEL}">attempt</text>` +
    `<text x="382" y="385" ${font} fill="${INK_LABEL}" text-anchor="end">scored ${mistakeRow.total} / 100</text>` +
    `</svg>\n`
  );
}

/** The committed, page-facing module: numbers only - no scorer, no generators. */
export function scoredExamplesDataModule(): string {
  const examples = SCORED_EXAMPLE_DEFINITIONS.map(computeScoredExample);
  return (
    `/*\n * © 2026 Lior Rubinovich. All rights reserved.\n` +
    ` * Unauthorized copying, modification, distribution, or commercial use is prohibited.\n */\n` +
    `// GENERATED by scripts/generateScoredExamples.ts from src/content/scoredExamples.ts - do not edit.\n` +
    `// Numbers from the real scorer, computed at build time; pages read this and never score anything.\n` +
    `// scoredExamples.test.ts regenerates it and fails if it is stale.\n\n` +
    `export type ScoredExampleRow = { label: string; total: number; shapeMatch: number; coverage: number; smoothness: number; scale: number };\n\n` +
    `export type ScoredExampleData = {\n  path: string;\n  shapeId: string;\n  partShares: { name: string; percent: number; points: number }[];\n  rows: ScoredExampleRow[];\n  image: string;\n};\n\n` +
    `export const SCORED_EXAMPLES: ScoredExampleData[] = ${JSON.stringify(examples, null, 2)};\n\n` +
    `export function scoredExampleForPath(path: string): ScoredExampleData | undefined {\n` +
    `  const normalized = path.replace(/\\/+$/, "");\n` +
    `  return SCORED_EXAMPLES.find((example) => example.path === normalized);\n}\n`
  );
}

export function computeScoredExample(definition: ScoredExampleDefinition): ScoredExample {
  const target = exampleTargetFor(definition);
  const parts = targetParts(definition);
  const lengths = parts.map((part) => pathLength(part));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const groups = definition.shareGroups
    ? definition.shareGroups(parts)
    : (definition.partGroups ?? []).map((group) => ({
        name: group.name,
        length: group.parts.reduce((sum, index) => sum + lengths[index], 0),
      }));
  const partShares = groups.map((group) => {
    const share = group.length / total;
    return { name: group.name, percent: Math.round(share * 100), points: Math.round(share * RESAMPLE_POINT_COUNT) };
  });
  const rows = [
    row("The same hand, no mistake", target, exampleAttemptFor(definition, -1)),
    ...definition.mistakes.map((mistake, index) => row(mistake.label, target, exampleAttemptFor(definition, index))),
  ];
  return {
    path: definition.path,
    shapeId: definition.shapeId,
    partShares,
    rows,
    image: `/images/seo/${definition.imageSlug}-scored-example.svg`,
  };
}
