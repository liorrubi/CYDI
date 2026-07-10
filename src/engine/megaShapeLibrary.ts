import type { DrawingPath } from "../types/Challenge";
import { MEGA_RARITY_LABELS, type MegaRarity } from "../app/constants";
import {
  openPolyline,
  polar,
  polygonEdges,
  smoothClosedPath,
  toPathFromParts,
  type ShapeDefinition,
  type Vec2,
} from "./shapeLibrary";

/**
 * Mega Challenge card library - a small, deliberately separate collection of
 * prestige drawings. These are NOT part of SHAPE_LIBRARY on purpose: adding
 * them there would inflate the journey progress denominator and the
 * "unlock every shape" achievement target. They satisfy the same
 * ShapeDefinition contract, so ShapePreviewIcon / DrawingCanvas /
 * scoreAttempt all work on them unchanged.
 */
export type MegaCardDefinition = ShapeDefinition & {
  /** Emoji shown on the album card next to the drawing preview. */
  icon: string;
  rarity: MegaRarity;
  /** 1-5, shown as flame icons on the album card. */
  difficulty: number;
  /** Existing achievement that unlocks this card for free - reusing the game's real achievements (rather than adding near-duplicate ones with different rewards) keeps one condition = one achievement. */
  unlockAchievementId: string;
};

// ---------- local geometry helpers ----------

function f(size: number, x: number, y: number): Vec2 {
  return { x: x * size, y: y * size };
}

function fverts(size: number, pairs: [number, number][]): Vec2[] {
  return pairs.map(([x, y]) => f(size, x, y));
}

function circleAt(center: Vec2, radius: number, steps = 20, startDeg = -90): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i <= steps; i++) points.push(polar(center, radius, startDeg + (i / steps) * 360));
  return points;
}

/** Arc from startDeg to endDeg (linear interpolation, so a descending range sweeps the other way). */
function arcPoints(center: Vec2, radius: number, startDeg: number, endDeg: number, steps = 24): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i <= steps; i++) points.push(polar(center, radius, startDeg + (i / steps) * (endDeg - startDeg)));
  return points;
}

/** Quadratic bezier from a to b via control c. */
function quadCurve(a: Vec2, c: Vec2, b: Vec2, steps = 16): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    points.push({
      x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    });
  }
  return points;
}

function mirrorX(points: Vec2[], size: number): Vec2[] {
  return points.map((p) => ({ x: size - p.x, y: p.y }));
}

/** Star polygon alternating outer/inner radius, starting from the top point. */
function starVertices(center: Vec2, spikes: number, outerR: number, innerR: number): Vec2[] {
  const vertices: Vec2[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const radius = i % 2 === 0 ? outerR : innerR;
    vertices.push(polar(center, radius, -90 + (i / (spikes * 2)) * 360));
  }
  return vertices;
}

/** Battlemented top walked left to right: across a merlon, down into a gap, up again... starting and ending on merlon tops. */
function battlementRun(size: number, x0: number, x1: number, yTop: number, yGap: number, merlons: number): Vec2[] {
  const segments = merlons * 2 - 1;
  const w = (x1 - x0) / segments;
  const points: Vec2[] = [f(size, x0, yTop)];
  for (let i = 1; i <= segments; i++) {
    const x = x0 + i * w;
    const onMerlon = i % 2 === 1;
    // Drop/rise happens at segment boundaries, tracing verticals explicitly.
    points.push(f(size, x - w, onMerlon ? yGap : yTop));
    points.push(f(size, x - w, onMerlon ? yTop : yGap));
    points.push(f(size, x, onMerlon ? yTop : yGap));
  }
  return points;
}

// ---------- the twelve mega drawings ----------

function royalCrown(size: number): DrawingPath {
  const outline = polygonEdges(
    fverts(size, [
      [0.2, 0.72],
      [0.18, 0.38],
      [0.34, 0.52],
      [0.5, 0.3],
      [0.66, 0.52],
      [0.82, 0.38],
      [0.8, 0.72],
    ]),
    12,
  );
  const band = openPolyline(fverts(size, [[0.21, 0.64], [0.79, 0.64]]), 24);
  const jewelLeft = circleAt(f(size, 0.18, 0.33), size * 0.033);
  const jewelCenter = circleAt(f(size, 0.5, 0.245), size * 0.04);
  const jewelRight = circleAt(f(size, 0.82, 0.33), size * 0.033);
  return toPathFromParts([outline, band, jewelLeft, jewelCenter, jewelRight], size);
}

function championTrophy(size: number): DrawingPath {
  const cup = [
    ...openPolyline(fverts(size, [[0.3, 0.26], [0.7, 0.26]]), 20),
    ...quadCurve(f(size, 0.7, 0.26), f(size, 0.68, 0.52), f(size, 0.54, 0.56), 18),
    ...openPolyline(
      fverts(size, [
        [0.54, 0.56],
        [0.53, 0.64],
        [0.64, 0.68],
        [0.64, 0.74],
        [0.36, 0.74],
        [0.36, 0.68],
        [0.47, 0.64],
        [0.46, 0.56],
      ]),
      8,
    ),
    ...quadCurve(f(size, 0.46, 0.56), f(size, 0.32, 0.52), f(size, 0.3, 0.26), 18),
  ];
  const handleLeft = arcPoints(f(size, 0.255, 0.375), size * 0.09, 300, 55, 22);
  const handleRight = mirrorX(handleLeft, size);
  const star = polygonEdges(starVertices(f(size, 0.5, 0.4), 5, size * 0.055, size * 0.022), 4);
  return toPathFromParts([cup, handleLeft, handleRight, star], size);
}

function legendarySword(size: number): DrawingPath {
  const outline = polygonEdges(
    fverts(size, [
      [0.5, 0.08],
      [0.545, 0.18],
      [0.545, 0.56],
      [0.655, 0.56],
      [0.655, 0.615],
      [0.53, 0.615],
      [0.53, 0.76],
      [0.47, 0.76],
      [0.47, 0.615],
      [0.345, 0.615],
      [0.345, 0.56],
      [0.455, 0.56],
      [0.455, 0.18],
    ]),
    8,
  );
  const fuller = openPolyline(fverts(size, [[0.5, 0.16], [0.5, 0.52]]), 24);
  const pommel = circleAt(f(size, 0.5, 0.795), size * 0.035);
  const gem = circleAt(f(size, 0.5, 0.5875), size * 0.018);
  return toPathFromParts([outline, fuller, pommel, gem], size);
}

function rocketSpaceship(size: number): DrawingPath {
  const body = [
    ...quadCurve(f(size, 0.5, 0.09), f(size, 0.585, 0.15), f(size, 0.59, 0.3), 14),
    ...openPolyline(fverts(size, [[0.59, 0.3], [0.59, 0.6], [0.41, 0.6], [0.41, 0.3]]), 12),
    ...quadCurve(f(size, 0.41, 0.3), f(size, 0.415, 0.15), f(size, 0.5, 0.09), 14),
  ];
  const finLeft = polygonEdges(fverts(size, [[0.41, 0.44], [0.29, 0.62], [0.29, 0.66], [0.41, 0.62]]), 8);
  const finRight = polygonEdges(fverts(size, [[0.59, 0.44], [0.71, 0.62], [0.71, 0.66], [0.59, 0.62]]), 8);
  const window = circleAt(f(size, 0.5, 0.33), size * 0.055);
  const flame = openPolyline(
    fverts(size, [
      [0.44, 0.61],
      [0.46, 0.7],
      [0.48, 0.64],
      [0.5, 0.76],
      [0.52, 0.64],
      [0.54, 0.7],
      [0.56, 0.61],
    ]),
    6,
  );
  return toPathFromParts([body, finLeft, finRight, window, flame], size);
}

function battleRobot(size: number): DrawingPath {
  const head = polygonEdges(fverts(size, [[0.38, 0.14], [0.62, 0.14], [0.62, 0.32], [0.38, 0.32]]), 10);
  const eyeLeft = circleAt(f(size, 0.445, 0.23), size * 0.025);
  const eyeRight = circleAt(f(size, 0.555, 0.23), size * 0.025);
  // Antenna stalk plus its tip bulb in one continuous stroke, so it stays a single traceable part.
  const antenna = [
    ...openPolyline(fverts(size, [[0.5, 0.14], [0.5, 0.105]]), 4),
    ...circleAt(f(size, 0.5, 0.085), size * 0.02, 16, 90),
  ];
  const torsoAndLegs = polygonEdges(
    fverts(size, [
      [0.35, 0.36],
      [0.65, 0.36],
      [0.65, 0.6],
      [0.61, 0.6],
      [0.61, 0.8],
      [0.53, 0.8],
      [0.53, 0.64],
      [0.47, 0.64],
      [0.47, 0.8],
      [0.39, 0.8],
      [0.39, 0.6],
      [0.35, 0.6],
    ]),
    6,
  );
  const armLeft = polygonEdges(fverts(size, [[0.245, 0.38], [0.325, 0.38], [0.325, 0.58], [0.245, 0.58]]), 8);
  const armRight = polygonEdges(fverts(size, [[0.675, 0.38], [0.755, 0.38], [0.755, 0.58], [0.675, 0.58]]), 8);
  const chestLight = circleAt(f(size, 0.5, 0.46), size * 0.032);
  return toPathFromParts([head, eyeLeft, eyeRight, antenna, torsoAndLegs, armLeft, armRight, chestLight], size);
}

function grandCastle(size: number): DrawingPath {
  const outline = polygonEdges(
    [
      f(size, 0.18, 0.78),
      f(size, 0.18, 0.26),
      ...battlementRun(size, 0.18, 0.34, 0.26, 0.32, 2),
      f(size, 0.34, 0.48),
      f(size, 0.38, 0.48),
      ...battlementRun(size, 0.38, 0.62, 0.42, 0.48, 3),
      f(size, 0.62, 0.48),
      f(size, 0.66, 0.48),
      f(size, 0.66, 0.26),
      ...battlementRun(size, 0.66, 0.82, 0.26, 0.32, 2),
      f(size, 0.82, 0.78),
    ],
    3,
  );
  const gate = [
    ...openPolyline(fverts(size, [[0.44, 0.78], [0.44, 0.66]]), 8),
    ...arcPoints(f(size, 0.5, 0.66), size * 0.06, 180, 360, 16),
    ...openPolyline(fverts(size, [[0.56, 0.66], [0.56, 0.78]]), 8),
  ];
  // Flagpole and pennant drawn as one continuous stroke off the right tower.
  const flag = openPolyline(fverts(size, [[0.74, 0.26], [0.74, 0.15], [0.81, 0.18], [0.74, 0.21]]), 8);
  const window = circleAt(f(size, 0.26, 0.42), size * 0.024);
  return toPathFromParts([outline, gate, flag, window], size);
}

function wizardHat(size: number): DrawingPath {
  const brim: Vec2[] = [];
  const brimCenter = f(size, 0.5, 0.66);
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    brim.push({ x: brimCenter.x + size * 0.3 * Math.cos(a), y: brimCenter.y + size * 0.065 * Math.sin(a) });
  }
  const cone = [
    ...quadCurve(f(size, 0.34, 0.62), f(size, 0.4, 0.3), f(size, 0.58, 0.12), 20),
    ...quadCurve(f(size, 0.58, 0.12), f(size, 0.57, 0.35), f(size, 0.66, 0.62), 20),
  ];
  const band = quadCurve(f(size, 0.375, 0.565), f(size, 0.51, 0.59), f(size, 0.645, 0.565), 14);
  const star = polygonEdges(starVertices(f(size, 0.47, 0.38), 4, size * 0.055, size * 0.021), 4);
  const sparkle = circleAt(f(size, 0.565, 0.26), size * 0.018);
  return toPathFromParts([brim, cone, band, star, sparkle], size);
}

function treasureChest(size: number): DrawingPath {
  // Domed lid: open elliptical arc whose ends land exactly on the body's top
  // corners, so lid and body share a clean seam without double-drawing it.
  const lid: Vec2[] = [];
  for (let i = 0; i <= 32; i++) {
    const a = Math.PI + (i / 32) * Math.PI;
    lid.push({ x: size * (0.5 + 0.26 * Math.cos(a)), y: size * (0.46 + 0.14 * Math.sin(a)) });
  }
  const body = polygonEdges(fverts(size, [[0.24, 0.46], [0.76, 0.46], [0.76, 0.74], [0.24, 0.74]]), 12);
  const strapLeft = polygonEdges(fverts(size, [[0.34, 0.46], [0.38, 0.46], [0.38, 0.74], [0.34, 0.74]]), 6);
  const strapRight = polygonEdges(fverts(size, [[0.62, 0.46], [0.66, 0.46], [0.66, 0.74], [0.62, 0.74]]), 6);
  // Keyhole: ring plus flared slot below it.
  const lockRing = circleAt(f(size, 0.5, 0.56), size * 0.04);
  const lockSlot = polygonEdges(fverts(size, [[0.482, 0.592], [0.518, 0.592], [0.5, 0.665]]), 6);
  return toPathFromParts([lid, body, strapLeft, strapRight, lockRing, lockSlot], size);
}

function pirateShip(size: number): DrawingPath {
  const hull = [
    ...openPolyline(fverts(size, [[0.16, 0.6], [0.84, 0.6]]), 20),
    ...quadCurve(f(size, 0.84, 0.6), f(size, 0.82, 0.72), f(size, 0.68, 0.76), 10),
    ...openPolyline(fverts(size, [[0.68, 0.76], [0.32, 0.76]]), 12),
    ...quadCurve(f(size, 0.32, 0.76), f(size, 0.18, 0.72), f(size, 0.16, 0.6), 10),
  ];
  const sail = [
    ...openPolyline(fverts(size, [[0.35, 0.2], [0.65, 0.2]]), 12),
    ...quadCurve(f(size, 0.65, 0.2), f(size, 0.7, 0.33), f(size, 0.65, 0.46), 12),
    ...quadCurve(f(size, 0.65, 0.46), f(size, 0.5, 0.52), f(size, 0.35, 0.46), 12),
    ...quadCurve(f(size, 0.35, 0.46), f(size, 0.3, 0.33), f(size, 0.35, 0.2), 12),
  ];
  const mastLower = openPolyline(fverts(size, [[0.5, 0.5], [0.5, 0.6]]), 8);
  // Upper mast and pennant in one continuous stroke above the sail.
  const mastAndFlag = openPolyline(fverts(size, [[0.5, 0.19], [0.5, 0.1], [0.6, 0.13], [0.5, 0.16]]), 6);
  const porthole = circleAt(f(size, 0.5, 0.68), size * 0.024);
  return toPathFromParts([hull, sail, mastLower, mastAndFlag, porthole], size);
}

function legendaryKey(size: number): DrawingPath {
  // Ornate bow: a donut of two circles; the outer ring's bottom touches the
  // shaft's top edge exactly.
  const bowOuter = circleAt(f(size, 0.5, 0.245), size * 0.125, 40);
  const bowInner = circleAt(f(size, 0.5, 0.245), size * 0.062, 24);
  // Shaft, collar and two stepped teeth merged into one closed silhouette -
  // the teeth are built like the castle's battlements.
  const shaft = polygonEdges(
    fverts(size, [
      [0.475, 0.37], // shaft top-left
      [0.525, 0.37],
      [0.525, 0.4], // collar, flaring out
      [0.545, 0.4],
      [0.545, 0.435],
      [0.525, 0.435],
      [0.525, 0.6], // down to the bit
      [0.63, 0.6], // tooth 1
      [0.63, 0.655],
      [0.575, 0.655],
      [0.575, 0.7],
      [0.655, 0.7], // tooth 2, longer
      [0.655, 0.755],
      [0.525, 0.755],
      [0.525, 0.78], // squared tip
      [0.475, 0.78],
      [0.475, 0.435], // back up the left edge
      [0.455, 0.435], // collar, left side
      [0.455, 0.4],
      [0.475, 0.4],
    ]),
    5,
  );
  // Four-point sparkle in the open space beside the bit - it's a magic key.
  const sparkle = polygonEdges(starVertices(f(size, 0.34, 0.63), 4, size * 0.05, size * 0.019), 4);
  return toPathFromParts([bowOuter, bowInner, shaft, sparkle], size);
}

function risingPhoenix(size: number): DrawingPath {
  const body = smoothClosedPath(
    fverts(size, [
      [0.5, 0.285],
      [0.545, 0.315],
      [0.555, 0.38],
      [0.565, 0.475],
      [0.525, 0.585],
      [0.465, 0.565],
      [0.44, 0.46],
      [0.45, 0.35],
    ]),
    10,
  );
  const beak = polygonEdges(fverts(size, [[0.455, 0.3], [0.475, 0.335], [0.385, 0.325]]), 8);
  const wingLeft = polygonEdges(
    fverts(size, [
      [0.455, 0.415],
      [0.36, 0.345],
      [0.27, 0.245],
      [0.2, 0.125],
      [0.275, 0.225],
      [0.235, 0.3],
      [0.32, 0.33],
      [0.29, 0.41],
      [0.385, 0.42],
      [0.44, 0.475],
    ]),
    5,
  );
  const wingRight = mirrorX(wingLeft, size);
  const tail1 = quadCurve(f(size, 0.48, 0.6), f(size, 0.38, 0.68), f(size, 0.42, 0.82), 14);
  const tail2 = quadCurve(f(size, 0.51, 0.615), f(size, 0.53, 0.72), f(size, 0.49, 0.845), 14);
  const tail3 = quadCurve(f(size, 0.545, 0.6), f(size, 0.63, 0.68), f(size, 0.58, 0.82), 14);
  return toPathFromParts([body, beak, wingLeft, wingRight, tail1, tail2, tail3], size);
}

function thunderHammer(size: number): DrawingPath {
  const head = polygonEdges(fverts(size, [[0.26, 0.2], [0.74, 0.2], [0.72, 0.46], [0.28, 0.46]]), 12);
  const handle = polygonEdges(fverts(size, [[0.465, 0.46], [0.535, 0.46], [0.535, 0.78], [0.465, 0.78]]), 8);
  const wrap = openPolyline(fverts(size, [[0.465, 0.6], [0.535, 0.6]]), 6);
  const pommel = circleAt(f(size, 0.5, 0.81), size * 0.028);
  const bolt = polygonEdges(
    fverts(size, [
      [0.545, 0.235],
      [0.445, 0.335],
      [0.5, 0.335],
      [0.435, 0.425],
      [0.555, 0.315],
      [0.495, 0.315],
    ]),
    6,
  );
  return toPathFromParts([head, handle, wrap, pommel, bolt], size);
}

// ---------- card definitions ----------

export const MEGA_CARDS: MegaCardDefinition[] = [
  // Rare
  { id: "mega-crown", name: "Royal Crown", category: "fantasy", icon: "👑", rarity: "rare", difficulty: 3, unlockAchievementId: "collector", generate: royalCrown },
  { id: "mega-trophy", name: "Champion Trophy", category: "fantasy", icon: "🏆", rarity: "rare", difficulty: 3, unlockAchievementId: "precision", generate: championTrophy },
  { id: "mega-sword", name: "Legendary Sword", category: "fantasy", icon: "⚔️", rarity: "rare", difficulty: 3, unlockAchievementId: "streak-7", generate: legendarySword },
  { id: "mega-rocket", name: "Star Voyager", category: "fantasy", icon: "🚀", rarity: "rare", difficulty: 3, unlockAchievementId: "share-3", generate: rocketSpaceship },
  { id: "mega-robot", name: "Battle Robot", category: "fantasy", icon: "🤖", rarity: "rare", difficulty: 4, unlockAchievementId: "perfect-x5", generate: battleRobot },
  // Epic
  { id: "mega-castle", name: "Grand Castle", category: "fantasy", icon: "🏰", rarity: "epic", difficulty: 5, unlockAchievementId: "painter", generate: grandCastle },
  { id: "mega-wizard-hat", name: "Wizard's Hat", category: "fantasy", icon: "🧙", rarity: "epic", difficulty: 3, unlockAchievementId: "expert", generate: wizardHat },
  { id: "mega-chest", name: "Treasure Chest", category: "fantasy", icon: "💰", rarity: "epic", difficulty: 4, unlockAchievementId: "streak-14", generate: treasureChest },
  { id: "mega-pirate-ship", name: "Pirate Galleon", category: "fantasy", icon: "🏴‍☠️", rarity: "epic", difficulty: 4, unlockAchievementId: "share-10", generate: pirateShip },
  // Legendary
  { id: "mega-key", name: "Legendary Key", category: "fantasy", icon: "🗝️", rarity: "legendary", difficulty: 4, unlockAchievementId: "perfect-x25", generate: legendaryKey },
  { id: "mega-phoenix", name: "Rising Phoenix", category: "fantasy", icon: "🔥", rarity: "legendary", difficulty: 5, unlockAchievementId: "streak-30", generate: risingPhoenix },
  { id: "mega-hammer", name: "Thunder Hammer", category: "fantasy", icon: "🔨", rarity: "legendary", difficulty: 3, unlockAchievementId: "perfection", generate: thunderHammer },
];

export const MEGA_ALBUM_SIZE = MEGA_CARDS.length;

export function getMegaCardById(id: string): MegaCardDefinition | undefined {
  return MEGA_CARDS.find((card) => card.id === id);
}

export function megaCardsByRarity(rarity: MegaRarity): MegaCardDefinition[] {
  return MEGA_CARDS.filter((card) => card.rarity === rarity);
}

export function megaRarityLabel(rarity: MegaRarity): string {
  return MEGA_RARITY_LABELS[rarity];
}
