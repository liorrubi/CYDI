// 0.59.0 daily goal: finish DAILY_GOAL_GAMES Classic games on one local calendar day -> DAILY_GOAL_COINS, once a day.
// Optional and independent of the Daily Drawing Streak (it never advances, protects or breaks it). Counts completed,
// scored, non-practice Shape Challenge rounds - the same games the Classic coin offer and the interstitial count -
// but it never shows, inserts or forces an ad; it only rewards playing on.

import { DAILY_GOAL_COINS, DAILY_GOAL_GAMES } from "../app/constants";
import { addCoins } from "./coinsStore";
import { getSaveData, updateSaveData } from "./saveStore";

function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type DailyGoalView = { games: number; target: number; claimed: boolean };

/** Today's progress (a stored day other than today reads as a fresh 0/5). */
export function getDailyGoal(): DailyGoalView {
  const date = todayDateString();
  const stored = getSaveData().progress.dailyGoal;
  if (!stored || stored.date !== date) return { games: 0, target: DAILY_GOAL_GAMES, claimed: false };
  return { games: Math.max(0, Number(stored.games) || 0), target: DAILY_GOAL_GAMES, claimed: stored.claimed === true };
}

/**
 * One Classic game was completed. Returns today's progress and whether THIS game completed the goal (and paid).
 * The claimed flag is written in the same save update as the count, before the coins, so the bonus can be paid at
 * most once per day - however many games follow, or if the app is closed right after.
 */
export function recordDailyGoalGame(): DailyGoalView & { justCompleted: boolean } {
  const date = todayDateString();
  const current = getDailyGoal();
  const games = current.games + 1;
  const justCompleted = !current.claimed && games >= DAILY_GOAL_GAMES;
  updateSaveData((data) => {
    data.progress.dailyGoal = { date, games, claimed: current.claimed || justCompleted };
  });
  if (justCompleted) addCoins(DAILY_GOAL_COINS, "daily_goal");
  return { games, target: DAILY_GOAL_GAMES, claimed: current.claimed || justCompleted, justCompleted };
}
