import { DEFAULT_DIFFICULTY, DIFFICULTY_LEVELS, type DifficultyLevel } from "../app/constants";

const STORAGE_KEY = "cydi.difficulty.v1";

function isDifficultyLevel(value: unknown): value is DifficultyLevel {
  return DIFFICULTY_LEVELS.some((d) => d.id === value);
}

export function getDifficulty(): DifficultyLevel {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isDifficultyLevel(raw) ? raw : DEFAULT_DIFFICULTY;
  } catch {
    return DEFAULT_DIFFICULTY;
  }
}

export function setDifficulty(level: DifficultyLevel): void {
  try {
    localStorage.setItem(STORAGE_KEY, level);
  } catch (error) {
    console.warn("Failed to persist difficulty", error);
  }
}
