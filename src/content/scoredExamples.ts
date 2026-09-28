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
import { getShapeById } from "../engine/shapeLibrary";
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
  apply: (parts: Part[]) => Part[];
};

export type ScoredExampleDefinition = {
  path: string;
  shapeId: string;
  /** Named groups of the target's parts, in drawing order - e.g. both eyes as one line of the table. */
  partGroups: { name: string; parts: number[] }[];
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
  const drawn = targetParts(definition).map(hand);
  return joinParts(mistakeIndex < 0 ? drawn : definition.mistakes[mistakeIndex].apply(drawn));
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
  const partShares = definition.partGroups.map((group) => {
    const share = group.parts.reduce((sum, index) => sum + lengths[index], 0) / total;
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
