/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * Two genuinely different drawing attempts at the same target, for the site's
 * 2 Players illustration.
 *
 * WHY THIS EXISTS: showing one trace twice with two different score labels is a
 * lie the eye catches immediately - the pictures are identical, so the numbers
 * cannot both be true. These are real, distinct point sets: a steady attempt
 * that tracks the outline, and a loose one that drifts off it, undershoots the
 * size and wobbles.
 *
 * THE SCORES ARE REAL. Each attempt is run through the game's own
 * `scoreAttempt` (engine/scoring.ts) and the number shown is what the scorer
 * returns, so the geometry and the percentage always agree - including if the
 * scoring weights are ever retuned. Nothing is written anywhere: this calls the
 * scorer the same way a unit test does. Production scoring is untouched.
 *
 * DETERMINISTIC: a fixed seed per attempt, so the marketing page renders the
 * same two drawings and the same two numbers on every visit and every device.
 *
 * Web-only module: imported from src/site/ only.
 */
import { scoreAttempt } from "../engine/scoring";
import type { ShapeDefinition } from "../content/contentRepository";
import type { DrawingPath } from "../types/Challenge";
import type { Point } from "../types/Point";

/** Small, fast, seedable PRNG - the same shape of thing the fake room uses for its bots. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * How one illustrative hand differs from the target.
 *
 * Everything here is SMOOTH and low-frequency on purpose. An earlier version
 * added per-point random noise, which scored correctly but drew a jagged,
 * fragmented line - it read as a broken rendering rather than as someone who
 * drew the shape less accurately. People do not produce high-frequency chaos;
 * they get the proportion, the size, the angle and the corner placement a bit
 * wrong, and their line wanders slowly off the outline and back.
 *
 * So the deformation is an affine error (scale, aspect, rotation, lean) plus a
 * few slow waves whose amplitude falls off with frequency. There is no
 * per-point randomness at all: the only random values are three phases, drawn
 * once from the seed, which is why the same shape always yields the same
 * drawing.
 */
type Wobble = {
  seed: number;
  /** Amplitude of the slow wander off the outline, in canvas units. */
  drift: number;
  /** Uniform size error. Below 1 undershoots, which the scorer punishes. */
  scale: number;
  /** Proportion error: >1 draws it taller than it should be, <1 squatter. */
  aspect: number;
  /** Whole-drawing rotation, in degrees. */
  rotate: number;
  /** Lean: the top of the drawing offset against the bottom, as a fraction. */
  shear: number;
};

function centroid(points: Point[]): { x: number; y: number } {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/**
 * Bends a target outline into something a person might actually have drawn.
 *
 * The wander is three harmonics with falling amplitude (0.6 / 0.3 / 0.1), so
 * the line curves away and back rather than vibrating - the highest frequency
 * carries a tenth of the movement and cannot produce a spike. Point order,
 * point count and `breaks` are untouched, so the stroke order and topology of
 * the original shape survive exactly.
 */
function handDrawn(path: DrawingPath, wobble: Wobble): DrawingPath {
  const rnd = mulberry32(wobble.seed);
  const c = centroid(path.points);
  const phaseA = rnd() * Math.PI * 2;
  const phaseB = rnd() * Math.PI * 2;
  const phaseC = rnd() * Math.PI * 2;
  const theta = (wobble.rotate * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  /** Three harmonics, amplitude falling with frequency - smooth by construction. */
  function wander(t: number, phase: number): number {
    return (
      wobble.drift *
      (Math.sin(t * Math.PI * 2 + phase) * 0.6 +
        Math.sin(t * Math.PI * 4 + phase * 1.7) * 0.3 +
        Math.sin(t * Math.PI * 6 + phase * 2.3) * 0.1)
    );
  }

  const points = path.points.map((p, i) => {
    const t = i / Math.max(1, path.points.length - 1);

    // Affine error first: size, proportion, lean, then rotation about the centre.
    let dx = (p.x - c.x) * wobble.scale;
    let dy = (p.y - c.y) * wobble.scale * wobble.aspect;
    dx += dy * wobble.shear;
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;

    return {
      ...p,
      x: c.x + rx + wander(t, phaseA),
      y: c.y + ry + wander(t, phaseB + phaseC * 0.5),
    };
  });

  // Everything except the coordinates carries through untouched - `breaks`, so
  // a multi-part shape is still drawn as separate parts with no connector line
  // between them, and the canvas dimensions the scorer normalises against.
  return { ...path, points };
}

/** The steady attempt: follows the outline closely, right size, slight wander. */
const STEADY: Wobble = { seed: 20260830, drift: 1.5, scale: 0.995, aspect: 1.0, rotate: 0.8, shear: 0.01 };

/**
 * The loose attempt: recognisably the same shape, drawn worse in the ways
 * people actually draw worse - a bit small, a bit squat, leaning, rotated, and
 * wandering off the line and back. No spikes, no fragmentation.
 */
const LOOSE: Wobble = { seed: 4471, drift: 6.2, scale: 0.84, aspect: 0.88, rotate: -10, shear: 0.1 };

export type IllustrativeAttempt = {
  path: DrawingPath;
  /** Straight from engine/scoring.ts - never a typed-in number. */
  score: number;
};

export type IllustrativeRound = {
  target: DrawingPath;
  steady: IllustrativeAttempt;
  loose: IllustrativeAttempt;
};

/** The canvas size the illustration is generated at. Bigger = smoother curves. */
export const ILLUSTRATION_SIZE = 140;

/**
 * Four more hands for the multiplayer overlay. Same reasoning as the pair
 * above: a room of players who all drew the identical line is not a room.
 */
const ROOM_HANDS: Wobble[] = [
  { seed: 4110, drift: 1.2, scale: 1.0, aspect: 1.0, rotate: 0.7, shear: 0.01 },
  { seed: 9271, drift: 2.6, scale: 0.985, aspect: 0.98, rotate: -2.4, shear: 0.02 },
  { seed: 3388, drift: 3.4, scale: 0.965, aspect: 1.04, rotate: 3.0, shear: 0.03 },
  { seed: 6142, drift: 5.2, scale: 0.9, aspect: 0.93, rotate: -5.6, shear: 0.06 },
];

function attempt(target: DrawingPath, wobble: Wobble): IllustrativeAttempt {
  const path = handDrawn(target, wobble);
  return { path, score: scoreAttempt(target, path).total };
}

/**
 * Both attempts at one shape, scored. Memoised per shape id: the arithmetic is
 * trivial but it runs during render on a marketing page, and the result can
 * never change for a given shape.
 */
const cache = new Map<string, IllustrativeRound>();

/**
 * Presents a fixed path as a ShapeDefinition, so the ordinary shape renderer
 * (ShapePreviewIcon, via SiteShape) can draw it without a second code path.
 * The id is suffixed so React keys and the memo cache stay distinct; nothing
 * reads these objects as catalog content.
 */
export function asDrawnShape(shape: ShapeDefinition, path: DrawingPath, variant: string): ShapeDefinition {
  return { ...shape, id: `${shape.id}--${variant}`, generate: () => path };
}

export type IllustrativeRoomEntry = {
  /** The attempt, ready to draw. */
  drawn: ShapeDefinition;
  /** Straight from engine/scoring.ts, for this exact drawing. */
  score: number;
};

/**
 * One illustrative room: several distinct attempts at the same target, each
 * scored by the real scorer and returned best-first. The leaderboard's ranking
 * and its winner are therefore derived from the drawings, not asserted.
 */
const roomCache = new Map<string, IllustrativeRoomEntry[]>();

export function illustrativeRoom(shape: ShapeDefinition, count: number): IllustrativeRoomEntry[] {
  const key = `${shape.id}:${count}`;
  const cached = roomCache.get(key);
  if (cached) return cached;

  const target = shape.generate(ILLUSTRATION_SIZE);
  const entries = ROOM_HANDS.slice(0, count)
    .map((hand, i) => {
      const path = handDrawn(target, hand);
      return { drawn: asDrawnShape(shape, path, `room${i}`), score: scoreAttempt(target, path).total };
    })
    .sort((a, b) => b.score - a.score);

  roomCache.set(key, entries);
  return entries;
}

export function illustrativeRound(shape: ShapeDefinition): IllustrativeRound {
  const cached = cache.get(shape.id);
  if (cached) return cached;

  const target = shape.generate(ILLUSTRATION_SIZE);
  const round: IllustrativeRound = {
    target,
    steady: attempt(target, STEADY),
    loose: attempt(target, LOOSE),
  };
  cache.set(shape.id, round);
  return round;
}
