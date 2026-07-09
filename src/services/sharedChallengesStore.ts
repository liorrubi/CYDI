import { getSaveData, updateSaveData } from "./saveStore";

export function getSharedChallengesCount(): number {
  // Optional chaining guards saves persisted before this field existed.
  return getSaveData().progress.sharedChallengeIds?.length ?? 0;
}

/** Records a challenge as shared, keyed by challenge id so re-sharing (or re-clicking Share on) the same challenge repeatedly never counts more than once toward the sharing achievements. */
export function recordChallengeShared(challengeId: string): void {
  updateSaveData((data) => {
    const ids = data.progress.sharedChallengeIds ?? [];
    if (!ids.includes(challengeId)) data.progress.sharedChallengeIds = [...ids, challengeId];
  });
}
