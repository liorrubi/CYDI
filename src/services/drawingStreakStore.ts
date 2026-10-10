// 0.59.0 Drawing Streak - storage and side effects around the pure rules in app/drawingStreak.ts.
// Lives in the save (progress.drawingStreak, optional - older saves normalize to an empty streak), so it travels
// with Backup & Transfer like every other progress. The visit streak (dailyStreakStore.ts) and its achievements
// are untouched: this is a separate counter for days with real play (5 finished drawings, any mix of modes).

import { STREAK_EXCLUSIVE_INK } from "../app/constants";
import { israelDateKey } from "../app/israelDate";
import {
  addStreakActivity,
  applyStreakRescue,
  normalizeStreak,
  rescuableStreak,
  STREAK_DAY_DRAWINGS,
  STREAK_SAVE_MAX,
  STREAK_SAVE_PRICE,
  streakDayBucket,
  viewStreak,
  type StreakCompletion,
  type StreakState,
  type StreakView,
} from "../app/drawingStreak";
import { addCoins, getCoins, spendCoins } from "./coinsStore";
import { onStreakDayReached } from "./economyAnalytics";
import type { StreakRoute } from "./economyBuckets";
import { unlockColor } from "./penColorStore";
import { getSaveData, updateSaveData } from "./saveStore";

const STREAK_UPDATED_EVENT = "cydi:streak-updated";
const STREAK_DAY_EVENT = "cydi:streak-day";
const STREAK_PROGRESS_EVENT = "cydi:streak-progress";

/** A day was just completed (once): what it paid, the play that completed it, and the balance / Saves after it. */
export type StreakDayEventDetail = { completion: StreakCompletion; route: StreakRoute; balance: number; saves: number };
/** A drawing counted toward a day that has not counted yet (1-4 of 5). */
export type StreakProgressEventDetail = { drawings: number; target: number; route: StreakRoute };

function today(now: number): string {
  return israelDateKey(now);
}

export function getStreakState(): StreakState {
  return normalizeStreak(getSaveData().progress.drawingStreak);
}

function emit(name: string, detail?: unknown): void {
  try {
    window.dispatchEvent(detail === undefined ? new Event(name) : new CustomEvent(name, { detail }));
  } catch {
    /* no window (tests) */
  }
}

function writeState(state: StreakState): void {
  updateSaveData((data) => {
    data.progress.drawingStreak = { ...state };
  });
  emit(STREAK_UPDATED_EVENT);
}

/** The streak as it stands right now (read-only). */
export function getStreakView(now: number = Date.now()): StreakView {
  return viewStreak(getStreakState(), today(now));
}

export type StreakActivityResult = { completion: StreakCompletion | null; drawings: number; duplicate: boolean };

/**
 * One drawing was finished, in any mode - each counts exactly one. Counts toward today and, on the 5th, completes the
 * day ONCE: pays the day's coins (coin_earned daily_streak, with the day bucket and `route`), grants the Day-30 Ember
 * Ink once, and reports a first-time 3/7/30 milestone. `key` identifies a round that can be reported twice (a
 * Multiplayer reconnect, a remount): a key already counted today changes nothing.
 * The state is written BEFORE the coins are credited, so a crash in between can never pay the same day twice.
 */
export function recordStreakActivity(route: StreakRoute, opts: { key?: string; now?: number } = {}): StreakActivityResult {
  const day = today(opts.now ?? Date.now());
  const before = getStreakState();
  const result = addStreakActivity(before, day, opts.key);
  if (result.duplicate) return { completion: null, drawings: result.drawings, duplicate: true };
  writeState(result.state);
  const c = result.completion;
  if (!c) {
    // Progress toward a day that has not counted yet (nothing to say once today counts).
    if (!viewStreak(before, day).doneToday) {
      emit(STREAK_PROGRESS_EVENT, { drawings: result.drawings, target: STREAK_DAY_DRAWINGS, route } satisfies StreakProgressEventDetail);
    }
    return { completion: null, drawings: result.drawings, duplicate: false };
  }
  if (c.emberUnlocked) unlockColor(STREAK_EXCLUSIVE_INK);
  const balance = c.coins > 0 ? addCoins(c.coins, "daily_streak", { streakDay: streakDayBucket(c.day), streakRoute: route }) : getCoins();
  onStreakDayReached(c.day);
  emit(STREAK_DAY_EVENT, { completion: c, route, balance, saves: c.state.saves } satisfies StreakDayEventDetail);
  return { completion: c, drawings: result.drawings, duplicate: false };
}

/** A Rewarded Streak Rescue on offer right now (see app/drawingStreak.ts): the streak it keeps and its Israel day, or null. */
export function getStreakRescueOffer(now: number = Date.now()): { from: number; day: string } | null {
  const day = today(now);
  const from = rescuableStreak(getStreakState(), day);
  return from > 0 ? { from, day } : null;
}

/**
 * A rewarded ad for the rescue offered on `offerDay` was watched to the end (call ONLY on a verified grant). Keeps
 * the streak, pays nothing. Idempotent: the offer is used up by the write, so a repeated grant changes nothing.
 * `offerDay` is the day the offer was shown, so an ad that ends just after midnight still keeps the streak.
 */
export function grantStreakRescue(offerDay: string, now: number = Date.now()): boolean {
  const before = getStreakState();
  const next = applyStreakRescue(before, offerDay, today(now));
  if (!next) return false;
  writeState(next);
  if (next.current !== before.current) onStreakDayReached(next.current);
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

/** Re-render hook: fires after every streak write (progress, a completed day, a rescue or a bought Save). */
export function onStreakChanged(listener: () => void): () => void {
  window.addEventListener(STREAK_UPDATED_EVENT, listener);
  return () => window.removeEventListener(STREAK_UPDATED_EVENT, listener);
}

/** Fires for a drawing that counted toward a day not yet complete (1-4 of 5). */
export function onStreakProgress(listener: (detail: StreakProgressEventDetail) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<StreakProgressEventDetail>).detail);
  window.addEventListener(STREAK_PROGRESS_EVENT, handler);
  return () => window.removeEventListener(STREAK_PROGRESS_EVENT, handler);
}

/** Fires once when a day is completed (any mode), with what it paid, the play that completed it and the balance after. */
export function onStreakDayCompleted(listener: (detail: StreakDayEventDetail) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<StreakDayEventDetail>).detail);
  window.addEventListener(STREAK_DAY_EVENT, handler);
  return () => window.removeEventListener(STREAK_DAY_EVENT, handler);
}
