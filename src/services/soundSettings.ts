import { getSaveData, updateSaveData } from "./saveStore";

export function isSoundEnabled(): boolean {
  return getSaveData().settings.soundEnabled;
}

export function setSoundEnabled(enabled: boolean): void {
  updateSaveData((data) => {
    data.settings.soundEnabled = enabled;
  });
}
