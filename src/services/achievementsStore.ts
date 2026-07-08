import { getSaveData, updateSaveData } from "./saveStore";

export function getUnlockedAchievementIds(): string[] {
  return getSaveData().progress.achievements;
}

export function markAchievementUnlocked(id: string): void {
  const current = getUnlockedAchievementIds();
  if (current.includes(id)) return;
  updateSaveData((data) => {
    data.progress.achievements = [...current, id];
  });
}
