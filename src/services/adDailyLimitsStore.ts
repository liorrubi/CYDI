// 0.59.0 per-local-day Rewarded limits, kept in the save (like paidChestDoubles) so a reload cannot reset them:
//  - Category "Unlock Now": at most once a day (UNLOCK_NOW_PER_DAY).
//  - x3run minimum-only grants: at most RUN_MIN_GRANTS_PER_DAY a day.
// Only a GRANTED reward counts - a failed, unavailable or closed-early ad costs nothing.

import { RUN_MIN_GRANTS_PER_DAY } from "../app/rewardedOfferCadence";
import { getSaveData, updateSaveData } from "./saveStore";

function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type AdLimits = { date: string; unlockNowUsed: boolean; minBonusGrants: number };

function today(): AdLimits {
  const date = todayDateString();
  const stored = getSaveData().progress.adLimits;
  if (!stored || stored.date !== date) return { date, unlockNowUsed: false, minBonusGrants: 0 };
  return { date, unlockNowUsed: stored.unlockNowUsed === true, minBonusGrants: Number(stored.minBonusGrants) || 0 };
}

function write(next: AdLimits): void {
  updateSaveData((data) => {
    data.progress.adLimits = next;
  });
}

export function isUnlockNowUsedToday(): boolean {
  return today().unlockNowUsed;
}

export function recordUnlockNowUsed(): void {
  write({ ...today(), unlockNowUsed: true });
}

export function hasRunMinBonusLeftToday(): boolean {
  return today().minBonusGrants < RUN_MIN_GRANTS_PER_DAY;
}

export function recordRunMinBonusGranted(): void {
  const t = today();
  write({ ...t, minBonusGrants: t.minBonusGrants + 1 });
}
