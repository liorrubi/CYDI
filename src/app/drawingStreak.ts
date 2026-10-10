// 0.59.0 Drawing Streak - the pure rules (no storage, no React, no clock): drawingStreakStore.ts feeds them the
// saved state and today's date.
//
// ONE RULE FOR EVERY MODE. A day counts when the player finishes STREAK_DAY_DRAWINGS (5) drawings in any mode -
// Classic, Special, Mega, Artist Pack, custom challenges, Multiplayer rounds they drew in, 2 Players rounds - OR
// completes the Daily Challenge, which counts the whole day in one drawing (the quick way on a busy day). Opening the
// app counts for nothing. Evidence and the model comparison: reports/2026-10-10-daily-usage-analysis.
//
// THE DAY is the Israel calendar day (israelDateKey) - the Daily Challenge's own clock - so "today's Daily" and
// "today's streak day" can never disagree, whatever the device's time zone.
//
// Rewards (approved schedule, about 1,130 coins per 30 days):
//   D1 20 · D2 30 · D3 50 (+ first Streak Save) · D4-6 20 · D7 100 · D8-13 20 · D14 150 · D15-29 20 · D30 300 (+ Ember Ink, once)
//   after D30: 20 a day, 100 on every 7th day, 300 on every 30th day.
// Streak Saves: one more on D3, D10, D17, D24 ... (every 7 days from D3) while fewer than 2 are held; also bought with
// coins. A missed day uses one Save automatically; with too few Saves the streak starts again at Day 1 - the best
// streak is kept, nothing else is taken away.

import type { StreakDayBucket } from "../services/economyBuckets";

export const STREAK_DAY_COINS = 20;
export const STREAK_SAVE_PRICE = 300;
export const STREAK_SAVE_MAX = 2;
export const STREAK_EMBER_DAY = 30;
/** Drawings that complete a streak day (the Daily Challenge completes it on its own). */
export const STREAK_DAY_DRAWINGS = 5;

/** The milestones the streak view shows, in order (the reward is the day's coins). */
export const STREAK_MILESTONES: readonly { day: number; coins: number; extra?: "save" | "ember" }[] = [
  { day: 1, coins: 20 },
  { day: 3, coins: 50, extra: "save" },
  { day: 7, coins: 100 },
  { day: 14, coins: 150 },
  { day: 30, coins: 300, extra: "ember" },
];

/** Coins paid for reaching streak day `day` (1-based). */
export function streakRewardFor(day: number): number {
  if (!(day >= 1)) return 0;
  if (day === 1) return 20;
  if (day === 2) return 30;
  if (day === 3) return 50;
  if (day === 7) return 100;
  if (day === 14) return 150;
  if (day === 30) return 300;
  if (day > 30) {
    if (day % 30 === 0) return 300;
    if (day % 7 === 0) return 100;
  }
  return STREAK_DAY_COINS;
}

/** A milestone day: larger than an ordinary day, celebrated a little more. */
export function isStreakMilestone(day: number): boolean {
  return streakRewardFor(day) > STREAK_DAY_COINS + 10;
}

/** Does reaching `day` earn a Streak Save (subject to the 2-Save cap)? D3, then every 7 days. */
export function earnsStreakSave(day: number): boolean {
  return day >= 3 && (day - 3) % 7 === 0;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). Calendar arithmetic in UTC, so DST can never skew it. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return Math.round((b - a) / 86_400_000);
}

export type StreakState = {
  lastDay: string;
  current: number;
  best: number;
  saves: number;
  emberGranted: boolean;
  /** A Rewarded Streak Rescue on offer (see below): the streak of `from` days that restarted on `day`. */
  rescue?: { from: number; day: string };
  /** The day the last rescue was granted. */
  rescuedOn?: string;
  /** Drawings finished on `day` (today's progress toward STREAK_DAY_DRAWINGS); another day reads as 0. */
  today?: { day: string; drawings: number };
};

export const EMPTY_STREAK: StreakState = { lastDay: "", current: 0, best: 0, saves: 0, emberGranted: false };

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Any stored value -> a safe state (older saves have none; a hand-edited one could hold anything). */
export function normalizeStreak(value: unknown): StreakState {
  if (!value || typeof value !== "object") return { ...EMPTY_STREAK };
  const v = value as Record<string, unknown>;
  const int = (n: unknown, max: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(0, Math.floor(n))) : 0);
  const lastDay = typeof v.lastDay === "string" && DATE_KEY.test(v.lastDay) ? v.lastDay : "";
  const current = lastDay ? int(v.current, 100_000) : 0;
  const state: StreakState = {
    lastDay,
    current,
    best: Math.max(int(v.best, 100_000), current),
    saves: int(v.saves, STREAK_SAVE_MAX),
    emberGranted: v.emberGranted === true,
  };
  const r = v.rescue as Record<string, unknown> | null | undefined;
  if (r && typeof r === "object" && typeof r.day === "string" && DATE_KEY.test(r.day) && int(r.from, 100_000) >= STREAK_RESCUE_MIN) {
    state.rescue = { from: int(r.from, 100_000), day: r.day };
  }
  if (typeof v.rescuedOn === "string" && DATE_KEY.test(v.rescuedOn)) state.rescuedOn = v.rescuedOn;
  const td = v.today as Record<string, unknown> | null | undefined;
  if (td && typeof td === "object" && typeof td.day === "string" && DATE_KEY.test(td.day)) state.today = { day: td.day, drawings: int(td.drawings, 999) };
  return state;
}

// ---- Rewarded Streak Rescue -------------------------------------------------------------------------------------
// A streak of 3+ days broken by exactly ONE missed day with no Streak Save held (a held Save always covers that day
// first) may be kept by one rewarded ad - only on that return day, at most once per 7 days. Available all day:
//   - BEFORE the day qualifies: the missed day is bridged (lastDay = yesterday), so today's 5 drawings or Daily
//     continue the streak normally (`current + 1`, with that day's own reward);
//   - AFTER the day qualified and restarted it at Day 1 (an offer is stored at the restart): the count is restored to
//     `from + 1`; today's Day-1 coins stay as paid.
// Either way the rescue itself pays no coins, no Save and no Ember. It is shown only in the streak view and on the
// Daily result card, and only when a rewarded ad is loaded - never as a popup, never in front of gameplay.

export const STREAK_RESCUE_MIN = 3;
export const STREAK_RESCUE_COOLDOWN_DAYS = 7;

/** The date `days` after `dateKey` (YYYY-MM-DD, calendar arithmetic in UTC). */
export function addDays(dateKey: string, days: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Exactly one missed day, no Save, 3+ days, outside the 7-day cooldown - judged on `today`. */
function brokenByOneMissedDay(state: StreakState, today: string): boolean {
  if (state.current < STREAK_RESCUE_MIN || state.saves > 0) return false;
  if (daysBetween(state.lastDay, today) !== 2) return false;
  return !state.rescuedOn || daysBetween(state.rescuedOn, today) >= STREAK_RESCUE_COOLDOWN_DAYS;
}

/** The streak (days) that may be rescued on `today` - before the day qualifies or after it restarted - or 0. */
export function rescuableStreak(state: StreakState, today: string): number {
  const r = state.rescue;
  if (r && r.day === today && state.lastDay === today && state.current === 1) return r.from;
  return brokenByOneMissedDay(state, today) ? state.current : 0;
}

/**
 * Grant the rescue offered on `offerDay` (`nowDay` = the day the reward arrived; an ad that ends just after
 * midnight still keeps the streak). The new state, or null when there is nothing to rescue - so a repeated grant
 * is a no-op.
 */
export function applyStreakRescue(state: StreakState, offerDay: string, nowDay: string = offerDay): StreakState | null {
  const from = rescuableStreak(state, offerDay);
  if (from === 0) return null;
  const { rescue: _used, ...rest } = state;
  if (state.rescue && state.lastDay === offerDay && state.current === 1) {
    const current = from + 1;
    return { ...rest, current, best: Math.max(state.best, current), rescuedOn: offerDay };
  }
  // Before today qualified: bridge the missed day; today's activity then continues the streak as usual.
  const day = nowDay > offerDay ? nowDay : offerDay;
  return { ...rest, lastDay: addDays(day, -1), rescuedOn: day };
}

/** Would a streak that restarts on `today` earn a rescue offer? */
function rescueOfferOnRestart(state: StreakState, today: string): StreakState["rescue"] {
  return brokenByOneMissedDay(state, today) ? { from: state.current, day: today } : undefined;
}

export type StreakView = {
  /** The streak as it stands today: the live count, or 0 once it can no longer be continued. */
  current: number;
  best: number;
  saves: number;
  /** Today's Daily already counted. */
  doneToday: boolean;
  /** Missed days that the next completion would cover with Saves (0 normally). */
  savesNeeded: number;
  /** What completing today would pay and reach (null when already done today). */
  next: { day: number; coins: number } | null;
  /** Today's drawings toward STREAK_DAY_DRAWINGS. */
  drawings: number;
  target: number;
  /** A streak that ends unless a Save is added before today counts (missed days beyond the Saves held, at most 2). */
  atRisk: number;
};

/** The streak as seen on `today` - read-only, nothing is used up until the next completion. */
export function viewStreak(state: StreakState, today: string): StreakView {
  const base = { best: state.best, saves: state.saves, drawings: todayDrawings(state, today), target: STREAK_DAY_DRAWINGS, atRisk: 0 };
  if (!state.lastDay || state.current <= 0) return { ...base, current: 0, doneToday: false, savesNeeded: 0, next: { day: 1, coins: streakRewardFor(1) } };
  const gap = daysBetween(state.lastDay, today);
  // Same day - or a clock that went backwards: never a reset, never a second count.
  if (!(gap >= 1)) return { ...base, current: state.current, doneToday: true, savesNeeded: 0, next: null };
  const missed = gap - 1;
  if (missed <= state.saves) {
    const day = state.current + 1;
    return { ...base, current: state.current, doneToday: false, savesNeeded: missed, next: { day, coins: streakRewardFor(day) } };
  }
  const atRisk = missed <= STREAK_SAVE_MAX ? state.current : 0;
  return { ...base, atRisk, current: 0, doneToday: false, savesNeeded: 0, next: { day: 1, coins: streakRewardFor(1) } };
}

/** Today's drawings toward the day (a stored other day reads as 0). */
export function todayDrawings(state: StreakState, today: string): number {
  return state.today && state.today.day === today ? state.today.drawings : 0;
}

export type StreakCompletion = {
  state: StreakState;
  /** False when today's Daily had already counted (a retry): nothing changed, nothing paid. */
  advanced: boolean;
  day: number;
  coins: number;
  savesUsed: number;
  saveEarned: boolean;
  emberUnlocked: boolean;
  /** A streak of this length could not be continued and started again (for gentle copy only). */
  restartedFrom: number;
};

/** `today` qualified (5 drawings or the Daily): the new state and what it paid. Pure. */
export function completeStreakDay(state: StreakState, today: string): StreakCompletion {
  const view = viewStreak(state, today);
  if (view.doneToday) {
    return { state, advanced: false, day: state.current, coins: 0, savesUsed: 0, saveEarned: false, emberUnlocked: false, restartedFrom: 0 };
  }
  const continuing = view.current > 0;
  const day = continuing ? state.current + 1 : 1;
  const savesUsed = continuing ? view.savesNeeded : 0;
  let saves = state.saves - savesUsed;
  const saveEarned = earnsStreakSave(day) && saves < STREAK_SAVE_MAX;
  if (saveEarned) saves += 1;
  const emberUnlocked = day >= STREAK_EMBER_DAY && !state.emberGranted;
  // A restart may come with a rescue offer for today; any older, unused offer is dropped here.
  const rescue = continuing ? undefined : rescueOfferOnRestart(state, today);
  return {
    state: {
      lastDay: today,
      current: day,
      best: Math.max(state.best, day),
      saves,
      emberGranted: state.emberGranted || emberUnlocked,
      ...(rescue ? { rescue } : {}),
      ...(state.rescuedOn ? { rescuedOn: state.rescuedOn } : {}),
      ...(state.today ? { today: state.today } : {}),
    },
    advanced: true,
    day,
    coins: streakRewardFor(day),
    savesUsed,
    saveEarned,
    emberUnlocked,
    restartedFrom: !continuing && state.current > 0 ? state.current : 0,
  };
}

// ---- Activity -----------------------------------------------------------------------------------------------------

/** The streak day as a bounded bucket for analytics (economyBuckets.ts STREAK_DAY_BUCKETS). */
export function streakDayBucket(day: number): StreakDayBucket {
  if (day <= 1) return "1";
  if (day === 2) return "2";
  if (day === 3) return "3";
  if (day <= 6) return "4_6";
  if (day <= 13) return "7_13";
  if (day <= 29) return "14_29";
  return "30_plus";
}

export type StreakActivity = {
  state: StreakState;
  /** The day that this activity completed (null: progress only, or today had already counted). */
  completion: StreakCompletion | null;
  drawings: number;
};

/**
 * One drawing was finished, or the Daily Challenge was completed, on `today`. Counts today's drawings and completes
 * the day on the 5th drawing or on the Daily - once: after that the day is done and nothing more is paid. Pure.
 */
export function addStreakActivity(state: StreakState, today: string, kind: "drawing" | "daily"): StreakActivity {
  const drawings = Math.min(999, todayDrawings(state, today) + (kind === "drawing" ? 1 : 0));
  const withProgress: StreakState = { ...state, today: { day: today, drawings } };
  if (viewStreak(state, today).doneToday) return { state: withProgress, completion: null, drawings };
  if (kind === "daily" || drawings >= STREAK_DAY_DRAWINGS) {
    const completion = completeStreakDay(withProgress, today);
    return { state: completion.state, completion, drawings };
  }
  return { state: withProgress, completion: null, drawings };
}
