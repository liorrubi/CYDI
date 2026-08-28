/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// CLI: regenerates the crawlable SEO illustrations under public/images/seo/.
//
//   npm run seo-images
//
// The outlines are traced from the SAME generator functions the game draws the
// target from (src/engine/shapeLibrary.ts), so an illustration can never drift
// away from the shape the page actually asks the player to draw. The annotation
// geometry is derived from the traced points too - nothing here is hand-placed.
//
// Web-only: these files are static assets served by the Worker's assets binding
// and referenced from worker/seoPages.ts. Nothing in the app or the Android
// build reads them.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getShapeById, type Vec2 } from "../src/engine/shapeLibrary.ts";
import { exampleAttempt, exampleTarget } from "../src/content/scoringExample.ts";
import type { DrawingPath } from "../src/types/Challenge.ts";

const SIZE = 400;
const INK = "#1f2937";
const ACCENT = "#2563eb";
const MUTED = "#6b7280";

/** `breaks` mark the start of a disconnected part, so each one begins a new subpath instead of drawing a connector. */
function toSvgPath(path: DrawingPath): string {
  const breaks = new Set(path.breaks ?? []);
  return path.points
    .map((point, index) => {
      const command = index === 0 || breaks.has(index) ? "M" : "L";
      return `${command}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
    })
    .join(" ");
}

function dot(point: Vec2, radius = 6): string {
  return `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${radius}" fill="${ACCENT}"/>`;
}

function label(text: string, x: number, y: number, anchor: "start" | "middle" | "end" = "middle"): string {
  return (
    `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" ` +
    `font-family="-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" ` +
    `font-size="15" fill="${MUTED}">${text}</text>`
  );
}

/** The vertical mirror line both shapes are built around - the axis their score is won or lost on. */
function symmetryAxis(): string {
  return (
    `<line x1="${SIZE / 2}" y1="26" x2="${SIZE / 2}" y2="${SIZE - 40}" ` +
    `stroke="${ACCENT}" stroke-width="2" stroke-dasharray="7 7" opacity="0.75"/>`
  );
}

function svg(title: string, description: string, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" role="img">` +
    `<title>${title}</title><desc>${description}</desc>` +
    `<rect width="${SIZE}" height="${SIZE}" fill="#ffffff"/>` +
    body +
    `</svg>\n`
  );
}

function shapeOutline(shapeId: string): { path: DrawingPath; svgPath: string } {
  const shape = getShapeById(shapeId);
  if (!shape) throw new Error(`unknown shape id: ${shapeId}`);
  const path = shape.generate(SIZE);
  return { path, svgPath: toSvgPath(path) };
}

function outlineMarkup(svgPath: string): string {
  return `<path d="${svgPath}" fill="none" stroke="${INK}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>`;
}

/** The traced outline closes back onto its first vertex, so the same point can appear twice. */
function dedupe(points: Vec2[]): Vec2[] {
  const seen = new Set<string>();
  return points.filter((point) => {
    const key = `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Star: the five tips and the five inner corners, read straight off the traced
 * outline by radius from the centre - the two rings the whole shape depends on.
 */
function starImage(): string {
  const { path, svgPath } = shapeOutline("star-5");
  const center = { x: SIZE / 2, y: SIZE / 2 };
  const withRadius = path.points.map((point) => ({
    point: { x: point.x, y: point.y },
    radius: Math.hypot(point.x - center.x, point.y - center.y),
  }));
  const maxRadius = Math.max(...withRadius.map((entry) => entry.radius));
  const minRadius = Math.min(...withRadius.map((entry) => entry.radius));
  // Vertices only: the generator interpolates along each edge, so keep the
  // points that actually sit on the outer or inner ring.
  const tips = dedupe(withRadius.filter((entry) => entry.radius > maxRadius - 0.5).map((entry) => entry.point));
  const inner = dedupe(withRadius.filter((entry) => entry.radius < minRadius + 0.5).map((entry) => entry.point));

  const rings =
    `<circle cx="${center.x}" cy="${center.y}" r="${maxRadius.toFixed(1)}" fill="none" ` +
    `stroke="${ACCENT}" stroke-width="1.5" stroke-dasharray="4 6" opacity="0.5"/>` +
    `<circle cx="${center.x}" cy="${center.y}" r="${minRadius.toFixed(1)}" fill="none" ` +
    `stroke="${ACCENT}" stroke-width="1.5" stroke-dasharray="4 6" opacity="0.5"/>`;

  return svg(
    "Five-point star drawing target with symmetry guides",
    "The five-point star target used in the CYDI star challenge. A dashed vertical line marks the mirror axis, " +
      "two dashed circles mark the ring the five tips sit on and the ring the five inner corners sit on, and every " +
      "vertex is marked as a dot.",
    rings +
      symmetryAxis() +
      outlineMarkup(svgPath) +
      tips.map((tip) => dot(tip)).join("") +
      inner.map((point) => dot(point, 4)).join("") +
      label("mirror axis", SIZE / 2, 20) +
      label("5 tips, one ring, 72° apart", SIZE / 2, SIZE - 16),
  );
}

/**
 * Heart: the two points that decide whether it reads as symmetrical - the dip
 * between the lobes and the bottom point - both of which must land on the axis.
 */
function heartImage(): string {
  const { path, svgPath } = shapeOutline("sym-heart");
  const centerX = SIZE / 2;
  const onAxis = path.points.filter((point) => Math.abs(point.x - centerX) < SIZE * 0.004);
  const dip = onAxis.reduce((best, point) => (point.y < best.y ? point : best), onAxis[0]);
  const tip = path.points.reduce((best, point) => (point.y > best.y ? point : best), path.points[0]);
  const widest = path.points.reduce((best, point) => (point.x > best.x ? point : best), path.points[0]);

  const lobeLine =
    `<line x1="${(SIZE - widest.x).toFixed(1)}" y1="${widest.y.toFixed(1)}" ` +
    `x2="${widest.x.toFixed(1)}" y2="${widest.y.toFixed(1)}" ` +
    `stroke="${ACCENT}" stroke-width="2" stroke-dasharray="7 7" opacity="0.75"/>`;

  // The heart fills its canvas almost edge to edge, and its two side labels have
  // nowhere to go without landing on the outline. Shrinking the whole drawing
  // about its centre - uniformly, so the proportions the player has to copy are
  // untouched - frees a margin on each side for them, reached by a short leader.
  const shrink = 0.82;
  const at = (point: Vec2): Vec2 => ({
    x: centerX + (point.x - centerX) * shrink,
    y: SIZE / 2 + (point.y - SIZE / 2) * shrink,
  });
  const leader = (from: number, to: number, y: number): string =>
    `<line x1="${from.toFixed(1)}" y1="${y.toFixed(1)}" x2="${to.toFixed(1)}" y2="${y.toFixed(1)}" ` +
    `stroke="${MUTED}" stroke-width="1"/>`;

  const scaled = at(widest);
  const scaledDip = at(dip);
  const scaledTip = at(tip);

  return svg(
    "Heart drawing target with symmetry and centre-alignment guides",
    "The heart target used in the CYDI heart challenge. A dashed vertical line marks the mirror axis, the dip " +
      "between the two lobes and the bottom point are marked as dots on that axis, and a dashed horizontal line " +
      "shows the two lobes reaching the same width at the same height.",
    `<g transform="translate(${centerX} ${SIZE / 2}) scale(${shrink}) translate(${-centerX} ${-SIZE / 2})">` +
      symmetryAxis() +
      lobeLine +
      outlineMarkup(svgPath) +
      dot(dip, 6 / shrink) +
      dot(tip, 6 / shrink) +
      dot({ x: SIZE - widest.x, y: widest.y }, 4 / shrink) +
      dot(widest, 4 / shrink) +
      `</g>` +
      // Right margin, level with the dip; left margin, level with the lobe line.
      leader(scaled.x + 6, SIZE - 84, scaledDip.y - 4) +
      label("centre dip", SIZE - 80, scaledDip.y, "start") +
      leader(SIZE - scaled.x - 6, 84, scaled.y) +
      label("equal lobes", 80, scaled.y + 4, "end") +
      label("mirror axis", centerX, 22) +
      label("dip and point on one line", centerX, Math.min(scaledTip.y + 30, SIZE - 12)),
  );
}

/**
 * Circle: the two things a freehand circle is actually judged on - one constant
 * radius all the way round, and a join that lands back where the line started.
 * Both are read off the traced outline (centre and radius from its own points).
 */
function circleImage(): string {
  const { path, svgPath } = shapeOutline("circle");
  const xs = path.points.map((point) => point.x);
  const ys = path.points.map((point) => point.y);
  const center = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  const radius = (Math.max(...xs) - Math.min(...xs)) / 2;
  // Where the generator starts the outline is where a player's line has to come
  // back to - the one place a circle can visibly fail to close.
  const join = path.points[0];

  const radii = [0, 90, 180, 270]
    .map((degrees) => {
      const radians = (degrees * Math.PI) / 180;
      return (
        `<line x1="${center.x.toFixed(1)}" y1="${center.y.toFixed(1)}" ` +
        `x2="${(center.x + Math.cos(radians) * radius).toFixed(1)}" ` +
        `y2="${(center.y + Math.sin(radians) * radius).toFixed(1)}" ` +
        `stroke="${ACCENT}" stroke-width="1.5" stroke-dasharray="5 6" opacity="0.55"/>`
      );
    })
    .join("");

  return svg(
    "Circle drawing target with radius and closing-point guides",
    "The circle target used in the CYDI circle challenge. Four dashed radii from the centre show the single " +
      "distance every point of the line has to keep, and a marked dot shows the point where the drawn line has " +
      "to close back onto its own start.",
    radii +
      outlineMarkup(svgPath) +
      dot(center, 4) +
      dot(join) +
      label("every point, one distance from here", center.x, center.y - 14) +
      label("start and finish meet here", Math.min(join.x - 10, SIZE - 12), join.y + 5, "end") +
      label("no corners to aim at, nowhere to hide a wobble", SIZE / 2, SIZE - 14),
  );
}

/**
 * The worked example on /how-to-play: the real circle target with the real
 * example attempt laid over it, exactly the way the game shows a finished round.
 * Both paths come from src/content/scoringExample.ts, which is also what the page
 * scores - so the picture and the numbers beside it can never disagree.
 */
function scoringOverlayImage(): string {
  const target = exampleTarget(SIZE);
  const attempt = exampleAttempt(SIZE);

  const legend = (x: number, y: number, color: string, text: string): string =>
    `<line x1="${x}" y1="${y}" x2="${x + 34}" y2="${y}" stroke="${color}" stroke-width="5" stroke-linecap="round"/>` +
    label(text, x + 44, y + 5, "start");

  return svg(
    "A drawing attempt laid over the circle target it was scored against",
    "The CYDI circle target drawn as a thick grey line with an example freehand attempt drawn over it in blue. " +
      "The attempt is slightly smaller than the target and slightly wider than it is tall, and its line wavers " +
      "in and out of the target instead of holding one distance from the centre.",
    `<path d="${toSvgPath(target)}" fill="none" stroke="#c9ced6" stroke-width="12" ` +
      `stroke-linejoin="round" stroke-linecap="round"/>` +
      `<path d="${toSvgPath(attempt)}" fill="none" stroke="${ACCENT}" stroke-width="4" ` +
      `stroke-linejoin="round" stroke-linecap="round"/>` +
      legend(24, SIZE - 44, "#c9ced6", "the target") +
      legend(24, SIZE - 20, ACCENT, "the attempt"),
  );
}

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "images", "seo");
const FILES: [string, string][] = [
  ["draw-a-perfect-star-five-point-star-symmetry-guide.svg", starImage()],
  ["draw-a-perfect-heart-symmetry-and-curve-guide.svg", heartImage()],
  ["draw-a-perfect-circle-radius-and-closing-guide.svg", circleImage()],
  ["how-to-play-attempt-over-target.svg", scoringOverlayImage()],
];

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, contents] of FILES) {
  writeFileSync(join(OUT_DIR, name), contents, "utf8");
  console.log(`wrote public/images/seo/${name}`);
}
