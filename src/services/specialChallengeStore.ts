import { getSaveData, updateSaveData } from "./saveStore";

export function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function canPlaySpecialChallengeFree(): boolean {
  return getSaveData().progress.specialChallenge?.lastFreeDate !== todayDateString();
}

export function markSpecialChallengeFreeUsed(): void {
  updateSaveData((data) => {
    data.progress.specialChallenge.lastFreeDate = todayDateString();
  });
}

/** Saves written before per-shape best-score tracking shipped have no `specialChallenge.bestScores` field at all (loading doesn't merge in new defaults), so every read/write normalizes with a fallback. */
export function getSpecialChallengeBestScore(shapeId: string): number | undefined {
  return (getSaveData().progress.specialChallenge.bestScores ?? {})[shapeId];
}

/** Records `score` as the new best for `shapeId` if it beats the stored best - a no-op otherwise. */
export function recordSpecialChallengeScore(shapeId: string, score: number): void {
  updateSaveData((data) => {
    const bestScores = data.progress.specialChallenge.bestScores ?? {};
    if (bestScores[shapeId] === undefined || score > bestScores[shapeId]) {
      bestScores[shapeId] = score;
    }
    data.progress.specialChallenge.bestScores = bestScores;
  });
}

/** Deterministic pick from a shape pool, keyed by local calendar date - same shape for every player on a given day, rotating at local midnight. */
export function pickDailyShapeId(poolIds: string[]): string {
  const date = todayDateString();
  let hash = 0;
  for (let i = 0; i < date.length; i++) hash = (hash * 31 + date.charCodeAt(i)) | 0;
  return poolIds[Math.abs(hash) % poolIds.length];
}

/** Milliseconds until the next local midnight - used to drive the "new shape in HH:MM" countdown. */
export function msUntilNextLocalMidnight(): number {
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return nextMidnight.getTime() - now.getTime();
}
