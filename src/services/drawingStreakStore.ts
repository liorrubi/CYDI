// 0.59.0 Daily Drawing Streak - storage and side effects around the pure rules in app/drawingStreak.ts.
// Lives in the save (progress.drawingStreak, optional - older saves normalize to an empty streak), so it travels
// with Backup & Transfer like every other progress. The visit streak (dailyStreakStore.ts) and its achievements
// are untouched: this is a separate counter for completing the Daily Challenge.

import { STREAK_EXCLUSIVE_INK } from "../app/constants";
import { israelDateKey } from "../app/israelDate";
import {
  applyStreakRescue,
  completeStreakDay,
  normalizeStreak,
  rescuableStreak,
  STREAK_SAVE_MAX,
  STREAK_SAVE_PRICE,
  viewStreak,
  type StreakCompletion,
  type StreakState,
  type StreakView,
} from "../app/drawingStreak";
import { addCoins, getCoins, spendCoins } from "./coinsStore";
import { onStreakDayReached } from "./economyAnalytics";
import { unlockColor } from "./penColorStore";
import { getSaveData, updateSaveData } from "./saveStore";

const STREAK_UPDATED_EVENT = "cydi:streak-updated";

function today(now: number): string {
  return israelDateKey(now);
}

export function getStreakState(): StreakState {
  return normalizeStreak(getSaveData().progress.drawingStreak);
}

function writeState(state: StreakState): void {
  updateSaveData((data) => {
    data.progress.drawingStreak = { ...state };
  });
  try {
    window.dispatchEvent(new Event(STREAK_UPDATED_EVENT));
  } catch {
    /* no window (tests) */
  }
}

/** The streak as it stands right now (read-only). */
export function getStreakView(now: number = Date.now()): StreakView {
  return viewStreak(getStreakState(), today(now));
}

/**
 * A live Daily Challenge attempt was completed and scored. Advances the streak once per day (a retry the same day is
 * a no-op), pays the day's coins, grants the Day-30 Ember Ink once, and reports a first-time 3/7/30 milestone.
 * The state is written BEFORE the coins are credited, so a crash in between can never pay the same day twice.
 */
export function recordDailyCompletion(now: number = Date.now()): StreakCompletion {
  const result = completeStreakDay(getStreakState(), today(now));
  if (!result.advanced) return result;
  writeState(result.state);
  if (result.emberUnlocked) unlockColor(STREAK_EXCLUSIVE_INK);
  if (result.coins > 0) addCoins(result.coins, "daily_streak");
  onStreakDayReached(result.day);
  return result;
}

/** A Rewarded Streak Rescue on offer right now (see app/drawingStreak.ts): the streak it keeps and its Israel day, or null. */
export function getStreakRescueOffer(now: number = Date.now()): { from: number; day: string } | null {
  const day = today(now);
  const from = rescuableStreak(getStreakState(), day);
  return from > 0 ? { from, day } : null;
}

/**
 * A rewarded ad for the rescue offered on `offerDay` was watched to the end (call ONLY on a verified grant). Restores
 * the streak, pays nothing. Idempotent: the offer is used up by the write, so a repeated grant changes nothing.
 * `offerDay` is the day the offer was shown, so an ad that ends just after midnight still keeps the streak.
 */
export function grantStreakRescue(offerDay: string): boolean {
  const next = applyStreakRescue(getStreakState(), offerDay);
  if (!next) return false;
  writeState(next);
  onStreakDayReached(next.current);
  return true;
}

export type BuySaveResult = "bought" | "full" | "insufficient_coins";

/** Buy one Streak Save for STREAK_SAVE_PRICE coins (at most STREAK_SAVE_MAX held). Never spends unless it succeeds. */
export function buyStreakSave(): BuySaveResult {
  const state = getStreakState();
  if (state.saves >= STREAK_SAVE_MAX) return "full";
  if (getCoins() < STREAK_SAVE_PRICE) return "insufficient_coins";
  spendCoins(STREAK_SAVE_PRICE, "streak_save");
  writeState({ ...state, saves: state.saves + 1 });
  return "bought";
}

/** Re-render hook: fires after every streak write (a completion or a bought Save). */
export function onStreakChanged(listener: () => void): () => void {
  window.addEventListener(STREAK_UPDATED_EVENT, listener);
  return () => window.removeEventListener(STREAK_UPDATED_EVENT, listener);
}
