const STORAGE_KEY = "cydi.dailyStreak.v1";

type DailyStreakData = {
  lastVisitDate: string;
  currentStreak: number;
  longestStreak: number;
};

const DEFAULT_DATA: DailyStreakData = { lastVisitDate: "", currentStreak: 0, longestStreak: 0 };

function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBetween(from: string, to: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / msPerDay);
}

function readData(): DailyStreakData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_DATA;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.lastVisitDate === "string" &&
      typeof parsed?.currentStreak === "number" &&
      typeof parsed?.longestStreak === "number"
    ) {
      return parsed;
    }
    return DEFAULT_DATA;
  } catch {
    return DEFAULT_DATA;
  }
}

function writeData(data: DailyStreakData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore write failures (private browsing, quota, etc.)
  }
}

/** Call once per app load - extends the streak if a new calendar day started right after the last visit, resets it to 1 if a day was skipped, and otherwise leaves it untouched for repeat visits on the same day. */
export function recordDailyVisit(): void {
  const data = readData();
  const today = todayDateString();
  if (data.lastVisitDate === today) return;

  const gap = data.lastVisitDate ? daysBetween(data.lastVisitDate, today) : null;
  const currentStreak = gap === 1 ? data.currentStreak + 1 : 1;
  const longestStreak = Math.max(data.longestStreak, currentStreak);
  writeData({ lastVisitDate: today, currentStreak, longestStreak });
}

/** The best daily-visit streak ever reached - used for streak achievements, so a broken streak doesn't take away one already earned. */
export function getLongestStreak(): number {
  return readData().longestStreak;
}

export function getCurrentStreak(): number {
  return readData().currentStreak;
}
