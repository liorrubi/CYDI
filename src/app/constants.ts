export const APP_NAME = "CYDI - Can You Draw It?";
export const APP_TAGLINE = "Quick drawing challenges";

// Bumped by hand only when a new product version ships - unrelated to SaveData's
// internal schemaVersion, which tracks the save file format, not the game itself.
export const APP_VERSION = "0.17.0";
// Short git commit hash (or a build timestamp fallback), set automatically at build time.
export const APP_BUILD = __APP_BUILD__;
// ISO timestamp of when this build was produced, set automatically at build time - not schemaVersion (save file format) or APP_VERSION (hand-bumped product version).
export const APP_BUILD_TIME = __APP_BUILD_TIME__;

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

export type PenColorId = "black" | "purple" | "green" | "orange" | "rainbow" | "diamondBlue";

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
  { id: "purple", name: "Purple Ink", icon: "🟣", hex: "#8b5cf6", price: 1000 },
  { id: "green", name: "Green Ink", icon: "🟢", hex: "#16a34a", price: 1000 },
  { id: "orange", name: "Orange Ink", icon: "🟠", hex: "#f97316", price: 1000 },
  { id: "rainbow", name: "Rainbow Ink", icon: "🌈", price: 10000 },
  { id: "diamondBlue", name: "Diamond Blue", icon: "💎", hex: "#4fb6ff", price: 15000 },
];

export function penColorById(id: PenColorId): PenColorOption {
  return PEN_COLORS.find((c) => c.id === id) ?? PEN_COLORS[0];
}

/** CSS `background` value that visually matches a pen color's ink - a solid hex for normal colors, a gradient swatch for "rainbow" (which has no single fixed color). Used anywhere a UI element needs to preview the player's actual pen color, like the result screen's drawing legend. */
export function penColorCssBackground(id: PenColorId): string {
  if (id === "rainbow") return "linear-gradient(90deg, #f43f5e, #f59e0b, #22c55e, #3b82f6, #a855f7)";
  return penColorById(id).hex ?? "#1e202e";
}

/** A single solid hex for a pen color's ink, for contexts needing one plain fill color (e.g. an SVG nib tint) rather than a CSS background - "rainbow" has no single hex, so it falls back to a cheerful magenta placeholder. */
export function penInkGlyphColor(id: PenColorId): string {
  if (id === "rainbow") return "#a855f7";
  return penColorById(id).hex ?? "#1e202e";
}

// ==================== DRAWING PENS (cosmetic pen skins) ====================
// Purely cosmetic skins for the pen that follows the pointer while drawing.
// They change ONLY the look of the cosmetic pen overlay - never the stroke
// points, the ink color, or scoring - so no skin can give a gameplay edge.
// Separate axis from PEN_COLORS (which sets the ink color of the drawn line).

export type PenSkinId =
  | "basicPencil"
  | "improvedPencil"
  | "magicPencil"
  | "goldenPencil"
  | "rainbowPencil"
  | "royalQuill"
  | "galaxyPen";

export type PenSkinOption = {
  id: PenSkinId;
  name: string;
  /** Coin price to unlock in the shop; omitted for the free default. */
  price?: number;
};

export const DEFAULT_PEN_SKIN: PenSkinId = "basicPencil";

export const PEN_SKINS: PenSkinOption[] = [
  { id: "basicPencil", name: "Basic Pencil" },
  { id: "improvedPencil", name: "Improved Pencil", price: 1000 },
  { id: "magicPencil", name: "Magic Pencil", price: 2500 },
  { id: "goldenPencil", name: "Golden Pencil", price: 5000 },
  { id: "rainbowPencil", name: "Rainbow Pencil", price: 7500 },
  { id: "royalQuill", name: "Royal Quill", price: 12000 },
  { id: "galaxyPen", name: "Galaxy Pen", price: 20000 },
];

export function penSkinById(id: PenSkinId): PenSkinOption {
  return PEN_SKINS.find((s) => s.id === id) ?? PEN_SKINS[0];
}

export type ChestTierId = "iron" | "copper" | "silver" | "gold" | "platinum";

export type ChestTier = {
  id: ChestTierId;
  name: string;
  /** Rarity label shown as a small badge on the shop card, escalating with the tier. */
  rarity: string;
  price: number;
  rewardMin: number;
  rewardMax: number;
};

export const DAILY_CHEST = { name: "Daily Chest", rewardMin: 50, rewardMax: 150 };

export const CHEST_TIERS: ChestTier[] = [
  { id: "iron", name: "Iron Chest", rarity: "Basic", price: 200, rewardMin: 100, rewardMax: 300 },
  { id: "copper", name: "Copper Chest", rarity: "Common", price: 500, rewardMin: 250, rewardMax: 750 },
  { id: "silver", name: "Silver Chest", rarity: "Rare", price: 1000, rewardMin: 500, rewardMax: 1500 },
  { id: "gold", name: "Gold Chest", rarity: "Epic", price: 2500, rewardMin: 1250, rewardMax: 3750 },
  { id: "platinum", name: "Platinum Chest", rarity: "Legendary", price: 5000, rewardMin: 2500, rewardMax: 7500 },
];

/** Random integer reward in [min, max], inclusive - used for both the daily free chest and purchased chest keys. */
export function rollChestReward(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** After buying a chest tier, that same tier is locked out for this long before it can be bought again. Other tiers are unaffected. */
export const CHEST_PURCHASE_COOLDOWN_MS = 60 * 60 * 1000;

/** How many passed Shape Challenge attempts (score >= passScore) unlock the daily chest / Special Challenge header icons for a new player. */
export const DAILY_CHEST_UNLOCK_COUNT = 5;
export const SPECIAL_CHALLENGE_UNLOCK_COUNT = 20;

export const SPECIAL_CHALLENGE_MIN_SCORE = 60;
export const SPECIAL_CHALLENGE_RETRY_COST = 100;

// ==================== MEGA CHALLENGE ====================

export type MegaRarity = "rare" | "epic" | "legendary";

export const MEGA_RARITY_LABELS: Record<MegaRarity, string> = {
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

/** Coin cost to directly unlock a specific Mega card from the album, by rarity. Deliberately pricier than the same-tier random pull in the shop - choosing exactly the card you want is the premium option. */
export const MEGA_SPECIFIC_UNLOCK_COST: Record<MegaRarity, number> = {
  rare: 2500,
  epic: 4500,
  legendary: 8000,
};

/** One-time coin cost to unlock the whole Mega Challenge feature. Until it's paid, the album is locked and the first card comes free with the unlock. */
export const MEGA_CHALLENGE_UNLOCK_COST = 10000;

/** Shop price for a random locked Mega card of any rarity. */
export const MEGA_RANDOM_CARD_COST = 1500;

/** Shop price for a random locked Mega card of a specific rarity. */
export const MEGA_RANDOM_TIER_COST: Record<MegaRarity, number> = {
  rare: 2000,
  epic: 3500,
  legendary: 6000,
};

/** One-time coin reward for the first passing score on a Mega card, by rarity. */
export const MEGA_COMPLETION_REWARD: Record<MegaRarity, number> = {
  rare: 300,
  epic: 600,
  legendary: 1200,
};

/** A Mega card counts as "Perfect" at the 5-star threshold - same bar as a 5-star rating anywhere else in the game. */
export const MEGA_PERFECT_SCORE = STAR_RATING_THRESHOLDS[0].minScore;

export const CHAMPION_TITLE = "Challenge Champion";

export const CHAMPION_SHARE_TEXT =
  "I completed the full Mega Challenge Album in CYDI and became a Challenge Champion! 👑🏆 Can you complete it too?";

export const SPECIAL_CHALLENGE_COIN_BANDS: { minScore: number; coins: number }[] = [
  { minScore: 95, coins: 1000 },
  { minScore: 90, coins: 700 },
  { minScore: 80, coins: 400 },
  { minScore: 70, coins: 200 },
  { minScore: 60, coins: 100 },
];

/** Coin reward for a Special Challenge score (0 below the minimum qualifying band). */
export function coinsForSpecialChallengeScore(score: number): number {
  for (const band of SPECIAL_CHALLENGE_COIN_BANDS) if (score >= band.minScore) return band.coins;
  return 0;
}
