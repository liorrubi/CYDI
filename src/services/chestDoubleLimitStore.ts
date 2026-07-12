import { getSaveData, updateSaveData } from "./saveStore";

/**
 * Daily cap on "double reward" uses for chests bought via the shop (Iron/Copper/Silver/Gold/Platinum
 * keys) - the once-a-day free Daily Chest is exempt and can always be doubled. Stands in for a future
 * Rewarded Ads limit: swap the call to `recordPaidChestDoubleUsed` for an ad-watch-completed callback
 * once real ads are wired up, the daily reset logic here doesn't need to change.
 */
export const MAX_PAID_CHEST_DOUBLES_PER_DAY = 1;

function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function usedToday(): number {
  // Optional chaining guards saves persisted before this field existed.
  const record = getSaveData().progress.paidChestDoubles;
  if (!record || record.date !== todayDateString()) return 0;
  return record.count;
}

export function getPaidChestDoublesRemaining(): number {
  return Math.max(0, MAX_PAID_CHEST_DOUBLES_PER_DAY - usedToday());
}

/** Marks one paid-chest double as used today, resetting the counter first if this is the first one since local midnight. */
export function recordPaidChestDoubleUsed(): void {
  const today = todayDateString();
  updateSaveData((data) => {
    const record = data.progress.paidChestDoubles;
    if (!record || record.date !== today) {
      data.progress.paidChestDoubles = { date: today, count: 1 };
    } else {
      record.count += 1;
    }
  });
}
