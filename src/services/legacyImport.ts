import { SHAPE_CHALLENGE_STORAGE_KEY, STORAGE_KEY as CHALLENGES_KEY } from "../app/constants";
import { createDefaultSaveData, type SaveData } from "./saveData";

const LEGACY_KEYS = {
  coins: "cydi.coins.v1",
  shapeChallenge: SHAPE_CHALLENGE_STORAGE_KEY,
  achievements: "cydi.achievements.v1",
  unlockedCategories: "cydi.unlockedCategories.v1",
  unlockedPenColors: "cydi.unlockedPenColors.v1",
  selectedPenColor: "cydi.selectedPenColor.v1",
  difficulty: "cydi.difficulty.v1",
  soundEnabled: "cydi.soundEnabled.v1",
  dailyStreak: "cydi.dailyStreak.v1",
  completedRounds: "cydi.completedRounds.v1",
  achievementsTutorialShown: "cydi.achievementsTutorialShown.v1",
  challenges: CHALLENGES_KEY,
} as const;

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readJson<T>(key: string, fallback: T): T {
  const raw = readRaw(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * One-time upgrade path from the pre-unification per-feature localStorage keys into a
 * single SaveData blob. The legacy keys are left untouched on disk (never deleted), so
 * this can be safely re-derived and existing players never see their progress reset.
 */
export function importLegacySaveData(): SaveData {
  const data = createDefaultSaveData();

  const coinsRaw = readRaw(LEGACY_KEYS.coins);
  if (coinsRaw !== null) {
    const coins = Number(coinsRaw);
    if (Number.isFinite(coins)) data.progress.coins = coins;
  }

  // Mirrors the pre-categories upgrade this store already performed: a flat
  // `levelIndex` (no categories yet) becomes the "geometric" category's index.
  const rawShapeChallenge = readJson<Record<string, unknown> | null>(LEGACY_KEYS.shapeChallenge, null);
  if (rawShapeChallenge) {
    if (typeof rawShapeChallenge.levelIndexByCategory === "object" && rawShapeChallenge.levelIndexByCategory !== null) {
      data.progress.shapeChallenge.levelIndexByCategory = rawShapeChallenge.levelIndexByCategory as Record<string, number>;
    } else if (typeof rawShapeChallenge.levelIndex === "number") {
      data.progress.shapeChallenge.levelIndexByCategory = { geometric: rawShapeChallenge.levelIndex };
    }
    if (typeof rawShapeChallenge.bestScores === "object" && rawShapeChallenge.bestScores !== null) {
      data.progress.shapeChallenge.bestScores = rawShapeChallenge.bestScores as Record<string, number>;
    }
  }

  const achievements = readJson<unknown>(LEGACY_KEYS.achievements, []);
  if (Array.isArray(achievements)) {
    data.progress.achievements = achievements.filter((id): id is string => typeof id === "string");
  }

  const unlockedCategories = readJson<unknown>(LEGACY_KEYS.unlockedCategories, []);
  if (Array.isArray(unlockedCategories)) data.progress.unlockedCategories = unlockedCategories as string[];

  const unlockedPenColors = readJson<unknown>(LEGACY_KEYS.unlockedPenColors, []);
  if (Array.isArray(unlockedPenColors)) {
    data.progress.unlockedPenColors = unlockedPenColors as SaveData["progress"]["unlockedPenColors"];
  }

  const selectedPenColor = readRaw(LEGACY_KEYS.selectedPenColor);
  if (selectedPenColor) data.settings.selectedPenColor = selectedPenColor as SaveData["settings"]["selectedPenColor"];

  const difficulty = readRaw(LEGACY_KEYS.difficulty);
  if (difficulty) data.settings.difficulty = difficulty as SaveData["settings"]["difficulty"];

  const soundEnabled = readRaw(LEGACY_KEYS.soundEnabled);
  if (soundEnabled !== null) data.settings.soundEnabled = soundEnabled === "true";

  const dailyStreak = readJson<Record<string, unknown> | null>(LEGACY_KEYS.dailyStreak, null);
  if (
    dailyStreak &&
    typeof dailyStreak.lastVisitDate === "string" &&
    typeof dailyStreak.currentStreak === "number" &&
    typeof dailyStreak.longestStreak === "number"
  ) {
    data.progress.dailyStreak = {
      lastVisitDate: dailyStreak.lastVisitDate,
      currentStreak: dailyStreak.currentStreak,
      longestStreak: dailyStreak.longestStreak,
    };
  }

  const completedRounds = readRaw(LEGACY_KEYS.completedRounds);
  if (completedRounds !== null) {
    const n = Number(completedRounds);
    if (Number.isFinite(n)) data.progress.completedRounds = n;
  }

  data.progress.achievementsTutorialShown = readRaw(LEGACY_KEYS.achievementsTutorialShown) === "1";

  const challenges = readJson<unknown>(LEGACY_KEYS.challenges, []);
  if (Array.isArray(challenges)) data.progress.challenges = challenges as SaveData["progress"]["challenges"];

  return data;
}
