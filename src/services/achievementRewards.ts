// The one place achievements are paid (Classic's result and launch checks, and - since 0.59.0 - the Drawing Streak in
// every mode). An achievement is paid exactly once: the id list in the save (achievementsStore) is written before its
// coins, and an id already there is never paid again, whoever asks.

import { computeAchievementStats, findNewlyUnlockedAchievements, STREAK_ACHIEVEMENT_IDS, type Achievement } from "../app/achievements";
import { getUnlockedAchievementIds, markAchievementUnlocked } from "./achievementsStore";
import { addCoins, addCoinsPending } from "./coinsStore";
import { unlockCardsForAchievements } from "./megaChallengeStore";
import { getProgress, type ShapeChallengeProgress } from "./shapeChallengeProgress";

/**
 * Marks every achievement the player now qualifies for but has not been paid, and credits its coins. `pending` holds
 * the coin counter back for a "tap to collect" reveal (Classic's banner); otherwise the counter animates at once.
 */
export function bankNewAchievements(
  progress: ShapeChallengeProgress = getProgress(),
  opts: { pending?: boolean; only?: (achievement: Achievement) => boolean } = {},
): Achievement[] {
  const stats = computeAchievementStats(progress);
  const newlyUnlocked = findNewlyUnlockedAchievements(stats, getUnlockedAchievementIds()).filter(opts.only ?? (() => true));
  for (const achievement of newlyUnlocked) {
    markAchievementUnlocked(achievement.id);
    if (opts.pending) addCoinsPending(achievement.coinReward, "achievement");
    else addCoins(achievement.coinReward, "achievement");
  }
  return newlyUnlocked;
}

/** What a Drawing Streak day (or Rescue) paid besides the streak itself - listed on the same celebration. */
export type StreakAchievementRewards = {
  achievements: { id: string; title: string; coins: number }[];
  megaCards: { id: string; name: string }[];
};

/**
 * Pays the streak achievements (3/7/14/30/100 days) that the Drawing Streak itself - its best, `drawingBest` - now
 * reaches: immediately, in whatever mode the day counted, with their Mega cards. Only those: an achievement owed
 * from the frozen pre-0.59 visit record is not a Drawing Streak moment and stays with Classic's launch check (as in
 * 0.58), and the other achievements keep being paid where they are earned, with their own celebration.
 */
export function bankStreakAchievements(drawingBest: number): StreakAchievementRewards {
  const paid = bankNewAchievements(getProgress(), { only: (a) => STREAK_ACHIEVEMENT_IDS.includes(a.id) && a.target <= drawingBest });
  const cards = unlockCardsForAchievements(paid.map((a) => a.id));
  return {
    achievements: paid.map((a) => ({ id: a.id, title: a.name, coins: a.coinReward })),
    megaCards: cards.map((card) => ({ id: card.id, name: card.name })),
  };
}
