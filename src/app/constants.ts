export const APP_NAME = "CYDI";
export const APP_TAGLINE = "Quick drawing challenges";

export const STORAGE_KEY = "cydi.challenges.v1";
export const SHAPE_CHALLENGE_STORAGE_KEY = "cydi.shapeChallenge.progress.v1";
export const SHAPE_CHALLENGE_PASS_SCORE = 70;

export const CANVAS_SIZE = 320;

export const RESAMPLE_POINT_COUNT = 128;
export const MIN_POINTS_TO_SAVE = 8;

export const PREVIEW_DURATION_MS = 2000;
export const ANALYZING_MIN_MS = 800;
export const ANALYZING_MAX_MS = 1200;

// A step of 1 tries every possible rotational starting point (cheap: ~128
// offsets x 2 directions on a 128-point array, well under a millisecond).
// A coarser step can skip right past the true best alignment for shapes
// with a few sharp, widely-spaced features (stars, hub-and-spoke symbols),
// producing a spuriously low score even for an accurate trace.
export const CLOSED_SHAPE_OFFSET_STEP = 1;
export const CLOSED_SHAPE_CLOSURE_THRESHOLD = 0.15;

export const SCORE_WEIGHTS = {
  shapeMatch: 0.7,
  coverage: 0.05,
  smoothness: 0.05,
  scale: 0.2,
} as const;

// Single source of truth for star thresholds - both the scoring logic and
// the in-app instructions page read from this list, so they can never drift
// out of sync if the thresholds ever change.
export const STAR_RATING_THRESHOLDS = [
  { stars: 5, minScore: 90 },
  { stars: 4, minScore: 80 },
  { stars: 3, minScore: 70 },
  { stars: 2, minScore: 60 },
  { stars: 1, minScore: 50 },
] as const;

export function starRatingForScore(score: number): number {
  for (const { stars, minScore } of STAR_RATING_THRESHOLDS) {
    if (score >= minScore) return stars;
  }
  return 0;
}

// Single source of truth for the four scoring parameters - both the
// instructions page and the result screen's improvement tip read from this
// list, so their wording can never drift out of sync. Listed in the same
// order they're weighted, so the biggest factor for your score comes first.
// If new scoring parameters are ever added to the game, add them here too.
export type ScoreParameterKey = keyof typeof SCORE_WEIGHTS;

export type ScoreParameter = {
  key: ScoreParameterKey;
  name: string;
  description: string;
  tip: string;
};

export const SCORE_PARAMETERS: ScoreParameter[] = [
  {
    key: "shapeMatch",
    name: "Shape",
    description: "How closely your drawing follows the exact outline of the target shape. This is the biggest part of your score.",
    tip: "Trace the shape's curves and corners as precisely as you can.",
  },
  {
    key: "coverage",
    name: "Coverage",
    description: "Whether you drew the whole shape - not stopping partway, and not adding extra strokes beyond it.",
    tip: "Complete the full outline in one drawing, without leaving parts out.",
  },
  {
    key: "smoothness",
    name: "Smoothness",
    description: "How steady and calm your strokes are, instead of shaky and jittery.",
    tip: "Draw with smooth, flowing motions rather than short jerky ones. Retracing a line on purpose (like the two crossing lines of an X) is expected and won't hurt this score.",
  },
  {
    key: "scale",
    name: "Scale",
    description: "Whether your drawing came out about the same size as the shape shown.",
    tip: "Try to fill a similar amount of the drawing area - not much smaller or bigger than the target.",
  },
];

const FIVE_STAR_MIN_SCORE = STAR_RATING_THRESHOLDS[0].minScore;

/** Picks the tip for whichever scored parameter is weakest, so the player knows what to focus on next. Returns undefined once a score already reaches 5 stars - there's nothing to improve. */
export function improvementTip(score: {
  total: number;
  shapeMatch: number;
  coverage: number;
  smoothness: number;
  scale: number;
}): string | undefined {
  if (score.total >= FIVE_STAR_MIN_SCORE) return undefined;
  const weakest = SCORE_PARAMETERS.reduce((worst, param) => (score[param.key] < score[worst.key] ? param : worst));
  return weakest.tip;
}

export function scoreMessage(total: number): string {
  if (total >= 95) return "Incredible";
  if (total >= 85) return "Excellent";
  if (total >= 70) return "Nice work";
  if (total >= 50) return "Getting close";
  return "Try again";
}

export const CELEBRATION_MESSAGES = [
  "Great job!",
  "Well done!",
  "Fantastic!",
  "Amazing!",
  "You nailed it!",
  "Awesome work!",
  "Way to go!",
] as const;

export function randomCelebrationMessage(): string {
  return CELEBRATION_MESSAGES[Math.floor(Math.random() * CELEBRATION_MESSAGES.length)];
}

export const ENCOURAGEMENT_MESSAGES = [
  "Not bad!",
  "Try again!",
  "You'll get it next time!",
  "So close!",
  "Keep going!",
  "Almost there!",
] as const;

export function randomEncouragementMessage(): string {
  return ENCOURAGEMENT_MESSAGES[Math.floor(Math.random() * ENCOURAGEMENT_MESSAGES.length)];
}

export const ACHIEVEMENT_UNLOCK_MESSAGES = [
  "Incredible!",
  "Legendary!",
  "You're unstoppable!",
  "Outstanding!",
  "Phenomenal!",
] as const;

export function randomAchievementUnlockMessage(): string {
  return ACHIEVEMENT_UNLOCK_MESSAGES[Math.floor(Math.random() * ACHIEVEMENT_UNLOCK_MESSAGES.length)];
}

export function journeyRankForPercent(percent: number): string {
  if (percent >= 81) return "Master";
  if (percent >= 61) return "Expert";
  if (percent >= 41) return "Skilled";
  if (percent >= 21) return "Explorer";
  return "Beginner";
}

export const COIN_NAME = "CYDI Coin";

export const SHAPE_CHALLENGE_COIN_REWARDS: Record<number, number> = {
  0: 0,
  1: 10,
  2: 20,
  3: 35,
  4: 55,
  5: 80,
};

export function coinsForStars(stars: number): number {
  return SHAPE_CHALLENGE_COIN_REWARDS[stars] ?? 0;
}

/** Coin cost to unlock a Shape Challenge category beyond the first (which is always free). Change this single value to retune pricing. */
export const CATEGORY_UNLOCK_COST = 1000;

export type DifficultyLevel = "beginner" | "intermediate" | "skilled" | "expert" | "master";

export const DIFFICULTY_LEVELS: { id: DifficultyLevel; icon: string; name: string; passScore: number }[] = [
  { id: "beginner", icon: "🌱", name: "Beginner", passScore: 50 },
  { id: "intermediate", icon: "🎯", name: "Intermediate", passScore: 60 },
  { id: "skilled", icon: "⭐", name: "Skilled", passScore: 70 },
  { id: "expert", icon: "🔥", name: "Expert", passScore: 80 },
  { id: "master", icon: "👑", name: "Master", passScore: 90 },
];

export const DEFAULT_DIFFICULTY: DifficultyLevel = "skilled";

export function passScoreForDifficulty(level: DifficultyLevel): number {
  return DIFFICULTY_LEVELS.find((d) => d.id === level)?.passScore ?? SHAPE_CHALLENGE_PASS_SCORE;
}

export type PenColorId = "black" | "purple" | "green" | "orange" | "rainbow";

export type PenColorOption = {
  id: PenColorId;
  name: string;
  icon: string;
  /** Fixed stroke color; omitted for "rainbow", which cycles hue while drawing instead. */
  hex?: string;
  /** Coin price to unlock in the shop; omitted for the free default. */
  price?: number;
};

export const DEFAULT_PEN_COLOR: PenColorId = "black";

export const PEN_COLORS: PenColorOption[] = [
  { id: "black", name: "Black", icon: "⚫", hex: "#1e202e" },
  { id: "purple", name: "Purple Pen", icon: "🟣", hex: "#8b5cf6", price: 1000 },
  { id: "green", name: "Green Pen", icon: "🟢", hex: "#16a34a", price: 1000 },
  { id: "orange", name: "Orange Pen", icon: "🟠", hex: "#f97316", price: 1000 },
  { id: "rainbow", name: "Rainbow Pen", icon: "🌈", price: 10000 },
];

export function penColorById(id: PenColorId): PenColorOption {
  return PEN_COLORS.find((c) => c.id === id) ?? PEN_COLORS[0];
}

/** CSS `background` value that visually matches a pen color's ink - a solid hex for normal colors, a gradient swatch for "rainbow" (which has no single fixed color). Used anywhere a UI element needs to preview the player's actual pen color, like the result screen's drawing legend. */
export function penColorCssBackground(id: PenColorId): string {
  if (id === "rainbow") return "linear-gradient(90deg, #f43f5e, #f59e0b, #22c55e, #3b82f6, #a855f7)";
  return penColorById(id).hex ?? "#1e202e";
}
