// 0.59.0 Drawing Streak - the pure rules (no storage, no React, no clock): drawingStreakStore.ts feeds them the
// saved state and today's date.
//
// ONE RULE. A day counts when the player finishes STREAK_DAY_DRAWINGS (5) drawings, in any mix of modes: Classic,
// Daily, Special, Mega, Artist Pack, 2 Players rounds and Multiplayer rounds they actually drew in (custom
// challenges - shared or self-made shapes - do not count). Every finished drawing counts as exactly ONE - no mode
// completes the day on its own or counts double. Opening the app, watching, abandoned rounds and a repeated
// completion event count for nothing (callers pass a key for rounds that can be reported twice). Evidence and the
// model comparison: reports/2026-10-10-daily-usage-analysis.
//
// THE DAY is the Israel calendar day (israelDateKey) - the Daily Challenge's own clock - whatever the device's time
// zone. A clock moved back never resets or double-counts.
//
// Rewards (approved schedule, about 1,130 coins per 30 days):
//   D1 20 · D2 30 · D3 50 (+ first Streak Save) · D4-6 20 · D7 100 · D8-13 20 · D14 150 · D15-29 20 · D30 300 (+ Ember Ink, once)
//   after D30: 20 a day, 100 on every 7th day, 300 on every 30th day.
// Streak Saves: one more on D3, D10, D17, D24 ... (every 7 days from D3) while fewer than 2 are held; also bought with
// coins. A missed day uses one Save automatically once today counts; with too few Saves the streak starts again at
// Day 1 - the best streak is kept, nothing else is taken away.

import type { StreakDayBucket, StreakRoute } from "../services/economyBuckets";

export const STREAK_DAY_COINS = 20;
export const STREAK_SAVE_PRICE = 300;
export const STREAK_SAVE_MAX = 2;
export const STREAK_EMBER_DAY = 30;
/** Finished drawings (any modes) that make a day count. */
export const STREAK_DAY_DRAWINGS = 5;
/** At most this many duplicate-guard keys are kept for one day (rounds are 5-15 per game). */
const MAX_TODAY_KEYS = 60;

/** The days the streak view marks on its track (the reward is that day's coins). Day 1 is the start. */
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

/** A milestone day: larger than an ordinary day (D3, D7, D14, D30, then every 7th / 30th). */
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

/** The date `days` after `dateKey` (YYYY-MM-DD, calendar arithmetic in UTC). */
export function addDays(dateKey: string, days: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export type StreakState = {
  lastDay: string;
  current: number;
  best: number;
  saves: number;
  emberGranted: boolean;
  /** A Rewarded Streak Rescue on offer after a restart (see below): the streak of `from` days that restarted on `day`. */
  rescue?: { from: number; day: string };
  /** The day the last rescue was granted. */
  rescuedOn?: string;
  /** A streak of `from` (2+) days could not be continued and started again on `day` (for honest copy that day). */
  restarted?: { from: number; day: string };
  /** Today's progress: finished drawings on `day`, and the keys of rounds already counted (duplicate guard). */
  today?: { day: string; drawings: number; keys?: string[] };
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
  const rs = v.restarted as Record<string, unknown> | null | undefined;
  if (rs && typeof rs === "object" && typeof rs.day === "string" && DATE_KEY.test(rs.day) && int(rs.from, 100_000) >= 2) {
    state.restarted = { from: int(rs.from, 100_000), day: rs.day };
  }
  const td = v.today as Record<string, unknown> | null | undefined;
  if (td && typeof td === "object" && typeof td.day === "string" && DATE_KEY.test(td.day)) {
    const keys = Array.isArray(td.keys) ? td.keys.filter((k): k is string => typeof k === "string" && k.length <= 80).slice(-MAX_TODAY_KEYS) : [];
    state.today = { day: td.day, drawings: int(td.drawings, 999), ...(keys.length ? { keys } : {}) };
  }
  return state;
}

// ---- Rewarded Streak Rescue -------------------------------------------------------------------------------------
// A streak of 3+ days broken by exactly ONE missed day with no Streak Save held (a held Save always covers that day
// first) may be kept by one rewarded ad - only on that return day, at most once per 7 days. Available all day:
//   - BEFORE the day counts: the missed day is bridged (lastDay = yesterday), so today's 5 drawings continue the
//     streak normally (`current + 1`, with that day's own reward);
//   - AFTER the day counted and restarted it at Day 1 (an offer is stored at the restart): the count is restored to
//     `from + 1`; today's Day-1 coins stay as paid.
// Either way the rescue itself pays no coins, no Save and no Ember. It is shown only in the streak view, and only
// when a rewarded ad is loaded - never as a popup, never in front of gameplay.

export const STREAK_RESCUE_MIN = 3;
export const STREAK_RESCUE_COOLDOWN_DAYS = 7;

/** Exactly one missed day, no Save, 3+ days, outside the 7-day cooldown - judged on `today`. */
function brokenByOneMissedDay(state: StreakState, today: string): boolean {
  if (state.current < STREAK_RESCUE_MIN || state.saves > 0) return false;
  if (daysBetween(state.lastDay, today) !== 2) return false;
  return !state.rescuedOn || daysBetween(state.rescuedOn, today) >= STREAK_RESCUE_COOLDOWN_DAYS;
}

/** The streak (days) that may be rescued on `today` - before the day counts or after it restarted - or 0. */
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
  const { rescue: _used, restarted: _gone, ...rest } = state;
  if (state.rescue && state.lastDay === offerDay && state.current === 1) {
    const current = from + 1;
    return { ...rest, current, best: Math.max(state.best, current), rescuedOn: offerDay };
  }
  // Before today counted: bridge the missed day; today's drawings then continue the streak as usual.
  const day = nowDay > offerDay ? nowDay : offerDay;
  return { ...rest, lastDay: addDays(day, -1), rescuedOn: day };
}

/** Would a streak that restarts on `today` earn a rescue offer? */
function rescueOfferOnRestart(state: StreakState, today: string): StreakState["rescue"] {
  return brokenByOneMissedDay(state, today) ? { from: state.current, day: today } : undefined;
}

// ---- The streak as seen on a day ----------------------------------------------------------------------------------

/**
 * One state for every screen, so no two places can disagree:
 *   new        - never had a streak; today has not counted yet
 *   active     - a live streak; today has not counted yet
 *   protected  - a day was missed, and the Saves held cover it (used once today counts)
 *   at_risk    - a day or two was missed and the Saves held do not cover it: a Save (or, for exactly one day, the
 *                Rescue) can still keep it today - nothing is lost yet
 *   rescued    - kept today by the Rescue; today has not counted yet
 *   lost       - the streak could not be kept (3+ missed days); today will start a new one
 *   done       - today counted
 *   restarted  - today counted as Day 1 of a new streak after a streak of 2+ days ended
 */
export type StreakStatus = "new" | "active" | "protected" | "at_risk" | "rescued" | "lost" | "done" | "restarted";

export type StreakView = {
  status: StreakStatus;
  /** The streak as it stands: the live count (an at-risk or protected streak shows the days it still holds). */
  current: number;
  best: number;
  saves: number;
  doneToday: boolean;
  /** Missed days since the last counted day (0 normally). */
  missed: number;
  /** Saves still needed to keep an at-risk streak (at_risk only). */
  savesShort: number;
  /** What today pays and reaches when it counts (null once it has counted). For at_risk: if the streak is kept. */
  next: { day: number; coins: number } | null;
  /** Today's finished drawings toward `target`. */
  drawings: number;
  target: number;
  /** The streak that ended today (restarted only). */
  restartedFrom: number;
  /** The Rescue kept this streak today. */
  rescuedToday: boolean;
};

/** Today's drawings toward the day (a stored other day reads as 0). */
export function todayDrawings(state: StreakState, today: string): number {
  return state.today && state.today.day === today ? state.today.drawings : 0;
}

/** The streak as seen on `today` - read-only, nothing is used up until today counts. */
export function viewStreak(state: StreakState, today: string): StreakView {
  const base = {
    best: state.best,
    saves: state.saves,
    drawings: todayDrawings(state, today),
    target: STREAK_DAY_DRAWINGS,
    savesShort: 0,
    restartedFrom: 0,
    rescuedToday: state.rescuedOn === today,
  };
  const pays = (day: number) => ({ day, coins: streakRewardFor(day) });
  if (!state.lastDay || state.current <= 0) {
    return { ...base, status: state.best > 0 ? "lost" : "new", current: 0, doneToday: false, missed: 0, next: pays(1) };
  }
  const gap = daysBetween(state.lastDay, today);
  // Same day - or a clock that went backwards: never a reset, never a second count.
  if (!(gap >= 1)) {
    const restarted = state.restarted && state.restarted.day === state.lastDay && state.current === 1 ? state.restarted.from : 0;
    return { ...base, status: restarted ? "restarted" : "done", restartedFrom: restarted, current: state.current, doneToday: true, missed: 0, next: null };
  }
  const missed = gap - 1;
  const continued = pays(state.current + 1);
  if (missed === 0) {
    return { ...base, status: base.rescuedToday ? "rescued" : "active", current: state.current, doneToday: false, missed, next: continued };
  }
  if (missed <= state.saves) return { ...base, status: "protected", current: state.current, doneToday: false, missed, next: continued };
  if (missed <= STREAK_SAVE_MAX) {
    return { ...base, status: "at_risk", current: state.current, doneToday: false, missed, savesShort: missed - state.saves, next: continued };
  }
  return { ...base, status: "lost", current: 0, doneToday: false, missed, next: pays(1) };
}

export type StreakCompletion = {
  state: StreakState;
  /** False when today had already counted: nothing changed, nothing paid. */
  advanced: boolean;
  day: number;
  coins: number;
  savesUsed: number;
  saveEarned: boolean;
  emberUnlocked: boolean;
  /** A streak of this length could not be continued and started again (for gentle copy only). */
  restartedFrom: number;
};

/** `today` counted (its 5th drawing): the new state and what it paid. Pure. */
export function completeStreakDay(state: StreakState, today: string): StreakCompletion {
  const view = viewStreak(state, today);
  if (view.doneToday) {
    return { state, advanced: false, day: state.current, coins: 0, savesUsed: 0, saveEarned: false, emberUnlocked: false, restartedFrom: 0 };
  }
  const continuing = view.status === "active" || view.status === "protected" || view.status === "rescued";
  const day = continuing ? state.current + 1 : 1;
  const savesUsed = continuing ? view.missed : 0;
  let saves = state.saves - savesUsed;
  const saveEarned = earnsStreakSave(day) && saves < STREAK_SAVE_MAX;
  if (saveEarned) saves += 1;
  const emberUnlocked = day >= STREAK_EMBER_DAY && !state.emberGranted;
  const restartedFrom = !continuing && state.current > 0 ? state.current : 0;
  // A restart may come with a rescue offer for today; any older, unused offer or restart note is dropped here.
  const rescue = continuing ? undefined : rescueOfferOnRestart(state, today);
  return {
    state: {
      lastDay: today,
      current: day,
      best: Math.max(state.best, day),
      saves,
      emberGranted: state.emberGranted || emberUnlocked,
      ...(rescue ? { rescue } : {}),
      ...(restartedFrom >= 2 ? { restarted: { from: restartedFrom, day: today } } : {}),
      ...(state.rescuedOn ? { rescuedOn: state.rescuedOn } : {}),
      ...(state.today ? { today: state.today } : {}),
    },
    advanced: true,
    day,
    coins: streakRewardFor(day),
    savesUsed,
    saveEarned,
    emberUnlocked,
    restartedFrom,
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
  /** The day this drawing completed (null: progress only, today had already counted, or a duplicate). */
  completion: StreakCompletion | null;
  drawings: number;
  /** The same round was already counted today: nothing changed. */
  duplicate: boolean;
};

/**
 * One drawing was finished on `today`. Counts it - once: a `key` already counted today (a round reported again after
 * a reconnect or a remount) changes nothing - and completes the day on the 5th drawing, exactly once. After that the
 * day is done; further drawings only add to today's count. Pure.
 */
export function addStreakActivity(state: StreakState, today: string, key?: string): StreakActivity {
  const prior = state.today && state.today.day === today ? state.today : { day: today, drawings: 0 };
  const keys = prior.keys ?? [];
  if (key && keys.includes(key)) return { state, completion: null, drawings: prior.drawings, duplicate: true };
  const drawings = Math.min(999, prior.drawings + 1);
  const nextKeys = key ? [...keys, key].slice(-MAX_TODAY_KEYS) : keys;
  const withProgress: StreakState = { ...state, today: { day: today, drawings, ...(nextKeys.length ? { keys: nextKeys } : {}) } };
  if (viewStreak(state, today).doneToday || drawings < STREAK_DAY_DRAWINGS) return { state: withProgress, completion: null, drawings, duplicate: false };
  const completion = completeStreakDay(withProgress, today);
  return { state: completion.state, completion, drawings, duplicate: false };
}

/** Which play a drawing came from - reported (bounded) with the day's coins. Re-exported for callers. */
export type { StreakRoute };

/**
 * Does completing this day earn the full celebration card (rather than the short banner)? A milestone (D3, D7,
 * D14, D30 and the larger days after), a day that awards a Streak Save, or the Ember Ink - never a restart.
 */
export function isBigStreakDay(c: Pick<StreakCompletion, "day" | "saveEarned" | "emberUnlocked" | "restartedFrom">): boolean {
  return c.restartedFrom === 0 && (isStreakMilestone(c.day) || c.saveEarned || c.emberUnlocked);
}
