import { getSaveData, updateSaveData } from "./saveStore";

function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function canPlaySpecialChallengeFree(): boolean {
  return getSaveData().progress.specialChallenge?.lastFreeDate !== todayDateString();
}

export function markSpecialChallengeFreeUsed(): void {
  updateSaveData((data) => {
    data.progress.specialChallenge = { lastFreeDate: todayDateString() };
  });
}
