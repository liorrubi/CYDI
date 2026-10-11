import { getSaveData } from "./saveStore";

// 0.59.0: the old visit streak (a day counted by just opening the app) is RETIRED - the Drawing Streak
// (drawingStreakStore.ts) is the only streak. Nothing writes `progress.dailyStreak` any more, so the value a player
// brought into 0.59.0 stays exactly as it was: a frozen, read-only record. It has one use - the floor of the streak
// achievements' progress (app/achievements.ts), so nobody's progress ever goes backwards. It never counts as
// Drawing Streak days and never pays coins, Saves or a Rescue.

/** The best visit streak reached before 0.59.0 (0 for a new player or a malformed save). Read-only. */
export function getLegacyVisitStreakBest(): number {
  const best = Number(getSaveData().progress.dailyStreak?.longestStreak);
  return Number.isFinite(best) && best > 0 ? Math.floor(best) : 0;
}
