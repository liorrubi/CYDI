import { getSaveData, updateSaveData } from "./saveStore";

export type ShapeChallengeProgress = {
  levelIndexByCategory: Record<string, number>;
  bestScores: Record<string, number>;
};

export function getProgress(): ShapeChallengeProgress {
  return getSaveData().progress.shapeChallenge;
}

export function saveProgress(progress: ShapeChallengeProgress): void {
  updateSaveData((data) => {
    data.progress.shapeChallenge = progress;
  });
}

export function clearProgress(): ShapeChallengeProgress {
  const empty: ShapeChallengeProgress = { levelIndexByCategory: {}, bestScores: {} };
  saveProgress(empty);
  return empty;
}

export function getCategoryLevelIndex(progress: ShapeChallengeProgress, category: string): number {
  return progress.levelIndexByCategory[category] ?? 0;
}
