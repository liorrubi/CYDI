import { SHAPE_CHALLENGE_STORAGE_KEY } from "../app/constants";

export type ShapeChallengeProgress = {
  levelIndex: number;
  bestScores: Record<string, number>;
};

const DEFAULT_PROGRESS: ShapeChallengeProgress = { levelIndex: 0, bestScores: {} };

function isProgress(value: unknown): value is ShapeChallengeProgress {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return typeof p.levelIndex === "number" && typeof p.bestScores === "object" && p.bestScores !== null;
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
    const parsed: unknown = JSON.parse(raw);
    return isProgress(parsed) ? parsed : DEFAULT_PROGRESS;
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
