import { SHAPE_CHALLENGE_STORAGE_KEY } from "../app/constants";

export type ShapeChallengeProgress = {
  levelIndexByCategory: Record<string, number>;
  bestScores: Record<string, number>;
};

const DEFAULT_PROGRESS: ShapeChallengeProgress = { levelIndexByCategory: {}, bestScores: {} };

/** Old (pre-categories) save format: a single flat levelIndex, implicitly for the "geometric" category. */
type LegacyProgress = { levelIndex: number; bestScores: Record<string, number> };

function isLegacyProgress(value: Record<string, unknown>): value is LegacyProgress {
  return typeof value.levelIndex === "number" && typeof value.bestScores === "object" && value.bestScores !== null;
}

function isCurrentProgress(value: Record<string, unknown>): value is ShapeChallengeProgress {
  return (
    typeof value.levelIndexByCategory === "object" &&
    value.levelIndexByCategory !== null &&
    typeof value.bestScores === "object" &&
    value.bestScores !== null
  );
}

function parseProgress(value: unknown): ShapeChallengeProgress {
  if (typeof value !== "object" || value === null) return DEFAULT_PROGRESS;
  const record = value as Record<string, unknown>;

  if (isCurrentProgress(record)) return record;
  if (isLegacyProgress(record)) {
    return { levelIndexByCategory: { geometric: record.levelIndex }, bestScores: record.bestScores };
  }
  return DEFAULT_PROGRESS;
}

export function getProgress(): ShapeChallengeProgress {
  let raw: string | null;
  try {
    raw = localStorage.getItem(SHAPE_CHALLENGE_STORAGE_KEY);
  } catch {
    return DEFAULT_PROGRESS;
  }
  if (!raw) return DEFAULT_PROGRESS;

  try {
    return parseProgress(JSON.parse(raw));
  } catch {
    return DEFAULT_PROGRESS;
  }
}

export function saveProgress(progress: ShapeChallengeProgress): void {
  try {
    localStorage.setItem(SHAPE_CHALLENGE_STORAGE_KEY, JSON.stringify(progress));
  } catch (error) {
    console.warn("Failed to persist shape challenge progress", error);
  }
}

export function clearProgress(): ShapeChallengeProgress {
  saveProgress(DEFAULT_PROGRESS);
  return DEFAULT_PROGRESS;
}

export function getCategoryLevelIndex(progress: ShapeChallengeProgress, category: string): number {
  return progress.levelIndexByCategory[category] ?? 0;
}
