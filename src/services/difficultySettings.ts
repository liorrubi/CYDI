import { DEFAULT_DIFFICULTY, DIFFICULTY_LEVELS, type DifficultyLevel } from "../app/constants";
import { getSaveData, updateSaveData } from "./saveStore";

function isDifficultyLevel(value: unknown): value is DifficultyLevel {
  return DIFFICULTY_LEVELS.some((d) => d.id === value);
}

export function getDifficulty(): DifficultyLevel {
  const value = getSaveData().settings.difficulty;
  return isDifficultyLevel(value) ? value : DEFAULT_DIFFICULTY;
}

export function setDifficulty(level: DifficultyLevel): void {
  updateSaveData((data) => {
    data.settings.difficulty = level;
  });
}
