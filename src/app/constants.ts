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

export const CLOSED_SHAPE_OFFSET_STEP = 8;
export const CLOSED_SHAPE_CLOSURE_THRESHOLD = 0.15;

export const SCORE_WEIGHTS = {
  shapeMatch: 0.85,
  coverage: 0.08,
  smoothness: 0.04,
  scale: 0.03,
} as const;

export function starRatingForScore(score: number): number {
  if (score >= 95) return 5;
  if (score >= 90) return 4;
  if (score >= 80) return 3;
  if (score >= 70) return 2;
  if (score >= 60) return 1;
  return 0;
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
