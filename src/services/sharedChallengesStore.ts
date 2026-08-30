import { getSaveData, updateSaveData } from "./saveStore";

export function getSharedChallengesCount(): number {
  // Optional chaining guards saves persisted before this field existed.
  return getSaveData().progress.sharedChallengeIds?.length ?? 0;
}

/**
 * Whether this one challenge has ever been shared.
 *
 * A read-only view of the same list the count above reports, added because the
 * 5b Game Hub labels each saved challenge by its shared state. It records
 * nothing and changes no behaviour - `recordChallengeShared` is still the only
 * writer, and the sharing achievements still read the count.
 */
export function isChallengeShared(challengeId: string): boolean {
  return getSaveData().progress.sharedChallengeIds?.includes(challengeId) ?? false;
}

/** Records a challenge as shared, keyed by challenge id so re-sharing (or re-clicking Share on) the same challenge repeatedly never counts more than once toward the sharing achievements. */
export function recordChallengeShared(challengeId: string): void {
  updateSaveData((data) => {
    const ids = data.progress.sharedChallengeIds ?? [];
    if (!ids.includes(challengeId)) data.progress.sharedChallengeIds = [...ids, challengeId];
  });
}
