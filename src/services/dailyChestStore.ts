import { DAILY_CHEST, rollChestReward } from "../app/constants";
import { getSaveData, updateSaveData } from "./saveStore";

function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function canOpenDailyChest(): boolean {
  // Optional chaining guards saves persisted before this field existed.
  return getSaveData().progress.dailyChest?.lastOpenedDate !== todayDateString();
}

/** Marks today's free chest as claimed and rolls the reward - the caller is responsible for actually crediting it (e.g. after a double-or-nothing offer resolves). */
export function openDailyChest(): number {
  const amount = rollChestReward(DAILY_CHEST.rewardMin, DAILY_CHEST.rewardMax);
  updateSaveData((data) => {
    data.progress.dailyChest = { lastOpenedDate: todayDateString() };
  });
  return amount;
}
