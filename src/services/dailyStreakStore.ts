import { getSaveData, updateSaveData } from "./saveStore";

function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBetween(from: string, to: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / msPerDay);
}

/** Call once per app load - extends the streak if a new calendar day started right after the last visit, resets it to 1 if a day was skipped, and otherwise leaves it untouched for repeat visits on the same day. */
export function recordDailyVisit(): void {
  const streak = getSaveData().progress.dailyStreak;
  const today = todayDateString();
  if (streak.lastVisitDate === today) return;

  const gap = streak.lastVisitDate ? daysBetween(streak.lastVisitDate, today) : null;
  const currentStreak = gap === 1 ? streak.currentStreak + 1 : 1;
  const longestStreak = Math.max(streak.longestStreak, currentStreak);
  updateSaveData((data) => {
    data.progress.dailyStreak = { lastVisitDate: today, currentStreak, longestStreak };
  });
}

/** The best daily-visit streak ever reached - used for streak achievements, so a broken streak doesn't take away one already earned. */
export function getLongestStreak(): number {
  return getSaveData().progress.dailyStreak.longestStreak;
}

export function getCurrentStreak(): number {
  return getSaveData().progress.dailyStreak.currentStreak;
}
