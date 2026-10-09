// 0.59.0 Daily Drawing Streak - the pure rules (no storage, no React, no clock): drawingStreakStore.ts feeds them the
// saved state and today's date. One mechanism: completing the Daily Challenge on a new day advances the streak.
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

export const STREAK_DAY_COINS = 20;
export const STREAK_SAVE_PRICE = 300;
export const STREAK_SAVE_MAX = 2;
export const STREAK_EMBER_DAY = 30;

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
};

export const EMPTY_STREAK: StreakState = { lastDay: "", current: 0, best: 0, saves: 0, emberGranted: false };

/** Any stored value -> a safe state (older saves have none; a hand-edited one could hold anything). */
export function normalizeStreak(value: unknown): StreakState {
  if (!value || typeof value !== "object") return { ...EMPTY_STREAK };
  const v = value as Record<string, unknown>;
  const int = (n: unknown, max: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(0, Math.floor(n))) : 0);
  const lastDay = typeof v.lastDay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.lastDay) ? v.lastDay : "";
  const current = lastDay ? int(v.current, 100_000) : 0;
  return {
    lastDay,
    current,
    best: Math.max(int(v.best, 100_000), current),
    saves: int(v.saves, STREAK_SAVE_MAX),
    emberGranted: v.emberGranted === true,
  };
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
  /** What completing today's Daily would pay and reach (null when already done today). */
  next: { day: number; coins: number } | null;
};

/** The streak as seen on `today` - read-only, nothing is used up until the next completion. */
export function viewStreak(state: StreakState, today: string): StreakView {
  const base = { best: state.best, saves: state.saves };
  if (!state.lastDay || state.current <= 0) return { ...base, current: 0, doneToday: false, savesNeeded: 0, next: { day: 1, coins: streakRewardFor(1) } };
  const gap = daysBetween(state.lastDay, today);
  // Same day - or a clock that went backwards: never a reset, never a second count.
  if (!(gap >= 1)) return { ...base, current: state.current, doneToday: true, savesNeeded: 0, next: null };
  const missed = gap - 1;
  if (missed <= state.saves) {
    const day = state.current + 1;
    return { ...base, current: state.current, doneToday: false, savesNeeded: missed, next: { day, coins: streakRewardFor(day) } };
  }
  return { ...base, current: 0, doneToday: false, savesNeeded: 0, next: { day: 1, coins: streakRewardFor(1) } };
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

/** A Daily Challenge was completed on `today`: the new state and what it paid. Pure. */
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
  return {
    state: {
      lastDay: today,
      current: day,
      best: Math.max(state.best, day),
      saves,
      emberGranted: state.emberGranted || emberUnlocked,
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
