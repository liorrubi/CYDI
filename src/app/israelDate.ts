/** "YYYY-MM-DD" for `now` in the Asia/Jerusalem calendar. Single source of truth
 * shared by the analytics day-bucketing (src/services/analyticsSchema.ts) and the
 * daily challenge's date rollover (worker/dailyChallengeDO.ts) - both are
 * worker-safe callers, and this uses only Intl/Date so it bundles anywhere. */
export function israelDateKey(now: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}
